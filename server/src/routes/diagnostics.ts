import { ClientDiagnosticsRequestSchema, type OkResponse } from '@aide/shared';
import express, { Router } from 'express';
import { z } from 'zod';
import { parentIdOf, rateLimiter, requireAuth, requireParentUnlock } from '../auth/middleware';
import { countDiagnosticsSince, insertDiagnostics, listDiagnostics } from '../db/repositories/diagnostics';
import { parseOrThrow } from '../errors';
import type { AppDeps } from '../types';

const DAY_MS = 24 * 60 * 60_000;

export const DIAGNOSTICS = {
  bodyMaxBytes: 64 * 1024,
  rateWindowMs: 10 * 60_000,
  rateLimit: 30,
  /** Rows kept per parent over a rolling 24 h window; extra reports are dropped silently. */
  dailyRowsMax: 300,
  listDefault: 100,
  listMax: 200,
} as const;

const ListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(DIAGNOSTICS.listMax).default(DIAGNOSTICS.listDefault),
});

/** Mounted by app.ts at `/api/diagnostics` (the app-wide JSON parser skips this path: 64 kB limit, parsed after auth). */
export function createDiagnosticsRouter(deps: AppDeps): Router {
  const router = Router();
  const auth = requireAuth(deps);
  const limiter = rateLimiter(deps, {
    windowMs: DIAGNOSTICS.rateWindowMs,
    limit: DIAGNOSTICS.rateLimit,
    key: (req) => `diagnostics:${req.auth?.sessionId ?? ''}`,
  });

  router.post('/', auth, limiter, express.json({ limit: DIAGNOSTICS.bodyMaxBytes }), async (req, res) => {
    const parentId = parentIdOf(req);
    const { reports } = parseOrThrow(ClientDiagnosticsRequestSchema, req.body);
    const now = deps.now();
    const alreadyStored = await countDiagnosticsSince(deps.db, parentId, now - DAY_MS);
    const accepted = reports.slice(0, Math.max(0, DIAGNOSTICS.dailyRowsMax - alreadyStored));
    const stored = await insertDiagnostics(deps.db, parentId, accepted, now);
    // Messages and context stay out of the application logs.
    deps.logger.info('client_diagnostics_received', {
      count: reports.length,
      stored,
      kinds: [...new Set(reports.map((r) => (r.stage === null ? r.kind : `${r.kind}/${r.stage}`)))],
    });
    const ok: OkResponse = { ok: true };
    res.status(202).json(ok);
  });

  router.get('/', auth, requireParentUnlock(deps), async (req, res) => {
    const { limit } = parseOrThrow(ListQuerySchema, req.query);
    res.set('Cache-Control', 'no-store').json(await listDiagnostics(deps.db, parentIdOf(req), limit));
  });

  return router;
}
