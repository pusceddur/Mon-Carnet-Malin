// §21 use of the home worker: estimated cost of each run (sent by the worker), monthly estimate, last subscription figures.
import { newId } from '@aide/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { WORKER_USAGE_RETENTION_MS } from '../../src/db/repositories/workerUsage';
import { runRetention } from '../../src/maintenance/retention';
import { uploadsDir } from '../../src/paths';
import { subscriptionWindowOf } from '../../src/worker/status';
import { newParent, type TestContext, unlock } from '../platform/helpers';
import { createWorkerContext, doneBody, errorBody, heartbeat, lease, postResult, queueAiJob } from './helpers';

let ctx: TestContext | null = null;

afterEach(async () => {
  await ctx?.close();
  ctx = null;
});

async function runJob(c: TestContext, parentId: string, body: Record<string, unknown>): Promise<number> {
  const id = await queueAiJob(c, parentId);
  const job = await lease(c);
  expect(job?.id).toBe(id);
  const status = (await postResult(c, id, body)).status;
  // A failed run goes back to the queue: out of the way of the next one.
  await c.db('worker_jobs').delete();
  return status;
}

async function usageRows(c: TestContext): Promise<Record<string, unknown>[]> {
  return (await c.db('worker_usage').select('*').orderBy('created_at')) as Record<string, unknown>[];
}

describe('§21 estimated cost of the runs of the home worker', () => {
  it('records every reported run with its cost, done or failed, and nothing when the worker knows nothing', async () => {
    ctx = await createWorkerContext();
    const c = ctx;
    const { parent } = await newParent(c, 'conso@example.fr');

    expect(await runJob(c, parent.id, doneBody({ ok: true }, { costMicros: 12_345 }))).toBe(200);
    expect(await runJob(c, parent.id, errorBody('invalid_output', { costMicros: 800 }))).toBe(200);
    // Older worker: no cost, but tokens.
    expect(await runJob(c, parent.id, doneBody({ ok: true }))).toBe(200);
    // Usage limit before anything ran: nothing to count.
    expect(await runJob(c, parent.id, errorBody('usage_limit'))).toBe(200);

    const rows = await usageRows(c);
    expect(rows.map((r) => [r.outcome, Number(r.cost_micros ?? -1), r.input_tokens ?? null])).toEqual([
      ['done', 12_345, 10],
      ['invalid_output', 800, null],
      ['done', -1, 10],
    ]);
    expect(rows.every((r) => r.parent_id === parent.id && r.kind === 'ai')).toBe(true);
  });

  it('refuses an impossible cost', async () => {
    ctx = await createWorkerContext();
    const { parent } = await newParent(ctx, 'faux@example.fr');
    expect(await runJob(ctx, parent.id, doneBody({ ok: true }, { costMicros: -1 }))).toBe(400);
    expect(await usageRows(ctx)).toEqual([]);
  });

  it('GET /api/settings/worker: estimate of the month for the account, total of all accounts for the owner only', async () => {
    ctx = await createWorkerContext();
    const c = ctx;
    const owner = await newParent(c, 'proprio@example.fr');
    await c.db('users').where('id', owner.parent.id).update({ is_owner: true });
    const guest = await newParent(c, 'invite@example.fr');

    await runJob(c, owner.parent.id, doneBody({ ok: true }, { costMicros: 1_500_000 }));
    await runJob(c, guest.parent.id, doneBody({ ok: true }, { costMicros: 250_000 }));

    expect((await owner.agent.get('/api/settings/worker')).body.estimate).toEqual({ monthToDateEur: 1.5, allAccountsEur: 1.75 });
    expect((await guest.agent.get('/api/settings/worker')).body.estimate).toEqual({ monthToDateEur: 0.25, allAccountsEur: null });

    // A new month starts from zero.
    const now = new Date(c.clock.now);
    c.advance(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1) - c.clock.now + 1);
    expect((await owner.agent.get('/api/settings/worker')).body.estimate).toEqual({ monthToDateEur: 0, allAccountsEur: 0 });
  });

  it('GET /api/settings/worker: last figures of the subscription, without the service’s own names', async () => {
    ctx = await createWorkerContext();
    const c = ctx;
    const { agent } = await newParent(c, 'temps-reel@example.fr');
    expect((await agent.get('/api/settings/worker')).body.usage).toBeNull();

    const observedAt = c.clock.now - 60_000;
    const resetsAt = c.clock.now + 3 * 3_600_000;
    await heartbeat(c, { limits: { status: 'allowed_warning', rateLimitType: 'seven_day', utilization: 82, resetsAt, observedAt } });
    expect((await agent.get('/api/settings/worker')).body.usage).toEqual({ status: 'allowed_warning', window: 'week', utilization: 82, resetsAt, observedAt });

    // Older worker: no observation time.
    await heartbeat(c, { limits: { status: 'allowed', rateLimitType: 'five_hour', utilization: null, resetsAt: null } });
    expect((await agent.get('/api/settings/worker')).body.usage).toEqual({ status: 'allowed', window: 'session', utilization: null, resetsAt: null, observedAt: null });
    expect(subscriptionWindowOf('seven_day_other')).toBe('week');
    expect(subscriptionWindowOf('overage')).toBe('other');
    expect(subscriptionWindowOf(null)).toBeNull();
  });

  it('the « Budget du mois » shows the estimate next to the paid AI, which alone counts against the budget', async () => {
    ctx = await createWorkerContext();
    const c = ctx;
    const { parent, agent } = await newParent(c, 'budget@example.fr');
    await runJob(c, parent.id, doneBody({ ok: true }, { costMicros: 2_000_000 }));
    await unlock(agent);
    const res = await agent.get('/api/activity');
    expect(res.status).toBe(200);
    expect(res.body.budget).toMatchObject({ monthToDateEur: 0, workerEstimateEur: 2 });
  });

  it('keeps about 13 months of figures', async () => {
    ctx = await createWorkerContext();
    const c = ctx;
    const { parent } = await newParent(c, 'archive@example.fr');
    await runJob(c, parent.id, doneBody({ ok: true }, { costMicros: 1 }));
    await c.db('worker_usage').insert({
      id: newId(), parent_id: parent.id, kind: 'ai', operation: 'explain_word', outcome: 'done',
      input_tokens: 1, output_tokens: 1, cost_micros: 5, created_at: c.clock.now - WORKER_USAGE_RETENTION_MS - 1,
    });
    const report = await runRetention({ db: c.db, now: c.clock.now, uploadsRoot: uploadsDir(c.config) });
    expect(report.workerUsage).toBe(1);
    expect((await usageRows(c)).length).toBe(1);
  });
});
