// Thin wrappers over §7 /api/activity.
import type { ActivityQuery, ActivitySummary, Id, OkResponse } from '@aide/shared';
import { api } from './http';

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
