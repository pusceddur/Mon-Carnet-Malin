// Pure geometric transforms on grayscale images (image coordinates: x to the right, y downwards).
import { createGray, type GrayImage, type Point, type Rect } from './image';

export type QuarterTurn = 0 | 90 | 180 | 270;

/** Clockwise rotation by a multiple of 90°. */
export function rotateQuarter(img: GrayImage, degrees: QuarterTurn): GrayImage {
  const { width: w, height: h, data: src } = img;
  if (degrees === 0) return { data: new Uint8ClampedArray(src), width: w, height: h };
  if (degrees === 180) {
    const out = createGray(w, h, 0);
    const n = src.length;
    for (let i = 0; i < n; i++) out.data[i] = src[n - 1 - i]!;
    return out;
  }
  const out = createGray(h, w, 0);
  const dst = out.data;
  const ow = h;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = src[y * w + x]!;
      // 90° cw: (x, y) -> (h - 1 - y, x); 270° cw: (x, y) -> (y, w - 1 - x)
      if (degrees === 90) dst[x * ow + (h - 1 - y)] = v;
      else dst[(w - 1 - x) * ow + y] = v;
    }
  }
  return out;
}

/** Bilinear sample with a background value outside the image. */
export function sampleBilinear(img: GrayImage, x: number, y: number, background = 255): number {
  const { width: w, height: h, data } = img;
  if (x < -0.5 || y < -0.5 || x > w - 0.5 || y > h - 0.5) return background;
  const cx = Math.min(Math.max(x, 0), w - 1);
  const cy = Math.min(Math.max(y, 0), h - 1);
  const x0 = Math.floor(cx);
  const y0 = Math.floor(cy);
  const x1 = Math.min(x0 + 1, w - 1);
  const y1 = Math.min(y0 + 1, h - 1);
  const fx = cx - x0;
  const fy = cy - y0;
  const top = data[y0 * w + x0]! * (1 - fx) + data[y0 * w + x1]! * fx;
  const bottom = data[y1 * w + x0]! * (1 - fx) + data[y1 * w + x1]! * fx;
  return top * (1 - fy) + bottom * fy;
}

/**
 * Rotation by an arbitrary angle (degrees, clockwise on screen), bilinear, around the image center.
 * With `expand` (default) the output grows to contain the whole rotated image; new areas get `background`.
 */
export function rotateArbitrary(img: GrayImage, degrees: number, options: { expand?: boolean; background?: number } = {}): GrayImage {
  const { expand = true, background = 255 } = options;
  const rad = (degrees * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const { width: w, height: h } = img;
  const ow = expand ? Math.ceil(Math.abs(w * cos) + Math.abs(h * sin) - 1e-6) : w;
  const oh = expand ? Math.ceil(Math.abs(w * sin) + Math.abs(h * cos) - 1e-6) : h;
  const out = createGray(ow, oh, background);
  const dst = out.data;
  const cxIn = (w - 1) / 2;
  const cyIn = (h - 1) / 2;
  const cxOut = (ow - 1) / 2;
  const cyOut = (oh - 1) / 2;
  for (let y = 0; y < oh; y++) {
    const dy = y - cyOut;
    for (let x = 0; x < ow; x++) {
      const dx = x - cxOut;
      // inverse of the clockwise rotation [c -s; s c]
      const sx = cos * dx + sin * dy + cxIn;
      const sy = -sin * dx + cos * dy + cyIn;
      dst[y * ow + x] = sampleBilinear(img, sx, sy, background);
    }
  }
  return out;
}

/** Resize: area averaging when shrinking an axis, bilinear when enlarging. */
export function resizeGray(img: GrayImage, width: number, height: number): GrayImage {
  const tw = Math.max(1, Math.round(width));
  const th = Math.max(1, Math.round(height));
  const { width: w, height: h, data: src } = img;
  if (tw === w && th === h) return { data: new Uint8ClampedArray(src), width: w, height: h };
  const out = createGray(tw, th, 0);
  const dst = out.data;
  if (tw <= w && th <= h) {
    const sx = w / tw;
    const sy = h / th;
    for (let y = 0; y < th; y++) {
      const y0 = y * sy;
      const y1 = y0 + sy;
      const iy0 = Math.floor(y0);
      const iy1 = Math.min(h, Math.ceil(y1));
      for (let x = 0; x < tw; x++) {
        const x0 = x * sx;
        const x1 = x0 + sx;
        const ix0 = Math.floor(x0);
        const ix1 = Math.min(w, Math.ceil(x1));
        let sum = 0;
        let area = 0;
        for (let yy = iy0; yy < iy1; yy++) {
          const wy = Math.min(yy + 1, y1) - Math.max(yy, y0);
          if (wy <= 0) continue;
          const row = yy * w;
          for (let xx = ix0; xx < ix1; xx++) {
            const wx = Math.min(xx + 1, x1) - Math.max(xx, x0);
            if (wx <= 0) continue;
            sum += src[row + xx]! * wx * wy;
            area += wx * wy;
          }
        }
        dst[y * tw + x] = area > 0 ? sum / area : 255;
      }
    }
    return out;
  }
  const sx = w / tw;
  const sy = h / th;
  for (let y = 0; y < th; y++) {
    const syy = (y + 0.5) * sy - 0.5;
    for (let x = 0; x < tw; x++) {
      dst[y * tw + x] = sampleBilinear(img, (x + 0.5) * sx - 0.5, syy, 255);
    }
  }
  return out;
}

/** Scales so that the long side equals `side` (keeps the aspect ratio). */
export function scaleToLongSide(img: GrayImage, side: number): GrayImage {
  const long = Math.max(img.width, img.height);
  const scale = side / long;
  return resizeGray(img, img.width * scale, img.height * scale);
}

export function cropGray(img: GrayImage, rect: Rect): GrayImage {
  const x = Math.max(0, Math.floor(rect.x));
  const y = Math.max(0, Math.floor(rect.y));
  const width = Math.min(img.width - x, Math.floor(rect.width));
  const height = Math.min(img.height - y, Math.floor(rect.height));
  const out = createGray(Math.max(1, width), Math.max(1, height), 255);
  for (let row = 0; row < out.height; row++) {
    const start = (y + row) * img.width + x;
    out.data.set(img.data.subarray(start, start + out.width), row * out.width);
  }
  return out;
}

// ---------- perspective ----------

/** 3×3 homography, row-major, h[8] normalized to 1. */
export type Homography = readonly [number, number, number, number, number, number, number, number, number];

/** Solves A x = b (Gaussian elimination with partial pivoting). Returns null when singular. */
function solveLinear(a: number[][], b: number[]): number[] | null {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]!]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(m[r]![col]!) > Math.abs(m[pivot]![col]!)) pivot = r;
    if (Math.abs(m[pivot]![col]!) < 1e-12) return null;
    [m[col], m[pivot]] = [m[pivot]!, m[col]!];
    const pivotRow = m[col]!;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const row = m[r]!;
      const factor = row[col]! / pivotRow[col]!;
      if (factor === 0) continue;
      for (let c = col; c <= n; c++) row[c] = row[c]! - factor * pivotRow[c]!;
    }
  }
  return m.map((row, i) => row[n]! / row[i]!);
}

/** Homography mapping the 4 `from` points onto the 4 `to` points. Null for degenerate quads. */
export function solveHomography(from: readonly Point[], to: readonly Point[]): Homography | null {
  if (from.length !== 4 || to.length !== 4) return null;
  const a: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = from[i]!;
    const [u, v] = to[i]!;
    a.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    a.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }
  const s = solveLinear(a, b);
  if (!s) return null;
  return [s[0]!, s[1]!, s[2]!, s[3]!, s[4]!, s[5]!, s[6]!, s[7]!, 1];
}

export function applyHomography(hm: Homography, x: number, y: number): [number, number] {
  const d = hm[6] * x + hm[7] * y + hm[8];
  return [(hm[0] * x + hm[1] * y + hm[2]) / d, (hm[3] * x + hm[4] * y + hm[5]) / d];
}

const distance = (a: Point, b: Point): number => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** Orders 4 points as top-left, top-right, bottom-right, bottom-left. */
export function orderQuad(points: readonly Point[]): [Point, Point, Point, Point] {
  if (points.length !== 4) throw new RangeError('A quad needs exactly 4 points');
  const bySum = [...points].sort((p, q) => p[0] + p[1] - (q[0] + q[1]));
  const byDiff = [...points].sort((p, q) => p[0] - p[1] - (q[0] - q[1]));
  const tl = bySum[0]!;
  const br = bySum[3]!;
  const bl = byDiff[0]!;
  const tr = byDiff[3]!;
  const unique = new Set([tl, tr, br, bl]);
  if (unique.size === 4) return [tl, tr, br, bl];
  // Degenerate ordering (e.g. a thin diamond): fall back to angular order around the centroid.
  const cx = points.reduce((s, p) => s + p[0], 0) / 4;
  const cy = points.reduce((s, p) => s + p[1], 0) / 4;
  const sorted = [...points].sort((p, q) => Math.atan2(p[1] - cy, p[0] - cx) - Math.atan2(q[1] - cy, q[0] - cx));
  const start = sorted.reduce((best, p, i) => (p[0] + p[1] < sorted[best]![0] + sorted[best]![1] ? i : best), 0);
  const rotated = [...sorted.slice(start), ...sorted.slice(0, start)];
  return [rotated[0]!, rotated[1]!, rotated[2]!, rotated[3]!];
}

/**
 * Perspective correction: the quad (pixel coordinates, any order) is mapped to an upright rectangle whose size is the
 * longest opposite edges, capped at `maxSide` on the long side.
 */
export function warpPerspective(img: GrayImage, quad: readonly Point[], maxSide = 2480): GrayImage {
  const [tl, tr, br, bl] = orderQuad(quad);
  let outW = Math.max(distance(tl, tr), distance(bl, br));
  let outH = Math.max(distance(tl, bl), distance(tr, br));
  const long = Math.max(outW, outH);
  if (long > maxSide) {
    outW *= maxSide / long;
    outH *= maxSide / long;
  }
  const ow = Math.max(8, Math.round(outW));
  const oh = Math.max(8, Math.round(outH));
  const hm = solveHomography(
    [[0, 0], [ow - 1, 0], [ow - 1, oh - 1], [0, oh - 1]],
    [tl, tr, br, bl],
  );
  if (!hm) return { data: new Uint8ClampedArray(img.data), width: img.width, height: img.height };
  const out = createGray(ow, oh, 255);
  const dst = out.data;
  for (let y = 0; y < oh; y++) {
    for (let x = 0; x < ow; x++) {
      const [sx, sy] = applyHomography(hm, x, y);
      dst[y * ow + x] = sampleBilinear(img, sx, sy, 255);
    }
  }
  return out;
}

/** True when the normalized quad covers (almost) the whole image: no warp needed. */
export function isFullFrameQuad(quad: readonly Point[], tolerance = 0.005): boolean {
  if (quad.length !== 4) return false;
  const [tl, tr, br, bl] = orderQuad(quad);
  const near = (p: Point, x: number, y: number): boolean => Math.abs(p[0] - x) <= tolerance && Math.abs(p[1] - y) <= tolerance;
  return near(tl, 0, 0) && near(tr, 1, 0) && near(br, 1, 1) && near(bl, 0, 1);
}
