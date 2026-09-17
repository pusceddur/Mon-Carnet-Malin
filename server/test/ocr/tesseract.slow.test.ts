import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config';
import { silentLogger } from '../../src/logger';
import { sniffImage } from '../../src/ocr/imageInfo';
import { resolveOcrModel } from '../../src/ocr/model';
import { OcrError, ServerOCR } from '../../src/ocr/ServerOCR';
import { createTesseractEngine, tesseractWorkerOptions } from '../../src/ocr/tesseractEngine';
import { characterErrorRate, editDistance, frenchPageText, renderFrenchPagePng } from './helpers/frenchPage';

// Real tesseract.js run on a page rendered by Chrome. Slow: the language model is loaded once for the file.
const FIXTURE = fileURLToPath(new URL('./fixtures/page-fr.png', import.meta.url));
const MAX_CER = 0.05;

describe('ServerOCR with tesseract.js (real engine)', () => {
  let image: Buffer;
  let ocr: ServerOCR;

  beforeAll(async () => {
    image = existsSync(FIXTURE) ? readFileSync(FIXTURE) : await renderFrenchPagePng(FIXTURE);
    const model = resolveOcrModel({ config: loadConfig({ NODE_ENV: 'test' }) });
    if (!model) throw new Error('French OCR model files not found (@tesseract.js-data/fra)');
    ocr = new ServerOCR({ engineFactory: () => createTesseractEngine(model, silentLogger), logger: silentLogger });
  }, 120_000);

  afterAll(async () => {
    await ocr?.shutdown();
  });

  it('the fixture is a real PNG page', () => {
    const info = sniffImage(image);
    expect(info?.mime).toBe('image/png');
    expect(info?.width).toBeGreaterThan(1500);
  });

  it('recognizes French text with accents with a low character error rate', async () => {
    const result = await ocr.recognize(image);
    const text = result.blocks.map((b) => b.text).join('\n\n');
    const cer = characterErrorRate(frenchPageText(), text);

    expect(result.engine).toBe('tesseract-best');
    expect(result.confidence).toBeGreaterThan(70);
    expect(cer, `CER ${cer.toFixed(3)} for:\n${text}`).toBeLessThanOrEqual(MAX_CER);
    for (const word of ['forêt', 'enchantée', 'Élodie', 'écureuil', 'garçon', 'pêche', 'château', 'fenêtre', 'aperçoit', 'naïf']) {
      expect(text).toContain(word);
    }
    expect(result.blocks[0]?.text).toContain('La forêt enchantée');
    // Lines of one paragraph stay in the same block even though the engine returns one block per line here.
    expect(result.blocks.some((b) => b.text.includes('soleil d’été, et un écureuil curieux'))).toBe(true);
  }, 120_000);

  it('reports an undecodable image as invalid_image and keeps working', async () => {
    const corrupt = Buffer.concat([image.subarray(0, 64), Buffer.alloc(512, 7)]);
    const error = await ocr.recognize(corrupt).then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(OcrError);
    expect((error as OcrError).kind).toBe('invalid_image');
    const again = await ocr.recognize(image);
    expect(again.blocks.length).toBeGreaterThan(0);
  }, 120_000);

  it('never writes language data or images next to the working directory', () => {
    const model = resolveOcrModel({ config: loadConfig({ NODE_ENV: 'test' }) });
    expect(model && tesseractWorkerOptions(model).cacheMethod).toBe('none');
    const written = readdirSync(process.cwd()).filter((f) => /traineddata|\.png$|\.jpe?g$/i.test(f));
    expect(written).toEqual([]);
  });

  it('CER helper sanity', () => {
    expect(editDistance('forêt', 'foret')).toBe(1);
    expect(characterErrorRate('l’été', "l'été")).toBe(0);
  });
});
