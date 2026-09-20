import { Router, type Request, type RequestHandler } from 'express';
import { AIOperationSchema, IdSchema } from '@aide/shared';
import { ipKey, parentIdOf, rateLimiter, requireAuth } from '../auth/middleware';
import { appError } from '../errors';
import type { AIServices } from '../ai/services';
import { getAIServices } from '../ai/services';
import type { AppDeps } from '../types';

/** §18.2.5 per-session limits (in memory, per process). The daily limit per child stays in the router. */
export const AI_RATE_LIMITS = {
  windowMs: 60_000,
  /** Every /api/ai/* request of a session (compatible with summaries: 2 chunks in parallel + job polling). */
  perSession: 120,
  /** POST /api/ai/free_question of a session. */
  freeQuestionPerSession: 10,
} as const;

export interface AiRouterOptions {
  /** Tests: injected services instead of the ones built from AppDeps. */
  services?: AIServices | Promise<AIServices>;
  /** Tests: replaces requireAuth. */
  auth?: RequestHandler;
}

function sessionKey(req: Request): string {
  return req.auth?.sessionId ?? `ip:${ipKey(req)}`;
}

/** Mounted by app.ts at `/api/ai`: declare paths relative to that prefix. */
export function createAiRouter(deps: AppDeps, options: AiRouterOptions = {}): Router {
  const router = Router();
  const services = (): Promise<AIServices> => Promise.resolve(options.services ?? getAIServices(deps));
  router.use(options.auth ?? requireAuth(deps));
  router.use(rateLimiter(deps, { windowMs: AI_RATE_LIMITS.windowMs, limit: AI_RATE_LIMITS.perSession, key: (req) => `ai:${sessionKey(req)}` }));

  // `waitMs` (≤ 20 s): the answer is sent as soon as the job is done instead of the client asking again and again.
  router.get('/jobs/:jobId', async (req, res) => {
    const jobId = IdSchema.safeParse(req.params.jobId);
    if (!jobId.success) throw appError(404, 'not_found');
    const waitMs = Number(typeof req.query.waitMs === 'string' ? req.query.waitMs : 0);
    const gone = new AbortController();
    res.on('close', () => gone.abort());
    const poll = await (await services()).router.waitForJob(parentIdOf(req), jobId.data, Number.isFinite(waitMs) ? waitMs : 0, gone.signal);
    // The client went away while waiting: nobody reads the answer.
    if (gone.signal.aborted) return;
    if (!poll) throw appError(404, 'not_found');
    res.set('Cache-Control', 'no-store').json(poll);
  });

  // Counted before the generic handler below (next() goes on to '/:operation').
  router.post('/free_question', rateLimiter(deps, {
    windowMs: AI_RATE_LIMITS.windowMs, limit: AI_RATE_LIMITS.freeQuestionPerSession, key: (req) => `free-question:${sessionKey(req)}`,
  }));

  router.post('/:operation', async (req, res) => {
    const op = AIOperationSchema.safeParse(req.params.operation);
    if (!op.success) throw appError(404, 'not_found');
    const parentId = parentIdOf(req);

    // Abort the provider call when the client goes away (a response that already arrived is still validated and cached).
    const controller = new AbortController();
    res.on('close', () => {
      if (!res.writableFinished) controller.abort();
    });

    const outcome = await (await services()).router.handle(op.data, parentId, req.body, { signal: controller.signal });
    if (outcome.kind === 'aborted' || res.writableEnded || controller.signal.aborted) return;
    res.status(outcome.httpStatus).set('Cache-Control', 'no-store').json(outcome.body);
  });

  return router;
}
