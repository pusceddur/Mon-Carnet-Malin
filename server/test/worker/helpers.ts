import { createHash } from 'node:crypto';
import { type DocumentMeta, newId, type PageContent } from '@aide/shared';
import request from 'supertest';
import { insertWorkerJob, type NewWorkerJob } from '../../src/db/repositories/workerJobs';
import type { LeaseResponse, WorkerJobKind } from '../../src/worker/protocol';
import { type Agent, createTestContext, makeDocument, makePage, newParent, sync, type TestContext, XRW } from '../platform/helpers';

/** Fixed test value, not a secret. */
export const WORKER_TOKEN = 'test-worker-token-for-unit-tests-only-0123456789';
export const WORKER_TOKEN_SHA256 = createHash('sha256').update(WORKER_TOKEN).digest('hex');
export const WORKER = 'home-pc';
export const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(4096, 1), Buffer.from([0xff, 0xd9])]);
export const JPEG_2 = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(4096, 2), Buffer.from([0xff, 0xd9])]);

export function workerEnv(extra: Record<string, string> = {}): Record<string, string> {
  return { WORKER_TOKEN_SHA256, ...extra };
}

export async function createWorkerContext(env: Record<string, string> = {}): Promise<TestContext> {
  return createTestContext({ env: workerEnv(env) });
}

export function bearer(token = WORKER_TOKEN): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

export async function lease(ctx: TestContext, opts: { worker?: string; kinds?: WorkerJobKind[]; waitMs?: number } = {}): Promise<LeaseResponse['job']> {
  const res = await request(ctx.app)
    .post('/api/worker/lease')
    .set(bearer())
    .send({ worker: opts.worker ?? WORKER, version: '1.0.0', kinds: opts.kinds ?? ['ai', 'page_text'], waitMs: opts.waitMs ?? 0 });
  if (res.status !== 200) throw new Error(`lease failed: ${res.status} ${JSON.stringify(res.body)}`);
  return (res.body as LeaseResponse).job;
}

export function heartbeat(ctx: TestContext, body: Partial<{ worker: string; currentJobId: string | null; limits: unknown }> = {}) {
  return request(ctx.app)
    .post('/api/worker/heartbeat')
    .set(bearer())
    .send({ worker: WORKER, version: '1.0.0', currentJobId: null, limits: null, ...body });
}

export function postResult(ctx: TestContext, jobId: string, body: Record<string, unknown>) {
  return request(ctx.app).post(`/api/worker/jobs/${jobId}/result`).set(bearer()).send({ worker: WORKER, ...body });
}

export function doneBody(json: unknown, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { outcome: 'done', json, refusal: false, truncated: false, model: 'model-test', inputTokens: 10, outputTokens: 20, durationMs: 1200, ...extra };
}

export function errorBody(error: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { outcome: 'error', error, retryAfterMs: null, message: 'échec simulé', ...extra };
}

export async function queueAiJob(ctx: TestContext, parentId: string, overrides: Partial<NewWorkerJob> = {}): Promise<string> {
  const id = overrides.id ?? newId();
  await insertWorkerJob(ctx.db, {
    id,
    parentId,
    kind: 'ai',
    tier: 'light',
    operation: 'explain_word',
    request: { system: 'Consigne', documentText: '<texte_du_document>Le chat dort.</texte_du_document>', userText: 'Explique', jsonSchema: { type: 'object' }, maxOutputTokens: 700, images: [] },
    priority: 10,
    createdAt: ctx.clock.now,
    expiresAt: ctx.clock.now + 90_000,
    ...overrides,
  });
  return id;
}

export async function jobRow(ctx: TestContext, id: string): Promise<Record<string, unknown> | undefined> {
  return ctx.db('worker_jobs').where('id', id).first();
}

export interface PageFixture {
  parentId: string;
  agent: Agent;
  documentId: string;
}

/** A parent with a synced document (pages pushed through /api/sync when given). */
export async function parentWithDocument(
  ctx: TestContext, email: string, pages: Partial<PageContent>[] = [], docOverrides: Partial<DocumentMeta> = {},
): Promise<PageFixture> {
  const { parent, agent } = await newParent(ctx, email);
  const doc = makeDocument(parent.id, { kind: 'images', pageCount: Math.max(1, pages.length), ...docOverrides });
  const res = await sync(agent, { changes: { documents: [doc], pages: pages.map((p) => makePage(doc.id, p)) } });
  if (res.rejected.length > 0) throw new Error(`sync rejected ${JSON.stringify(res.rejected)}`);
  return { parentId: parent.id, agent, documentId: doc.id };
}

export function uploadPageImage(agent: Agent, documentId: string, pageIndex: number, content: Buffer = JPEG) {
  return agent.put(`/api/documents/${documentId}/pages/${pageIndex}/image`).set(XRW).attach('image', content, 'page.jpg');
}
