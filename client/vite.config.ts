import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import basicSsl from '@vitejs/plugin-basic-ssl';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin, type PluginOption } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
// Relative imports (bundled with the config): constants.ts only has type imports, offlineCaches.ts has none.
import { APP_NAME, APP_SHORT_NAME } from '../shared/src/constants';
import { offlineCacheNames } from './src/state/offlineCaches';

// HTTPS=1 npm run dev -> self-signed certificate for testing on iPad in the LAN (secure context, C10).
const useHttps = process.env.HTTPS === '1';

const PAPER = '#FBF6EC';
const DESCRIPTION = 'Lire, écouter et comprendre ses livres.';

/** Version of the heavy offline assets (written by scripts/copy-assets.mjs); versions the CacheFirst caches. */
function readOfflineAssetsVersion(): string {
  const file = fileURLToPath(new URL('./public/offline-assets.json', import.meta.url));
  if (!existsSync(file)) return 'dev';
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as { version?: unknown };
    return typeof parsed.version === 'string' && parsed.version !== '' ? parsed.version : 'dev';
  } catch {
    return 'dev';
  }
}

const offlineAssetsVersion = readOfflineAssetsVersion();
const offlineCaches = offlineCacheNames(offlineAssetsVersion);

const apiProxy = {
  '/api': { target: 'http://localhost:3001', changeOrigin: false },
};

const escapeHtml = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Fills %APP_NAME%, %APP_SHORT_NAME% and %APP_DESCRIPTION% in index.html from the shared constants. */
function appNameHtml(): Plugin {
  return {
    name: 'aide-app-name-html',
    transformIndexHtml(html) {
      return html
        .replaceAll('%APP_NAME%', escapeHtml(APP_NAME))
        .replaceAll('%APP_SHORT_NAME%', escapeHtml(APP_SHORT_NAME))
        .replaceAll('%APP_DESCRIPTION%', escapeHtml(DESCRIPTION));
    },
  };
}

export default defineConfig({
  define: {
    __AIDE_OFFLINE_ASSETS_VERSION__: JSON.stringify(offlineAssetsVersion),
  },
  plugins: [
    react(),
    appNameHtml(),
    ...(useHttps ? [basicSsl() as PluginOption] : []),
    VitePWA({
      // Prompt mode: a new version never reloads the page by itself (reading, OCR in progress); the app offers the update.
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['icons/icon.svg', 'icons/apple-touch-icon.png'],
      manifest: {
        id: '/',
        name: APP_NAME,
        short_name: APP_SHORT_NAME,
        description: DESCRIPTION,
        lang: 'fr',
        dir: 'ltr',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'any',
        background_color: PAPER,
        theme_color: PAPER,
        categories: ['education', 'books'],
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: '/icons/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,mjs,css,html,woff2,svg,png,webmanifest}'],
        globIgnores: ['ocr/**', 'pdfjs/**', 'data/**'],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        cleanupOutdatedCaches: true,
        // Heavy OCR / PDF / word-list assets: fetched on first use or by « Préparer le mode hors ligne », then served from cache.
        // Match callbacks are serialized into the service worker: keep them self-contained (no outer variables).
        runtimeCaching: [
          {
            urlPattern: ({ url, sameOrigin }) => sameOrigin && url.pathname.startsWith('/ocr/'),
            handler: 'CacheFirst',
            options: { cacheName: offlineCaches.ocr, cacheableResponse: { statuses: [200] } },
          },
          {
            urlPattern: ({ url, sameOrigin }) => sameOrigin && url.pathname.startsWith('/pdfjs/'),
            handler: 'CacheFirst',
            options: { cacheName: offlineCaches.pdfjs, cacheableResponse: { statuses: [200] } },
          },
          {
            urlPattern: ({ url, sameOrigin }) => sameOrigin && url.pathname.startsWith('/data/'),
            handler: 'CacheFirst',
            options: { cacheName: offlineCaches.data, cacheableResponse: { statuses: [200] } },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  server: {
    host: true,
    port: 5173,
    proxy: apiProxy,
  },
  preview: {
    host: true,
    port: 4173,
    proxy: apiProxy,
  },
  build: {
    // §15.6: iPadOS / Safari 18+. Syntax lowering only: runtime APIs still need feature detection.
    target: ['safari18', 'ios18', 'chrome120', 'edge120', 'firefox115'],
  },
  worker: {
    format: 'es',
  },
  optimizeDeps: {
    exclude: ['@aide/shared'],
  },
});
