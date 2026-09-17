// HTTP protocol between the server and the external worker (§17.3). The private worker keeps a copy of these types.
import { z } from 'zod';

export type WorkerJobKind = 'ai' | 'page_text';               // 'page_audio' reserved
export type WorkerJobStatus = 'queued' | 'leased' | 'done' | 'failed' | 'expired' | 'skipped';
export type WorkerTier = 'light' | 'complex';

export interface WorkerImage { mediaType: 'image/png' | 'image/jpeg'; base64: string }

/** Stored in `worker_jobs.request_json` (emptied once the job is final). */
export interface WorkerJobRequest {
  system: string;
  documentText: string | null;
  userText: string;
  jsonSchema: Record<string, unknown>;
  maxOutputTokens: number;
  /** ai (handwriting): inline, ≤ 2 MB in total. */
  images: WorkerImage[];
}

export interface LeasedWorkerJob extends WorkerJobRequest {
  id: string;
  kind: WorkerJobKind;
  tier: WorkerTier;
  operation: string;
  /** page_text: '/api/worker/jobs/<id>/image'. */
  imageUrl: string | null;
  /** Maximum execution time on the worker. */
  deadlineMs: number;
  leaseMs: number;
}

export interface WorkerLimits {
  status: 'allowed' | 'allowed_warning' | 'rejected';
  rateLimitType: string | null;
  utilization: number | null;
  /** Epoch ms. */
  resetsAt: number | null;
}

// POST /api/worker/lease
export interface LeaseRequest { worker: string; version: string; kinds: WorkerJobKind[]; waitMs: number }
export interface LeaseResponse { job: LeasedWorkerJob | null }
// POST /api/worker/heartbeat
export interface HeartbeatRequest { worker: string; version: string; currentJobId: string | null; limits: WorkerLimits | null }
export interface HeartbeatResponse { ok: true; serverTime: number }
// POST /api/worker/jobs/:id/result
export type WorkerErrorCode = 'usage_limit' | 'auth' | 'timeout' | 'invalid_output' | 'cli_failed' | 'image_unavailable' | 'bad_job';
export type ResultRequest =
  | {
    worker: string; outcome: 'done'; json: unknown; refusal: boolean; truncated: boolean; model: string;
    inputTokens: number | null; outputTokens: number | null; durationMs: number;
  }
  | { worker: string; outcome: 'error'; error: WorkerErrorCode; retryAfterMs: number | null; message: string };
export interface ResultResponse { ok: true; applied: boolean }
// GET /api/worker/jobs/:id/image?worker=<name> → page image bytes (Content-Type of the stored file)

// POST /api/worker/transcriptions (parent session, unlocked)
export interface TranscriptionsRequest { documentId: string; pageIndexes?: number[] }
export interface TranscriptionsResponse { queued: number }

/** Protocol constants (§17.3). */
export const WORKER_PROTOCOL = {
  leaseMs: 120_000,
  maxWaitMs: 25_000,
  leaseCheckIntervalMs: 1_000,
  pageTextDeadlineMs: 180_000,
  maxAttempts: 3,
  /** A worker is "connected" when seen within this window. */
  presenceWindowMs: 90_000,
  /** usage_limit without retryAfterMs. */
  defaultLimitPauseMs: 15 * 60_000,
  imagesMaxBytes: 2 * 1024 * 1024,
  messageMaxChars: 300,
} as const;

export const WORKER_JOB_KINDS = ['ai', 'page_text'] as const satisfies readonly WorkerJobKind[];
export const WORKER_ERROR_CODES = [
  'usage_limit', 'auth', 'timeout', 'invalid_output', 'cli_failed', 'image_unavailable', 'bad_job',
] as const satisfies readonly WorkerErrorCode[];

export const WorkerNameSchema = z.string().regex(/^[A-Za-z0-9._-]{1,64}$/);
const VersionSchema = z.string().min(1).max(40);
const TokensSchema = z.number().int().nonnegative().max(100_000_000).nullable();

export const WorkerImageSchema = z.object({
  mediaType: z.enum(['image/png', 'image/jpeg']),
  base64: z.string(),
});

export const WorkerJobRequestSchema = z.object({
  system: z.string(),
  documentText: z.string().nullable(),
  userText: z.string(),
  jsonSchema: z.record(z.string(), z.unknown()),
  maxOutputTokens: z.number().int().positive(),
  images: z.array(WorkerImageSchema),
});

export const WorkerLimitsSchema = z.object({
  status: z.enum(['allowed', 'allowed_warning', 'rejected']),
  rateLimitType: z.string().max(40).nullable(),
  utilization: z.number().min(0).max(100).nullable(),
  resetsAt: z.number().int().nonnegative().nullable(),
});

export const LeaseRequestSchema = z.object({
  worker: WorkerNameSchema,
  version: VersionSchema,
  kinds: z.array(z.enum(WORKER_JOB_KINDS)).min(1).max(WORKER_JOB_KINDS.length),
  waitMs: z.number().int().min(0).max(WORKER_PROTOCOL.maxWaitMs),
});

export const HeartbeatRequestSchema = z.object({
  worker: WorkerNameSchema,
  version: VersionSchema,
  currentJobId: z.string().min(1).max(36).nullable(),
  limits: WorkerLimitsSchema.nullable(),
});

export const ResultRequestSchema = z.discriminatedUnion('outcome', [
  z.object({
    worker: WorkerNameSchema,
    outcome: z.literal('done'),
    json: z.unknown(),
    refusal: z.boolean(),
    truncated: z.boolean(),
    model: z.string().max(100),
    inputTokens: TokensSchema,
    outputTokens: TokensSchema,
    durationMs: z.number().int().nonnegative(),
  }),
  z.object({
    worker: WorkerNameSchema,
    outcome: z.literal('error'),
    error: z.enum(WORKER_ERROR_CODES),
    retryAfterMs: z.number().int().nonnegative().max(8 * 24 * 60 * 60_000).nullable(),
    message: z.string().max(WORKER_PROTOCOL.messageMaxChars),
  }),
]);
