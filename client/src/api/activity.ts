// Thin wrappers over §7 /api/activity.
import {
  FreeQuestionHistorySchema, WritingCorrectionHistorySchema, type ActivityQuery, type ActivitySummary, type FreeQuestionHistory, type Id,
  type OkResponse, type WritingCorrectionHistory,
} from '@aide/shared';
import { ApiError, api } from './http';

export function getActivity(query: ActivityQuery = {}): Promise<ActivitySummary> {
  const params = new URLSearchParams();
  if (query.childId) params.set('childId', query.childId);
  if (query.from !== undefined) params.set('from', String(query.from));
  if (query.to !== undefined) params.set('to', String(query.to));
  const qs = params.toString();
  return api<ActivitySummary>('GET', qs ? `/api/activity?${qs}` : '/api/activity');
}

/** Marks a parent alert as seen (sets `seenAt`, §15.3/§15.10). Requires the unlocked parent area. */
export async function markAlertSeen(id: Id): Promise<void> {
  await api<OkResponse>('POST', `/api/activity/alerts/${encodeURIComponent(id)}/seen`);
}

export const FREE_QUESTION_HISTORY_LIMIT = 100;
const FREE_QUESTION_HISTORY_MAX = 200;

/**
 * GET /api/activity/questions (§18.3): free questions (« Pose ta question ») of one child over the last 30 days, most
 * recent first. Requires the unlocked parent area. Throws ApiError; an answer outside the contract → `invalid_response`.
 */
export async function getFreeQuestionHistory(
  childId: Id,
  limit: number = FREE_QUESTION_HISTORY_LIMIT,
  opts: { signal?: AbortSignal } = {},
): Promise<FreeQuestionHistory> {
  const bounded = Math.min(FREE_QUESTION_HISTORY_MAX, Math.max(1, Math.floor(Number.isFinite(limit) ? limit : FREE_QUESTION_HISTORY_LIMIT)));
  const params = new URLSearchParams({ childId, limit: String(bounded) });
  const raw = await api<unknown>('GET', `/api/activity/questions?${params.toString()}`, undefined, { signal: opts.signal });
  const parsed = FreeQuestionHistorySchema.safeParse(raw);
  if (!parsed.success) throw new ApiError(200, 'invalid_response', 'Invalid free question history');
  return parsed.data;
}

/** §24 texts corrected in the text boxes of one child, newest first (one year kept). */
export const WRITING_HISTORY_LIMIT = 50;

/**
 * GET /api/activity/writing (§24): corrected texts of one child with what changed, the count per kind and the mistakes made
 * again. Requires the unlocked parent area. Throws ApiError; an answer outside the contract → `invalid_response`.
 */
export async function getWritingCorrectionHistory(childId: Id, opts: { signal?: AbortSignal } = {}): Promise<WritingCorrectionHistory> {
  const params = new URLSearchParams({ childId, limit: String(WRITING_HISTORY_LIMIT) });
  const raw = await api<unknown>('GET', `/api/activity/writing?${params.toString()}`, undefined, { signal: opts.signal });
  const parsed = WritingCorrectionHistorySchema.safeParse(raw);
  if (!parsed.success) throw new ApiError(200, 'invalid_response', 'Invalid writing correction history');
  return parsed.data;
}
