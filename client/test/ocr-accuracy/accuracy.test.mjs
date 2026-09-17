// Real OCR accuracy (slow, run with `npm run test:ocr -w client`): the fixtures are read with tesseract.js in Node
// (same French model as the app) on the raw image and after the app preprocessing pipeline; the character error rate
// (CER) is printed and checked against regression thresholds.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { blocksFromOcrLines } from '../../src/documents/DocumentParser';
import { tesseractPageToOcrResult } from '../../src/ocr/ocrLines';
import { binarizeForOcr, preprocessGray, rotationProbes } from '../../src/ocr/preprocess/pipeline';
import { qualityFromOcrLines } from '../../src/ocr/quality';
import { recognizePage } from '../../src/ocr/readPage';
import { createSortedWordList } from '../../src/ocr/wordList';
import { decodePngToGray } from './png.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const clientDir = join(here, '..', '..');
const require = createRequire(join(clientDir, 'package.json'));
const fixturesDir = join(here, 'fixtures');

const FIXTURES = [
  // name, photo-like (denoise), max CER of the app pipeline: regression guard, measured 0 % on 2026-09-16
  ['normal', false, 0.02],
  ['inclinee-4deg', true, 0.03],
  ['sombre', true, 0.03],
  ['claire', false, 0.02],
  ['police-sans', false, 0.02],
  ['police-mono', false, 0.02],
  ['police-grande', false, 0.02],
  ['deux-colonnes', false, 0.03],
  ['titre', false, 0.02],
  ['nombres', false, 0.02],
  ['accents', false, 0.02],
  ['photo-difficile', true, 0.05],
  ['petite-police', true, 0.03],
  ['a-l-envers', true, 0.05],
  ['titre-colonnes', false, 0.03],
  ['scan-gris', false, 0.03],
];

/** Comparable text: NFKC (ligatures), typographic apostrophes and spaces unified, whitespace collapsed. */
export function normalizeForCer(text) {
  return text
    .normalize('NFKC')
    .replace(/[’‘ʼ`]/g, "'")
    .replace(/[  ]/g, ' ')
    .replace(/[«»“”]/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

export function levenshtein(a, b) {
  const prev = new Uint32Array(b.length + 1);
  const cur = new Uint32Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    prev.set(cur);
  }
  return prev[b.length];
}

export function cer(hypothesis, reference) {
  const ref = normalizeForCer(reference);
  return levenshtein(normalizeForCer(hypothesis), ref) / Math.max(1, ref.length);
}

describe('OCR accuracy on French fixtures', () => {
  let worker;
  let wordList = null;
  const rows = [];

  beforeAll(async () => {
    const { createWorker } = require('tesseract.js');
    const langPath = join(dirname(require.resolve('@tesseract.js-data/fra/package.json')), '4.0.0_best_int');
    worker = await createWorker('fra', 1, { langPath, gzip: true, cacheMethod: 'none' });
    const words = join(clientDir, 'public', 'data', 'mots-fr.txt');
    if (existsSync(words)) wordList = createSortedWordList(readFileSync(words, 'utf8'));
  });

  afterAll(async () => {
    await worker?.terminate();
    const pct = (v) => `${(v * 100).toFixed(1)} %`.padStart(8);
    const lines = [
      '',
      `fixture            CER brut   CER pré-traité   CER app (choix qualité)   qualité   ${wordList ? '' : '(sans mots-fr.txt)'}`,
      ...rows.map((r) => `${r.name.padEnd(18)} ${pct(r.raw)}   ${pct(r.pre).padStart(14)}   ${pct(r.app).padStart(23)}   ${String(r.score).padStart(7)}   ${r.variant}`),
      '',
    ];
    process.stdout.write(`${lines.join('\n')}\n`);
  });

  const engine = {
    recognize: async (bytes) => tesseractPageToOcrResult((await worker.recognize(Buffer.from(bytes), {}, { text: true, blocks: true })).data),
  };

  async function read(image, regions = []) {
    const result = await recognizePage(engine, image, regions);
    const text = blocksFromOcrLines(result.lines).map((b) => b.text).join('\n');
    const quality = qualityFromOcrLines(result.lines, result.confidence, wordList);
    return { text, score: quality.score };
  }

  for (const [name, photo, maxCer] of FIXTURES) {
    it(`${name}: CER ≤ ${(maxCer * 100).toFixed(0)} % with the app pipeline`, async () => {
      const png = join(fixturesDir, `${name}.png`);
      expect(existsSync(png), `missing fixture ${name}: run generate-fixtures.mjs`).toBe(true);
      const truth = readFileSync(join(fixturesDir, `${name}.txt`), 'utf8');
      const gray = decodePngToGray(readFileSync(png));

      const raw = await read(gray);
      const { image, regions } = preprocessGray(gray, { denoise: photo });
      const pre = await read(image, regions);
      // Same decisions as the processing queue: binarized variant, then rotations, only while the reading is doubtful.
      let app = pre;
      let variant = 'gris';
      let zones = regions.length;
      if (app.score < 70) {
        const bin = await read(binarizeForOcr(image), regions);
        if (bin.score > app.score) {
          app = bin;
          variant = 'binarisé';
        }
      }
      if (app.score < 70) {
        let bestTurn = null;
        let bestScore = app.score + 10;
        for (const probe of rotationProbes(image, [180, 90, 270])) {
          const probeRead = await read(probe.image);
          if (probeRead.score > bestScore) {
            bestScore = probeRead.score;
            bestTurn = probe.turn;
            if (probeRead.score >= 70) break;
          }
        }
        if (bestTurn !== null) {
          const rotated = preprocessGray(gray, { denoise: photo, rotateDegrees: bestTurn });
          const rotatedRead = await read(rotated.image, rotated.regions);
          if (rotatedRead.score > app.score) {
            app = rotatedRead;
            variant = `rotation ${bestTurn}°`;
            zones = rotated.regions.length;
          }
        }
      }
      const row = { name, raw: cer(raw.text, truth), pre: cer(pre.text, truth), app: cer(app.text, truth), score: app.score, variant: `${variant}${zones > 1 ? `, ${zones} zones` : ''}` };
      rows.push(row);
      expect(row.app).toBeLessThanOrEqual(maxCer);
    });
  }
});
