import { LIMITS, type SyncResponse } from '@aide/shared';
import express, { Router } from 'express';
import { z } from 'zod';
import { parentIdOf, requireAuth } from '../auth/middleware';
import { getParentSettings } from '../db/repositories/settings';
import { addRestoredEntities, parseCursor, pullChanges } from '../db/sync/pull';
import { applyPush, type RawChanges } from '../db/sync/push';
import { appError, parseOrThrow } from '../errors';
import type { AppDeps } from '../types';

/** Well above the client batch (1000 entities per request), low enough to bound memory and transaction time. */
const MAX_ROWS_PER_TABLE = 2000;
const RawList = z.array(z.unknown()).max(MAX_ROWS_PER_TABLE).default([]);

/** Envelope only: every entity is validated on its own so that one bad row yields a `rejected` entry, not a 400. */
const SyncEnvelopeSchema = z.object({
  cursor: z.string().min(1).max(64).nullable(),
  deviceId: z.string().min(1).max(100),
  changes: z.object({
    documents: RawList,
    pages: RawList,
    annotations: RawList,
    progress: RawList,
    sessions: RawList,
    exercises: RawList,
    answers: RawList,
    children: RawList,
  }),
});

/** Mounted by app.ts at `/api/sync` (the app-wide JSON parser skips this path: 25 MB limit, parsed after auth). */
export function createSyncRouter(deps: AppDeps): Router {
  const router = Router();

  router.post('/', requireAuth(deps), express.json({ limit: LIMITS.syncBodyMaxBytes }), async (req, res) => {
    const parentId = parentIdOf(req);
    const body = parseOrThrow(SyncEnvelopeSchema, req.body);
    const cursor = parseCursor(body.cursor);
    if (cursor === null) throw appError(400, 'invalid_request');

    const serverTime = deps.now();
    const settings = await getParentSettings(deps.db, parentId);
    const unlockedUntil = req.auth?.parentUnlockedUntil ?? null;
    const changes: RawChanges = body.changes;

    const unlocked = unlockedUntil !== null && unlockedUntil > serverTime;
    const { rejected, restore } = await applyPush(deps.db, { parentId, unlocked, serverTime, settings }, changes);
    const pulled = await pullChanges(deps.db, parentId, cursor, settings);
    // Server versions of rejected entities are added even when the cursor is already past them.
    await addRestoredEntities(deps.db, parentId, settings, restore, pulled.changes);
    if (rejected.length > 0) {
      deps.logger.info('sync_rejected', { parentId, deviceId: body.deviceId, count: rejected.length });
    }
    const response: SyncResponse = {
      cursor: String(pulled.cursor),
      hasMore: pulled.hasMore,
      serverTime,
      changes: pulled.changes,
      rejected,
    };
    res.set('Cache-Control', 'no-store').json(response);
  });

  return router;
}
