import { describe, expect, it, vi } from 'vitest';
import {
  cacheNameForAsset, OfflineAssetsError, parseOfflineAssetEntries, parseOfflineAssetList, prepareOfflineAssets, purgeStaleOfflineCaches,
  type CacheLike,
} from '../../src/state/offlineAssets';
import { OFFLINE_ASSETS_VERSION, OFFLINE_CACHE_NAMES, offlineCacheNames } from '../../src/state/offlineCaches';

function fakeCaches(prefilled: Record<string, string[]> = {}) {
  const stores = new Map<string, Map<string, Response>>();
  const open = vi.fn(async (name: string): Promise<CacheLike> => {
    let store = stores.get(name);
    if (!store) {
      store = new Map((prefilled[name] ?? []).map((url) => [url, new Response('cached')]));
      stores.set(name, store);
    }
    const s = store;
    return {
      match: async (url) => s.get(url),
      put: async (url, response) => {
        s.set(url, response);
      },
    };
  });
  return { caches: { open }, stores };
}

describe('offline assets', () => {
  it('maps paths to the service worker caches', () => {
    expect(cacheNameForAsset('/ocr/worker.min.js')).toBe(OFFLINE_CACHE_NAMES.ocr);
    expect(cacheNameForAsset('/pdfjs/cmaps/UniJIS-UCS2-H.bcmap')).toBe(OFFLINE_CACHE_NAMES.pdfjs);
    expect(cacheNameForAsset('/data/mots-fr.txt')).toBe(OFFLINE_CACHE_NAMES.data);
    expect(cacheNameForAsset('/assets/index.js')).toBeNull();
  });

  it('versions cache names with the assets manifest', () => {
    expect(OFFLINE_ASSETS_VERSION).toBe('dev');
    const v1 = offlineCacheNames('tesseract.js@7.0.0+pdfjs-dist@6.3.289');
    const v2 = offlineCacheNames('tesseract.js@7.1.0+pdfjs-dist@6.3.289');
    expect(v1.ocr).toMatch(/^aide-offline-ocr-[0-9a-f]{8}$/);
    expect(v1.ocr).not.toBe(v2.ocr);
    expect(offlineCacheNames('x')).toEqual(offlineCacheNames('x'));
    expect(cacheNameForAsset('/ocr/a.js', v2)).toBe(v2.ocr);
  });

  it('reads the copy-assets manifest format with sizes', () => {
    const manifest = {
      version: 'v', totalBytes: 30,
      files: [{ url: '/ocr/worker.min.js', bytes: 10, group: 'ocr' }, { url: '/data/mots-fr.txt', bytes: 'x', group: 'data' }, { bytes: 3 }],
    };
    expect(parseOfflineAssetEntries(manifest)).toEqual([{ url: '/ocr/worker.min.js', bytes: 10 }, { url: '/data/mots-fr.txt', bytes: null }]);
  });

  it('purges caches of previous asset versions only', async () => {
    const deleted: string[] = [];
    const storage = {
      open: vi.fn(),
      keys: async () => ['aide-offline-ocr-00000000', OFFLINE_CACHE_NAMES.ocr, 'workbox-precache-v2', 'aide-offline-data-11111111'],
      delete: async (name: string) => {
        deleted.push(name);
        return true;
      },
    };
    expect(await purgeStaleOfflineCaches(storage)).toEqual(['aide-offline-ocr-00000000', 'aide-offline-data-11111111']);
    expect(deleted).toEqual(['aide-offline-ocr-00000000', 'aide-offline-data-11111111']);
    expect(await purgeStaleOfflineCaches(undefined)).toEqual([]);
  });

  it('parses the supported manifest shapes and keeps safe same-origin paths only', () => {
    expect(parseOfflineAssetList(['/ocr/a.js', '/ocr/a.js', 'https://evil.example/ocr/x', '//evil/ocr/x', '/ocr/../secret', '/assets/x.js'])).toEqual(['/ocr/a.js']);
    expect(parseOfflineAssetList({ urls: ['/data/mots-fr.txt'] })).toEqual(['/data/mots-fr.txt']);
    expect(parseOfflineAssetList({ assets: [{ url: '/pdfjs/wasm/a.wasm' }, '/ocr/b.js'] })).toEqual(['/pdfjs/wasm/a.wasm', '/ocr/b.js']);
    expect(parseOfflineAssetList({ files: 'nope' })).toEqual([]);
    expect(parseOfflineAssetList(null)).toEqual([]);
  });

  it('downloads missing assets into the right caches and skips cached ones', async () => {
    const { caches, stores } = fakeCaches({ [OFFLINE_CACHE_NAMES.ocr]: ['/ocr/cached.js'] });
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/offline-assets.json') {
        return Response.json({ files: [{ url: '/ocr/cached.js' }, { url: '/ocr/fra.traineddata.gz', bytes: 5 }, { url: '/data/mots-fr.txt', bytes: 700 }, { url: '/pdfjs/broken' }] });
      }
      if (url === '/pdfjs/broken') return new Response('', { status: 404 });
      if (url === '/data/mots-fr.txt') return new Response('mots');
      return new Response('data', { headers: { 'Content-Length': '1000' } });
    });
    const progress: number[] = [];
    const result = await prepareOfflineAssets({ fetch: fetchMock, caches, onProgress: (p) => progress.push(p.done), concurrency: 2 });

    expect(result).toEqual({ total: 4, cached: 3, downloaded: 2, bytes: 1700, failed: ['/pdfjs/broken'] });
    expect(fetchMock).not.toHaveBeenCalledWith('/ocr/cached.js', expect.anything());
    expect(stores.get(OFFLINE_CACHE_NAMES.ocr)?.has('/ocr/fra.traineddata.gz')).toBe(true);
    expect(stores.get(OFFLINE_CACHE_NAMES.data)?.has('/data/mots-fr.txt')).toBe(true);
    expect(progress[0]).toBe(0);
    expect(progress.at(-1)).toBe(4);
  });

  it('reports unsupported browsers, missing manifests and cancellation', async () => {
    await expect(prepareOfflineAssets({ fetch: vi.fn(), caches: undefined })).rejects.toMatchObject({ code: 'unsupported' });
    const { caches } = fakeCaches();
    await expect(prepareOfflineAssets({ fetch: async () => new Response('', { status: 404 }), caches })).rejects.toBeInstanceOf(OfflineAssetsError);
    await expect(prepareOfflineAssets({ fetch: async () => new Response('', { status: 404 }), caches })).rejects.toMatchObject({ code: 'manifest_unavailable' });

    const controller = new AbortController();
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/offline-assets.json') return Response.json(['/ocr/a.js', '/ocr/b.js', '/ocr/c.js']);
      controller.abort();
      return new Response('x');
    });
    await expect(prepareOfflineAssets({ fetch: fetchMock, caches, signal: controller.signal, concurrency: 1 })).rejects.toMatchObject({ code: 'aborted' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
