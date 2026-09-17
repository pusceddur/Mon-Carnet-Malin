import { Router, type RequestHandler } from 'express';
import { AIOperationSchema, IdSchema } from '@aide/shared';
import { parentIdOf, requireAuth } from '../auth/middleware';
import { appError } from '../errors';
import type { AIServices } from '../ai/services';
import { getAIServices } from '../ai/services';
import type { AppDeps } from '../types';

export interface AiRouterOptions {
  /** Tests: injected services instead of the ones built from AppDeps. */
  services?: AIServices | Promise<AIServices>;
  /** Tests: replaces requireAuth. */
  auth?: RequestHandler;
}

/** Mounted by app.ts at `/api/ai`: declare paths relative to that prefix. */
export function createAiRouter(deps: AppDeps, options: AiRouterOptions = {}): Router {
  const router = Router();
  const services = (): Promise<AIServices> => Promise.resolve(options.services ?? getAIServices(deps));
  router.use(options.auth ?? requireAuth(deps));

  router.get('/jobs/:jobId', async (req, res) => {
    const jobId = IdSchema.safeParse(req.params.jobId);
    if (!jobId.success) throw appError(404, 'not_found');
    const poll = await (await services()).router.pollJob(parentIdOf(req), jobId.data);
    if (!poll) throw appError(404, 'not_found');
    res.set('Cache-Control', 'no-store').json(poll);
  });

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
