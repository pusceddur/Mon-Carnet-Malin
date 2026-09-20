import { type ActivitySummary, ActivityQuerySchema, type FreeQuestionHistory, IdSchema, type OkResponse, type WritingCorrectionHistory } from '@aide/shared';
import { Router } from 'express';
import { z } from 'zod';
import { parentIdOf, requireAuth, requireParentUnlock } from '../auth/middleware';
import { listAiRequests, listAlerts, markAlertSeen, monthStartUtc, monthToDateCostMicros } from '../db/repositories/activity';
import { getChild } from '../db/repositories/children';
import { FREE_QUESTIONS_RETENTION_MS, listFreeQuestions } from '../db/repositories/freeQuestions';
import { listOcrIssues } from '../db/repositories/pages';
import { listReadingSessions } from '../db/repositories/readingSessions';
import { getParentSettings } from '../db/repositories/settings';
import { sumWorkerCostMicros } from '../db/repositories/workerUsage';
import { WRITING_CORRECTIONS_RETENTION_MS, writingCorrectionHistory } from '../db/repositories/writingCorrections';
import { appError, parseOrThrow } from '../errors';
import type { AppDeps } from '../types';

/** Default window of the activity view when `from` is omitted. */
export const ACTIVITY_DEFAULT_WINDOW_MS = 30 * 24 * 60 * 60_000;

/** GET /api/activity/questions (§18.3). */
export const FREE_QUESTIONS_LIST = { defaultLimit: 50, maxLimit: 200 } as const;

const QuestionsQuerySchema = z.object({
  childId: IdSchema,
  limit: z.coerce.number().int().min(1).max(FREE_QUESTIONS_LIST.maxLimit).default(FREE_QUESTIONS_LIST.defaultLimit),
});

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
        workerEstimateEur: (await sumWorkerCostMicros(deps.db, parentId, monthStartUtc(now))) / 1_000_000,
      },
    };
    res.set('Cache-Control', 'no-store').json(summary);
  });

  // §18.3 « Questions posées »: free questions of one child of the last 30 days, newest first (even blocked ones).
  router.get('/questions', auth, unlocked, async (req, res) => {
    const parentId = parentIdOf(req);
    const query = parseOrThrow(QuestionsQuerySchema, req.query);
    if (!(await getChild(deps.db, parentId, query.childId))) throw appError(404, 'not_found');
    const history: FreeQuestionHistory = {
      entries: await listFreeQuestions(deps.db, parentId, query.childId, { since: deps.now() - FREE_QUESTIONS_RETENTION_MS, limit: query.limit }),
    };
    res.set('Cache-Control', 'no-store').json(history);
  });

  // §24 texts corrected with « Corriger »: one child, the kept year (entries newest first, counts, frequent mistakes).
  router.get('/writing', auth, unlocked, async (req, res) => {
    const parentId = parentIdOf(req);
    const query = parseOrThrow(QuestionsQuerySchema, req.query);
    if (!(await getChild(deps.db, parentId, query.childId))) throw appError(404, 'not_found');
    const history: WritingCorrectionHistory = await writingCorrectionHistory(deps.db, parentId, query.childId, {
      since: deps.now() - WRITING_CORRECTIONS_RETENTION_MS, limit: query.limit,
    });
    res.set('Cache-Control', 'no-store').json(history);
  });

  router.post('/alerts/:id/seen', auth, unlocked, async (req, res) => {
    const id = parseOrThrow(IdSchema, req.params.id);
    if (!(await markAlertSeen(deps.db, parentIdOf(req), id, deps.now()))) throw appError(404, 'not_found');
    const ok: OkResponse = { ok: true };
    res.json(ok);
  });

  return router;
}
