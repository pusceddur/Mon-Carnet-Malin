import { ParentSettingsSchema } from '@aide/shared';
import { Router } from 'express';
import { parentIdOf, requireAuth, requireParentUnlock } from '../auth/middleware';
import { getParentSettings, mergeParentSettings, saveParentSettings } from '../db/repositories/settings';
import { parseOrThrow } from '../errors';
import type { AppDeps } from '../types';
import { workerStatusFor } from '../worker/status';

/** Mounted by app.ts at `/api/settings`: declare paths relative to that prefix. */
export function createSettingsRouter(deps: AppDeps): Router {
  const router = Router();
  const auth = requireAuth(deps);
  const unlocked = requireParentUnlock(deps);

  router.get('/', auth, async (req, res) => {
    res.set('Cache-Control', 'no-store').json(await getParentSettings(deps.db, parentIdOf(req)));
  });

  // §17.5: external worker status for the settings page (no unlock needed: read-only, no secret).
  router.get('/worker', auth, async (req, res) => {
    res.set('Cache-Control', 'no-store').json(await workerStatusFor(deps, parentIdOf(req)));
  });

  router.put('/', auth, unlocked, async (req, res) => {
    const parentId = parentIdOf(req);
    const body = parseOrThrow(ParentSettingsSchema, req.body);
    const previous = await getParentSettings(deps.db, parentId);
    const settings = mergeParentSettings(body, Math.max(deps.now(), previous.updatedAt + 1));
    await saveParentSettings(deps.db, parentId, settings);
    res.json(settings);
  });

  return router;
}
