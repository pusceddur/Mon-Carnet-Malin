import { afterEach, describe, expect, it } from 'vitest';
import { newId, type AIJobAccepted } from '@aide/shared';
import { AIRouter } from '../../src/ai/AIRouter';
import { LocalProvider } from '../../src/ai/LocalProvider';
import { MockProvider } from '../../src/ai/MockProvider';
import { createAIStore } from '../../src/ai/services';
import { createAICacheRepository } from '../../src/db/repositories/aiCache';
import { createAIJobsRepository } from '../../src/db/repositories/aiJobs';
import { createAIRequestsRepository } from '../../src/db/repositories/aiRequests';
import { createSafetyAlertsRepository } from '../../src/db/repositories/safetyAlerts';
import { silentLogger } from '../../src/logger';
import { type Agent, createTestContext, newChild, newParent, type TestContext, XRW } from '../platform/helpers';
import { isKnownWord, page, SCIENCE_TEXT, STORY_TEXT } from './helpers';

let ctx: TestContext | null = null;

afterEach(async () => {
  await ctx?.close();
  ctx = null;
});

async function setup(env: Record<string, string> = { AI_PROVIDER: 'mock' }): Promise<{ ctx: TestContext; agent: Agent; childId: string; parentId: string }> {
  ctx = await createTestContext({ env });
  const { agent, parent } = await newParent(ctx, `ia-${newId().slice(0, 8)}@example.fr`);
  const child = await newChild(agent, 'Zoé');
  return { ctx, agent, childId: child.id, parentId: parent.id };
}

async function pollUntilDone(agent: Agent, jobId: string): Promise<{ status: number; body: { status: string } }> {
  for (let i = 0; i < 100; i++) {
    const res = await agent.get(`/api/ai/jobs/${jobId}`);
    if (res.status !== 200 || res.body.status !== 'pending') return res;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('job still pending');
}

describe('/api/ai routes (mock provider, real app)', () => {
  it('requires authentication and the X-Requested-With header', async () => {
    const { ctx: c } = await setup();
    const { default: request } = await import('supertest');
    expect((await request(c.app).post('/api/ai/explain_text').set(XRW).send({})).status).toBe(401);
    expect((await request(c.app).get(`/api/ai/jobs/${newId()}`)).status).toBe(401);
  });

  it('answers a light request synchronously without exposing the provider, and logs it', async () => {
    const { ctx: c, agent, childId } = await setup();
    const res = await agent.post('/api/ai/explain_text').set(XRW).send({
      childId, documentId: null, documentHash: null, text: SCIENCE_TEXT, paragraph: SCIENCE_TEXT, pageIndex: 0, ocrLowConfidence: false,
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok', meta: { route: 'light', cached: false } });
    expect(JSON.stringify(res.body)).not.toMatch(/mock/i);
    const rows = await c.db('ai_requests').select('provider', 'model', 'status', 'child_id');
    expect(rows).toEqual([{ provider: 'mock', model: 'mock-light', status: 'ok', child_id: childId }]);
  });

  it('runs complex requests as jobs (202 then GET /api/ai/jobs/:jobId)', async () => {
    const { agent, childId } = await setup();
    const res = await agent.post('/api/ai/generate_questions').set(XRW).send({
      childId, documentId: null, documentHash: null, count: 3, types: ['vrai_faux'], pages: [page(0, STORY_TEXT)],
    });
    expect(res.status).toBe(202);
    const accepted = res.body as AIJobAccepted;
    expect(accepted).toMatchObject({ status: 'pending', pollAfterMs: 300 });
    // One request that waits on the server until the answer is there.
    const done = await agent.get(`/api/ai/jobs/${accepted.jobId}?waitMs=10000`);
    expect(done.status).toBe(200);
    expect(done.body).toMatchObject({ status: 'ok', meta: { route: 'complex' } });
  });

  it('validates the operation, the body and the child ownership', async () => {
    const { ctx: c, agent, childId } = await setup();
    expect((await agent.post('/api/ai/tell_a_joke').set(XRW).send({})).status).toBe(404);
    expect((await agent.post('/api/ai/explain_text').set(XRW).send({ childId })).body).toMatchObject({ error: { code: 'invalid_request' } });
    const other = await newParent(c, 'autre-famille@example.fr');
    const res = await other.agent.post('/api/ai/explain_text').set(XRW).send({
      childId, documentId: null, documentHash: null, text: SCIENCE_TEXT, paragraph: '', pageIndex: 0, ocrLowConfidence: false,
    });
    expect(res.status).toBe(403);
    expect((await agent.get(`/api/ai/jobs/${newId()}`)).status).toBe(404);
  });

  it('reports AI availability in /api/health', async () => {
    const { agent } = await setup();
    expect((await agent.get('/api/health')).body.ai).toEqual({ light: true, complex: true });
  });

  it('without provider configuration the AI is unavailable but the app answers', async () => {
    const { agent, childId } = await setup({ AI_PROVIDER: 'local' });
    expect((await agent.get('/api/health')).body.ai).toEqual({ light: false, complex: false });
    const res = await agent.post('/api/ai/explain_text').set(XRW).send({
      childId, documentId: null, documentHash: null, text: SCIENCE_TEXT, paragraph: '', pageIndex: 0, ocrLowConfidence: false,
    });
    expect(res.body).toMatchObject({ status: 'unavailable', reason: 'not_configured' });
  });
});

describe('AI store over the real database', () => {
  it('sends only age, reading level and difficulty: never the first name', async () => {
    const { ctx: c, childId, parentId } = await setup({ AI_PROVIDER: 'local' });
    const provider = new MockProvider();
    const router = new AIRouter({
      now: () => c.clock.now, logger: silentLogger, store: createAIStore({ config: c.config, db: c.db, logger: silentLogger, now: () => c.clock.now }),
      cache: createAICacheRepository(c.db), requests: createAIRequestsRepository(c.db), alerts: createSafetyAlertsRepository(c.db),
      jobs: createAIJobsRepository(c.db), providers: { light: provider, complex: provider }, local: new LocalProvider(), dictionary: null, isKnownWord,
    });
    const outcome = await router.handle('question_on_text', parentId, {
      childId, documentId: null, documentHash: null, question: 'Où habite Tom ?', pages: [page(0, STORY_TEXT)],
    });
    expect(outcome.kind).toBe('result');
    const serialized = JSON.stringify(provider.mock.requests);
    expect(serialized.length).toBeGreaterThan(100);
    expect(serialized).not.toContain('Zoé');
    expect(serialized).not.toContain(childId);
    expect(serialized).toContain('10 ans');
  });
});
