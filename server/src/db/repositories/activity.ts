// Read-only views over the AI log tables for the parent activity page (the AI module owns their writes).
import type { ActivityAlertKind, ActivitySummary, AIOperation, AIRoute } from '@aide/shared';
import { type Db, type Row, toBool, toNum, toNumOrNull, toStr, toStrOrNull } from './common';

export type ActivityAiRequest = ActivitySummary['aiRequests'][number];
export type ActivityAlert = ActivitySummary['alerts'][number];

interface RangeFilter { childId?: string; from: number; to: number; limit?: number }

export async function listAiRequests(db: Db, parentId: string, f: RangeFilter): Promise<ActivityAiRequest[]> {
  const query = db('ai_requests')
    .select('id', 'created_at', 'child_id', 'operation', 'route', 'provider', 'model', 'status', 'rejection_reason', 'cache_hit', 'duration_ms')
    .where('parent_id', parentId)
    .andWhere('created_at', '>=', f.from)
    .andWhere('created_at', '<=', f.to)
    .orderBy('created_at', 'desc')
    .limit(f.limit ?? 500);
  if (f.childId) query.andWhere('child_id', f.childId);
  const rows = (await query) as Row[];
  return rows.map((row) => ({
    id: toStr(row.id),
    createdAt: toNum(row.created_at),
    childId: toStrOrNull(row.child_id),
    operation: toStr(row.operation) as AIOperation,
    route: toStr(row.route) as AIRoute,
    provider: toStr(row.provider),
    model: toStr(row.model),
    status: toStr(row.status),
    rejectionReason: toStrOrNull(row.rejection_reason),
    cacheHit: toBool(row.cache_hit),
    durationMs: toNum(row.duration_ms),
  }));
}

export async function listAlerts(db: Db, parentId: string, f: RangeFilter): Promise<ActivityAlert[]> {
  const query = db('safety_alerts')
    .select('id', 'created_at', 'child_id', 'kind', 'detail', 'seen_at')
    .where('parent_id', parentId)
    .andWhere('created_at', '>=', f.from)
    .andWhere('created_at', '<=', f.to)
    .orderBy('created_at', 'desc')
    .limit(f.limit ?? 200);
  if (f.childId) query.andWhere('child_id', f.childId);
  const rows = (await query) as Row[];
  return rows.map((row) => ({
    id: toStr(row.id),
    createdAt: toNum(row.created_at),
    childId: toStrOrNull(row.child_id),
    kind: toStr(row.kind) as ActivityAlertKind,
    detail: toStr(row.detail),
    seenAt: toNumOrNull(row.seen_at),
  }));
}

/** Sets seen_at once; false when the alert does not exist for this parent. */
export async function markAlertSeen(db: Db, parentId: string, id: string, now: number): Promise<boolean> {
  const row = (await db('safety_alerts').select('seen_at').where({ id, parent_id: parentId }).first()) as Row | undefined;
  if (!row) return false;
  if (row.seen_at === null || row.seen_at === undefined) {
    await db('safety_alerts').where({ id, parent_id: parentId }).whereNull('seen_at').update({ seen_at: now });
  }
  return true;
}

/** First millisecond of the UTC calendar month containing `now`. */
export function monthStartUtc(now: number): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
}

/** Sum of ai_requests.cost_micros (millionths of a euro) of the current UTC month for a parent. */
export async function monthToDateCostMicros(db: Db, parentId: string, now: number): Promise<number> {
  const row = (await db('ai_requests')
    .where('parent_id', parentId)
    .andWhere('created_at', '>=', monthStartUtc(now))
    .whereNotNull('cost_micros')
    .sum({ total: 'cost_micros' })
    .first()) as { total: unknown } | undefined;
  return toNum(row?.total);
}
