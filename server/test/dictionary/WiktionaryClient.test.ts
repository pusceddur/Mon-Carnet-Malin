import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Limiter } from '../../src/dictionary/limiter';
import {
  buildParseUrl,
  buildUserAgent,
  WIKTIONARY_MAX_CONCURRENT,
  WIKTIONARY_TIMEOUT_MS,
  WIKTIONARY_USER_AGENT,
  WiktionaryClient,
  wiktionaryPageUrl,
  type FetchLike,
} from '../../src/dictionary/WiktionaryClient';

const fixtureText = (name: string): string => readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8');

const json = (body: string, status = 200): Response =>
  new Response(body, { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });

function recordingFetch(respond: (url: URL, init: RequestInit | undefined) => Response | Promise<Response>) {
  const calls: { url: URL; init: RequestInit | undefined }[] = [];
  const fetchImpl: FetchLike = async (input, init) => {
    const url = new URL(input);
    calls.push({ url, init });
    return respond(url, init);
  };
  return { calls, fetchImpl };
}

describe('WiktionaryClient request', () => {
  it('calls the parse API with the contract parameters and the app User-Agent', async () => {
    const { calls, fetchImpl } = recordingFetch(() => json(fixtureText('api-parse-chevaux.json')));
    const client = new WiktionaryClient({ fetchImpl, limiter: new Limiter(2) });
    const result = await client.fetchPage('chevaux');

    expect(result).toMatchObject({ status: 'found', title: 'chevaux' });
    expect(result.status === 'found' && result.wikitext).toContain("''Pluriel de'' [[cheval]]");
    const call = calls[0];
    expect(call?.url.origin + (call?.url.pathname ?? '')).toBe('https://fr.wiktionary.org/w/api.php');
    expect(Object.fromEntries(call?.url.searchParams ?? [])).toEqual({
      action: 'parse',
      page: 'chevaux',
      prop: 'wikitext',
      formatversion: '2',
      format: 'json',
      redirects: '1',
    });
    const headers = new Headers(call?.init?.headers);
    expect(headers.get('user-agent')).toBe(WIKTIONARY_USER_AGENT);
    expect(WIKTIONARY_USER_AGENT).toBe('MonCarnetMalin/1.0 (application éducative)');
  });

  it('encodes accented titles and apostrophes', () => {
    const url = new URL(buildParseUrl('aujourd’hui'));
    expect(url.searchParams.get('page')).toBe('aujourd’hui');
  });

  it('appends the optional operator contact, sanitized', () => {
    expect(buildUserAgent(null)).toBe(WIKTIONARY_USER_AGENT);
    expect(buildUserAgent('  ')).toBe(WIKTIONARY_USER_AGENT);
    expect(buildUserAgent('parent@example.org')).toBe('MonCarnetMalin/1.0 (application éducative; parent@example.org)');
    expect(buildUserAgent('a@b.fr\r\nX-Injected: 1')).toBe('MonCarnetMalin/1.0 (application éducative; a@b.frX-Injected: 1)');
  });

  it('builds readable attribution page URLs', () => {
    expect(wiktionaryPageUrl('cheval')).toBe('https://fr.wiktionary.org/wiki/cheval');
    expect(wiktionaryPageUrl('aujourd’hui')).toBe('https://fr.wiktionary.org/wiki/aujourd’hui');
    expect(wiktionaryPageUrl('pomme de terre')).toBe('https://fr.wiktionary.org/wiki/pomme_de_terre');
    expect(wiktionaryPageUrl('a?b#c')).toBe('https://fr.wiktionary.org/wiki/a%3Fb%23c');
  });
});

describe('WiktionaryClient responses', () => {
  it('maps missingtitle to missing', async () => {
    const { fetchImpl } = recordingFetch(() => json(fixtureText('api-missingtitle.json')));
    const client = new WiktionaryClient({ fetchImpl, limiter: new Limiter(2) });
    expect(await client.fetchPage('zzkwxq')).toEqual({ status: 'missing' });
  });

  it('maps HTTP errors, invalid JSON and unexpected API errors to error', async () => {
    const limiter = new Limiter(2);
    const http = new WiktionaryClient({ fetchImpl: async () => json('{}', 503), limiter });
    expect(await http.fetchPage('chat')).toEqual({ status: 'error', reason: 'http' });

    const invalid = new WiktionaryClient({ fetchImpl: async () => json('<html>'), limiter });
    expect(await invalid.fetchPage('chat')).toEqual({ status: 'error', reason: 'invalid' });

    const apiError = new WiktionaryClient({ fetchImpl: async () => json('{"error":{"code":"ratelimited"}}'), limiter });
    expect(await apiError.fetchPage('chat')).toEqual({ status: 'error', reason: 'invalid' });

    const network = new WiktionaryClient({
      fetchImpl: async () => {
        throw new TypeError('fetch failed');
      },
      limiter,
    });
    expect(await network.fetchPage('chat')).toEqual({ status: 'error', reason: 'network' });
  });

  it('refuses oversized responses', async () => {
    const huge = new Response('x', { headers: { 'Content-Length': String(10 * 1024 * 1024) } });
    const client = new WiktionaryClient({ fetchImpl: async () => huge, limiter: new Limiter(2) });
    expect(await client.fetchPage('de')).toEqual({ status: 'error', reason: 'invalid' });
  });

  it('gives up after the timeout (4 s by default)', async () => {
    expect(WIKTIONARY_TIMEOUT_MS).toBe(4_000);
    const fetchImpl: FetchLike = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
    const client = new WiktionaryClient({ fetchImpl, timeoutMs: 30, limiter: new Limiter(2) });
    const started = Date.now();
    expect(await client.fetchPage('lent')).toEqual({ status: 'error', reason: 'timeout' });
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it('honours an external abort signal', async () => {
    const controller = new AbortController();
    const fetchImpl: FetchLike = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
    const client = new WiktionaryClient({ fetchImpl, limiter: new Limiter(2) });
    const pending = client.fetchPage('lent', controller.signal);
    controller.abort();
    expect(await pending).toEqual({ status: 'error', reason: 'aborted' });
  });
});

describe('WiktionaryClient concurrency', () => {
  it('never runs more than 2 requests at once across clients sharing the default limiter', async () => {
    expect(WIKTIONARY_MAX_CONCURRENT).toBe(2);
    let active = 0;
    let peak = 0;
    const fetchImpl: FetchLike = async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 15));
      active -= 1;
      return json(fixtureText('api-missingtitle.json'));
    };
    const a = new WiktionaryClient({ fetchImpl });
    const b = new WiktionaryClient({ fetchImpl });
    const results = await Promise.all(['un', 'deux', 'trois', 'quatre', 'cinq', 'six'].map((w, i) => (i % 2 ? a : b).fetchPage(w)));
    expect(results.every((r) => r.status === 'missing')).toBe(true);
    expect(peak).toBe(2);
  });
});
