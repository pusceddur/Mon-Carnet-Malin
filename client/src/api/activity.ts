// STUB: client-shell — thin wrapper over §7 /api/activity
import type { ActivityQuery, ActivitySummary } from '@aide/shared';
import { api } from './http';

export function getActivity(query: ActivityQuery = {}): Promise<ActivitySummary> {
  const params = new URLSearchParams();
  if (query.childId) params.set('childId', query.childId);
  if (query.from !== undefined) params.set('from', String(query.from));
  if (query.to !== undefined) params.set('to', String(query.to));
  const qs = params.toString();
  return api<ActivitySummary>('GET', qs ? `/api/activity?${qs}` : '/api/activity');
}
