import { LIMITS } from '../constants';
import { hardSplit, splitParagraphs, type TextRange } from '../text/passages';
import { segmentSentences } from '../text/segment';
import type { AIPageInput } from '../types/ai';
import { contentStems } from './sentenceScore';

const BM25_K1 = 1.2;
const BM25_B = 0.75;
const MAX_UNIT_CHARS = 1500;
const UNIT_TARGET_CHARS = 1000;
const JOINER = '\n\n';

interface Unit { page: number; pageIndex: number; order: number; range: TextRange; text: string; stems: string[] }

/** Long paragraphs (typically OCR pages without blank lines) become groups of sentences of about 1000 characters. */
function unitRanges(text: string, maxChars: number): TextRange[] {
  const limit = Math.max(1, Math.min(MAX_UNIT_CHARS, maxChars));
  const ranges: TextRange[] = [];
  for (const para of splitParagraphs(text)) {
    if (para.end - para.start <= limit) {
      ranges.push(para);
      continue;
    }
    let group: TextRange | null = null;
    for (const s of segmentSentences(text.slice(para.start, para.end))) {
      const start = para.start + s.start;
      const end = para.start + s.end;
      if (end - start > limit) {
        if (group) ranges.push(group);
        group = null;
        ranges.push(...hardSplit(text, start, end, limit));
        continue;
      }
      if (group && end - group.start > Math.min(UNIT_TARGET_CHARS, limit)) {
        ranges.push(group);
        group = null;
      }
      group = group ? { start: group.start, end } : { start, end };
    }
    if (group) ranges.push(group);
  }
  return ranges;
}

/**
 * Paragraphs most relevant to `question` (simple BM25 on light stems), at most `maxChars` characters in total
 * (paragraphs of a page joined by a blank line), returned in reading order with the page metadata.
 * Pages are returned unchanged when they fit; otherwise relevant paragraphs first, then their neighbours.
 */
export function retrieveRelevantParagraphs(pages: AIPageInput[], question: string, maxChars: number = LIMITS.retrieveMaxChars): AIPageInput[] {
  const budget = Math.max(0, Math.floor(maxChars));
  if (pages.reduce((n, p) => n + p.text.length, 0) <= budget) return pages.map((p) => ({ ...p }));
  const units: Unit[] = [];
  pages.forEach((page, pageNumber) => {
    for (const range of unitRanges(page.text, budget)) {
      const text = page.text.slice(range.start, range.end);
      units.push({ page: pageNumber, pageIndex: page.pageIndex, order: units.length, range, text, stems: contentStems(text) });
    }
  });
  if (units.length === 0 || budget === 0) return [];

  const scores = bm25(units, [...new Set(contentStems(question))]);
  const relevant = units.filter((u) => (scores[u.order] ?? 0) > 0)
    .sort((a, b) => (scores[b.order] ?? 0) - (scores[a.order] ?? 0) || a.order - b.order);
  const distances = units.map((u) => (relevant.length === 0 ? u.order : Math.min(...relevant.map((r) => Math.abs(r.order - u.order)))));
  const rest = units.filter((u) => (scores[u.order] ?? 0) <= 0)
    .sort((a, b) => (distances[a.order] ?? 0) - (distances[b.order] ?? 0) || a.order - b.order);

  let selected: Unit[] = [];
  let used = 0;
  const usedPages = new Set<number>();
  for (const u of [...relevant, ...rest]) {
    const cost = u.text.length + (usedPages.has(u.page) ? JOINER.length : 0);
    if (used + cost > budget) continue;
    selected.push(u);
    usedPages.add(u.page);
    used += cost;
  }
  if (selected.length === 0) {
    const best = relevant[0] ?? units[0]!;
    const cut = hardSplit(best.text, 0, best.text.length, budget)[0];
    if (cut) selected = [{ ...best, text: best.text.slice(cut.start, cut.end) }];
  }
  selected.sort((a, b) => a.order - b.order);

  const out: AIPageInput[] = [];
  let lastPage = -1;
  for (const u of selected) {
    const page = pages[u.page]!;
    const last = out[out.length - 1];
    if (last && lastPage === u.page) {
      last.text += JOINER + u.text;
    } else {
      out.push({ pageIndex: page.pageIndex, text: u.text, contentHash: page.contentHash, ocrLowConfidence: page.ocrLowConfidence });
      lastPage = u.page;
    }
  }
  return out;
}

function bm25(units: Unit[], queryStems: string[]): number[] {
  const n = units.length;
  const avgLength = units.reduce((sum, u) => sum + u.stems.length, 0) / Math.max(1, n);
  const df = new Map<string, number>();
  for (const u of units) for (const stem of new Set(u.stems)) df.set(stem, (df.get(stem) ?? 0) + 1);
  return units.map((u) => {
    if (queryStems.length === 0 || u.stems.length === 0) return 0;
    const tf = new Map<string, number>();
    for (const stem of u.stems) tf.set(stem, (tf.get(stem) ?? 0) + 1);
    let score = 0;
    for (const q of queryStems) {
      const f = tf.get(q) ?? 0;
      if (f === 0) continue;
      const d = df.get(q) ?? 0;
      const idf = Math.log(1 + (n - d + 0.5) / (d + 0.5));
      score += idf * (f * (BM25_K1 + 1)) / (f + BM25_K1 * (1 - BM25_B + (BM25_B * u.stems.length) / Math.max(1, avgLength)));
    }
    return score;
  });
}
