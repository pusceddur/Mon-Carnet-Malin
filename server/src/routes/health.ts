// STUB: server-platform (functional: DB ping; AI flags stay false until server-ai exposes provider status)
import { Router } from 'express';
import type { HealthStatus } from '@aide/shared';
import { pingDb } from '../db/knex';
import type { AppDeps } from '../types';

/** Mounted by app.ts at `/api/health`. */
export function createHealthRouter(deps: AppDeps): Router {
  const router = Router();
  router.get('/', async (_req, res) => {
    const body: HealthStatus = { ok: true, db: await pingDb(deps.db), ai: { light: false, complex: false } };
    res.set('Cache-Control', 'no-store').json(body);
  });
  return router;
}
