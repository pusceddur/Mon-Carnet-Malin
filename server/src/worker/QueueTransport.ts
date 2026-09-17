// AI transport `worker` (§17.4): each request becomes an `ai` job in worker_jobs, executed by the external worker.
// The waiting side reads the database (several server processes may exist); a same-process event only shortens the wait.
import { newId } from '@aide/shared';
import type { Knex } from 'knex';
import { AITransportError, type AITier, type AITransport, type AITransportRequest, type AITransportResponse } from '../ai/plugin';
import { deleteWorkerJob, expirePendingWorkerJob, getWorkerJobOutcome, insertWorkerJob } from '../db/repositories/workerJobs';
import type { Logger } from '../logger';
import type { WorkerJobRequest } from './protocol';
import { WORKER_PROTOCOL } from './protocol';
import type { WorkerRuntime } from './runtime';

export const AI_JOB_PRIORITY = 10;
export const DEFAULT_QUEUE_POLL_MS = 500;

export interface QueueTransportOptions {
  db: Knex;
  now(): number;
  logger: Logger;
  runtime: WorkerRuntime;
  /** Worker token configured on the server. */
  configured: boolean;
  selfReferenceTerms: readonly string[];
  pollMs?: number;
}

/** Stored in result_json by POST /api/worker/jobs/:id/result for `ai` jobs. */
export interface StoredAIResult {
  json: unknown;
  refusal: boolean;
  truncated: boolean;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
}

type StopReason = 'deadline' | 'aborted' | 'closing' | 'no_worker' | 'limited';

function base64Bytes(base64: string): number {
  return Math.floor((base64.length * 3) / 4);
}

function errorFor(code: string | null): AITransportError {
  switch (code) {
    case 'usage_limit': return new AITransportError('rate_limited', 'worker usage limit');
    case 'auth': return new AITransportError('auth', 'worker authentication failed');
    case 'timeout': return new AITransportError('timeout', 'worker timeout');
    default: return new AITransportError('unavailable', `worker job failed: ${code ?? 'unknown'}`);
  }
}

function asStoredResult(value: unknown): StoredAIResult | null {
  if (typeof value !== 'object' || value === null) return null;
  const r = value as Partial<StoredAIResult>;
  if (typeof r.refusal !== 'boolean' || typeof r.truncated !== 'boolean') return null;
  return {
    json: r.json ?? null,
    refusal: r.refusal,
    truncated: r.truncated,
    model: typeof r.model === 'string' ? r.model : 'worker',
    inputTokens: typeof r.inputTokens === 'number' ? r.inputTokens : null,
    outputTokens: typeof r.outputTokens === 'number' ? r.outputTokens : null,
  };
}

export class QueueTransport implements AITransport {
  readonly name = 'worker';
  readonly selfReferenceTerms: readonly string[];
  private readonly pollMs: number;

  constructor(private readonly options: QueueTransportOptions) {
    this.selfReferenceTerms = options.selfReferenceTerms;
    this.pollMs = options.pollMs ?? DEFAULT_QUEUE_POLL_MS;
  }

  isConfigured(): boolean {
    return this.options.configured;
  }

  /** A worker was seen in the last 90 s and is not paused by a usage limit (cached, refreshed from the database). */
  supports(_tier: AITier): boolean {
    return this.options.configured && this.options.runtime.presence.isAvailable();
  }

  refresh(): Promise<void> {
    return this.options.configured ? this.options.runtime.presence.refresh() : Promise.resolve();
  }

  async complete(req: AITransportRequest): Promise<AITransportResponse> {
    if (!this.options.configured) throw new AITransportError('unavailable', 'worker not configured');
    if (!req.parentId) throw new AITransportError('bad_request', 'missing request owner');
    const images = req.images ?? [];
    if (images.reduce((n, image) => n + base64Bytes(image.base64), 0) > WORKER_PROTOCOL.imagesMaxBytes) {
      throw new AITransportError('bad_request', 'images too large');
    }
    if (req.signal.aborted || this.options.runtime.closing) throw new AITransportError('timeout', 'aborted');

    const request: WorkerJobRequest = {
      system: req.system,
      documentText: req.documentText,
      userText: req.userText,
      jsonSchema: req.jsonSchema,
      maxOutputTokens: req.maxOutputTokens,
      images: images.map((image) => ({ mediaType: image.mediaType, base64: image.base64 })),
    };
    const id = newId();
    const now = this.options.now();
    try {
      await insertWorkerJob(this.options.db, {
        id, parentId: req.parentId, kind: 'ai', tier: req.tier, operation: req.operation, request,
        priority: AI_JOB_PRIORITY, createdAt: now, expiresAt: now + Math.max(1, req.deadlineMs),
      });
    } catch (err) {
      this.options.logger.error('worker_job_insert_failed', { operation: req.operation, error: err });
      throw new AITransportError('unavailable', 'queue unavailable');
    }
    return this.wait(id, req);
  }

  private wait(id: string, req: AITransportRequest): Promise<AITransportResponse> {
    const { db, runtime, logger } = this.options;
    return new Promise<AITransportResponse>((resolve, reject) => {
      let settled = false;
      let stopping = false;
      let checking = false;
      let recheck = false;

      const cleanup = (): void => {
        clearTimeout(deadlineTimer);
        clearInterval(pollTimer);
        unsubscribe();
        req.signal.removeEventListener('abort', onAbort);
        runtime.closeSignal.removeEventListener('abort', onClose);
      };
      const succeed = (response: AITransportResponse): void => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(response);
      };
      const fail = (err: AITransportError): void => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(err);
      };

      /** Final state read from the database: true when the promise was settled. */
      const settleFrom = async (outcome: Awaited<ReturnType<typeof getWorkerJobOutcome>>): Promise<boolean> => {
        if (!outcome) {
          fail(new AITransportError('unavailable', 'worker job vanished'));
          return true;
        }
        switch (outcome.status) {
          case 'done': {
            const stored = asStoredResult(outcome.result);
            if (!stored) fail(new AITransportError('unavailable', 'worker result unreadable'));
            else succeed({ ...stored, costMicros: null });
            // The answer now lives in the router (validation, cache): the row is not needed any more.
            await deleteWorkerJob(db, id).catch((err: unknown) => logger.warn('worker_job_delete_failed', { error: err }));
            return true;
          }
          case 'failed':
            fail(errorFor(outcome.error));
            return true;
          case 'expired':
            fail(new AITransportError('timeout', 'worker job expired'));
            return true;
          case 'skipped':
            fail(new AITransportError('unavailable', 'worker job skipped'));
            return true;
          default:
            return false;
        }
      };

      const check = async (): Promise<void> => {
        if (settled || stopping) return;
        if (checking) {
          recheck = true;
          return;
        }
        checking = true;
        try {
          const outcome = await getWorkerJobOutcome(db, id);
          if (settled || stopping) return;
          if (await settleFrom(outcome)) return;
          if (outcome?.status === 'queued') {
            // Nobody will take it: give up early instead of waiting for the deadline (worker gone or paused by a limit).
            await runtime.presence.refresh();
            const presence = runtime.presence.snapshot();
            if (!presence.available && !settled && !stopping) void stop(presence.limited ? 'limited' : 'no_worker');
          }
        } catch (err) {
          logger.warn('worker_job_poll_failed', { error: err });
        } finally {
          checking = false;
          if (recheck && !settled && !stopping) {
            recheck = false;
            void check();
          }
        }
      };

      const stop = async (reason: StopReason): Promise<void> => {
        if (settled || stopping) return;
        stopping = true;
        try {
          if (await expirePendingWorkerJob(db, id, this.options.now())) {
            runtime.notifyJob(id);
            fail(reason === 'limited'
              ? new AITransportError('rate_limited', 'worker usage limit')
              : reason === 'no_worker' || reason === 'closing'
                ? new AITransportError('unavailable', `worker ${reason}`)
                : new AITransportError('timeout', `worker ${reason}`));
            return;
          }
          // The job reached a final state in the meantime: a response that already arrived is still used.
          if (!(await settleFrom(await getWorkerJobOutcome(db, id)))) fail(new AITransportError('timeout', `worker ${reason}`));
        } catch (err) {
          logger.warn('worker_job_expire_failed', { error: err });
          fail(new AITransportError('timeout', `worker ${reason}`));
        }
      };

      const onAbort = (): void => void stop('aborted');
      const onClose = (): void => void stop('closing');
      const deadlineTimer = setTimeout(() => void stop('deadline'), Math.max(1, req.deadlineMs));
      const pollTimer = setInterval(() => void check(), this.pollMs);
      const unsubscribe = runtime.onJob(id, () => void check());
      req.signal.addEventListener('abort', onAbort, { once: true });
      runtime.closeSignal.addEventListener('abort', onClose, { once: true });
      if (req.signal.aborted) onAbort();
      else if (runtime.closing) onClose();
      else void check();
    });
  }
}
