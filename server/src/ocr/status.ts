import { peekSharedServerOcr } from './instance';

/** Server OCR state for GET /api/health (§15.6): engine usable, and whether the single worker queue is full. */
export function ocrHealth(): { available: boolean; busy: boolean } {
  const ocr = peekSharedServerOcr();
  if (!ocr) return { available: false, busy: false };
  const { available, busy } = ocr.status();
  return { available, busy };
}
