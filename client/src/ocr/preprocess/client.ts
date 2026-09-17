// Main-thread entry point of the preprocessing: uses the worker when possible, otherwise runs inline.
import { decodeToRgba, encodeGrayJpeg } from './canvas';
import type { GrayImage, Rect, RgbaImage } from './image';
import { MAX_PAGE_SIDE, ROTATION_PROBE_SIDE, THUMB_SIDE, thumbnail, type PreprocessOptions } from './pipeline';
import {
  fromTransfer,
  JPEG_QUALITY,
  runBinarize,
  runPrepare,
  runProbes,
  toTransfer,
  workerCanUseCanvas,
  type ProbeTurn,
  type WorkerRequest,
  type WorkerResponse,
} from './protocol';

export interface PreparedPage {
  /** Processed grayscale page (OCR input, JPEG source). */
  image: GrayImage;
  skewDegrees: number;
  /** Text regions in reading order for pages with columns (empty otherwise). */
  regions: Rect[];
  /** Grayscale JPEG 0.85 (Original view, server OCR, page image upload). */
  jpeg: Blob;
  /** 240 px thumbnail JPEG. */
  thumb: Blob;
}

export class PreprocessAbortedError extends Error {
  constructor() {
    super('preprocess_aborted');
    this.name = 'PreprocessAbortedError';
  }
}

class WorkerUnavailableError extends Error {}

type OkResponse = Extract<WorkerResponse, { ok: true }>;
type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;

class PreprocessClient {
  private worker: Worker | null = null;
  private broken = false;
  private nextId = 1;
  private readonly pending = new Map<number, { resolve: (r: OkResponse) => void; reject: (e: Error) => void }>();

  private getWorker(): Worker | null {
    if (this.broken || typeof Worker !== 'function') return null;
    if (this.worker) return this.worker;
    try {
      const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'preprocess' });
      worker.addEventListener('message', (event: MessageEvent<WorkerResponse>) => this.onMessage(event.data));
      worker.addEventListener('error', (event) => {
        event.preventDefault();
        this.broken = true;
        this.dispose(new WorkerUnavailableError('preprocess_worker_error'));
      });
      this.worker = worker;
      return worker;
    } catch {
      this.broken = true;
      return null;
    }
  }

  private onMessage(response: WorkerResponse): void {
    const entry = this.pending.get(response.id);
    if (!entry) return;
    this.pending.delete(response.id);
    if (response.ok) entry.resolve(response);
    else entry.reject(new Error(response.error));
  }

  private call(worker: Worker, request: DistributiveOmit<WorkerRequest, 'id'>, transfer: Transferable[]): Promise<OkResponse> {
    const id = this.nextId++;
    return new Promise<OkResponse>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try {
        worker.postMessage({ ...request, id } as WorkerRequest, transfer);
      } catch (error) {
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error('post_failed'));
      }
    });
  }

  private dispose(error: Error): void {
    this.worker?.terminate();
    this.worker = null;
    for (const entry of this.pending.values()) entry.reject(error);
    this.pending.clear();
  }

  /** Stops the worker (pagehide); running calls reject with PreprocessAbortedError. */
  terminate(): void {
    this.dispose(new PreprocessAbortedError());
  }

  async preparePage(source: Blob | RgbaImage, options: PreprocessOptions): Promise<PreparedPage> {
    const worker = this.getWorker();
    if (worker) {
      let transferred = false;
      try {
        const canvasInWorker = workerCanUseCanvas();
        let response: OkResponse;
        if (source instanceof Blob && canvasInWorker) {
          response = await this.call(worker, { op: 'prepare', source: { kind: 'blob', blob: source, maxDecodeSide: MAX_PAGE_SIDE }, options, encode: true }, []);
        } else {
          // No OffscreenCanvas in the worker: decode here and transfer the pixel buffer.
          const rgba = source instanceof Blob ? await decodeToRgba(source, MAX_PAGE_SIDE) : source;
          const buffer = rgba.data.byteOffset === 0 && rgba.data.byteLength === rgba.data.buffer.byteLength && rgba.data.buffer instanceof ArrayBuffer
            ? rgba.data.buffer
            : rgba.data.slice().buffer;
          transferred = source instanceof Blob ? false : buffer === rgba.data.buffer;
          response = await this.call(
            worker,
            { op: 'prepare', source: { kind: 'rgba', buffer, width: rgba.width, height: rgba.height }, options, encode: canvasInWorker },
            [buffer],
          );
        }
        if (response.op !== 'prepare') throw new Error('unexpected_response');
        const image = fromTransfer(response.image);
        const jpeg = response.jpeg ?? (await encodeGrayJpeg(image, JPEG_QUALITY));
        const thumb = response.thumb ?? (await encodeGrayJpeg(thumbnail(image, THUMB_SIDE), 0.8));
        return { image, skewDegrees: response.skewDegrees, regions: response.regions, jpeg, thumb };
      } catch (error) {
        // The caller's pixel buffer was moved to the dead worker: nothing left to run inline.
        if (!(error instanceof WorkerUnavailableError) || transferred) throw error;
      }
    }
    const inline = await runPrepare(source, options, true);
    return { image: inline.image, skewDegrees: inline.skewDegrees, regions: inline.regions, jpeg: inline.jpeg!, thumb: inline.thumb! };
  }

  async binarize(image: GrayImage): Promise<GrayImage> {
    const worker = this.getWorker();
    if (worker) {
      try {
        const t = toTransfer({ ...image, data: image.data.slice() });
        const response = await this.call(worker, { op: 'binarize', image: t }, [t.buffer]);
        if (response.op === 'binarize') return fromTransfer(response.image);
      } catch (error) {
        if (!(error instanceof WorkerUnavailableError)) throw error;
      }
    }
    return runBinarize(image);
  }

  async rotationProbes(image: GrayImage, turns: ProbeTurn[], side = ROTATION_PROBE_SIDE): Promise<{ turn: ProbeTurn; image: GrayImage }[]> {
    const worker = this.getWorker();
    if (worker) {
      try {
        const t = toTransfer({ ...image, data: image.data.slice() });
        const response = await this.call(worker, { op: 'probes', image: t, turns, side }, [t.buffer]);
        if (response.op === 'probes') return response.images.map((p) => ({ turn: p.turn, image: fromTransfer(p.image) }));
      } catch (error) {
        if (!(error instanceof WorkerUnavailableError)) throw error;
      }
    }
    return runProbes(image, turns, side);
  }
}

/** Long side of the last-resort preparation (≈ 4 times less memory than the normal 2480 px). */
export const FALLBACK_PAGE_SIDE = 1600;

/**
 * Last resort when the normal preprocessing failed (typically memory on iPad): smaller image, main thread,
 * no deskew / denoise / lighting correction / column detection. Still good enough for the server reading.
 */
export async function prepareFallbackPage(source: Blob | RgbaImage, options: PreprocessOptions): Promise<PreparedPage> {
  const inline = await runPrepare(
    source,
    { ...options, maxSide: FALLBACK_PAGE_SIDE, deskew: false, denoise: false, flatten: false, regions: false },
    true,
    FALLBACK_PAGE_SIDE,
  );
  return { image: inline.image, skewDegrees: 0, regions: [], jpeg: inline.jpeg!, thumb: inline.thumb! };
}

const client = new PreprocessClient();

export const preparePage = (source: Blob | RgbaImage, options: PreprocessOptions): Promise<PreparedPage> => client.preparePage(source, options);
export const binarizeImage = (image: GrayImage): Promise<GrayImage> => client.binarize(image);
export const rotationProbeImages = (image: GrayImage, turns: ProbeTurn[], side?: number): Promise<{ turn: ProbeTurn; image: GrayImage }[]> =>
  client.rotationProbes(image, turns, side);
export const terminatePreprocessWorker = (): void => client.terminate();
