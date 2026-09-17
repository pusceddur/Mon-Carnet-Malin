// On-device OCR with tesseract.js 7 (French), assets self-hosted under /ocr/ (contract §15.6).
// One worker at a time, recreated every RECYCLE_AFTER_PAGES pages to give memory back on iPad.
import type { OcrResult } from './ocrLines';
import { tesseractPageToOcrResult, type TesseractPageLike } from './ocrLines';
import { describeError, reportProblem } from '../platform/diagnostics';

export const OCR_ASSET_BASE = '/ocr/';
export const RECYCLE_AFTER_PAGES = 10;
/** First start downloads ~5 MB (engine + French model) on a mobile connection. */
export const CREATE_WORKER_TIMEOUT_MS = 180_000;
export const RECOGNIZE_TIMEOUT_MS = 180_000;

export class OcrUnavailableError extends Error {
  constructor(message = 'ocr_unavailable') {
    super(message);
    this.name = 'OcrUnavailableError';
  }
}

export interface OcrEngine {
  /** Recognizes an encoded image (PGM, PNG, JPEG bytes or Blob). */
  recognize(image: Uint8Array | Blob): Promise<OcrResult>;
  /** Counts a finished page; the worker is recycled after RECYCLE_AFTER_PAGES pages. */
  notePageDone(): void;
  /** Stops the worker (pagehide, memory pressure). A later call starts a new one. */
  terminate(): Promise<void>;
}

interface TesseractWorkerLike {
  recognize(image: Uint8Array | Blob, options: Record<string, never>, output: { text: boolean; blocks: boolean }): Promise<{ data: TesseractPageLike }>;
  terminate(): Promise<unknown>;
}

type WorkerFactory = () => Promise<TesseractWorkerLike>;

/** Rejects when the promise does not settle in time (a worker that dies silently must not block the queue). */
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label}_timeout`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function defaultFactory(): Promise<TesseractWorkerLike> {
  if (typeof WebAssembly !== 'object' || typeof Worker !== 'function') {
    const error = new OcrUnavailableError('wasm_or_worker_missing');
    reportProblem('ocr_engine', error, 'capabilities');
    throw error;
  }
  let createWorker: typeof import('tesseract.js').createWorker;
  try {
    ({ createWorker } = await import('tesseract.js'));
  } catch (error) {
    reportProblem('ocr_engine', error, 'import_engine');
    throw new OcrUnavailableError(`import_failed: ${describeError(error)}`);
  }
  const origin = typeof location === 'undefined' ? '' : location.origin;
  const base = `${origin}${OCR_ASSET_BASE}`;
  const failures: string[] = [];
  // Direct worker URL first; some WebKit builds only start the worker from a blob URL that imports the script.
  for (const workerBlobURL of [false, true]) {
    try {
      // OEM 1 = LSTM only (4.0.0_best_int model). The worker caches the model in IndexedDB after the first load.
      const worker = await withTimeout(
        createWorker('fra', 1, {
          workerPath: `${base}worker.min.js`,
          corePath: base,
          langPath: base,
          gzip: true,
          workerBlobURL,
        }),
        CREATE_WORKER_TIMEOUT_MS,
        'create_worker',
      );
      if (failures.length > 0) reportProblem('ocr_engine', new Error(failures.join(' | ')), 'create_worker_recovered', { workerBlobURL });
      return worker as unknown as TesseractWorkerLike;
    } catch (error) {
      failures.push(`${workerBlobURL ? 'blob' : 'direct'}: ${describeError(error)}`);
    }
  }
  const error = new OcrUnavailableError(failures.join(' | '));
  reportProblem('ocr_engine', error, 'create_worker');
  throw error;
}

export class BrowserOcrEngine implements OcrEngine {
  private worker: Promise<TesseractWorkerLike> | null = null;
  private pagesDone = 0;

  constructor(private readonly factory: WorkerFactory = defaultFactory) {}

  private getWorker(): Promise<TesseractWorkerLike> {
    if (!this.worker) {
      const created = this.factory();
      this.worker = created;
      created.catch(() => {
        if (this.worker === created) this.worker = null;
      });
    }
    return this.worker;
  }

  async recognize(image: Uint8Array | Blob): Promise<OcrResult> {
    if (this.pagesDone >= RECYCLE_AFTER_PAGES) {
      await this.terminate();
    }
    const worker = await this.getWorker();
    try {
      const { data } = await withTimeout(worker.recognize(image, {}, { text: true, blocks: true }), RECOGNIZE_TIMEOUT_MS, 'recognize');
      return tesseractPageToOcrResult(data);
    } catch (error) {
      // A crashed worker cannot be reused.
      reportProblem('ocr_engine', error, 'recognize');
      await this.terminate();
      throw error instanceof Error ? error : new Error('ocr_failed');
    }
  }

  notePageDone(): void {
    this.pagesDone++;
  }

  async terminate(): Promise<void> {
    const current = this.worker;
    this.worker = null;
    this.pagesDone = 0;
    if (!current) return;
    try {
      const worker = await current;
      await worker.terminate();
    } catch {
      // Already gone.
    }
  }
}

export const browserOcr: OcrEngine = new BrowserOcrEngine();
