// Imperative decorations on the memoized reader spans (§15.7): attributes and classes change, spans are never remounted.
import type { TextRange } from './model';

export const SEL_CLASS = 'rp-w--sel';
export const QUOTE_CLASS = 'rp-w--quote';
export const SPEAKING_CLASS = 'rp-s--speaking';
export const SPEAKING_WORD_CLASS = 'rp-w--speaking';

function blockSelector(pageIndex: number, blockIndex: number): string {
  return `.rp-block[data-page-index="${pageIndex}"][data-block-index="${blockIndex}"]`;
}

function wordOffset(el: Element): number {
  return Number(el.getAttribute('data-o'));
}

/** Sets data-hl (and the --hl colour) on the words of one block; removes stale ones. */
export function applyBlockHighlights(blockEl: Element, colors: ReadonlyMap<number, string>): void {
  for (const word of Array.from(blockEl.querySelectorAll<HTMLElement>('.rp-w'))) {
    const color = colors.get(wordOffset(word));
    if (color === undefined) {
      if (word.hasAttribute('data-hl')) {
        word.removeAttribute('data-hl');
        word.style.removeProperty('--hl');
      }
    } else if (word.getAttribute('data-hl') !== color) {
      word.setAttribute('data-hl', color);
      word.style.setProperty('--hl', color);
    }
  }
}

/** Toggles a class on the words intersecting `range` inside `root`; returns the decorated elements. */
export function applyWordRangeClass(root: ParentNode, className: string, range: TextRange | null): HTMLElement[] {
  for (const el of Array.from(root.querySelectorAll<HTMLElement>(`.${className}`))) el.classList.remove(className);
  if (!range) return [];
  const blockEl = root.querySelector(blockSelector(range.pageIndex, range.blockIndex));
  if (!blockEl) return [];
  const marked: HTMLElement[] = [];
  for (const word of Array.from(blockEl.querySelectorAll<HTMLElement>('.rp-w'))) {
    const start = wordOffset(word);
    const end = start + (word.textContent?.length ?? 0);
    if (start < range.end && end > range.start) {
      word.classList.add(className);
      marked.push(word);
    }
  }
  return marked;
}

/** First word element intersecting `range`, without decorating it. */
export function wordElementAt(root: ParentNode, range: TextRange): HTMLElement | null {
  const blockEl = root.querySelector(blockSelector(range.pageIndex, range.blockIndex));
  if (!blockEl) return null;
  for (const word of Array.from(blockEl.querySelectorAll<HTMLElement>('.rp-w'))) {
    const start = wordOffset(word);
    if (start < range.end && start + (word.textContent?.length ?? 0) > range.start) return word;
  }
  return null;
}

/** Element of one sentence, without decorating it. */
export function sentenceElementAt(root: ParentNode, position: { pageIndex: number; blockIndex: number; sentenceIndex: number }): HTMLElement | null {
  return root.querySelector<HTMLElement>(`${blockSelector(position.pageIndex, position.blockIndex)} .rp-s[data-s="${position.sentenceIndex}"]`);
}

/** Marks the sentence being read; returns its element. */
export function applySpeakingSentence(
  root: ParentNode,
  position: { pageIndex: number; blockIndex: number; sentenceIndex: number } | null,
): HTMLElement | null {
  let target: HTMLElement | null = null;
  if (position) target = sentenceElementAt(root, position);
  for (const el of Array.from(root.querySelectorAll<HTMLElement>(`.${SPEAKING_CLASS}`))) {
    if (el !== target) el.classList.remove(SPEAKING_CLASS);
  }
  target?.classList.add(SPEAKING_CLASS);
  return target;
}

/** Word under a pointer: element at the point (pointer capture may retarget events), else the event target. */
export function wordElementFromPoint(doc: Document, x: number, y: number, fallbackTarget: EventTarget | null): HTMLElement | null {
  let el: Element | null = null;
  if (typeof doc.elementFromPoint === 'function') {
    try {
      el = doc.elementFromPoint(x, y);
    } catch {
      el = null;
    }
  }
  const fromPoint = el?.closest<HTMLElement>('.rp-w') ?? null;
  if (fromPoint) return fromPoint;
  return fallbackTarget instanceof Element ? fallbackTarget.closest<HTMLElement>('.rp-w') : null;
}

export function wordPosition(wordEl: Element): { pageIndex: number; blockIndex: number; offset: number } | null {
  const blockEl = wordEl.closest('.rp-block');
  if (!blockEl) return null;
  const pageIndex = Number(blockEl.getAttribute('data-page-index'));
  const blockIndex = Number(blockEl.getAttribute('data-block-index'));
  const offset = wordOffset(wordEl);
  if (![pageIndex, blockIndex, offset].every(Number.isFinite)) return null;
  return { pageIndex, blockIndex, offset };
}

/** Maps a native text selection to a block range (free selection mode). Null across blocks or outside words. */
export function rangeFromNativeSelection(selection: Selection | null, root: Element): TextRange | null {
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  const toWord = (node: Node | null): HTMLElement | null => {
    const el = node instanceof Element ? node : node?.parentElement ?? null;
    return el?.closest<HTMLElement>('.rp-w') ?? null;
  };
  const a = toWord(selection.anchorNode);
  const b = toWord(selection.focusNode);
  if (!a || !b || !root.contains(a) || !root.contains(b)) return null;
  const pa = wordPosition(a);
  const pb = wordPosition(b);
  if (!pa || !pb || pa.pageIndex !== pb.pageIndex || pa.blockIndex !== pb.blockIndex) return null;
  const endOf = (el: HTMLElement, offset: number): number => offset + (el.textContent?.length ?? 0);
  return {
    pageIndex: pa.pageIndex,
    blockIndex: pa.blockIndex,
    start: Math.min(pa.offset, pb.offset),
    end: Math.max(endOf(a, pa.offset), endOf(b, pb.offset)),
  };
}
