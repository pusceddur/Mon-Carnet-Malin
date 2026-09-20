// Messages exchanged with the preprocessing worker, and the shared operations both sides run.
import { decodeToRgba, encodeGrayJpeg, encodeRgbaJpeg, hasOffscreenCanvas } from './canvas';
import { applyFrame, COLOR_JPEG_QUALITY } from './color';
import type { QuarterTurn } from './geometry';
import type { GrayImage, Rect, RgbaImage } from './image';
import { binarizeForOcr, MAX_PAGE_SIDE, preprocessRgba, rotationProbes, THUMB_SIDE, thumbnail, type PreprocessOptions } from './pipeline';

export interface TransferGray {
  buffer: ArrayBuffer;
  width: number;
  height: number;
}

export type ProbeTurn = Exclude<QuarterTurn, 0>;

/** RGBA pixels moved between threads (color copy when the worker cannot encode JPEG). */
export interface TransferRgba {
  buffer: ArrayBuffer;
  width: number;
  height: number;
}

/** Color copy of the page (§19.1), same frame as the grayscale image. */
export interface ColorPage {
  jpeg: Blob;
  width: number;
  height: number;
}

export type PrepareSource =
  | { kind: 'blob'; blob: Blob; maxDecodeSide: number }
  | { kind: 'rgba'; buffer: ArrayBuffer; width: number; height: number };

export type WorkerRequest =
  | { id: number; op: 'prepare'; source: PrepareSource; options: PreprocessOptions; encode: boolean; color: boolean }
  | { id: number; op: 'binarize'; image: TransferGray }
  | { id: number; op: 'probes'; image: TransferGray; turns: ProbeTurn[]; side: number };

export type WorkerResponse =
  | {
      id: number; ok: true; op: 'prepare'; image: TransferGray; skewDegrees: number; regions: Rect[]; jpeg: Blob | null; thumb: Blob | null;
      /** Encoded color copy (worker with canvas), or its pixels to encode on the main thread, or neither. */
      color: ColorPage | null; colorPixels: TransferRgba | null;
    }
  | { id: number; ok: true; op: 'binarize'; image: TransferGray }
  | { id: number; ok: true; op: 'probes'; images: { turn: ProbeTurn; image: TransferGray }[] }
  | { id: number; ok: false; error: string };

/** Detaches-safe buffer of a gray image (copies when the array is a view on a larger buffer). */
export function toTransfer(img: GrayImage): TransferGray {
  const { data } = img;
  const exact = data.byteOffset === 0 && data.byteLength === data.buffer.byteLength && data.buffer instanceof ArrayBuffer;
  const buffer = exact ? (data.buffer as ArrayBuffer) : data.slice().buffer;
  return { buffer, width: img.width, height: img.height };
}

export function fromTransfer(t: TransferGray): GrayImage {
  return { data: new Uint8ClampedArray(t.buffer), width: t.width, height: t.height };
}

export const JPEG_QUALITY = 0.85;

export interface PreparedImages {
  image: GrayImage;
  skewDegrees: number;
  regions: Rect[];
  jpeg: Blob | null;
  thumb: Blob | null;
  /** Encoded color copy (when `encode`). */
  color: ColorPage | null;
  /** Color copy not encoded yet (when not `encode`). */
  colorPixels: RgbaImage | null;
}

/** RGBA → transferable buffer (copies when the array is a view on a larger buffer). */
export function toTransferRgba(img: RgbaImage): TransferRgba {
  const { data } = img;
  const exact = data.byteOffset === 0 && data.byteLength === data.buffer.byteLength && data.buffer instanceof ArrayBuffer;
  return { buffer: exact ? (data.buffer as ArrayBuffer) : data.slice().buffer, width: img.width, height: img.height };
}

export function fromTransferRgba(t: TransferRgba): RgbaImage {
  return { data: new Uint8ClampedArray(t.buffer), width: t.width, height: t.height };
}

/** Color copy JPEG + color thumbnail. */
export async function encodeColorPage(pixels: RgbaImage): Promise<{ color: ColorPage; thumb: Blob }> {
  const jpeg = await encodeRgbaJpeg(pixels, COLOR_JPEG_QUALITY);
  const thumb = await encodeRgbaJpeg(applyFrame(pixels, [], THUMB_SIDE), 0.8);
  return { color: { jpeg, width: pixels.width, height: pixels.height }, thumb };
}

/**
 * Decode (if needed) → preprocess → optional JPEG + thumbnail encoding. Runs in the worker or inline. With `color`, the
 * decoded page is also framed like the grayscale image (§19.1); a failure there only drops the color copy.
 */
export async function runPrepare(
  source: Blob | RgbaImage, options: PreprocessOptions, encode: boolean, maxDecodeSide = MAX_PAGE_SIDE, color = true,
): Promise<PreparedImages> {
  const rgba = source instanceof Blob ? await decodeToRgba(source, maxDecodeSide) : source;
  const { image, skewDegrees, regions, frame } = preprocessRgba(rgba, options);
  let colorPixels: RgbaImage | null = null;
  if (color) {
    try {
      colorPixels = applyFrame(rgba, frame);
    } catch {
      colorPixels = null;
    }
  }
  if (!encode) return { image, skewDegrees, regions, jpeg: null, thumb: null, color: null, colorPixels };
  const jpeg = await encodeGrayJpeg(image, JPEG_QUALITY);
  if (colorPixels) {
    try {
      const encoded = await encodeColorPage(colorPixels);
      return { image, skewDegrees, regions, jpeg, thumb: encoded.thumb, color: encoded.color, colorPixels: null };
    } catch {
      // The grayscale page is enough to go on.
    }
  }
  const thumb = await encodeGrayJpeg(thumbnail(image, THUMB_SIDE), 0.8);
  return { image, skewDegrees, regions, jpeg, thumb, color: null, colorPixels: null };
}

export function runBinarize(image: GrayImage): GrayImage {
  return binarizeForOcr(image);
}

export function runProbes(image: GrayImage, turns: ProbeTurn[], side: number): { turn: ProbeTurn; image: GrayImage }[] {
  return rotationProbes(image, turns, side).map((p) => ({ turn: p.turn as ProbeTurn, image: p.image }));
}

/** Whether a worker can decode blobs and encode JPEG by itself. */
export function workerCanUseCanvas(): boolean {
  return hasOffscreenCanvas() && typeof createImageBitmap === 'function';
}
