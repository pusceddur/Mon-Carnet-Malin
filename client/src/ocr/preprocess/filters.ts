// Pure pixel filters on grayscale images.
import { createGray, type GrayImage, type RgbaImage } from './image';

/** Luma (BT.601) composited over white, so transparent PNG areas become paper. */
export function toGrayscale(img: RgbaImage): GrayImage {
  const out = createGray(img.width, img.height, 0);
  const src = img.data;
  const dst = out.data;
  for (let i = 0, j = 0; j < dst.length; i += 4, j++) {
    const alpha = src[i + 3]! / 255;
    const luma = 0.299 * src[i]! + 0.587 * src[i + 1]! + 0.114 * src[i + 2]!;
    dst[j] = luma * alpha + 255 * (1 - alpha);
  }
  return out;
}

export function histogram(img: GrayImage): Uint32Array {
  const hist = new Uint32Array(256);
  const data = img.data;
  for (let i = 0; i < data.length; i++) hist[data[i]!]!++;
  return hist;
}

function percentileValue(hist: Uint32Array, total: number, fraction: number): number {
  const target = Math.max(0, Math.min(total - 1, Math.floor(total * fraction)));
  let acc = 0;
  for (let v = 0; v < 256; v++) {
    acc += hist[v]!;
    if (acc > target) return v;
  }
  return 255;
}

export interface StretchOptions {
  /** Fraction of darkest pixels mapped to 0. Default 0.01. */
  lowFraction?: number;
  /** Fraction of brightest pixels mapped to 255. Default 0.01. */
  highFraction?: number;
  /** Below this input range the image is returned unchanged (flat image). Default 16. */
  minRange?: number;
}

/** Linear contrast stretch between two percentiles (robust to a few outliers). */
export function stretchContrast(img: GrayImage, options: StretchOptions = {}): GrayImage {
  const { lowFraction = 0.01, highFraction = 0.01, minRange = 16 } = options;
  const total = img.data.length;
  const hist = histogram(img);
  const lo = percentileValue(hist, total, lowFraction);
  const hi = percentileValue(hist, total, 1 - highFraction);
  const out = createGray(img.width, img.height, 0);
  if (hi - lo < minRange) {
    out.data.set(img.data);
    return out;
  }
  const lut = new Uint8ClampedArray(256);
  const scale = 255 / (hi - lo);
  for (let v = 0; v < 256; v++) lut[v] = (v - lo) * scale;
  const src = img.data;
  const dst = out.data;
  for (let i = 0; i < total; i++) dst[i] = lut[src[i]!]!;
  return out;
}

// Compare-exchange for the median network.
function exchange(p: Int32Array, a: number, b: number): void {
  const x = p[a]!;
  const y = p[b]!;
  if (x > y) {
    p[a] = y;
    p[b] = x;
  }
}

// Median of 9 values with a 19-exchange sorting network (Paeth).
function median9(p: Int32Array): number {
  exchange(p, 1, 2); exchange(p, 4, 5); exchange(p, 7, 8); exchange(p, 0, 1); exchange(p, 3, 4); exchange(p, 6, 7);
  exchange(p, 1, 2); exchange(p, 4, 5); exchange(p, 7, 8); exchange(p, 0, 3); exchange(p, 5, 8); exchange(p, 4, 7);
  exchange(p, 3, 6); exchange(p, 1, 4); exchange(p, 2, 5); exchange(p, 4, 7); exchange(p, 4, 2); exchange(p, 6, 4);
  exchange(p, 4, 2);
  return p[4]!;
}

/** 3×3 median filter (removes salt-and-pepper / sensor noise), edges replicated. */
export function medianFilter3(img: GrayImage): GrayImage {
  const { width: w, height: h, data: src } = img;
  const out = createGray(w, h, 0);
  const dst = out.data;
  const win = new Int32Array(9);
  for (let y = 0; y < h; y++) {
    const y0 = (y > 0 ? y - 1 : 0) * w;
    const y1 = y * w;
    const y2 = (y < h - 1 ? y + 1 : h - 1) * w;
    for (let x = 0; x < w; x++) {
      const x0 = x > 0 ? x - 1 : 0;
      const x2 = x < w - 1 ? x + 1 : w - 1;
      win[0] = src[y0 + x0]!; win[1] = src[y0 + x]!; win[2] = src[y0 + x2]!;
      win[3] = src[y1 + x0]!; win[4] = src[y1 + x]!; win[5] = src[y1 + x2]!;
      win[6] = src[y2 + x0]!; win[7] = src[y2 + x]!; win[8] = src[y2 + x2]!;
      dst[y1 + x] = median9(win);
    }
  }
  return out;
}

/** Otsu global threshold: pixels ≤ returned value are foreground (ink). */
export function otsuThreshold(img: GrayImage): number {
  const hist = histogram(img);
  const total = img.data.length;
  let sumAll = 0;
  for (let v = 0; v < 256; v++) sumAll += v * hist[v]!;
  let sumBg = 0;
  let weightBg = 0;
  let best = 0;
  let bestT = 127;
  for (let t = 0; t < 256; t++) {
    weightBg += hist[t]!;
    if (weightBg === 0) continue;
    const weightFg = total - weightBg;
    if (weightFg === 0) break;
    sumBg += t * hist[t]!;
    const meanBg = sumBg / weightBg;
    const meanFg = (sumAll - sumBg) / weightFg;
    const between = weightBg * weightFg * (meanBg - meanFg) * (meanBg - meanFg);
    if (between > best) {
      best = between;
      bestT = t;
    }
  }
  return bestT;
}

export interface AdaptiveThresholdOptions {
  /** 'sauvola' (default, robust to uneven light) or 'bradley' (local mean). */
  method?: 'sauvola' | 'bradley';
  /** Window side in pixels. Default: long side / 40, clamped to 15..101. */
  window?: number;
  /** Sauvola k. Default 0.34. */
  k?: number;
  /** Sauvola dynamic range of the standard deviation. Default 128. */
  r?: number;
  /** Bradley: pixel is ink when darker than (1 - t) × local mean. Default 0.15. */
  t?: number;
  /**
   * Local statistics are computed on blocks of this many pixels per side (exact first and second moments per block),
   * which bounds memory on large pages. Default: 1 up to 2 MP, then grows with the image.
   */
  blockSize?: number;
}

/**
 * Adaptive binarization (Sauvola or Bradley) with integral images. Output: 0 = ink, 255 = paper.
 * Local mean and variance come from integral images of per-block sums of I and I², so the window statistics are exact
 * at block granularity.
 */
export function adaptiveThreshold(img: GrayImage, options: AdaptiveThresholdOptions = {}): GrayImage {
  const { width: w, height: h, data: src } = img;
  const method = options.method ?? 'sauvola';
  const k = options.k ?? 0.34;
  const r = options.r ?? 128;
  const t = options.t ?? 0.15;
  const window = options.window ?? Math.min(101, Math.max(15, Math.round(Math.max(w, h) / 40)));
  const f = Math.max(1, Math.floor(options.blockSize ?? Math.ceil(Math.sqrt((w * h) / 2_000_000))));

  const bw = Math.ceil(w / f);
  const bh = Math.ceil(h / f);
  const s1 = new Float64Array(bw * bh);
  const s2 = new Float64Array(bw * bh);
  const cnt = new Float64Array(bw * bh);
  for (let y = 0; y < h; y++) {
    const by = ((y / f) | 0) * bw;
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const b = by + ((x / f) | 0);
      const v = src[row + x]!;
      s1[b] = s1[b]! + v;
      s2[b] = s2[b]! + v * v;
      cnt[b] = cnt[b]! + 1;
    }
  }

  const iw = bw + 1;
  const i1 = new Float64Array(iw * (bh + 1));
  const i2 = new Float64Array(iw * (bh + 1));
  const ic = new Float64Array(iw * (bh + 1));
  for (let by = 0; by < bh; by++) {
    let r1 = 0;
    let r2 = 0;
    let rc = 0;
    for (let bx = 0; bx < bw; bx++) {
      const b = by * bw + bx;
      r1 += s1[b]!;
      r2 += s2[b]!;
      rc += cnt[b]!;
      const o = (by + 1) * iw + bx + 1;
      i1[o] = i1[o - iw]! + r1;
      i2[o] = i2[o - iw]! + r2;
      ic[o] = ic[o - iw]! + rc;
    }
  }

  const radius = Math.max(1, Math.round(window / (2 * f)));
  const thresholds = new Float32Array(bw * bh);
  for (let by = 0; by < bh; by++) {
    const ya = Math.max(0, by - radius);
    const yb = Math.min(bh, by + radius + 1);
    for (let bx = 0; bx < bw; bx++) {
      const xa = Math.max(0, bx - radius);
      const xb = Math.min(bw, bx + radius + 1);
      const A = ya * iw + xa;
      const B = ya * iw + xb;
      const C = yb * iw + xa;
      const D = yb * iw + xb;
      const n = ic[D]! - ic[B]! - ic[C]! + ic[A]!;
      const mean = (i1[D]! - i1[B]! - i1[C]! + i1[A]!) / n;
      if (method === 'bradley') {
        thresholds[by * bw + bx] = mean * (1 - t);
      } else {
        const variance = Math.max(0, (i2[D]! - i2[B]! - i2[C]! + i2[A]!) / n - mean * mean);
        thresholds[by * bw + bx] = mean * (1 + k * (Math.sqrt(variance) / r - 1));
      }
    }
  }

  const out = createGray(w, h, 0);
  const dst = out.data;
  for (let y = 0; y < h; y++) {
    const by = ((y / f) | 0) * bw;
    const row = y * w;
    for (let x = 0; x < w; x++) {
      dst[row + x] = src[row + x]! <= thresholds[by + ((x / f) | 0)]! ? 0 : 255;
    }
  }
  return out;
}

export interface FlattenOptions {
  /** Block side for the paper estimate. Default: long side / 64, at least 8 px. */
  blockSize?: number;
  /** Paper percentile inside a block. Default 0.9. */
  percentile?: number;
  /** Below this spread of the paper estimate (p95 − p5), lighting is considered even: image unchanged. Default 30. */
  minSpread?: number;
}

/**
 * Evens out the lighting of a photographed page (lamp shadow, vignetting) by dividing by a smooth estimate of the
 * paper brightness. The result stays grayscale (fine for display and for the OCR engine's own binarization).
 * Returns the input when the lighting is already even.
 */
export function flattenIllumination(img: GrayImage, options: FlattenOptions = {}): GrayImage {
  const { width: w, height: h, data: src } = img;
  const block = Math.max(16, Math.round(options.blockSize ?? Math.max(w, h) / 64));
  const percentile = options.percentile ?? 0.9;
  const minSpread = options.minSpread ?? 30;
  const gw = Math.ceil(w / block);
  const gh = Math.ceil(h / block);
  let grid: Float32Array = new Float32Array(gw * gh);
  const hist = new Uint32Array(256);
  for (let by = 0; by < gh; by++) {
    for (let bx = 0; bx < gw; bx++) {
      hist.fill(0);
      const x1 = Math.min(w, (bx + 1) * block);
      const y1 = Math.min(h, (by + 1) * block);
      let count = 0;
      for (let y = by * block; y < y1; y++) {
        for (let x = bx * block; x < x1; x++) {
          const v = src[y * w + x]!;
          hist[v] = hist[v]! + 1;
          count++;
        }
      }
      const target = Math.floor(count * percentile);
      let acc = 0;
      let value = 255;
      for (let v = 0; v < 256; v++) {
        acc += hist[v]!;
        if (acc > target) {
          value = v;
          break;
        }
      }
      grid[by * gw + bx] = value;
    }
  }

  if (grid.length < 4) return img;

  // Blocks covered by ink (large letters, pictures) are much darker than their neighbours: they take the neighbourhood
  // median. Gradual lighting changes are kept, then the estimate is smoothed.
  const neighbourhood = (input: Float32Array, mode: 'fill' | 'mean'): Float32Array => {
    const out = new Float32Array(input.length);
    const values: number[] = [];
    for (let by = 0; by < gh; by++) {
      for (let bx = 0; bx < gw; bx++) {
        values.length = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const x = bx + dx;
            const y = by + dy;
            if (x >= 0 && y >= 0 && x < gw && y < gh) values.push(input[y * gw + x]!);
          }
        }
        const own = input[by * gw + bx]!;
        if (mode === 'mean') {
          out[by * gw + bx] = values.reduce((s, v) => s + v, 0) / values.length;
        } else {
          values.sort((a, b) => a - b);
          const median = values[Math.floor(values.length / 2)]!;
          out[by * gw + bx] = own < median * 0.75 ? median : own;
        }
      }
    }
    return out;
  };
  grid = neighbourhood(grid, 'fill');
  const sorted = Array.from(grid).sort((a, b) => a - b);
  const spread = sorted[Math.floor(sorted.length * 0.95)]! - sorted[Math.floor(sorted.length * 0.05)]!;
  if (spread < minSpread) return img;
  grid = neighbourhood(grid, 'mean');
  grid = neighbourhood(grid, 'mean');

  const out = createGray(w, h, 0);
  const dst = out.data;
  for (let y = 0; y < h; y++) {
    const gy = Math.min(gh - 1, Math.max(0, y / block - 0.5));
    const y0 = Math.floor(gy);
    const y1 = Math.min(gh - 1, y0 + 1);
    const fy = gy - y0;
    for (let x = 0; x < w; x++) {
      const gx = Math.min(gw - 1, Math.max(0, x / block - 0.5));
      const x0 = Math.floor(gx);
      const x1 = Math.min(gw - 1, x0 + 1);
      const fx = gx - x0;
      const top = grid[y0 * gw + x0]! * (1 - fx) + grid[y0 * gw + x1]! * fx;
      const bottom = grid[y1 * gw + x0]! * (1 - fx) + grid[y1 * gw + x1]! * fx;
      const background = Math.max(1, top * (1 - fy) + bottom * fy);
      dst[y * w + x] = (src[y * w + x]! * 255) / background;
    }
  }
  return out;
}

/** Fraction of pixels darker than or equal to `threshold`. */
export function darkRatio(img: GrayImage, threshold: number): number {
  let dark = 0;
  const data = img.data;
  for (let i = 0; i < data.length; i++) if (data[i]! <= threshold) dark++;
  return data.length === 0 ? 0 : dark / data.length;
}
