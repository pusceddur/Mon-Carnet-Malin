import { newId } from '@aide/shared';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { claimWorkerJob, getWorkerState, insertWorkerJob, setWorkerLimitedUntil } from '../../src/db/repositories/workerJobs';
import { transcriptionRequest } from '../../src/worker/pageTranscription';
import { WORKER_PROTOCOL } from '../../src/worker/protocol';
import { createTestContext, makePage, newParent, sync, type TestContext, unlock, XRW } from '../platform/helpers';
import {
  bearer, createWorkerContext, doneBody, errorBody, heartbeat, jobRow, JPEG_2, lease, parentWithDocument, postResult, queueAiJob,
  uploadPageImage, WORKER,
} from './helpers';

let ctx: TestContext | null = null;

afterEach(async () => {
  await ctx?.close();
  ctx = null;
});

async function setup(): Promise<{ ctx: TestContext; parentId: string }> {
  ctx = await createWorkerContext();
  const { parent } = await newParent(ctx, `worker-${newId().slice(0, 8)}@example.fr`);
  return { ctx, parentId: parent.id };
}

const LEASE_BODY = { worker: WORKER, version: '1.0.0', kinds: ['ai', 'page_text'], waitMs: 0 };

describe('worker API — authentication (§17.3)', () => {
  it('does not exist without WORKER_TOKEN_SHA256', async () => {
    ctx = await createTestContext();
    const { agent } = await newParent(ctx, 'sans-poste@example.fr');
    expect((await request(ctx.app).post('/api/worker/lease').set(bearer()).send(LEASE_BODY)).status).toBe(404);
    expect((await request(ctx.app).post('/api/worker/heartbeat').send({})).status).toBe(404);
    expect((await request(ctx.app).get(`/api/worker/jobs/${newId()}/image?worker=${WORKER}`).set(bearer())).status).toBe(404);
    await unlock(agent);
    expect((await agent.post('/api/worker/transcriptions').set(XRW).send({ documentId: newId() })).status).toBe(404);
  });

  it('answers a generic 401 for a missing, malformed or wrong token', async () => {
    const { ctx: c } = await setup();
    for (const headers of [{}, { Authorization: 'Basic abc' }, bearer('wrong-token'), { Authorization: 'Bearer ' }]) {
      const res = await request(c.app).post('/api/worker/lease').set(headers).send(LEASE_BODY);
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: { code: 'not_authenticated', message: expect.any(String) } });
    }
    expect((await request(c.app).get(`/api/worker/jobs/${newId()}/image?worker=${WORKER}`)).status).toBe(401);
  });

  it('accepts the right token without cookie nor X-Requested-With, and validates bodies', async () => {
    const { ctx: c } = await setup();
    const res = await request(c.app).post('/api/worker/lease').set(bearer()).send(LEASE_BODY);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ job: null });
    expect(res.headers['cache-control']).toBe('no-store');
    const bad = await request(c.app).post('/api/worker/lease').set(bearer()).send({ ...LEASE_BODY, worker: 'bad name!', waitMs: 60_000 });
    expect(bad.status).toBe(400);
    // Other mutations still need the header.
    expect((await request(c.app).post('/api/auth/login').send({ email: 'a@b.fr', password: 'x' })).status).toBe(403);
  });

  it('the manual relaunch uses the parent session, the unlock and X-Requested-With (never the bearer token)', async () => {
    const { ctx: c } = await setup();
    const { agent, documentId } = await parentWithDocument(c, 'relance@example.fr');
    expect((await request(c.app).post('/api/worker/transcriptions').set(bearer()).set(XRW).send({ documentId })).status).toBe(401);
    expect((await agent.post('/api/worker/transcriptions').send({ documentId })).status).toBe(403);
    const locked = await agent.post('/api/worker/transcriptions').set(XRW).send({ documentId });
    expect(locked.status).toBe(403);
    expect(locked.body.error.code).toBe('parent_locked');
    await unlock(agent);
    expect((await agent.post('/api/worker/transcriptions').set(XRW).send({ documentId })).body).toEqual({ queued: 0 });
    expect((await agent.post('/api/worker/transcriptions').set(XRW).send({ documentId: newId() })).status).toBe(404);
    expect((await agent.post('/api/worker/transcriptions').set(XRW).send({ documentId, pageIndexes: [-1] })).status).toBe(400);
  });
});

describe('worker API — lease (§17.3)', () => {
  it('hands out the highest priority first, then the oldest, with the request and without owner ids', async () => {
    const { ctx: c, parentId } = await setup();
    const low = await queueAiJob(c, parentId, { priority: 0, createdAt: c.clock.now - 3_000 });
    const older = await queueAiJob(c, parentId, { priority: 10, createdAt: c.clock.now - 2_000, tier: 'complex', operation: 'generate_questions' });
    const newer = await queueAiJob(c, parentId, { priority: 10, createdAt: c.clock.now - 1_000 });

    const first = await lease(c, { worker: 'w1' });
    expect(first).toEqual({
      id: older, kind: 'ai', tier: 'complex', operation: 'generate_questions', system: 'Consigne',
      documentText: '<texte_du_document>Le chat dort.</texte_du_document>', userText: 'Explique', jsonSchema: { type: 'object' },
      maxOutputTokens: 700, images: [], imageUrl: null, deadlineMs: 90_000, leaseMs: WORKER_PROTOCOL.leaseMs, reasoning: 'low',
    });
    expect(JSON.stringify(first)).not.toContain(parentId);
    // Short requests are answered without a long reflection (§17.4, 2026-09-19).
    expect(await lease(c, { worker: 'w2' })).toMatchObject({ id: newer, tier: 'light', reasoning: 'off' });
    expect((await lease(c, { worker: 'w3' }))?.id).toBe(low);
    expect(await lease(c, { worker: 'w4' })).toBeNull();
    expect(await jobRow(c, older)).toMatchObject({ status: 'leased', leased_by: 'w1', attempts: 1, lease_until: c.clock.now + WORKER_PROTOCOL.leaseMs });
    expect(await lease(c, { worker: 'w5', kinds: ['page_text'] })).toBeNull();
  });

  it('the execution budget of an ai job never goes beyond its expiry', async () => {
    const { ctx: c, parentId } = await setup();
    await queueAiJob(c, parentId, { tier: 'light', expiresAt: c.clock.now + 20_000 });
    expect((await lease(c))?.deadlineMs).toBe(20_000);
  });

  it('claims atomically: one job, two concurrent workers, a single lease', async () => {
    const { ctx: c, parentId } = await setup();
    const id = await queueAiJob(c, parentId);
    const claims = await Promise.all([claimWorkerJob(c.db, id, 'a', c.clock.now, 1000), claimWorkerJob(c.db, id, 'b', c.clock.now, 1000)]);
    expect(claims.filter(Boolean)).toHaveLength(1);

    const other = await queueAiJob(c, parentId);
    const leases = await Promise.all([lease(c, { worker: 'x' }), lease(c, { worker: 'y' })]);
    expect(leases.filter((j) => j !== null).map((j) => j?.id)).toEqual([other]);
  });

  it('one job per worker: a new lease call gives back the job still held', async () => {
    const { ctx: c, parentId } = await setup();
    const first = await queueAiJob(c, parentId, { createdAt: c.clock.now - 10 });
    const second = await queueAiJob(c, parentId);
    expect((await lease(c))?.id).toBe(first);
    expect((await lease(c))?.id).toBe(first);
    const rows = await c.db('worker_jobs').where({ status: 'leased', leased_by: WORKER });
    expect(rows.map((r: { id: string }) => r.id)).toEqual([first]);
    expect(await jobRow(c, first)).toMatchObject({ attempts: 2 });
    expect(await jobRow(c, second)).toMatchObject({ status: 'queued', attempts: 0 });
  });

  it('an expired lease goes back to the queue, and fails after 3 attempts', async () => {
    const { ctx: c, parentId } = await setup();
    const id = await queueAiJob(c, parentId, { expiresAt: c.clock.now + 3_600_000 });
    for (const [attempt, worker] of [[1, 'w1'], [2, 'w2'], [3, 'w3']] as const) {
      const job = await lease(c, { worker });
      expect(job?.id).toBe(id);
      expect(await jobRow(c, id)).toMatchObject({ attempts: attempt, leased_by: worker });
      c.advance(WORKER_PROTOCOL.leaseMs + 1);
    }
    expect(await lease(c, { worker: 'w4' })).toBeNull();
    expect(await jobRow(c, id)).toMatchObject({ status: 'failed', error: 'lease_expired', request_json: '{}' });
  });

  it('a queued job past its expiry becomes expired and is never leased', async () => {
    const { ctx: c, parentId } = await setup();
    const id = await queueAiJob(c, parentId, { expiresAt: c.clock.now + 1_000 });
    c.advance(1_001);
    expect(await lease(c)).toBeNull();
    expect(await jobRow(c, id)).toMatchObject({ status: 'expired', request_json: '{}' });
  });

  it('a worker paused by a usage limit gets nothing, another worker does', async () => {
    const { ctx: c, parentId } = await setup();
    const id = await queueAiJob(c, parentId);
    await setWorkerLimitedUntil(c.db, WORKER, c.clock.now + 60_000, c.clock.now);
    expect(await lease(c)).toBeNull();
    expect((await lease(c, { worker: 'other-pc' }))?.id).toBe(id);
  });

  it('long poll: waits for a job, and stops when the client goes away', async () => {
    const { ctx: c, parentId } = await setup();
    const startedAt = Date.now();
    const pending = lease(c, { waitMs: 5_000 });
    setTimeout(() => void queueAiJob(c, parentId), 300);
    const job = await pending;
    expect(job).not.toBeNull();
    expect(Date.now() - startedAt).toBeLessThan(3_000);

    const emptyStart = Date.now();
    expect(await lease(c, { worker: 'idle', waitMs: 1_200 })).toBeNull();
    expect(Date.now() - emptyStart).toBeGreaterThanOrEqual(1_000);

    // The client aborts: the server loop must not claim a job for nobody.
    await request(c.app).post('/api/worker/lease').set(bearer()).timeout(150).send({ ...LEASE_BODY, worker: 'gone', waitMs: 10_000 })
      .catch(() => undefined);
    const late = await queueAiJob(c, parentId);
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    expect(await jobRow(c, late)).toMatchObject({ status: 'queued' });
  });
});

describe('worker API — page_text leasing rules', () => {
  async function pageJob(c: TestContext, parentId: string, documentId: string, pageIndex: number, sha = 'e'.repeat(64)): Promise<string> {
    const id = newId();
    await insertWorkerJob(c.db, {
      id, parentId, kind: 'page_text', tier: 'light', operation: 'transcribe_page', documentId, pageIndex, imageSha256: sha,
      request: transcriptionRequest(), priority: 0, createdAt: c.clock.now, expiresAt: c.clock.now + 7 * 86_400_000,
    });
    return id;
  }

  it('waits for the page row, skips pages with a protected text source, ignores deleted documents', async () => {
    const { ctx: c } = await setup();
    const { parentId, agent, documentId } = await parentWithDocument(c, 'pages@example.fr', [
      { pageIndex: 1, textSource: 'manual' }, { pageIndex: 2, textSource: 'pdf-text' }, { pageIndex: 3, textSource: 'epub-text' },
    ]);
    const missing = await pageJob(c, parentId, documentId, 0);
    const manual = await pageJob(c, parentId, documentId, 1);
    const pdf = await pageJob(c, parentId, documentId, 2);
    const epub = await pageJob(c, parentId, documentId, 3);

    expect(await lease(c)).toBeNull();
    for (const id of [manual, pdf, epub]) expect(await jobRow(c, id)).toMatchObject({ status: 'skipped', error: 'text_source' });
    expect(await jobRow(c, missing)).toMatchObject({ status: 'queued' });

    await sync(agent, { changes: { pages: [makePage(documentId, { pageIndex: 0, status: 'failed', textSource: null, blocks: [], warnings: ['awaiting_ai'] })] } });
    const job = await lease(c);
    expect(job).toMatchObject({ id: missing, kind: 'page_text', operation: 'transcribe_page', imageUrl: `/api/worker/jobs/${missing}/image`, deadlineMs: 180_000, documentText: null });
    expect(job?.system).toContain('Tu transcris fidèlement');
    expect(job?.jsonSchema).toMatchObject({ required: ['status', 'blocks'] });

    // A job of a deleted document is never given to the worker: closed with the document (2026-09-19).
    await postResult(c, missing, errorBody('bad_job'));
    const again = await pageJob(c, parentId, documentId, 0, 'f'.repeat(64));
    await unlock(agent);
    expect((await agent.delete(`/api/documents/${documentId}`).set(XRW).send()).status).toBe(200);
    expect(await lease(c)).toBeNull();
    expect(await jobRow(c, again)).toMatchObject({ status: 'skipped', error: 'document_deleted' });
  });

  it('serves the page image only to the worker holding the lease, and only the image of the job', async () => {
    const { ctx: c } = await setup();
    const { agent, documentId } = await parentWithDocument(c, 'image@example.fr', [{ pageIndex: 0, status: 'failed', textSource: null, blocks: [] }]);
    expect((await uploadPageImage(agent, documentId, 0)).status).toBe(200);
    const job = await lease(c);
    expect(job?.kind).toBe('page_text');
    const url = job!.imageUrl!;

    const ok = await request(c.app).get(`${url}?worker=${WORKER}`).set(bearer()).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(ok.status).toBe(200);
    expect(ok.headers['content-type']).toBe('image/jpeg');
    expect(ok.headers['cache-control']).toBe('private, no-store');
    expect((ok.body as Buffer).length).toBeGreaterThan(1000);
    expect((await request(c.app).get(`${url}?worker=someone-else`).set(bearer())).status).toBe(404);
    expect((await request(c.app).get(url).set(bearer())).status).toBe(400);

    // Replaced image: the job is about the previous one.
    expect((await uploadPageImage(agent, documentId, 0, JPEG_2)).status).toBe(200);
    expect((await request(c.app).get(`${url}?worker=${WORKER}`).set(bearer())).status).toBe(404);
  });
});

describe('worker API — heartbeat', () => {
  it('records the worker, renews the lease of its current job and follows usage limits', async () => {
    const { ctx: c, parentId } = await setup();
    const res = await heartbeat(c);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, serverTime: c.clock.now });
    expect(await getWorkerState(c.db, WORKER)).toMatchObject({ lastSeenAt: c.clock.now, limitedUntil: null, info: { version: '1.0.0', currentJobId: null } });

    const id = await queueAiJob(c, parentId, { expiresAt: c.clock.now + 3_600_000 });
    await lease(c);
    c.advance(100_000);
    expect((await heartbeat(c, { currentJobId: id })).status).toBe(200);
    expect(await jobRow(c, id)).toMatchObject({ lease_until: c.clock.now + WORKER_PROTOCOL.leaseMs });
    c.advance(100_000);
    expect(await lease(c, { worker: 'other' })).toBeNull();
    expect(await jobRow(c, id)).toMatchObject({ status: 'leased', leased_by: WORKER });

    const resetsAt = c.clock.now + 3_600_000;
    await heartbeat(c, { currentJobId: null, limits: { status: 'rejected', rateLimitType: 'five_hour', utilization: 1, resetsAt } });
    expect(await getWorkerState(c.db, WORKER)).toMatchObject({ limitedUntil: resetsAt, info: { limits: { status: 'rejected' } } });
    await heartbeat(c, { limits: null });
    expect((await getWorkerState(c.db, WORKER))?.limitedUntil).toBe(resetsAt);
    await heartbeat(c, { limits: { status: 'allowed_warning', rateLimitType: 'seven_day', utilization: 0.9, resetsAt: null } });
    expect((await getWorkerState(c.db, WORKER))?.limitedUntil).toBeNull();
    expect((await heartbeat(c, { worker: '' })).status).toBe(400);
  });
});

describe('worker API — results', () => {
  it('stores an ai answer for the waiting request and empties the request', async () => {
    const { ctx: c, parentId } = await setup();
    const id = await queueAiJob(c, parentId);
    await lease(c);
    const res = await postResult(c, id, doneBody({ status: 'ok', explanation: 'Texte' }));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, applied: true });
    const row = await jobRow(c, id);
    expect(row).toMatchObject({ status: 'done', request_json: '{}', lease_until: null });
    expect(JSON.parse(String(row?.result_json))).toEqual({
      json: { status: 'ok', explanation: 'Texte' }, refusal: false, truncated: false, model: 'model-test', inputTokens: 10, outputTokens: 20,
    });
    // Already final: a second result is refused.
    expect((await postResult(c, id, doneBody({}))).status).toBe(409);
  });

  it('refuses results from another worker, for unknown or expired jobs (409 job_not_leased)', async () => {
    const { ctx: c, parentId } = await setup();
    const id = await queueAiJob(c, parentId, { expiresAt: c.clock.now + 10_000 });
    expect((await postResult(c, id, doneBody({}))).status).toBe(409);
    await lease(c);
    const other = await request(c.app).post(`/api/worker/jobs/${id}/result`).set(bearer()).send({ ...doneBody({}), worker: 'intruder' });
    expect(other.status).toBe(409);
    expect(other.body.error.code).toBe('job_not_leased');
    expect((await postResult(c, newId(), doneBody({}))).status).toBe(409);
    c.advance(10_001);
    expect((await postResult(c, id, doneBody({}))).status).toBe(409);
    expect(await jobRow(c, id)).toMatchObject({ status: 'expired', request_json: '{}' });
    expect((await postResult(c, id, { outcome: 'maybe' })).status).toBe(400);
  });

  it('usage_limit: the job goes back to the queue with its attempt refunded and the worker pauses', async () => {
    const { ctx: c, parentId } = await setup();
    const id = await queueAiJob(c, parentId);
    await lease(c);
    const res = await postResult(c, id, errorBody('usage_limit', { retryAfterMs: 600_000 }));
    expect(res.body).toEqual({ ok: true, applied: false });
    expect(await jobRow(c, id)).toMatchObject({ status: 'queued', attempts: 0, leased_by: null });
    expect((await getWorkerState(c.db, WORKER))?.limitedUntil).toBe(c.clock.now + 600_000);
    expect(await lease(c)).toBeNull();

    const second = await queueAiJob(c, parentId, { createdAt: c.clock.now - 60_000 });
    expect((await lease(c, { worker: 'pc-2' }))?.id).toBe(second);
    await postResult(c, second, { ...errorBody('usage_limit'), worker: 'pc-2' });
    expect((await getWorkerState(c.db, 'pc-2'))?.limitedUntil).toBe(c.clock.now + WORKER_PROTOCOL.defaultLimitPauseMs);
  });

  it('timeout, cli_failed and invalid_output retry up to 3 attempts; auth, bad_job and image_unavailable fail at once', async () => {
    const { ctx: c, parentId } = await setup();
    const id = await queueAiJob(c, parentId, { expiresAt: c.clock.now + 3_600_000 });
    for (const error of ['timeout', 'cli_failed']) {
      await lease(c);
      await postResult(c, id, errorBody(error));
      expect(await jobRow(c, id)).toMatchObject({ status: 'queued' });
    }
    await lease(c);
    await postResult(c, id, errorBody('invalid_output'));
    expect(await jobRow(c, id)).toMatchObject({ status: 'failed', error: 'invalid_output', attempts: 3, request_json: '{}' });

    for (const error of ['auth', 'bad_job', 'image_unavailable']) {
      const job = await queueAiJob(c, parentId);
      await lease(c);
      await postResult(c, job, errorBody(error));
      expect(await jobRow(c, job)).toMatchObject({ status: 'failed', error, attempts: 1 });
    }
  });
});
