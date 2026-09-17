// §15.3 retention + §15.6 purge of files of deleted documents + §17.2 worker jobs. Idempotent; safe to run at any time.
import type { Knex } from 'knex';
import { type Row, toStr } from '../db/repositories/common';
import { deleteDiagnosticsBefore } from '../db/repositories/diagnostics';
import { deleteStoredFiles, type FileKind, listStoredFiles } from '../db/repositories/files';
import { deleteExpiredSessions } from '../db/repositories/sessions';
import { deleteDocumentWorkerJobs, purgeWorkerJobs } from '../db/repositories/workerJobs';
import { removeStored } from '../db/storage/uploads';
import type { Logger } from '../logger';

const HOUR_MS = 60 * 60_000;
const DAY_MS = 24 * HOUR_MS;

export const RETENTION = {
  aiRequestsMs: 180 * DAY_MS,
  seenAlertsMs: 90 * DAY_MS,
  deletedChildrenMs: 30 * DAY_MS,
  deletedDocumentsMs: 30 * DAY_MS,
  clientDiagnosticsMs: 30 * DAY_MS,
  /** §17.2: concluded `ai` worker jobs (their answer may still be in the row). */
  workerAiJobsMs: HOUR_MS,
  /** §17.2: concluded page_text (and other) worker jobs. */
  workerJobsMs: 7 * DAY_MS,
} as const;

export interface RetentionReport {
  aiRequests: number;
  safetyAlerts: number;
  aiJobs: number;
  expiredAiCache: number;
  sessions: number;
  clientDiagnostics: number;
  purgedChildren: number;
  purgedDocuments: number;
  removedFiles: number;
  /** Queued worker jobs past their expiry, marked `expired`. */
  expiredWorkerJobs: number;
  /** Concluded worker jobs deleted (plus the jobs of purged documents). */
  workerJobs: number;
}

/** Tables holding per-child data removed with a purged child. */
const CHILD_DATA_TABLES = ['answers', 'annotations', 'exercises', 'reading_progress', 'reading_sessions', 'ai_requests', 'safety_alerts', 'ai_jobs'] as const;

async function purgeDeletedChildren(db: Knex, cutoff: number): Promise<number> {
  const rows = (await db('children').select('id', 'parent_id').whereNotNull('deleted_at').andWhere('deleted_at', '<', cutoff)) as Row[];
  for (const row of rows) {
    const childId = toStr(row.id);
    const parentId = toStr(row.parent_id);
    await db.transaction(async (trx) => {
      for (const table of CHILD_DATA_TABLES) await trx(table).where({ parent_id: parentId, child_id: childId }).delete();
      await trx('children').where({ id: childId, parent_id: parentId }).delete();
    });
  }
  return rows.length;
}

async function purgeDeletedDocuments(db: Knex, cutoff: number, uploadsRoot: string): Promise<{ documents: number; files: number; workerJobs: number }> {
  const rows = (await db('documents').select('id').whereNotNull('deleted_at').andWhere('deleted_at', '<', cutoff)) as Row[];
  let documents = 0;
  let files = 0;
  let workerJobs = 0;
  for (const row of rows) {
    const documentId = toStr(row.id);
    let touched = false;
    for (const kind of ['original', 'page_image'] as const satisfies readonly FileKind[]) {
      const stored = await listStoredFiles(db, kind, documentId);
      for (const file of stored) await removeStored(uploadsRoot, file.storagePath);
      files += stored.length;
      if ((await deleteStoredFiles(db, kind, documentId)) > 0) touched = true;
    }
    // Page text of a document deleted for 30 days is not kept either (its tombstone stays for sync).
    if ((await db('document_pages').where('document_id', documentId).delete()) > 0) touched = true;
    const jobs = await deleteDocumentWorkerJobs(db, documentId);
    workerJobs += jobs;
    if (jobs > 0) touched = true;
    if (touched) documents += 1;
  }
  return { documents, files, workerJobs };
}

/** §17.2 worker queue retention alone (also run hourly: concluded `ai` rows must not stay longer than 1 h). */
export function runWorkerJobsRetention(db: Knex, now: number): Promise<{ expired: number; deleted: number }> {
  return purgeWorkerJobs(db, now, { aiMs: RETENTION.workerAiJobsMs, otherMs: RETENTION.workerJobsMs });
}

export async function runRetention(opts: { db: Knex; now: number; uploadsRoot: string }): Promise<RetentionReport> {
  const { db, now } = opts;
  const aiRequests = await db('ai_requests').where('created_at', '<', now - RETENTION.aiRequestsMs).delete();
  const safetyAlerts = await db('safety_alerts').whereNotNull('seen_at').andWhere('seen_at', '<', now - RETENTION.seenAlertsMs).delete();
  const aiJobs = await db('ai_jobs').where('expires_at', '<', now).delete();
  const expiredAiCache = await db('ai_cache').whereNotNull('expires_at').andWhere('expires_at', '<', now).delete();
  const sessions = await deleteExpiredSessions(db, now);
  const clientDiagnostics = await deleteDiagnosticsBefore(db, now - RETENTION.clientDiagnosticsMs);
  const purgedChildren = await purgeDeletedChildren(db, now - RETENTION.deletedChildrenMs);
  const purged = await purgeDeletedDocuments(db, now - RETENTION.deletedDocumentsMs, opts.uploadsRoot);
  const worker = await runWorkerJobsRetention(db, now);
  return {
    aiRequests,
    safetyAlerts,
    aiJobs,
    expiredAiCache,
    sessions,
    clientDiagnostics,
    purgedChildren,
    purgedDocuments: purged.documents,
    removedFiles: purged.files,
    expiredWorkerJobs: worker.expired,
    workerJobs: worker.deleted + purged.workerJobs,
  };
}

export const MAINTENANCE_INTERVAL_MS = DAY_MS;
export const WORKER_MAINTENANCE_INTERVAL_MS = HOUR_MS;

/**
 * Runs retention now and every 24 h, plus the worker queue retention every hour; errors are logged, never thrown.
 * Returns a stop function.
 */
export function startMaintenance(opts: {
  db: Knex; now(): number; uploadsRoot: string; logger: Logger; intervalMs?: number; workerIntervalMs?: number;
}): () => void {
  let running = false;
  const run = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      const report = await runRetention({ db: opts.db, now: opts.now(), uploadsRoot: opts.uploadsRoot });
      opts.logger.info('maintenance_done', { ...report });
    } catch (err) {
      opts.logger.error('maintenance_failed', { error: err });
    } finally {
      running = false;
    }
  };
  const runWorker = async (): Promise<void> => {
    if (running) return;
    try {
      const report = await runWorkerJobsRetention(opts.db, opts.now());
      if (report.expired + report.deleted > 0) opts.logger.info('worker_maintenance_done', { ...report });
    } catch (err) {
      opts.logger.error('worker_maintenance_failed', { error: err });
    }
  };
  void run();
  const timer = setInterval(() => void run(), opts.intervalMs ?? MAINTENANCE_INTERVAL_MS);
  timer.unref();
  const workerTimer = setInterval(() => void runWorker(), opts.workerIntervalMs ?? WORKER_MAINTENANCE_INTERVAL_MS);
  workerTimer.unref();
  return () => {
    clearInterval(timer);
    clearInterval(workerTimer);
  };
}
