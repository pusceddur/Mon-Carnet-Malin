import type { AppDeps } from '../types';
import { bestIntLangPath, resolveOcrModel, type ResolvedOcrModel } from './model';
import { ServerOCR } from './ServerOCR';
import { createTesseractEngine } from './tesseractEngine';

// One engine per process (concurrency 1 is a process-wide rule), shared by every app instance.
let shared: ServerOCR | null = null;

export function getSharedServerOcr(deps: Pick<AppDeps, 'config' | 'logger'>): ServerOCR {
  if (shared) return shared;
  const logger = deps.logger.child({ module: 'ocr' });
  // The npm package location does not change while the process runs; the downloaded model may appear later.
  const bestIntDir = bestIntLangPath();
  let fallbackWarned = false;

  const resolveModel = (): ResolvedOcrModel | null => resolveOcrModel({ config: deps.config, bestIntDir });

  shared = new ServerOCR({
    logger,
    isModelAvailable: () => resolveModel() !== null,
    engineFactory: async () => {
      const model = resolveModel();
      if (!model) throw new Error('ocr_model_files_missing');
      if (model.requested !== model.model && !fallbackWarned) {
        fallbackWarned = true;
        logger.warn('ocr_best_model_missing_using_best_int');
      }
      return createTesseractEngine(model, logger);
    },
  });
  return shared;
}

/** The shared instance if the OCR router was created, else null. */
export function peekSharedServerOcr(): ServerOCR | null {
  return shared;
}
