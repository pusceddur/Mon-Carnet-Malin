import {
  OFFLINE_ASSETS_MANIFEST_URL, OFFLINE_CACHE_NAMES, OFFLINE_CACHE_PREFIX, OFFLINE_CACHE_PREFIXES, type OfflineCacheGroup,
} from './offlineCaches';

export interface OfflineAssetsProgress { done: number; total: number }

export interface OfflineAssetsResult {
  total: number;
  /** Assets now available offline (already cached or downloaded). */
  cached: number;
  /** Assets downloaded during this run. */
  downloaded: number;
  /** Bytes downloaded during this run (Content-Length, else the size listed in the manifest). */
  bytes: number;
  failed: string[];
}

export type OfflineAssetsErrorCode = 'unsupported' | 'manifest_unavailable' | 'aborted';

export class OfflineAssetsError extends Error {
  readonly code: OfflineAssetsErrorCode;
  constructor(code: OfflineAssetsErrorCode) {
    super(code);
    this.name = 'OfflineAssetsError';
    this.code = code;
  }
}

export interface CacheLike {
  match(request: string): Promise<Response | undefined>;
  put(request: string, response: Response): Promise<void>;
}

export interface CacheStorageLike {
  open(name: string): Promise<CacheLike>;
  keys?(): Promise<string[]>;
  delete?(name: string): Promise<boolean>;
}

export interface OfflineAssetsDeps {
  fetch(url: string, init?: RequestInit): Promise<Response>;
  caches: CacheStorageLike | undefined;
  onProgress?(p: OfflineAssetsProgress): void;
  signal?: AbortSignal;
  /** Parallel downloads (default 3: gentle on iPad memory and on the server). */
  concurrency?: number;
  cacheNames?: Readonly<Record<OfflineCacheGroup, string>>;
}

export interface OfflineAssetEntry { url: string; bytes: number | null }

/** Cache that the service worker reads for this path, or null when the path is not served CacheFirst. */
export function cacheNameForAsset(path: string, names: Readonly<Record<OfflineCacheGroup, string>> = OFFLINE_CACHE_NAMES): string | null {
  const group = OFFLINE_CACHE_PREFIXES.find((p) => path.startsWith(p.prefix))?.group;
  return group ? names[group] : null;
}

function toEntry(value: unknown): OfflineAssetEntry | null {
  const record = typeof value === 'object' && value !== null ? (value as { url?: unknown; bytes?: unknown }) : null;
  const raw = typeof value === 'string' ? value : record?.url;
  if (typeof raw !== 'string') return null;
  const url = raw.trim();
  // Same-origin absolute paths only (no protocol-relative URL, no traversal).
  if (!url.startsWith('/') || url.startsWith('//') || url.includes('..') || url.includes('\\')) return null;
  const bytes = typeof record?.bytes === 'number' && Number.isFinite(record.bytes) && record.bytes >= 0 ? record.bytes : null;
  return { url, bytes };
}

/**
 * Accepts `{ files: { url, bytes }[] }` (copy-assets), `{ urls: string[] }`, `{ assets: … }` or a plain array.
 * Keeps unique same-origin paths served by an offline cache, in order.
 */
export function parseOfflineAssetEntries(data: unknown): OfflineAssetEntry[] {
  let list: unknown[] = [];
  if (Array.isArray(data)) list = data;
  else if (typeof data === 'object' && data !== null) {
    const o = data as Record<string, unknown>;
    const candidate = o.files ?? o.urls ?? o.assets;
    if (Array.isArray(candidate)) list = candidate;
  }
  const seen = new Set<string>();
  const result: OfflineAssetEntry[] = [];
  for (const item of list) {
    const entry = toEntry(item);
    if (entry === null || seen.has(entry.url) || cacheNameForAsset(entry.url) === null) continue;
    seen.add(entry.url);
    result.push(entry);
  }
  return result;
}

export function parseOfflineAssetList(data: unknown): string[] {
  return parseOfflineAssetEntries(data).map((e) => e.url);
}

/** Deletes offline caches of previous asset versions. Never throws. */
export async function purgeStaleOfflineCaches(
  cacheStorage: CacheStorageLike | undefined,
  names: Readonly<Record<OfflineCacheGroup, string>> = OFFLINE_CACHE_NAMES,
): Promise<string[]> {
  if (!cacheStorage?.keys || !cacheStorage.delete) return [];
  try {
    const current = new Set(Object.values(names));
    const stale = (await cacheStorage.keys()).filter((key) => key.startsWith(OFFLINE_CACHE_PREFIX) && !current.has(key));
    await Promise.all(stale.map((key) => cacheStorage.delete?.(key)));
    return stale;
  } catch {
    return [];
  }
}

/**
 * Downloads every asset listed in /offline-assets.json into the caches used by the service worker, so OCR, PDF reading
 * and the word list work without network. Already cached assets are skipped. Throws OfflineAssetsError only for
 * global failures; per-asset failures are listed in `failed`.
 */
export async function prepareOfflineAssets(deps: OfflineAssetsDeps): Promise<OfflineAssetsResult> {
  const cacheStorage = deps.caches;
  if (!cacheStorage) throw new OfflineAssetsError('unsupported');
  const names = deps.cacheNames ?? OFFLINE_CACHE_NAMES;

  let entries: OfflineAssetEntry[];
  try {
    const res = await deps.fetch(OFFLINE_ASSETS_MANIFEST_URL, { cache: 'no-store', signal: deps.signal });
    if (!res.ok) throw new Error(String(res.status));
    entries = parseOfflineAssetEntries(await res.json());
  } catch {
    if (deps.signal?.aborted) throw new OfflineAssetsError('aborted');
    throw new OfflineAssetsError('manifest_unavailable');
  }

  const result: OfflineAssetsResult = { total: entries.length, cached: 0, downloaded: 0, bytes: 0, failed: [] };
  const openCaches = new Map<string, Promise<CacheLike>>();
  const openCache = (name: string): Promise<CacheLike> => {
    let cache = openCaches.get(name);
    if (!cache) {
      cache = cacheStorage.open(name);
      openCaches.set(name, cache);
    }
    return cache;
  };

  let done = 0;
  let next = 0;
  deps.onProgress?.({ done, total: entries.length });

  const worker = async (): Promise<void> => {
    while (next < entries.length) {
      if (deps.signal?.aborted) return;
      const entry = entries[next] as OfflineAssetEntry;
      next += 1;
      try {
        const cache = await openCache(cacheNameForAsset(entry.url, names) as string);
        if (await cache.match(entry.url)) {
          result.cached += 1;
        } else {
          const res = await deps.fetch(entry.url, { cache: 'no-store', signal: deps.signal });
          if (!res.ok) throw new Error(String(res.status));
          const length = Number(res.headers.get('Content-Length'));
          await cache.put(entry.url, res);
          result.cached += 1;
          result.downloaded += 1;
          result.bytes += Number.isFinite(length) && length > 0 ? length : (entry.bytes ?? 0);
        }
      } catch {
        if (!deps.signal?.aborted) result.failed.push(entry.url);
      }
      done += 1;
      deps.onProgress?.({ done, total: entries.length });
    }
  };

  const concurrency = Math.max(1, Math.min(deps.concurrency ?? 3, entries.length || 1));
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  if (deps.signal?.aborted) throw new OfflineAssetsError('aborted');
  return result;
}
