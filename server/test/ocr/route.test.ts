import { LIMITS, type OcrServerResult } from '@aide/shared';
import express, { type Express, type RequestHandler } from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../../src/config';
import { createDb } from '../../src/db/knex';
import { errorHandler } from '../../src/errors';
import { silentLogger } from '../../src/logger';
import { OcrError, type ServerOcrLike, type ServerOcrStatus } from '../../src/ocr/ServerOCR';
import { createOcrRouter } from '../../src/routes/ocr';
import type { AppDeps } from '../../src/types';
import { bytes, jpegHeader, le32, pngHeader } from './helpers/images';

vi.mock('../../src/auth/middleware', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/auth/middleware')>();
  const requireAuth = (): RequestHandler => (req, res, next) => {
    const parent = req.get('x-test-parent');
    if (!parent) {
      res.status(401).json({ error: { code: 'not_authenticated', message: 'Tu dois te connecter.' } });
      return;
    }
    req.auth = { userId: parent, sessionId: 'session-test', parentUnlockedUntil: null, pinRequired: true };
    next();
  };
  return { ...actual, requireAuth };
});

const RESULT: OcrServerResult = { blocks: [{ kind: 'paragraph', text: 'Élodie marche dans la forêt.' }], confidence: 91.5, engine: 'tesseract-best' };

class FakeOcr implements ServerOcrLike {
  images: Uint8Array[] = [];
  state: ServerOcrStatus = { available: true, busy: false, running: false, queued: 0, engineLoaded: false };
  outcome: OcrServerResult | OcrError = RESULT;

  async recognize(image: Uint8Array): Promise<OcrServerResult> {
    this.images.push(image);
    if (this.outcome instanceof OcrError) throw this.outcome;
    return this.outcome;
  }

  status(): ServerOcrStatus {
    return this.state;
  }

  retryAfterSeconds(): number {
    return 42;
  }
}

function makeApp(options: { rateLimitPerHour?: number } = {}): { app: Express; ocr: FakeOcr } {
  const ocr = new FakeOcr();
  const deps: AppDeps = { config: loadConfig({ NODE_ENV: 'test' }), db: createDb('sqlite::memory:'), logger: silentLogger, now: () => Date.now() };
  const app = express();
  app.use('/api/ocr', createOcrRouter(deps, { ocr, ...options }));
  app.use(errorHandler(silentLogger));
  return { app, ocr };
}

const png = (): Buffer => Buffer.concat([Buffer.from(pngHeader(1240, 1754)), Buffer.alloc(64)]);
const post = (app: Express) => request(app).post('/api/ocr').set('x-test-parent', 'parent-1');

describe('POST /api/ocr', () => {
  it('requires authentication', async () => {
    const { app, ocr } = makeApp();
    const res = await request(app).post('/api/ocr').attach('image', png(), 'page.png');
    expect(res.status).toBe(401);
    expect(ocr.images).toHaveLength(0);
  });

  it('recognizes an uploaded PNG, JPEG or WebP kept in memory', async () => {
    const { app, ocr } = makeApp();
    const res = await post(app).attach('image', png(), { filename: 'page.png', contentType: 'image/png' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual(RESULT);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(Buffer.from(ocr.images[0] ?? []).equals(png())).toBe(true);

    const jpeg = Buffer.concat([Buffer.from(jpegHeader(1000, 1400)), Buffer.alloc(32)]);
    expect((await post(app).attach('image', jpeg, 'photo.jpg')).status).toBe(200);
    const webp = Buffer.from(bytes('RIFF', le32(100), 'WEBP', 'VP8X', le32(10), [0, 0, 0, 0], [0x3f, 0x06, 0], [0x3f, 0x06, 0], [0, 0]));
    expect((await post(app).attach('image', webp, 'photo.webp')).status).toBe(200);
  });

  it('checks magic bytes, not the declared type or file name', async () => {
    const { app, ocr } = makeApp();
    const gif = Buffer.from('GIF89a......');
    const res = await post(app).attach('image', gif, { filename: 'page.png', contentType: 'image/png' });
    expect(res.status).toBe(415);
    expect(res.body.error.code).toBe('unsupported_image');
    const pdf = await post(app).attach('image', Buffer.from('%PDF-1.7 ...'), { filename: 'page.jpg', contentType: 'image/jpeg' });
    expect(pdf.status).toBe(415);
    expect(ocr.images).toHaveLength(0);
  });

  it('refuses images whose declared size is too large to decode', async () => {
    const { app } = makeApp();
    const bomb = Buffer.concat([Buffer.from(pngHeader(40_000, 40_000)), Buffer.alloc(16)]);
    const res = await post(app).attach('image', bomb, 'bomb.png');
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('image_too_large');
  });

  it('refuses files over 15 MB with 413', async () => {
    const { app, ocr } = makeApp();
    const big = Buffer.concat([png(), Buffer.alloc(LIMITS.ocrImageMaxBytes)]);
    const res = await post(app).attach('image', big, 'big.png');
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('payload_too_large');
    expect(ocr.images).toHaveLength(0);
  });

  it('answers 400 when the image field is missing or misnamed', async () => {
    const { app } = makeApp();
    expect((await post(app).field('autre', 'x')).body.error.code).toBe('missing_image');
    const wrongField = await post(app).attach('fichier', png(), 'page.png');
    expect(wrongField.status).toBe(400);
    expect(wrongField.body.error.code).toBe('invalid_request');
    expect((await post(app).send({ image: 'x' })).status).toBe(400);
  });

  it('answers 503 ocr_busy with Retry-After before reading the upload when the queue is full', async () => {
    const { app, ocr } = makeApp();
    ocr.state = { ...ocr.state, busy: true, running: true, queued: 3 };
    const res = await post(app).attach('image', png(), 'page.png');
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('ocr_busy');
    expect(res.headers['retry-after']).toBe('42');
    expect(ocr.images).toHaveLength(0);
  });

  it.each([
    [new OcrError('busy', 17), 503, 'ocr_busy', '17'],
    [new OcrError('timeout', 30), 503, 'ocr_timeout', '30'],
    [new OcrError('unavailable', null), 503, 'ocr_unavailable', '30'],
    [new OcrError('failed', 20), 503, 'ocr_failed', '20'],
    [new OcrError('invalid_image'), 422, 'invalid_image', undefined],
  ])('maps %s to HTTP %i', async (error, status, code, retryAfter) => {
    const { app, ocr } = makeApp();
    ocr.outcome = error;
    const res = await post(app).attach('image', png(), 'page.png');
    expect(res.status).toBe(status);
    expect(res.body.error.code).toBe(code);
    expect(typeof res.body.error.message).toBe('string');
    expect(res.headers['retry-after']).toBe(retryAfter);
  });

  it('answers 503 ocr_unavailable when the engine cannot run', async () => {
    const { app, ocr } = makeApp();
    ocr.state = { ...ocr.state, available: false };
    const res = await post(app).attach('image', png(), 'page.png');
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('ocr_unavailable');
  });

  it('rate limits per parent account (60 per hour by default)', async () => {
    const { app } = makeApp({ rateLimitPerHour: 2 });
    expect((await post(app).attach('image', png(), 'a.png')).status).toBe(200);
    expect((await post(app).attach('image', png(), 'b.png')).status).toBe(200);
    const limited = await post(app).attach('image', png(), 'c.png');
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe('rate_limited');
    const other = await request(app).post('/api/ocr').set('x-test-parent', 'parent-2').attach('image', png(), 'd.png');
    expect(other.status).toBe(200);
  });
});
