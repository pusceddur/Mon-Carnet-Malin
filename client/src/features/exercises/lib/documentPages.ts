import {
  blocksToPlainText, LIMITS, normalizeForMatch, sha256Hex, type AIPageInput, type DocumentMeta, type Id, type PageContent,
} from '@aide/shared';

/** Inclusive range of 0-based page indexes. */
export interface PageRange { from: number; to: number }
export type PageSelectionMode = 'all' | 'range';
export interface PageSelection { mode: PageSelectionMode; range: PageRange }

export function isDocumentVisibleToChild(doc: DocumentMeta, childId: Id): boolean {
  return doc.deletedAt === null && (doc.childIds.length === 0 || doc.childIds.includes(childId));
}

export function isReadablePage(page: PageContent): boolean {
  return (page.status === 'ready' || page.status === 'low_confidence') && page.blocks.some((b) => b.text.trim().length > 0);
}

export function isLowConfidencePage(page: PageContent): boolean {
  return page.status === 'low_confidence' || page.warnings.includes('low_confidence');
}

function clampIndex(value: number, pageCount: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(0, Math.trunc(value)), Math.max(0, pageCount - 1));
}

/** Keeps both ends inside the document and `from <= to`. */
export function clampRange(range: PageRange, pageCount: number): PageRange {
  const from = clampIndex(range.from, pageCount);
  const to = clampIndex(range.to, pageCount);
  return from <= to ? { from, to } : { from: to, to: from };
}

/** Moves one end of the range, pushing the other end when they would cross. */
export function stepRange(range: PageRange, end: 'from' | 'to', delta: number, pageCount: number): PageRange {
  if (end === 'from') {
    const from = clampIndex(range.from + delta, pageCount);
    return { from, to: Math.max(from, clampIndex(range.to, pageCount)) };
  }
  const to = clampIndex(range.to + delta, pageCount);
  return { from: Math.min(to, clampIndex(range.from, pageCount)), to };
}

export function fullRange(pageCount: number): PageRange {
  return { from: 0, to: Math.max(0, pageCount - 1) };
}

/** Initial selection: `?page=N` (1-based, as shown to the child) selects that single page, otherwise the whole book. */
export function initialSelection(pageCount: number, pageParam: string | null): PageSelection {
  const page = pageParam === null ? Number.NaN : Number.parseInt(pageParam, 10);
  if (Number.isFinite(page) && page >= 1) {
    const index = clampIndex(page - 1, pageCount);
    return { mode: 'range', range: { from: index, to: index } };
  }
  return { mode: 'all', range: fullRange(pageCount) };
}

export interface SelectionStats { readable: PageContent[]; notReady: number }

/** Readable pages of the selection, sorted, plus how many selected pages cannot be used yet. */
export function selectPages(pages: readonly PageContent[], selection: PageSelection, pageCount: number): SelectionStats {
  const count = Math.max(pageCount, pages.reduce((max, p) => Math.max(max, p.pageIndex + 1), 0));
  const range = selection.mode === 'all' ? fullRange(count) : clampRange(selection.range, count);
  const byIndex = new Map(pages.map((p) => [p.pageIndex, p]));
  const readable: PageContent[] = [];
  let notReady = 0;
  for (let index = range.from; index <= range.to; index += 1) {
    const page = byIndex.get(index);
    if (page && isReadablePage(page)) readable.push(page);
    else notReady += 1;
  }
  return { readable, notReady };
}

export function selectionChars(pages: readonly PageContent[]): number {
  return pages.reduce((sum, page) => sum + blocksToPlainText(page.blocks).length, 0);
}

/** Builds AI page inputs in order, stopping before `maxTotalChars` (the first page is always kept, cut if needed). */
export async function toAIPageInputs(
  pages: readonly PageContent[],
  maxTotalChars: number = LIMITS.pagesMaxTotalChars,
): Promise<{ inputs: AIPageInput[]; truncated: boolean }> {
  const inputs: AIPageInput[] = [];
  let total = 0;
  for (const page of [...pages].sort((a, b) => a.pageIndex - b.pageIndex)) {
    const fullText = blocksToPlainText(page.blocks);
    const room = maxTotalChars - total;
    if (fullText.length > room && inputs.length > 0) return { inputs, truncated: true };
    const cut = fullText.length > room;
    const text = cut ? fullText.slice(0, room) : fullText;
    const contentHash = page.contentHash !== null && !cut ? page.contentHash : await sha256Hex(normalizeForMatch(text));
    inputs.push({ pageIndex: page.pageIndex, text, contentHash, ocrLowConfidence: isLowConfidencePage(page) });
    total += text.length;
    if (cut) return { inputs, truncated: true };
  }
  return { inputs, truncated: false };
}

/** Source page of a question and its neighbours (keeps correction requests small); all pages when the source is missing. */
export function pagesAroundSource<T extends { pageIndex: number }>(pages: readonly T[], sourcePageIndex: number): T[] {
  const near = pages.filter((p) => Math.abs(p.pageIndex - sourcePageIndex) <= 1);
  return near.some((p) => p.pageIndex === sourcePageIndex) ? near : [...pages];
}
