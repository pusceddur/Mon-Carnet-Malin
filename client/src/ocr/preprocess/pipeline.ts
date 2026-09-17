// Page preprocessing pipeline (pure): photo or rendered page → clean grayscale image for OCR.
import { detectSkewAngle, findContentBounds, whitenBorderBackground } from './deskew';
import { adaptiveThreshold, flattenIllumination, medianFilter3, stretchContrast, toGrayscale } from './filters';
import {
  cropGray,
  isFullFrameQuad,
  resizeGray,
  rotateArbitrary,
  rotateQuarter,
  warpPerspective,
  type QuarterTurn,
} from './geometry';
import type { GrayImage, Point, Rect, RgbaImage } from './image';
import { findTextRegions } from './layout';

export const MAX_PAGE_SIDE = 2480;
export const THUMB_SIDE = 240;
export const ROTATION_PROBE_SIDE = 1000;

export interface PreprocessOptions {
  /** User rotation applied first (clockwise). */
  rotateDegrees?: QuarterTurn;
  /** Page corners, normalized 0..1 in the rotated image (any order). A full-frame quad is ignored. */
  quad?: readonly Point[] | null;
  /** Long side cap. Default 2480. */
  maxSide?: number;
  /** Smaller images are enlarged to this long side (small text reads better). Default 1400; 0 disables. */
  minSide?: number;
  /** Percentile contrast stretch. Default true. */
  stretch?: boolean;
  /** 3×3 median (photos). Default false. */
  denoise?: boolean;
  /** Straighten ±10°. Default true. */
  deskew?: boolean;
  /** Strip dark borders and empty margins. Default true (skipped when a quad is given). */
  crop?: boolean;
  /** Even out uneven lighting (photos). Default true, only with `crop`; no effect on evenly lit pages. */
  flatten?: boolean;
  /** Detect text columns (see findTextRegions). Default true. */
  regions?: boolean;
}

export interface PreprocessResult {
  image: GrayImage;
  /** Detected skew (degrees, clockwise) that was corrected; 0 when none. */
  skewDegrees: number;
  /** Text regions in reading order when the page has columns; empty for a single-region page. */
  regions: Rect[];
}

function fitSize(img: GrayImage, maxSide: number, minSide: number): GrayImage {
  const long = Math.max(img.width, img.height);
  if (long > maxSide) {
    const s = maxSide / long;
    return resizeGray(img, img.width * s, img.height * s);
  }
  if (minSide > 0 && long < minSide) {
    const s = Math.min(maxSide, minSide) / long;
    return resizeGray(img, img.width * s, img.height * s);
  }
  return img;
}

export function normalizeQuarterTurn(degrees: number): QuarterTurn {
  const d = ((Math.round(degrees / 90) * 90) % 360 + 360) % 360;
  return d as QuarterTurn;
}

/** Grayscale pipeline: rotation → perspective → size → contrast → denoise → background → deskew → crop → columns. */
export function preprocessGray(input: GrayImage, options: PreprocessOptions = {}): PreprocessResult {
  const maxSide = options.maxSide ?? MAX_PAGE_SIDE;
  const minSide = options.minSide ?? 1400;
  let img = input;

  const turn = normalizeQuarterTurn(options.rotateDegrees ?? 0);
  if (turn !== 0) img = rotateQuarter(img, turn);

  const quad = options.quad && options.quad.length === 4 && !isFullFrameQuad(options.quad) ? options.quad : null;
  if (quad) {
    const px = quad.map(([x, y]) => [
      Math.min(1, Math.max(0, x)) * (img.width - 1),
      Math.min(1, Math.max(0, y)) * (img.height - 1),
    ] as const);
    img = warpPerspective(img, px, maxSide);
  }

  img = fitSize(img, maxSide, minSide);
  if (options.stretch !== false) img = stretchContrast(img);
  if (options.denoise) img = medianFilter3(img);

  const crop = options.crop !== false && !quad;
  if (crop) {
    // Dark background (table, scanner lid) first, so that it drives neither the skew estimate nor the OCR.
    img = whitenBorderBackground(img);
    if (options.flatten !== false) img = flattenIllumination(img);
    const bounds = findContentBounds(img, { contentInkRatio: 1 });
    if (bounds.width < img.width || bounds.height < img.height) img = cropGray(img, bounds);
  }

  let skewDegrees = 0;
  if (options.deskew !== false) {
    const angle = detectSkewAngle(img);
    if (Math.abs(angle) >= 0.3) {
      img = rotateArbitrary(img, -angle, { expand: true, background: 255 });
      skewDegrees = angle;
    }
  }

  if (crop) {
    const bounds = findContentBounds(img);
    if (bounds.width < img.width || bounds.height < img.height) img = cropGray(img, bounds);
  }
  if (Math.max(img.width, img.height) > maxSide) img = fitSize(img, maxSide, 0);
  return { image: img, skewDegrees, regions: options.regions === false ? [] : findTextRegions(img) };
}

export function preprocessRgba(input: RgbaImage, options: PreprocessOptions = {}): PreprocessResult {
  return preprocessGray(toGrayscale(input), options);
}

/** Sauvola binarization variant, tried when the grayscale OCR is doubtful (uneven light, faded print). */
export function binarizeForOcr(img: GrayImage): GrayImage {
  return adaptiveThreshold(img, { method: 'sauvola' });
}

/** Downscaled copy with the given long side (never enlarges). */
export function thumbnail(img: GrayImage, side: number): GrayImage {
  const long = Math.max(img.width, img.height);
  if (long <= side) return { data: new Uint8ClampedArray(img.data), width: img.width, height: img.height };
  const s = side / long;
  return resizeGray(img, img.width * s, img.height * s);
}

/** Small rotated copies used to find an upside-down or sideways page (no OSD in the OCR engine). */
export function rotationProbes(img: GrayImage, turns: readonly Exclude<QuarterTurn, 0>[], side = ROTATION_PROBE_SIDE): { turn: QuarterTurn; image: GrayImage }[] {
  const small = thumbnail(img, side);
  return turns.map((turn) => ({ turn, image: rotateQuarter(small, turn) }));
}
