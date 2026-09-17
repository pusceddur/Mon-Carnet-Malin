// Separate, slow suite: real OCR in Node on the Chrome-rendered fixtures (npm run test:ocr -w client).
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: fileURLToPath(new URL('../..', import.meta.url)),
  test: {
    name: 'ocr-accuracy',
    include: ['test/ocr-accuracy/**/*.test.mjs'],
    environment: 'node',
    testTimeout: 300_000,
    hookTimeout: 300_000,
    fileParallelism: false,
  },
});
