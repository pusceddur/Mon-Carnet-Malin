// SVG ink overlay of one page (text view: anchored to the .rp-w words; original view: over the page image).
import { newId, type Annotation, type Id, type InkAnnotation, type InkPoint, type InkTool, type PageContent, type TextHighlight } from '@aide/shared';
import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState, type JSX, type RefObject } from 'react';
import { ConfirmDialog, useToast } from '../design/components';
import { pencil as strings } from '../i18n/fr/pencil';
import {
  anchorStrokeToText,
  blockTextSource,
  currentTextAnchor,
  eraseHighlightRanges,
  fitPageFrame,
  fromOriginalSpace,
  highlightRangesFromWords,
  measureTextLayout,
  resolveTextStroke,
  toOriginalSpace,
  wordsCrossedByStroke,
  type PageFrame,
  type TextLayout,
} from './anchoring';
import { addAnnotations, clearPageAnnotations, replaceAnnotations, useAnnotations, usePageContent } from './AnnotationStore';
import { strokePath } from './DrawingEngine';
import { boundingBox, hitTestStroke, splitStroke, type Pt } from './geometry';
import { documentHistoryKey } from './history';
import { startPencilPreferences } from './preferences';
import { usePencilStore } from './store';
import { TOOL_PRESETS, emPxForOriginal } from './Tools';
import { useInkSurface, useRefElement, useSurfaceContainerStyle, type RenderedStroke } from './useInkSurface';
import './pencil.css';

export interface InkLayerProps {
  documentId: Id;
  childId: Id;
  view: 'text' | 'original';
  pageIndex: number;
  /** Page container: `.rp-page` (text view) or the element wrapping the page image (original view). Render InkLayer inside it. */
  containerRef: RefObject<HTMLElement | null>;
  /** Natural size of the page image (original view). */
  imageSize?: { width: number; height: number };
  /** Signature of the reading preferences + viewport width (§15.7): positions are recomputed when it changes. */
  layoutKey: string;
}

type Geometry =
  | { kind: 'text'; layout: TextLayout; emPx: number }
  | { kind: 'original'; frame: PageFrame; emPx: number };

type Stroke = RenderedStroke<InkAnnotation>;

const EMPTY_STROKES: Stroke[] = [];

function computedFontSize(el: Element): number {
  const view = el.ownerDocument.defaultView;
  const size = view ? Number.parseFloat(view.getComputedStyle(el).fontSize) : Number.NaN;
  return Number.isFinite(size) && size > 0 ? size : 16;
}

/** Most frequent block font size (paragraph text rather than titles). */
function readingEmPx(layout: TextLayout, container: Element): number {
  const counts = new Map<number, number>();
  for (const w of layout.words) counts.set(w.fontSizePx, (counts.get(w.fontSizePx) ?? 0) + 1);
  let best = 0;
  let bestCount = 0;
  for (const [size, count] of counts) {
    if (count > bestCount) {
      best = size;
      bestCount = count;
    }
  }
  return best > 0 ? best : computedFontSize(container);
}

function isInkOnPage(a: Annotation, view: 'text' | 'original', pageIndex: number): a is InkAnnotation {
  return a.type === 'ink' && a.space.kind === view && a.space.pageIndex === pageIndex;
}

function renderStroke(a: InkAnnotation, geo: Geometry, page: PageContent | undefined): Stroke | null {
  let resolved: { points: InkPoint[]; widthPx: number } | null = null;
  if (geo.kind === 'text' && a.space.kind === 'text') {
    const anchor = currentTextAnchor(a.space, page);
    resolved = anchor ? resolveTextStroke(anchor, a.points, a.width, geo.layout) : null;
  } else if (geo.kind === 'original' && a.space.kind === 'original') {
    resolved = fromOriginalSpace(a.points, a.width, geo.frame);
  }
  if (!resolved) return null;
  const box = boundingBox(resolved.points);
  if (!box) return null;
  return { id: a.id, annotation: a, tool: a.tool, points: resolved.points, widthPx: resolved.widthPx, path: strokePath(resolved.points, a.tool, resolved.widthPx), box };
}

/** Re-measures when the container resizes, its content is re-rendered, fonts load or the device rotates (rAF-throttled). */
function useLayoutInvalidation(container: HTMLElement | null, ownRoot: RefObject<HTMLElement | null>, invalidate: () => void): void {
  useEffect(() => {
    if (!container) return undefined;
    let frame = 0;
    const schedule = (): void => {
      if (frame !== 0) return;
      frame = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(run) : (setTimeout(run, 16) as unknown as number);
    };
    const run = (): void => {
      frame = 0;
      invalidate();
    };
    const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null;
    resize?.observe(container);
    const mutation =
      typeof MutationObserver === 'function'
        ? new MutationObserver((records) => {
            const own = ownRoot.current;
            if (records.some((r) => !own || !own.contains(r.target))) schedule();
          })
        : null;
    mutation?.observe(container, { childList: true, subtree: true });
    // Pages with `content-visibility: auto` have no word boxes until they are rendered on screen.
    const visibility =
      typeof IntersectionObserver === 'function'
        ? new IntersectionObserver((entries) => {
            if (entries.some((e) => e.isIntersecting)) schedule();
          })
        : null;
    visibility?.observe(container);
    container.addEventListener('contentvisibilityautostatechange', schedule);
    window.addEventListener('resize', schedule);
    window.addEventListener('orientationchange', schedule);
    const fonts = (document as Document & { fonts?: EventTarget }).fonts;
    fonts?.addEventListener?.('loadingdone', schedule);
    return () => {
      resize?.disconnect();
      mutation?.disconnect();
      visibility?.disconnect();
      container.removeEventListener('contentvisibilityautostatechange', schedule);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('orientationchange', schedule);
      fonts?.removeEventListener?.('loadingdone', schedule);
      if (frame !== 0) {
        if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame);
        clearTimeout(frame);
      }
    };
  }, [container, ownRoot, invalidate]);
}

/** Returns the previous array while the annotations (id + updatedAt) are the same. */
function useStableList<T extends Annotation>(list: T[]): T[] {
  const signature = list.map((a) => `${a.id}:${a.updatedAt}`).join('|');
  const ref = useRef<{ signature: string; list: T[] }>({ signature, list });
  if (ref.current.signature !== signature) ref.current = { signature, list };
  return ref.current.list;
}

/** Makes the container the containing block of the overlay when it is statically positioned. */
function useRelativeContainer(container: HTMLElement | null): void {
  useLayoutEffect(() => {
    if (!container) return undefined;
    const view = container.ownerDocument.defaultView;
    if (!view || view.getComputedStyle(container).position !== 'static') return undefined;
    const previous = container.style.position;
    container.style.position = 'relative';
    return () => {
      container.style.position = previous;
    };
  }, [container]);
}

export function InkLayer({ documentId, childId, view, pageIndex, containerRef, imageSize, layoutKey }: InkLayerProps): JSX.Element {
  const mode = usePencilStore((s) => s.mode);
  const fingerDraws = usePencilStore((s) => s.fingerDraws);
  const toast = useToast();
  const annotations = useAnnotations(documentId, childId);
  const page = usePageContent(documentId, pageIndex, view === 'text');
  const historyKey = documentHistoryKey(documentId, childId);

  const rootRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const liveInkRef = useRef<SVGPathElement | null>(null);
  const liveHighlightRef = useRef<SVGPathElement | null>(null);
  const cursorRef = useRef<SVGCircleElement | null>(null);
  const geometryRef = useRef<Geometry | null>(null);
  const strokesRef = useRef<Stroke[]>(EMPTY_STROKES);
  const [strokes, setStrokes] = useState<Stroke[]>(EMPTY_STROKES);
  const [layoutTick, invalidate] = useReducer((n: number) => n + 1, 0);
  const [epoch, remount] = useReducer((n: number) => n + 1, 0);
  const [confirmClear, setConfirmClear] = useState(false);
  const container = useRefElement(containerRef);

  // Stable per page: a change on another page does not re-measure this one.
  const ink = useStableList(useMemo(() => annotations.filter((a) => isInkOnPage(a, view, pageIndex)), [annotations, view, pageIndex]));
  const highlights = useStableList(
    useMemo(() => (view === 'text' ? annotations.filter((a): a is TextHighlight => a.type === 'highlight' && a.pageIndex === pageIndex) : []), [annotations, view, pageIndex]),
  );

  useEffect(() => {
    void startPencilPreferences();
  }, []);
  useEffect(() => usePencilStore.getState().activateHistory(historyKey), [historyKey]);
  useRelativeContainer(container);
  useSurfaceContainerStyle(container, mode === 'annotation', fingerDraws);
  useLayoutInvalidation(container, rootRef, invalidate);

  const imageWidth = imageSize?.width;
  const imageHeight = imageSize?.height;
  const measure = useCallback((): Geometry | null => {
    const svg = svgRef.current;
    if (!svg || !container) return null;
    const rect = svg.getBoundingClientRect();
    if (view === 'text') {
      const layout = measureTextLayout(container, pageIndex, { x: rect.left, y: rect.top });
      return { kind: 'text', layout, emPx: readingEmPx(layout, container) };
    }
    const image = container.querySelector('img, canvas');
    let frame: PageFrame;
    if (image) {
      const r = image.getBoundingClientRect();
      frame = r.width > 0 && r.height > 0 ? { left: r.left - rect.left, top: r.top - rect.top, width: r.width, height: r.height } : fitPageFrame(rect.width, rect.height, imageWidth && imageHeight ? { width: imageWidth, height: imageHeight } : undefined);
    } else {
      frame = fitPageFrame(rect.width, rect.height, imageWidth && imageHeight ? { width: imageWidth, height: imageHeight } : undefined);
    }
    return { kind: 'original', frame, emPx: emPxForOriginal(frame.width) };
  }, [container, view, pageIndex, imageWidth, imageHeight]);

  const saveFailed = (message: string): void => {
    toast.error(message);
    surface.clearLive();
    remount();
  };

  const commitInk = (stroke: { points: InkPoint[]; tool: InkTool; widthPx: number; color: string }): void => {
    const geo = geometryRef.current;
    if (!geo || stroke.points.length === 0) {
      surface.clearLive();
      return;
    }
    const now = Date.now();
    if (geo.kind === 'text') {
      const source = blockTextSource(geo.layout, page);
      if (stroke.tool === 'highlighter') {
        const ranges = highlightRangesFromWords(wordsCrossedByStroke(stroke.points, geo.layout), pageIndex, source);
        if (ranges.length > 0) {
          const created: TextHighlight[] = ranges.map((r) => ({
            id: newId(), type: 'highlight', childId, documentId, color: stroke.color,
            pageIndex: r.pageIndex, blockIndex: r.blockIndex, start: r.start, end: r.end, blockTextHash: r.blockTextHash, text: r.text,
            createdAt: now, updatedAt: now, deletedAt: null,
          }));
          addAnnotations(created, historyKey).catch(() => saveFailed(strings.errors.saveFailed));
          return;
        }
      }
    }
    const annotation = buildInk(geo, stroke.points, stroke.widthPx, { tool: stroke.tool, color: stroke.color, opacity: TOOL_PRESETS[stroke.tool].opacity }, now);
    if (!annotation) {
      surface.clearLive();
      return;
    }
    addAnnotations([annotation], historyKey).catch(() => saveFailed(strings.errors.saveFailed));
  };

  const buildInk = (geo: Geometry, pointsPx: InkPoint[], widthPx: number, style: Pick<InkAnnotation, 'tool' | 'color' | 'opacity'>, now: number): InkAnnotation | null => {
    const base = { id: newId(), type: 'ink' as const, childId, documentId, ...style, createdAt: now, updatedAt: now, deletedAt: null };
    if (geo.kind === 'text') {
      const anchored = anchorStrokeToText(pointsPx, widthPx, geo.layout, blockTextSource(geo.layout, page));
      return anchored && anchored.width > 0 ? { ...base, space: anchored.space, points: anchored.points, width: anchored.width } : null;
    }
    const mapped = toOriginalSpace(pointsPx, widthPx, geo.frame);
    return mapped && mapped.width > 0 ? { ...base, space: { kind: 'original', pageIndex }, points: mapped.points, width: mapped.width } : null;
  };

  const commitErase = ({ path, radiusPx, mode: eraseMode }: { path: Pt[]; radiusPx: number; mode: 'stroke' | 'partial' }): void => {
    const geo = geometryRef.current;
    if (!geo) return;
    const now = Date.now();
    const deleted: Annotation[] = [];
    const created: Annotation[] = [];
    for (const s of strokesRef.current) {
      if (eraseMode === 'stroke') {
        if (hitTestStroke(s.points, s.widthPx, path, radiusPx)) deleted.push(s.annotation);
        continue;
      }
      const fragments = splitStroke(s.points, path, radiusPx + s.widthPx / 2);
      if (fragments === null) continue;
      deleted.push(s.annotation);
      for (const fragment of fragments) {
        const a = buildInk(geo, fragment, s.widthPx, { tool: s.annotation.tool, color: s.annotation.color, opacity: s.annotation.opacity }, now);
        if (a) created.push(a);
      }
    }
    if (geo.kind === 'text') {
      const source = blockTextSource(geo.layout, page);
      for (const h of highlights) {
        const ranges = eraseHighlightRanges(h, geo.layout, path, radiusPx, eraseMode);
        if (ranges === null) continue;
        deleted.push(h);
        const text = source.text(h.blockIndex);
        if (text === null) continue;
        for (const r of ranges) {
          created.push({ ...h, id: newId(), start: r.start, end: r.end, text: text.slice(r.start, r.end), createdAt: now, updatedAt: now, deletedAt: null });
        }
      }
    }
    if (deleted.length === 0) return;
    replaceAnnotations(deleted, created, historyKey).catch(() => saveFailed(strings.errors.eraseFailed));
  };

  const surface = useInkSurface({
    containerRef,
    svgRef,
    liveInkRef,
    liveHighlightRef,
    cursorRef,
    enabled: true,
    mode: () => usePencilStore.getState().mode,
    fingerDraws: () => usePencilStore.getState().fingerDraws,
    toolState: () => usePencilStore.getState(),
    emPx: () => geometryRef.current?.emPx ?? 16,
    strokes: () => strokesRef.current,
    onPenDetected: () => usePencilStore.getState().notePenDetected(),
    onGestureStart: () => {
      usePencilStore.getState().focusHistory(historyKey);
      geometryRef.current = measure();
    },
    onInk: commitInk,
    onErase: commitErase,
    onPageEraser: () => setConfirmClear(true),
  });

  useLayoutEffect(() => {
    const geo = measure();
    geometryRef.current = geo;
    const next = geo ? ink.map((a) => renderStroke(a, geo, page)).filter((s): s is Stroke => s !== null) : EMPTY_STROKES;
    strokesRef.current = next;
    setStrokes(next);
    surface.settleLive();
  }, [ink, page, measure, layoutKey, layoutTick, surface]);

  // A snapped highlighter stroke disappears once the highlight exists.
  useEffect(() => {
    surface.settleLive();
  }, [highlights, surface]);

  const highlighterStrokes = strokes.filter((s) => s.tool === 'highlighter');
  const inkStrokes = strokes.filter((s) => s.tool !== 'highlighter');

  return (
    <div ref={rootRef} className="ink-layer" data-view={view} data-page-index={pageIndex} data-layout-key={layoutKey} aria-hidden="true">
      <svg className="ink-layer__svg ink-layer__svg--highlighter" xmlns="http://www.w3.org/2000/svg" focusable="false">
        <g key={epoch}>
          {highlighterStrokes.map((s) => (
            <path key={s.id} data-ink-id={s.id} d={s.path} fill={s.annotation.color} opacity={s.annotation.opacity} />
          ))}
        </g>
        <path ref={liveHighlightRef} className="ink-layer__live" d="" />
      </svg>
      <svg ref={svgRef} className="ink-layer__svg" xmlns="http://www.w3.org/2000/svg" focusable="false">
        <g key={epoch}>
          {inkStrokes.map((s) => (
            <path key={s.id} data-ink-id={s.id} d={s.path} fill={s.annotation.color} opacity={s.annotation.opacity} />
          ))}
        </g>
        <path ref={liveInkRef} className="ink-layer__live" d="" />
        <circle ref={cursorRef} className="ink-layer__cursor" cx="0" cy="0" r="0" visibility="hidden" />
      </svg>
      <ConfirmDialog
        open={confirmClear}
        title={strings.clearPage.title}
        message={strings.clearPage.message}
        confirmLabel={strings.clearPage.confirm}
        cancelLabel={strings.clearPage.cancel}
        tone="danger"
        onCancel={() => setConfirmClear(false)}
        onConfirm={async () => {
          try {
            await clearPageAnnotations({ documentId, childId, pageIndex, view });
          } catch {
            toast.error(strings.errors.eraseFailed);
          }
          setConfirmClear(false);
        }}
      />
    </div>
  );
}
