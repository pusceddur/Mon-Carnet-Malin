// Messages exchanged with the preprocessing worker, and the shared operations both sides run.
import { decodeToRgba, encodeGrayJpeg, hasOffscreenCanvas } from './canvas';
import type { QuarterTurn } from './geometry';
import type { GrayImage, Rect, RgbaImage } from './image';
import { binarizeForOcr, MAX_PAGE_SIDE, preprocessRgba, rotationProbes, THUMB_SIDE, thumbnail, type PreprocessOptions } from './pipeline';

export interface TransferGray {
  buffer: ArrayBuffer;
  width: number;
  height: number;
}

export type ProbeTurn = Exclude<QuarterTurn, 0>;

export type PrepareSource =
  | { kind: 'blob'; blob: Blob; maxDecodeSide: number }
  | { kind: 'rgba'; buffer: ArrayBuffer; width: number; height: number };

export type WorkerRequest =
  | { id: number; op: 'prepare'; source: PrepareSource; options: PreprocessOptions; encode: boolean }
  | { id: number; op: 'binarize'; image: TransferGray }
  | { id: number; op: 'probes'; image: TransferGray; turns: ProbeTurn[]; side: number };

export type WorkerResponse =
  | { id: number; ok: true; op: 'prepare'; image: TransferGray; skewDegrees: number; regions: Rect[]; jpeg: Blob | null; thumb: Blob | null }
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
}

/** Decode (if needed) → preprocess → optional JPEG + thumbnail encoding. Runs in the worker or inline. */
export async function runPrepare(source: Blob | RgbaImage, options: PreprocessOptions, encode: boolean, maxDecodeSide = MAX_PAGE_SIDE): Promise<PreparedImages> {
  const rgba = source instanceof Blob ? await decodeToRgba(source, maxDecodeSide) : source;
  const { image, skewDegrees, regions } = preprocessRgba(rgba, options);
  if (!encode) return { image, skewDegrees, regions, jpeg: null, thumb: null };
  const jpeg = await encodeGrayJpeg(image, JPEG_QUALITY);
  const thumb = await encodeGrayJpeg(thumbnail(image, THUMB_SIDE), 0.8);
  return { image, skewDegrees, regions, jpeg, thumb };
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
