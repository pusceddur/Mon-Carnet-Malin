// HTTP API of the external worker (§17.3), mounted by app.ts at `/api/worker`.
// Bearer token (sha256 known by the server only), no cookie, exempt from the X-Requested-With guard (not a browser),
// except POST /transcriptions which is a parent action with the usual session, unlock and X-Requested-With checks.
import { createHash, timingSafeEqual } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { IdSchema, PageIndexSchema } from '@aide/shared';
import { type RequestHandler, Router } from 'express';
import { z } from 'zod';
import { ipKey, parentIdOf, rateLimiter, requireAuth, requireParentUnlock, requireXRequestedWith } from '../auth/middleware';
import { getDocument } from '../db/repositories/documents';
import { findStoredFile } from '../db/repositories/files';
import {
  claimWorkerJob, finishLeasedWorkerJob, getWorkerJob, getWorkerState, listLeaseCandidates, PROTECTED_TEXT_SOURCES, reclaimWorkerJobs,
  expirePendingWorkerJob, recordHeartbeat, releaseWorkerLeases, renewWorkerLease, requeueLeasedWorkerJob, setWorkerLimitedUntil,
  skipQueuedWorkerJob, touchWorker, type WorkerJob,
} from '../db/repositories/workerJobs';
import { fileSize, resolveStoragePath } from '../db/storage/uploads';
import { appError, ERROR_MESSAGES_FR, parseOrThrow, sendError } from '../errors';
import { uploadsDir } from '../paths';
import type { AppDeps } from '../types';
import { applyPageTranscription, enqueueDocumentTranscriptions, JobNotLeasedError } from '../worker/pageTranscription';
import {
  HeartbeatRequestSchema, type HeartbeatResponse, type LeasedWorkerJob, type LeaseRequest, LeaseRequestSchema, type LeaseResponse,
  ResultRequestSchema, type ResultResponse, type TranscriptionsResponse, WORKER_PROTOCOL, WorkerNameSchema,
} from '../worker/protocol';
import { getWorkerRuntime, type WorkerRuntime } from '../worker/runtime';

const TranscriptionsRequestSchema = z.object({
  documentId: IdSchema,
  pageIndexes: z.array(PageIndexSchema).max(2000).optional(),
});

/** Constant delay before a refused token is answered (not in tests). */
const AUTH_FAILURE_DELAY_MS = 300;
/** Candidates examined per lease pass. */
const LEASE_CANDIDATES = 10;
/** Housekeeping (expired leases and jobs) runs at most this often during a long poll. */
const RECLAIM_EVERY_MS = 5_000;
const RATE_LIMIT_PER_MINUTE = 600;
/** Requests allowed before the token is checked (a worker sends a few per minute). */
const ANONYMOUS_RATE_LIMIT_PER_MINUTE = 120;

/** Worker name of the request (body or query), for the per-worker rate limit. */
function workerKey(req: { body?: unknown; query?: unknown }): string {
  const fromBody = (req.body as { worker?: unknown } | undefined)?.worker;
  const fromQuery = (req.query as { worker?: unknown } | undefined)?.worker;
  const name = typeof fromBody === 'string' ? fromBody : typeof fromQuery === 'string' ? fromQuery : '';
  return name.slice(0, 64) || 'unknown';
}

function tokenDigest(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest();
}

function bearerAuth(deps: AppDeps, expectedHex: string): RequestHandler {
  const expected = Buffer.from(expectedHex, 'hex');
  const delay = deps.config.isTest ? 0 : AUTH_FAILURE_DELAY_MS;
  return (req, res, next) => {
    const match = /^Bearer ([A-Za-z0-9._~+/=-]{1,512})$/.exec(req.get('authorization') ?? '');
    // Always hash and compare, whatever the header looks like (no early exit revealing the format).
    const digest = tokenDigest(match?.[1] ?? '');
    if (timingSafeEqual(digest, expected) && match !== null) {
      next();
      return;
    }
    setTimeout(() => sendError(req, res, 401, 'not_authenticated', ERROR_MESSAGES_FR.not_authenticated), delay);
  };
}

function conflict(): never {
  throw appError(409, 'job_not_leased');
}

function sleep(ms: number, signals: readonly AbortSignal[]): Promise<void> {
  return new Promise((resolve) => {
    if (signals.some((s) => s.aborted)) {
      resolve();
      return;
    }
    const done = (): void => {
      clearTimeout(timer);
      for (const s of signals) s.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    for (const s of signals) s.addEventListener('abort', done, { once: true });
  });
}

/** Execution budget sent to the worker: the tier deadline for `ai` (never beyond the job expiry), fixed for page_text. */
function deadlineFor(deps: AppDeps, job: WorkerJob, now: number): number {
  if (job.kind === 'page_text') return WORKER_PROTOCOL.pageTextDeadlineMs;
  return Math.max(1_000, Math.min(deps.config.worker.deadlines[job.tier], job.expiresAt - now));
}

function leasedView(deps: AppDeps, job: WorkerJob, now: number): LeasedWorkerJob | null {
  if (!job.request) return null;
  return {
    ...job.request,
    id: job.id,
    kind: job.kind,
    tier: job.tier,
    operation: job.operation,
    imageUrl: job.kind === 'page_text' ? `/api/worker/jobs/${job.id}/image` : null,
    deadlineMs: deadlineFor(deps, job, now),
    leaseMs: WORKER_PROTOCOL.leaseMs,
  };
}

/** One lease pass (§17.3 b, c): the first queued candidate this worker can take, claimed atomically. */
async function leaseOnce(deps: AppDeps, runtime: WorkerRuntime, body: LeaseRequest): Promise<LeasedWorkerJob | null> {
  const now = deps.now();
  // Paused by a usage limit: no job until the reset (the worker also pauses itself).
  const limitedUntil = (await getWorkerState(deps.db, body.worker))?.limitedUntil ?? null;
  if (limitedUntil !== null && limitedUntil > now) return null;
  for (let pass = 0; pass < 5; pass++) {
    const candidates = await listLeaseCandidates(deps.db, body.kinds, now, LEASE_CANDIDATES);
    if (candidates.length === 0) return null;
    for (const candidate of candidates) {
      if (candidate.kind === 'page_text' && candidate.textSource !== null && PROTECTED_TEXT_SOURCES.has(candidate.textSource)) {
        await skipQueuedWorkerJob(deps.db, candidate.id, 'text_source', now);
        continue;
      }
      if (!(await claimWorkerJob(deps.db, candidate.id, body.worker, now, WORKER_PROTOCOL.leaseMs))) continue;
      const job = await getWorkerJob(deps.db, candidate.id);
      const view = job ? leasedView(deps, job, now) : null;
      if (!job || !view) {
        await finishLeasedWorkerJob(deps.db, candidate.id, body.worker, { status: 'failed', error: 'bad_job' }, now);
        runtime.notifyJob(candidate.id);
        continue;
      }
      await touchWorker(deps.db, body.worker, body.version, now);
      runtime.presence.invalidate();
      runtime.notifyJob(job.id);
      return view;
    }
  }
  return null;
}

export function createWorkerRouter(deps: AppDeps): Router {
  const router = Router();
  const tokenSha256 = deps.config.worker.tokenSha256;

  // Without a configured token the whole worker API does not exist.
  if (tokenSha256 === null) {
    router.use((req, res) => sendError(req, res, 404, 'not_found', ERROR_MESSAGES_FR.not_found));
    return router;
  }
  const runtime = getWorkerRuntime(deps);
  const root = uploadsDir(deps.config);

  // ---- parent action (session cookie): manual relaunch of the page transcriptions (§17.5)
  router.post('/transcriptions', requireXRequestedWith(), requireAuth(deps), requireParentUnlock(deps), async (req, res) => {
    const parentId = parentIdOf(req);
    const body = parseOrThrow(TranscriptionsRequestSchema, req.body);
    if (!(await getDocument(deps.db, parentId, body.documentId))) throw appError(404, 'not_found');
    const response: TranscriptionsResponse = { queued: await enqueueDocumentTranscriptions(deps, parentId, body.documentId, body.pageIndexes) };
    res.set('Cache-Control', 'no-store').json(response);
  });

  // ---- worker (bearer token)
  // Before the token check: bounds anonymous traffic (needs TRUST_PROXY behind a reverse proxy, otherwise one shared bucket).
  router.use(rateLimiter(deps, { windowMs: 60_000, limit: ANONYMOUS_RATE_LIMIT_PER_MINUTE, key: (req) => `worker-anon:${ipKey(req)}` }));
  router.use(bearerAuth(deps, tokenSha256));
  // After the token check: per worker, so wrong-token traffic can never spend the real worker's budget.
  router.use(rateLimiter(deps, { windowMs: 60_000, limit: RATE_LIMIT_PER_MINUTE, key: (req) => `worker:${workerKey(req)}` }));

  router.post('/lease', async (req, res) => {
    const body = parseOrThrow(LeaseRequestSchema, req.body);
    const gone = new AbortController();
    res.on('close', () => gone.abort());
    const startedAt = performance.now();

    // A new lease call means the worker is idle: one job per worker.
    const now = deps.now();
    await releaseWorkerLeases(deps.db, body.worker, now);
    await touchWorker(deps.db, body.worker, body.version, now);
    runtime.presence.invalidate();

    let job: LeasedWorkerJob | null = null;
    let lastReclaim = -Infinity;
    for (;;) {
      if (performance.now() - lastReclaim >= RECLAIM_EVERY_MS) {
        lastReclaim = performance.now();
        const reclaimed = await reclaimWorkerJobs(deps.db, deps.now(), WORKER_PROTOCOL.maxAttempts);
        if (reclaimed.failed + reclaimed.expired > 0) deps.logger.info('worker_jobs_reclaimed', { ...reclaimed });
      }
      job = await leaseOnce(deps, runtime, body);
      if (job || gone.signal.aborted || runtime.closing) break;
      const remaining = body.waitMs - (performance.now() - startedAt);
      if (remaining <= 0) break;
      await sleep(Math.min(WORKER_PROTOCOL.leaseCheckIntervalMs, remaining), [gone.signal, runtime.closeSignal]);
      if (gone.signal.aborted) break;
    }
    if (gone.signal.aborted) {
      // Nobody receives the job: give it back at once.
      if (job) await releaseWorkerLeases(deps.db, body.worker, deps.now());
      return;
    }
    if (job) deps.logger.info('worker_job_leased', { jobId: job.id, kind: job.kind, operation: job.operation, worker: body.worker });
    const response: LeaseResponse = { job };
    res.set('Cache-Control', 'no-store').json(response);
  });

  router.post('/heartbeat', async (req, res) => {
    const body = parseOrThrow(HeartbeatRequestSchema, req.body);
    const now = deps.now();
    // Fresh limit information: `rejected` pauses the worker until its reset, anything else lifts the pause; no information keeps it.
    const limitedUntil = body.limits === null
      ? undefined
      : body.limits.status === 'rejected'
        ? (body.limits.resetsAt ?? now + WORKER_PROTOCOL.defaultLimitPauseMs)
        : null;
    await recordHeartbeat(deps.db, body.worker, { version: body.version, currentJobId: body.currentJobId, limits: body.limits }, limitedUntil, now);
    if (body.currentJobId !== null && IdSchema.safeParse(body.currentJobId).success) {
      await renewWorkerLease(deps.db, body.currentJobId, body.worker, now, WORKER_PROTOCOL.leaseMs);
    }
    runtime.presence.invalidate();
    const response: HeartbeatResponse = { ok: true, serverTime: now };
    res.set('Cache-Control', 'no-store').json(response);
  });

  router.post('/jobs/:id/result', async (req, res) => {
    const id = parseOrThrow(IdSchema, req.params.id);
    const body = parseOrThrow(ResultRequestSchema, req.body);
    const now = deps.now();
    const job = await getWorkerJob(deps.db, id);
    if (!job || job.status !== 'leased' || job.leasedBy !== body.worker) conflict();
    if (job.expiresAt < now) {
      if (await expirePendingWorkerJob(deps.db, id, now)) runtime.notifyJob(id);
      conflict();
    }
    await touchWorker(deps.db, body.worker, 'unknown', now);
    runtime.presence.invalidate();
    const log = { jobId: id, kind: job.kind, operation: job.operation, worker: body.worker };

    let applied = false;
    try {
      if (body.outcome === 'done') {
        if (job.kind === 'page_text') {
          const outcome = await applyPageTranscription(deps, job, body.worker, { json: body.json, refusal: body.refusal, truncated: body.truncated });
          applied = outcome.applied;
        } else {
          const stored = {
            json: body.json ?? null, refusal: body.refusal, truncated: body.truncated, model: body.model,
            inputTokens: body.inputTokens, outputTokens: body.outputTokens,
          };
          if (!(await finishLeasedWorkerJob(deps.db, id, body.worker, { status: 'done', result: stored }, now))) conflict();
          applied = true;
        }
        deps.logger.info('worker_job_done', { ...log, durationMs: body.durationMs, applied });
      } else {
        let ok: boolean;
        switch (body.error) {
          case 'usage_limit':
            ok = await requeueLeasedWorkerJob(deps.db, id, body.worker, now, { refundAttempt: true });
            await setWorkerLimitedUntil(deps.db, body.worker, now + (body.retryAfterMs ?? WORKER_PROTOCOL.defaultLimitPauseMs), now);
            break;
          case 'timeout':
          case 'cli_failed':
          case 'invalid_output':
            ok = job.attempts < WORKER_PROTOCOL.maxAttempts
              ? await requeueLeasedWorkerJob(deps.db, id, body.worker, now, { refundAttempt: false })
              : await finishLeasedWorkerJob(deps.db, id, body.worker, { status: 'failed', error: body.error }, now);
            break;
          default:
            ok = await finishLeasedWorkerJob(deps.db, id, body.worker, { status: 'failed', error: body.error }, now);
        }
        if (!ok) conflict();
        deps.logger.warn('worker_job_error', { ...log, error: body.error, attempts: job.attempts, message: body.message.slice(0, WORKER_PROTOCOL.messageMaxChars) });
      }
    } catch (err) {
      if (err instanceof JobNotLeasedError) conflict();
      throw err;
    } finally {
      runtime.notifyJob(id);
      runtime.presence.invalidate();
    }
    const response: ResultResponse = { ok: true, applied };
    res.set('Cache-Control', 'no-store').json(response);
  });

  router.get('/jobs/:id/image', async (req, res) => {
    const id = parseOrThrow(IdSchema, req.params.id);
    const worker = parseOrThrow(WorkerNameSchema, req.query.worker);
    const job = await getWorkerJob(deps.db, id);
    if (!job || job.kind !== 'page_text' || job.status !== 'leased' || job.leasedBy !== worker) throw appError(404, 'not_found');
    if (job.documentId === null || job.pageIndex === null) throw appError(404, 'not_found');
    const stored = await findStoredFile(deps.db, 'page_image', job.parentId, job.documentId, job.pageIndex);
    // A replaced image is not the one this job is about (its own job reads the new one).
    if (!stored || stored.sha256 !== job.imageSha256) throw appError(404, 'not_found');
    const absolute = resolveStoragePath(root, stored.storagePath);
    const size = await fileSize(absolute);
    if (size === null) throw appError(404, 'not_found');

    res.status(200);
    res.setHeader('Content-Type', stored.mime);
    res.setHeader('Content-Length', String(size));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');
    try {
      await pipeline(createReadStream(absolute), res);
    } catch {
      res.destroy();
    }
  });

  return router;
}
