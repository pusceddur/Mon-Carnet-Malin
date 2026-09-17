import type { InkPoint } from '@aide/shared';
import { afterEach, describe, expect, it } from 'vitest';
import {
  anchorStrokeToText,
  blockTextSource,
  buildContextText,
  eraseHighlightRanges,
  findWordBox,
  fitPageFrame,
  fromAnswerSpace,
  fromOriginalSpace,
  highlightRangesFromWords,
  measureTextLayout,
  nearestWord,
  resolveTextStroke,
  toAnswerSpace,
  toOriginalSpace,
  wordsCrossedByStroke,
  type TextLayout,
} from '../../src/pencil/anchoring';
import { boundingBox } from '../../src/pencil/geometry';
import { buildReaderDom, flowBlocks, hashOf, line, pageContent, wordOf, type FlowBlock, type FlowOptions } from './helpers';

const TEXTS = [
  'La photosynthèse permet aux plantes de fabriquer leur nourriture grâce à la lumière du soleil.',
  'Les feuilles vertes captent la lumière et rejettent un peu d’oxygène dans l’air.',
];
const PAGE = pageContent('doc-1', 0, TEXTS);

function layoutFor(options: FlowOptions, texts: readonly string[] = TEXTS): { blocks: FlowBlock[]; layout: TextLayout } {
  const blocks = flowBlocks(texts, options);
  return { blocks, layout: measureTextLayout(buildReaderDom(0, blocks), 0, { x: 0, y: 0 }) };
}

function expectClosePoints(actual: readonly InkPoint[], expected: readonly InkPoint[], tolerancePx = 0.05): void {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((p, i) => {
    expect(Math.abs(p.x - expected[i]!.x)).toBeLessThanOrEqual(tolerancePx);
    expect(Math.abs(p.y - expected[i]!.y)).toBeLessThanOrEqual(tolerancePx);
  });
}

const BASE: FlowOptions = { fontSize: 20, columnEm: 20, lineHeight: 1.8 };

afterEach(() => {
  document.body.innerHTML = '';
});

describe('measureTextLayout (DOM contract §11.3)', () => {
  it('reads block index, data-o offsets, word lengths, font size and rects relative to the surface origin', () => {
    const { blocks } = layoutFor(BASE);
    const dom = buildReaderDom(0, blocks);
    const layout = measureTextLayout(dom, 0, { x: 10, y: 5 });
    const word = wordOf(blocks, 0, 'photosynthèse');
    const box = findWordBox(layout, 0, word.o)!;
    expect(box).toMatchObject({ blockIndex: 0, charOffset: 3, length: 13, fontSizePx: 20, left: word.rect.left - 10, top: word.rect.top - 5 });
    expect(layout.blocks.get(1)?.domHash).toBe(hashOf(TEXTS[1]!));
    expect(layout.words.length).toBe(blocks[0]!.words.length + blocks[1]!.words.length);
  });

  it('ignores other pages, unrendered words and finds the containing word for a stale offset', () => {
    const { blocks } = layoutFor(BASE);
    const dom = buildReaderDom(0, blocks);
    const hidden = dom.querySelector<HTMLElement>('.rp-w')!;
    Object.defineProperty(hidden, 'getBoundingClientRect', { value: () => ({ left: 0, top: 0, width: 0, height: 0 }) });
    expect(measureTextLayout(dom, 1, { x: 0, y: 0 }).words).toHaveLength(0);
    const layout = measureTextLayout(dom, 0, { x: 0, y: 0 });
    expect(layout.words.some((w) => w.charOffset === 0 && w.blockIndex === 0)).toBe(false);
    expect(findWordBox(layout, 0, 7)?.charOffset).toBe(3); // inside « photosynthèse »
    expect(findWordBox(layout, 9, 0)).toBeNull();
  });

  it('picks the nearest word to a point', () => {
    const { blocks, layout } = layoutFor(BASE);
    const word = wordOf(blocks, 1, 'feuilles');
    expect(nearestWord(layout, { x: word.rect.left + 3, y: word.rect.top + 30 })?.charOffset).toBe(word.o);
  });
});

describe('text anchoring and reflow', () => {
  it('anchors an underline to the word under its centre, with context and hash, and restores it exactly', () => {
    const { blocks, layout } = layoutFor(BASE);
    const word = wordOf(blocks, 0, 'photosynthèse');
    const y = word.rect.top + word.rect.height + 3;
    const underline = line({ x: word.rect.left, y }, { x: word.rect.left + word.rect.width, y }, 12);
    const anchored = anchorStrokeToText(underline, 2.8, layout, blockTextSource(layout, PAGE))!;
    expect(anchored.space).toMatchObject({ kind: 'text', pageIndex: 0, blockIndex: 0, charOffset: word.o, endAnchor: null, blockTextHash: hashOf(TEXTS[0]!) });
    expect(anchored.space.contextText.startsWith('photosynthèse permet')).toBe(true);
    expect(anchored.width).toBeCloseTo(0.14);
    expect(anchored.points[0]).toMatchObject({ x: 0, y: (word.rect.height + 3) / 20 });

    const restored = resolveTextStroke({ blockIndex: 0, charOffset: word.o, endAnchor: null }, anchored.points, anchored.width, layout)!;
    expectClosePoints(restored.points, underline);
    expect(restored.widthPx).toBeCloseTo(2.8);
  });

  it('keeps the stroke on its word when the font size changes (positions scale with the em)', () => {
    const { blocks, layout } = layoutFor(BASE);
    const word = wordOf(blocks, 0, 'photosynthèse');
    const y = word.rect.top + word.rect.height + 3;
    const underline = line({ x: word.rect.left, y }, { x: word.rect.left + word.rect.width, y });
    const anchored = anchorStrokeToText(underline, 2.8, layout, blockTextSource(layout, PAGE))!;

    const bigger = layoutFor({ ...BASE, fontSize: 30 });
    const word30 = wordOf(bigger.blocks, 0, 'photosynthèse');
    const restored = resolveTextStroke(anchored.space, anchored.points, anchored.width, bigger.layout)!;
    const box = boundingBox(restored.points)!;
    expect(box.minX).toBeCloseTo(word30.rect.left, 1);
    expect(box.maxX).toBeCloseTo(word30.rect.left + word30.rect.width, 1);
    expect(box.minY).toBeCloseTo(word30.rect.top + word30.rect.height + 4.5, 1);
    expect(restored.widthPx).toBeCloseTo(4.2);
  });

  it('follows the word when a narrower column moves it to another line', () => {
    const { blocks, layout } = layoutFor(BASE);
    const word = wordOf(blocks, 0, 'lumière');
    const circle: InkPoint[] = [];
    for (let i = 0; i <= 16; i++) {
      const angle = (i / 16) * Math.PI * 2;
      circle.push({ x: word.rect.left + word.rect.width / 2 + Math.cos(angle) * 50, y: word.rect.top + word.rect.height / 2 + Math.sin(angle) * 18, p: 0.5 });
    }
    const anchored = anchorStrokeToText(circle, 2, layout, blockTextSource(layout, PAGE))!;
    expect(anchored.space.charOffset).toBe(word.o);
    expect(anchored.space.endAnchor).toBeNull(); // first and last points on the same line

    const narrow = layoutFor({ ...BASE, columnEm: 11 });
    const moved = wordOf(narrow.blocks, 0, 'lumière');
    expect(moved.line).not.toBe(word.line);
    const restored = resolveTextStroke(anchored.space, anchored.points, anchored.width, narrow.layout)!;
    const box = boundingBox(restored.points)!;
    expect((box.minX + box.maxX) / 2).toBeCloseTo(moved.rect.left + moved.rect.width / 2, 0);
    expect((box.minY + box.maxY) / 2).toBeCloseTo(moved.rect.top + moved.rect.height / 2, 0);
  });

  it('interpolates a multi-line stroke between its two anchors when the line height grows', () => {
    const { blocks, layout } = layoutFor(BASE);
    const firstLine = blocks[0]!.words.filter((w) => w.line === 0);
    const thirdLine = blocks[0]!.words.filter((w) => w.line === 2);
    const top = firstLine[0]!;
    const bottom = thirdLine[0]!;
    const bar = line({ x: 30, y: top.rect.top }, { x: 30, y: bottom.rect.top + bottom.rect.height }, 20);
    const anchored = anchorStrokeToText(bar, 2, layout, blockTextSource(layout, PAGE))!;
    expect(anchored.space.charOffset).toBe(top.o);
    expect(anchored.space.endAnchor).toEqual({ blockIndex: 0, charOffset: bottom.o });
    expectClosePoints(resolveTextStroke(anchored.space, anchored.points, anchored.width, layout)!.points, bar);

    const airy = layoutFor({ ...BASE, lineHeight: 2.6 });
    const top2 = airy.blocks[0]!.words.find((w) => w.o === top.o)!;
    const bottom2 = airy.blocks[0]!.words.find((w) => w.o === bottom.o)!;
    const restored = resolveTextStroke(anchored.space, anchored.points, anchored.width, airy.layout)!;
    const box = boundingBox(restored.points)!;
    expect(box.minY).toBeCloseTo(top2.rect.top, 1);
    expect(box.maxY).toBeCloseTo(bottom2.rect.top + bottom2.rect.height, 1);
    // A single anchor would have left the bar far too short.
    const rigid = resolveTextStroke({ ...anchored.space, endAnchor: null }, anchored.points.map((p) => ({ ...p })), anchored.width, airy.layout)!;
    expect(bottom2.rect.top + bottom2.rect.height - boundingBox(rigid.points)!.maxY).toBeGreaterThan(20);
  });

  it('builds the context from the anchor word onwards', () => {
    expect(buildContextText('Le chat dort sur le canapé du salon ce soir.', 3)).toBe('chat dort sur le canapé du');
    expect(buildContextText('Fin.', 0)).toBe('Fin');
  });
});

describe('highlighter snapping (text view)', () => {
  it('snaps a stroke across words to one TextHighlight range per block', () => {
    const { blocks, layout } = layoutFor(BASE);
    const from = wordOf(blocks, 0, 'permet');
    const to = wordOf(blocks, 0, 'plantes');
    expect(from.line).toBe(to.line);
    const midY = from.rect.top + from.rect.height / 2;
    const stroke = line({ x: from.rect.left + 4, y: midY + 2 }, { x: to.rect.left + to.rect.width - 4, y: midY - 1 });
    const words = wordsCrossedByStroke(stroke, layout);
    expect(words.map((w) => w.charOffset)).toEqual([from.o, wordOf(blocks, 0, 'aux').o, to.o]);
    const ranges = highlightRangesFromWords(words, 0, blockTextSource(layout, PAGE));
    expect(ranges).toEqual([{ pageIndex: 0, blockIndex: 0, start: from.o, end: to.o + 'plantes'.length, text: 'permet aux plantes', blockTextHash: hashOf(TEXTS[0]!) }]);
  });

  it('does not take the neighbouring line touched by the edge of a wide stroke', () => {
    const { blocks, layout } = layoutFor(BASE);
    const word = wordOf(blocks, 0, 'permet');
    const next = blocks[0]!.words.find((w) => w.line === word.line + 1)!;
    // Stroke on the bottom edge of line 0 boxes, far from the middle band of the next line.
    const y = word.rect.top + word.rect.height * 0.55;
    const words = wordsCrossedByStroke(line({ x: word.rect.left, y }, { x: word.rect.left + word.rect.width, y }), layout);
    expect(words.map((w) => w.charOffset)).toEqual([word.o]);
    expect(words.some((w) => w.charOffset === next.o)).toBe(false);
  });

  it('splits a stroke spanning two blocks into two highlights', () => {
    const { blocks, layout } = layoutFor(BASE);
    const last = blocks[0]!.words[blocks[0]!.words.length - 1]!;
    const first = blocks[1]!.words[0]!;
    const stroke = line({ x: last.rect.left + last.rect.width / 2, y: last.rect.top + last.rect.height / 2 }, { x: first.rect.left + first.rect.width / 2, y: first.rect.top + first.rect.height / 2 }, 40);
    const ranges = highlightRangesFromWords(wordsCrossedByStroke(stroke, layout), 0, blockTextSource(layout, PAGE));
    expect(ranges.map((r) => r.blockIndex)).toEqual([0, 1]);
    expect(ranges[0]!.text).toBe('soleil');
    expect(ranges[1]!.text.startsWith('Les')).toBe(true);
  });

  it('erases a whole highlight (stroke mode) or only the touched words (partial mode)', () => {
    const { blocks, layout } = layoutFor(BASE);
    const start = wordOf(blocks, 0, 'permet').o;
    const aux = wordOf(blocks, 0, 'aux');
    const end = wordOf(blocks, 0, 'plantes').o + 'plantes'.length;
    const highlight = { blockIndex: 0, start, end };
    const tap = [{ x: aux.rect.left + aux.rect.width / 2, y: aux.rect.top + aux.rect.height / 2 }];
    expect(eraseHighlightRanges(highlight, layout, [{ x: 5000, y: 5000 }], 5, 'stroke')).toBeNull();
    expect(eraseHighlightRanges(highlight, layout, tap, 2, 'stroke')).toEqual([]);
    expect(eraseHighlightRanges(highlight, layout, tap, 2, 'partial')).toEqual([
      { start, end: start + 'permet'.length },
      { start: wordOf(blocks, 0, 'plantes').o, end },
    ]);
  });
});

describe('original and answer spaces', () => {
  it('normalises page coordinates to 0..1 and back', () => {
    const frame = { left: 20, top: 10, width: 400, height: 600 };
    const mapped = toOriginalSpace([{ x: 220, y: 310, p: 0.61234 }], 4, frame)!;
    expect(mapped.points[0]).toEqual({ x: 0.5, y: 0.5, p: 0.612 });
    expect(mapped.width).toBeCloseTo(0.01);
    const zoomed = fromOriginalSpace(mapped.points, mapped.width, { left: 0, top: 0, width: 1200, height: 1800 });
    expect(zoomed.points[0]).toMatchObject({ x: 600, y: 900 });
    expect(zoomed.widthPx).toBeCloseTo(12);
    expect(toOriginalSpace([{ x: 1, y: 1, p: 1 }], 1, { left: 0, top: 0, width: 0, height: 0 })).toBeNull();
  });

  it('fits the page image inside the surface (aspect ratio kept, top aligned)', () => {
    expect(fitPageFrame(1000, 1000, { width: 1000, height: 2000 })).toEqual({ left: 250, top: 0, width: 500, height: 1000 });
    expect(fitPageFrame(800, 600)).toEqual({ left: 0, top: 0, width: 800, height: 600 });
  });

  it('expresses answer coordinates as fractions of the box width', () => {
    const mapped = toAnswerSpace([{ x: 300, y: 150, p: 0.5 }], 6, 600)!;
    expect(mapped.points[0]).toEqual({ x: 0.5, y: 0.25, p: 0.5 });
    const back = fromAnswerSpace(mapped.points, mapped.width, 300);
    expect(back.points[0]).toMatchObject({ x: 150, y: 75 });
    expect(back.widthPx).toBeCloseTo(3);
  });
});
