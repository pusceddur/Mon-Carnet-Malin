import { z } from 'zod';
import { Limiter } from './limiter';

export const WIKTIONARY_API_URL = 'https://fr.wiktionary.org/w/api.php';
export const WIKTIONARY_PAGE_URL = 'https://fr.wiktionary.org/wiki/';
export const WIKTIONARY_TIMEOUT_MS = 4_000;
export const WIKTIONARY_MAX_CONCURRENT = 2;
export const WIKTIONARY_USER_AGENT = 'MonCarnetMalin/1.0 (application éducative)';
/** Some very common words have huge pages; anything above this is refused. */
export const WIKTIONARY_MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

export type WiktionaryErrorReason = 'timeout' | 'network' | 'http' | 'invalid' | 'aborted';

export type WiktionaryPageResult =
  | { status: 'found'; title: string; wikitext: string }
  | { status: 'missing' }
  | { status: 'error'; reason: WiktionaryErrorReason };

/** What the dictionary service needs from Wiktionnaire (mockable in tests). */
export interface WiktionaryFetcher {
  fetchPage(title: string, signal?: AbortSignal): Promise<WiktionaryPageResult>;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface WiktionaryClientOptions {
  fetchImpl?: FetchLike;
  /** Operator contact appended to the User-Agent (env WIKIMEDIA_CONTACT). */
  contact?: string | null;
  timeoutMs?: number;
  /** Shared by default so that the whole process makes at most 2 concurrent requests. */
  limiter?: Limiter;
  apiUrl?: string;
}

const processLimiter = new Limiter(WIKTIONARY_MAX_CONCURRENT);

const ParseResponseSchema = z.object({
  parse: z.object({ title: z.string(), wikitext: z.string() }).optional(),
  error: z.object({ code: z.string() }).optional(),
});

const MISSING_CODES = new Set(['missingtitle', 'invalidtitle', 'pagecannotexist']);

/** Keeps only printable ASCII (header-safe), trimmed and bounded. */
export function sanitizeContact(contact: string | null | undefined): string | null {
  if (!contact) return null;
  const cleaned = contact.replace(/[^\x20-\x7e]/g, '').replace(/[()]/g, '').trim().slice(0, 200);
  return cleaned.length > 0 ? cleaned : null;
}

export function buildUserAgent(contact: string | null | undefined): string {
  const safe = sanitizeContact(contact);
  return safe ? `MonCarnetMalin/1.0 (application éducative; ${safe})` : WIKTIONARY_USER_AGENT;
}

export function buildParseUrl(title: string, apiUrl: string = WIKTIONARY_API_URL): string {
  const params = new URLSearchParams({
    action: 'parse',
    page: title,
    prop: 'wikitext',
    formatversion: '2',
    format: 'json',
    redirects: '1',
  });
  return `${apiUrl}?${params.toString()}`;
}

/** Human-readable page URL (letters kept as is, spaces as underscores). */
export function wiktionaryPageUrl(title: string): string {
  const path = Array.from(title.replace(/ /g, '_'))
    .map((ch) => (/[\p{L}\p{N}\-_.~’]/u.test(ch) ? ch : encodeURIComponent(ch)))
    .join('');
  return `${WIKTIONARY_PAGE_URL}${path}`;
}

async function readBodyWithCap(res: Response, maxBytes: number): Promise<string | null> {
  const declared = Number(res.headers.get('content-length') ?? '0');
  if (declared > maxBytes) return null;
  if (!res.body) return res.text();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export class WiktionaryClient implements WiktionaryFetcher {
  private readonly fetchImpl: FetchLike;
  private readonly userAgent: string;
  private readonly timeoutMs: number;
  private readonly limiter: Limiter;
  private readonly apiUrl: string;

  constructor(options: WiktionaryClientOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
    this.userAgent = buildUserAgent(options.contact);
    this.timeoutMs = options.timeoutMs ?? WIKTIONARY_TIMEOUT_MS;
    this.limiter = options.limiter ?? processLimiter;
    this.apiUrl = options.apiUrl ?? WIKTIONARY_API_URL;
  }

  fetchPage(title: string, signal?: AbortSignal): Promise<WiktionaryPageResult> {
    return this.limiter.run(() => this.fetchOnce(title, signal));
  }

  private async fetchOnce(title: string, signal?: AbortSignal): Promise<WiktionaryPageResult> {
    if (signal?.aborted) return { status: 'error', reason: 'aborted' };
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.timeoutMs);
    const onAbort = (): void => controller.abort();
    signal?.addEventListener('abort', onAbort, { once: true });

    try {
      const res = await this.fetchImpl(buildParseUrl(title, this.apiUrl), {
        method: 'GET',
        headers: { 'User-Agent': this.userAgent, Accept: 'application/json' },
        signal: controller.signal,
        redirect: 'follow',
      });
      if (!res.ok) {
        await res.body?.cancel().catch(() => undefined);
        return { status: 'error', reason: 'http' };
      }
      const text = await readBodyWithCap(res, WIKTIONARY_MAX_RESPONSE_BYTES);
      if (text === null) return { status: 'error', reason: 'invalid' };
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        return { status: 'error', reason: 'invalid' };
      }
      const parsed = ParseResponseSchema.safeParse(json);
      if (!parsed.success) return { status: 'error', reason: 'invalid' };
      if (parsed.data.parse) return { status: 'found', title: parsed.data.parse.title, wikitext: parsed.data.parse.wikitext };
      if (parsed.data.error && MISSING_CODES.has(parsed.data.error.code)) return { status: 'missing' };
      return { status: 'error', reason: 'invalid' };
    } catch {
      if (timedOut) return { status: 'error', reason: 'timeout' };
      if (signal?.aborted) return { status: 'error', reason: 'aborted' };
      return { status: 'error', reason: 'network' };
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }
}
