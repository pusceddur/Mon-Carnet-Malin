// Thin wrappers over /api/ai (§7, §15.4). The UI must go through ai/aiClient.ts, which validates, caches and never throws.
import type { AIJobAccepted, AIJobPoll, AIOperation, AIResult, DataFor, RequestFor } from '@aide/shared';
import { api } from './http';

export interface AIHttpOptions { signal?: AbortSignal; timeoutMs?: number }

/** POST /api/ai/:op → 200 AIResult (light route) or 202 AIJobAccepted (complex route). Throws ApiError. */
export function postAI<Op extends AIOperation>(op: Op, body: RequestFor<Op>, opts: AIHttpOptions = {}): Promise<AIResult<DataFor<Op>> | AIJobAccepted> {
  return api<AIResult<DataFor<Op>> | AIJobAccepted>('POST', `/api/ai/${op}`, body, opts);
}

/**
 * GET /api/ai/jobs/:jobId → AIJobPoll. `waitMs`: the server answers as soon as the job is done, at the latest after waitMs
 * (older servers answer at once). Throws ApiError.
 */
export function getAIJob<Op extends AIOperation>(jobId: string, opts: AIHttpOptions & { waitMs?: number } = {}): Promise<AIJobPoll<DataFor<Op>>> {
  const { waitMs, ...http } = opts;
  const query = waitMs !== undefined && waitMs > 0 ? `?waitMs=${Math.round(waitMs)}` : '';
  return api<AIJobPoll<DataFor<Op>>>('GET', `/api/ai/jobs/${encodeURIComponent(jobId)}${query}`, undefined, http);
}
