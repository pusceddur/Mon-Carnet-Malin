// §19.2 « Zones de texte » on the original page: the child types (keyboard on screen or physical), dictates or writes with
// Scribble in boxes placed on the page. Place and size are fractions of the page image, like the ink of the original view,
// so the boxes follow the zoom.
import {
  DEFAULT_PARENT_SETTINGS, TEXT_BOX_FONT_SIZE, TEXT_BOX_MAX_CHARS, type Id, type TextBoxAnnotation, type WritingChange, type WritingChangeKind,
} from '@aide/shared';
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type JSX,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react';
import { requestAI } from '../ai/aiClient';
import { IconButton, useToast } from '../design/components';
import { format } from '../i18n/fr';
import { pencil as strings } from '../i18n/fr/pencil';
import { useOnlineStatus } from '../platform/online';
import { useSessionStore } from '../state/session';
import { speechEngine } from '../tts/SpeechEngine';
import { addTextBox, finishTextBox, removeAnnotation, updateTextBox, useTextBoxes, type TextBoxPatch } from './AnnotationStore';
import './pencil.css';

const s = strings.textBox;

/** Blue (like a school pen), black, red, green. */
export const TEXT_BOX_COLORS = ['#1d4ed8', '#111827', '#b91c1c', '#15803d'] as const;
export const TEXT_BOX_DEFAULT_WIDTH = 0.45;
export const TEXT_BOX_MIN_WIDTH = 0.08;
const TAP_SLOP_PX = 10;
const SAVE_DELAY_MS = 400;
const FONT_STEP = 1.2;
const LINE_HEIGHT = 1.3;

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

/**
 * « J'ai corrigé 3 petites fautes (accents, ponctuation). »
 *
 * §24: when the construction of a sentence changed — the wrong auxiliary put right — the child is told so in a
 * sentence of its own. Everything else is a word written better; this one is a sentence built differently, and a
 * child rereading their own text should know which of the two happened.
 */
export function correctionMessage(changes: readonly WritingChange[]): string {
  const kinds: WritingChangeKind[] = [];
  for (const change of changes) if (!kinds.includes(change.kind)) kinds.push(change.kind);
  const list = kinds.map((k) => s.kinds[k]).join(', ');
  const counted = changes.length === 1
    ? format(s.correctedOne, { kinds: list })
    : format(s.correctedMany, { count: changes.length, kinds: list });

  const rebuilt = changes.filter((change) => change.kind === 'construction').length;
  if (rebuilt === 0) return counted;
  const said = rebuilt === 1 ? s.correctedConstruction : format(s.correctedConstructionMany, { count: rebuilt });
  return `${counted} ${said}`;
}

/** §24 « Corriger »: switched on in the Options (default on) and the help of the AI on. */
function useCorrectionAvailable(): boolean {
  const online = useOnlineStatus();
  const allowed = useSessionStore((st) => {
    const ai = (st.parentSettings ?? DEFAULT_PARENT_SETTINGS).ai;
    return ai.enabled && ai.features.correctWriting !== false;
  });
  return online && allowed;
}

export interface TextBoxLayerProps {
  documentId: Id;
  childId: Id;
  pageIndex: number;
  /** The page frame: places and sizes are fractions of it. */
  frameRef: RefObject<HTMLElement | null>;
  /** Width of the frame in px (font size). */
  frameWidth: number;
  /** « Écrire du texte » on: a tap on the page adds a box; boxes are edited, moved, resized. */
  editing: boolean;
  /** Reading mode: a tap on a box reads it aloud. Off while drawing, so that the ink passes through. */
  readable: boolean;
}

export function TextBoxLayer({ documentId, childId, pageIndex, frameRef, frameWidth, editing, readable }: TextBoxLayerProps): JSX.Element {
  const boxes = useTextBoxes(documentId, childId, pageIndex);
  const [selectedId, setSelectedId] = useState<Id | null>(null);
  const tap = useRef<{ id: number; x: number; y: number } | null>(null);
  // iPadOS only opens the keyboard for a field focused during the tap: this one holds it until the new box exists.
  const keyboardHolder = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!editing) setSelectedId(null);
  }, [editing]);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    tap.current = editing && event.target === event.currentTarget ? { id: event.pointerId, x: event.clientX, y: event.clientY } : null;
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const start = tap.current;
    tap.current = null;
    if (!editing || !start || start.id !== event.pointerId || event.target !== event.currentTarget) return;
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > TAP_SLOP_PX) return;
    // A tap next to the box being written closes it; the next tap adds a new box.
    if (selectedId !== null) {
      setSelectedId(null);
      return;
    }
    const frame = frameRef.current?.getBoundingClientRect();
    if (!frame || frame.width === 0 || frame.height === 0) return;
    keyboardHolder.current?.focus({ preventScroll: true });
    const fontSize = TEXT_BOX_FONT_SIZE.default;
    const line = (fontSize * frame.width * LINE_HEIGHT) / frame.height;
    const x = clamp((event.clientX - frame.left) / frame.width, 0, 1 - TEXT_BOX_MIN_WIDTH);
    const y = clamp((event.clientY - frame.top) / frame.height - line / 2, 0, Math.max(0, 1 - line));
    void addTextBox({
      documentId, childId, pageIndex, x, y, width: Math.min(TEXT_BOX_DEFAULT_WIDTH, 1 - x), fontSize, color: TEXT_BOX_COLORS[0], text: '',
    }).then(
      (box) => setSelectedId(box.id),
      () => keyboardHolder.current?.blur(),
    );
  };

  return (
    <div
      className={`tb-layer${editing ? ' tb-layer--editing' : ''}`}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={() => {
        tap.current = null;
      }}
    >
      {editing && <textarea ref={keyboardHolder} className="tb-keyboard-holder" tabIndex={-1} aria-hidden="true" readOnly />}
      {boxes.map((box) => (
        <TextBox
          key={box.id}
          box={box}
          frameRef={frameRef}
          frameWidth={frameWidth}
          editing={editing}
          readable={readable && !editing}
          selected={selectedId === box.id}
          onSelect={setSelectedId}
        />
      ))}
    </div>
  );
}

interface TextBoxProps {
  box: TextBoxAnnotation;
  frameRef: RefObject<HTMLElement | null>;
  frameWidth: number;
  editing: boolean;
  readable: boolean;
  /** Being written: toolbar shown, text field focused. */
  selected: boolean;
  onSelect(id: Id | null): void;
}

type Place = Pick<TextBoxAnnotation, 'x' | 'y' | 'width'>;
/** `place`: where the box is now (kept here too: the lift of the finger may come before the next render). */
type Drag = { kind: 'move' | 'resize'; pointerId: number; startX: number; startY: number; frame: DOMRect; box: Place; place: Place | null };

function TextBox({ box, frameRef, frameWidth, editing, readable, selected, onSelect }: TextBoxProps): JSX.Element {
  const [draft, setDraft] = useState(box.text);
  const [place, setPlace] = useState<Place | null>(null);
  const input = useRef<HTMLTextAreaElement | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(box.text);
  const drag = useRef<Drag | null>(null);
  const toast = useToast();
  const canCorrect = useCorrectionAvailable();
  const [correcting, setCorrecting] = useState(false);

  const flush = (): void => {
    if (saveTimer.current === null) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = null;
    void updateTextBox(box.id, { text: latest.current });
  };

  // A dragged place is shown until the saved box has it (no jump back while the save goes through).
  useEffect(() => {
    if (!drag.current) setPlace(null);
  }, [box.x, box.y, box.width]);

  // Text changed elsewhere (another device, undo) while this box is not being typed in.
  useEffect(() => {
    if (saveTimer.current === null && document.activeElement !== input.current) {
      latest.current = box.text;
      setDraft(box.text);
    }
  }, [box.text]);

  // Leaving the box (another box, a tap next to it, end of writing, another page): last text saved, or the empty box removed.
  const finish = (): void => {
    if (saveTimer.current !== null) clearTimeout(saveTimer.current);
    saveTimer.current = null;
    void finishTextBox(box.id, latest.current);
  };
  const wasSelected = useRef(selected);
  useEffect(() => {
    if (wasSelected.current && !selected) finish();
    wasSelected.current = selected;
  }, [selected]);
  useEffect(() => () => (wasSelected.current ? finish() : flush()), []);

  useEffect(() => {
    if (editing && selected && document.activeElement !== input.current) input.current?.focus({ preventScroll: true });
  }, [editing, selected]);

  // The field grows with its text.
  useLayoutEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [draft, frameWidth, box.fontSize, box.width, place, editing]);

  const change = (text: string): void => {
    latest.current = text;
    setDraft(text);
    if (saveTimer.current !== null) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(flush, SAVE_DELAY_MS);
  };

  /** Size, place or colour, saved together with the text typed so far. */
  const patch = (next: TextBoxPatch): void => {
    if (saveTimer.current !== null) clearTimeout(saveTimer.current);
    saveTimer.current = null;
    void updateTextBox(box.id, { text: latest.current, ...next });
  };

  const startDrag = (kind: Drag['kind'], event: ReactPointerEvent<HTMLElement>): void => {
    const frame = frameRef.current?.getBoundingClientRect();
    if (!frame || frame.width === 0 || frame.height === 0) return;
    event.preventDefault();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Without capture the drag still follows the pointer while it stays on the handle.
    }
    const current = place ?? box;
    drag.current = {
      kind, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, frame, box: { x: current.x, y: current.y, width: current.width }, place: null,
    };
  };

  const moveDrag = (event: ReactPointerEvent<HTMLElement>): void => {
    const d = drag.current;
    if (!d || d.pointerId !== event.pointerId) return;
    const dx = (event.clientX - d.startX) / d.frame.width;
    const dy = (event.clientY - d.startY) / d.frame.height;
    d.place = d.kind === 'move'
      ? { x: clamp(d.box.x + dx, 0, 1 - d.box.width), y: clamp(d.box.y + dy, 0, 0.98), width: d.box.width }
      : { x: d.box.x, y: d.box.y, width: clamp(d.box.width + dx, TEXT_BOX_MIN_WIDTH, 1 - d.box.x) };
    setPlace(d.place);
  };

  const endDrag = (event: ReactPointerEvent<HTMLElement>): void => {
    const d = drag.current;
    if (!d || d.pointerId !== event.pointerId) return;
    drag.current = null;
    if (!d.place) return;
    patch(d.kind === 'move' ? { x: d.place.x, y: d.place.y } : { width: d.place.width });
  };

  const dragHandlers = (kind: Drag['kind']) => ({
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => startDrag(kind, event),
    onPointerMove: moveDrag,
    onPointerUp: endDrag,
    onPointerCancel: endDrag,
  });

  /** New text from outside the keyboard (correction, undo), saved at once. */
  const replaceText = (text: string): void => {
    if (saveTimer.current !== null) clearTimeout(saveTimer.current);
    saveTimer.current = null;
    latest.current = text;
    setDraft(text);
    void updateTextBox(box.id, { text });
  };

  // §24 the text is corrected in place (same lines, same words written better); the adult sees the corrections in Activité.
  const correct = async (): Promise<void> => {
    const text = latest.current;
    if (correcting || text.trim() === '') return;
    flush();
    setCorrecting(true);
    try {
      const result = await requestAI('correct_writing', {
        childId: box.childId, documentId: box.documentId, documentHash: null, text, annotationId: box.id, pageIndex: box.pageIndex,
      });
      if (result.status !== 'ok') {
        toast.info(result.message);
        return;
      }
      if (latest.current !== text) {
        toast.info(s.correctChanged);
        return;
      }
      const corrected = result.data.correctedText;
      if (result.data.changes.length === 0 || corrected === text) {
        toast.success(s.correctNone);
        return;
      }
      replaceText(corrected);
      toast.show({
        tone: 'success',
        message: correctionMessage(result.data.changes),
        durationMs: 10_000,
        action: {
          label: s.undo,
          onClick: () => {
            if (latest.current === corrected) replaceText(text);
          },
        },
      });
    } finally {
      setCorrecting(false);
    }
  };

  const read = (): void => {
    const text = latest.current.trim();
    if (text) speechEngine.speakOnce(text);
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      flush();
      input.current?.blur();
      onSelect(null);
    }
  };

  const { x, y, width } = place ?? box;
  const className = ['tb-box', selected && editing ? 'tb-box--selected' : '', readable ? 'tb-box--readable' : ''].filter(Boolean).join(' ');
  // Tool buttons keep the focus in the text field (the keyboard stays open on iPad).
  const keepFocus = { onMouseDown: (event: { preventDefault(): void }) => event.preventDefault() };
  const colorIndex = TEXT_BOX_COLORS.indexOf(box.color as (typeof TEXT_BOX_COLORS)[number]);

  return (
    <div
      className={className}
      style={{ left: `${x * 100}%`, top: `${y * 100}%`, width: `${width * 100}%`, fontSize: `${box.fontSize * frameWidth}px`, color: box.color }}
      onPointerDown={() => {
        if (editing && !selected) onSelect(box.id);
      }}
    >
      {editing ? (
        <textarea
          ref={input}
          className="tb-box__input"
          aria-label={s.label}
          value={draft}
          rows={1}
          maxLength={TEXT_BOX_MAX_CHARS}
          placeholder={s.placeholder}
          lang="fr"
          autoCapitalize="sentences"
          autoCorrect="on"
          spellCheck
          onFocus={() => onSelect(box.id)}
          onChange={(event) => change(event.target.value)}
          onBlur={flush}
          onKeyDown={onKeyDown}
        />
      ) : readable && box.text.trim() ? (
        <button type="button" className="tb-box__text" aria-label={format(s.listen, { text: box.text })} onClick={read}>
          {box.text}
        </button>
      ) : (
        <div className="tb-box__text">{box.text}</div>
      )}
      {editing && selected && (
        <>
          <div className="tb-box__tools" role="toolbar" aria-label={s.tools}>
            <IconButton size="parent" icon="🔊" aria-label={s.read} disabled={draft.trim() === ''} onClick={read} {...keepFocus} />
            {canCorrect && (
              <IconButton
                size="parent"
                icon="✨"
                aria-label={correcting ? s.correcting : s.correct}
                loading={correcting}
                disabled={draft.trim() === ''}
                onClick={() => void correct()}
                {...keepFocus}
              />
            )}
            <IconButton
              size="parent"
              icon="A−"
              aria-label={s.smaller}
              disabled={box.fontSize <= TEXT_BOX_FONT_SIZE.min}
              onClick={() => patch({ fontSize: clamp(box.fontSize / FONT_STEP, TEXT_BOX_FONT_SIZE.min, TEXT_BOX_FONT_SIZE.max) })}
              {...keepFocus}
            />
            <IconButton
              size="parent"
              icon="A+"
              aria-label={s.bigger}
              disabled={box.fontSize >= TEXT_BOX_FONT_SIZE.max}
              onClick={() => patch({ fontSize: clamp(box.fontSize * FONT_STEP, TEXT_BOX_FONT_SIZE.min, TEXT_BOX_FONT_SIZE.max) })}
              {...keepFocus}
            />
            <IconButton
              size="parent"
              icon={<span className="tb-box__swatch" style={{ backgroundColor: box.color }} />}
              aria-label={s.color}
              onClick={() => patch({ color: TEXT_BOX_COLORS[(colorIndex + 1) % TEXT_BOX_COLORS.length]! })}
              {...keepFocus}
            />
            <IconButton size="parent" className="tb-box__move" icon="✥" aria-label={s.move} {...dragHandlers('move')} {...keepFocus} />
            <IconButton
              size="parent"
              icon="🗑️"
              aria-label={s.remove}
              onClick={() => {
                flush();
                onSelect(null);
                void removeAnnotation(box.id);
              }}
              {...keepFocus}
            />
            <IconButton
              size="parent"
              icon="✓"
              aria-label={s.done}
              onClick={() => {
                flush();
                input.current?.blur();
                onSelect(null);
              }}
              {...keepFocus}
            />
          </div>
          <button type="button" className="tb-box__resize" aria-label={s.resize} {...dragHandlers('resize')} {...keepFocus} />
        </>
      )}
    </div>
  );
}
