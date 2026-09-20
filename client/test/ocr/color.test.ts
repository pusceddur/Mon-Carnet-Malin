// Color copy of the processed page (§19.1): same frame as the grayscale OCR image, colors kept.
import { describe, expect, it } from 'vitest';
import { applyFrame } from '../../src/ocr/preprocess/color';
import { grayToRgba, type GrayImage, type RgbaImage } from '../../src/ocr/preprocess/image';
import { preprocessGray } from '../../src/ocr/preprocess/pipeline';
import { drawPage, layoutWords } from './syntheticPages';

function toRgba(img: GrayImage): RgbaImage {
  return { data: grayToRgba(img), width: img.width, height: img.height };
}

function pixel(img: RgbaImage, fx: number, fy: number): [number, number, number] {
  const x = Math.min(img.width - 1, Math.round(fx * (img.width - 1)));
  const y = Math.min(img.height - 1, Math.round(fy * (img.height - 1)));
  const i = (y * img.width + x) * 4;
  return [img.data[i]!, img.data[i + 1]!, img.data[i + 2]!];
}

/** White page with a solid red square covering [x0,x1]×[y0,y1] (fractions). */
function redSquarePage(width: number, height: number, x0: number, y0: number, x1: number, y1: number): RgbaImage {
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  for (let y = Math.round(y0 * height); y < Math.round(y1 * height); y++) {
    for (let x = Math.round(x0 * width); x < Math.round(x1 * width); x++) {
      const i = (y * width + x) * 4;
      data[i + 1] = 0;
      data[i + 2] = 0;
    }
  }
  return { data, width, height };
}

function luma([r, g, b]: [number, number, number]): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

describe('color copy of the page (§19.1)', () => {
  it('records crop and straightening, and the replayed color page has the frame of the OCR image', () => {
    const page = drawPage({
      width: 1000, height: 800, boxes: layoutWords({ x: 150, y: 150, w: 700, h: 500 }, 9), angle: 4, border: 60, paper: 200, ink: 60,
    });
    const { image, frame } = preprocessGray(page, { denoise: true, minSide: 0 });
    // The dark border is whitened (grayscale only) then cut away with the margins by the last crop.
    expect(frame.map((s) => s.op)).toEqual(['rotate', 'crop']);

    const color = applyFrame(toRgba(page), frame, 600);
    // Downscaled to 600 px before the crop: the framed page is a bit smaller.
    expect(Math.max(color.width, color.height)).toBeLessThanOrEqual(600);
    expect(Math.max(color.width, color.height)).toBeGreaterThan(400);
    expect(color.width / color.height).toBeCloseTo(image.width / image.height, 1);
    // Same content at the same relative places: ink where the OCR image has ink, paper where it has paper.
    let agree = 0;
    let checked = 0;
    for (let fy = 0.05; fy < 1; fy += 0.05) {
      for (let fx = 0.05; fx < 1; fx += 0.05) {
        const g = image.data[Math.round(fy * (image.height - 1)) * image.width + Math.round(fx * (image.width - 1))]!;
        if (g > 90 && g < 200) continue;
        checked++;
        if ((g <= 90) === (luma(pixel(color, fx, fy)) < 130)) agree++;
      }
    }
    expect(checked).toBeGreaterThan(200);
    expect(agree / checked).toBeGreaterThan(0.9);
  });

  it('keeps the colors through a quarter turn and a perspective frame', () => {
    const page = redSquarePage(400, 300, 0.05, 0.05, 0.25, 0.25);
    const { image, frame } = preprocessGray({ ...page, data: new Uint8ClampedArray(400 * 300).fill(255) }, { rotateDegrees: 90, deskew: false, crop: false, minSide: 0 });
    expect(frame).toEqual([{ op: 'quarter', turn: 90 }]);
    const turned = applyFrame(page, frame);
    expect([turned.width, turned.height]).toEqual([image.width, image.height]);
    // Top-left of the page becomes top-right after a clockwise quarter turn.
    expect(pixel(turned, 0.9, 0.15)).toEqual([255, 0, 0]);
    expect(pixel(turned, 0.1, 0.15)).toEqual([255, 255, 255]);

    const quad: [number, number][] = [[0, 0], [0.5, 0], [0.5, 0.5], [0, 0.5]];
    const framed = preprocessGray({ ...page, data: new Uint8ClampedArray(400 * 300).fill(255) }, { quad, deskew: false, minSide: 0 });
    expect(framed.frame).toEqual([{ op: 'warp', quad }]);
    const warped = applyFrame(page, framed.frame);
    expect(pixel(warped, 0.25, 0.25)).toEqual([255, 0, 0]);
    expect(pixel(warped, 0.8, 0.8)).toEqual([255, 255, 255]);
  });

  it('turns transparent areas (screenshots with alpha) into white paper and caps the size', () => {
    const transparent: RgbaImage = { data: new Uint8ClampedArray(3000 * 10 * 4), width: 3000, height: 10 };
    const out = applyFrame(transparent, []);
    expect([out.width, out.height]).toEqual([2000, 7]);
    expect(pixel(out, 0.5, 0.5)).toEqual([255, 255, 255]);
    expect(out.data[3]).toBe(255);
  });
});
