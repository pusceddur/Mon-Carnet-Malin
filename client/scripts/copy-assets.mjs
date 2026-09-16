// STUB: client-documents
// Will copy OCR assets (tesseract.js worker/core, fra traineddata) to public/ocr and the French word list to public/data.
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const clientDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');

for (const dir of ['public/ocr', 'public/data']) {
  mkdirSync(resolve(clientDir, dir), { recursive: true });
}
