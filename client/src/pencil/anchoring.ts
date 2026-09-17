// Annotation spaces (contract C1, §15.7):
// - text: strokes anchored to a word (.rp-w), points in em relative to the word box, optional end anchor for multi-line strokes;
//   highlighter strokes snap to the crossed words (TextHighlight per block); reanchoring after text changes.
// - original: coordinates normalised 0..1 on the page image.
// - answer: coordinates as fractions of the answer box width.
import {
  normalizeForMatch,
  sha256HexSync,
  tokenizeWords,
  type Annotation,
  type Id,
  type InkAnnotation,
  type InkPoint,
  type InkSpace,
  type PageContent,
  type TextHighlight,
} from '@aide/shared';
import { db } from '../db/localDb';
import { saveEntity } from '../sync/SyncEngine';
import { boundingBox, boxCenter, distanceToRect, polylineToRectDistance, type Pt, type Rect } from './geometry';

export type TextInkSpace = Extract<InkSpace, { kind: 'text' }>;

const EM_DECIMALS = 4;
const FRACTION_DECIMALS = 5;
const PRESSURE_DECIMALS = 3;
const CONTEXT_WORDS = 6;
const CONTEXT_MAX_CHARS = 120;
const FUZZY_MIN_JACCARD = 0.8;

function round(value: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}

// ---------------------------------------------------------------------------------------------------------------------
// Block hashes and normalised tokens (memoised: reanchoring runs for every annotation of a page).

const MEMO_LIMIT = 400;
const hashMemo = new Map<string, string>();
const tokenMemo = new Map<string, NormToken[]>();

function remember<V>(memo: Map<string, V>, key: string, value: V): V {
  if (memo.size >= MEMO_LIMIT) {
    const oldest = memo.keys().next().value;
    if (oldest !== undefined) memo.delete(oldest);
  }
  memo.set(key, value);
  return value;
}

/** Same value as the reader's `data-block-hash`: sha256 hex of normalizeForMatch(text). */
export function blockTextHash(text: string): string {
  return hashMemo.get(text) ?? remember(hashMemo, text, sha256HexSync(normalizeForMatch(text)));
}

interface NormToken { norm: string; start: number; end: number }

function normTokens(text: string): NormToken[] {
  const cached = tokenMemo.get(text);
  if (cached) return cached;
  const out: NormToken[] = [];
  for (const token of tokenizeWords(text)) {
    for (const piece of normalizeForMatch(token.word).split(' ')) {
      if (piece) out.push({ norm: piece, start: token.start, end: token.end });
    }
  }
  return remember(tokenMemo, text, out);
}

/** Text used to find the anchor word again: the anchor word and the next few words (starts at `charOffset`). */
export function buildContextText(text: string, charOffset: number): string {
  const tokens = tokenizeWords(text);
  const index = tokens.findIndex((t) => t.end > charOffset);
  const first = tokens[index];
  if (index === -1 || !first) return text.slice(charOffset, charOffset + 40);
  const start = Math.min(first.start, Math.max(charOffset, 0));
  let end = first.end;
  for (let i = index + 1; i < Math.min(tokens.length, index + CONTEXT_WORDS); i++) {
    const t = tokens[i]!;
    if (t.end - start > CONTEXT_MAX_CHARS) break;
    end = t.end;
  }
  return text.slice(start, end);
}

// ---------------------------------------------------------------------------------------------------------------------
// Text layout measured from the reader DOM (§11.3).

export interface WordBox extends Rect {
  blockIndex: number;
  charOffset: number;
  length: number;
  fontSizePx: number;
}

export interface BlockLayout {
  blockIndex: number;
  /** data-block-hash of the block element, when present. */
  domHash: string | null;
  /** textContent of the block element (fallback when the page content is not available). */
  domText: string | null;
  fontSizePx: number;
  /** Sorted by charOffset. */
  words: readonly WordBox[];
}

export interface TextLayout {
  pageIndex: number;
  /** Document order. */
  words: readonly WordBox[];
  blocks: ReadonlyMap<number, BlockLayout>;
}

export function buildTextLayout(pageIndex: number, blocks: readonly Omit<BlockLayout, 'words'>[], words: readonly WordBox[]): TextLayout {
  const map = new Map<number, BlockLayout>();
  for (const b of blocks) {
    map.set(b.blockIndex, { ...b, words: words.filter((w) => w.blockIndex === b.blockIndex).sort((x, y) => x.charOffset - y.charOffset) });
  }
  return { pageIndex, words, blocks: map };
}

function fontSizeOf(el: Element): number {
  const view = el.ownerDocument.defaultView;
  const size = view ? Number.parseFloat(view.getComputedStyle(el).fontSize) : Number.NaN;
  return Number.isFinite(size) && size > 0 ? size : 16;
}

/**
 * Measures the `.rp-w` boxes of one page inside `root`, relative to `origin` (client coordinates of the ink surface).
 * Words without a layout box (not rendered) are skipped.
 */
export function measureTextLayout(root: ParentNode, pageIndex: number, origin: Pt): TextLayout {
  const blocks: Omit<BlockLayout, 'words'>[] = [];
  const words: WordBox[] = [];
  const blockEls = root.querySelectorAll<HTMLElement>(`.rp-block[data-page-index="${pageIndex}"]`);
  for (const blockEl of Array.from(blockEls)) {
    const blockIndex = Number(blockEl.dataset.blockIndex);
    if (!Number.isInteger(blockIndex)) continue;
    const fontSizePx = fontSizeOf(blockEl);
    blocks.push({ blockIndex, domHash: blockEl.dataset.blockHash ?? null, domText: blockEl.textContent, fontSizePx });
    for (const wordEl of Array.from(blockEl.querySelectorAll<HTMLElement>('.rp-w'))) {
      const charOffset = Number(wordEl.dataset.o);
      if (!Number.isInteger(charOffset)) continue;
      const r = wordEl.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      words.push({
        blockIndex,
        charOffset,
        length: (wordEl.textContent ?? '').length,
        fontSizePx,
        left: r.left - origin.x,
        top: r.top - origin.y,
        width: r.width,
        height: r.height,
      });
    }
  }
  return buildTextLayout(pageIndex, blocks, words);
}

/** Nearest word box to `p` (0 inside a box); first in document order on ties. */
export function nearestWord(layout: TextLayout, p: Pt): WordBox | null {
  let best: WordBox | null = null;
  let bestDistance = Infinity;
  for (const w of layout.words) {
    const d = distanceToRect(p, w);
    if (d < bestDistance) {
      best = w;
      bestDistance = d;
      if (d === 0) break;
    }
  }
  return best;
}

/** Word starting at `charOffset`; otherwise the word containing it, the last word before it, or the first word of the block. */
export function findWordBox(layout: TextLayout, blockIndex: number, charOffset: number): WordBox | null {
  const block = layout.blocks.get(blockIndex);
  if (!block || block.words.length === 0) return null;
  let before: WordBox | null = null;
  for (const w of block.words) {
    if (w.charOffset === charOffset) return w;
    if (w.charOffset < charOffset) before = w;
  }
  return before ?? block.words[0] ?? null;
}

function sameLine(a: WordBox, b: WordBox): boolean {
  return Math.abs(a.top + a.height / 2 - (b.top + b.height / 2)) < 0.5 * Math.max(a.height, b.height);
}

/** Where the text of a block comes from: page content first, DOM as fallback. */
export interface BlockTextSource {
  text(blockIndex: number): string | null;
  hash(blockIndex: number): string | null;
}

export function blockTextSource(layout: TextLayout, page: PageContent | null | undefined): BlockTextSource {
  return {
    text: (blockIndex) => page?.blocks[blockIndex]?.text ?? layout.blocks.get(blockIndex)?.domText ?? null,
    hash: (blockIndex) => {
      const pageText = page?.blocks[blockIndex]?.text;
      if (pageText !== undefined) return blockTextHash(pageText);
      const block = layout.blocks.get(blockIndex);
      if (block?.domHash) return block.domHash;
      return block?.domText != null ? blockTextHash(block.domText) : null;
    },
  };
}

export interface AnchoredStroke {
  space: TextInkSpace;
  /** em relative to the anchor word box (see anchorStrokeToText for multi-line strokes). */
  points: InkPoint[];
  /** em (font size of the anchor word). */
  width: number;
}

/** Interpolation parameter of point `i` of a multi-line stroke: 0 on the first point (anchor), 1 on the last (end anchor). */
function strokeT(i: number, count: number): number {
  return count <= 1 ? 0 : i / (count - 1);
}

interface Frame { x: number; y: number; s: number }

function frameAt(a: WordBox, b: WordBox | null, t: number): Frame {
  if (!b || t === 0) return { x: a.left, y: a.top, s: a.fontSizePx };
  return { x: a.left + (b.left - a.left) * t, y: a.top + (b.top - a.top) * t, s: a.fontSizePx + (b.fontSizePx - a.fontSizePx) * t };
}

/**
 * Anchors a stroke drawn in surface px to the text.
 * - Single-line stroke: anchor = word nearest to the centre of the stroke box, endAnchor null; points in em from the top-left
 *   corner of the anchor word box.
 * - Stroke whose first and last points are nearest to words on different lines: anchor = word nearest to the first point,
 *   endAnchor = word nearest to the last point. Point i is expressed in em from an origin interpolated between the two word
 *   boxes (t = i / (n - 1)): the first point is relative to the anchor word, the last one to the end anchor word, so after a
 *   reflow the stroke stretches between both words; with an unchanged layout the geometry is exact.
 */
export function anchorStrokeToText(pointsPx: readonly InkPoint[], widthPx: number, layout: TextLayout, source: BlockTextSource): AnchoredStroke | null {
  const box = boundingBox(pointsPx);
  const first = pointsPx[0];
  const last = pointsPx[pointsPx.length - 1];
  if (!box || !first || !last) return null;
  const startWord = nearestWord(layout, first);
  const endWord = nearestWord(layout, last);
  if (!startWord || !endWord) return null;
  const multiLine = pointsPx.length >= 2 && !sameLine(startWord, endWord);
  const anchor = multiLine ? startWord : nearestWord(layout, boxCenter(box));
  if (!anchor) return null;
  const hash = source.hash(anchor.blockIndex);
  if (hash === null) return null;
  const text = source.text(anchor.blockIndex);
  const end = multiLine ? endWord : null;
  return {
    space: {
      kind: 'text',
      pageIndex: layout.pageIndex,
      blockIndex: anchor.blockIndex,
      charOffset: anchor.charOffset,
      blockTextHash: hash,
      contextText: text === null ? '' : buildContextText(text, anchor.charOffset),
      endAnchor: end ? { blockIndex: end.blockIndex, charOffset: end.charOffset } : null,
    },
    points: pointsPx.map((p, i) => {
      const f = frameAt(anchor, end, strokeT(i, pointsPx.length));
      return { x: round((p.x - f.x) / f.s, EM_DECIMALS), y: round((p.y - f.y) / f.s, EM_DECIMALS), p: round(p.p, PRESSURE_DECIMALS) };
    }),
    width: round(widthPx / anchor.fontSizePx, EM_DECIMALS),
  };
}

export interface TextAnchorRef {
  blockIndex: number;
  charOffset: number;
  endAnchor: TextInkSpace['endAnchor'];
}

/** Inverse of anchorStrokeToText in the current layout (null when the anchor word is not rendered). */
export function resolveTextStroke(anchor: TextAnchorRef, points: readonly InkPoint[], width: number, layout: TextLayout): { points: InkPoint[]; widthPx: number } | null {
  const a = findWordBox(layout, anchor.blockIndex, anchor.charOffset);
  if (!a) return null;
  const end = anchor.endAnchor;
  // Missing end word (not rendered): degrade to the anchor word only.
  const b = end ? (findWordBox(layout, end.blockIndex, end.charOffset) ?? a) : null;
  return {
    points: points.map((p, i) => {
      const f = frameAt(a, b, strokeT(i, points.length));
      return { x: f.x + p.x * f.s, y: f.y + p.y * f.s, p: p.p };
    }),
    widthPx: width * a.fontSizePx,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Highlighter in the text view: snap to the crossed words.

/** Middle horizontal band of a word: touching only the top/bottom edge (neighbour line) does not count. */
function wordCore(w: WordBox): Rect {
  const insetX = Math.min(w.width * 0.2, w.fontSizePx * 0.25);
  return { left: w.left + insetX, top: w.top + w.height * 0.3, width: Math.max(w.width - 2 * insetX, 1), height: Math.max(w.height * 0.4, 1) };
}

export function wordsCrossedByStroke(pointsPx: readonly Pt[], layout: TextLayout): WordBox[] {
  const box = boundingBox(pointsPx);
  if (!box) return [];
  return layout.words.filter((w) => {
    if (w.left > box.maxX || w.left + w.width < box.minX || w.top > box.maxY || w.top + w.height < box.minY) return false;
    return polylineToRectDistance(pointsPx, wordCore(w)) === 0;
  });
}

export interface HighlightRange {
  pageIndex: number;
  blockIndex: number;
  start: number;
  end: number;
  text: string;
  blockTextHash: string;
}

/** One range per block, from the first to the last crossed word (words in between included). */
export function highlightRangesFromWords(words: readonly WordBox[], pageIndex: number, source: BlockTextSource): HighlightRange[] {
  const byBlock = new Map<number, { start: number; end: number }>();
  for (const w of words) {
    const current = byBlock.get(w.blockIndex);
    const end = w.charOffset + w.length;
    if (!current) byBlock.set(w.blockIndex, { start: w.charOffset, end });
    else byBlock.set(w.blockIndex, { start: Math.min(current.start, w.charOffset), end: Math.max(current.end, end) });
  }
  const ranges: HighlightRange[] = [];
  for (const [blockIndex, { start, end }] of Array.from(byBlock.entries()).sort((x, y) => x[0] - y[0])) {
    const text = source.text(blockIndex);
    const hash = source.hash(blockIndex);
    if (text === null || hash === null || end <= start) continue;
    ranges.push({ pageIndex, blockIndex, start, end, text: text.slice(start, end), blockTextHash: hash });
  }
  return ranges;
}

/**
 * Eraser over a text highlight. Returns null when untouched; otherwise the ranges that remain
 * (empty = remove the whole highlight). 'stroke' removes the highlight, 'partial' removes only the touched words.
 */
export function eraseHighlightRanges(
  highlight: Pick<TextHighlight, 'blockIndex' | 'start' | 'end'>,
  layout: TextLayout,
  eraserPath: readonly Pt[],
  radius: number,
  mode: 'stroke' | 'partial',
): { start: number; end: number }[] | null {
  const words = (layout.blocks.get(highlight.blockIndex)?.words ?? []).filter((w) => w.charOffset >= highlight.start && w.charOffset < highlight.end);
  const touched = words.map((w) => polylineToRectDistance(eraserPath, w) <= radius);
  if (!touched.includes(true)) return null;
  if (mode === 'stroke') return [];
  const ranges: { start: number; end: number }[] = [];
  let run: WordBox[] = [];
  const flush = (): void => {
    const first = run[0];
    const last = run[run.length - 1];
    if (first && last) {
      const start = first === words[0] ? highlight.start : first.charOffset;
      const end = last === words[words.length - 1] ? highlight.end : last.charOffset + last.length;
      ranges.push({ start, end });
    }
    run = [];
  };
  words.forEach((w, i) => {
    if (touched[i]) flush();
    else run.push(w);
  });
  flush();
  return ranges;
}

// ---------------------------------------------------------------------------------------------------------------------
// Original view (page image) and answer box.

export interface PageFrame { left: number; top: number; width: number; height: number }

/** Page image frame inside a surface of the given size: image aspect ratio preserved, horizontally centred, top-aligned. */
export function fitPageFrame(surfaceWidth: number, surfaceHeight: number, imageSize?: { width: number; height: number }): PageFrame {
  if (!imageSize || imageSize.width <= 0 || imageSize.height <= 0 || surfaceWidth <= 0 || surfaceHeight <= 0) {
    return { left: 0, top: 0, width: surfaceWidth, height: surfaceHeight };
  }
  const scale = Math.min(surfaceWidth / imageSize.width, surfaceHeight / imageSize.height);
  const width = imageSize.width * scale;
  return { left: (surfaceWidth - width) / 2, top: 0, width, height: imageSize.height * scale };
}

export function toOriginalSpace(pointsPx: readonly InkPoint[], widthPx: number, frame: PageFrame): { points: InkPoint[]; width: number } | null {
  if (frame.width <= 0 || frame.height <= 0) return null;
  return {
    points: pointsPx.map((p) => ({
      x: round((p.x - frame.left) / frame.width, FRACTION_DECIMALS),
      y: round((p.y - frame.top) / frame.height, FRACTION_DECIMALS),
      p: round(p.p, PRESSURE_DECIMALS),
    })),
    width: round(widthPx / frame.width, FRACTION_DECIMALS + 1),
  };
}

export function fromOriginalSpace(points: readonly InkPoint[], width: number, frame: PageFrame): { points: InkPoint[]; widthPx: number } {
  return {
    points: points.map((p) => ({ x: frame.left + p.x * frame.width, y: frame.top + p.y * frame.height, p: p.p })),
    widthPx: width * frame.width,
  };
}

export function toAnswerSpace(pointsPx: readonly InkPoint[], widthPx: number, boxWidth: number): { points: InkPoint[]; width: number } | null {
  if (boxWidth <= 0) return null;
  return {
    points: pointsPx.map((p) => ({ x: round(p.x / boxWidth, FRACTION_DECIMALS), y: round(p.y / boxWidth, FRACTION_DECIMALS), p: round(p.p, PRESSURE_DECIMALS) })),
    width: round(widthPx / boxWidth, FRACTION_DECIMALS + 1),
  };
}

export function fromAnswerSpace(points: readonly InkPoint[], width: number, boxWidth: number): { points: InkPoint[]; widthPx: number } {
  return { points: points.map((p) => ({ x: p.x * boxWidth, y: p.y * boxWidth, p: p.p })), widthPx: width * boxWidth };
}

// ---------------------------------------------------------------------------------------------------------------------
// Reanchoring (§15.7).

/** What can be re-anchored: a text highlight, or the text space of an ink stroke. */
export type ReanchorSource =
  | Pick<TextHighlight, 'blockIndex' | 'start' | 'end' | 'blockTextHash' | 'text'>
  | TextInkSpace;

export type ReanchorResult = { blockIndex: number; start: number; end: number } | 'orphan';

function isInkSpace(anchor: ReanchorSource): anchor is TextInkSpace {
  return 'kind' in anchor;
}

/** Nearest blocks first: origin, origin+1, origin-1, origin+2, … */
function blockOrder(count: number, origin: number): number[] {
  const start = Math.min(Math.max(origin, 0), count - 1);
  const order = [start];
  for (let d = 1; order.length < count; d++) {
    if (start + d < count) order.push(start + d);
    if (start - d >= 0) order.push(start - d);
  }
  return order;
}

function exactMatches(tokens: readonly NormToken[], needle: readonly string[]): number[] {
  const found: number[] = [];
  for (let i = 0; i + needle.length <= tokens.length; i++) {
    let ok = true;
    for (let k = 0; k < needle.length; k++) {
      if (tokens[i + k]!.norm !== needle[k]) {
        ok = false;
        break;
      }
    }
    if (ok) found.push(i);
  }
  return found;
}

function matchesAt(tokens: readonly NormToken[], needle: readonly string[], start: number): boolean {
  const i = tokens.findIndex((t) => t.start === start);
  if (i === -1 || i + needle.length > tokens.length) return false;
  return needle.every((norm, k) => tokens[i + k]!.norm === norm);
}

function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

function bestFuzzy(tokens: readonly NormToken[], needle: readonly string[], origStart: number): { i: number; n: number } | null {
  const needleSet = new Set(needle);
  let best: { i: number; n: number; score: number; distance: number } | null = null;
  for (const n of [needle.length - 1, needle.length, needle.length + 1]) {
    if (n < 1) continue;
    const size = Math.min(n, tokens.length);
    for (let i = 0; i + size <= tokens.length; i++) {
      const score = jaccard(new Set(tokens.slice(i, i + size).map((t) => t.norm)), needleSet);
      if (score < FUZZY_MIN_JACCARD) continue;
      const distance = Math.abs(tokens[i]!.start - origStart);
      if (!best || score > best.score || (score === best.score && distance < best.distance)) best = { i, n: size, score, distance };
    }
  }
  return best ? { i: best.i, n: best.n } : null;
}

/** Keeps the punctuation around the highlighted words when the new text has it at the same place. */
function withSurroundings(text: string, blockText: string, start: number, end: number): { start: number; end: number } {
  const tokens = tokenizeWords(text);
  const first = tokens[0];
  const last = tokens[tokens.length - 1];
  if (!first || !last) return { start, end };
  const lead = text.slice(0, first.start);
  const trail = text.slice(last.end);
  return {
    start: lead && blockText.slice(start - lead.length, start) === lead ? start - lead.length : start,
    end: trail && blockText.slice(end, end + trail.length) === trail ? end + trail.length : end,
  };
}

/**
 * Single reanchoring function, also used by the reader: same block hash → unchanged; exact normalizeForMatch(text | contextText)
 * search in the block then in the other blocks (nearest first); fuzzy token Jaccard ≥ 0.8; otherwise 'orphan'.
 * For an ink space, `start` is the new anchor offset and `end` the end of its context.
 */
export function reanchor(anchor: ReanchorSource, page: PageContent): ReanchorResult {
  const ink = isInkSpace(anchor);
  const origStart = ink ? anchor.charOffset : anchor.start;
  const needleText = ink ? anchor.contextText : anchor.text;
  const blocks = page.blocks;
  if (blocks.length === 0) return 'orphan';

  const needle = normTokens(needleText).map((t) => t.norm);
  const sameBlock = blocks[anchor.blockIndex];
  if (sameBlock && blockTextHash(sameBlock.text) === anchor.blockTextHash) {
    // The hash is computed on normalised text: spacing or case may still have moved the raw offsets.
    const stillThere = ink
      ? needle.length === 0 || matchesAt(normTokens(sameBlock.text), needle, origStart)
      : sameBlock.text.slice(anchor.start, anchor.end) === anchor.text;
    if (stillThere) {
      const end = ink ? Math.min(sameBlock.text.length, origStart + needleText.length) : anchor.end;
      return { blockIndex: anchor.blockIndex, start: origStart, end };
    }
  }

  if (needle.length === 0) return 'orphan';
  const order = blockOrder(blocks.length, anchor.blockIndex);

  const result = (blockIndex: number, tokens: readonly NormToken[], i: number, n: number): ReanchorResult => {
    const start = tokens[i]!.start;
    const end = tokens[i + n - 1]!.end;
    if (ink) return { blockIndex, start, end };
    return { blockIndex, ...withSurroundings(anchor.text, blocks[blockIndex]!.text, start, end) };
  };

  for (const blockIndex of order) {
    const tokens = normTokens(blocks[blockIndex]!.text);
    const matches = exactMatches(tokens, needle);
    if (matches.length === 0) continue;
    const best = matches.reduce((x, y) => (Math.abs(tokens[y]!.start - origStart) < Math.abs(tokens[x]!.start - origStart) ? y : x));
    return result(blockIndex, tokens, best, needle.length);
  }

  for (const blockIndex of order) {
    const tokens = normTokens(blocks[blockIndex]!.text);
    const fuzzy = bestFuzzy(tokens, needle, origStart);
    if (fuzzy) return result(blockIndex, tokens, fuzzy.i, fuzzy.n);
  }
  return 'orphan';
}

function isTextAnchored(a: Annotation): a is TextHighlight | (InkAnnotation & { space: TextInkSpace }) {
  return a.type === 'highlight' || a.space.kind === 'text';
}

export function annotationPageIndex(a: Annotation): number | null {
  if (a.type === 'highlight') return a.pageIndex;
  return a.space.kind === 'answer' ? null : a.space.pageIndex;
}

/** An annotation is orphan when its page has text and reanchor() cannot place it. Pages without text are "unknown", not orphan. */
export function isOrphanAnnotation(a: Annotation, page: PageContent | null | undefined): boolean {
  if (!isTextAnchored(a) || !page || page.blocks.length === 0) return false;
  return reanchor(a.type === 'highlight' ? a : a.space, page) === 'orphan';
}

function reanchorEndAnchor(space: TextInkSpace, oldPage: PageContent | null, newPage: PageContent): TextInkSpace['endAnchor'] {
  const end = space.endAnchor;
  if (!end) return null;
  const oldBlock = oldPage?.blocks[end.blockIndex];
  if (oldBlock) {
    const r = reanchor(
      {
        kind: 'text',
        pageIndex: space.pageIndex,
        blockIndex: end.blockIndex,
        charOffset: end.charOffset,
        blockTextHash: blockTextHash(oldBlock.text),
        contextText: buildContextText(oldBlock.text, end.charOffset),
        endAnchor: null,
      },
      newPage,
    );
    return r === 'orphan' ? null : { blockIndex: r.blockIndex, charOffset: r.start };
  }
  const newBlock = newPage.blocks[end.blockIndex];
  return newBlock && tokenizeWords(newBlock.text).some((t) => t.start === end.charOffset) ? end : null;
}

/**
 * Re-anchored copy of a text-anchored annotation for `newPage`: the same object when nothing changes, null when orphan.
 * `oldPage` (the content the annotation was created on) improves the end anchor of multi-line strokes.
 */
export function reanchorAnnotation(a: Annotation, oldPage: PageContent | null, newPage: PageContent): Annotation | null {
  if (!isTextAnchored(a)) return a;
  if (a.type === 'highlight') {
    const r = reanchor(a, newPage);
    if (r === 'orphan') return null;
    const block = newPage.blocks[r.blockIndex]!;
    const hash = blockTextHash(block.text);
    const text = block.text.slice(r.start, r.end);
    if (r.blockIndex === a.blockIndex && r.start === a.start && r.end === a.end && hash === a.blockTextHash && text === a.text) return a;
    return { ...a, blockIndex: r.blockIndex, start: r.start, end: r.end, blockTextHash: hash, text };
  }
  const space = a.space;
  const r = reanchor(space, newPage);
  if (r === 'orphan') return null;
  const block = newPage.blocks[r.blockIndex]!;
  const hash = blockTextHash(block.text);
  if (r.blockIndex === space.blockIndex && r.start === space.charOffset && hash === space.blockTextHash) return a;
  const next: TextInkSpace = {
    ...space,
    blockIndex: r.blockIndex,
    charOffset: r.start,
    blockTextHash: hash,
    contextText: buildContextText(block.text, r.start),
    endAnchor: reanchorEndAnchor(space, oldPage, newPage),
  };
  return { ...a, space: next };
}

/**
 * Anchor to use when drawing a text annotation on `page` without persisting anything (e.g. text changed on another device).
 * null = orphan (not drawn). When the anchor moved, the end anchor is moved by the same block / offset delta (approximation).
 */
export function currentTextAnchor(space: TextInkSpace, page: PageContent | null | undefined): TextAnchorRef | null {
  if (!page || page.blocks.length === 0) return { blockIndex: space.blockIndex, charOffset: space.charOffset, endAnchor: space.endAnchor };
  const r = reanchor(space, page);
  if (r === 'orphan') return null;
  const end = space.endAnchor;
  if (!end || (r.blockIndex === space.blockIndex && r.start === space.charOffset)) return { blockIndex: r.blockIndex, charOffset: r.start, endAnchor: end };
  const blockDelta = r.blockIndex - space.blockIndex;
  const sameBlock = end.blockIndex === space.blockIndex;
  return {
    blockIndex: r.blockIndex,
    charOffset: r.start,
    endAnchor: {
      blockIndex: Math.max(0, end.blockIndex + blockDelta),
      charOffset: sameBlock ? Math.max(0, end.charOffset + (r.start - space.charOffset)) : end.charOffset,
    },
  };
}

/**
 * Re-anchors every text annotation (ink text space + highlights) of a page and saves the changed ones via saveEntity.
 * Called by reprocessPage, replacePageImage and the manual page editor BEFORE saving the new page: pass the new content as
 * `page` (the stored page is then used as the old content); without it, the page currently stored in Dexie is used.
 * Orphans are left untouched (listed in « Mes notes »). Never throws on a single annotation failure.
 */
export async function reanchorPageAnnotations(documentId: Id, pageIndex: number, page?: PageContent): Promise<void> {
  const stored = await db.pages.get([documentId, pageIndex]);
  const newPage = page ?? stored;
  if (!newPage || newPage.blocks.length === 0) return;
  const oldPage = page ? (stored ?? null) : null;
  const annotations = await db.annotations
    .where('documentId')
    .equals(documentId)
    .filter((a) => a.deletedAt === null && isTextAnchored(a) && annotationPageIndex(a) === pageIndex)
    .toArray();
  for (const a of annotations) {
    const next = reanchorAnnotation(a, oldPage, newPage);
    if (next === null || next === a) continue;
    await saveEntity('annotations', { ...next, updatedAt: Math.max(Date.now(), a.updatedAt + 1) });
  }
}
