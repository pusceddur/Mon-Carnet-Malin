import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { RequestHandler } from 'express';
import type { Knex } from 'knex';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/app';
import { loadConfig } from '../../src/config';
import { createDb, runMigrations } from '../../src/db/knex';
import { silentLogger } from '../../src/logger';
import { peekSharedServerOcr } from '../../src/ocr/instance';
import { ocrHealth } from '../../src/ocr/status';
import { frenchPageText, characterErrorRate, renderFrenchPagePng } from './helpers/frenchPage';

vi.mock('../../src/auth/middleware', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/auth/middleware')>();
  const requireAuth = (): RequestHandler => (req, res, next) => {
    const parent = req.get('x-test-parent');
    if (!parent) {
      res.status(401).json({ error: { code: 'not_authenticated', message: 'Tu dois te connecter.' } });
      return;
    }
    req.auth = { userId: parent, sessionId: 'session-test', parentUnlockedUntil: null };
    next();
  };
  return { ...actual, requireAuth };
});

const FIXTURE = fileURLToPath(new URL('./fixtures/page-fr.png', import.meta.url));

describe('createApp wiring of /api/ocr, /api/dictionary and OCR health (real engine)', () => {
  let db: Knex;
  let app: ReturnType<typeof createApp>;

  beforeAll(async () => {
    if (!existsSync(FIXTURE)) await renderFrenchPagePng(FIXTURE);
    const config = loadConfig({ NODE_ENV: 'test', DATABASE_URL: 'sqlite::memory:', CLIENT_DIST_DIR: './__no_client_dist__', WIKTIONARY_ENABLED: 'false' });
    db = createDb(config.databaseUrl);
    await runMigrations(db);
    app = createApp({ config, db, logger: silentLogger, now: () => Date.now() });
  }, 120_000);

  afterAll(async () => {
    await peekSharedServerOcr()?.shutdown();
    await db.destroy();
  });

  it('reports the OCR engine as available and idle', () => {
    expect(ocrHealth()).toEqual({ available: true, busy: false });
  });

  it('POST /api/ocr returns OcrServerResult for a real page', async () => {
    const res = await request(app)
      .post('/api/ocr')
      .set('X-Requested-With', 'aide')
      .set('x-test-parent', 'parent-1')
      .attach('image', readFileSync(FIXTURE), { filename: 'page.png', contentType: 'image/png' });
    expect(res.status).toBe(200);
    expect(res.body.engine).toBe('tesseract-best');
    const text = (res.body.blocks as { text: string }[]).map((b) => b.text).join('\n\n');
    expect(characterErrorRate(frenchPageText(), text)).toBeLessThanOrEqual(0.05);
  }, 120_000);

  it('POST /api/ocr without the anti-CSRF header is refused before any upload', async () => {
    const res = await request(app).post('/api/ocr').set('x-test-parent', 'parent-1').attach('image', Buffer.from('x'), 'page.png');
    expect(res.status).toBe(403);
  });

  it('GET /api/dictionary validates input and answers without network when Wiktionnaire is disabled', async () => {
    expect((await request(app).get('/api/dictionary').query({ word: 'deux mots' }).set('x-test-parent', 'parent-1')).status).toBe(400);
    const res = await request(app).get('/api/dictionary').query({ word: 'zzkwxq' }).set('x-test-parent', 'parent-1');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'not_found' });
  });
});
