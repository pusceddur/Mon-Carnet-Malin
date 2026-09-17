import { describe, expect, it } from 'vitest';
import { detectSkewAngle, findContentBounds } from '../../src/ocr/preprocess/deskew';
import {
  adaptiveThreshold,
  medianFilter3,
  otsuThreshold,
  stretchContrast,
  toGrayscale,
} from '../../src/ocr/preprocess/filters';
import {
  applyHomography,
  cropGray,
  orderQuad,
  resizeGray,
  rotateArbitrary,
  rotateQuarter,
  solveHomography,
  warpPerspective,
} from '../../src/ocr/preprocess/geometry';
import { createGray, encodePgm, grayToRgba, type GrayImage, type Point } from '../../src/ocr/preprocess/image';
import { binarizeForOcr, normalizeQuarterTurn, preprocessGray, rotationProbes, thumbnail } from '../../src/ocr/preprocess/pipeline';
import { drawPage, layoutWords, meanAbsDiff, rng } from './syntheticPages';

function gray(width: number, height: number, values: number[]): GrayImage {
  return { width, height, data: Uint8ClampedArray.from(values) };
}

describe('filters', () => {
  it('converts RGBA to luma and composites transparency over white', () => {
    const rgba = {
      width: 3,
      height: 1,
      data: Uint8ClampedArray.from([255, 0, 0, 255, 0, 0, 0, 0, 100, 100, 100, 255]),
    };
    const g = toGrayscale(rgba);
    expect(Array.from(g.data)).toEqual([76, 255, 100]);
  });

  it('stretches a low-contrast image to the full range', () => {
    const values = Array.from({ length: 1000 }, (_, i) => 100 + (i % 51));
    const out = stretchContrast(gray(100, 10, values));
    const min = Math.min(...out.data);
    const max = Math.max(...out.data);
    expect(min).toBeLessThanOrEqual(5);
    expect(max).toBeGreaterThanOrEqual(250);
  });

  it('leaves a flat image unchanged', () => {
    const out = stretchContrast(gray(4, 1, [120, 121, 122, 120]));
    expect(Array.from(out.data)).toEqual([120, 121, 122, 120]);
  });

  it('median 3×3 equals the sorted median of the neighbourhood', () => {
    const random = rng(3);
    for (let trial = 0; trial < 200; trial++) {
      const values = Array.from({ length: 9 }, () => Math.floor(random() * 256));
      const out = medianFilter3(gray(3, 3, values));
      const sorted = [...values].sort((a, b) => a - b);
      expect(out.data[4]).toBe(sorted[4]);
    }
  });

  it('median 3×3 removes isolated noise but keeps solid strokes', () => {
    const img = createGray(20, 20, 250);
    img.data[5 * 20 + 5] = 0; // salt
    for (let y = 8; y < 13; y++) for (let x = 8; x < 13; x++) img.data[y * 20 + x] = 10; // stroke
    const out = medianFilter3(img);
    expect(out.data[5 * 20 + 5]).toBe(250);
    expect(out.data[10 * 20 + 10]).toBe(10);
  });

  it('Otsu separates a bimodal histogram', () => {
    const values = [...Array(500).fill(30), ...Array(500).fill(220)] as number[];
    const t = otsuThreshold(gray(100, 10, values));
    expect(t).toBeGreaterThanOrEqual(30);
    expect(t).toBeLessThan(220);
  });

  describe('adaptive threshold', () => {
    // Uneven light: paper goes from 90 (left) to 240 (right); ink is 70 levels darker than the local paper.
    const width = 600;
    const height = 300;
    const boxes = layoutWords({ x: 30, y: 30, w: 540, h: 240 }, 11);
    const paper = (x: number): number => 90 + (150 * x) / (width - 1);
    const page = drawPage({ width, height, boxes, paper: (x) => paper(x), ink: 175 });
    const isInk = (x: number, y: number): boolean =>
      boxes.some((b) => x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h);

    function score(bin: GrayImage): { inkHit: number; falseInk: number } {
      let ink = 0;
      let inkHit = 0;
      let paperPx = 0;
      let falseInk = 0;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const black = bin.data[y * width + x] === 0;
          if (isInk(x, y)) {
            ink++;
            if (black) inkHit++;
          } else {
            paperPx++;
            if (black) falseInk++;
          }
        }
      }
      return { inkHit: inkHit / ink, falseInk: falseInk / paperPx };
    }

    it('Sauvola finds the ink under uneven lighting where a global threshold fails', () => {
      const t = otsuThreshold(page);
      let globalFalse = 0;
      for (let i = 0; i < page.data.length; i++) if (page.data[i]! <= t) globalFalse++;
      const sauvola = score(adaptiveThreshold(page, { method: 'sauvola', window: 41 }));
      expect(sauvola.inkHit).toBeGreaterThan(0.9);
      expect(sauvola.falseInk).toBeLessThan(0.03);
      // The global threshold marks much more than the real ink (whole dark side).
      expect(globalFalse / page.data.length).toBeGreaterThan(0.3);
    });

    it('Bradley and block statistics give comparable results', () => {
      const bradley = score(adaptiveThreshold(page, { method: 'bradley', window: 41, t: 0.15 }));
      expect(bradley.inkHit).toBeGreaterThan(0.9);
      expect(bradley.falseInk).toBeLessThan(0.05);
      const blocks = score(adaptiveThreshold(page, { method: 'sauvola', window: 41, blockSize: 3 }));
      expect(blocks.inkHit).toBeGreaterThan(0.85);
      expect(blocks.falseInk).toBeLessThan(0.05);
    });

    it('outputs only 0 and 255', () => {
      const bin = binarizeForOcr(page);
      expect(new Set(bin.data)).toEqual(new Set([0, 255]));
    });
  });
});

describe('geometry', () => {
  it('rotates by quarter turns clockwise', () => {
    // 3×2: a b c / d e f
    const img = gray(3, 2, [1, 2, 3, 4, 5, 6]);
    const r90 = rotateQuarter(img, 90);
    expect([r90.width, r90.height]).toEqual([2, 3]);
    expect(Array.from(r90.data)).toEqual([4, 1, 5, 2, 6, 3]);
    const r180 = rotateQuarter(img, 180);
    expect(Array.from(r180.data)).toEqual([6, 5, 4, 3, 2, 1]);
    const r270 = rotateQuarter(img, 270);
    expect(Array.from(r270.data)).toEqual([3, 6, 2, 5, 1, 4]);
    expect(Array.from(rotateQuarter(rotateQuarter(r90, 180), 90).data)).toEqual(Array.from(img.data));
  });

  it('normalizes quarter turns', () => {
    expect(normalizeQuarterTurn(-90)).toBe(270);
    expect(normalizeQuarterTurn(450)).toBe(90);
    expect(normalizeQuarterTurn(360)).toBe(0);
  });

  it('downscales by exact area averaging', () => {
    const img = gray(4, 2, [0, 100, 200, 200, 100, 0, 0, 0]);
    const out = resizeGray(img, 2, 1);
    expect(Array.from(out.data)).toEqual([50, 100]);
  });

  it('crops a rectangle', () => {
    const img = gray(3, 3, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(Array.from(cropGray(img, { x: 1, y: 1, width: 2, height: 2 }).data)).toEqual([5, 6, 8, 9]);
  });

  it('solves a homography that maps known points exactly', () => {
    const from: Point[] = [[0, 0], [100, 0], [100, 50], [0, 50]];
    const to: Point[] = [[10, 20], [130, 5], [120, 90], [0, 70]];
    const hm = solveHomography(from, to);
    expect(hm).not.toBeNull();
    for (let i = 0; i < 4; i++) {
      const [x, y] = applyHomography(hm!, from[i]![0], from[i]![1]);
      expect(x).toBeCloseTo(to[i]![0], 6);
      expect(y).toBeCloseTo(to[i]![1], 6);
    }
    // The center of the square maps to the intersection of the quad diagonals (projective invariant).
    const [cx, cy] = applyHomography(hm!, 50, 25);
    const inverse = solveHomography(to, from)!;
    const [bx, by] = applyHomography(inverse, cx, cy);
    expect(bx).toBeCloseTo(50, 6);
    expect(by).toBeCloseTo(25, 6);
  });

  it('returns null for a degenerate quad', () => {
    expect(solveHomography([[0, 0], [1, 0], [2, 0], [3, 0]], [[0, 0], [1, 0], [1, 1], [0, 1]])).toBeNull();
  });

  it('orders quad corners', () => {
    const q = orderQuad([[90, 95], [5, 3], [2, 80], [100, 10]]);
    expect(q).toEqual([[5, 3], [100, 10], [90, 95], [2, 80]]);
  });

  it('perspective warp recovers a page photographed at an angle', () => {
    const width = 300;
    const height = 200;
    const upright = drawPage({ width, height, boxes: layoutWords({ x: 20, y: 20, w: 260, h: 160 }, 5, 24, 10) });
    // Project the upright page into a trapezoid inside a larger dark « photo ».
    const quad: Point[] = [[60, 40], [330, 25], [360, 250], [30, 230]];
    const hm = solveHomography(quad, [[0, 0], [width - 1, 0], [width - 1, height - 1], [0, height - 1]])!;
    const photo = createGray(400, 300, 40);
    for (let y = 0; y < 300; y++) {
      for (let x = 0; x < 400; x++) {
        const [ux, uy] = applyHomography(hm, x, y);
        if (ux >= 0 && uy >= 0 && ux <= width - 1 && uy <= height - 1) {
          photo.data[y * 400 + x] = upright.data[Math.round(uy) * width + Math.round(ux)]!;
        }
      }
    }
    const warped = warpPerspective(photo, quad);
    const restored = resizeGray(warped, width, height);
    const diff = meanAbsDiff(restored, upright);
    expect(diff).toBeLessThan(25);
    // Sanity: without correction the difference is much larger.
    expect(meanAbsDiff(resizeGray(photo, width, height), upright)).toBeGreaterThan(diff * 2);
  });

  it('arbitrary rotation keeps the whole page when expanding', () => {
    const img = createGray(100, 50, 0);
    const out = rotateArbitrary(img, 30);
    expect(out.width).toBe(Math.ceil(100 * Math.cos(Math.PI / 6) + 50 * Math.sin(Math.PI / 6)));
    // Corners are background, center stays ink.
    expect(out.data[0]).toBe(255);
    expect(out.data[Math.floor(out.height / 2) * out.width + Math.floor(out.width / 2)]).toBe(0);
  });
});

describe('deskew', () => {
  const width = 900;
  const height = 700;
  const boxes = layoutWords({ x: 80, y: 80, w: 740, h: 540 }, 21);

  it.each([4, -3, 7.5, 1.2])('detects a known skew of %s°', (angle) => {
    const page = drawPage({ width, height, boxes, angle });
    const detected = detectSkewAngle(page);
    expect(Math.abs(detected - angle)).toBeLessThanOrEqual(0.25);
  });

  it('reports no skew for a straight page and for a blank page', () => {
    expect(Math.abs(detectSkewAngle(drawPage({ width, height, boxes })))).toBeLessThanOrEqual(0.1);
    expect(detectSkewAngle(createGray(200, 200, 250))).toBe(0);
  });

  it('straightening with the opposite angle removes the skew', () => {
    const page = drawPage({ width, height, boxes, angle: 5 });
    const angle = detectSkewAngle(page);
    const straight = rotateArbitrary(page, -angle);
    expect(Math.abs(detectSkewAngle(straight))).toBeLessThanOrEqual(0.25);
  });

  it('finds the content inside dark photo borders', () => {
    const page = drawPage({ width: 600, height: 400, boxes: layoutWords({ x: 150, y: 120, w: 300, h: 160 }, 2), border: 50 });
    const b = findContentBounds(page);
    expect(b.x).toBeGreaterThanOrEqual(50);
    expect(b.y).toBeGreaterThanOrEqual(50);
    expect(b.x + b.width).toBeLessThanOrEqual(550);
    expect(b.y + b.height).toBeLessThanOrEqual(350);
    // The text block (150..450 × 120..280) stays inside.
    expect(b.x).toBeLessThanOrEqual(150);
    expect(b.y).toBeLessThanOrEqual(120);
    expect(b.x + b.width).toBeGreaterThanOrEqual(440);
    expect(b.y + b.height).toBeGreaterThanOrEqual(270);
  });

  it('keeps the full page when there is nothing to crop', () => {
    const blank = createGray(300, 200, 250);
    expect(findContentBounds(blank)).toEqual({ x: 0, y: 0, width: 300, height: 200 });
  });
});

describe('pipeline', () => {
  it('straightens, crops and resizes a skewed photo with dark borders', () => {
    const page = drawPage({
      width: 1000,
      height: 800,
      boxes: layoutWords({ x: 150, y: 150, w: 700, h: 500 }, 9),
      angle: 4,
      border: 60,
      paper: 200,
      ink: 60,
    });
    const { image, skewDegrees } = preprocessGray(page, { denoise: true, minSide: 0 });
    expect(Math.abs(skewDegrees - 4)).toBeLessThanOrEqual(0.3);
    expect(Math.abs(detectSkewAngle(image))).toBeLessThanOrEqual(0.3);
    expect(image.width).toBeLessThan(1000);
    expect(image.height).toBeLessThan(800);
    // Contrast stretched: paper is close to white.
    const sorted = Array.from(image.data).sort((a, b) => a - b);
    expect(sorted[Math.floor(sorted.length / 2)]).toBeGreaterThan(230);
  });

  it('applies the user rotation, the long side cap and the minimum size', () => {
    const page = drawPage({ width: 400, height: 200, boxes: layoutWords({ x: 20, y: 20, w: 360, h: 160 }, 4) });
    const rotated = preprocessGray(page, { rotateDegrees: 90, deskew: false, crop: false, minSide: 0 });
    expect([rotated.image.width, rotated.image.height]).toEqual([200, 400]);
    const capped = preprocessGray(page, { maxSide: 100, deskew: false, crop: false });
    expect(Math.max(capped.image.width, capped.image.height)).toBe(100);
    const enlarged = preprocessGray(page, { minSide: 800, deskew: false, crop: false });
    expect(Math.max(enlarged.image.width, enlarged.image.height)).toBe(800);
  });

  it('applies a normalized quad and ignores a full-frame quad', () => {
    const page = drawPage({ width: 400, height: 300, boxes: layoutWords({ x: 20, y: 20, w: 360, h: 260 }, 4) });
    const full = preprocessGray(page, { quad: [[0, 0], [1, 0], [1, 1], [0, 1]], deskew: false, crop: false, minSide: 0 });
    expect([full.image.width, full.image.height]).toEqual([400, 300]);
    const half = preprocessGray(page, { quad: [[0, 0], [0.5, 0], [0.5, 1], [0, 1]], deskew: false, minSide: 0 });
    expect(half.image.width).toBeLessThan(220);
    expect(half.image.height).toBeGreaterThan(280);
  });

  it('builds thumbnails and rotation probes', () => {
    const page = createGray(2000, 1000, 255);
    const t = thumbnail(page, 240);
    expect([t.width, t.height]).toEqual([240, 120]);
    const probes = rotationProbes(page, [90, 180, 270]);
    expect(probes.map((p) => [p.turn, p.image.width, p.image.height])).toEqual([
      [90, 500, 1000],
      [180, 1000, 500],
      [270, 500, 1000],
    ]);
  });

  it('encodes PGM and RGBA', () => {
    const img = gray(2, 1, [0, 255]);
    const pgm = encodePgm(img);
    expect(new TextDecoder().decode(pgm.subarray(0, 11))).toBe('P5\n2 1\n255\n');
    expect(Array.from(pgm.subarray(11))).toEqual([0, 255]);
    expect(Array.from(grayToRgba(img))).toEqual([0, 0, 0, 255, 255, 255, 255, 255]);
  });
});
