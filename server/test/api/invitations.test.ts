import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { generateInviteCode, INVITATION_LOCKOUT, INVITE_CODE_ALPHABET } from '../../src/auth/invitation';
import { SESSION_COOKIE } from '../../src/auth/sessions';
import { createDb, migrationSource } from '../../src/db/knex';
import { toBool } from '../../src/db/repositories/common';
import {
  type Agent, createTestContext, newParent, PASSWORD, PIN, type TestContext, unlock, XRW,
} from '../platform/helpers';

const OWNER_EMAIL = 'proprietaire@example.fr';
const NEW_EMAIL = 'invite@example.fr';
const CODE_RE = new RegExp(`^[${INVITE_CODE_ALPHABET}]{4}-[${INVITE_CODE_ALPHABET}]{4}-[${INVITE_CODE_ALPHABET}]{4}$`);

function registration(inviteCode: string, email = NEW_EMAIL) {
  return { inviteCode, email, password: PASSWORD, displayName: 'Alex', pin: PIN };
}

function register(ctx: TestContext, inviteCode: string, email = NEW_EMAIL) {
  return request(ctx.app).post('/api/auth/register').set(XRW).send(registration(inviteCode, email));
}

async function failureCount(ctx: TestContext): Promise<number> {
  const row = (await ctx.db('app_config').where('key', 'invitation_failures').first()) as { value_json: string } | undefined;
  return row ? (JSON.parse(row.value_json) as { count: number }).count : 0;
}

/** Owner account (first account) with registrations opened on a generated code. */
async function openInvitations(ctx: TestContext): Promise<{ owner: Agent; code: string }> {
  const { agent: owner } = await newParent(ctx, OWNER_EMAIL);
  await unlock(owner);
  const res = await owner.put('/api/admin/invitation').set(XRW).send({ enabled: true, regenerate: true });
  expect(res.status).toBe(200);
  return { owner, code: res.body.code as string };
}

describe('invitations: owner account', () => {
  let ctx: TestContext;
  afterEach(async () => ctx.close());

  it('the first setup creates the owner account', async () => {
    ctx = await createTestContext({ env: { SETUP_TOKEN: 'jeton-installation-de-test-123' } });
    const res = await request(ctx.app).post('/api/auth/setup').set(XRW)
      .send({ setupToken: 'jeton-installation-de-test-123', email: OWNER_EMAIL, password: PASSWORD, displayName: 'Maman', pin: PIN });
    expect(res.status).toBe(200);
    expect(res.body.parent).toMatchObject({ email: OWNER_EMAIL, isOwner: true });
    expect(res.body.registrationOpen).toBe(false);
    const user = await ctx.db('users').where('email', OWNER_EMAIL).first();
    expect(toBool(user.is_owner)).toBe(true);
  });

  it('migration 002 makes the oldest existing account the owner', async () => {
    const db = createDb('sqlite::memory:');
    try {
      await db.migrate.up({ migrationSource });
      const user = (email: string, createdAt: number) => ({
        id: email, email, password_hash: 'x', display_name: 'P', pin_hash: null, created_at: createdAt, updated_at: createdAt,
      });
      await db('users').insert([user('recent@example.fr', 2_000), user('ancien@example.fr', 1_000)]);
      await db.migrate.up({ migrationSource });
      const rows = (await db('users').select('email', 'is_owner').orderBy('created_at')) as { email: string; is_owner: unknown }[];
      expect(rows.map((r) => [r.email, toBool(r.is_owner)])).toEqual([['ancien@example.fr', true], ['recent@example.fr', false]]);
      expect(await db.schema.hasTable('app_config')).toBe(true);
    } finally {
      await db.destroy();
    }
  });
});

describe('invitations: registration', () => {
  let ctx: TestContext;
  afterEach(async () => ctx.close());

  it('is refused while invitations are disabled, even with the stored code, without counting failures', async () => {
    ctx = await createTestContext();
    const { agent: owner } = await newParent(ctx, OWNER_EMAIL);
    expect((await request(ctx.app).get('/api/auth/status')).body.registrationOpen).toBe(false);

    const blind = await register(ctx, 'N-IMPORTE-QUOI');
    expect(blind.status).toBe(403);
    expect(blind.body.error.code).toBe('invalid_invitation');

    await unlock(owner);
    const saved = await owner.put('/api/admin/invitation').set(XRW).send({ enabled: false, regenerate: true });
    const withCode = await register(ctx, saved.body.code as string);
    expect(withCode.status).toBe(403);
    expect(withCode.body.error.code).toBe('invalid_invitation');
    expect(await failureCount(ctx)).toBe(0);
    expect(await ctx.db('users').where('email', NEW_EMAIL).first()).toBeUndefined();
  });

  it('rejects a wrong code, then creates a non-owner account and opens its session with the right one', async () => {
    ctx = await createTestContext();
    const { code } = await openInvitations(ctx);
    expect(code).toMatch(CODE_RE);
    expect((await request(ctx.app).get('/api/auth/status')).body).toMatchObject({ authenticated: false, registrationOpen: true });

    const wrong = await register(ctx, 'AAAA-BBBB-CCCC');
    expect(wrong.status).toBe(403);
    expect(wrong.body.error.code).toBe('invalid_invitation');
    expect(wrong.body.error.message).toMatch(/invitation/);
    expect(await failureCount(ctx)).toBe(1);

    const agent = request.agent(ctx.app);
    const ok = await agent.post('/api/auth/register').set(XRW).send(registration(`  ${code.toLowerCase()} `));
    expect(ok.status).toBe(201);
    expect(ok.body).toMatchObject({ authenticated: true, setupRequired: false, pinSet: true, parentUnlockedUntil: null, registrationOpen: true });
    expect(ok.body.parent).toMatchObject({ email: NEW_EMAIL, displayName: 'Alex', isOwner: false });
    expect(String(ok.headers['set-cookie'])).toContain(`${SESSION_COOKIE}=`);
    expect((await agent.get('/api/children')).status).toBe(200);
    expect((await agent.get('/api/auth/status')).body.parent).toMatchObject({ email: NEW_EMAIL, isOwner: false });

    const user = await ctx.db('users').where('email', NEW_EMAIL).first();
    expect(toBool(user.is_owner)).toBe(false);
    expect(await failureCount(ctx)).toBe(0);

    // The new account is not an owner: it cannot manage invitations.
    await unlock(agent);
    const forbidden = await agent.get('/api/admin/invitation');
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.error.code).toBe('forbidden');
  });

  it('answers 409 email_taken for an existing e-mail, but only once the code is right', async () => {
    ctx = await createTestContext();
    const { code } = await openInvitations(ctx);
    expect((await register(ctx, 'AAAA-BBBB-CCCC', OWNER_EMAIL)).body.error.code).toBe('invalid_invitation');

    const taken = await register(ctx, code, ' Proprietaire@Example.fr ');
    expect(taken.status).toBe(409);
    expect(taken.body.error.code).toBe('email_taken');

    expect((await register(ctx, code)).status).toBe(201);
    const again = await register(ctx, code);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('email_taken');
    expect(await ctx.db('users').count({ n: '*' }).first()).toMatchObject({ n: 2 });
  });

  it('validates the account fields like the setup (400)', async () => {
    ctx = await createTestContext();
    const { code } = await openInvitations(ctx);
    const bad = [
      { ...registration(code), password: 'court' },
      { ...registration(code), pin: '12' },
      { ...registration(code), email: 'pas-un-email' },
      { ...registration(code), displayName: '  ' },
      { ...registration(code), inviteCode: '' },
    ];
    for (const body of bad) {
      const res = await request(ctx.app).post('/api/auth/register').set(XRW).send(body);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('invalid_request');
    }
  });

  it('locks registrations globally after 10 wrong codes: 5 min doubling, reset on success', async () => {
    ctx = await createTestContext();
    const { code } = await openInvitations(ctx);

    for (let i = 0; i < INVITATION_LOCKOUT.freeAttempts; i++) {
      expect((await register(ctx, `FAUX-CODE-${i}`)).status).toBe(403);
    }
    const locked = await register(ctx, code);
    expect(locked.status).toBe(429);
    expect(locked.body.error.code).toBe('too_many_attempts');

    ctx.advance(INVITATION_LOCKOUT.firstLockMs - 1_000);
    expect((await register(ctx, code)).status).toBe(429);
    ctx.advance(1_001);
    expect((await register(ctx, 'ENCORE-FAUX')).status).toBe(403);
    // 11th failure: 10 min.
    ctx.advance(2 * INVITATION_LOCKOUT.firstLockMs - 1_000);
    expect((await register(ctx, code)).status).toBe(429);
    ctx.advance(1_001);

    expect((await register(ctx, code)).status).toBe(201);
    expect(await failureCount(ctx)).toBe(0);
    for (let i = 0; i < INVITATION_LOCKOUT.freeAttempts - 1; i++) await register(ctx, `FAUX-CODE-${i}`);
    expect((await register(ctx, code, 'autre@example.fr')).status).toBe(201);
  });

  it('changing the code clears the lock', async () => {
    ctx = await createTestContext();
    const { owner } = await openInvitations(ctx);
    for (let i = 0; i < INVITATION_LOCKOUT.freeAttempts; i++) await register(ctx, `FAUX-CODE-${i}`);
    expect((await register(ctx, 'ENCORE-FAUX')).status).toBe(429);

    const res = await owner.put('/api/admin/invitation').set(XRW).send({ enabled: true, code: 'nouveau-code-2026' });
    expect(res.status).toBe(200);
    expect(await failureCount(ctx)).toBe(0);
    expect((await register(ctx, 'Nouveau-Code-2026')).status).toBe(201);
  });

  it('rate limits failed registrations (10 per 15 min)', async () => {
    ctx = await createTestContext({ rateLimits: true });
    await openInvitations(ctx);
    let last: request.Response | null = null;
    for (let i = 0; i < 11; i++) last = await register(ctx, 'mauvais');
    expect(last?.status).toBe(429);
    expect(last?.body.error.code).toBe('rate_limited');
  });
});

describe('invitations: admin endpoints', () => {
  let ctx: TestContext;
  afterEach(async () => ctx.close());

  it('need a session, the parent unlock and the owner account', async () => {
    ctx = await createTestContext();
    const anonymous = await request(ctx.app).get('/api/admin/invitation');
    expect(anonymous.status).toBe(401);
    expect(anonymous.body.error.code).toBe('not_authenticated');

    const { agent: owner, parent } = await newParent(ctx, OWNER_EMAIL);
    expect(parent.isOwner).toBe(true);
    const locked = await owner.get('/api/admin/invitation');
    expect(locked.status).toBe(403);
    expect(locked.body.error.code).toBe('parent_locked');

    const { agent: other, parent: otherParent } = await newParent(ctx, 'autre-famille@example.fr');
    expect(otherParent.isOwner).toBe(false);
    await unlock(other);
    for (const res of [
      await other.get('/api/admin/invitation'),
      await other.put('/api/admin/invitation').set(XRW).send({ enabled: true, regenerate: true }),
    ]) {
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('forbidden');
    }
    expect((await request(ctx.app).get('/api/auth/status')).body.registrationOpen).toBe(false);

    await unlock(owner);
    const res = await owner.get('/api/admin/invitation');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toEqual({ enabled: false, code: '', updatedAt: null });
  });

  it('generates readable codes, accepts custom codes and keeps the code when toggling', async () => {
    ctx = await createTestContext();
    const { agent: owner } = await newParent(ctx, OWNER_EMAIL);
    await unlock(owner);
    const put = (body: object) => owner.put('/api/admin/invitation').set(XRW).send(body);

    const opened = await put({ enabled: true });
    expect(opened.status).toBe(200);
    expect(opened.body).toMatchObject({ enabled: true, updatedAt: ctx.clock.now });
    expect(opened.body.code).toMatch(CODE_RE);

    ctx.advance(1_000);
    const regenerated = await put({ enabled: true, regenerate: true });
    expect(regenerated.body.code).toMatch(CODE_RE);
    expect(regenerated.body.code).not.toBe(opened.body.code);
    expect(regenerated.body.updatedAt).toBe(ctx.clock.now);

    const custom = await put({ enabled: true, code: '  mon-code-2026 ' });
    expect(custom.status).toBe(200);
    expect(custom.body.code).toBe('MON-CODE-2026');

    const closed = await put({ enabled: false });
    expect(closed.body).toMatchObject({ enabled: false, code: 'MON-CODE-2026' });
    expect((await owner.get('/api/admin/invitation')).body).toMatchObject({ enabled: false, code: 'MON-CODE-2026' });

    for (const body of [
      { enabled: true, code: 'court' },
      { enabled: true, code: 'avec espace' },
      { enabled: true, code: 'accentué-2026' },
      { enabled: true, code: 'A'.repeat(65) },
      { enabled: true, code: 'VALIDE-2026', regenerate: true },
      { code: 'VALIDE-2026' },
    ]) {
      const res = await put(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    expect((await owner.get('/api/admin/invitation')).body.code).toBe('MON-CODE-2026');
  });

  it('generateInviteCode uses the readable alphabet', () => {
    const codes = new Set(Array.from({ length: 200 }, () => generateInviteCode()));
    expect(codes.size).toBe(200);
    for (const code of codes) expect(code).toMatch(CODE_RE);
    expect(INVITE_CODE_ALPHABET).not.toMatch(/[0O1IL5S8B2Z]/);
  });
});
