import { LIMITS } from '../constants';
import { sha256Hex } from '../hash/sha256';
import { hardSplit, splitParagraphs, type TextRange } from '../text/passages';
import { segmentSentences } from '../text/segment';
import type { AIPageInput } from '../types/ai';

export interface TextChunk { chunkIndex: number; pageIndexes: number[]; text: string; contentHash: string }

const PAGE_SEPARATOR = '\n\n';

/** Units of an oversize page, each at most `limit` characters: paragraphs, else sentences, else word windows. */
function pageUnits(text: string, limit: number): TextRange[] {
  const units: TextRange[] = [];
  for (const para of splitParagraphs(text)) {
    if (para.end - para.start <= limit) {
      units.push(para);
      continue;
    }
    for (const s of segmentSentences(text.slice(para.start, para.end))) {
      const start = para.start + s.start;
      const end = para.start + s.end;
      if (end - start <= limit) units.push({ start, end });
      else units.push(...hardSplit(text, start, end, limit));
    }
  }
  return units;
}

/** Consecutive units packed into pieces of at most `limit` characters (original separators kept). */
function packUnits(text: string, units: TextRange[], limit: number): string[] {
  const pieces: string[] = [];
  let first: TextRange | null = null;
  let last: TextRange | null = null;
  for (const unit of units) {
    if (first && last && unit.end - first.start > limit) {
      pieces.push(text.slice(first.start, last.end));
      first = null;
    }
    first ??= unit;
    last = unit;
  }
  if (first && last) pieces.push(text.slice(first.start, last.end));
  return pieces;
}

/**
 * Deterministic plan of the progressive summary (§15.4): whole pages in order, packed while the chunk text
 * (pages joined by a blank line) stays within `maxChars`; a page longer than `maxChars` gets its own chunks,
 * split at paragraph boundaries (then sentences, then words). Empty pages are skipped.
 * contentHash = sha256 of the chunk text.
 */
export async function planChunks(pages: AIPageInput[], maxChars: number = LIMITS.chunkMaxChars): Promise<TextChunk[]> {
  const limit = Math.max(1, Math.min(Math.floor(maxChars), LIMITS.chunkTextMaxChars));
  const drafts: { pageIndexes: number[]; text: string }[] = [];
  let pageIndexes: number[] = [];
  let texts: string[] = [];
  let length = 0;
  const flush = (): void => {
    if (texts.length > 0) drafts.push({ pageIndexes, text: texts.join(PAGE_SEPARATOR) });
    pageIndexes = [];
    texts = [];
    length = 0;
  };

  for (const page of pages) {
    const text = page.text.trim();
    if (text.length === 0) continue;
    if (text.length > limit) {
      flush();
      for (const piece of packUnits(text, pageUnits(text, limit), limit)) drafts.push({ pageIndexes: [page.pageIndex], text: piece });
      continue;
    }
    if (texts.length > 0 && length + PAGE_SEPARATOR.length + text.length > limit) flush();
    length += (texts.length > 0 ? PAGE_SEPARATOR.length : 0) + text.length;
    pageIndexes.push(page.pageIndex);
    texts.push(text);
  }
  flush();

  const chunks: TextChunk[] = [];
  for (const [chunkIndex, draft] of drafts.entries()) {
    chunks.push({ chunkIndex, pageIndexes: draft.pageIndexes, text: draft.text, contentHash: await sha256Hex(draft.text) });
  }
  return chunks;
}

/** §15.4: sha256 of the chunks' contentHash values concatenated in order. */
export async function planHash(chunks: TextChunk[]): Promise<string> {
  return sha256Hex(chunks.map((c) => c.contentHash).join(''));
}
