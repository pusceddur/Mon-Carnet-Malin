// Answer box of an exercise (§36, §15.7): exclusive tabs « ✏️ Dessiner » (ink saved as annotations in the answer space)
// and « ⌨️ Écrire » (plain textarea for Scribble, keyboard or dictation; no touch listener around it).
import { LIMITS, newId, type Annotation, type Id, type InkAnnotation, type InkPoint, type InkTool } from '@aide/shared';
import { useEffect, useId, useLayoutEffect, useMemo, useReducer, useRef, useState, type JSX, type KeyboardEvent } from 'react';
import { ConfirmDialog, IconButton, useToast } from '../design/components';
import { pencil as strings } from '../i18n/fr/pencil';
import { fromAnswerSpace, toAnswerSpace } from './anchoring';
import { addAnnotations, clearAnswerInk, replaceAnnotations, useAnswerInk } from './AnnotationStore';
import { strokePath } from './DrawingEngine';
import { boundingBox, hitTestStroke, splitStroke, type Pt } from './geometry';
import { answerHistoryKey } from './history';
import { startPencilPreferences } from './preferences';
import { usePencilStore } from './store';
import { ACTION_ICONS, TOOL_ICONS, TOOL_PRESETS, emPxForAnswer } from './Tools';
import { useInkSurface, useRefElement, useSurfaceContainerStyle, type RenderedStroke } from './useInkSurface';
import './pencil.css';

export type AnswerPadTab = 'draw' | 'write';

export interface AnswerPadProps {
  exerciseId: Id;
  questionId: string;
  childId: Id;
  /** Called with the id of every stroke saved in the box (all strokes: useAnswerInk / getAnswerInk). */
  onInkSaved?: (annotationId: Id) => void;
  /** Text typed, dictated or written with Scribble in the « Écrire » tab. */
  onTextChange?: (text: string) => void;
  /** Controlled text of the « Écrire » tab. */
  text?: string;
  /** Initial text when uncontrolled. */
  defaultText?: string;
  /** Default « Dessiner ». */
  defaultTab?: AnswerPadTab;
  onTabChange?: (tab: AnswerPadTab) => void;
  /** Shows a single panel without the tabs, when the host already offers its own « Écrire » / « Dessiner » choice. */
  only?: AnswerPadTab;
}

// Notebook lines drawn in a 1200 × 600 viewBox (box ratio ANSWER_BOX_RATIO): one line every 1/12 of the width.
const LINE_STEP = 100;
const LINES_VIEWBOX = { width: 1200, height: 600 };

type Stroke = RenderedStroke<InkAnnotation>;

export function AnswerPad({ exerciseId, questionId, childId, onInkSaved, onTextChange, text, defaultText = '', defaultTab = 'draw', onTabChange, only }: AnswerPadProps): JSX.Element {
  const [selectedTab, setTab] = useState<AnswerPadTab>(only ?? defaultTab);
  const tab = only ?? selectedTab;
  const [draft, setDraft] = useState(defaultText);
  const baseId = useId();
  const tabIds = { draw: `${baseId}-tab-draw`, write: `${baseId}-tab-write` };
  const panelIds = { draw: `${baseId}-panel-draw`, write: `${baseId}-panel-write` };
  const drawTab = useRef<HTMLButtonElement | null>(null);
  const writeTab = useRef<HTMLButtonElement | null>(null);

  const select = (next: AnswerPadTab, focus = false): void => {
    if (focus) (next === 'draw' ? drawTab : writeTab).current?.focus();
    if (next === tab) return;
    setTab(next);
    onTabChange?.(next);
  };

  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight' && event.key !== 'Home' && event.key !== 'End') return;
    event.preventDefault();
    const next: AnswerPadTab = event.key === 'Home' ? 'draw' : event.key === 'End' ? 'write' : tab === 'draw' ? 'write' : 'draw';
    select(next, true);
  };

  const value = text ?? draft;
  const panelProps = only ? {} : { role: 'tabpanel', 'aria-labelledby': tabIds[tab] };

  return (
    <div className="answer-pad">
      {!only && (
        <div role="tablist" aria-label={strings.answerPad.tabsLabel} className="answer-pad__tabs">
          {(['draw', 'write'] as const).map((t) => (
            <button
              key={t}
              ref={t === 'draw' ? drawTab : writeTab}
              id={tabIds[t]}
              type="button"
              role="tab"
              aria-selected={tab === t}
              aria-controls={panelIds[t]}
              tabIndex={tab === t ? 0 : -1}
              className="answer-pad__tab"
              onClick={() => select(t)}
              onKeyDown={onTabKeyDown}
            >
              <span aria-hidden="true">{t === 'draw' ? '✏️' : '⌨️'}</span>
              <span>{t === 'draw' ? strings.answerPad.draw : strings.answerPad.write}</span>
            </button>
          ))}
        </div>
      )}
      {tab === 'draw' ? (
        <div id={panelIds.draw} {...panelProps}>
          <DrawPanel exerciseId={exerciseId} questionId={questionId} childId={childId} onInkSaved={onInkSaved} />
        </div>
      ) : (
        <div id={panelIds.write} {...panelProps}>
          <label htmlFor={`${baseId}-text`} className="visually-hidden">
            {strings.answerPad.writeLabel}
          </label>
          <textarea
            id={`${baseId}-text`}
            className="answer-pad__textarea"
            value={value}
            maxLength={LIMITS.answerMaxChars}
            placeholder={strings.answerPad.writePlaceholder}
            lang="fr"
            rows={5}
            autoCapitalize="sentences"
            autoCorrect="on"
            spellCheck
            aria-describedby={`${baseId}-scribble`}
            onChange={(event) => {
              const next = event.target.value;
              if (text === undefined) setDraft(next);
              onTextChange?.(next);
            }}
          />
          <p id={`${baseId}-scribble`} className="pencil-hint">
            <span aria-hidden="true">✏️ </span>
            {strings.answerPad.scribbleHint}
          </p>
        </div>
      )}
    </div>
  );
}

function DrawPanel({ exerciseId, questionId, childId, onInkSaved }: Pick<AnswerPadProps, 'exerciseId' | 'questionId' | 'childId' | 'onInkSaved'>): JSX.Element {
  const toast = useToast();
  const annotations = useAnswerInk(exerciseId, questionId, childId);
  const historyKey = answerHistoryKey(exerciseId, questionId, childId);
  const fingerDraws = usePencilStore((s) => s.fingerDraws);
  const canUndo = usePencilStore((s) => s.historyKey === historyKey && s.canUndo);
  const canRedo = usePencilStore((s) => s.historyKey === historyKey && s.canRedo);
  const [padTool, setPadTool] = useState<'pencil' | 'eraser'>('pencil');
  const [confirmClear, setConfirmClear] = useState(false);
  const [boxWidth, setBoxWidth] = useState(0);
  const [epoch, remount] = useReducer((n: number) => n + 1, 0);

  const boxRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const liveRef = useRef<SVGPathElement | null>(null);
  const cursorRef = useRef<SVGCircleElement | null>(null);
  const padToolRef = useRef(padTool);
  const strokesRef = useRef<Stroke[]>([]);
  const box = useRefElement(boxRef);

  useLayoutEffect(() => {
    padToolRef.current = padTool;
  }, [padTool]);

  useEffect(() => {
    void startPencilPreferences();
  }, []);
  useEffect(() => usePencilStore.getState().activateHistory(historyKey), [historyKey]);
  useSurfaceContainerStyle(box, true, fingerDraws);

  useLayoutEffect(() => {
    const svg = svgRef.current;
    if (!svg) return undefined;
    const measure = (): void => setBoxWidth(svg.getBoundingClientRect().width);
    measure();
    if (typeof ResizeObserver !== 'function') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(svg);
    return () => observer.disconnect();
  }, []);

  const strokes = useMemo<Stroke[]>(() => {
    if (boxWidth <= 0) return [];
    const out: Stroke[] = [];
    for (const a of annotations) {
      const { points, widthPx } = fromAnswerSpace(a.points, a.width, boxWidth);
      const bbox = boundingBox(points);
      if (bbox) out.push({ id: a.id, annotation: a, tool: a.tool, points, widthPx, path: strokePath(points, a.tool, widthPx), box: bbox });
    }
    return out;
  }, [annotations, boxWidth]);

  const currentWidth = (): number => svgRef.current?.getBoundingClientRect().width ?? boxWidth;

  const saveFailed = (message: string): void => {
    toast.error(message);
    surface.clearLive();
    remount();
  };

  const buildInk = (pointsPx: InkPoint[], widthPx: number, style: { tool: InkTool; color: string; opacity: number }, width: number, now: number): InkAnnotation | null => {
    const mapped = toAnswerSpace(pointsPx, widthPx, width);
    if (!mapped || mapped.width <= 0 || pointsPx.length === 0) return null;
    return {
      id: newId(), type: 'ink', childId, documentId: null, ...style, width: mapped.width,
      space: { kind: 'answer', exerciseId, questionId }, points: mapped.points,
      createdAt: now, updatedAt: now, deletedAt: null,
    };
  };

  const surface = useInkSurface({
    containerRef: boxRef,
    svgRef,
    liveInkRef: liveRef,
    cursorRef,
    enabled: true,
    mode: () => 'annotation',
    fingerDraws: () => usePencilStore.getState().fingerDraws,
    toolState: () => {
      const s = usePencilStore.getState();
      return {
        tool: padToolRef.current === 'eraser' ? 'eraser' : 'pencil',
        eraserMode: s.eraserMode === 'partial' ? 'partial' : 'stroke',
        color: s.colorByTool.pencil,
        thickness: s.thicknessByTool.pencil,
      };
    },
    emPx: () => emPxForAnswer(currentWidth()),
    strokes: () => strokesRef.current,
    onPenDetected: () => usePencilStore.getState().notePenDetected(),
    onGestureStart: () => usePencilStore.getState().focusHistory(historyKey),
    onInk: ({ points, tool, widthPx, color }) => {
      const annotation = buildInk(points, widthPx, { tool, color, opacity: TOOL_PRESETS[tool].opacity }, currentWidth(), Date.now());
      if (!annotation) {
        surface.clearLive();
        return;
      }
      addAnnotations([annotation], historyKey).then(
        () => onInkSaved?.(annotation.id),
        () => saveFailed(strings.errors.saveFailed),
      );
    },
    onErase: ({ path, radiusPx, mode }: { path: Pt[]; radiusPx: number; mode: 'stroke' | 'partial' }) => {
      const width = currentWidth();
      const now = Date.now();
      const deleted: Annotation[] = [];
      const created: Annotation[] = [];
      for (const s of strokesRef.current) {
        if (mode === 'stroke') {
          if (hitTestStroke(s.points, s.widthPx, path, radiusPx)) deleted.push(s.annotation);
          continue;
        }
        const fragments = splitStroke(s.points, path, radiusPx + s.widthPx / 2);
        if (fragments === null) continue;
        deleted.push(s.annotation);
        for (const fragment of fragments) {
          const a = buildInk(fragment, s.widthPx, { tool: s.annotation.tool, color: s.annotation.color, opacity: s.annotation.opacity }, width, now);
          if (a) created.push(a);
        }
      }
      if (deleted.length === 0) return;
      replaceAnnotations(deleted, created, historyKey).catch(() => saveFailed(strings.errors.eraseFailed));
    },
    onPageEraser: () => undefined,
  });

  useLayoutEffect(() => {
    strokesRef.current = strokes;
    surface.settleLive();
  }, [strokes, surface]);

  const lines: number[] = [];
  for (let y = LINE_STEP; y < LINES_VIEWBOX.height; y += LINE_STEP) lines.push(y);

  return (
    <>
      <div role="toolbar" aria-label={strings.answerPad.tools} className="answer-pad__tools">
        <IconButton className="pencil-tool" icon={TOOL_ICONS.pencil} aria-label={strings.answerPad.pencil} pressed={padTool === 'pencil'} onClick={() => setPadTool('pencil')} />
        <IconButton className="pencil-tool" icon={TOOL_ICONS.eraser} aria-label={strings.answerPad.eraser} pressed={padTool === 'eraser'} onClick={() => setPadTool('eraser')} />
        <IconButton className="pencil-tool" icon={ACTION_ICONS.undo} aria-label={strings.answerPad.undo} disabled={!canUndo} onClick={() => usePencilStore.getState().undo()} />
        <IconButton className="pencil-tool" icon={ACTION_ICONS.redo} aria-label={strings.answerPad.redo} disabled={!canRedo} onClick={() => usePencilStore.getState().redo()} />
        <IconButton className="pencil-tool" icon={ACTION_ICONS.clear} aria-label={strings.answerPad.clear} disabled={annotations.length === 0} onClick={() => setConfirmClear(true)} />
        <IconButton
          className="pencil-tool"
          icon={ACTION_ICONS.finger}
          aria-label={strings.answerPad.fingerDraws}
          pressed={fingerDraws}
          onClick={() => usePencilStore.getState().setFingerDraws(!fingerDraws)}
        />
      </div>
      <div ref={boxRef} className="answer-pad__box" role="img" aria-label={strings.answerPad.drawArea}>
        <svg className="answer-pad__lines" viewBox={`0 0 ${LINES_VIEWBOX.width} ${LINES_VIEWBOX.height}`} preserveAspectRatio="none" aria-hidden="true" focusable="false">
          <line className="answer-pad__margin" x1={LINE_STEP} y1={0} x2={LINE_STEP} y2={LINES_VIEWBOX.height} vectorEffect="non-scaling-stroke" />
          {lines.map((y) => (
            <line key={y} x1={0} y1={y} x2={LINES_VIEWBOX.width} y2={y} vectorEffect="non-scaling-stroke" />
          ))}
        </svg>
        <svg ref={svgRef} className="ink-layer__svg" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
          <g key={epoch}>
            {strokes.map((s) => (
              <path key={s.id} data-ink-id={s.id} d={s.path} fill={s.annotation.color} opacity={s.annotation.opacity} />
            ))}
          </g>
          <path ref={liveRef} className="ink-layer__live" d="" />
          <circle ref={cursorRef} className="ink-layer__cursor" cx="0" cy="0" r="0" visibility="hidden" />
        </svg>
      </div>
      <p className="pencil-hint">{strings.answerPad.drawHint}</p>
      <ConfirmDialog
        open={confirmClear}
        title={strings.answerPad.clearTitle}
        message={strings.answerPad.clearMessage}
        confirmLabel={strings.answerPad.clearConfirm}
        cancelLabel={strings.answerPad.clearCancel}
        tone="danger"
        onCancel={() => setConfirmClear(false)}
        onConfirm={async () => {
          try {
            await clearAnswerInk(exerciseId, questionId, childId);
          } catch {
            toast.error(strings.errors.eraseFailed);
          }
          setConfirmClear(false);
        }}
      />
    </>
  );
}
