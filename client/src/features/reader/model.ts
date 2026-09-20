// Pure reader model: blocks → sentences → words (§11.3), speech items, selections, quotes and highlights.
import {
  alignSpokenText,
  normalizeForMatch,
  segmentSentences,
  sha256Hex,
  tokenizeWords,
  type AIPageInput,
  type PageContent,
  type PageStatus,
  type TextBlock,
  type TextHighlight,
} from '@aide/shared';
import type { SpeechItem } from '../../tts/SpeechEngine';

export interface WordModel { offset: number; end: number; text: string }
export type SentencePart = { kind: 'text'; text: string } | { kind: 'word'; word: WordModel };
export interface SentenceModel {
  index: number; start: number; end: number; text: string; parts: SentencePart[]; words: WordModel[];
  /** §22 part of the block prepared for the voice with the words of this sentence (null: block not prepared). */
  spoken: string | null;
}
export type BlockSegment = { kind: 'gap'; text: string } | { kind: 'sentence'; sentence: SentenceModel };
export interface BlockModel {
  pageIndex: number;
  blockIndex: number;
  kind: TextBlock['kind'];
  text: string;
  /** sha256(normalizeForMatch(text)) → data-block-hash */
  hash: string;
  segments: BlockSegment[];
  sentences: SentenceModel[];
  words: WordModel[];
}
export interface PageModel { pageIndex: number; status: PageStatus; page: PageContent; blocks: BlockModel[] }

/** [start, end) character range inside one block. */
export interface TextRange { pageIndex: number; blockIndex: number; start: number; end: number }

export const READABLE_STATUSES: readonly PageStatus[] = ['ready', 'low_confidence'];

export function isReadable(page: Pick<PageContent, 'status'> | null | undefined): boolean {
  return page !== null && page !== undefined && READABLE_STATUSES.includes(page.status);
}

export function isLowConfidence(page: Pick<PageContent, 'status' | 'warnings'>): boolean {
  return page.status === 'low_confidence' || page.warnings.includes('low_confidence');
}

const hashCache = new Map<string, Promise<string>>();

/** Block hash (cached by text). */
export function blockHash(text: string): Promise<string> {
  let pending = hashCache.get(text);
  if (!pending) {
    pending = sha256Hex(normalizeForMatch(text));
    if (hashCache.size > 5000) hashCache.clear();
    hashCache.set(text, pending);
  }
  return pending;
}

const WORD_CHAR = /[\p{L}\p{N}]/u;

/** Sentence spans covering every word: text left outside the segmenter spans is merged into a neighbour. */
function coveringSentences(text: string): { start: number; end: number }[] {
  let spans = segmentSentences(text).filter((s) => s.end > s.start).sort((a, b) => a.start - b.start);
  if (spans.length === 0) {
    const start = text.search(/\S/);
    return start < 0 ? [] : [{ start, end: text.trimEnd().length }];
  }
  spans = spans.map((s) => ({ ...s }));
  const lastNonSpace = (from: number, to: number): number => {
    let i = to;
    while (i > from && /\s/.test(text[i - 1] ?? '')) i -= 1;
    return i;
  };
  const firstNonSpace = (from: number, to: number): number => {
    let i = from;
    while (i < to && /\s/.test(text[i] ?? '')) i += 1;
    return i;
  };
  const first = spans[0];
  if (first && WORD_CHAR.test(text.slice(0, first.start))) first.start = firstNonSpace(0, first.start);
  for (let i = 0; i < spans.length; i += 1) {
    const current = spans[i];
    if (!current) continue;
    const nextStart = spans[i + 1]?.start ?? text.length;
    if (WORD_CHAR.test(text.slice(current.end, nextStart))) current.end = lastNonSpace(current.end, nextStart);
    if (spans[i + 1] && current.end > nextStart) current.end = nextStart;
  }
  return spans;
}

/** §22 text of the prepared version from the first word of a sentence to the first word of the next one. */
function spokenSlice(prepared: string, said: readonly { start: number }[], first: number, next: number): string {
  const end = said[next]?.start ?? prepared.length;
  return prepared.slice(said[first]?.start ?? 0, end).replace(/[\s«“"(\[—–-]+$/u, '');
}

export function buildBlockModel(pageIndex: number, blockIndex: number, block: TextBlock, hash: string): BlockModel {
  const text = block.text;
  const words: WordModel[] = tokenizeWords(text).map((t) => ({ offset: t.start, end: t.end, text: text.slice(t.start, t.end) }));
  // §22 version prepared for the voice, only while it has the words of the text.
  const prepared = block.spoken ? alignSpokenText(text, block.spoken) : null;
  const segments: BlockSegment[] = [];
  const sentences: SentenceModel[] = [];
  let cursor = 0;
  let wordIndex = 0;

  coveringSentences(text).forEach((span, index) => {
    if (span.start > cursor) segments.push({ kind: 'gap', text: text.slice(cursor, span.start) });
    const parts: SentencePart[] = [];
    const sentenceWords: WordModel[] = [];
    let partCursor = span.start;
    while (wordIndex < words.length && (words[wordIndex]?.offset ?? Infinity) < span.start) wordIndex += 1;
    let end = span.end;
    while (wordIndex < words.length) {
      const word = words[wordIndex];
      if (!word || word.offset >= end) break;
      if (word.offset > partCursor) parts.push({ kind: 'text', text: text.slice(partCursor, word.offset) });
      parts.push({ kind: 'word', word });
      sentenceWords.push(word);
      partCursor = word.end;
      end = Math.max(end, word.end);
      wordIndex += 1;
    }
    if (end > partCursor) parts.push({ kind: 'text', text: text.slice(partCursor, end) });
    const spoken = prepared && block.spoken && sentenceWords.length > 0
      ? spokenSlice(block.spoken, prepared.said, wordIndex - sentenceWords.length, wordIndex)
      : null;
    const sentence: SentenceModel = { index, start: span.start, end, text: text.slice(span.start, end), parts, words: sentenceWords, spoken };
    sentences.push(sentence);
    segments.push({ kind: 'sentence', sentence });
    cursor = end;
  });
  if (cursor < text.length) segments.push({ kind: 'gap', text: text.slice(cursor) });

  return { pageIndex, blockIndex, kind: block.kind, text, hash, segments, sentences, words };
}

export async function buildPageModel(page: PageContent): Promise<PageModel> {
  const blocks = isReadable(page)
    ? await Promise.all(page.blocks.map(async (block, blockIndex) => buildBlockModel(page.pageIndex, blockIndex, block, await blockHash(block.text))))
    : [];
  return { pageIndex: page.pageIndex, status: page.status, page, blocks };
}

// ---------- speech ----------

export function speechItemId(pageIndex: number, blockIndex: number, sentenceIndex: number): string {
  return `${pageIndex}:${blockIndex}:${sentenceIndex}`;
}

export function parseSpeechItemId(id: string | null): { pageIndex: number; blockIndex: number; sentenceIndex: number } | null {
  if (!id) return null;
  const match = /^(\d+):(\d+):(\d+)$/.exec(id);
  if (!match) return null;
  return { pageIndex: Number(match[1]), blockIndex: Number(match[2]), sentenceIndex: Number(match[3]) };
}

/** One item per sentence containing at least one word, readable pages in order. */
export function buildSpeechItems(pages: readonly PageModel[]): SpeechItem[] {
  const items: SpeechItem[] = [];
  for (const page of [...pages].sort((a, b) => a.pageIndex - b.pageIndex)) {
    if (!isReadable(page)) continue;
    for (const block of page.blocks) {
      for (const sentence of block.sentences) {
        if (sentence.words.length === 0) continue;
        const id = speechItemId(page.pageIndex, block.blockIndex, sentence.index);
        items.push(sentence.spoken ? { id, text: sentence.text, spoken: sentence.spoken } : { id, text: sentence.text });
      }
    }
  }
  return items;
}

/** Queue index to start from: the given sentence if present, else the first item at or after that position. */
export function speechStartIndex(items: readonly SpeechItem[], position: { pageIndex: number; blockIndex?: number; sentenceIndex?: number }): number {
  const key = (p: number, b: number, s: number): number => p * 1e8 + b * 1e4 + s;
  const target = key(position.pageIndex, position.blockIndex ?? 0, position.sentenceIndex ?? 0);
  const found = items.findIndex((item) => {
    const parsed = parseSpeechItemId(item.id);
    return parsed !== null && key(parsed.pageIndex, parsed.blockIndex, parsed.sentenceIndex) >= target;
  });
  return found >= 0 ? found : Math.max(0, items.length - 1);
}

// ---------- selection ----------

export function wordAt(block: BlockModel, offset: number): WordModel | null {
  return block.words.find((w) => offset >= w.offset && offset < w.end) ?? null;
}

export function selectWord(block: BlockModel, offset: number): TextRange | null {
  const word = wordAt(block, offset);
  return word ? { pageIndex: block.pageIndex, blockIndex: block.blockIndex, start: word.offset, end: word.end } : null;
}

export function wordsInRange(block: BlockModel, start: number, end: number): WordModel[] {
  return block.words.filter((w) => w.offset < end && w.end > start);
}

export function extendToPreviousWord(block: BlockModel, range: TextRange): TextRange {
  const previous = [...block.words].reverse().find((w) => w.end <= range.start);
  return previous ? { ...range, start: previous.offset } : range;
}

export function extendToNextWord(block: BlockModel, range: TextRange): TextRange {
  const next = block.words.find((w) => w.offset >= range.end);
  return next ? { ...range, end: next.end } : range;
}

export function sentenceAt(block: BlockModel, offset: number): SentenceModel | null {
  return block.sentences.find((s) => offset >= s.start && offset < s.end)
    ?? [...block.sentences].reverse().find((s) => s.start <= offset)
    ?? block.sentences[0]
    ?? null;
}

/** Whole sentence(s) covering the range. */
export function sentenceRange(block: BlockModel, range: TextRange): TextRange {
  const first = sentenceAt(block, range.start);
  const last = sentenceAt(block, Math.max(range.start, range.end - 1));
  if (!first || !last) return range;
  return { ...range, start: Math.min(first.start, range.start), end: Math.max(last.end, range.end) };
}

export function paragraphRange(block: BlockModel): TextRange {
  const first = block.words[0];
  const lastSentence = block.sentences.at(-1);
  const start = block.sentences[0]?.start ?? first?.offset ?? 0;
  const end = Math.max(lastSentence?.end ?? 0, block.words.at(-1)?.end ?? 0);
  return { pageIndex: block.pageIndex, blockIndex: block.blockIndex, start, end: Math.max(start, end) };
}

export function rangeText(block: BlockModel, range: TextRange): string {
  return block.text.slice(range.start, range.end);
}

export function isSingleWord(block: BlockModel, range: TextRange): boolean {
  const words = wordsInRange(block, range.start, range.end);
  return words.length === 1 && words[0]?.offset === range.start && words[0]?.end === range.end;
}

export function isWholeSentence(block: BlockModel, range: TextRange): boolean {
  const sentence = sentenceRange(block, range);
  return sentence.start === range.start && sentence.end === range.end;
}

export function isWholeParagraph(block: BlockModel, range: TextRange): boolean {
  const paragraph = paragraphRange(block);
  return paragraph.start === range.start && paragraph.end === range.end;
}

// ---------- quotes ----------

function normalizedTokens(text: string): { start: number; end: number; norm: string }[] {
  return tokenizeWords(text)
    .map((t) => ({ start: t.start, end: t.end, norm: normalizeForMatch(t.word) }))
    .filter((t) => t.norm !== '');
}

function findSequence(haystack: { norm: string }[], needle: string[], from = 0): number {
  if (needle.length === 0) return -1;
  outer: for (let i = from; i + needle.length <= haystack.length; i += 1) {
    for (let j = 0; j < needle.length; j += 1) {
      if (haystack[i + j]?.norm !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

const QUOTE_EDGE_TOKENS = 5;

/**
 * Locates a quote (SourceRef.quote) in the blocks of a page by normalized word sequence (punctuation, case, accents and
 * spacing differences tolerated). Long quotes also match by their first and last words (OCR noise in the middle).
 */
export function findQuote(blocks: readonly Pick<BlockModel, 'pageIndex' | 'blockIndex' | 'text'>[], quote: string): TextRange | null {
  const needle = normalizedTokens(quote).map((t) => t.norm);
  if (needle.length === 0) return null;
  for (const block of blocks) {
    const tokens = normalizedTokens(block.text);
    const at = findSequence(tokens, needle);
    if (at >= 0) {
      const first = tokens[at];
      const last = tokens[at + needle.length - 1];
      if (first && last) return { pageIndex: block.pageIndex, blockIndex: block.blockIndex, start: first.start, end: last.end };
    }
  }
  if (needle.length < QUOTE_EDGE_TOKENS * 2) return null;
  const head = needle.slice(0, QUOTE_EDGE_TOKENS);
  const tail = needle.slice(-QUOTE_EDGE_TOKENS);
  for (const block of blocks) {
    const tokens = normalizedTokens(block.text);
    const h = findSequence(tokens, head);
    if (h < 0) continue;
    const t = findSequence(tokens, tail, h + QUOTE_EDGE_TOKENS);
    const first = tokens[h];
    const last = tokens[t + QUOTE_EDGE_TOKENS - 1];
    if (t >= 0 && first && last && t - h <= needle.length * 2) {
      return { pageIndex: block.pageIndex, blockIndex: block.blockIndex, start: first.start, end: last.end };
    }
  }
  return null;
}

// ---------- highlights ----------

export type Reanchor = (anchor: Pick<TextHighlight, 'blockIndex' | 'start' | 'end' | 'blockTextHash' | 'text'>, page: PageContent) =>
  { blockIndex: number; start: number; end: number } | 'orphan';

export interface ResolvedHighlight { id: string; color: string; blockIndex: number; start: number; end: number; createdAt: number }

/** Highlights of a page placed on the current text: same block hash → as saved; otherwise re-anchored (orphans dropped). */
export function resolveHighlights(page: PageModel, highlights: readonly TextHighlight[], reanchor: Reanchor): ResolvedHighlight[] {
  const out: ResolvedHighlight[] = [];
  for (const h of highlights) {
    if (h.deletedAt !== null || h.pageIndex !== page.pageIndex) continue;
    const block = page.blocks[h.blockIndex];
    let placed: { blockIndex: number; start: number; end: number } | 'orphan';
    if (block && block.hash === h.blockTextHash) placed = { blockIndex: h.blockIndex, start: h.start, end: h.end };
    else {
      try {
        placed = reanchor(h, page.page);
      } catch {
        placed = 'orphan';
      }
    }
    if (placed === 'orphan' || !page.blocks[placed.blockIndex] || placed.end <= placed.start) continue;
    out.push({ id: h.id, color: h.color, createdAt: h.createdAt, ...placed });
  }
  return out.sort((a, b) => a.createdAt - b.createdAt);
}

/** word offset → colour for one block (later highlights win). */
export function highlightColorsForBlock(block: BlockModel, highlights: readonly ResolvedHighlight[]): Map<number, string> {
  const colors = new Map<number, string>();
  for (const h of highlights) {
    if (h.blockIndex !== block.blockIndex) continue;
    for (const word of wordsInRange(block, h.start, h.end)) colors.set(word.offset, h.color);
  }
  return colors;
}

export function highlightsInRange(highlights: readonly ResolvedHighlight[], range: TextRange): ResolvedHighlight[] {
  return highlights.filter((h) => h.blockIndex === range.blockIndex && h.start < range.end && h.end > range.start);
}

// ---------- AI inputs ----------

export async function pageInput(page: PageContent): Promise<AIPageInput | null> {
  if (!isReadable(page)) return null;
  const text = page.blocks.map((b) => b.text).join('\n\n');
  if (text.trim() === '') return null;
  const contentHash = page.contentHash ?? (await sha256Hex(normalizeForMatch(text)));
  return { pageIndex: page.pageIndex, text, contentHash, ocrLowConfidence: isLowConfidence(page) };
}

/** Readable pages as AI inputs within `maxChars`, starting with the pages nearest to `aroundPage`, returned in page order. */
export async function pagesInput(pages: readonly PageContent[], maxChars: number, aroundPage = 0): Promise<AIPageInput[]> {
  const inputs = (await Promise.all(pages.map(pageInput))).filter((p): p is AIPageInput => p !== null);
  const byDistance = [...inputs].sort((a, b) => Math.abs(a.pageIndex - aroundPage) - Math.abs(b.pageIndex - aroundPage) || a.pageIndex - b.pageIndex);
  const kept: AIPageInput[] = [];
  let total = 0;
  for (const input of byDistance) {
    if (total + input.text.length > maxChars) continue;
    kept.push(input);
    total += input.text.length;
  }
  return kept.sort((a, b) => a.pageIndex - b.pageIndex);
}

// ---------- navigation ----------

/** `?page=N` is the page number shown to the child (1-based). */
export function resolveInitialPage(input: { urlPage: string | null; progressPage: number | null; pageCount: number }): number {
  const max = Math.max(0, input.pageCount - 1);
  const fromUrl = input.urlPage === null ? Number.NaN : Number.parseInt(input.urlPage, 10);
  if (Number.isFinite(fromUrl) && fromUrl >= 1) return Math.min(max, fromUrl - 1);
  if (input.progressPage !== null && Number.isFinite(input.progressPage)) return Math.min(max, Math.max(0, input.progressPage));
  return 0;
}

export function readerPath(documentId: string, opts: { pageIndex?: number; quote?: string } = {}): string {
  const params = new URLSearchParams();
  if (opts.pageIndex !== undefined) params.set('page', String(opts.pageIndex + 1));
  if (opts.quote) params.set('quote', opts.quote);
  const query = params.toString();
  return `/lire/${encodeURIComponent(documentId)}${query ? `?${query}` : ''}`;
}

/** Signature of the reading layout (InkLayer `layoutKey`, §15.7); §26 the words of a liaison stay on the same line. */
export function layoutKeyOf(
  prefs: { font: string; fontSizePx: number; lineHeight: number; letterSpacingEm: number; wordSpacingEm: number; columnWidthEm: number; layoutMode: string; aids?: { liaisons: boolean } },
  viewportWidth: number,
): string {
  return [
    prefs.font, prefs.fontSizePx, prefs.lineHeight, prefs.letterSpacingEm, prefs.wordSpacingEm, prefs.columnWidthEm, prefs.layoutMode, Math.round(viewportWidth),
    prefs.aids?.liaisons ? 'li' : '',
  ].join('|');
}
