import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchPageImage } from '../../src/api/documents';
import { parseRetryAfter, postOcr } from '../../src/api/ocr';
import { db } from '../../src/db/localDb';
import { backoffMs, enqueueUpload, flushPendingUploads, readPendingUploads } from '../../src/documents/pendingUploads';
import { recognizeOnServer } from '../../src/ocr/ServerOCR';
import { useSessionStore } from '../../src/state/session';
import { clearDb, seedDocument, settings } from './queueHarness';

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}

describe('api/ocr', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('parses Retry-After in seconds or as a date', () => {
    expect(parseRetryAfter('12')).toBe(12_000);
    expect(parseRetryAfter(null)).toBe(30_000);
    expect(parseRetryAfter('Wed, 16 Sep 2026 10:00:30 GMT', Date.parse('Wed, 16 Sep 2026 10:00:00 GMT'))).toBe(30_000);
  });

  it('posts the image as multipart with the CSRF header and returns the result', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse(200, { blocks: [{ kind: 'paragraph', text: 'Bonjour' }], confidence: 88, engine: 'tesseract-best' }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const result = await postOcr(new Blob(['x'], { type: 'image/jpeg' }), 'page.jpg');
    expect(result).toEqual({ kind: 'ok', result: { blocks: [{ kind: 'paragraph', text: 'Bonjour' }], confidence: 88, engine: 'tesseract-best' } });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/ocr');
    expect(init?.method).toBe('POST');
    expect((init?.headers as Record<string, string>)['X-Requested-With']).toBe('aide');
    expect(init?.body).toBeInstanceOf(FormData);
  });

  it('maps 503 busy, errors, invalid bodies and network failures', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(503, { error: { code: 'ocr_busy', message: 'Occupé' } }, { 'Retry-After': '45' })));
    expect(await postOcr(new Blob(['x']), 'p.jpg')).toEqual({ kind: 'busy', retryAfterMs: 45_000 });
    expect(await recognizeOnServer(new Blob(['x']))).toEqual({ status: 'busy', retryAfterMs: 45_000 });

    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(413, { error: { code: 'payload_too_large', message: 'Trop gros' } })));
    expect(await postOcr(new Blob(['x']), 'p.jpg')).toEqual({ kind: 'error', status: 413, code: 'payload_too_large' });
    expect(await recognizeOnServer(new Blob(['x']))).toEqual({ status: 'unavailable', reason: 'too_large' });

    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, { nope: true })));
    expect(await postOcr(new Blob(['x']), 'p.jpg')).toEqual({ kind: 'error', status: 200, code: 'invalid_response' });

    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('network');
    }));
    expect(await recognizeOnServer(new Blob(['x']))).toEqual({ status: 'unavailable', reason: 'offline' });
  });

  it('never sends a server busy retry sooner than 30 s', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(503, {}, { 'Retry-After': '1' })));
    expect(await recognizeOnServer(new Blob(['x']))).toEqual({ status: 'busy', retryAfterMs: 30_000 });
  });
});

describe('api/documents fetchPageImage', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('returns the image blob, or null on 404 / network error (never throws)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Blob(['jpeg']), { status: 200 })));
    expect((await fetchPageImage('d', 3))?.size).toBe(4);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })));
    expect(await fetchPageImage('d', 3)).toBeNull();
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('offline');
    }));
    expect(await fetchPageImage('d', 3)).toBeNull();
  });

  it('does not ask the server again for an image it just reported missing', async () => {
    const fetchMock = vi.fn(async () => new Response('', { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await fetchPageImage('missing-doc', 0)).toBeNull();
    expect(await fetchPageImage('missing-doc', 0)).toBeNull();
    expect(await fetchPageImage('missing-doc', 0)).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await fetchPageImage('missing-doc', 1)).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('pending uploads', () => {
  beforeEach(async () => {
    await clearDb();
    useSessionStore.setState({ parentSettings: settings({ privacy: { uploadPageImages: true, uploadOriginals: false } }) });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('uploads a processed page image, waits for the sync when the document is unknown, and drops disallowed kinds', async () => {
    const id = await seedDocument({ pages: 1 });
    // fake-indexeddb clones the test DOM's Blob into a plain object: serve the record with a real Blob.
    const record = { documentId: id, pageIndex: 0, variant: 'ocr' as const, blob: new Blob(['jpeg'], { type: 'image/jpeg' }), width: 10, height: 10 };
    vi.spyOn(db.pageImages, 'get').mockResolvedValue(record);
    await enqueueUpload('pageImage', id, 0, 0);
    await enqueueUpload('original', id, 0, 0);

    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method} ${url}`);
      return jsonResponse(404, { error: { code: 'document_not_synced', message: 'Pas encore synchronisé' } });
    }));
    await flushPendingUploads(() => 1_000);
    expect(calls).toEqual([`PUT /api/documents/${id}/pages/0/image`]);
    let pending = await readPendingUploads();
    expect(pending).toEqual([{ kind: 'pageImage', documentId: id, index: 0, attempts: 0, nextAttemptAt: 4_000 }]);

    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, { ok: true })));
    await flushPendingUploads(() => 2_000);
    expect(await readPendingUploads()).toHaveLength(1);
    await flushPendingUploads(() => 70_000);
    pending = await readPendingUploads();
    expect(pending).toEqual([]);
  });

  it('sends the color copy of the page when there is one, the grayscale page otherwise (§19.1)', async () => {
    const id = await seedDocument({ pages: 2 });
    const blobs: Record<string, Blob> = { color: new Blob(['color-page'], { type: 'image/jpeg' }), ocr: new Blob(['gray'], { type: 'image/jpeg' }) };
    vi.spyOn(db.pageImages, 'get').mockImplementation((async (key: [string, number, 'ocr' | 'color' | 'thumb']) => {
      const [documentId, pageIndex, variant] = key;
      // Page 0 has both copies, page 1 (processed before the color copy existed) only the grayscale one.
      if (variant === 'thumb' || (variant === 'color' && pageIndex === 1)) return undefined;
      return { documentId, pageIndex, variant, blob: blobs[variant]!, width: 10, height: 10 };
    }) as unknown as typeof db.pageImages.get);
    const sent: number[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      const image = (init?.body as FormData).get('image') as Blob;
      sent.push(image.size);
      return jsonResponse(200, { ok: true });
    }));
    await enqueueUpload('pageImage', id, 0, 0);
    await enqueueUpload('pageImage', id, 1, 0);
    await flushPendingUploads(() => 1_000);
    expect(sent).toEqual([blobs.color!.size, blobs.ocr!.size]);
  });

  it('backs off exponentially up to one hour', () => {
    expect(backoffMs(1)).toBe(30_000);
    expect(backoffMs(3)).toBe(120_000);
    expect(backoffMs(20)).toBe(3_600_000);
  });
});
