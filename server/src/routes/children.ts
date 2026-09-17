import {
  type ChildProfile, ChildProfileSchema, CreateChildRequestSchema, IdSchema, type OkResponse, UpdateChildRequestSchema,
  UpdatePreferencesRequestSchema,
} from '@aide/shared';
import { Router } from 'express';
import { parentIdOf, requireAuth, requireParentUnlock } from '../auth/middleware';
import { buildNewChild, getChild, listChildren, saveChild } from '../db/repositories/children';
import { withSeq } from '../db/repositories/syncCounters';
import { appError, parseOrThrow } from '../errors';
import type { AppDeps } from '../types';

/** updatedAt of a server-side edit: never behind the stored value (LWW with devices). */
function nextUpdatedAt(now: number, previous: number): number {
  return Math.max(now, previous + 1);
}

/** Mounted by app.ts at `/api/children`: declare paths relative to that prefix. */
export function createChildrenRouter(deps: AppDeps): Router {
  const router = Router();
  const auth = requireAuth(deps);
  const unlocked = requireParentUnlock(deps);

  router.get('/', auth, async (req, res) => {
    res.set('Cache-Control', 'no-store').json(await listChildren(deps.db, parentIdOf(req)));
  });

  router.post('/', auth, unlocked, async (req, res) => {
    const parentId = parentIdOf(req);
    const body = parseOrThrow(CreateChildRequestSchema, req.body);
    const child = parseOrThrow(ChildProfileSchema, buildNewChild(parentId, body, deps.now()));
    await withSeq(deps.db, parentId, (trx, seq) => saveChild(trx, child, seq.next()));
    res.status(201).json(child);
  });

  router.put('/:id', auth, unlocked, async (req, res) => {
    const parentId = parentIdOf(req);
    const id = parseOrThrow(IdSchema, req.params.id);
    const body = parseOrThrow(UpdateChildRequestSchema, req.body);
    if (body.id !== id) throw appError(400, 'invalid_request');
    const saved = await withSeq(deps.db, parentId, async (trx, seq) => {
      const existing = await getChild(trx, parentId, id);
      if (!existing) throw appError(404, 'not_found');
      const next: ChildProfile = {
        ...body,
        id,
        parentId,
        createdAt: existing.createdAt,
        updatedAt: nextUpdatedAt(deps.now(), existing.updatedAt),
        deletedAt: null,
      };
      await saveChild(trx, next, seq.next());
      return next;
    });
    res.json(saved);
  });

  // The child adjusts reading comfort without the parent PIN.
  router.patch('/:id/preferences', auth, async (req, res) => {
    const parentId = parentIdOf(req);
    const id = parseOrThrow(IdSchema, req.params.id);
    const body = parseOrThrow(UpdatePreferencesRequestSchema, req.body);
    const saved = await withSeq(deps.db, parentId, async (trx, seq) => {
      const existing = await getChild(trx, parentId, id);
      if (!existing) throw appError(404, 'not_found');
      const next = parseOrThrow(ChildProfileSchema, {
        ...existing,
        reading: { ...existing.reading, ...body.reading },
        tts: { ...existing.tts, ...body.tts },
        updatedAt: nextUpdatedAt(deps.now(), existing.updatedAt),
      });
      await saveChild(trx, next, seq.next());
      return next;
    });
    res.json(saved);
  });

  router.delete('/:id', auth, unlocked, async (req, res) => {
    const parentId = parentIdOf(req);
    const id = parseOrThrow(IdSchema, req.params.id);
    await withSeq(deps.db, parentId, async (trx, seq) => {
      const existing = await getChild(trx, parentId, id, { includeDeleted: true });
      if (!existing) throw appError(404, 'not_found');
      if (existing.deletedAt !== null) return;
      const updatedAt = nextUpdatedAt(deps.now(), existing.updatedAt);
      await saveChild(trx, { ...existing, updatedAt, deletedAt: updatedAt }, seq.next());
    });
    const ok: OkResponse = { ok: true };
    res.json(ok);
  });

  return router;
}
