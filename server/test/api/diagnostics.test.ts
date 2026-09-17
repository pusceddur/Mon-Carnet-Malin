import { type ClientDiagnosticReport, DIAGNOSTIC_LIMITS, newId } from '@aide/shared';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { silentLogger } from '../../src/logger';
import { RETENTION, runRetention } from '../../src/maintenance/retention';
import { uploadsDir } from '../../src/paths';
import { DIAGNOSTICS } from '../../src/routes/diagnostics';
import { type Agent, createTestContext, login, newParent, type TestContext, unlock, XRW } from '../platform/helpers';

const DAY = 24 * 60 * 60_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function report(overrides: Partial<ClientDiagnosticReport> = {}): ClientDiagnosticReport {
  return {
    kind: 'ocr_engine',
    message: 'RuntimeError: Aborted(OOM)',
    stage: 'recognize',
    context: { ipad: true, wasm: true, deviceMemory: null, pageIndex: 2, engine: 'tesseract' },
    userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X)',
    occurredAt: Date.UTC(2026, 8, 16, 9, 59, 0),
    ...overrides,
  };
}

async function post(agent: Agent, body: unknown) {
  return agent.post('/api/diagnostics').set(XRW).send(body as object);
}

describe('client diagnostics (/api/diagnostics)', () => {
  let ctx: TestContext;
  let agent: Agent;
  let parentId: string;

  beforeEach(async () => {
    ctx = await createTestContext();
    const p = await newParent(ctx, 'diagnostic@example.fr');
    agent = p.agent;
    parentId = p.parent.id;
  });
  afterEach(async () => ctx.close());

  async function count(where: Record<string, unknown> = {}): Promise<number> {
    const row = await ctx.db('client_diagnostics').where(where).count({ n: '*' }).first();
    return Number(row?.n ?? 0);
  }

  function row(createdAt: number, parent = parentId) {
    return {
      id: newId(), parent_id: parent, kind: 'other', stage: null, message: 'm', context_json: '{}', user_agent: 'ua', occurred_at: createdAt,
      created_at: createdAt,
    };
  }

  it('requires a session (401) and the X-Requested-With header (403)', async () => {
    const anonymous = await request(ctx.app).post('/api/diagnostics').set(XRW).send({ reports: [report()] });
    expect(anonymous.status).toBe(401);
    expect(anonymous.body.error.code).toBe('not_authenticated');
    expect((await request(ctx.app).get('/api/diagnostics')).status).toBe(401);

    const noHeader = await agent.post('/api/diagnostics').send({ reports: [report()] });
    expect(noHeader.status).toBe(403);
    expect(noHeader.body.error.code).toBe('forbidden');
    expect(await count()).toBe(0);
  });

  it('rejects invalid bodies with 400 invalid_request and bodies over 64 kB with 413', async () => {
    const invalid = [
      {},
      { reports: [] },
      { reports: [{ ...report(), kind: 'document_text' }] },
      { reports: Array.from({ length: DIAGNOSTIC_LIMITS.reportsMax + 1 }, () => report()) },
      { reports: [report({ message: 'x'.repeat(DIAGNOSTIC_LIMITS.messageMax + 1) })] },
      { reports: [report({ context: { nested: { a: 1 } } as never })] },
      { reports: [report({ occurredAt: -1 })] },
    ];
    for (const body of invalid) {
      const res = await post(agent, body);
      expect(res.status, JSON.stringify(body).slice(0, 80)).toBe(400);
      expect(res.body.error.code).toBe('invalid_request');
    }

    const tooBig = await post(agent, { reports: [report()], padding: 'x'.repeat(DIAGNOSTICS.bodyMaxBytes + 10) });
    expect(tooBig.status).toBe(413);
    expect(tooBig.body).toEqual({ error: { code: 'payload_too_large', message: expect.any(String) } });
    expect(await count()).toBe(0);
  });

  it('stores reports with server ids and timestamps (202), without echoing client fields it does not trust', async () => {
    const reports = [report(), report({ kind: 'pdf', stage: null, message: 'InvalidPDFException', context: {} })];
    const res = await post(agent, { reports: reports.map((r) => ({ ...r, id: 'client-id', createdAt: 1 })) });
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ ok: true });

    const rows = await ctx.db('client_diagnostics').where('parent_id', parentId).orderBy('kind');
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r.id).toMatch(UUID);
      expect(Number(r.created_at)).toBe(ctx.clock.now);
    }
    const ocr = rows.find((r) => r.kind === 'ocr_engine');
    expect(ocr).toMatchObject({ stage: 'recognize', message: reports[0]!.message, user_agent: reports[0]!.userAgent });
    expect(Number(ocr.occurred_at)).toBe(reports[0]!.occurredAt);
    expect(JSON.parse(ocr.context_json)).toEqual(reports[0]!.context);
    expect(rows.find((r) => r.kind === 'pdf')).toMatchObject({ stage: null, context_json: '{}' });
  });

  it('GET needs the parent unlock, parses the context and honours limit', async () => {
    await post(agent, { reports: [report({ occurredAt: 1000 })] });
    ctx.advance(60_000);
    await post(agent, { reports: [report({ kind: 'preprocess', stage: 'resize', context: { width: 4032 }, occurredAt: 2000 })] });

    const locked = await agent.get('/api/diagnostics');
    expect(locked.status).toBe(403);
    expect(locked.body.error.code).toBe('parent_locked');

    await unlock(agent);
    const res = await agent.get('/api/diagnostics');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toHaveLength(2);
    expect(res.body[0]).toEqual({
      id: expect.stringMatching(UUID),
      kind: 'preprocess',
      message: report().message,
      stage: 'resize',
      context: { width: 4032 },
      userAgent: report().userAgent,
      occurredAt: 2000,
      createdAt: ctx.clock.now,
    });
    expect(res.body[1]).toMatchObject({ kind: 'ocr_engine', createdAt: ctx.clock.now - 60_000, context: report().context });

    const one = await agent.get('/api/diagnostics?limit=1');
    expect(one.body).toHaveLength(1);
    expect(one.body[0].kind).toBe('preprocess');
    for (const bad of ['0', '201', 'abc', '1.5']) expect((await agent.get(`/api/diagnostics?limit=${bad}`)).status, bad).toBe(400);
  });

  it('isolates parents from each other', async () => {
    const other = await newParent(ctx, 'autre-parent@example.fr');
    await post(agent, { reports: [report()] });
    await post(other.agent, { reports: [report({ kind: 'self_test' }), report({ kind: 'other' })] });

    await unlock(agent);
    await unlock(other.agent);
    const mine = (await agent.get('/api/diagnostics')).body as Array<{ kind: string }>;
    const theirs = (await other.agent.get('/api/diagnostics')).body as Array<{ kind: string }>;
    expect(mine.map((r) => r.kind)).toEqual(['ocr_engine']);
    expect(theirs.map((r) => r.kind).sort()).toEqual(['other', 'self_test']);
    expect(await count({ parent_id: other.parent.id })).toBe(2);
  });

  it('keeps at most 300 rows per parent over 24 h and silently drops the rest', async () => {
    const earlier = ctx.clock.now - 3600_000;
    await ctx.db('client_diagnostics').insert(Array.from({ length: DIAGNOSTICS.dailyRowsMax - 2 }, () => row(earlier)));
    // Old rows do not count against the cap.
    await ctx.db('client_diagnostics').insert(Array.from({ length: 5 }, () => row(ctx.clock.now - DAY - 1)));

    const res = await post(agent, { reports: Array.from({ length: 5 }, () => report()) });
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ ok: true });
    expect(await count({ created_at: ctx.clock.now })).toBe(2);

    expect((await post(agent, { reports: [report()] })).status).toBe(202);
    expect(await count({ created_at: ctx.clock.now })).toBe(2);

    // Another parent is not affected.
    const other = await newParent(ctx, 'plafond@example.fr');
    await post(other.agent, { reports: [report()] });
    expect(await count({ parent_id: other.parent.id })).toBe(1);

    ctx.advance(DAY - 3600_000 + 1);
    await post(agent, { reports: [report(), report()] });
    expect(await count({ created_at: ctx.clock.now, parent_id: parentId })).toBe(2);
  });

  it('retention deletes rows older than 30 days; deleting a parent removes its rows', async () => {
    const now = ctx.clock.now;
    await ctx.db('client_diagnostics').insert([row(now - RETENTION.clientDiagnosticsMs - 1), row(now - RETENTION.clientDiagnosticsMs + DAY), row(now)]);

    const report1 = await runRetention({ db: ctx.db, now, uploadsRoot: uploadsDir(ctx.config) });
    expect(report1.clientDiagnostics).toBe(1);
    expect(await count()).toBe(2);
    expect((await runRetention({ db: ctx.db, now, uploadsRoot: uploadsDir(ctx.config) })).clientDiagnostics).toBe(0);

    const later = now + 31 * DAY;
    expect((await runRetention({ db: ctx.db, now: later, uploadsRoot: uploadsDir(ctx.config) })).clientDiagnostics).toBe(2);
    expect(await count()).toBe(0);

    await ctx.db('client_diagnostics').insert(row(now));
    await ctx.db('users').where('id', parentId).delete();
    expect(await count()).toBe(0);
  });

  it('logs only kinds, stages and counts, never messages or context', async () => {
    const entries: Array<{ message: string; fields: unknown }> = [];
    const logger = { ...silentLogger, info: (message: string, fields?: unknown) => entries.push({ message, fields }) };
    const app = createApp({ config: ctx.config, db: ctx.db, logger, now: () => ctx.clock.now, disableRateLimits: true });
    const logged = await login({ ...ctx, app }, 'diagnostic@example.fr');

    const secret = 'Message-avec-texte-prive';
    expect((await post(logged, { reports: [report({ message: secret, context: { note: secret } }), report({ stage: null })] })).status).toBe(202);
    const entry = entries.find((e) => e.message === 'client_diagnostics_received');
    expect(entry?.fields).toEqual({ count: 2, stored: 2, kinds: ['ocr_engine/recognize', 'ocr_engine'] });
    expect(JSON.stringify(entries)).not.toContain(secret);
  });
});

describe('client diagnostics rate limit', () => {
  let ctx: TestContext;
  afterEach(async () => ctx.close());

  it('allows 30 requests per session per 10 minutes (429 rate_limited after)', async () => {
    ctx = await createTestContext({ rateLimits: true });
    const { agent } = await newParent(ctx, 'limite-diag@example.fr');
    for (let i = 0; i < DIAGNOSTICS.rateLimit; i++) expect((await post(agent, { reports: [report()] })).status).toBe(202);
    const limited = await post(agent, { reports: [report()] });
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe('rate_limited');

    // The limit is per session: a new login is not affected.
    const second = await login(ctx, 'limite-diag@example.fr');
    expect((await post(second, { reports: [report()] })).status).toBe(202);
  });
});
