// STUB: client-documents — thin wrapper over §7 /api/ocr
import type { OcrServerResult } from '@aide/shared';
import { api } from './http';

/** Image <= 15 MB (jpeg/png/webp); never stored by the server. */
export function postOcr(image: Blob, fileName: string, signal?: AbortSignal): Promise<OcrServerResult> {
  const form = new FormData();
  form.append('image', image, fileName);
  return api<OcrServerResult>('POST', '/api/ocr', undefined, { form, signal, timeoutMs: 180_000 });
}
