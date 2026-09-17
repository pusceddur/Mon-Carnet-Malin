// Skew detection by projection profiles, and border / content cropping.
import { darkRatio, otsuThreshold } from './filters';
import { resizeGray } from './geometry';
import type { GrayImage, Rect } from './image';

export interface SkewOptions {
  /** Search range ±maxDegrees. Default 10. */
  maxDegrees?: number;
  coarseStep?: number;
  fineStep?: number;
  /** The analysis runs on a copy whose long side is at most this. Default 1000. */
  analysisSide?: number;
  /** Maximum number of ink pixels used. Default 60 000. */
  maxPoints?: number;
}

export function downscaleForAnalysis(img: GrayImage, side: number): GrayImage {
  const long = Math.max(img.width, img.height);
  if (long <= side) return img;
  const scale = side / long;
  return resizeGray(img, img.width * scale, img.height * scale);
}

export interface BackgroundOptions {
  analysisSide?: number;
  /** The dark area connected to the image border must cover at least this share of the border. Default 0.25. */
  minBorderShare?: number;
  /** Mask dilation in analysis pixels (covers anti-aliased page edges). Default 2. */
  dilate?: number;
}

/**
 * Paints white the dark background connected to the image border (table around a photographed page, scanner lid).
 * Text never touches the border, so it is kept. Does nothing when the dark border area is small (an illustration
 * bleeding off one edge). Returns the input when nothing changes.
 */
export function whitenBorderBackground(img: GrayImage, options: BackgroundOptions = {}): GrayImage {
  const { analysisSide = 800, minBorderShare = 0.25, dilate = 2 } = options;
  const small = downscaleForAnalysis(img, analysisSide);
  const { width: w, height: h, data } = small;
  if (w < 3 || h < 3) return img;
  const threshold = otsuThreshold(small);
  const borderIndexes: number[] = [];
  for (let x = 0; x < w; x++) borderIndexes.push(x, (h - 1) * w + x);
  for (let y = 1; y < h - 1; y++) borderIndexes.push(y * w, y * w + w - 1);
  const darkBorder = borderIndexes.map((i) => data[i]!).filter((v) => v <= threshold).sort((a, b) => a - b);
  if (darkBorder.length < borderIndexes.length * minBorderShare) return img;
  // Grow only through values close to the background itself: text printed on a darker area is never swallowed.
  const seed = darkBorder[Math.floor(darkBorder.length / 2)]!;
  const tolerance = Math.max(20, (threshold - seed) * 0.6);
  const mask = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  let top = 0;
  const push = (i: number): void => {
    const v = data[i]!;
    if (mask[i] === 0 && v <= threshold && Math.abs(v - seed) <= tolerance) {
      mask[i] = 1;
      stack[top++] = i;
    }
  };
  for (const i of borderIndexes) push(i);

  while (top > 0) {
    const i = stack[--top]!;
    const x = i % w;
    if (x > 0) push(i - 1);
    if (x < w - 1) push(i + 1);
    if (i >= w) push(i - w);
    if (i < w * (h - 1)) push(i + w);
  }

  // A real background has nothing printed on it: marks clearly darker than the area touching it mean this is a
  // printed page (gray paper, scanned page inside a PDF), which must be kept as it is.
  const markLevel = seed - Math.max(40, tolerance * 1.5);
  let area = 0;
  let marks = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (mask[i] === 1) {
        area++;
        continue;
      }
      if (data[i]! >= markLevel) continue;
      if ((x > 0 && mask[i - 1] === 1) || (x < w - 1 && mask[i + 1] === 1) || (i >= w && mask[i - w] === 1) || (i < w * (h - 1) && mask[i + w] === 1)) {
        marks++;
      }
    }
  }
  if (area === 0 || marks > area * 0.002) return img;

  // Grow over the anti-aliased page edge (lighter than the background), never over darker pixels.
  const floor = seed - tolerance;
  let grown = mask;
  for (let pass = 0; pass < dilate; pass++) {
    const next = new Uint8Array(grown);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (grown[i] === 1 || data[i]! < floor) continue;
        if ((x > 0 && grown[i - 1] === 1) || (x < w - 1 && grown[i + 1] === 1) || (y > 0 && grown[i - w] === 1) || (y < h - 1 && grown[i + w] === 1)) {
          next[i] = 1;
        }
      }
    }
    grown = next;
  }

  const out: GrayImage = { data: new Uint8ClampedArray(img.data), width: img.width, height: img.height };
  const sx = w / img.width;
  const sy = h / img.height;
  for (let y = 0; y < img.height; y++) {
    const row = Math.min(h - 1, Math.floor(y * sy)) * w;
    for (let x = 0; x < img.width; x++) {
      const i = y * img.width + x;
      if (grown[row + Math.min(w - 1, Math.floor(x * sx))] === 1 && out.data[i]! >= floor) out.data[i] = 255;
    }
  }
  return out;
}

/**
 * Angle (degrees) of the text lines, clockwise on screen: lines going down to the right give a positive angle.
 * Rotate by the opposite angle to straighten the page. Returns 0 when no clear orientation is found.
 */
export function detectSkewAngle(img: GrayImage, options: SkewOptions = {}): number {
  const { maxDegrees = 10, coarseStep = 0.5, fineStep = 0.1, analysisSide = 1000, maxPoints = 60_000 } = options;
  const small = downscaleForAnalysis(img, analysisSide);
  const threshold = otsuThreshold(small);
  const { width: w, height: h, data } = small;

  let inkCount = 0;
  for (let i = 0; i < data.length; i++) if (data[i]! <= threshold) inkCount++;
  // Blank page, or mostly dark (photo background): no reliable line structure.
  if (inkCount < 50 || inkCount > data.length * 0.5) return 0;

  const stride = Math.max(1, Math.ceil(inkCount / maxPoints));
  const xs = new Float32Array(Math.ceil(inkCount / stride));
  const ys = new Float32Array(xs.length);
  let n = 0;
  let seen = 0;
  const cx = w / 2;
  const cy = h / 2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[y * w + x]! > threshold) continue;
      if (seen++ % stride !== 0) continue;
      xs[n] = x - cx;
      ys[n] = y - cy;
      n++;
    }
  }

  const diagonal = Math.ceil(Math.hypot(w, h)) + 2;
  const bins = new Float64Array(diagonal);
  const offset = diagonal / 2;
  const score = (degrees: number): number => {
    const rad = (degrees * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    bins.fill(0);
    for (let i = 0; i < n; i++) {
      const b = Math.floor(ys[i]! * cos - xs[i]! * sin + offset);
      if (b >= 0 && b < diagonal) bins[b] = bins[b]! + 1;
    }
    let sum = 0;
    for (let b = 0; b < diagonal; b++) sum += bins[b]! * bins[b]!;
    return sum;
  };

  let best = 0;
  let bestScore = score(0);
  const zeroScore = bestScore;
  for (let a = -maxDegrees; a <= maxDegrees + 1e-9; a += coarseStep) {
    const s = score(a);
    if (s > bestScore) {
      bestScore = s;
      best = a;
    }
  }
  const center = best;
  for (let a = center - coarseStep; a <= center + coarseStep + 1e-9; a += fineStep) {
    if (Math.abs(a) > maxDegrees) continue;
    const s = score(a);
    if (s > bestScore) {
      bestScore = s;
      best = a;
    }
  }
  // Require a clearly sharper profile than the unrotated one.
  if (bestScore < zeroScore * 1.02) return 0;
  return Math.round(best * 100) / 100;
}

function rowDarkRatios(img: GrayImage, threshold: number): Float32Array {
  const { width: w, height: h, data } = img;
  const out = new Float32Array(h);
  for (let y = 0; y < h; y++) {
    let dark = 0;
    for (let x = 0; x < w; x++) if (data[y * w + x]! <= threshold) dark++;
    out[y] = dark / w;
  }
  return out;
}

function colDarkRatios(img: GrayImage, threshold: number): Float32Array {
  const { width: w, height: h, data } = img;
  const out = new Float32Array(w);
  for (let x = 0; x < w; x++) {
    let dark = 0;
    for (let y = 0; y < h; y++) if (data[y * w + x]! <= threshold) dark++;
    out[x] = dark / h;
  }
  return out;
}

function trimEdges(ratios: Float32Array, limit: number, maxTrimFraction: number): [number, number] {
  const n = ratios.length;
  const maxTrim = Math.floor(n * maxTrimFraction);
  let start = 0;
  while (start < maxTrim && ratios[start]! > limit) start++;
  let end = n;
  while (n - end < maxTrim && ratios[end - 1]! > limit) end--;
  return [start, end];
}

export interface CropOptions {
  /** Rows/columns darker than this ratio at the edges are background (table, shadow). Default 0.5. */
  borderDarkRatio?: number;
  /** A row/column holds content when its ink ratio exceeds this. Default 0.002. */
  contentInkRatio?: number;
  /** Margin kept around the content, as a fraction of each dimension. Default 0.02. */
  marginFraction?: number;
  /** Analysis size (long side). Default 800. */
  analysisSide?: number;
}

/**
 * Bounds of the page content: first strips dark background bands at the edges (photo of a page on a table), then keeps
 * the bounding box of the ink with a small margin. Returns the full image when the result would be implausible.
 */
export function findContentBounds(img: GrayImage, options: CropOptions = {}): Rect {
  const { borderDarkRatio = 0.5, contentInkRatio = 0.002, marginFraction = 0.02, analysisSide = 800 } = options;
  const full: Rect = { x: 0, y: 0, width: img.width, height: img.height };
  const small = downscaleForAnalysis(img, analysisSide);
  const scaleX = img.width / small.width;
  const scaleY = img.height / small.height;
  const threshold = otsuThreshold(small);
  if (darkRatio(small, threshold) > 0.85) return full;

  const [top, bottom] = trimEdges(rowDarkRatios(small, threshold), borderDarkRatio, 0.3);
  const [left, right] = trimEdges(colDarkRatios(small, threshold), borderDarkRatio, 0.3);
  if (bottom - top < small.height * 0.3 || right - left < small.width * 0.3) return full;

  // Ink bounding box inside the trimmed area, ignoring the two outermost pixels (edge artefacts).
  const inner: GrayImage = {
    width: right - left,
    height: bottom - top,
    data: new Uint8ClampedArray((right - left) * (bottom - top)),
  };
  for (let y = top; y < bottom; y++) {
    inner.data.set(small.data.subarray(y * small.width + left, y * small.width + right), (y - top) * inner.width);
  }
  const rows = rowDarkRatios(inner, threshold);
  const cols = colDarkRatios(inner, threshold);
  const firstAbove = (arr: Float32Array): number => {
    for (let i = 2; i < arr.length; i++) if (arr[i]! > contentInkRatio) return i;
    return -1;
  };
  const lastAbove = (arr: Float32Array): number => {
    for (let i = arr.length - 3; i >= 0; i--) if (arr[i]! > contentInkRatio) return i;
    return -1;
  };
  const y0 = firstAbove(rows);
  const y1 = lastAbove(rows);
  const x0 = firstAbove(cols);
  const x1 = lastAbove(cols);
  let rect: Rect;
  if (y0 < 0 || x0 < 0 || y1 < y0 || x1 < x0) {
    rect = { x: left, y: top, width: right - left, height: bottom - top };
  } else {
    const marginX = Math.max(4, small.width * marginFraction);
    const marginY = Math.max(4, small.height * marginFraction);
    const ax = Math.max(left, left + x0 - marginX);
    const ay = Math.max(top, top + y0 - marginY);
    const bx = Math.min(right, left + x1 + 1 + marginX);
    const by = Math.min(bottom, top + y1 + 1 + marginY);
    rect = { x: ax, y: ay, width: bx - ax, height: by - ay };
  }
  const scaled: Rect = {
    x: Math.floor(rect.x * scaleX),
    y: Math.floor(rect.y * scaleY),
    width: Math.ceil(rect.width * scaleX),
    height: Math.ceil(rect.height * scaleY),
  };
  scaled.width = Math.min(scaled.width, img.width - scaled.x);
  scaled.height = Math.min(scaled.height, img.height - scaled.y);
  // Too small a crop usually means a mistake (a single word found on a blank page): keep the page.
  if (scaled.width * scaled.height < img.width * img.height * 0.15) return full;
  return scaled;
}
