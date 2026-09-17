// worker_jobs + worker_state (§17.2, §17.3): portable SQL (MySQL/MariaDB and SQLite), atomic claims by conditional UPDATE.
import type { PageTextSource } from '@aide/shared';
import type { WorkerJobKind, WorkerJobRequest, WorkerJobStatus, WorkerLimits, WorkerTier } from '../../worker/protocol';
import { type Db, type Row, parseJson, toNum, toNumOrNull, toStr, toStrOrNull } from './common';

const JOBS = 'worker_jobs';
const STATE = 'worker_state';
const EMPTY_REQUEST = '{}';

/** Pages whose text never comes from a worker transcription. */
export const PROTECTED_TEXT_SOURCES: ReadonlySet<PageTextSource> = new Set<PageTextSource>(['manual', 'pdf-text', 'epub-text']);

export const FINAL_WORKER_STATUSES: readonly WorkerJobStatus[] = ['done', 'failed', 'expired', 'skipped'];

export interface WorkerJob {
  id: string;
  parentId: string;
  kind: WorkerJobKind;
  tier: WorkerTier;
  operation: string;
  documentId: string | null;
  pageIndex: number | null;
  imageSha256: string | null;
  /** null once the job is final (request emptied). */
  request: WorkerJobRequest | null;
  status: WorkerJobStatus;
  priority: number;
  leaseUntil: number | null;
  leasedBy: string | null;
  attempts: number;
  result: unknown;
  error: string | null;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
}

export interface NewWorkerJob {
  id: string;
  parentId: string;
  kind: WorkerJobKind;
  tier: WorkerTier;
  operation: string;
  documentId?: string | null;
  pageIndex?: number | null;
  imageSha256?: string | null;
  request: WorkerJobRequest;
  priority: number;
  createdAt: number;
  expiresAt: number;
}

function jobFromRow(row: Row): WorkerJob {
  const request = parseJson<unknown>(row.request_json, null);
  const hasRequest = typeof request === 'object' && request !== null && 'system' in request;
  return {
    id: toStr(row.id),
    parentId: toStr(row.parent_id),
    kind: toStr(row.kind) as WorkerJobKind,
    tier: toStr(row.tier) === 'complex' ? 'complex' : 'light',
    operation: toStr(row.operation),
    documentId: toStrOrNull(row.document_id),
    pageIndex: toNumOrNull(row.page_index),
    imageSha256: toStrOrNull(row.image_sha256),
    request: hasRequest ? (request as WorkerJobRequest) : null,
    status: toStr(row.status) as WorkerJobStatus,
    priority: toNum(row.priority),
    leaseUntil: toNumOrNull(row.lease_until),
    leasedBy: toStrOrNull(row.leased_by),
    attempts: toNum(row.attempts),
    result: parseJson<unknown>(row.result_json, null),
    error: toStrOrNull(row.error),
    createdAt: toNum(row.created_at),
    updatedAt: toNum(row.updated_at),
    expiresAt: toNum(row.expires_at),
  };
}

export async function insertWorkerJob(db: Db, job: NewWorkerJob): Promise<void> {
  await db(JOBS).insert({
    id: job.id,
    parent_id: job.parentId,
    kind: job.kind,
    tier: job.tier,
    operation: job.operation,
    document_id: job.documentId ?? null,
    page_index: job.pageIndex ?? null,
    image_sha256: job.imageSha256 ?? null,
    request_json: JSON.stringify(job.request),
    status: 'queued',
    priority: job.priority,
    lease_until: null,
    leased_by: null,
    attempts: 0,
    result_json: null,
    error: null,
    created_at: job.createdAt,
    updated_at: job.createdAt,
    expires_at: job.expiresAt,
  });
}

export async function getWorkerJob(db: Db, id: string): Promise<WorkerJob | null> {
  const row = (await db(JOBS).where('id', id).first()) as Row | undefined;
  return row ? jobFromRow(row) : null;
}

/** Status, error and result only (polling by the queue transport: never reads the request). */
export async function getWorkerJobOutcome(db: Db, id: string): Promise<{ status: WorkerJobStatus; error: string | null; result: unknown } | null> {
  const row = (await db(JOBS).select('status', 'error', 'result_json').where('id', id).first()) as Row | undefined;
  if (!row) return null;
  return { status: toStr(row.status) as WorkerJobStatus, error: toStrOrNull(row.error), result: parseJson<unknown>(row.result_json, null) };
}

export async function deleteWorkerJob(db: Db, id: string): Promise<void> {
  await db(JOBS).where('id', id).delete();
}

/**
 * Housekeeping done before each lease pass (§17.3 a): expired leases go back to the queue (or fail after the last attempt),
 * queued jobs past `expires_at` become `expired`.
 */
export async function reclaimWorkerJobs(db: Db, now: number, maxAttempts: number): Promise<{ requeued: number; failed: number; expired: number }> {
  const failed = await db(JOBS)
    .where('status', 'leased')
    .andWhere('lease_until', '<', now)
    .andWhere('attempts', '>=', maxAttempts)
    .update({ status: 'failed', error: 'lease_expired', lease_until: null, request_json: EMPTY_REQUEST, updated_at: now });
  const requeued = await db(JOBS)
    .where('status', 'leased')
    .andWhere('lease_until', '<', now)
    .andWhere('attempts', '<', maxAttempts)
    .update({ status: 'queued', lease_until: null, leased_by: null, updated_at: now });
  const expired = await expireQueuedWorkerJobs(db, now);
  return { requeued, failed, expired };
}

export async function expireQueuedWorkerJobs(db: Db, now: number): Promise<number> {
  return db(JOBS)
    .where('status', 'queued')
    .andWhere('expires_at', '<', now)
    .update({ status: 'expired', request_json: EMPTY_REQUEST, updated_at: now });
}

/** A new lease call means the worker is idle: whatever it still holds goes back to the queue (one job per worker). */
export async function releaseWorkerLeases(db: Db, worker: string, now: number): Promise<number> {
  return db(JOBS)
    .where({ status: 'leased', leased_by: worker })
    .update({ status: 'queued', lease_until: null, leased_by: null, updated_at: now });
}

export interface LeaseCandidate {
  id: string;
  kind: WorkerJobKind;
  /** page_text: text source of the page row (the row is guaranteed to exist). */
  textSource: PageTextSource | null;
}

/**
 * Queued jobs of `kinds`, highest priority first then oldest. A page_text job is a candidate only once its page row exists
 * and its document is not deleted (otherwise it stays queued).
 */
export async function listLeaseCandidates(db: Db, kinds: readonly WorkerJobKind[], now: number, limit: number): Promise<LeaseCandidate[]> {
  const rows = (await db(`${JOBS} as j`)
    .leftJoin('document_pages as p', (join) => {
      join.on('p.document_id', '=', 'j.document_id').andOn('p.page_index', '=', 'j.page_index').andOn('p.parent_id', '=', 'j.parent_id');
    })
    .leftJoin('documents as d', (join) => {
      join.on('d.id', '=', 'j.document_id').andOn('d.parent_id', '=', 'j.parent_id');
    })
    .select('j.id', 'j.kind', 'p.text_source')
    .where('j.status', 'queued')
    .andWhere('j.expires_at', '>=', now)
    .whereIn('j.kind', [...kinds])
    .andWhere((q) => {
      q.whereNot('j.kind', 'page_text').orWhere((page) => {
        page.whereNotNull('p.document_id').whereNotNull('d.id').whereNull('d.deleted_at');
      });
    })
    .orderBy([{ column: 'j.priority', order: 'desc' }, { column: 'j.created_at', order: 'asc' }, { column: 'j.id', order: 'asc' }])
    .limit(limit)) as Row[];
  return rows.map((row) => ({
    id: toStr(row.id),
    kind: toStr(row.kind) as WorkerJobKind,
    textSource: toStrOrNull(row.text_source) as PageTextSource | null,
  }));
}

/** Atomic claim: exactly one caller turns a queued job into a lease (§17.3 c). */
export async function claimWorkerJob(db: Db, id: string, worker: string, now: number, leaseMs: number): Promise<boolean> {
  const updated = await db(JOBS)
    .where({ id, status: 'queued' })
    .update({ status: 'leased', leased_by: worker, lease_until: now + leaseMs, attempts: db.raw('?? + 1', ['attempts']), updated_at: now });
  return updated === 1;
}

export async function renewWorkerLease(db: Db, id: string, worker: string, now: number, leaseMs: number): Promise<boolean> {
  const updated = await db(JOBS).where({ id, status: 'leased', leased_by: worker }).update({ lease_until: now + leaseMs, updated_at: now });
  return updated === 1;
}

export interface FinishPatch {
  status: Exclude<WorkerJobStatus, 'queued' | 'leased'>;
  error?: string | null;
  /** Stored in result_json (ai jobs only). */
  result?: unknown;
}

/** Final state for a job leased by `worker` (conditional: false when the lease is gone). The request is emptied. */
export async function finishLeasedWorkerJob(db: Db, id: string, worker: string, patch: FinishPatch, now: number): Promise<boolean> {
  const updated = await db(JOBS)
    .where({ id, status: 'leased', leased_by: worker })
    .update({
      status: patch.status,
      error: patch.error ?? null,
      result_json: patch.result === undefined ? null : JSON.stringify(patch.result),
      request_json: EMPTY_REQUEST,
      lease_until: null,
      updated_at: now,
    });
  return updated === 1;
}

/** A job leased by `worker` goes back to the queue; `refundAttempt` gives the attempt back (usage limit). */
export async function requeueLeasedWorkerJob(db: Db, id: string, worker: string, now: number, opts: { refundAttempt: boolean }): Promise<boolean> {
  const updated = await db(JOBS)
    .where({ id, status: 'leased', leased_by: worker })
    .update({
      status: 'queued',
      lease_until: null,
      leased_by: null,
      updated_at: now,
      ...(opts.refundAttempt ? { attempts: db.raw('case when ?? > 0 then ?? - 1 else 0 end', ['attempts', 'attempts']) } : {}),
    });
  return updated === 1;
}

/** Marks a queued job `skipped` (conditional). */
export async function skipQueuedWorkerJob(db: Db, id: string, error: string, now: number): Promise<boolean> {
  const updated = await db(JOBS).where({ id, status: 'queued' }).update({ status: 'skipped', error, request_json: EMPTY_REQUEST, updated_at: now });
  return updated === 1;
}

/** queued|leased → expired (the queue transport gave up waiting). False when the job already reached a final state. */
export async function expirePendingWorkerJob(db: Db, id: string, now: number): Promise<boolean> {
  const updated = await db(JOBS)
    .where('id', id)
    .whereIn('status', ['queued', 'leased'])
    .update({ status: 'expired', lease_until: null, request_json: EMPTY_REQUEST, updated_at: now });
  return updated === 1;
}

export interface PageJobRef {
  id: string;
  status: WorkerJobStatus;
  imageSha256: string | null;
}

export async function listPageWorkerJobs(db: Db, parentId: string, documentId: string, pageIndex: number): Promise<PageJobRef[]> {
  const rows = (await db(JOBS)
    .select('id', 'status', 'image_sha256')
    .where({ parent_id: parentId, document_id: documentId, page_index: pageIndex, kind: 'page_text' })) as Row[];
  return rows.map((row) => ({ id: toStr(row.id), status: toStr(row.status) as WorkerJobStatus, imageSha256: toStrOrNull(row.image_sha256) }));
}

/** Jobs of a parent still waiting for or held by a worker. */
export async function countActiveWorkerJobs(db: Db, parentId: string): Promise<{ ai: number; pageText: number }> {
  const rows = (await db(JOBS)
    .select('kind')
    .count({ n: '*' })
    .where('parent_id', parentId)
    .whereIn('status', ['queued', 'leased'])
    .groupBy('kind')) as Row[];
  const counts = { ai: 0, pageText: 0 };
  for (const row of rows) {
    if (row.kind === 'ai') counts.ai = toNum(row.n);
    else if (row.kind === 'page_text') counts.pageText = toNum(row.n);
  }
  return counts;
}

/** Retention of §17.2: expire overdue queued jobs, delete concluded `ai` rows after `aiMs` and other concluded rows after `otherMs`. */
export async function purgeWorkerJobs(db: Db, now: number, opts: { aiMs: number; otherMs: number }): Promise<{ expired: number; deleted: number }> {
  const expired = await expireQueuedWorkerJobs(db, now);
  const ai = await db(JOBS).where('kind', 'ai').whereIn('status', [...FINAL_WORKER_STATUSES]).andWhere('updated_at', '<', now - opts.aiMs).delete();
  const other = await db(JOBS).whereNot('kind', 'ai').whereIn('status', [...FINAL_WORKER_STATUSES]).andWhere('updated_at', '<', now - opts.otherMs).delete();
  return { expired, deleted: ai + other };
}

export async function deleteDocumentWorkerJobs(db: Db, documentId: string): Promise<number> {
  return db(JOBS).where('document_id', documentId).delete();
}

// ---------------------------------------------------------------- worker_state

export interface WorkerInfo {
  version: string;
  currentJobId: string | null;
  limits: WorkerLimits | null;
}

export interface WorkerState {
  workerName: string;
  lastSeenAt: number;
  limitedUntil: number | null;
  info: WorkerInfo | null;
}

function stateFromRow(row: Row): WorkerState {
  const info = parseJson<unknown>(row.info_json, null);
  return {
    workerName: toStr(row.worker_name),
    lastSeenAt: toNum(row.last_seen_at),
    limitedUntil: toNumOrNull(row.limited_until),
    info: typeof info === 'object' && info !== null && 'version' in info ? (info as WorkerInfo) : null,
  };
}

/** Lease call: the worker is alive (creates the row on first contact, keeps its info and limit otherwise). */
export async function touchWorker(db: Db, worker: string, version: string, now: number): Promise<void> {
  const info: WorkerInfo = { version, currentJobId: null, limits: null };
  await db(STATE)
    .insert({ worker_name: worker, last_seen_at: now, limited_until: null, info_json: JSON.stringify(info) })
    .onConflict('worker_name')
    .merge(['last_seen_at']);
}

/** Heartbeat: last seen, reported info and (when `limitedUntil` is not undefined) the usage limit. */
export async function recordHeartbeat(db: Db, worker: string, info: WorkerInfo, limitedUntil: number | null | undefined, now: number): Promise<void> {
  const row: Row = { worker_name: worker, last_seen_at: now, info_json: JSON.stringify(info) };
  if (limitedUntil !== undefined) row.limited_until = limitedUntil;
  const columns = limitedUntil !== undefined ? ['last_seen_at', 'info_json', 'limited_until'] : ['last_seen_at', 'info_json'];
  await db(STATE)
    .insert({ limited_until: null, ...row })
    .onConflict('worker_name')
    .merge(columns);
}

export async function setWorkerLimitedUntil(db: Db, worker: string, limitedUntil: number | null, now: number): Promise<void> {
  const info: WorkerInfo = { version: 'unknown', currentJobId: null, limits: null };
  await db(STATE)
    .insert({ worker_name: worker, last_seen_at: now, limited_until: limitedUntil, info_json: JSON.stringify(info) })
    .onConflict('worker_name')
    .merge(['limited_until', 'last_seen_at']);
}

export async function getWorkerState(db: Db, worker: string): Promise<WorkerState | null> {
  const row = (await db(STATE).where('worker_name', worker).first()) as Row | undefined;
  return row ? stateFromRow(row) : null;
}

export async function listWorkerStates(db: Db): Promise<WorkerState[]> {
  const rows = (await db(STATE).select('*').orderBy('last_seen_at', 'desc').limit(50)) as Row[];
  return rows.map(stateFromRow);
}
