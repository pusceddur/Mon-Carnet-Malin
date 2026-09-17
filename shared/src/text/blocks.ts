import type { TextBlock } from '../types/domain';
import { joinOcrLines } from './dehyphenate';

export interface LayoutLine { text: string; top: number; height: number; left: number; fontSize?: number }

interface Line extends LayoutLine { words: number; letters: number }

/** Lower quartile: the usual line-to-line step even when most paragraphs are only one or two lines long. */
function lowerQuartile(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 4)]!;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Median weighted by the number of letters: long body lines outweigh short titles. */
function weightedMedian(entries: { value: number; weight: number }[]): number {
  const sorted = entries.filter((e) => e.weight > 0).sort((a, b) => a.value - b.value);
  const total = sorted.reduce((n, e) => n + e.weight, 0);
  let acc = 0;
  for (const e of sorted) {
    acc += e.weight;
    if (acc * 2 >= total) return e.value;
  }
  return 0;
}

function endsSentence(text: string): boolean {
  return /[.!?…:;»"”)]$/.test(text);
}

function isUppercaseLine(text: string): boolean {
  const letters = text.replace(/[^\p{L}]/gu, '');
  return letters.length >= 3 && letters === letters.toUpperCase() && letters !== letters.toLowerCase();
}

/**
 * Groups layout lines (in reading order) into paragraphs and titles.
 * New block on a large vertical gap, a column jump, a font size change or a first-line indent after a
 * finished line. Titles: larger font (or taller lines), uppercase lines, or short isolated lines.
 */
export function buildBlocksFromLines(lines: LayoutLine[]): TextBlock[] {
  const items: Line[] = lines
    .map((l) => ({ ...l, text: l.text.replace(/\s+/g, ' ').trim() }))
    .filter((l) => l.text.length > 0)
    .map((l) => ({ ...l, words: l.text.split(' ').length, letters: l.text.replace(/[^\p{L}\p{N}]/gu, '').length }));
  if (items.length === 0) return [];

  const lineHeight = median(items.map((l) => l.height)) || 1;
  const bodyFont = weightedMedian(items.filter((l) => l.fontSize !== undefined).map((l) => ({ value: l.fontSize!, weight: l.letters })));
  const bodyHeight = weightedMedian(items.map((l) => ({ value: l.height, weight: l.letters }))) || lineHeight;
  const steps: number[] = [];
  for (let i = 1; i < items.length; i++) {
    const step = items[i]!.top - items[i - 1]!.top;
    // Steps shorter than most of a line height are OCR fragments of one visual line, not a line break.
    if (step > lineHeight * 0.6 && step < lineHeight * 3) steps.push(step);
  }
  // With short paragraphs the median step is often a paragraph gap: the lower quartile is the line step.
  const lineStep = lowerQuartile(steps) || lineHeight * 1.2;
  const bodyLeft = median(items.map((l) => l.left));
  const typicalLetters = Math.max(...items.map((l) => l.letters));

  const groups: { lines: Line[]; gapBefore: boolean; gapAfter: boolean }[] = [];
  let current: Line[] = [items[0]!];
  let gapBefore = true;
  for (let i = 1; i < items.length; i++) {
    const prev = items[i - 1]!;
    const line = items[i]!;
    const step = line.top - prev.top;
    const verticalGap = step > lineStep * 1.3 || step < -lineHeight;
    const fontChange = bodyFont > 0 && prev.fontSize !== undefined && line.fontSize !== undefined
      && Math.abs(line.fontSize - prev.fontSize) / bodyFont > 0.15;
    const heightChange = bodyFont === 0 && Math.abs(line.height - prev.height) / bodyHeight > 0.25;
    const indented = line.left - prev.left > lineHeight * 0.6 && prev.left - bodyLeft < lineHeight * 0.6
      && (endsSentence(prev.text) || prev.letters < typicalLetters * 0.75);
    if (verticalGap || fontChange || heightChange || indented) {
      groups.push({ lines: current, gapBefore, gapAfter: verticalGap || fontChange || heightChange });
      gapBefore = verticalGap || fontChange || heightChange;
      current = [line];
    } else {
      current.push(line);
    }
  }
  groups.push({ lines: current, gapBefore, gapAfter: true });

  return groups.map((g) => {
    const text = joinOcrLines(g.lines.map((l) => l.text));
    const first = g.lines[0]!;
    const words = text.split(' ').length;
    const fonts = g.lines.map((l) => l.fontSize).filter((f): f is number => f !== undefined);
    const biggerFont = bodyFont > 0 && fonts.length > 0 && Math.min(...fonts) >= bodyFont * 1.2;
    const tallerLines = bodyFont === 0 && Math.min(...g.lines.map((l) => l.height)) >= bodyHeight * 1.3;
    const shortTitleShape = words <= 12 && !/[.,;:]$/.test(text) && /^[\p{Lu}\p{N}«"]/u.test(text);
    const isolatedShortLine = g.lines.length === 1 && g.gapBefore && g.gapAfter && shortTitleShape
      && first.letters < typicalLetters * 0.6;
    const title = g.lines.length <= 3 && words <= 20
      && (((biggerFont || tallerLines) && !/[.;,]$/.test(text)) || (isUppercaseLine(text) && words <= 12) || isolatedShortLine);
    return { kind: title ? 'title' : 'paragraph', text } satisfies TextBlock;
  });
}

export function blocksToPlainText(blocks: TextBlock[]): string {
  return blocks.map((b) => b.text).join('\n\n');
}
