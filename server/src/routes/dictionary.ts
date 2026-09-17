import { DictionaryQuerySchema } from '@aide/shared';
import { Router } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { requireAuth } from '../auth/middleware';
import { createDictionaryService, type DictionaryService } from '../dictionary/DictionaryService';
import { ERROR_MESSAGES_FR, errorBody, parseOrThrow } from '../errors';
import type { AppDeps } from '../types';

/** Longest accepted word (the longest common French words are ~25 letters). */
export const DICTIONARY_WORD_MAX_CHARS = 50;
/** One word: letters, optional inner hyphens/apostrophes ("arc-en-ciel", "aujourd’hui"), optional elided "l’". */
const SINGLE_WORD = /^[\p{L}\p{M}]+(?:[-'’][\p{L}\p{M}]+)*['’]?$/u;

export const DictionaryWordQuerySchema = DictionaryQuerySchema.refine(
  (q) => q.word.length <= DICTIONARY_WORD_MAX_CHARS && SINGLE_WORD.test(q.word.normalize('NFC')),
);

export interface DictionaryRouterOptions {
  service?: DictionaryService;
  /** Lookups per parent account per 15 minutes. */
  rateLimitPer15Min?: number;
}

/** Mounted by app.ts at `/api/dictionary`: GET /api/dictionary?word=… → DictionaryResult. */
export function createDictionaryRouter(deps: AppDeps, options: DictionaryRouterOptions = {}): Router {
  const service = options.service ?? createDictionaryService(deps);
  const router = Router();

  const limiter = rateLimit({
    windowMs: 15 * 60_000,
    limit: options.rateLimitPer15Min ?? 300,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: (req) => (req.auth ? `parent:${req.auth.userId}` : ipKeyGenerator(req.ip ?? '')),
    handler: (_req, res) => {
      res.status(429).json(errorBody('rate_limited', ERROR_MESSAGES_FR.rate_limited));
    },
  });

  router.get('/', requireAuth(deps), limiter, async (req, res) => {
    const { word } = parseOrThrow(DictionaryWordQuerySchema, req.query);
    const parentId = req.auth?.userId;
    if (!parentId) {
      res.status(401).json(errorBody('not_authenticated', ERROR_MESSAGES_FR.not_authenticated));
      return;
    }
    const result = await service.lookup(parentId, word.normalize('NFC'));
    res.set('Cache-Control', 'private, no-store').json(result);
  });

  return router;
}
