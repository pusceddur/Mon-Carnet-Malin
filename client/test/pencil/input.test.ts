import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { attachPencilInput, PALM_CONTACT_PX, type InputMode, type PencilInputConfig, type PencilInputHandle } from '../../src/pencil/input';
import { dispatchStroke, pointerEvent, touchEvent } from './helpers';

interface Harness {
  el: HTMLElement;
  handle: PencilInputHandle;
  cfg: PencilInputConfig;
  events: string[];
  moves: { x: number; kind: string; pressure: number }[];
  setMode(m: InputMode): void;
  setFingerDraws(v: boolean): void;
  advance(ms: number): void;
}

function setup(options: { mode?: InputMode; fingerDraws?: boolean; refuse?: boolean } = {}): Harness {
  const el = document.createElement('div');
  document.body.appendChild(el);
  let mode: InputMode = options.mode ?? 'annotation';
  let fingerDraws = options.fingerDraws ?? false;
  let now = 1000;
  const events: string[] = [];
  const moves: Harness['moves'] = [];
  const cfg: PencilInputConfig = {
    mode: () => mode,
    fingerDraws: () => fingerDraws,
    onPenDetected: () => events.push('pen-detected'),
    onStart: (s) => {
      events.push(`start:${s.kind}`);
      return !options.refuse;
    },
    onMove: (samples) => {
      for (const s of samples) moves.push({ x: s.clientX, kind: s.kind, pressure: s.pressure });
    },
    onEnd: (reason) => events.push(`end:${reason}`),
    onAbort: () => events.push('abort'),
    onHover: (s) => events.push(s ? 'hover' : 'hover-end'),
    now: () => now,
  };
  const handle = attachPencilInput(el, cfg);
  return {
    el, handle, cfg, events, moves,
    setMode: (m) => { mode = m; },
    setFingerDraws: (v) => { fingerDraws = v; },
    advance: (ms) => { now += ms; },
  };
}

const pts = (n: number, y = 10): { x: number; y: number }[] => Array.from({ length: n }, (_, i) => ({ x: 10 + i * 5, y }));

describe('pencil input policy', () => {
  let h: Harness;

  afterEach(() => {
    h?.handle.detach();
    document.body.innerHTML = '';
  });

  describe('pen', () => {
    beforeEach(() => {
      h = setup();
    });

    it('draws between pointerdown and pointerup of the same pointer and reports the first pen once', () => {
      dispatchStroke(h.el, pts(4), { pointerType: 'pen', pointerId: 7 });
      dispatchStroke(h.el, pts(3), { pointerType: 'pen', pointerId: 8 });
      expect(h.events).toEqual(['pen-detected', 'start:pen', 'end:up', 'start:pen', 'end:up']);
      expect(h.moves.filter((m) => m.kind === 'pen')).toHaveLength(5);
      expect(h.moves[0]?.pressure).toBe(0.5);
    });

    it('ignores moves and ups of another pointer during a stroke', () => {
      h.el.dispatchEvent(pointerEvent('pointerdown', { pointerType: 'pen', pointerId: 1, clientX: 0, clientY: 0 }));
      h.el.dispatchEvent(pointerEvent('pointermove', { pointerType: 'mouse', pointerId: 2, clientX: 50, clientY: 0 }));
      h.el.dispatchEvent(pointerEvent('pointerup', { pointerType: 'mouse', pointerId: 2 }));
      expect(h.moves).toHaveLength(0);
      expect(h.events).toEqual(['pen-detected', 'start:pen']);
      expect(h.handle.isDrawing()).toBe(true);
    });

    it('uses coalesced events when the browser provides them', () => {
      h.el.dispatchEvent(pointerEvent('pointerdown', { pointerType: 'pen', clientX: 0, clientY: 0 }));
      const move = pointerEvent('pointermove', { pointerType: 'pen', clientX: 30, clientY: 0 });
      const coalesced = [10, 20, 30].map((x) => pointerEvent('pointermove', { pointerType: 'pen', clientX: x, clientY: 0, pressure: 0.2 }));
      Object.defineProperty(move, 'getCoalescedEvents', { value: () => coalesced });
      h.el.dispatchEvent(move);
      expect(h.moves.map((m) => m.x)).toEqual([10, 20, 30]);
      expect(h.moves[0]?.pressure).toBe(0.2);
    });

    it('commits on pointercancel with at least 2 points, discards a single point', () => {
      dispatchStroke(h.el, pts(3), { pointerType: 'pen', end: 'pointercancel' });
      dispatchStroke(h.el, pts(1), { pointerType: 'pen', end: 'pointercancel' });
      expect(h.events).toEqual(['pen-detected', 'start:pen', 'end:cancel', 'start:pen', 'abort']);
    });

    it('does not start when the surface refuses the stroke (page eraser confirmation)', () => {
      h.handle.detach();
      h = setup({ refuse: true });
      dispatchStroke(h.el, pts(3), { pointerType: 'pen' });
      expect(h.events).toEqual(['pen-detected', 'start:pen']);
      expect(h.handle.isDrawing()).toBe(false);
    });

    it('reports Apple Pencil hover (no button pressed) and counts it as pen detection', () => {
      h.el.dispatchEvent(pointerEvent('pointermove', { pointerType: 'pen', buttons: 0, pressure: 0, clientX: 5, clientY: 5 }));
      h.el.dispatchEvent(pointerEvent('pointerleave', { pointerType: 'pen', buttons: 0 }));
      expect(h.events).toEqual(['pen-detected', 'hover', 'hover-end']);
      expect(h.moves).toHaveLength(0);
    });
  });

  describe('finger and palm rejection', () => {
    it('ignores fingers by default (native scroll) and never prevents their touches', () => {
      h = setup();
      dispatchStroke(h.el, pts(4), { pointerType: 'touch' });
      expect(h.events).toEqual([]);
      const touch = touchEvent('touchstart', 'direct');
      h.el.dispatchEvent(touch);
      expect(touch.defaultPrevented).toBe(false);
    });

    it('draws with a finger when « Dessiner avec le doigt » is on', () => {
      h = setup({ fingerDraws: true });
      dispatchStroke(h.el, pts(4), { pointerType: 'touch' });
      expect(h.events).toEqual(['start:touch', 'end:up']);
    });

    it('ignores touch pointers and prevents every touch while the pen is active (and 500 ms after)', () => {
      h = setup({ fingerDraws: true });
      h.el.dispatchEvent(pointerEvent('pointerdown', { pointerType: 'pen', pointerId: 1, clientX: 0, clientY: 0 }));
      h.el.dispatchEvent(pointerEvent('pointerdown', { pointerType: 'touch', pointerId: 2, clientX: 90, clientY: 90 }));
      const during = touchEvent('touchstart', 'direct');
      h.el.dispatchEvent(during);
      expect(during.defaultPrevented).toBe(true);
      h.el.dispatchEvent(pointerEvent('pointerup', { pointerType: 'pen', pointerId: 1 }));

      h.advance(400);
      expect(h.handle.isPenActive()).toBe(true);
      dispatchStroke(h.el, pts(3), { pointerType: 'touch', pointerId: 3 });
      const soon = touchEvent('touchmove', 'direct');
      h.el.dispatchEvent(soon);
      expect(soon.defaultPrevented).toBe(true);

      h.advance(200);
      expect(h.handle.isPenActive()).toBe(false);
      dispatchStroke(h.el, pts(3), { pointerType: 'touch', pointerId: 4 });
      expect(h.events).toEqual(['pen-detected', 'start:pen', 'end:up', 'start:touch', 'end:up']);
    });

    it('discards a palm stroke when the pen touches the screen', () => {
      h = setup({ fingerDraws: true });
      h.el.dispatchEvent(pointerEvent('pointerdown', { pointerType: 'touch', pointerId: 5, clientX: 100, clientY: 100 }));
      h.el.dispatchEvent(pointerEvent('pointermove', { pointerType: 'touch', pointerId: 5, clientX: 110, clientY: 100 }));
      h.el.dispatchEvent(pointerEvent('pointerdown', { pointerType: 'pen', pointerId: 6, clientX: 10, clientY: 10 }));
      h.el.dispatchEvent(pointerEvent('pointerup', { pointerType: 'touch', pointerId: 5 }));
      expect(h.events).toEqual(['start:touch', 'pen-detected', 'abort', 'start:pen']);
    });

    it('ignores large contacts and aborts the stroke when a second finger arrives', () => {
      h = setup({ fingerDraws: true });
      h.el.dispatchEvent(pointerEvent('pointerdown', { pointerType: 'touch', pointerId: 1, width: PALM_CONTACT_PX + 20, height: 90 }));
      expect(h.events).toEqual([]);
      h.el.dispatchEvent(pointerEvent('pointerdown', { pointerType: 'touch', pointerId: 2, width: 20, height: 20 }));
      h.el.dispatchEvent(pointerEvent('pointerdown', { pointerType: 'touch', pointerId: 3, width: 20, height: 20 }));
      expect(h.events).toEqual(['start:touch', 'abort']);
    });

    it('prevents stylus touches (no scroll with the Pencil) in both modes', () => {
      for (const mode of ['annotation', 'lecture'] as const) {
        h = setup({ mode });
        const start = touchEvent('touchstart', 'stylus');
        const move = touchEvent('touchmove', 'stylus');
        h.el.dispatchEvent(start);
        h.el.dispatchEvent(move);
        expect(start.defaultPrevented).toBe(true);
        expect(move.defaultPrevented).toBe(true);
        h.handle.detach();
      }
    });
  });

  describe('mouse and lecture mode', () => {
    it('draws with the mouse (main button) only in annotation mode', () => {
      h = setup({ mode: 'lecture' });
      dispatchStroke(h.el, pts(3), { pointerType: 'mouse' });
      expect(h.events).toEqual([]);
      h.setMode('annotation');
      h.el.dispatchEvent(pointerEvent('pointerdown', { pointerType: 'mouse', button: 2 }));
      dispatchStroke(h.el, pts(3), { pointerType: 'mouse' });
      expect(h.events).toEqual(['start:mouse', 'end:up']);
    });

    it('turns a pen tap into a click on the element under the pen, a pen drag into nothing', () => {
      h = setup({ mode: 'lecture' });
      const word = document.createElement('span');
      word.className = 'rp-w';
      h.el.appendChild(word);
      const onClick = vi.fn();
      word.addEventListener('click', onClick);
      const elementFromPoint = vi.spyOn(document, 'elementFromPoint').mockReturnValue(word);

      dispatchStroke(h.el, [{ x: 20, y: 20 }, { x: 22, y: 21 }], { pointerType: 'pen' });
      expect(onClick).toHaveBeenCalledTimes(1);
      expect(onClick.mock.calls[0]?.[0]).toMatchObject({ clientX: 22, clientY: 21 });

      dispatchStroke(h.el, [{ x: 20, y: 20 }, { x: 80, y: 20 }], { pointerType: 'pen' });
      expect(onClick).toHaveBeenCalledTimes(1);
      expect(h.events).toEqual(['pen-detected']);
      expect(h.moves).toHaveLength(0);

      elementFromPoint.mockReturnValue(document.body);
      dispatchStroke(h.el, [{ x: 20, y: 20 }], { pointerType: 'pen' });
      expect(onClick).toHaveBeenCalledTimes(1);
      elementFromPoint.mockRestore();
    });

    it('stops listening after detach and aborts the stroke in progress', () => {
      h = setup();
      h.el.dispatchEvent(pointerEvent('pointerdown', { pointerType: 'pen', clientX: 0, clientY: 0 }));
      h.handle.detach();
      dispatchStroke(h.el, pts(3), { pointerType: 'pen', pointerId: 9 });
      expect(h.events).toEqual(['pen-detected', 'start:pen', 'abort']);
      const touch = touchEvent('touchstart', 'stylus');
      h.el.dispatchEvent(touch);
      expect(touch.defaultPrevented).toBe(false);
    });
  });
});
