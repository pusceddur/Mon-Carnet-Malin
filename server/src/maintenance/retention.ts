// §15.3 retention + §15.6 purge of files of deleted documents + §17.2 worker jobs + §18.3 free questions + §20 e-mail
// links and confirmation of use + §21 use of the home worker. Idempotent; safe to run at any time.
import type { Knex } from 'knex';
import { runContinuity } from '../auth/continuity';
import { type Row, toStr } from '../db/repositories/common';
import { deleteDiagnosticsBefore } from '../db/repositories/diagnostics';
import { deleteStaleEmailTokens } from '../db/repositories/emailTokens';
import { deleteStoredFiles, type FileKind, listStoredFiles } from '../db/repositories/files';
import { DELETED_ACCOUNT_TOKENS_RETENTION_MS, purgeDeletedAccountTokens } from '../db/repositories/accountDeletion';
import { deleteFreeQuestionsBefore, FREE_QUESTIONS_RETENTION_MS } from '../db/repositories/freeQuestions';
import { deleteExpiredSessions } from '../db/repositories/sessions';
import { deleteDocumentWorkerJobs, purgeWorkerJobs } from '../db/repositories/workerJobs';
import { purgeWorkerUsage, WORKER_USAGE_RETENTION_MS } from '../db/repositories/workerUsage';
import { deleteWritingCorrectionsBefore, WRITING_CORRECTIONS_RETENTION_MS } from '../db/repositories/writingCorrections';
import { removeStored } from '../db/storage/uploads';
import { disabledMailer, type Mailer } from '../email/mailer';
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
  /** §18.3: free questions of « Pose ta question » (30 days). */
  freeQuestionsMs: FREE_QUESTIONS_RETENTION_MS,
  /** §21: use of the home worker (monthly figures). */
  workerUsageMs: WORKER_USAGE_RETENTION_MS,
  /** §24: texts corrected with « Corriger » (one year). */
  writingCorrectionsMs: WRITING_CORRECTIONS_RETENTION_MS,
  /** §30: hashes of the session tokens of deleted accounts, kept as long as a session could have lived. */
  deletedAccountTokensMs: DELETED_ACCOUNT_TOKENS_RETENTION_MS,
} as const;

export interface RetentionReport {
  aiRequests: number;
  safetyAlerts: number;
  aiJobs: number;
  expiredAiCache: number;
  sessions: number;
  /** §20 used or expired e-mail links. */
  emailTokens: number;
  clientDiagnostics: number;
  purgedChildren: number;
  purgedDocuments: number;
  removedFiles: number;
  /** Queued worker jobs past their expiry, marked `expired`. */
  expiredWorkerJobs: number;
  /** Waiting page jobs of deleted documents, marked `skipped`. */
  orphanedWorkerJobs: number;
  /** Concluded worker jobs deleted (plus the jobs of purged documents). */
  workerJobs: number;
  /** Free questions older than 30 days (those of purged children are counted in purgedChildren). */
  freeQuestions: number;
  /** §21 rows of worker use older than ~13 months. */
  workerUsage: number;
  /** §24 corrected texts older than one year (those of purged children are counted in purgedChildren). */
  writingCorrections: number;
  /** §30 session hashes of deleted accounts, once no device can still be carrying one. */
  deletedAccountTokens: number;
}

/** Tables holding per-child data removed with a purged child. */
const CHILD_DATA_TABLES = [
  'answers', 'annotations', 'exercises', 'reading_progress', 'reading_sessions', 'ai_requests', 'safety_alerts', 'ai_jobs', 'free_questions',
  'writing_corrections',
] as const;

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
export function runWorkerJobsRetention(db: Knex, now: number): Promise<{ expired: number; orphaned: number; deleted: number }> {
  return purgeWorkerJobs(db, now, { aiMs: RETENTION.workerAiJobsMs, otherMs: RETENTION.workerJobsMs });
}

export async function runRetention(opts: { db: Knex; now: number; uploadsRoot: string }): Promise<RetentionReport> {
  const { db, now } = opts;
  const aiRequests = await db('ai_requests').where('created_at', '<', now - RETENTION.aiRequestsMs).delete();
  const safetyAlerts = await db('safety_alerts').whereNotNull('seen_at').andWhere('seen_at', '<', now - RETENTION.seenAlertsMs).delete();
  const aiJobs = await db('ai_jobs').where('expires_at', '<', now).delete();
  const expiredAiCache = await db('ai_cache').whereNotNull('expires_at').andWhere('expires_at', '<', now).delete();
  const sessions = await deleteExpiredSessions(db, now);
  const emailTokens = await deleteStaleEmailTokens(db, now);
  const clientDiagnostics = await deleteDiagnosticsBefore(db, now - RETENTION.clientDiagnosticsMs);
  const freeQuestions = await deleteFreeQuestionsBefore(db, now - RETENTION.freeQuestionsMs);
  const purgedChildren = await purgeDeletedChildren(db, now - RETENTION.deletedChildrenMs);
  const purged = await purgeDeletedDocuments(db, now - RETENTION.deletedDocumentsMs, opts.uploadsRoot);
  const worker = await runWorkerJobsRetention(db, now);
  const workerUsage = await purgeWorkerUsage(db, now - RETENTION.workerUsageMs);
  const writingCorrections = await deleteWritingCorrectionsBefore(db, now - RETENTION.writingCorrectionsMs);
  const deletedAccountTokens = await purgeDeletedAccountTokens(db, now - RETENTION.deletedAccountTokensMs);
  return {
    aiRequests,
    safetyAlerts,
    aiJobs,
    expiredAiCache,
    sessions,
    emailTokens,
    clientDiagnostics,
    purgedChildren,
    purgedDocuments: purged.documents,
    removedFiles: purged.files,
    expiredWorkerJobs: worker.expired,
    orphanedWorkerJobs: worker.orphaned,
    workerJobs: worker.deleted + purged.workerJobs,
    freeQuestions,
    workerUsage,
    writingCorrections,
    deletedAccountTokens,
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
  /** §20 confirmation of use every 180 days (nothing happens without a configured mailer). */
  mailer?: Mailer;
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
    }
    try {
      const continuity = await runContinuity({ db: opts.db, now: opts.now(), mailer: opts.mailer ?? disabledMailer, logger: opts.logger });
      if (continuity.asked + continuity.failed + continuity.signedOut > 0) opts.logger.info('continuity_done', { ...continuity });
    } catch (err) {
      opts.logger.error('continuity_failed', { error: err });
    } finally {
      running = false;
    }
  };
  const runWorker = async (): Promise<void> => {
    if (running) return;
    try {
      const report = await runWorkerJobsRetention(opts.db, opts.now());
      if (report.expired + report.orphaned + report.deleted > 0) opts.logger.info('worker_maintenance_done', { ...report });
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
