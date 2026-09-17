// Runtime cache names shared by the service worker config (vite.config.ts) and the « Préparer le mode hors ligne »
// action. This file is also bundled into the Vite config: keep it free of imports.

/** Version of public/offline-assets.json, injected at build time (undefined in tests and without generated assets). */
declare const __AIDE_OFFLINE_ASSETS_VERSION__: string | undefined;

export const OFFLINE_CACHE_PREFIX = 'aide-offline-';

/** FNV-1a 32-bit, hex: short stable suffix for cache names. */
function shortHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export type OfflineCacheGroup = 'ocr' | 'pdfjs' | 'data';

/**
 * CacheFirst caches are versioned with the assets (tesseract.js, pdf.js, word list): an upgrade gets fresh caches instead
 * of stale workers that no longer match the app code.
 */
export function offlineCacheNames(version: string): Readonly<Record<OfflineCacheGroup, string>> {
  const suffix = shortHash(version);
  return {
    ocr: `${OFFLINE_CACHE_PREFIX}ocr-${suffix}`,
    pdfjs: `${OFFLINE_CACHE_PREFIX}pdfjs-${suffix}`,
    data: `${OFFLINE_CACHE_PREFIX}data-${suffix}`,
  };
}

export const OFFLINE_ASSETS_VERSION: string =
  typeof __AIDE_OFFLINE_ASSETS_VERSION__ === 'string' ? __AIDE_OFFLINE_ASSETS_VERSION__ : 'dev';

export const OFFLINE_CACHE_NAMES = offlineCacheNames(OFFLINE_ASSETS_VERSION);

/** Same-origin path prefixes served CacheFirst by the service worker (§15.6). */
export const OFFLINE_CACHE_PREFIXES: ReadonlyArray<{ prefix: string; group: OfflineCacheGroup }> = [
  { prefix: '/ocr/', group: 'ocr' },
  { prefix: '/pdfjs/', group: 'pdfjs' },
  { prefix: '/data/', group: 'data' },
];

/** List of heavy assets generated at build time by the documents module (copy-assets). */
export const OFFLINE_ASSETS_MANIFEST_URL = '/offline-assets.json';
