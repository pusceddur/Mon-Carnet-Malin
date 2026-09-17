import { describe, expect, it, vi } from 'vitest';
import { removeOcrDebris, tesseractPageToOcrResult, type OcrLine } from '../../src/ocr/ocrLines';
import { whitenBorderBackground } from '../../src/ocr/preprocess/deskew';
import { flattenIllumination, otsuThreshold } from '../../src/ocr/preprocess/filters';
import { createGray, type GrayImage } from '../../src/ocr/preprocess/image';
import { findTextRegions } from '../../src/ocr/preprocess/layout';
import { preprocessGray } from '../../src/ocr/preprocess/pipeline';
import { recognizePage } from '../../src/ocr/readPage';
import { drawPage, layoutWords, type WordBox } from './syntheticPages';

function valuesWhere(img: GrayImage, keep: (x: number, y: number) => boolean): number[] {
  const out: number[] = [];
  for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) if (keep(x, y)) out.push(img.data[y * img.width + x]!);
  return out;
}

const mean = (values: number[]): number => values.reduce((s, v) => s + v, 0) / values.length;

describe('whitenBorderBackground', () => {
  it('paints the dark table around a page white and keeps the text', () => {
    const page = drawPage({ width: 600, height: 400, boxes: layoutWords({ x: 120, y: 100, w: 360, h: 200 }, 3), border: 60, borderValue: 50 });
    const out = whitenBorderBackground(page);
    expect(mean(valuesWhere(out, (x, y) => x < 50 || y < 50))).toBe(255);
    const inkBefore = valuesWhere(page, (x, y) => x > 100 && x < 500 && y > 90 && y < 310).filter((v) => v < 100).length;
    const inkAfter = valuesWhere(out, (x, y) => x > 100 && x < 500 && y > 90 && y < 310).filter((v) => v < 100).length;
    expect(inkAfter).toBe(inkBefore);
  });

  it('never swallows text printed on a darker area that touches the border (scanned page inside a PDF)', () => {
    const width = 600;
    const height = 400;
    const boxes = layoutWords({ x: 60, y: 40, w: 480, h: 180 }, 4);
    // Gray printed page on the top half, touching three edges; white below.
    const page = drawPage({ width, height, boxes, paper: (_x, y) => (y < 250 ? 125 : 250), ink: 150 });
    const out = whitenBorderBackground(page);
    const inText = (x: number, y: number): boolean => y < 250 && boxes.some((b) => x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h);
    expect(mean(valuesWhere(page, inText))).toBeLessThan(40);
    expect(mean(valuesWhere(out, inText))).toBeCloseTo(mean(valuesWhere(page, inText)), 5);
  });

  it('leaves a page without dark border untouched (same object)', () => {
    const page = drawPage({ width: 300, height: 200, boxes: layoutWords({ x: 20, y: 20, w: 260, h: 160 }, 3) });
    expect(whitenBorderBackground(page)).toBe(page);
  });
});

describe('flattenIllumination', () => {
  it('evens out a lamp shadow while keeping the ink darker than the paper', () => {
    const width = 800;
    const height = 500;
    const boxes = layoutWords({ x: 40, y: 40, w: 720, h: 420 }, 5);
    const light = (x: number): number => 245 - (130 * x) / width; // bright left, dark right
    const page = drawPage({ width, height, boxes, paper: (x) => light(x), ink: 170 });
    const out = flattenIllumination(page);
    const inBox = (x: number, y: number): boolean => boxes.some((b: WordBox) => x >= b.x - 2 && x < b.x + b.w + 2 && y >= b.y - 2 && y < b.y + b.h + 2);
    const paperLeft = mean(valuesWhere(out, (x, y) => x < 200 && !inBox(x, y)));
    const paperRight = mean(valuesWhere(out, (x, y) => x > 600 && !inBox(x, y)));
    expect(Math.abs(paperLeft - paperRight)).toBeLessThan(15);
    const before = Math.abs(mean(valuesWhere(page, (x, y) => x < 200 && !inBox(x, y))) - mean(valuesWhere(page, (x, y) => x > 600 && !inBox(x, y))));
    expect(before).toBeGreaterThan(80);
    // One global threshold now separates ink and paper on both sides.
    const t = otsuThreshold(out);
    const inkRight = valuesWhere(out, (x, y) => x > 600 && boxes.some((b) => x >= b.x + 2 && x < b.x + b.w - 2 && y >= b.y + 2 && y < b.y + b.h - 2));
    expect(inkRight.filter((v) => v <= t).length / inkRight.length).toBeGreaterThan(0.95);
  });

  it('does nothing on evenly lit pages', () => {
    const page = drawPage({ width: 300, height: 200, boxes: layoutWords({ x: 20, y: 20, w: 260, h: 160 }, 3) });
    expect(flattenIllumination(page)).toBe(page);
  });
});

describe('findTextRegions', () => {
  it('returns no region for a single-column page', () => {
    const page = drawPage({ width: 800, height: 600, boxes: layoutWords({ x: 60, y: 60, w: 680, h: 480 }, 8) });
    expect(findTextRegions(page)).toEqual([]);
  });

  it('splits two columns, left before right', () => {
    const boxes = [...layoutWords({ x: 60, y: 60, w: 300, h: 480 }, 8), ...layoutWords({ x: 440, y: 60, w: 300, h: 480 }, 9)];
    const regions = findTextRegions(drawPage({ width: 800, height: 600, boxes }));
    expect(regions).toHaveLength(2);
    expect(regions[0]!.x + regions[0]!.width).toBeLessThanOrEqual(420);
    expect(regions[1]!.x).toBeGreaterThanOrEqual(370);
  });

  it('keeps a full-width title above two columns in reading order', () => {
    const title: WordBox[] = [{ x: 60, y: 40, w: 680, h: 24 }];
    const boxes = [...title, ...layoutWords({ x: 60, y: 120, w: 300, h: 420 }, 8), ...layoutWords({ x: 440, y: 120, w: 300, h: 420 }, 9)];
    const regions = findTextRegions(drawPage({ width: 800, height: 600, boxes }));
    expect(regions).toHaveLength(3);
    expect(regions[0]!.width).toBeGreaterThan(600);
    expect(regions[0]!.y + regions[0]!.height).toBeLessThan(130);
    expect(regions[1]!.x).toBeLessThan(regions[2]!.x);
  });

  it('is computed by the pipeline', () => {
    const boxes = [...layoutWords({ x: 60, y: 60, w: 300, h: 480 }, 8), ...layoutWords({ x: 440, y: 60, w: 300, h: 480 }, 9)];
    const result = preprocessGray(drawPage({ width: 800, height: 600, boxes }), { deskew: false, crop: false, minSide: 0 });
    expect(result.regions).toHaveLength(2);
  });
});

describe('recognizePage', () => {
  it('reads each region and shifts the lines to page coordinates', async () => {
    const engine = {
      recognize: vi.fn(async () => ({ confidence: 80, lines: [{ text: 'Bonjour', top: 5, left: 3, height: 20, words: [{ text: 'Bonjour', confidence: 80 }] }] })),
    };
    const img = createGray(100, 50);
    const result = await recognizePage(engine, img, [
      { x: 0, y: 0, width: 50, height: 50 },
      { x: 50, y: 10, width: 50, height: 40 },
    ]);
    expect(engine.recognize).toHaveBeenCalledTimes(2);
    expect(result.lines.map((l) => [l.top, l.left])).toEqual([[5, 3], [15, 53]]);
    expect(result.confidence).toBe(80);
    await recognizePage(engine, img, []);
    expect(engine.recognize).toHaveBeenCalledTimes(3);
  });
});

describe('removeOcrDebris', () => {
  const line = (words: { text: string; confidence: number; left: number; right: number }[]): OcrLine => ({
    text: words.map((w) => w.text).join(' '),
    top: 0,
    left: words[0]?.left ?? 0,
    height: 30,
    words,
  });

  it('drops far unsure words at the line ends and near-zero short words', () => {
    const cleaned = removeOcrDebris(line([
      { text: '|', confidence: 40, left: 0, right: 5 },
      { text: 'Le', confidence: 95, left: 100, right: 130 },
      { text: 'fleuve', confidence: 94, left: 140, right: 230 },
      { text: 'c', confidence: 0, left: 240, right: 250 },
      { text: '2', confidence: 60, left: 600, right: 610 },
    ]));
    expect(cleaned?.text).toBe('Le fleuve');
    expect(cleaned?.left).toBe(100);
  });

  it('keeps words with apostrophes and real numbers, drops lines without reliable words', () => {
    const kept = removeOcrDebris(line([
      { text: 'de', confidence: 96, left: 0, right: 30 },
      { text: 'l’air.', confidence: 5, left: 40, right: 100 },
      { text: '1789', confidence: 95, left: 110, right: 170 },
    ]));
    expect(kept?.text).toBe('de l’air. 1789');
    expect(removeOcrDebris(line([{ text: '2', confidence: 58, left: 0, right: 10 }, { text: 'ei', confidence: 1, left: 20, right: 40 }]))).toBeNull();
  });

  it('is applied when converting the engine output', () => {
    const result = tesseractPageToOcrResult({
      confidence: 70,
      blocks: [{ paragraphs: [{ lines: [
        { text: 'x', bbox: { x0: 0, y0: 0, x1: 900, y1: 30 }, words: [
          { text: 'Bonjour', confidence: 92, bbox: { x0: 0, y0: 0, x1: 120, y1: 30 } },
          { text: 'EE', confidence: 30, bbox: { x0: 800, y0: 0, x1: 900, y1: 30 } },
        ] },
        { text: 'y', bbox: { x0: 0, y0: 40, x1: 100, y1: 70 }, words: [{ text: '1815650', confidence: 19, bbox: { x0: 0, y0: 40, x1: 100, y1: 70 } }] },
      ] }] }],
    });
    expect(result.lines.map((l) => l.text)).toEqual(['Bonjour']);
  });
});
