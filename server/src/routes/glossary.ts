import { GlossaryEntrySchema, LIMITS, type OkResponse } from '@aide/shared';
import { Router } from 'express';
import { z } from 'zod';
import { parentIdOf, requireAuth, requireParentUnlock } from '../auth/middleware';
import { deleteGlossaryEntry, listGlossaryEntries, normalizeHeadword, saveGlossaryEntry } from '../db/repositories/glossary';
import { appError, parseOrThrow } from '../errors';
import type { AppDeps } from '../types';

const HeadwordParamSchema = z.string().trim().min(1).max(LIMITS.wordMaxChars);

/** Mounted by app.ts at `/api/glossary`: declare paths relative to that prefix. */
export function createGlossaryRouter(deps: AppDeps): Router {
  const router = Router();
  const auth = requireAuth(deps);
  const unlocked = requireParentUnlock(deps);

  router.get('/', auth, async (req, res) => {
    res.set('Cache-Control', 'no-store').json(await listGlossaryEntries(deps.db, parentIdOf(req)));
  });

  router.put('/:headword', auth, unlocked, async (req, res) => {
    const parentId = parentIdOf(req);
    const headword = normalizeHeadword(parseOrThrow(HeadwordParamSchema, req.params.headword));
    const entry = parseOrThrow(GlossaryEntrySchema, req.body);
    if (normalizeHeadword(entry.headword) !== headword) throw appError(400, 'invalid_request');
    res.json(await saveGlossaryEntry(deps.db, parentId, entry, deps.now()));
  });

  router.delete('/:headword', auth, unlocked, async (req, res) => {
    const headword = parseOrThrow(HeadwordParamSchema, req.params.headword);
    await deleteGlossaryEntry(deps.db, parentIdOf(req), headword);
    const ok: OkResponse = { ok: true };
    res.json(ok);
  });

  return router;
}
