import { type ClientDiagnosticKind, type ClientDiagnosticReport, type DiagnosticValue, newId } from '@aide/shared';
import { type Db, parseJson, type Row, toNum, toStr, toStrOrNull } from './common';

const TABLE = 'client_diagnostics';

export type StoredClientDiagnostic = ClientDiagnosticReport & { id: string; createdAt: number };

/** Rows stored for `parentId` with `created_at >= since`. */
export async function countDiagnosticsSince(db: Db, parentId: string, since: number): Promise<number> {
  const row = (await db(TABLE).where('parent_id', parentId).andWhere('created_at', '>=', since).count({ n: '*' }).first()) as Row | undefined;
  return toNum(row?.n);
}

/** Inserts reports with server-generated ids; returns the number of rows written. */
export async function insertDiagnostics(db: Db, parentId: string, reports: readonly ClientDiagnosticReport[], createdAt: number): Promise<number> {
  if (reports.length === 0) return 0;
  await db(TABLE).insert(
    reports.map((r) => ({
      id: newId(),
      parent_id: parentId,
      kind: r.kind,
      stage: r.stage,
      message: r.message,
      context_json: JSON.stringify(r.context),
      user_agent: r.userAgent,
      occurred_at: r.occurredAt,
      created_at: createdAt,
    })),
  );
  return reports.length;
}

/** Most recent reports of `parentId`, newest first. */
export async function listDiagnostics(db: Db, parentId: string, limit: number): Promise<StoredClientDiagnostic[]> {
  const rows = (await db(TABLE)
    .where('parent_id', parentId)
    .orderBy([{ column: 'created_at', order: 'desc' }, { column: 'occurred_at', order: 'desc' }, { column: 'id', order: 'asc' }])
    .limit(limit)) as Row[];
  return rows.map((row) => ({
    id: toStr(row.id),
    kind: toStr(row.kind) as ClientDiagnosticKind,
    message: toStr(row.message),
    stage: toStrOrNull(row.stage),
    context: parseJson<Record<string, DiagnosticValue>>(row.context_json, {}),
    userAgent: toStr(row.user_agent),
    occurredAt: toNum(row.occurred_at),
    createdAt: toNum(row.created_at),
  }));
}

export async function deleteDiagnosticsBefore(db: Db, cutoff: number): Promise<number> {
  return db(TABLE).where('created_at', '<', cutoff).delete();
}
