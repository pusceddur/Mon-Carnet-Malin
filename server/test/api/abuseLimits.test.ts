// Limits that protect the server from an anonymous or authenticated flood (the source code is public: every
// endpoint and every default is known to an attacker).
import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createTestContext, newParent, XRW, type TestContext } from '../platform/helpers';
import { bearer, WORKER, WORKER_TOKEN, WORKER_TOKEN_SHA256 } from '../worker/helpers';

let ctx: TestContext | null = null;

afterEach(async () => {
  await ctx?.close();
  ctx = null;
});

const login = (c: TestContext, email: string) =>
  request(c.app).post('/api/auth/login').set(XRW).send({ email, password: 'mot-de-passe-faux-123' });

describe('abuse limits', () => {
  it('bounds password checks per caller: a new e-mail at every try does not bypass the limit', async () => {
    ctx = await createTestContext({ rateLimits: true });
    const context = ctx;
    let last: request.Response | null = null;
    // Each login verifies a hash on purpose (anti-enumeration), so the cost must be bounded before that work.
    for (let i = 0; i < 31; i++) last = await login(context, `inconnu-${i}@example.fr`);
    expect(last?.status).toBe(429);
    expect(last?.body.error.code).toBe('rate_limited');
    // The limit is not tied to one e-mail: a legitimate parent is refused too while the burst lasts.
    expect((await login(context, 'parent@example.fr')).status).toBe(429);
  });

  it('refuses a sync push with an oversized table (the app sends at most 1000 entities per request)', async () => {
    ctx = await createTestContext();
    const { agent } = await newParent(ctx, 'parent@example.fr');
    const changes = {
      documents: [], pages: Array.from({ length: 2001 }, () => ({ documentId: 'x' })), annotations: [],
      progress: [], sessions: [], exercises: [], answers: [], children: [],
    };
    const res = await agent.post('/api/sync').set(XRW).send({ cursor: null, deviceId: 'device-test', changes });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('invalid_request');
  });

  it('wrong worker tokens cannot spend the real worker budget (per caller before the token check, per worker after)', async () => {
    // TRUST_PROXY: behind a reverse proxy the caller address comes from the forwarded header, otherwise every caller
    // would share a single bucket and a flood would lock the real worker out.
    ctx = await createTestContext({ env: { WORKER_TOKEN_SHA256, TRUST_PROXY: '1' }, rateLimits: true });
    const context = ctx;
    const heartbeat = (token: string, address: string) =>
      request(context.app).post('/api/worker/heartbeat').set(bearer(token)).set('X-Forwarded-For', address)
        .send({ worker: WORKER, version: '1.0.0', currentJobId: null, limits: null });

    let last: request.Response | null = null;
    for (let i = 0; i < 121; i++) last = await heartbeat('mauvais-jeton', '203.0.113.7');
    expect(last?.status).toBe(429);
    expect((await heartbeat('mauvais-jeton', '203.0.113.7')).status).toBe(429);

    // The real worker, from its own address, is not affected.
    const ok = await heartbeat(WORKER_TOKEN, '198.51.100.9');
    expect(ok.status).toBe(200);
    expect(ok.body.ok).toBe(true);
  });
});
