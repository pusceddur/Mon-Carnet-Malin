// ai_jobs: asynchronous AI requests (§15.4: complex route; §17.4: every route with the worker provider), kept 1 h.
import type { AIOperation } from '@aide/shared';
import { type Db, type Row, parseJson, toNum, toStr, toStrOrNull } from './common';

export type AIJobStatus = 'pending' | 'done' | 'error';

export interface AIJob {
  id: string;
  parentId: string;
  childId: string | null;
  operation: AIOperation;
  status: AIJobStatus;
  result: unknown;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
  /** End-to-end deadline of the pending request (stale check); null/absent = the router default. */
  deadlineMs?: number | null;
}

export interface AIJobsRepository {
  create(job: Omit<AIJob, 'updatedAt'>): Promise<void>;
  complete(id: string, status: Exclude<AIJobStatus, 'pending'>, result: unknown, now: number): Promise<void>;
  get(parentId: string, id: string, now: number): Promise<AIJob | null>;
}

/** While a job is pending, result_json only holds `{ deadlineMs }` (replaced by the result on completion). */
interface PendingMarker { deadlineMs: number }

function pendingDeadline(value: unknown): number | null {
  const deadline = typeof value === 'object' && value !== null ? (value as Partial<PendingMarker>).deadlineMs : undefined;
  return typeof deadline === 'number' && Number.isFinite(deadline) ? deadline : null;
}

function fromRow(row: Row): AIJob {
  const status = toStr(row.status);
  const stored = parseJson<unknown>(row.result_json, null);
  const pending = status !== 'done' && status !== 'error';
  return {
    id: toStr(row.id),
    parentId: toStr(row.parent_id),
    childId: toStrOrNull(row.child_id),
    operation: toStr(row.operation) as AIOperation,
    status: pending ? 'pending' : (status as AIJobStatus),
    result: pending ? null : stored,
    createdAt: toNum(row.created_at),
    updatedAt: toNum(row.updated_at),
    expiresAt: toNum(row.expires_at),
    deadlineMs: pending ? pendingDeadline(stored) : null,
  };
}

function initialResultJson(job: Omit<AIJob, 'updatedAt'>): string | null {
  if (job.status === 'pending') {
    return typeof job.deadlineMs === 'number' ? JSON.stringify({ deadlineMs: job.deadlineMs } satisfies PendingMarker) : null;
  }
  return job.result === null || job.result === undefined ? null : JSON.stringify(job.result);
}

export function createAIJobsRepository(db: Db): AIJobsRepository {
  return {
    async create(job) {
      await db('ai_jobs').insert({
        id: job.id,
        parent_id: job.parentId,
        child_id: job.childId,
        operation: job.operation,
        status: job.status,
        result_json: initialResultJson(job),
        created_at: job.createdAt,
        updated_at: job.createdAt,
        expires_at: job.expiresAt,
      });
    },
    async complete(id, status, result, now) {
      await db('ai_jobs').where('id', id).update({ status, result_json: JSON.stringify(result), updated_at: now });
    },
    async get(parentId, id, now) {
      const row = (await db('ai_jobs').where({ id, parent_id: parentId }).first()) as Row | undefined;
      if (!row) return null;
      const job = fromRow(row);
      return job.expiresAt <= now ? null : job;
    },
  };
}

export function createMemoryAIJobsRepository(): AIJobsRepository & { jobs: Map<string, AIJob> } {
  const jobs = new Map<string, AIJob>();
  return {
    jobs,
    create(job) {
      jobs.set(job.id, { ...job, updatedAt: job.createdAt });
      return Promise.resolve();
    },
    complete(id, status, result, now) {
      const job = jobs.get(id);
      if (job) jobs.set(id, { ...job, status, result, updatedAt: now });
      return Promise.resolve();
    },
    get(parentId, id, now) {
      const job = jobs.get(id);
      return Promise.resolve(job && job.parentId === parentId && job.expiresAt > now ? structuredClone(job) : null);
    },
  };
}
