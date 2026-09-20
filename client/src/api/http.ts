import { KID_MESSAGES, type ApiErrorBody } from '@aide/shared';
import { apiUrl, authHeaders, credentialsMode } from './endpoint';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface ApiOptions {
  /** Default 30 s. The timer also covers reading the body (heartbeat responses). */
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Multipart body; when set, `body` is ignored. */
  form?: FormData;
}

/**
 * `code`: server ApiErrorBody code, or client-side `offline` | `timeout` | `aborted` | `http_error` | `invalid_response`.
 * UI should map `code` to fr.errors rather than showing `message` for client-side codes.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export const DEFAULT_TIMEOUT_MS = 30_000;

function isApiErrorBody(value: unknown): value is ApiErrorBody {
  if (typeof value !== 'object' || value === null || !('error' in value)) return false;
  const err = (value as { error: unknown }).error;
  return typeof err === 'object' && err !== null
    && typeof (err as { code?: unknown }).code === 'string'
    && typeof (err as { message?: unknown }).message === 'string';
}

function isOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

export async function api<T>(method: HttpMethod, path: string, body?: unknown, opts: ApiOptions = {}): Promise<T> {
  if (isOffline()) throw new ApiError(0, 'offline', KID_MESSAGES.offline);
  if (opts.signal?.aborted) throw new ApiError(0, 'aborted', 'Request aborted');

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const onExternalAbort = (): void => controller.abort();
  opts.signal?.addEventListener('abort', onExternalAbort, { once: true });

  const headers: Record<string, string> = { 'X-Requested-With': 'aide', Accept: 'application/json', ...authHeaders() };
  let payload: BodyInit | undefined;
  if (opts.form) {
    payload = opts.form;
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }

  const abortError = (): ApiError =>
    timedOut ? new ApiError(0, 'timeout', 'Request timed out') : new ApiError(0, 'aborted', 'Request aborted');

  try {
    let res: Response;
    try {
      res = await fetch(apiUrl(path), { method, headers, body: payload, credentials: credentialsMode(), signal: controller.signal });
    } catch {
      // fetch only rejects on abort or network failure (TypeError).
      if (controller.signal.aborted) throw abortError();
      throw new ApiError(0, 'offline', KID_MESSAGES.offline);
    }

    let text: string;
    try {
      text = await res.text();
    } catch {
      if (controller.signal.aborted) throw abortError();
      throw new ApiError(res.status, 'offline', KID_MESSAGES.offline);
    }

    // JSON.parse accepts leading whitespace, which heartbeat responses rely on.
    let data: unknown = undefined;
    let parsed = true;
    if (text.trim() !== '') {
      try {
        data = JSON.parse(text);
      } catch {
        parsed = false;
      }
    }

    if (!res.ok) {
      if (parsed && isApiErrorBody(data)) throw new ApiError(res.status, data.error.code, data.error.message);
      throw new ApiError(res.status, 'http_error', `HTTP ${res.status}`);
    }
    if (!parsed) throw new ApiError(res.status, 'invalid_response', 'Invalid JSON response');
    return data as T;
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', onExternalAbort);
  }
}
