// §21 use of the home worker (table `worker_usage`): one row per reported result, with the cost estimated by the worker.
import { newId } from '@aide/shared';
import { type Db, toNum } from './common';

const TABLE = 'worker_usage';

/** Rows older than this are purged (a little more than a year of monthly figures). */
export const WORKER_USAGE_RETENTION_MS = 400 * 24 * 60 * 60_000;

export interface WorkerUsageEntry {
  parentId: string;
  kind: string;
  operation: string;
  /** 'done' or the error code of the run. */
  outcome: string;
  inputTokens: number | null;
  outputTokens: number | null;
  costMicros: number | null;
}

export async function recordWorkerUsage(db: Db, entry: WorkerUsageEntry, now: number): Promise<void> {
  await db(TABLE).insert({
    id: newId(),
    parent_id: entry.parentId,
    kind: entry.kind,
    operation: entry.operation.slice(0, 40),
    outcome: entry.outcome.slice(0, 16),
    input_tokens: entry.inputTokens,
    output_tokens: entry.outputTokens,
    cost_micros: entry.costMicros,
    created_at: now,
  });
}

/** Estimated cost (millionths of a euro) since `since`, for one account or (parentId null) for all of them. */
export async function sumWorkerCostMicros(db: Db, parentId: string | null, since: number): Promise<number> {
  const query = db(TABLE).where('created_at', '>=', since).whereNotNull('cost_micros');
  if (parentId !== null) query.andWhere('parent_id', parentId);
  const row = (await query.sum({ total: 'cost_micros' }).first()) as { total: unknown } | undefined;
  return toNum(row?.total);
}

export async function purgeWorkerUsage(db: Db, before: number): Promise<number> {
  return db(TABLE).where('created_at', '<', before).delete();
}
