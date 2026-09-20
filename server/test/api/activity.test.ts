import { DEFAULT_PARENT_SETTINGS, newId } from '@aide/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  type Agent, createTestContext, makeDocument, makePage, makeReadingSession, newChild, newParent, sync, type TestContext, unlock, XRW,
} from '../platform/helpers';

describe('activity (parent area)', () => {
  let ctx: TestContext;
  let agent: Agent;
  let parentId: string;

  beforeEach(async () => {
    ctx = await createTestContext();
    const p = await newParent(ctx, 'activite@example.fr');
    agent = p.agent;
    parentId = p.parent.id;
  });
  afterEach(async () => ctx.close());

  function aiRequest(overrides: Record<string, unknown>) {
    return {
      id: newId(), parent_id: parentId, child_id: null, document_id: null, operation: 'explain_text', route: 'light', provider: 'plugin',
      model: 'modele-leger', prompt_version: 'v', cache_hit: false, status: 'ok', rejection_reason: null, rejection_detail: null,
      input_chars: 10, input_tokens: 5, output_tokens: 5, duration_ms: 120, cost_micros: null, readability_warning: false,
      created_at: ctx.clock.now, ...overrides,
    };
  }

  it('needs the unlock and summarizes sessions, AI requests, alerts, OCR issues and the monthly budget', async () => {
    const child = await newChild(agent);
    const other = await newChild(agent, 'Sam');
    const doc = makeDocument(parentId, { childIds: [child.id] });
    await sync(agent, {
      changes: {
        documents: [doc],
        pages: [
          makePage(doc.id, { pageIndex: 0 }),
          makePage(doc.id, { pageIndex: 1, status: 'low_confidence', confidence: 41, warnings: ['low_confidence'] }),
          makePage(doc.id, { pageIndex: 2, warnings: ['suspicious_instructions'] }),
        ],
        sessions: [makeReadingSession(child.id, doc.id), makeReadingSession(other.id, doc.id)],
      },
    });

    const lastMonth = Date.UTC(2026, 7, 31, 23, 0, 0);
    await ctx.db('ai_requests').insert([
      aiRequest({ child_id: child.id, cost_micros: 1_250_000 }),
      aiRequest({ child_id: child.id, cost_micros: 250_000, cache_hit: true, created_at: ctx.clock.now - 60_000 }),
      aiRequest({ child_id: other.id, cost_micros: 9_000_000, created_at: lastMonth }),
    ]);
    const alertId = newId();
    await ctx.db('safety_alerts').insert({ id: alertId, parent_id: parentId, child_id: child.id, document_id: doc.id, kind: 'adult_redirect', detail: 'question', created_at: ctx.clock.now });

    expect((await agent.get('/api/activity')).status).toBe(403);
    await unlock(agent);
    await agent.put('/api/settings').set(XRW).send({ ...DEFAULT_PARENT_SETTINGS, ai: { ...DEFAULT_PARENT_SETTINGS.ai, monthlyBudgetEur: 7 } });

    const res = await agent.get('/api/activity');
    expect(res.status).toBe(200);
    expect(res.body.sessions).toHaveLength(2);
    expect(res.body.aiRequests).toHaveLength(3); // default window: last 30 days
    expect(res.body.budget).toEqual({ monthToDateEur: 1.5, monthlyBudgetEur: 7, workerEstimateEur: 0 });
    expect(res.body.alerts).toEqual([{ id: alertId, createdAt: ctx.clock.now, childId: child.id, kind: 'adult_redirect', detail: 'question', seenAt: null }]);
    expect(res.body.ocrIssues).toHaveLength(2);
    expect(res.body.ocrIssues).toEqual(expect.arrayContaining([
      { documentId: doc.id, pageIndex: 1, confidence: 41, warnings: ['low_confidence'] },
      { documentId: doc.id, pageIndex: 2, confidence: null, warnings: ['suspicious_instructions'] },
    ]));
    expect(res.body.aiRequests[0]).toMatchObject({ childId: child.id, operation: 'explain_text', route: 'light', cacheHit: false, durationMs: 120 });

    const filtered = await agent.get(`/api/activity?childId=${other.id}&from=0`);
    expect(filtered.body.sessions).toHaveLength(1);
    expect(filtered.body.aiRequests).toHaveLength(1);
    expect(filtered.body.alerts).toEqual([]);
    expect(filtered.body.ocrIssues).toEqual([]);

    ctx.advance(5000);
    expect((await agent.post(`/api/activity/alerts/${alertId}/seen`).set(XRW).send()).body).toEqual({ ok: true });
    expect((await agent.post(`/api/activity/alerts/${newId()}/seen`).set(XRW).send()).status).toBe(404);
    const seen = await agent.get('/api/activity');
    expect(seen.body.alerts[0].seenAt).toBe(ctx.clock.now);
    ctx.advance(5000);
    await agent.post(`/api/activity/alerts/${alertId}/seen`).set(XRW).send();
    expect((await agent.get('/api/activity')).body.alerts[0].seenAt).toBe(ctx.clock.now - 5000);

    expect((await agent.get('/api/activity?from=abc')).status).toBe(400);
  });
});
