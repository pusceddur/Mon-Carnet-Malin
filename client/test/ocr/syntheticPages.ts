// Synthetic « text pages » for preprocessing tests: word-like dark rectangles on lines, drawn analytically so that the
// expected geometry (skew, bounds) is known exactly.
import type { GrayImage } from '../../src/ocr/preprocess/image';

export interface WordBox { x: number; y: number; w: number; h: number }

/** Deterministic pseudo-random generator (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Word boxes filling a text area: lines every `lineGap` px, words of random width. */
export function layoutWords(area: { x: number; y: number; w: number; h: number }, seed = 7, lineGap = 28, wordHeight = 12): WordBox[] {
  const random = rng(seed);
  const boxes: WordBox[] = [];
  for (let y = area.y; y + wordHeight <= area.y + area.h; y += lineGap) {
    let x = area.x;
    while (true) {
      const w = 14 + Math.floor(random() * 50);
      if (x + w > area.x + area.w) break;
      boxes.push({ x, y, w, h: wordHeight });
      x += w + 10;
    }
  }
  return boxes;
}

export interface DrawOptions {
  width: number;
  height: number;
  boxes: WordBox[];
  /** Clockwise rotation (degrees) of the whole page content around the image center. */
  angle?: number;
  ink?: number;
  paper?: number | ((x: number, y: number) => number);
  /** Dark band (table) of this many pixels around the page. */
  border?: number;
  borderValue?: number;
}

export function drawPage(options: DrawOptions): GrayImage {
  const { width, height, boxes, angle = 0, ink = 20, paper = 245, border = 0, borderValue = 40 } = options;
  const data = new Uint8ClampedArray(width * height);
  const mask = new Uint8Array(width * height);
  for (const b of boxes) {
    for (let yy = Math.max(0, b.y); yy < Math.min(height, b.y + b.h); yy++) {
      for (let xx = Math.max(0, b.x); xx < Math.min(width, b.x + b.w); xx++) mask[yy * width + xx] = 1;
    }
  }
  const rad = (angle * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const cx = (width - 1) / 2;
  const cy = (height - 1) / 2;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (x < border || y < border || x >= width - border || y >= height - border) {
        data[i] = borderValue;
        continue;
      }
      // Undo the clockwise rotation to find the point in the upright layout.
      const dx = x - cx;
      const dy = y - cy;
      const ux = cos * dx + sin * dy + cx;
      const uy = -sin * dx + cos * dy + cy;
      const base = typeof paper === 'function' ? paper(x, y) : paper;
      const mx = Math.floor(ux);
      const my = Math.floor(uy);
      const inside = mx >= 0 && my >= 0 && mx < width && my < height && mask[my * width + mx] === 1;
      data[i] = inside ? (typeof paper === 'function' ? Math.max(0, base - (245 - ink)) : ink) : base;
    }
  }
  return { data, width, height };
}

export function meanAbsDiff(a: GrayImage, b: GrayImage): number {
  if (a.width !== b.width || a.height !== b.height) throw new Error('size mismatch');
  let sum = 0;
  for (let i = 0; i < a.data.length; i++) sum += Math.abs(a.data[i]! - b.data[i]!);
  return sum / a.data.length;
}
