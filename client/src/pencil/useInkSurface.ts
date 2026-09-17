// Shared drawing surface logic for InkLayer and AnswerPad: input attachment, live stroke, eraser preview and cursor.
// Live feedback is applied imperatively on SVG elements (no React render per pointer move).
import type { EraserMode, InkPoint, InkTool, Thickness } from '@aide/shared';
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { finalizeStrokePoints, fragmentsPath, smoothPoints, strokePath, StrokeBuilder } from './DrawingEngine';
import { boundingBox, boxesIntersect, expandBox, hitTestStroke, splitStroke, type Box, type Pt } from './geometry';
import { attachPencilInput, type InputMode, type InputSample } from './input';
import { TOOL_PRESETS, eraserRadiusPx, strokeWidthPx } from './Tools';

export interface RenderedStroke<A = unknown> {
  id: string;
  annotation: A;
  tool: InkTool;
  /** Surface px. */
  points: InkPoint[];
  widthPx: number;
  path: string;
  box: Box;
}

export interface SurfaceToolState {
  tool: InkTool | 'eraser';
  eraserMode: EraserMode;
  color: string;
  thickness: Thickness;
}

export interface InkSurfaceOptions {
  containerRef: RefObject<HTMLElement | null>;
  /** Reference SVG: its client rect is the origin of the surface coordinates. */
  svgRef: RefObject<SVGSVGElement | null>;
  liveInkRef: RefObject<SVGPathElement | null>;
  /** Live highlighter path (blended surface); falls back to liveInkRef. */
  liveHighlightRef?: RefObject<SVGPathElement | null>;
  cursorRef: RefObject<SVGCircleElement | null>;
  enabled: boolean;
  mode(): InputMode;
  fingerDraws(): boolean;
  toolState(): SurfaceToolState;
  /** px per em of the surface, measured at stroke start. */
  emPx(): number;
  strokes(): readonly RenderedStroke[];
  onPenDetected(): void;
  /** Called before a stroke or an eraser gesture starts (focus history, measure layout). */
  onGestureStart?(): void;
  onInk(stroke: { points: InkPoint[]; tool: InkTool; widthPx: number; color: string }): void;
  onErase(eraser: { path: Pt[]; radiusPx: number; mode: 'stroke' | 'partial' }): void;
  onPageEraser(): void;
  onPenTap?(sample: InputSample, target: Element | null): void;
}

export interface InkSurfaceHandle {
  /** Clears the live stroke once the committed stroke is rendered. */
  settleLive(): void;
  clearLive(): void;
}

type Session =
  | { kind: 'ink'; tool: InkTool; color: string; widthPx: number; builder: StrokeBuilder }
  | { kind: 'eraser'; mode: 'stroke' | 'partial'; radiusPx: number; path: Pt[]; renderedCount: number; hit: Set<string>; touched: Set<string> };

const SVG_HIDDEN = 'hidden';

function requestFrame(cb: () => void): number {
  if (typeof requestAnimationFrame === 'function') return requestAnimationFrame(cb);
  return setTimeout(cb, 16) as unknown as number;
}

function cancelFrame(id: number): void {
  if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(id);
  else clearTimeout(id);
}

function strokeElement(svg: SVGSVGElement | null, id: string): SVGPathElement | null {
  const root = svg?.parentElement ?? svg;
  if (!root) return null;
  for (const el of Array.from(root.querySelectorAll<SVGPathElement>('path[data-ink-id]'))) {
    if (el.getAttribute('data-ink-id') === id) return el;
  }
  return null;
}

/** Current element of a ref, as state: effects re-run when the parent attaches or replaces the element. */
export function useRefElement<T extends Element>(ref: RefObject<T | null>): T | null {
  const [element, setElement] = useState<T | null>(null);
  useLayoutEffect(() => {
    if (ref.current !== element) setElement(ref.current);
  });
  return element;
}

export function useInkSurface(options: InkSurfaceOptions): InkSurfaceHandle {
  const opts = useRef(options);
  useLayoutEffect(() => {
    opts.current = options;
  });
  const session = useRef<Session | null>(null);
  const frame = useRef(0);
  const pendingLiveClear = useRef(false);
  const liveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handle = useRef<InkSurfaceHandle | null>(null);

  const livePath = (tool: InkTool | null): SVGPathElement | null => {
    const o = opts.current;
    if (tool === 'highlighter' && o.liveHighlightRef?.current) return o.liveHighlightRef.current;
    return o.liveInkRef.current;
  };

  const clearLive = (): void => {
    pendingLiveClear.current = false;
    if (liveTimer.current !== null) clearTimeout(liveTimer.current);
    liveTimer.current = null;
    for (const path of [opts.current.liveInkRef.current, opts.current.liveHighlightRef?.current ?? null]) {
      path?.setAttribute('d', '');
    }
  };

  if (!handle.current) {
    handle.current = {
      settleLive: () => {
        if (pendingLiveClear.current) clearLive();
      },
      clearLive,
    };
  }

  const toLocal = (sample: InputSample): Pt | null => {
    const svg = opts.current.svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    return { x: sample.clientX - rect.left, y: sample.clientY - rect.top };
  };

  const showCursor = (pt: Pt | null, radius: number): void => {
    const cursor = opts.current.cursorRef.current;
    if (!cursor) return;
    if (!pt) {
      cursor.setAttribute('visibility', SVG_HIDDEN);
      return;
    }
    cursor.setAttribute('cx', pt.x.toFixed(1));
    cursor.setAttribute('cy', pt.y.toFixed(1));
    cursor.setAttribute('r', radius.toFixed(1));
    cursor.setAttribute('visibility', 'visible');
  };

  const renderFrame = (): void => {
    frame.current = 0;
    const s = session.current;
    const svg = opts.current.svgRef.current;
    if (!s || !svg) return;
    if (s.kind === 'ink') {
      livePath(s.tool)?.setAttribute('d', strokePath(smoothPoints(s.builder.points), s.tool, s.widthPx, false));
      return;
    }
    if (s.mode !== 'partial') return;
    // Only strokes near the samples added since the previous frame can change.
    const dirty = boundingBox(s.path.slice(Math.max(0, s.renderedCount - 1)));
    s.renderedCount = s.path.length;
    if (!dirty) return;
    for (const stroke of opts.current.strokes()) {
      const reach = s.radiusPx + stroke.widthPx / 2;
      if (!boxesIntersect(expandBox(stroke.box, reach), dirty)) continue;
      const fragments = splitStroke(stroke.points, s.path, reach);
      if (fragments === null) continue;
      s.touched.add(stroke.id);
      strokeElement(svg, stroke.id)?.setAttribute('d', fragmentsPath(fragments, stroke.tool, stroke.widthPx));
    }
  };

  const schedule = (): void => {
    if (frame.current === 0) frame.current = requestFrame(renderFrame);
  };

  const { enabled } = options;
  const container = useRefElement(options.containerRef);

  useEffect(() => {
    const el = container;
    if (!enabled || !el) return undefined;

    const input = attachPencilInput(el, {
      mode: () => opts.current.mode(),
      fingerDraws: () => opts.current.fingerDraws(),
      onPenDetected: () => opts.current.onPenDetected(),
      onPenTap: opts.current.onPenTap ? (sample, target) => opts.current.onPenTap?.(sample, target) : undefined,
      onStart: (sample) => {
        const o = opts.current;
        const state = o.toolState();
        if (state.tool === 'eraser' && state.eraserMode === 'page') {
          o.onPageEraser();
          return false;
        }
        o.onGestureStart?.();
        const pt = toLocal(sample);
        if (!pt) return false;
        clearLive();
        const emPx = o.emPx();
        if (state.tool === 'eraser') {
          const radiusPx = eraserRadiusPx(sample.kind, emPx);
          session.current = { kind: 'eraser', mode: state.eraserMode === 'partial' ? 'partial' : 'stroke', radiusPx, path: [pt], renderedCount: 0, hit: new Set(), touched: new Set() };
          showCursor(pt, radiusPx);
          eraseStep(pt, pt);
          return true;
        }
        const builder = new StrokeBuilder();
        builder.add(pt.x, pt.y, sample.pressure);
        const widthPx = strokeWidthPx(state.tool, state.thickness, emPx);
        session.current = { kind: 'ink', tool: state.tool, color: state.color, widthPx, builder };
        const live = livePath(state.tool);
        if (live) {
          live.setAttribute('fill', state.color);
          live.setAttribute('opacity', String(TOOL_PRESETS[state.tool].opacity));
        }
        schedule();
        return true;
      },
      onMove: (samples) => {
        const s = session.current;
        if (!s) return;
        for (const sample of samples) {
          const pt = toLocal(sample);
          if (!pt) continue;
          if (s.kind === 'ink') s.builder.add(pt.x, pt.y, sample.pressure);
          else {
            const prev = s.path[s.path.length - 1] ?? pt;
            s.path.push(pt);
            showCursor(pt, s.radiusPx);
            eraseStep(prev, pt);
          }
        }
        schedule();
      },
      onEnd: () => {
        const s = session.current;
        session.current = null;
        if (frame.current !== 0) {
          cancelFrame(frame.current);
          frame.current = 0;
        }
        if (!s) return;
        if (s.kind === 'ink') {
          const points = finalizeStrokePoints(s.builder.points);
          livePath(s.tool)?.setAttribute('d', strokePath(points, s.tool, s.widthPx, true));
          pendingLiveClear.current = true;
          if (liveTimer.current !== null) clearTimeout(liveTimer.current);
          liveTimer.current = setTimeout(clearLive, 1500);
          opts.current.onInk({ points, tool: s.tool, widthPx: s.widthPx, color: s.color });
          return;
        }
        showCursor(null, 0);
        if (s.mode === 'partial' && s.renderedCount < s.path.length) {
          session.current = s;
          renderFrame();
          session.current = null;
        }
        opts.current.onErase({ path: s.path, radiusPx: s.radiusPx, mode: s.mode });
      },
      onAbort: () => {
        const s = session.current;
        session.current = null;
        clearLive();
        showCursor(null, 0);
        if (s?.kind === 'eraser') {
          // Restore the strokes hidden or cut by the preview.
          for (const id of new Set([...s.hit, ...s.touched])) {
            const stroke = opts.current.strokes().find((x) => x.id === id);
            const el = strokeElement(opts.current.svgRef.current, id);
            if (!el || !stroke) continue;
            el.style.visibility = '';
            el.setAttribute('d', stroke.path);
          }
        }
      },
      onHover: (sample) => {
        const o = opts.current;
        const state = o.toolState();
        if (!sample || o.mode() !== 'annotation' || state.tool !== 'eraser' || state.eraserMode === 'page' || session.current) {
          if (!session.current) showCursor(null, 0);
          return;
        }
        showCursor(toLocal(sample), eraserRadiusPx('pen', o.emPx()));
      },
    });

    function eraseStep(from: Pt, to: Pt): void {
      const s = session.current;
      if (!s || s.kind !== 'eraser' || s.mode !== 'stroke') return;
      const segment = [from, to];
      for (const stroke of opts.current.strokes()) {
        if (s.hit.has(stroke.id)) continue;
        if (!hitTestStroke(stroke.points, stroke.widthPx, segment, s.radiusPx)) continue;
        s.hit.add(stroke.id);
        const el = strokeElement(opts.current.svgRef.current, stroke.id);
        if (el) el.style.visibility = SVG_HIDDEN;
      }
    }

    return () => {
      input.detach();
      if (frame.current !== 0) cancelFrame(frame.current);
      frame.current = 0;
    };
    // The surface is re-attached only when the container or the enabled flag changes; callbacks are read through opts.
  }, [enabled, container]);

  useEffect(
    () => () => {
      if (liveTimer.current !== null) clearTimeout(liveTimer.current);
    },
    [],
  );

  return handle.current;
}

/** Inline styles applied to the container while drawing is possible, restored afterwards. */
export function useSurfaceContainerStyle(el: HTMLElement | null, active: boolean, fingerDraws: boolean): void {
  useEffect(() => {
    if (!el || !active) return undefined;
    const style = el.style;
    const previous = {
      touchAction: style.touchAction,
      userSelect: style.getPropertyValue('-webkit-user-select'),
      callout: style.getPropertyValue('-webkit-touch-callout'),
    };
    if (fingerDraws) style.touchAction = 'none';
    style.setProperty('-webkit-user-select', 'none');
    style.setProperty('-webkit-touch-callout', 'none');
    return () => {
      style.touchAction = previous.touchAction;
      if (previous.userSelect) style.setProperty('-webkit-user-select', previous.userSelect);
      else style.removeProperty('-webkit-user-select');
      if (previous.callout) style.setProperty('-webkit-touch-callout', previous.callout);
      else style.removeProperty('-webkit-touch-callout');
    };
  }, [el, active, fingerDraws]);
}
