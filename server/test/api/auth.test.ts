import { createHash } from 'node:crypto';
import { TIMINGS } from '@aide/shared';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { LOCKOUT } from '../../src/auth/lockout';
import { SESSION_COOKIE } from '../../src/auth/sessions';
import {
  type Agent, createTestContext, login, newParent, PASSWORD, PIN, type TestContext, unlock, XRW,
} from '../platform/helpers';

const SETUP_TOKEN = 'jeton-installation-de-test-123';
const EMAIL = 'parent@example.fr';

function setCookieHeader(res: request.Response): string {
  const raw = res.headers['set-cookie'] as unknown;
  return Array.isArray(raw) ? raw.join('\n') : typeof raw === 'string' ? raw : '';
}

function cookieToken(res: request.Response): string | null {
  const match = new RegExp(`${SESSION_COOKIE}=([^;]+)`).exec(setCookieHeader(res));
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

async function status(agent: Agent) {
  const res = await agent.get('/api/auth/status');
  expect(res.status).toBe(200);
  return res.body as { authenticated: boolean; parentUnlockedUntil: number | null; pinLockedUntil: number | null; pinSet: boolean; setupRequired: boolean };
}

describe('auth: setup, sessions, cookies', () => {
  let ctx: TestContext;
  afterEach(async () => ctx.close());

  it('first setup needs the SETUP_TOKEN (timing-safe) and only works once', async () => {
    ctx = await createTestContext({ env: { SETUP_TOKEN } });
    const agent = request.agent(ctx.app);
    expect((await status(agent)).setupRequired).toBe(true);

    const body = { setupToken: 'mauvais', email: EMAIL, password: PASSWORD, displayName: 'Maman', pin: PIN };
    const wrong = await agent.post('/api/auth/setup').set(XRW).send(body);
    expect(wrong.status).toBe(403);
    expect(wrong.body.error.code).toBe('invalid_setup_token');

    const ok = await agent.post('/api/auth/setup').set(XRW).send({ ...body, setupToken: SETUP_TOKEN });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ authenticated: true, setupRequired: false, pinSet: true, parentUnlockedUntil: null, pinLockedUntil: null });
    expect(ok.body.parent.email).toBe(EMAIL);

    const cookie = setCookieHeader(ok);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).not.toMatch(/;\s*Secure/i);

    const again = await request(ctx.app).post('/api/auth/setup').set(XRW).send({ ...body, email: 'autre@example.fr', setupToken: SETUP_TOKEN });
    expect(again.status).toBe(403);
    expect(again.body.error.code).toBe('setup_not_allowed');
  });

  it('two concurrent setups create a single account', async () => {
    ctx = await createTestContext({ env: { SETUP_TOKEN } });
    const body = (email: string) => ({ setupToken: SETUP_TOKEN, email, password: PASSWORD, displayName: 'Parent', pin: PIN });
    const results = await Promise.all([
      request(ctx.app).post('/api/auth/setup').set(XRW).send(body('un@example.fr')),
      request(ctx.app).post('/api/auth/setup').set(XRW).send(body('deux@example.fr')),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 403]);
    expect(await ctx.db('users').count({ n: '*' }).first()).toMatchObject({ n: 1 });
  });

  it('setup is refused when no SETUP_TOKEN is configured', async () => {
    ctx = await createTestContext();
    const res = await request(ctx.app).post('/api/auth/setup').set(XRW)
      .send({ setupToken: 'x', email: EMAIL, password: PASSWORD, displayName: 'Papa', pin: PIN });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('setup_not_allowed');
  });

  it('stores only the sha256 of a random 32-byte token and marks the cookie Secure in production', async () => {
    ctx = await createTestContext();
    await newParent(ctx, EMAIL);
    const res = await request(ctx.app).post('/api/auth/login').set(XRW).send({ email: EMAIL, password: PASSWORD });
    const token = cookieToken(res);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const ids = (await ctx.db('sessions').select('id')).map((r: { id: string }) => r.id);
    expect(ids).not.toContain(token);
    expect(ids).toContain(createHash('sha256').update(token ?? '').digest('hex'));

    const { sessionCookieOptions } = await import('../../src/auth/sessions');
    expect(sessionCookieOptions({ ...ctx.config, isProduction: true }).secure).toBe(true);
    expect(sessionCookieOptions(ctx.config)).toMatchObject({ httpOnly: true, sameSite: 'lax', maxAge: TIMINGS.sessionTtlMs });
  });

  it('requires a session (401) and renews it when used (sliding expiry)', async () => {
    ctx = await createTestContext();
    const { agent } = await newParent(ctx, EMAIL);
    expect((await request(ctx.app).get('/api/children')).status).toBe(401);

    const before = await ctx.db('sessions').first();
    ctx.advance(2 * 60 * 60_000);
    const res = await agent.get('/api/children');
    expect(res.status).toBe(200);
    expect(setCookieHeader(res)).toContain(`${SESSION_COOKIE}=`);
    const after = await ctx.db('sessions').first();
    expect(Number(after.expires_at)).toBe(ctx.clock.now + TIMINGS.sessionTtlMs);
    expect(Number(after.expires_at)).toBeGreaterThan(Number(before.expires_at));

    ctx.advance(TIMINGS.sessionTtlMs + 1);
    const expired = await agent.get('/api/children');
    expect(expired.status).toBe(401);
    expect(expired.body.error.code).toBe('not_authenticated');
  });
});

describe('auth: login lockout per e-mail', () => {
  let ctx: TestContext;
  afterEach(async () => ctx.close());

  it('locks after 5 wrong passwords, then unlocks after 1 minute and resets on success', async () => {
    ctx = await createTestContext();
    await newParent(ctx, EMAIL);
    const attempt = (password: string) => request(ctx.app).post('/api/auth/login').set(XRW).send({ email: EMAIL, password });

    const unknown = await request(ctx.app).post('/api/auth/login').set(XRW).send({ email: 'inconnu@example.fr', password: PASSWORD });
    expect(unknown.status).toBe(401);
    expect(unknown.body.error.code).toBe('invalid_credentials');

    for (let i = 0; i < LOCKOUT.freeAttempts; i++) {
      const res = await attempt('faux-mot-de-passe');
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('invalid_credentials');
    }
    const locked = await attempt(PASSWORD);
    expect(locked.status).toBe(429);
    expect(locked.body.error.code).toBe('login_locked');

    ctx.advance(LOCKOUT.firstLockMs + 1);
    expect((await attempt(PASSWORD)).status).toBe(200);
    const user = await ctx.db('users').where('email', EMAIL).first();
    expect(Number(user.login_failed_count)).toBe(0);
    expect(user.login_locked_until).toBeNull();
  });

  it('e-mail is case-insensitive', async () => {
    ctx = await createTestContext();
    await newParent(ctx, EMAIL);
    const res = await request(ctx.app).post('/api/auth/login').set(XRW).send({ email: '  Parent@Example.FR ', password: PASSWORD });
    expect(res.status).toBe(200);
  });
});

describe('auth: parent PIN', () => {
  let ctx: TestContext;
  afterEach(async () => ctx.close());

  it('progressive PIN lock: 5 errors -> 1 min, then 2 min, 4 min; success resets', async () => {
    ctx = await createTestContext();
    const { agent } = await newParent(ctx, EMAIL);
    const tryPin = (pin: string) => agent.post('/api/auth/unlock').set(XRW).send({ pin });

    for (let i = 0; i < 4; i++) {
      const res = await tryPin('000000');
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('invalid_pin');
      expect((await status(agent)).pinLockedUntil).toBeNull();
    }
    expect((await tryPin('000000')).status).toBe(403);
    expect((await status(agent)).pinLockedUntil).toBe(ctx.clock.now + 60_000);

    const whileLocked = await tryPin(PIN);
    expect(whileLocked.status).toBe(429);
    expect(whileLocked.body.error.code).toBe('pin_locked');

    ctx.advance(60_001);
    expect((await tryPin('111111')).status).toBe(403);
    expect((await status(agent)).pinLockedUntil).toBe(ctx.clock.now + 120_000);

    ctx.advance(120_001);
    expect((await tryPin('222222')).status).toBe(403);
    expect((await status(agent)).pinLockedUntil).toBe(ctx.clock.now + 240_000);

    ctx.advance(240_001);
    const ok = await tryPin(PIN);
    expect(ok.status).toBe(200);
    expect(ok.body.parentUnlockedUntil).toBe(ctx.clock.now + TIMINGS.parentUnlockMs);
    expect(ok.body.pinLockedUntil).toBeNull();

    // Counter reset: a single new error does not lock.
    expect((await tryPin('333333')).status).toBe(403);
    expect((await status(agent)).pinLockedUntil).toBeNull();
  });

  it('the unlock lasts 15 minutes and lock ends it', async () => {
    ctx = await createTestContext();
    const { agent } = await newParent(ctx, EMAIL);
    const settings = (await agent.get('/api/settings')).body;
    expect((await agent.put('/api/settings').set(XRW).send(settings)).status).toBe(403);

    await unlock(agent);
    expect((await agent.put('/api/settings').set(XRW).send(settings)).status).toBe(200);
    ctx.advance(TIMINGS.parentUnlockMs + 1);
    const expired = await agent.put('/api/settings').set(XRW).send(settings);
    expect(expired.status).toBe(403);
    expect(expired.body.error.code).toBe('parent_locked');

    await unlock(agent);
    const locked = await agent.post('/api/auth/lock').set(XRW).send();
    expect(locked.status).toBe(200);
    expect(locked.body.parentUnlockedUntil).toBeNull();
    expect((await agent.put('/api/settings').set(XRW).send(settings)).status).toBe(403);
  });

  it('a forgotten PIN is reset with the password (no unlock needed), which also clears the PIN lock', async () => {
    ctx = await createTestContext();
    const { agent } = await newParent(ctx, EMAIL);
    for (let i = 0; i < LOCKOUT.freeAttempts; i++) await agent.post('/api/auth/unlock').set(XRW).send({ pin: '999999' });
    expect((await status(agent)).pinLockedUntil).not.toBeNull();

    const wrong = await agent.put('/api/auth/pin').set(XRW).send({ password: 'pas-le-bon-mot', newPin: '135790' });
    expect(wrong.status).toBe(403);
    expect(wrong.body.error.code).toBe('invalid_password');

    const ok = await agent.put('/api/auth/pin').set(XRW).send({ password: PASSWORD, newPin: '135790' });
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ ok: true });
    expect((await status(agent)).pinLockedUntil).toBeNull();
    expect((await agent.post('/api/auth/unlock').set(XRW).send({ pin: PIN })).status).toBe(403);
    expect((await agent.post('/api/auth/unlock').set(XRW).send({ pin: '135790' })).status).toBe(200);
  });

  it('password re-checks count against the login lockout', async () => {
    ctx = await createTestContext();
    const { agent } = await newParent(ctx, EMAIL);
    for (let i = 0; i < LOCKOUT.freeAttempts; i++) {
      expect((await agent.put('/api/auth/pin').set(XRW).send({ password: 'mauvais-mot-de-passe', newPin: '1234' })).status).toBe(403);
    }
    const locked = await agent.put('/api/auth/pin').set(XRW).send({ password: PASSWORD, newPin: '1234' });
    expect(locked.status).toBe(429);
    expect(locked.body.error.code).toBe('login_locked');
  });
});

describe('auth: logout, password, CSRF header, rate limits', () => {
  let ctx: TestContext;
  afterEach(async () => ctx.close());

  it('logout requires the parent unlock and destroys the session', async () => {
    ctx = await createTestContext();
    const { agent } = await newParent(ctx, EMAIL);
    const lockedLogout = await agent.post('/api/auth/logout').set(XRW).send();
    expect(lockedLogout.status).toBe(403);
    expect(lockedLogout.body.error.code).toBe('parent_locked');

    await unlock(agent);
    const res = await agent.post('/api/auth/logout').set(XRW).send();
    expect(res.status).toBe(200);
    expect(setCookieHeader(res)).toMatch(new RegExp(`${SESSION_COOKIE}=;`));
    expect(await ctx.db('sessions').count({ n: '*' }).first()).toMatchObject({ n: 0 });
    expect((await status(agent)).authenticated).toBe(false);
  });

  it('changing the password needs unlock + current password and closes the other sessions', async () => {
    ctx = await createTestContext();
    const { agent } = await newParent(ctx, EMAIL);
    const other = await login(ctx, EMAIL);
    const body = { currentPassword: PASSWORD, newPassword: 'nouveau-mot-de-passe-7' };
    expect((await agent.put('/api/auth/password').set(XRW).send(body)).status).toBe(403);

    await unlock(agent);
    const wrong = await agent.put('/api/auth/password').set(XRW).send({ ...body, currentPassword: 'mauvais-mot-de-passe' });
    expect(wrong.body.error.code).toBe('invalid_password');
    const tooShort = await agent.put('/api/auth/password').set(XRW).send({ ...body, newPassword: 'court' });
    expect(tooShort.status).toBe(400);

    expect((await agent.put('/api/auth/password').set(XRW).send(body)).status).toBe(200);
    expect((await agent.get('/api/children')).status).toBe(200);
    expect((await other.get('/api/children')).status).toBe(401);
    await expect(login(ctx, EMAIL)).rejects.toThrow();
    expect((await login(ctx, EMAIL, 'nouveau-mot-de-passe-7'))).toBeDefined();
  });

  it('mutations without X-Requested-With are rejected even with a valid session (CSRF)', async () => {
    ctx = await createTestContext();
    const { agent } = await newParent(ctx, EMAIL);
    await unlock(agent);
    const noHeader = await agent.post('/api/auth/lock').send();
    expect(noHeader.status).toBe(403);
    expect(noHeader.body.error.code).toBe('forbidden');
    expect((await agent.post('/api/children').set('X-Requested-With', 'XMLHttpRequest').send({ firstName: 'Zoé' })).status).toBe(403);
    expect((await agent.delete('/api/documents/abc').send()).status).toBe(403);
    expect((await agent.get('/api/children')).status).toBe(200);
    expect((await status(agent)).parentUnlockedUntil).not.toBeNull();
  });

  it('rate limits failed logins per e-mail and failed unlocks per session', async () => {
    ctx = await createTestContext({ rateLimits: true });
    const { agent } = await newParent(ctx, EMAIL);

    let last: request.Response | null = null;
    for (let i = 0; i < 11; i++) {
      last = await request(ctx.app).post('/api/auth/login').set(XRW).send({ email: EMAIL, password: 'faux-mot-de-passe' });
    }
    expect(last?.status).toBe(429);
    expect(last?.body.error.code).toBe('rate_limited');
    // Another e-mail is not affected.
    expect((await request(ctx.app).post('/api/auth/login').set(XRW).send({ email: 'x@example.fr', password: 'y' })).body.error.code)
      .toBe('invalid_credentials');

    for (let i = 0; i < 5; i++) await agent.post('/api/auth/unlock').set(XRW).send({ pin: '000000' });
    const limited = await agent.post('/api/auth/unlock').set(XRW).send({ pin: PIN });
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe('rate_limited');
  });
});
