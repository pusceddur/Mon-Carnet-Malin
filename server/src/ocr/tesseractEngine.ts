import type Tesseract from 'tesseract.js';
import type { Logger } from '../logger';
import { requireFromApp } from './appRequire';
import { pageFromTesseract, type TessBlockLike } from './layout';
import type { ResolvedOcrModel } from './model';
import type { OcrEngine, OcrPsm } from './ServerOCR';

type TesseractModule = typeof Tesseract;

/** LSTM only: both French models are LSTM models. */
const OEM_LSTM_ONLY = 1;
/** Pages sent by the client are ~2480 px on the long side (A4 at 300 dpi). */
const ASSUMED_DPI = '300';

interface WorkerThreadLike {
  on?(event: 'error' | 'exit', listener: (arg: unknown) => void): unknown;
}

/**
 * tesseract.js worker options. `cacheMethod: 'none'` keeps tesseract.js from writing the language data next to the
 * working directory; the image itself only lives in the WebAssembly memory of the worker thread.
 */
export function tesseractWorkerOptions(model: ResolvedOcrModel): Partial<Tesseract.WorkerOptions> {
  return {
    langPath: model.langPath,
    gzip: model.gzip,
    cacheMethod: 'none',
    logger: () => undefined,
    // Without an errorHandler, tesseract.js rethrows job failures inside an event listener (process crash).
    errorHandler: () => undefined,
  };
}

function loadTesseract(): TesseractModule {
  return requireFromApp<TesseractModule>('tesseract.js');
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : typeof error === 'string' ? error : 'unknown';
}

/** Loads a French tesseract.js worker for the given model (slow: call lazily). */
export async function createTesseractEngine(model: ResolvedOcrModel, logger: Logger): Promise<OcrEngine> {
  const tesseract = loadTesseract();
  const worker = await tesseract.createWorker('fra', OEM_LSTM_ONLY as Tesseract.OEM, tesseractWorkerOptions(model));
  let alive = true;

  const thread = (worker as unknown as { worker?: WorkerThreadLike | null }).worker;
  thread?.on?.('error', (error) => {
    alive = false;
    logger.error('ocr_worker_thread_error', { error: errorMessage(error) });
  });
  thread?.on?.('exit', () => {
    alive = false;
  });

  let currentPsm: OcrPsm | null = null;
  logger.info('ocr_worker_loaded', { model: model.model, requestedModel: model.requested });

  return {
    isAlive: () => alive,
    async recognize(image: Uint8Array, psm: OcrPsm) {
      if (psm !== currentPsm) {
        await worker.setParameters({
          tessedit_pageseg_mode: psm as Tesseract.PSM,
          user_defined_dpi: ASSUMED_DPI,
          preserve_interword_spaces: '0',
        });
        currentPsm = psm;
      }
      const buffer = Buffer.isBuffer(image) ? image : Buffer.from(image.buffer, image.byteOffset, image.byteLength);
      const { data } = await worker.recognize(buffer, {}, { text: true, blocks: true });
      return pageFromTesseract(data.blocks as unknown as TessBlockLike[] | null);
    },
    async terminate() {
      alive = false;
      await worker.terminate();
    },
  };
}
