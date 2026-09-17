import { LIMITS, normalizeForMatch } from '@aide/shared';

/** normalizeForMatch padded with spaces so that ` phrase ` matches whole words only. */
export function padded(text: string): string {
  return ` ${normalizeForMatch(text)} `;
}

export function containsNormalizedPhrase(paddedHaystack: string, phrase: string): boolean {
  const needle = normalizeForMatch(phrase);
  if (needle === '') return false;
  return paddedHaystack.includes(` ${needle} `);
}

export interface SourceSection {
  /** null for non-page sources (selected word, child's question, chunk summaries…). */
  pageIndex: number | null;
  text: string;
}

interface IndexedSection {
  pageIndex: number | null;
  padded: string;
  tokens: string[];
}

const FUZZY_MIN_TOKENS = 4;

function tokensOf(normalized: string): string[] {
  return normalized === '' ? [] : normalized.split(' ');
}

/** Multiset Jaccard over a sliding window of the quote length (tolerates OCR errors). */
function fuzzyContains(sectionTokens: string[], quoteTokens: string[], minJaccard: number): boolean {
  const n = quoteTokens.length;
  if (n < FUZZY_MIN_TOKENS || sectionTokens.length < n) return false;
  const need = new Map<string, number>();
  for (const t of quoteTokens) need.set(t, (need.get(t) ?? 0) + 1);
  // shared / (2n - shared) >= minJaccard  <=>  shared >= 2n*minJaccard / (1 + minJaccard)
  const requiredShared = Math.ceil((2 * n * minJaccard) / (1 + minJaccard) - 1e-9);
  const window = new Map<string, number>();
  let shared = 0;
  const add = (t: string): void => {
    const c = (window.get(t) ?? 0) + 1;
    window.set(t, c);
    if (c <= (need.get(t) ?? 0)) shared++;
  };
  const remove = (t: string): void => {
    const c = window.get(t) ?? 0;
    if (c <= (need.get(t) ?? 0)) shared--;
    window.set(t, c - 1);
  };
  for (let i = 0; i < sectionTokens.length; i++) {
    add(sectionTokens[i]!);
    if (i >= n) remove(sectionTokens[i - n]!);
    if (i >= n - 1 && shared >= requiredShared) return true;
  }
  return false;
}

export interface QuoteMatch {
  found: boolean;
  /** Page where the quote was found (null when found in a non-page section or not found). */
  pageIndex: number | null;
  exact: boolean;
}

/** Normalized, tokenized view of the source texts used by SourceGuard. */
export class SourceIndex {
  private readonly sections: IndexedSection[];
  readonly paddedAll: string;

  constructor(sections: readonly SourceSection[]) {
    this.sections = sections.map((s) => {
      const normalized = normalizeForMatch(s.text);
      return { pageIndex: s.pageIndex, padded: ` ${normalized} `, tokens: tokensOf(normalized) };
    });
    this.paddedAll = ` ${this.sections.map((s) => s.padded.trim()).filter((t) => t !== '').join(' | ')} `;
  }

  containsPhrase(phrase: string): boolean {
    return containsNormalizedPhrase(this.paddedAll, phrase);
  }

  /** Exact normalized match first (preferring `preferredPage`), then OCR-tolerant Jaccard window. */
  findQuote(quote: string, preferredPage: number | null = null, minJaccard: number = LIMITS.sourceQuoteJaccardMin): QuoteMatch {
    const normalized = normalizeForMatch(quote);
    if (normalized === '') return { found: false, pageIndex: null, exact: false };
    const needle = ` ${normalized} `;
    const ordered = [...this.sections].sort((a, b) => Number(b.pageIndex === preferredPage) - Number(a.pageIndex === preferredPage));
    for (const section of ordered) {
      if (section.padded.includes(needle)) return { found: true, pageIndex: section.pageIndex, exact: true };
    }
    const quoteTokens = tokensOf(normalized);
    for (const section of ordered) {
      if (fuzzyContains(section.tokens, quoteTokens, minJaccard)) return { found: true, pageIndex: section.pageIndex, exact: false };
    }
    return { found: false, pageIndex: null, exact: false };
  }
}

/** Splits text into sentence-like segments (keeps original characters) for span-level neutralization. */
export function splitSegments(text: string): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  const re = /[^.!?…\n]+[.!?…]*|\n+/g;
  for (const m of text.matchAll(re)) {
    const start = m.index ?? 0;
    out.push({ start, end: start + m[0].length });
  }
  return out;
}
