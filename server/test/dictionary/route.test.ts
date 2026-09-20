import type { DictionaryResult } from '@aide/shared';
import express, { type Express, type RequestHandler } from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../../src/config';
import { createDb } from '../../src/db/knex';
import type { DictionaryService } from '../../src/dictionary/DictionaryService';
import { errorHandler } from '../../src/errors';
import { silentLogger } from '../../src/logger';
import { createDictionaryRouter, DictionaryWordQuerySchema } from '../../src/routes/dictionary';
import type { AppDeps } from '../../src/types';

// Authentication belongs to another module: a header stands in for a valid session.
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

const FOUND: DictionaryResult = {
  status: 'found',
  entry: {
    headword: 'chevaux',
    lemma: 'cheval',
    partOfSpeech: 'nom',
    definition: 'Grand animal.',
    example: null,
    source: 'wiktionnaire',
    attribution: 'Wiktionnaire (CC BY-SA 4.0) — https://fr.wiktionary.org/wiki/cheval',
    kidFriendly: true,
  },
};

function makeApp(options: { rateLimitPer15Min?: number } = {}): { app: Express; lookup: ReturnType<typeof vi.fn> } {
  const lookup = vi.fn(async (): Promise<DictionaryResult> => FOUND);
  const service: DictionaryService = { lookup };
  const deps: AppDeps = { config: loadConfig({ NODE_ENV: 'test' }), db: createDb('sqlite::memory:'), logger: silentLogger, now: () => Date.now() };
  const app = express();
  app.use('/api/dictionary', createDictionaryRouter(deps, { service, ...options }));
  app.use(errorHandler(silentLogger));
  return { app, lookup };
}

describe('GET /api/dictionary', () => {
  it('requires authentication', async () => {
    const { app, lookup } = makeApp();
    const res = await request(app).get('/api/dictionary').query({ word: 'chat' });
    expect(res.status).toBe(401);
    expect(lookup).not.toHaveBeenCalled();
  });

  it('returns the DictionaryResult for the parent of the session', async () => {
    const { app, lookup } = makeApp();
    const res = await request(app).get('/api/dictionary').query({ word: 'chevaux' }).set('x-test-parent', 'parent-1');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(FOUND);
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(lookup).toHaveBeenCalledWith('parent-1', 'chevaux');
  });

  it.each([
    ['missing word', {}],
    ['empty word', { word: '   ' }],
    ['two words', { word: 'pomme de' }],
    ['digits', { word: 'abc123' }],
    ['punctuation', { word: 'chat?' }],
    ['markup', { word: '<b>chat</b>' }],
    ['too long', { word: 'a'.repeat(51) }],
    ['repeated parameter', { word: ['chat', 'chien'] }],
  ])('rejects %s with 400 invalid_request', async (_label, query) => {
    const { app, lookup } = makeApp();
    const res = await request(app).get('/api/dictionary').query(query).set('x-test-parent', 'parent-1');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('invalid_request');
    expect(lookup).not.toHaveBeenCalled();
  });

  it.each(['arc-en-ciel', 'aujourd’hui', "aujourd'hui", 'l’', 'Écureuil', 'anticonstitutionnellement', 'cœur'])('accepts %s', (word) => {
    expect(DictionaryWordQuerySchema.safeParse({ word }).success).toBe(true);
  });

  it('rate limits per parent account', async () => {
    const { app } = makeApp({ rateLimitPer15Min: 2 });
    for (let i = 0; i < 2; i += 1) {
      expect((await request(app).get('/api/dictionary').query({ word: 'chat' }).set('x-test-parent', 'parent-1')).status).toBe(200);
    }
    const limited = await request(app).get('/api/dictionary').query({ word: 'chat' }).set('x-test-parent', 'parent-1');
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe('rate_limited');
    const otherFamily = await request(app).get('/api/dictionary').query({ word: 'chat' }).set('x-test-parent', 'parent-2');
    expect(otherFamily.status).toBe(200);
  });
});
