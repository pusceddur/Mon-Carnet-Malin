import { type ActivitySummary, ActivityQuerySchema, IdSchema, type OkResponse } from '@aide/shared';
import { Router } from 'express';
import { parentIdOf, requireAuth, requireParentUnlock } from '../auth/middleware';
import { listAiRequests, listAlerts, markAlertSeen, monthToDateCostMicros } from '../db/repositories/activity';
import { listOcrIssues } from '../db/repositories/pages';
import { listReadingSessions } from '../db/repositories/readingSessions';
import { getParentSettings } from '../db/repositories/settings';
import { appError, parseOrThrow } from '../errors';
import type { AppDeps } from '../types';

/** Default window of the activity view when `from` is omitted. */
export const ACTIVITY_DEFAULT_WINDOW_MS = 30 * 24 * 60 * 60_000;

/** Mounted by app.ts at `/api/activity`: declare paths relative to that prefix. */
export function createActivityRouter(deps: AppDeps): Router {
  const router = Router();
  const auth = requireAuth(deps);
  const unlocked = requireParentUnlock(deps);

  router.get('/', auth, unlocked, async (req, res) => {
    const parentId = parentIdOf(req);
    const query = parseOrThrow(ActivityQuerySchema, req.query);
    const now = deps.now();
    const to = query.to ?? now;
    const from = query.from ?? Math.max(0, to - ACTIVITY_DEFAULT_WINDOW_MS);
    const range = { childId: query.childId, from, to };

    const settings = await getParentSettings(deps.db, parentId);
    const summary: ActivitySummary = {
      sessions: await listReadingSessions(deps.db, parentId, range),
      aiRequests: await listAiRequests(deps.db, parentId, range),
      alerts: await listAlerts(deps.db, parentId, range),
      ocrIssues: await listOcrIssues(deps.db, parentId, { childId: query.childId }),
      budget: {
        monthToDateEur: (await monthToDateCostMicros(deps.db, parentId, now)) / 1_000_000,
        monthlyBudgetEur: settings.ai.monthlyBudgetEur,
      },
    };
    res.set('Cache-Control', 'no-store').json(summary);
  });

  router.post('/alerts/:id/seen', auth, unlocked, async (req, res) => {
    const id = parseOrThrow(IdSchema, req.params.id);
    if (!(await markAlertSeen(deps.db, parentIdOf(req), id, deps.now()))) throw appError(404, 'not_found');
    const ok: OkResponse = { ok: true };
    res.json(ok);
  });

  return router;
}
