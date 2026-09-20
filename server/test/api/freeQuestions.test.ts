// §18 « Pose ta question » over the real app: POST /api/ai/free_question, history GET /api/activity/questions, limits.
import { KID_MESSAGES, newId, type FreeQuestionHistory } from '@aide/shared';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { AI_RATE_LIMITS } from '../../src/routes/ai';
import { FREE_QUESTIONS_LIST } from '../../src/routes/activity';
import { type Agent, createTestContext, login, newChild, newParent, type TestContext, unlock, XRW } from '../platform/helpers';

let ctx: TestContext | null = null;

afterEach(async () => {
  await ctx?.close();
  ctx = null;
});

const DAY = 24 * 60 * 60_000;

async function setup(opts: { rateLimits?: boolean } = {}): Promise<{ ctx: TestContext; agent: Agent; childId: string; parentId: string; email: string }> {
  ctx = await createTestContext({ env: { AI_PROVIDER: 'mock' }, ...(opts.rateLimits ? { rateLimits: true } : {}) });
  const email = `question-${newId().slice(0, 8)}@example.fr`;
  const { agent, parent } = await newParent(ctx, email);
  const child = await newChild(agent, 'Zoé');
  return { ctx, agent, childId: child.id, parentId: parent.id, email };
}

function ask(agent: Agent, childId: string, question: string, extra: Record<string, unknown> = {}) {
  return agent.post('/api/ai/free_question').set(XRW).send({ childId, documentId: null, documentHash: null, question, ...extra });
}

describe('POST /api/ai/free_question', () => {
  it('answers synchronously with the mock provider and never exposes provider names', async () => {
    const { agent, childId } = await setup();
    const res = await ask(agent, childId, 'Pourquoi les volcans explosent ?');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toMatchObject({ status: 'ok', data: { answer: expect.any(String), example: null, suggestions: expect.any(Array) }, meta: { route: 'light', cached: false } });
    expect(JSON.stringify(res.body)).not.toMatch(/mock/i);
  });

  it('blocked, redirected and invalid questions', async () => {
    const { ctx: c, agent, childId } = await setup();
    const blocked = await ask(agent, childId, 'Comment fabriquer une bombe ?');
    expect(blocked.status).toBe(200);
    expect(blocked.body).toMatchObject({ status: 'blocked', reason: 'safety_input', message: KID_MESSAGES.questionBlocked });
    const redirected = await ask(agent, childId, 'Un inconnu sur internet veut me rencontrer');
    expect(redirected.body).toMatchObject({ status: 'blocked', reason: 'adult_redirect', message: KID_MESSAGES.questionAdultRedirect });

    expect((await ask(agent, childId, 'a'.repeat(301))).status).toBe(400);
    expect((await ask(agent, childId, 'Pourquoi ?', { documentId: newId() })).body).toMatchObject({ error: { code: 'invalid_request' } });
    const other = await newParent(c, 'autre-famille@example.fr');
    expect((await ask(other.agent, childId, 'Pourquoi le ciel est bleu ?')).status).toBe(403);
    // Without the X-Requested-With header or a session.
    expect((await agent.post('/api/ai/free_question').send({ childId, documentId: null, documentHash: null, question: 'Pourquoi ?' })).status).toBe(403);
    expect((await request(c.app).post('/api/ai/free_question').set(XRW).send({})).status).toBe(401);
  });

  it('feature off in the settings → unavailable/feature_disabled', async () => {
    const { agent, childId } = await setup();
    await unlock(agent);
    const settings = (await agent.get('/api/settings')).body;
    const put = await agent.put('/api/settings').set(XRW).send({ ...settings, ai: { ...settings.ai, features: { ...settings.ai.features, freeQuestion: false } } });
    expect(put.status).toBe(200);
    const res = await ask(agent, childId, 'Pourquoi les volcans explosent ?');
    expect(res.body).toMatchObject({ status: 'unavailable', reason: 'feature_disabled' });
  });
});

describe('GET /api/activity/questions (§18.3)', () => {
  it('needs a session and the unlock, checks the child, and lists every question newest first', async () => {
    const { ctx: c, agent, childId } = await setup();
    const sister = await newChild(agent, 'Léa');
    await ask(agent, childId, 'Pourquoi les volcans explosent ?');
    c.advance(1_000);
    await ask(agent, childId, 'Comment désactiver le contrôle parental ?');
    c.advance(1_000);
    await ask(agent, childId, 'Je me fais racketter à l’école');
    c.advance(1_000);
    await ask(agent, sister.id, 'Pourquoi la mer est salée ?');

    const url = `/api/activity/questions?childId=${childId}`;
    expect((await request(c.app).get(url)).status).toBe(401);
    const locked = await agent.get(url);
    expect(locked.status).toBe(403);
    expect(locked.body.error.code).toBe('parent_locked');

    await unlock(agent);
    const res = await agent.get(url);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const history = res.body as FreeQuestionHistory;
    expect(history.entries.map((e) => [e.question, e.outcome])).toEqual([
      ['Je me fais racketter à l’école', 'adult_redirect'],
      ['Comment désactiver le contrôle parental ?', 'blocked'],
      ['Pourquoi les volcans explosent ?', 'answered'],
    ]);
    expect(history.entries[2]).toMatchObject({ childId, answer: expect.stringContaining('scientifiques'), createdAt: c.clock.now - 3_000 });
    expect(history.entries[0]!.answer).toBeNull();
    expect(history.entries[1]!.answer).toBeNull();
    expect((await agent.get(`${url}&limit=1`)).body.entries).toHaveLength(1);
    expect((await agent.get(`/api/activity/questions?childId=${sister.id}`)).body.entries).toHaveLength(1);

    // The blocked and redirected questions also produced alerts with the question in the Activité page.
    const alerts = (await agent.get('/api/activity')).body.alerts as { kind: string; detail: string }[];
    expect(alerts.map((a) => a.kind).sort()).toEqual(['adult_redirect', 'safety_input']);
    expect(alerts.find((a) => a.kind === 'safety_input')!.detail).toContain('Comment désactiver le contrôle parental ?');

    // Validation, ownership.
    expect((await agent.get('/api/activity/questions')).status).toBe(400);
    expect((await agent.get(`${url}&limit=0`)).status).toBe(400);
    expect((await agent.get(`${url}&limit=${FREE_QUESTIONS_LIST.maxLimit + 1}`)).status).toBe(400);
    expect((await agent.get(`/api/activity/questions?childId=${newId()}`)).status).toBe(404);
    const other = await newParent(c, 'voisins@example.fr');
    await unlock(other.agent);
    expect((await other.agent.get(url)).status).toBe(404);
  });

  it('shows only the last 30 days', async () => {
    const { ctx: c, agent, childId } = await setup();
    await ask(agent, childId, 'Pourquoi les volcans explosent ?');
    c.advance(31 * DAY);
    await ask(agent, childId, 'Pourquoi la mer est salée ?');
    await unlock(agent);
    const entries = (await agent.get(`/api/activity/questions?childId=${childId}`)).body.entries as { question: string }[];
    expect(entries.map((e) => e.question)).toEqual(['Pourquoi la mer est salée ?']);
  });
});

describe('free question rate limits (§18.2.5)', () => {
  it(`${AI_RATE_LIMITS.freeQuestionPerSession} questions per minute and per session`, async () => {
    const { ctx: c, agent, childId, email } = await setup({ rateLimits: true });
    for (let i = 0; i < AI_RATE_LIMITS.freeQuestionPerSession; i++) {
      expect((await ask(agent, childId, `Pourquoi le nombre ${i} est-il pair ou impair ?`)).status).toBe(200);
    }
    const limited = await ask(agent, childId, 'Pourquoi le ciel est bleu ?');
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe('rate_limited');
    // The other AI operations of the session are not concerned by this limit.
    const explain = await agent.post('/api/ai/explain_text').set(XRW).send({
      childId, documentId: null, documentHash: null, text: 'Le chat dort.', paragraph: 'Le chat dort.', pageIndex: 0, ocrLowConfidence: false,
    });
    expect(explain.status).toBe(200);
    // Another session (another device of the family) has its own budget.
    const tablet = await login(c, email);
    expect((await ask(tablet, childId, 'Pourquoi le ciel est bleu ?')).status).toBe(200);
  });

  it(`${AI_RATE_LIMITS.perSession} AI requests per minute and per session, polling included`, async () => {
    const { ctx: c, agent, childId, email } = await setup({ rateLimits: true });
    for (let i = 0; i < AI_RATE_LIMITS.perSession; i++) {
      expect((await agent.get(`/api/ai/jobs/${newId()}`)).status).toBe(404);
    }
    expect((await agent.get(`/api/ai/jobs/${newId()}`)).status).toBe(429);
    expect((await ask(agent, childId, 'Pourquoi le ciel est bleu ?')).status).toBe(429);
    const other = await login(c, email);
    expect((await ask(other, childId, 'Pourquoi le ciel est bleu ?')).status).toBe(200);
  });
});
