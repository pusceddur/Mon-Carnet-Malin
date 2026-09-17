// Pencil / finger / mouse input policy (contract C2, §15.7), attached to one container element.
//
// - Pointer Events + pointer capture draw; non-passive touchstart/touchmove only on the container.
// - A Safari touch with touchType 'stylus' never scrolls (preventDefault); a finger scrolls natively.
// - penActive = from the pen pointerdown until 500 ms after its pointerup: every touch of the container is prevented and
//   touch pointers are ignored for drawing (palm rejection). A palm stroke started before the pen is discarded.
// - First pen detected ⇒ onPenDetected (the store turns « Dessiner avec le doigt » off).
// - A stroke lives between pointerdown and pointerup/pointercancel of the same pointerId; pointercancel commits when the
//   stroke has at least 2 points, otherwise it is discarded.
// - Lecture mode: a pen tap is delivered as a click on the element under the pen; a pen drag neither scrolls nor draws.
// - Mouse draws only in annotation mode. Fingers draw only in annotation mode with fingerDraws.
import { TIMINGS } from '@aide/shared';
import { pointerPressure, pointerSamples } from './DrawingEngine';
import type { PointerKind } from './Tools';

export type InputMode = 'lecture' | 'annotation';

export interface InputSample {
  clientX: number;
  clientY: number;
  pressure: number;
  kind: PointerKind;
  /** Contact size (touch), 0 when unknown. */
  width: number;
  height: number;
}

export interface PencilInputConfig {
  mode(): InputMode;
  fingerDraws(): boolean;
  /** Called once per attachment, on the first pen contact or hover. */
  onPenDetected(): void;
  /** Stroke start. Return false to refuse the stroke (e.g. the page eraser opens a confirmation instead). */
  onStart(sample: InputSample): boolean;
  onMove(samples: InputSample[]): void;
  /** Stroke finished and to be committed. */
  onEnd(reason: 'up' | 'cancel'): void;
  /** Stroke discarded (palm, second finger, cancel with fewer than 2 points, detach). */
  onAbort(): void;
  /** Pen hovering above the screen (Apple Pencil hover), null when it leaves. */
  onHover?(sample: InputSample | null): void;
  /** Lecture mode pen tap. Default: dispatches a click on the element under the pen. */
  onPenTap?(sample: InputSample, target: Element | null): void;
  now?: () => number;
  graceMs?: number;
}

export interface PencilInputHandle {
  detach(): void;
  isPenActive(): boolean;
  isDrawing(): boolean;
}

/** A finger contact larger than this (CSS px) is treated as a palm. */
export const PALM_CONTACT_PX = 80;
/** A pen moving more than this during a lecture-mode contact is a drag, not a tap. */
export const TAP_SLOP_PX = 10;

interface SafariTouch extends Touch {
  touchType?: 'stylus' | 'direct';
}

function toKind(pointerType: string): PointerKind {
  return pointerType === 'pen' || pointerType === 'touch' ? pointerType : 'mouse';
}

function toSample(e: PointerEvent, kind: PointerKind): InputSample {
  return {
    clientX: e.clientX,
    clientY: e.clientY,
    pressure: pointerPressure(e.pointerType, e.pressure),
    kind,
    width: Number.isFinite(e.width) ? e.width : 0,
    height: Number.isFinite(e.height) ? e.height : 0,
  };
}

export function hasStylusTouch(e: TouchEvent): boolean {
  const lists = [e.changedTouches, e.touches];
  for (const list of lists) {
    if (!list) continue;
    for (let i = 0; i < list.length; i++) {
      const touch = (list[i] ?? (typeof list.item === 'function' ? list.item(i) : null)) as SafariTouch | null;
      if (touch?.touchType === 'stylus') return true;
    }
  }
  return false;
}

export function attachPencilInput(el: HTMLElement, cfg: PencilInputConfig): PencilInputHandle {
  const now = cfg.now ?? (() => Date.now());
  const graceMs = cfg.graceMs ?? TIMINGS.penActiveGraceMs;

  let penDetected = false;
  let penDown = false;
  let penPointerId: number | null = null;
  let lastPenActivityAt = -Infinity;
  let active: { pointerId: number; kind: PointerKind; count: number } | null = null;
  let tap: { pointerId: number; x: number; y: number; moved: boolean } | null = null;
  let hovering = false;

  const isPenActive = (): boolean => penDown || now() - lastPenActivityAt < graceMs;

  const detectPen = (): void => {
    if (penDetected) return;
    penDetected = true;
    cfg.onPenDetected();
  };

  const capture = (pointerId: number): void => {
    try {
      if (typeof el.setPointerCapture === 'function') el.setPointerCapture(pointerId);
    } catch {
      // The pointer may already be gone.
    }
  };

  const release = (pointerId: number): void => {
    try {
      if (typeof el.hasPointerCapture === 'function' && el.hasPointerCapture(pointerId)) el.releasePointerCapture(pointerId);
    } catch {
      // Ignore.
    }
  };

  const abortActive = (): void => {
    if (!active) return;
    const id = active.pointerId;
    active = null;
    release(id);
    cfg.onAbort();
  };

  const start = (e: PointerEvent, kind: PointerKind): void => {
    if (!cfg.onStart(toSample(e, kind))) return;
    active = { pointerId: e.pointerId, kind, count: 1 };
    capture(e.pointerId);
    if (kind === 'mouse') e.preventDefault();
  };

  const setHover = (sample: InputSample | null): void => {
    if (sample === null && !hovering) return;
    hovering = sample !== null;
    cfg.onHover?.(sample);
  };

  const onPointerDown = (e: PointerEvent): void => {
    const kind = toKind(e.pointerType);
    if (kind === 'pen') {
      detectPen();
      penDown = true;
      penPointerId = e.pointerId;
      lastPenActivityAt = now();
      setHover(null);
      if (active && active.kind === 'touch') abortActive();
      if (active) return;
      if (cfg.mode() === 'annotation') start(e, kind);
      else tap = { pointerId: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
      return;
    }
    if (kind === 'touch') {
      if (isPenActive()) return;
      if (active) {
        // Second finger: the user wants to scroll or zoom, not to draw.
        if (active.kind === 'touch') abortActive();
        return;
      }
      if (cfg.mode() !== 'annotation' || !cfg.fingerDraws()) return;
      if (e.width > PALM_CONTACT_PX || e.height > PALM_CONTACT_PX) return;
      start(e, kind);
      return;
    }
    if (active || cfg.mode() !== 'annotation' || e.button !== 0) return;
    start(e, kind);
  };

  const onPointerMove = (e: PointerEvent): void => {
    const kind = toKind(e.pointerType);
    if (kind === 'pen') {
      if (penDown) lastPenActivityAt = now();
      else if (e.buttons === 0 && (!active || active.pointerId !== e.pointerId)) {
        detectPen();
        setHover(toSample(e, kind));
      }
    }
    if (tap && tap.pointerId === e.pointerId && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) > TAP_SLOP_PX) tap.moved = true;
    if (!active || active.pointerId !== e.pointerId) return;
    const samples = pointerSamples(e).map((s) => toSample(s, active!.kind));
    active.count += samples.length;
    cfg.onMove(samples);
  };

  const finishPen = (e: PointerEvent): void => {
    if (toKind(e.pointerType) !== 'pen' || e.pointerId !== penPointerId) return;
    penDown = false;
    penPointerId = null;
    lastPenActivityAt = now();
  };

  const onPointerUp = (e: PointerEvent): void => {
    finishPen(e);
    if (active && active.pointerId === e.pointerId) {
      active = null;
      release(e.pointerId);
      cfg.onEnd('up');
    }
    if (tap && tap.pointerId === e.pointerId) {
      const wasTap = !tap.moved && cfg.mode() === 'lecture';
      tap = null;
      if (wasTap) {
        const sample = toSample(e, 'pen');
        const target = typeof document.elementFromPoint === 'function' ? document.elementFromPoint(e.clientX, e.clientY) : null;
        const inside = target && el.contains(target) ? target : null;
        if (cfg.onPenTap) cfg.onPenTap(sample, inside);
        else if (inside) {
          inside.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: e.clientX, clientY: e.clientY, view: window }));
        }
      }
    }
  };

  const onPointerCancel = (e: PointerEvent): void => {
    finishPen(e);
    if (tap && tap.pointerId === e.pointerId) tap = null;
    if (!active || active.pointerId !== e.pointerId) return;
    const enough = active.count >= 2;
    active = null;
    release(e.pointerId);
    if (enough) cfg.onEnd('cancel');
    else cfg.onAbort();
  };

  const onPointerLeave = (e: PointerEvent): void => {
    if (toKind(e.pointerType) === 'pen' && !penDown) setHover(null);
  };

  const onTouch = (e: TouchEvent): void => {
    if (hasStylusTouch(e)) {
      lastPenActivityAt = Math.max(lastPenActivityAt, now());
      if (e.cancelable) e.preventDefault();
      return;
    }
    if (!e.cancelable) return;
    if (isPenActive() || (active !== null && active.kind === 'touch')) e.preventDefault();
  };

  const touchOptions: AddEventListenerOptions = { passive: false };
  el.addEventListener('pointerdown', onPointerDown);
  el.addEventListener('pointermove', onPointerMove);
  el.addEventListener('pointerup', onPointerUp);
  el.addEventListener('pointercancel', onPointerCancel);
  el.addEventListener('pointerleave', onPointerLeave);
  el.addEventListener('touchstart', onTouch, touchOptions);
  el.addEventListener('touchmove', onTouch, touchOptions);

  return {
    detach: () => {
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerup', onPointerUp);
      el.removeEventListener('pointercancel', onPointerCancel);
      el.removeEventListener('pointerleave', onPointerLeave);
      el.removeEventListener('touchstart', onTouch, touchOptions);
      el.removeEventListener('touchmove', onTouch, touchOptions);
      if (active) abortActive();
      tap = null;
    },
    isPenActive,
    isDrawing: () => active !== null,
  };
}
