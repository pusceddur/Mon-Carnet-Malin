// Test helpers for the pencil module: simulated reader layout (mocked DOM rects), rendering, pointer events.
import { normalizeForMatch, sha256HexSync, tokenizeWords, type PageContent } from '@aide/shared';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

export interface RectLike { left: number; top: number; width: number; height: number }

export function domRect({ left, top, width, height }: RectLike): DOMRect {
  return {
    x: left, y: top, left, top, width, height, right: left + width, bottom: top + height,
    toJSON: () => ({}),
  } as DOMRect;
}

export function mockRect(el: Element, rect: RectLike | (() => RectLike)): void {
  Object.defineProperty(el, 'getBoundingClientRect', {
    configurable: true,
    value: () => domRect(typeof rect === 'function' ? rect() : rect),
  });
}

export interface FlowOptions {
  fontSize: number;
  /** Column width in em. */
  columnEm: number;
  lineHeight: number;
  /** Width of one character in em (monospace approximation). */
  charEm?: number;
  /** Extra space between words in em. */
  spaceEm?: number;
  /** Left/top of the column inside the surface (px). */
  left?: number;
  top?: number;
}

export interface FlowWord { o: number; text: string; rect: RectLike; line: number }
export interface FlowBlock { blockIndex: number; text: string; fontSize: number; words: FlowWord[]; bottom: number }

/** Lays out blocks of text like a browser would (greedy line breaking), one block after the other. */
export function flowBlocks(texts: readonly string[], options: FlowOptions): FlowBlock[] {
  const { fontSize, columnEm, lineHeight, charEm = 0.5, spaceEm = 0.3, left = 40, top = 30 } = options;
  const column = columnEm * fontSize;
  const pitch = lineHeight * fontSize;
  const height = fontSize * 1.2;
  let y = top;
  let lineNumber = 0;
  return texts.map((text, blockIndex) => {
    let x = 0;
    const words: FlowWord[] = [];
    for (const token of tokenizeWords(text)) {
      const width = token.word.length * charEm * fontSize;
      if (x > 0 && x + width > column) {
        x = 0;
        y += pitch;
        lineNumber++;
      }
      words.push({ o: token.start, text: token.word, rect: { left: left + x, top: y + (pitch - height) / 2, width, height }, line: lineNumber });
      x += width + spaceEm * fontSize;
    }
    const block = { blockIndex, text, fontSize, words, bottom: y + pitch };
    y += pitch * 1.5;
    lineNumber++;
    return block;
  });
}

export function hashOf(text: string): string {
  return sha256HexSync(normalizeForMatch(text));
}

/** Builds `.rp-page > .rp-block > .rp-w` markup with mocked rects (surface origin at 0,0). */
export function buildReaderDom(pageIndex: number, blocks: readonly FlowBlock[], root: HTMLElement = document.createElement('section')): HTMLElement {
  root.className = 'rp-page';
  root.setAttribute('data-page-index', String(pageIndex));
  root.innerHTML = '';
  for (const block of blocks) {
    const blockEl = document.createElement('div');
    blockEl.className = 'rp-block';
    blockEl.dataset.pageIndex = String(pageIndex);
    blockEl.dataset.blockIndex = String(block.blockIndex);
    blockEl.dataset.blockHash = hashOf(block.text);
    blockEl.style.fontSize = `${block.fontSize}px`;
    for (const word of block.words) {
      const w = document.createElement('span');
      w.className = 'rp-w';
      w.dataset.o = String(word.o);
      w.textContent = word.text;
      mockRect(w, word.rect);
      blockEl.appendChild(w);
      blockEl.appendChild(document.createTextNode(' '));
    }
    root.appendChild(blockEl);
  }
  // Computed styles (font size) need the element in the document.
  if (!root.isConnected) document.body.appendChild(root);
  return root;
}

export function pageContent(documentId: string, pageIndex: number, texts: readonly string[]): PageContent {
  return {
    documentId, pageIndex, status: 'ready', textSource: 'manual',
    blocks: texts.map((text) => ({ kind: 'paragraph' as const, text })),
    confidence: null, contentHash: null, width: null, height: null, warnings: [], updatedAt: 1,
  };
}

export function wordOf(blocks: readonly FlowBlock[], blockIndex: number, text: string, occurrence = 0): FlowWord {
  const found = blocks[blockIndex]?.words.filter((w) => w.text === text)[occurrence];
  if (!found) throw new Error(`word not found: ${text}`);
  return found;
}

// ---------------------------------------------------------------------------------------------------------------------

export interface Rendered {
  container: HTMLElement;
  rerender(ui: ReactElement): Promise<void>;
  unmount(): Promise<void>;
}

const roots = new Set<{ root: Root; container: HTMLElement }>();

export async function render(ui: ReactElement): Promise<Rendered> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const entry = { root, container };
  roots.add(entry);
  await act(async () => {
    root.render(ui);
  });
  return {
    container,
    rerender: async (next) => {
      await act(async () => {
        root.render(next);
      });
    },
    unmount: async () => {
      if (!roots.delete(entry)) return;
      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
  };
}

export async function cleanup(): Promise<void> {
  for (const entry of Array.from(roots)) {
    roots.delete(entry);
    await act(async () => {
      entry.root.unmount();
    });
    entry.container.remove();
  }
  document.body.innerHTML = '';
}

export async function click(el: Element | null | undefined): Promise<void> {
  if (!(el instanceof HTMLElement)) throw new Error('click: element not found');
  await act(async () => {
    el.click();
  });
}

export function buttonByLabel(label: string, root: ParentNode = document): HTMLButtonElement | null {
  return Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find((b) => (b.getAttribute('aria-label') ?? b.textContent ?? '').trim() === label) ?? null;
}

export type PointerType = 'pen' | 'touch' | 'mouse';

export function pointerEvent(type: string, init: PointerEventInit & { pointerType: PointerType }): PointerEvent {
  return new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, pressure: init.pointerType === 'pen' ? 0.4 : 0.5, buttons: 1, ...init });
}

/** Dispatches a full stroke (down, moves, up) along `points` (client coordinates). */
export function dispatchStroke(target: Element, points: readonly { x: number; y: number; p?: number }[], init: { pointerType: PointerType; pointerId?: number; end?: 'pointerup' | 'pointercancel' }): void {
  const [first, ...rest] = points;
  if (!first) return;
  const base = { pointerType: init.pointerType, pointerId: init.pointerId ?? 1 };
  target.dispatchEvent(pointerEvent('pointerdown', { ...base, clientX: first.x, clientY: first.y, pressure: first.p ?? 0.5 }));
  for (const p of rest) target.dispatchEvent(pointerEvent('pointermove', { ...base, clientX: p.x, clientY: p.y, pressure: p.p ?? 0.5 }));
  const last = points[points.length - 1]!;
  target.dispatchEvent(pointerEvent(init.end ?? 'pointerup', { ...base, clientX: last.x, clientY: last.y, pressure: 0, buttons: 0 }));
}

/** Touch event with Safari's `touchType` on its touches. */
export function touchEvent(type: 'touchstart' | 'touchmove', touchType: 'stylus' | 'direct'): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  const touches = [{ touchType, identifier: 1, clientX: 0, clientY: 0 }];
  Object.defineProperty(event, 'touches', { value: touches });
  Object.defineProperty(event, 'changedTouches', { value: touches });
  return event;
}

export function line(from: { x: number; y: number }, to: { x: number; y: number }, steps = 10, p = 0.5): { x: number; y: number; p: number }[] {
  const out: { x: number; y: number; p: number }[] = [];
  for (let i = 0; i <= steps; i++) out.push({ x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps, p });
  return out;
}

/** Polls `check` inside act() until it returns a value (liveQuery updates are asynchronous). */
export async function waitFor<T>(check: () => T | null | undefined | false | Promise<T | null | undefined | false>, timeoutMs = 2000): Promise<T> {
  const start = Date.now();
  for (;;) {
    let value: T | null | undefined | false = null;
    await act(async () => {
      value = await check();
      if (!value) await new Promise((resolve) => setTimeout(resolve, 20));
    });
    if (value) return value;
    if (Date.now() - start > timeoutMs) throw new Error('waitFor: timeout');
  }
}
