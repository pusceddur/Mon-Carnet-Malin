import basicSsl from '@vitejs/plugin-basic-ssl';
import react from '@vitejs/plugin-react';
import { defineConfig, type PluginOption } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// HTTPS=1 npm run dev -> self-signed certificate for testing on iPad in the LAN (secure context, C10).
const useHttps = process.env.HTTPS === '1';

const apiProxy = {
  '/api': { target: 'http://localhost:3001', changeOrigin: false },
};

export default defineConfig({
  plugins: [
    react(),
    ...(useHttps ? [basicSsl() as PluginOption] : []),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: ['icons/*.png', 'icons/*.svg'],
      manifest: {
        name: 'Mon Carnet Malin',
        short_name: 'Carnet Malin',
        description: 'Lire, écouter et comprendre ses livres.',
        lang: 'fr',
        dir: 'ltr',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'any',
        background_color: '#FBF6EC',
        theme_color: '#FBF6EC',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        globPatterns: ['**/*.{js,css,html,woff2,wasm,gz,txt,svg,png}'],
        maximumFileSizeToCacheInBytes: 40 * 1024 * 1024,
        cleanupOutdatedCaches: true,
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
    // C18: iPads that are not recent (Vite 8 default would require Safari 16.4). Syntax lowering only: runtime APIs
    // still need feature detection.
    target: ['safari15', 'chrome111', 'firefox114', 'edge111'],
  },
  worker: {
    format: 'es',
  },
  optimizeDeps: {
    exclude: ['@aide/shared'],
  },
});
