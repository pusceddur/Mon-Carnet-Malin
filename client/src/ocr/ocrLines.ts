// OCR output model (engine-independent) and conversion from the tesseract.js 7 block tree.
import type { LayoutLine } from '@aide/shared';

export interface OcrWord {
  text: string;
  /** 0..100 */
  confidence: number;
  /** Horizontal extent in image pixels, when the engine gives it. */
  left?: number;
  right?: number;
}

export interface OcrLine {
  text: string;
  top: number;
  left: number;
  height: number;
  words: OcrWord[];
}

export interface OcrResult {
  lines: OcrLine[];
  /** Mean confidence reported by the engine, 0..100. */
  confidence: number;
}

// Structural subset of the tesseract.js result (blocks → paragraphs → lines → words).
interface BBoxLike { x0: number; y0: number; x1: number; y1: number }
interface WordLike { text: string; confidence: number; bbox?: BBoxLike }
interface LineLike {
  text: string;
  bbox: BBoxLike;
  words: WordLike[];
  rowAttributes?: { rowHeight: number; descenders: number };
  baseline?: BBoxLike;
}
interface ParagraphLike { lines: LineLike[] }
interface BlockLike { paragraphs: ParagraphLike[] }
export interface TesseractPageLike { blocks: BlockLike[] | null; confidence: number }

function clampConfidence(value: number): number {
  return Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 0;
}

const alphanumericCount = (text: string): number => text.replace(/[^\p{L}\p{N}]/gu, '').length;

/**
 * Removes typical page-edge debris (shadows, page border, dust) read as words: short or unsure words standing far from
 * the text at either end of a line, near-zero confidence one- or two-character words at a line end, and lines without
 * any reliable word. Words with apostrophes are kept (the engine often gives them a low confidence).
 */
export function removeOcrDebris(line: OcrLine): OcrLine | null {
  let words = [...line.words];
  const weak = (word: OcrWord): boolean => !/['’]/.test(word.text) && (word.confidence < 70 || alphanumericCount(word.text) <= 2);
  const nearZero = (word: OcrWord): boolean => !/['’]/.test(word.text) && word.confidence < 15 && alphanumericCount(word.text) <= 2;
  const farApart = (a: OcrWord, b: OcrWord): boolean =>
    a.right !== undefined && b.left !== undefined && b.left - a.right > line.height * 1.2;

  // A cluster of weak words at an end of the line, separated from the text by a wide gap, is debris.
  let end = words.length;
  while (end > 0 && weak(words[end - 1]!)) end--;
  if (end > 0 && end < words.length && farApart(words[end - 1]!, words[end]!)) words = words.slice(0, end);
  let start = 0;
  while (start < words.length && weak(words[start]!)) start++;
  if (start > 0 && start < words.length && farApart(words[start - 1]!, words[start]!)) words = words.slice(start);
  // Then single weak words: isolated from their neighbour, or read with a near-zero confidence.
  for (;;) {
    const last = words[words.length - 1];
    const previous = words[words.length - 2];
    if (!last || !weak(last) || !(nearZero(last) || (previous !== undefined && farApart(previous, last)))) break;
    words.pop();
  }
  for (;;) {
    const first = words[0];
    const next = words[1];
    if (!first || !weak(first) || !(nearZero(first) || (next !== undefined && farApart(first, next)))) break;
    words.shift();
  }
  if (!words.some((w) => w.confidence >= 60 && alphanumericCount(w.text) >= 2)) return null;
  if (words.length === line.words.length) return line;
  return { ...line, text: words.map((w) => w.text).join(' '), left: words[0]!.left ?? line.left, words };
}

/** Visits blocks → paragraphs → lines → words and keeps non-empty lines in reading order, without edge debris. */
export function tesseractPageToOcrResult(page: TesseractPageLike): OcrResult {
  const lines: OcrLine[] = [];
  for (const block of page.blocks ?? []) {
    for (const paragraph of block.paragraphs ?? []) {
      for (const line of paragraph.lines ?? []) {
        const words: OcrWord[] = (line.words ?? [])
          .map((w) => ({
            text: w.text.trim(),
            confidence: clampConfidence(w.confidence),
            ...(w.bbox ? { left: w.bbox.x0, right: w.bbox.x1 } : {}),
          }))
          .filter((w) => w.text.length > 0);
        if (words.length === 0) continue;
        // Font-based row height and baseline are steadier than the box (accents, descenders, stray marks).
        const rowHeight = line.rowAttributes?.rowHeight ?? 0;
        const useRow = rowHeight > 0 && line.baseline !== undefined && Number.isFinite(rowHeight);
        const baselineY = line.baseline ? (line.baseline.y0 + line.baseline.y1) / 2 : 0;
        const cleaned = removeOcrDebris({
          text: words.map((w) => w.text).join(' '),
          top: useRow ? Math.round(baselineY - (rowHeight - (line.rowAttributes?.descenders ?? 0))) : line.bbox.y0,
          left: line.bbox.x0,
          height: useRow ? Math.round(rowHeight) : Math.max(1, line.bbox.y1 - line.bbox.y0),
          words,
        });
        if (cleaned) lines.push(cleaned);
      }
    }
  }
  return { lines, confidence: clampConfidence(page.confidence) };
}

export function ocrLinesToLayoutLines(lines: readonly OcrLine[]): LayoutLine[] {
  return lines.map((l) => ({ text: l.text, top: l.top, left: l.left, height: l.height }));
}
