// §29 Which engine reads the pages: the text recognizer of iPadOS inside the App Store app, the WebAssembly one
// everywhere else. The choice is made once, on the first page, then kept for the whole session.
//
// Both answer the same `OcrEngine`, so nothing else in the reading pipeline changes.
import { isVisionOcrAvailable, createVisionOcrEngine } from '../platform/native/visionOcr';
import { browserOcr, type OcrEngine } from './BrowserOCR';

export interface PageEngineDeps {
  /** Tests: the two candidates and the check between them. */
  visionAvailable?: () => Promise<boolean>;
  createVision?: () => OcrEngine | null;
  fallback?: OcrEngine;
}

/**
 * An engine that picks the best available one the first time it is asked, and delegates to it afterwards.
 * It never throws while choosing: a system recognizer that cannot answer simply leaves the WebAssembly one in place.
 */
export function createPageOcrEngine(deps: PageEngineDeps = {}): OcrEngine {
  const available = deps.visionAvailable ?? isVisionOcrAvailable;
  const createVision = deps.createVision ?? createVisionOcrEngine;
  const fallback = deps.fallback ?? browserOcr;

  let chosen: Promise<OcrEngine> | null = null;
  /** The engine that will read, resolved once. */
  const engine = (): Promise<OcrEngine> => {
    chosen ??= (async () => {
      try {
        if (await available()) {
          const vision = createVision();
          if (vision) return vision;
        }
      } catch {
        // The system could not say: the WebAssembly engine reads the page, as it always did.
      }
      return fallback;
    })();
    return chosen;
  };

  return {
    async recognize(image: Uint8Array | Blob) {
      return (await engine()).recognize(image);
    },
    notePageDone(): void {
      // Only the WebAssembly engine has a worker to recycle; the call is forwarded once the choice is known.
      void engine().then((e) => e.notePageDone()).catch(() => undefined);
    },
    async terminate(): Promise<void> {
      if (!chosen) return;
      await (await chosen).terminate();
    },
  };
}

/** The engine of this session. */
export const pageOcr: OcrEngine = createPageOcrEngine();
