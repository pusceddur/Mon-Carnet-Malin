// Plain image containers used by the pure preprocessing functions (no DOM, runnable in workers and Node).

/** 8-bit RGBA pixels, row-major (same layout as ImageData). */
export interface RgbaImage {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/** 8-bit grayscale pixels, row-major, 0 = black, 255 = white. */
export interface GrayImage {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export type Point = readonly [number, number];

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function createGray(width: number, height: number, fill = 255): GrayImage {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new RangeError(`Invalid image size ${width}x${height}`);
  }
  const data = new Uint8ClampedArray(width * height);
  if (fill !== 0) data.fill(fill);
  return { data, width, height };
}

export function cloneGray(img: GrayImage): GrayImage {
  return { data: new Uint8ClampedArray(img.data), width: img.width, height: img.height };
}

export function longSide(img: { width: number; height: number }): number {
  return Math.max(img.width, img.height);
}

/** Gray → RGBA (opaque), e.g. for ImageData / canvas encoding. */
export function grayToRgba(img: GrayImage): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(img.width * img.height * 4);
  const src = img.data;
  for (let i = 0, j = 0; i < src.length; i++, j += 4) {
    const v = src[i]!;
    out[j] = v;
    out[j + 1] = v;
    out[j + 2] = v;
    out[j + 3] = 255;
  }
  return out;
}

/** Binary PGM (P5): read natively by the OCR engine, no image codec needed. */
export function encodePgm(img: GrayImage): Uint8Array {
  const header = new TextEncoder().encode(`P5\n${img.width} ${img.height}\n255\n`);
  const out = new Uint8Array(header.length + img.data.length);
  out.set(header, 0);
  out.set(img.data, header.length);
  return out;
}
