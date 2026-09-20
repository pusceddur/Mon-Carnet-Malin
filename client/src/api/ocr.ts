// Thin wrapper over POST /api/ocr (contract §7, §15.6). Uses fetch directly to read `Retry-After` on 503.
import type { OcrServerResult, TextBlock } from '@aide/shared';
import { apiUrl, authHeaders, credentialsMode } from './endpoint';

export const OCR_REQUEST_TIMEOUT_MS = 120_000;

export type PostOcrResponse =
  | { kind: 'ok'; result: OcrServerResult }
  | { kind: 'busy'; retryAfterMs: number }
  | { kind: 'error'; status: number; code: string };

function isTextBlock(value: unknown): value is TextBlock {
  if (typeof value !== 'object' || value === null) return false;
  const b = value as { kind?: unknown; text?: unknown };
  return (b.kind === 'title' || b.kind === 'paragraph') && typeof b.text === 'string';
}

function parseResult(value: unknown): OcrServerResult | null {
  if (typeof value !== 'object' || value === null) return null;
  const r = value as { blocks?: unknown; confidence?: unknown; engine?: unknown };
  if (!Array.isArray(r.blocks) || !r.blocks.every(isTextBlock) || typeof r.confidence !== 'number') return null;
  return { blocks: r.blocks, confidence: r.confidence, engine: 'tesseract-best' };
}

/** `Retry-After` in seconds or HTTP date → milliseconds (default 30 s). */
export function parseRetryAfter(header: string | null, now = Date.now()): number {
  if (!header) return 30_000;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  const date = Date.parse(header);
  if (Number.isFinite(date)) return Math.max(0, date - now);
  return 30_000;
}

/** Image ≤ 15 MB (jpeg/png/webp), never stored by the server. Never throws. */
export async function postOcr(image: Blob, fileName: string, signal?: AbortSignal): Promise<PostOcrResponse> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return { kind: 'error', status: 0, code: 'offline' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OCR_REQUEST_TIMEOUT_MS);
  const onAbort = (): void => controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    const form = new FormData();
    form.append('image', image, fileName);
    const res = await fetch(apiUrl('/api/ocr'), {
      method: 'POST',
      body: form,
      credentials: credentialsMode(),
      headers: { 'X-Requested-With': 'aide', Accept: 'application/json', ...authHeaders() },
      signal: controller.signal,
    });
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    if (res.status === 503) {
      return { kind: 'busy', retryAfterMs: parseRetryAfter(res.headers.get('Retry-After')) };
    }
    if (!res.ok) {
      const code =
        typeof body === 'object' && body !== null && 'error' in body && typeof (body as { error: { code?: unknown } }).error?.code === 'string'
          ? (body as { error: { code: string } }).error.code
          : 'http_error';
      return { kind: 'error', status: res.status, code };
    }
    const result = parseResult(body);
    return result ? { kind: 'ok', result } : { kind: 'error', status: res.status, code: 'invalid_response' };
  } catch {
    return { kind: 'error', status: 0, code: controller.signal.aborted ? 'timeout' : 'offline' };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}
