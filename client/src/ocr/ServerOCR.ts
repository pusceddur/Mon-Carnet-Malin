// Fallback OCR on the family server (POST /api/ocr): grayscale JPEG 0.85, never binarized, one page at a time.
import { LIMITS, type TextBlock } from '@aide/shared';
import { postOcr } from '../api/ocr';

export type ServerOcrOutcome =
  | { status: 'ok'; blocks: TextBlock[]; confidence: number }
  | { status: 'busy'; retryAfterMs: number }
  | { status: 'unavailable'; reason: 'offline' | 'too_large' | 'not_authenticated' | 'error' };

export const MIN_SERVER_RETRY_MS = 30_000;

export async function recognizeOnServer(jpeg: Blob, signal?: AbortSignal): Promise<ServerOcrOutcome> {
  if (jpeg.size > LIMITS.ocrImageMaxBytes) return { status: 'unavailable', reason: 'too_large' };
  const response = await postOcr(jpeg, 'page.jpg', signal);
  switch (response.kind) {
    case 'ok':
      return { status: 'ok', blocks: response.result.blocks, confidence: response.result.confidence };
    case 'busy':
      return { status: 'busy', retryAfterMs: Math.max(MIN_SERVER_RETRY_MS, response.retryAfterMs) };
    case 'error':
      if (response.code === 'offline' || response.status === 0) return { status: 'unavailable', reason: 'offline' };
      if (response.status === 413) return { status: 'unavailable', reason: 'too_large' };
      if (response.status === 401) return { status: 'unavailable', reason: 'not_authenticated' };
      if (response.status === 429) return { status: 'busy', retryAfterMs: 10 * 60_000 };
      return { status: 'unavailable', reason: 'error' };
  }
}
