import { segmentSentences } from './segment';

export interface TextRange { start: number; end: number }

/** Paragraph ranges of a page text (separated by blank lines), trimmed. */
export function splitParagraphs(text: string): TextRange[] {
  const ranges: TextRange[] = [];
  const re = /\n[^\S\n]*\n\s*/g;
  let from = 0;
  const push = (start: number, end: number): void => {
    let s = start;
    let e = end;
    while (s < e && /\s/.test(text.charAt(s))) s++;
    while (e > s && /\s/.test(text.charAt(e - 1))) e--;
    if (e > s) ranges.push({ start: s, end: e });
  };
  for (const m of text.matchAll(re)) {
    const idx = m.index ?? 0;
    push(from, idx);
    from = idx + m[0].length;
  }
  push(from, text.length);
  return ranges;
}

export interface LocatedSentence {
  pageIndex: number;
  paragraphIndex: number;   // index in the page
  order: number;            // global reading order
  start: number;            // offsets in the page text
  end: number;
  text: string;             // exact substring of the page text
}

/** Every sentence of the pages, in reading order, with exact text and offsets. */
export function locateSentences(pages: readonly { pageIndex: number; text: string }[]): LocatedSentence[] {
  const out: LocatedSentence[] = [];
  for (const page of pages) {
    splitParagraphs(page.text).forEach((para, paragraphIndex) => {
      const paraText = page.text.slice(para.start, para.end);
      for (const s of segmentSentences(paraText)) {
        const start = para.start + s.start;
        const end = para.start + s.end;
        out.push({ pageIndex: page.pageIndex, paragraphIndex, order: out.length, start, end, text: page.text.slice(start, end) });
      }
    });
  }
  return out;
}

/** Splits [start,end) of `text` into ranges of at most `limit` characters, preferably at whitespace. */
export function hardSplit(text: string, start: number, end: number, limit: number): TextRange[] {
  const ranges: TextRange[] = [];
  let s = start;
  while (s < end) {
    while (s < end && /\s/.test(text.charAt(s))) s++;
    if (s >= end) break;
    if (end - s <= limit) {
      ranges.push({ start: s, end });
      break;
    }
    let cut = s + limit;
    const window = text.slice(s, cut + 1);
    const lastSpace = window.search(/\s\S*$/);
    if (lastSpace > 0) cut = s + lastSpace;
    else if (/[\uDC00-\uDFFF]/.test(text.charAt(cut))) cut--;
    let e = cut;
    while (e > s && /\s/.test(text.charAt(e - 1))) e--;
    ranges.push({ start: s, end: e });
    s = cut;
  }
  return ranges;
}
