import { newId, type AIJobAccepted } from '@aide/shared';
import type { Express } from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { AITransportError, type AITransportRequest } from '../../src/ai/plugin';
import { createQueueTransport } from '../../src/ai/services';
import { createApp } from '../../src/app';
import { setWorkerLimitedUntil } from '../../src/db/repositories/workerJobs';
import { silentLogger } from '../../src/logger';
import type { AppDeps } from '../../src/types';
import { QueueTransport } from '../../src/worker/QueueTransport';
import { getWorkerRuntime, presenceOf, WorkerRuntime } from '../../src/worker/runtime';
import { createHarness, explainTextBody, PARENT_ID, SCIENCE_TEXT } from '../ai/helpers';
import { createTestContext, newChild, newParent, type TestContext, XRW } from '../platform/helpers';
import { bearer, createWorkerContext, doneBody, errorBody, heartbeat, jobRow, WORKER, WORKER_TOKEN_SHA256 } from './helpers';

let ctx: TestContext | null = null;

afterEach(async () => {
  await ctx?.close();
  ctx = null;
});

const GOOD_EXPLANATION = {
  status: 'ok', explanation: 'Les abeilles portent le pollen. Le pollen féconde l’ovule. L’ovule devient une graine.', example: null,
  sourceQuotes: ["Le pollen féconde l'ovule, qui devient une graine."],
};

interface Harness {
  ctx: TestContext;
  deps: AppDeps;
  app: Express;
  transport: QueueTransport;
  parentId: string;
}

/** One AppDeps shared by the app (worker routes) and the transport: same runtime, as in production. */
async function setup(env: Record<string, string> = {}): Promise<Harness> {
  ctx = await createWorkerContext(env);
  const c = ctx;
  const deps: AppDeps = { config: c.config, db: c.db, logger: silentLogger, now: () => c.clock.now, disableRateLimits: true };
  const app = createApp(deps);
  const { parent } = await newParent(c, `file-${newId().slice(0, 8)}@example.fr`);
  return { ctx: c, deps, app, transport: createQueueTransport(deps), parentId: parent.id };
}

function transportRequest(parentId: string | undefined, overrides: Partial<AITransportRequest> = {}): AITransportRequest {
  return {
    tier: 'light', operation: 'explain_text', system: 'Consigne', documentText: '<texte_du_document>Le chat dort.</texte_du_document>',
    userText: 'Explique ce passage.', jsonSchema: { type: 'object' }, maxOutputTokens: 1000, signal: new AbortController().signal, deadlineMs: 5_000,
    ...(parentId !== undefined ? { parentId } : {}),
    ...overrides,
  };
}

async function workerLease(app: Express, worker = WORKER): Promise<{ id: string; kind: string; operation: string; documentText: string | null; userText: string } | null> {
  const res = await request(app).post('/api/worker/lease').set(bearer()).send({ worker, version: '1.0.0', kinds: ['ai'], waitMs: 3_000 });
  return res.body.job;
}

async function waitFor<T>(read: () => Promise<T>, done: (v: T) => boolean, timeoutMs = 3_000): Promise<T> {
  const started = Date.now();
  for (;;) {
    const value = await read();
    if (done(value) || Date.now() - started > timeoutMs) return value;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe('QueueTransport (§17.4)', () => {
  it('is configured with a token and available only while a worker is connected and not limited', async () => {
    const h = await setup();
    expect(h.transport.name).toBe('worker');
    expect(h.transport.isConfigured()).toBe(true);
    await h.transport.refresh();
    expect(h.transport.supports('light')).toBe(false);

    await heartbeat(h.ctx);
    const runtime = getWorkerRuntime(h.deps);
    runtime.presence.invalidate();
    await h.transport.refresh();
    expect(h.transport.supports('light')).toBe(true);
    expect(h.transport.supports('complex')).toBe(true);

    h.ctx.advance(90_001);
    expect(h.transport.supports('light')).toBe(false);
    await heartbeat(h.ctx);
    await setWorkerLimitedUntil(h.ctx.db, WORKER, h.ctx.clock.now + 60_000, h.ctx.clock.now);
    runtime.presence.invalidate();
    await h.transport.refresh();
    expect(h.transport.supports('light')).toBe(false);

    const unconfigured = new QueueTransport({
      db: h.ctx.db, now: () => h.ctx.clock.now, logger: silentLogger, runtime, configured: false, selfReferenceTerms: [],
    });
    expect(unconfigured.isConfigured()).toBe(false);
    expect(unconfigured.supports('light')).toBe(false);
    await expect(unconfigured.complete(transportRequest(h.parentId))).rejects.toMatchObject({ kind: 'unavailable' });
  });

  it('presence: connected within 90 s, limited only when every recent worker is paused', () => {
    const now = 1_000_000;
    expect(presenceOf([], now)).toEqual({ available: false, connected: false, lastSeenAt: null, limited: false, limitResetsAt: null });
    const a = { workerName: 'a', lastSeenAt: now - 10_000, limitedUntil: now + 5_000, info: null };
    const b = { workerName: 'b', lastSeenAt: now - 20_000, limitedUntil: null, info: null };
    expect(presenceOf([a], now)).toMatchObject({ available: false, connected: true, limited: true, limitResetsAt: now + 5_000 });
    expect(presenceOf([a, b], now)).toMatchObject({ available: true, connected: true, limited: false, lastSeenAt: now - 10_000 });
    expect(presenceOf([{ ...b, lastSeenAt: now - 90_001 }], now)).toMatchObject({ available: false, connected: false, limited: false });
  });

  it('happy path: queues an ai job, the worker answers, the result comes back and the row is deleted', async () => {
    const h = await setup();
    await heartbeat(h.ctx);
    const pending = h.transport.complete(transportRequest(h.parentId, { deadlineMs: 5_000 }));
    const job = await workerLease(h.app);
    expect(job).toMatchObject({ kind: 'ai', operation: 'explain_text', userText: 'Explique ce passage.' });
    const row = await jobRow(h.ctx, job!.id);
    expect(row).toMatchObject({ parent_id: h.parentId, priority: 10, tier: 'light', expires_at: h.ctx.clock.now + 5_000 });

    const startedAt = Date.now();
    const posted = await request(h.app).post(`/api/worker/jobs/${job!.id}/result`).set(bearer())
      .send({ worker: WORKER, ...doneBody({ status: 'ok', explanation: 'Réponse' }, { model: 'model-x', inputTokens: 5, outputTokens: 7 }) });
    expect(posted.status).toBe(200);
    const response = await pending;
    expect(Date.now() - startedAt).toBeLessThan(400); // same-process notification, no need to wait for the next poll
    expect(response).toEqual({
      json: { status: 'ok', explanation: 'Réponse' }, refusal: false, truncated: false, model: 'model-x', inputTokens: 5, outputTokens: 7, costMicros: null,
    });
    expect(await waitFor(() => jobRow(h.ctx, job!.id), (r) => r === undefined)).toBeUndefined();
  });

  it('another process (no shared notification) still gets the result by reading the database', async () => {
    const h = await setup();
    await heartbeat(h.ctx);
    const otherProcess = new QueueTransport({
      db: h.ctx.db, now: () => h.ctx.clock.now, logger: silentLogger, runtime: new WorkerRuntime(h.ctx.db, () => h.ctx.clock.now, silentLogger),
      configured: true, selfReferenceTerms: [], pollMs: 50,
    });
    const pending = otherProcess.complete(transportRequest(h.parentId));
    const job = await workerLease(h.app);
    await request(h.app).post(`/api/worker/jobs/${job!.id}/result`).set(bearer()).send({ worker: WORKER, ...doneBody({ status: 'ok' }) });
    await expect(pending).resolves.toMatchObject({ json: { status: 'ok' }, costMicros: null });
  });

  it('deadline: the job is marked expired, the request fails with timeout and a late result is refused', async () => {
    const h = await setup();
    await heartbeat(h.ctx);
    const pending = h.transport.complete(transportRequest(h.parentId, { deadlineMs: 400 }));
    const job = await workerLease(h.app);
    await expect(pending).rejects.toMatchObject({ name: 'AITransportError', kind: 'timeout' });
    expect(await jobRow(h.ctx, job!.id)).toMatchObject({ status: 'expired', request_json: '{}' });
    const late = await request(h.app).post(`/api/worker/jobs/${job!.id}/result`).set(bearer()).send({ worker: WORKER, ...doneBody({}) });
    expect(late.status).toBe(409);
  });

  it('abort: the waiting stops at once and the queued job expires', async () => {
    const h = await setup();
    await heartbeat(h.ctx);
    const controller = new AbortController();
    const pending = h.transport.complete(transportRequest(h.parentId, { signal: controller.signal, deadlineMs: 10_000 }));
    const row = await waitFor(() => h.ctx.db('worker_jobs').first(), (r) => r !== undefined);
    const startedAt = Date.now();
    controller.abort();
    await expect(pending).rejects.toBeInstanceOf(AITransportError);
    expect(Date.now() - startedAt).toBeLessThan(500);
    expect(await jobRow(h.ctx, row.id)).toMatchObject({ status: 'expired' });
    await expect(h.transport.complete(transportRequest(h.parentId, { signal: controller.signal }))).rejects.toMatchObject({ kind: 'timeout' });
  });

  it('maps failed jobs to transport errors', async () => {
    const h = await setup();
    await heartbeat(h.ctx);
    for (const [error, kind] of [['usage_limit', 'rate_limited'], ['auth', 'auth'], ['timeout', 'timeout'], ['cli_failed', 'unavailable'], ['lease_expired', 'unavailable']] as const) {
      const pending = h.transport.complete(transportRequest(h.parentId));
      const row = await waitFor(() => h.ctx.db('worker_jobs').where('status', 'queued').first(), (r) => r !== undefined);
      await h.ctx.db('worker_jobs').where('id', row.id).update({ status: 'failed', error, request_json: '{}' });
      getWorkerRuntime(h.deps).notifyJob(row.id);
      await expect(pending).rejects.toMatchObject({ kind });
    }
  });

  it('gives up early when nobody can take the job (worker paused by a limit), and refuses bad requests', async () => {
    const h = await setup();
    await heartbeat(h.ctx);
    const runtime = getWorkerRuntime(h.deps);
    await runtime.presence.refresh(true);
    const pending = h.transport.complete(transportRequest(h.parentId, { deadlineMs: 30_000 }));
    await waitFor(() => h.ctx.db('worker_jobs').first(), (r) => r !== undefined);
    // The only worker reports a usage limit on another job.
    await setWorkerLimitedUntil(h.ctx.db, WORKER, h.ctx.clock.now + 600_000, h.ctx.clock.now);
    runtime.presence.invalidate();
    const startedAt = Date.now();
    await expect(pending).rejects.toMatchObject({ kind: 'rate_limited' });
    expect(Date.now() - startedAt).toBeLessThan(2_000);

    await expect(h.transport.complete(transportRequest(undefined))).rejects.toMatchObject({ kind: 'bad_request' });
    const huge = 'A'.repeat(3 * 1024 * 1024);
    await expect(h.transport.complete(transportRequest(h.parentId, { images: [{ mediaType: 'image/png', base64: huge }] }))).rejects.toMatchObject({ kind: 'bad_request' });
  });

  it('graceful shutdown: pending waits give up and long polls answer at once', async () => {
    const h = await setup();
    await heartbeat(h.ctx);
    const pending = h.transport.complete(transportRequest(h.parentId, { deadlineMs: 60_000 }));
    const row = await waitFor(() => h.ctx.db('worker_jobs').first(), (r) => r !== undefined);
    const poll = request(h.app).post('/api/worker/lease').set(bearer()).send({ worker: 'idle', version: '1', kinds: ['page_text'], waitMs: 20_000 });
    const pollDone = poll.then((res) => res);
    await new Promise((resolve) => setTimeout(resolve, 200));
    const startedAt = Date.now();
    getWorkerRuntime(h.deps).close();
    await expect(pending).rejects.toMatchObject({ kind: 'unavailable' });
    expect((await pollDone).body).toEqual({ job: null });
    expect(Date.now() - startedAt).toBeLessThan(1_500);
    expect(await jobRow(h.ctx, row.id)).toMatchObject({ status: 'expired' });
  });
});

describe('AIRouter with the worker provider (§17.4)', () => {
  it('every AI request becomes a job with waitMs = route deadline + 30 s', async () => {
    const h = createHarness({ asyncRoutes: 'all', deadlines: { light: 90_000, complex: 240_000 } });
    const outcome = await h.router.handle('explain_text', PARENT_ID, explainTextBody(SCIENCE_TEXT));
    expect(outcome).toMatchObject({ kind: 'job', httpStatus: 202, body: { status: 'pending', pollAfterMs: 3000, waitMs: 120_000 } });
    await h.router.idle();
    const jobId = outcome.kind === 'job' ? outcome.body.jobId : '';
    expect(await h.router.pollJob(PARENT_ID, jobId)).toMatchObject({ status: 'ok', meta: { route: 'light' } });
    // Cached answer: still a completed job.
    expect(await h.router.handle('explain_text', PARENT_ID, explainTextBody(SCIENCE_TEXT))).toMatchObject({ kind: 'job', body: { pollAfterMs: 0 } });
  });

  it('the stale check of a pending job uses the deadline of its own route', async () => {
    const h = createHarness({ asyncRoutes: 'all', deadlines: { light: 1_000, complex: 50_000 } });
    h.light.enqueue('explain_text', { json: GOOD_EXPLANATION, delayMs: 300 });
    const outcome = await h.router.handle('explain_text', PARENT_ID, explainTextBody(SCIENCE_TEXT));
    const jobId = outcome.kind === 'job' ? outcome.body.jobId : '';
    expect(outcome).toMatchObject({ body: { waitMs: 31_000 } });
    h.clock.now += 31_001;
    expect(await h.router.pollJob(PARENT_ID, jobId)).toMatchObject({ status: 'unavailable', reason: 'timeout' });
    await h.router.idle();
  });

  it('end to end: without a connected worker the request is not_configured; with it, 202 then the worker answers', async () => {
    ctx = await createTestContext({ env: { WORKER_TOKEN_SHA256, WORKER_SELF_REFERENCE_TERMS: 'Robotix, Robotix Pro' } });
    const c = ctx;
    expect(c.config.ai).toMatchObject({ providerLight: 'worker', providerComplex: 'worker' });
    const { agent } = await newParent(c, 'bout-en-bout@example.fr');
    const child = await newChild(agent, 'Zoé');
    const body = { childId: child.id, documentId: null, documentHash: null, text: SCIENCE_TEXT, paragraph: SCIENCE_TEXT, pageIndex: 0, ocrLowConfidence: false };

    expect((await agent.get('/api/health')).body.ai).toEqual({ light: false, complex: false });
    const offline = await agent.post('/api/ai/explain_text').set(XRW).send(body);
    expect(offline.status).toBe(200);
    expect(offline.body).toMatchObject({ status: 'unavailable', reason: 'not_configured' });

    expect((await heartbeat(c)).status).toBe(200);
    expect((await agent.get('/api/health')).body.ai).toEqual({ light: true, complex: true });
    const accepted = await agent.post('/api/ai/explain_text').set(XRW).send(body);
    expect(accepted.status).toBe(202);
    expect(accepted.body).toMatchObject({ status: 'pending', waitMs: 120_000 });

    const leased = await request(c.app).post('/api/worker/lease').set(bearer()).send({ worker: WORKER, version: '1', kinds: ['ai'], waitMs: 3_000 });
    const job = leased.body.job;
    expect(job).toMatchObject({ kind: 'ai', tier: 'light', operation: 'explain_text', deadlineMs: 90_000 });
    expect(job.documentText).toContain('Les abeilles transportent le pollen');
    const serialized = JSON.stringify(job);
    expect(serialized).not.toContain('Zoé');
    expect(serialized).not.toContain(child.id);

    const posted = await request(c.app).post(`/api/worker/jobs/${job.id}/result`).set(bearer()).send({ worker: WORKER, ...doneBody(GOOD_EXPLANATION) });
    expect(posted.body).toEqual({ ok: true, applied: true });
    const jobId = (accepted.body as AIJobAccepted).jobId;
    const done = await waitFor(async () => (await agent.get(`/api/ai/jobs/${jobId}`)).body, (b) => b.status !== 'pending');
    expect(done).toMatchObject({ status: 'ok', meta: { route: 'light', cached: false } });
    expect(JSON.stringify(done)).not.toMatch(/worker|model-test/);
    const logged = await c.db('ai_requests').select('provider', 'model', 'status');
    expect(logged).toContainEqual({ provider: 'worker', model: 'model-test', status: 'ok' });
    expect(await waitFor(async () => Number((await c.db('worker_jobs').count({ n: '*' }).first())?.n), (n) => n === 0)).toBe(0);

    // A worker error is reported as unavailable to the child, never as a crash.
    const second = await agent.post('/api/ai/explain_text').set(XRW).send({ ...body, text: SCIENCE_TEXT.slice(0, 120), paragraph: SCIENCE_TEXT.slice(0, 120) });
    expect(second.status).toBe(202);
    const failing = (await request(c.app).post('/api/worker/lease').set(bearer()).send({ worker: WORKER, version: '1', kinds: ['ai'], waitMs: 3_000 })).body.job;
    await request(c.app).post(`/api/worker/jobs/${failing.id}/result`).set(bearer()).send({ worker: WORKER, ...errorBody('auth') });
    const failed = await waitFor(async () => (await agent.get(`/api/ai/jobs/${second.body.jobId}`)).body, (b) => b.status !== 'pending');
    expect(failed).toMatchObject({ status: 'unavailable', reason: 'provider_error' });
  });
});
