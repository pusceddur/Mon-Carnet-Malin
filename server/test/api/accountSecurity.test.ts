// §20 account security: password lock of 15 minutes, optional code of the Réglages, devices signed in, « Mot de passe
// oublié » (e-mail link + code of the Réglages), confirmation of use every 180 days.
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { CONTINUITY, runContinuity } from '../../src/auth/continuity';
import { createMemoryMailer } from '../../src/email/mailer';
import { silentLogger } from '../../src/logger';
import { createTestContext, login, newParent, PASSWORD, PIN, type TestContext, unlock, XRW } from '../platform/helpers';

let ctx: TestContext | null = null;

afterEach(async () => {
  await ctx?.close();
  ctx = null;
});

const DAY = 24 * 60 * 60_000;
const IPAD_UA = 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const WINDOWS_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';

function tokenOf(text: string): string {
  const match = /jeton=([A-Za-z0-9_%-]+)/.exec(text);
  if (!match) throw new Error('no link in the e-mail');
  return decodeURIComponent(match[1]!);
}

async function waitFor<T>(check: () => T | undefined): Promise<T> {
  for (let i = 0; i < 100; i++) {
    const value = check();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('waitFor: timeout');
}

describe('password lock (§20)', () => {
  it('stops at 15 minutes: a stranger who knows the e-mail cannot keep the owner out for a day', async () => {
    ctx = await createTestContext();
    const c = ctx;
    const { parent } = await newParent(c, 'bloque@example.fr');
    for (let i = 0; i < 20; i++) await request(c.app).post('/api/auth/login').set(XRW).send({ email: 'bloque@example.fr', password: 'faux-mot-de-passe' });
    const row = await c.db('users').where('id', parent.id).first();
    expect(Number(row.login_locked_until)).toBeLessThanOrEqual(c.clock.now + 15 * 60_000);
    c.advance(15 * 60_000 + 1);
    expect((await request(c.app).post('/api/auth/login').set(XRW).send({ email: 'bloque@example.fr', password: PASSWORD })).status).toBe(200);
  });
});

describe('code of the Réglages optional (§20)', () => {
  it('turned off with the password: the adult area opens without the code; turned on again with the password', async () => {
    ctx = await createTestContext();
    const c = ctx;
    const { agent } = await newParent(c, 'sanspin@example.fr');
    expect((await agent.get('/api/auth/sessions')).status).toBe(403);
    await unlock(agent);
    expect((await agent.put('/api/auth/pin-required').set(XRW).send({ required: false, password: 'faux' })).status).toBe(403);
    const off = await agent.put('/api/auth/pin-required').set(XRW).send({ required: false, password: PASSWORD });
    expect(off.status).toBe(200);
    expect(off.body).toMatchObject({ pinRequired: false });

    // A new device (or the same one hours later) opens the Réglages directly; « lock » changes nothing.
    const other = await login(c, 'sanspin@example.fr');
    const status = await other.get('/api/auth/status');
    expect(status.body.pinRequired).toBe(false);
    expect(status.body.parentUnlockedUntil).toBeGreaterThan(c.clock.now);
    c.advance(2 * 60 * 60_000);
    expect((await other.get('/api/auth/sessions')).status).toBe(200);
    expect((await other.post('/api/auth/lock').set(XRW).send()).body.parentUnlockedUntil).not.toBeNull();

    const on = await other.put('/api/auth/pin-required').set(XRW).send({ required: true, password: PASSWORD });
    expect(on.body).toMatchObject({ pinRequired: true });
    await other.post('/api/auth/lock').set(XRW).send();
    expect((await other.get('/api/auth/sessions')).status).toBe(403);
  });
});

describe('devices signed in (§20)', () => {
  it('lists the sessions of the account with device, browser, name and IP; one or all others can be signed out', async () => {
    ctx = await createTestContext();
    const c = ctx;
    const { agent: ipad } = await newParent(c, 'appareils@example.fr');
    const windows = request.agent(c.app);
    await windows.post('/api/auth/login').set(XRW).set('User-Agent', WINDOWS_UA).send({ email: 'appareils@example.fr', password: PASSWORD });
    const phone = request.agent(c.app);
    await phone.post('/api/auth/login').set(XRW).set('User-Agent', IPAD_UA).send({ email: 'appareils@example.fr', password: PASSWORD });
    expect((await phone.put('/api/auth/device').set(XRW).send({ name: 'iPad de Léo · app installée' })).status).toBe(200);

    await unlock(ipad);
    const list = await ipad.get('/api/auth/sessions');
    expect(list.status).toBe(200);
    const sessions = list.body.sessions as { id: string; current: boolean; device: string; browser: string; name: string | null; ip: string | null }[];
    expect(sessions).toHaveLength(3);
    expect(sessions.filter((s) => s.current)).toHaveLength(1);
    expect(sessions.find((s) => s.device === 'windows')).toMatchObject({ browser: 'Chrome', current: false });
    const named = sessions.find((s) => s.name === 'iPad de Léo · app installée')!;
    expect(named).toMatchObject({ device: 'ipad', browser: 'Safari' });
    expect(named.ip).toMatch(/\d|:/);
    for (const s of sessions) expect(s.id).toMatch(/^[0-9a-f]{16}$/);

    const current = sessions.find((s) => s.current)!;
    expect((await ipad.delete(`/api/auth/sessions/${current.id}`).set(XRW)).status).toBe(400);
    expect((await ipad.delete(`/api/auth/sessions/${named.id}`).set(XRW)).status).toBe(200);
    expect((await phone.get('/api/auth/status')).body.authenticated).toBe(false);

    expect((await ipad.post('/api/auth/sessions/revoke-others').set(XRW).send()).status).toBe(200);
    expect((await windows.get('/api/auth/status')).body.authenticated).toBe(false);
    expect((await ipad.get('/api/auth/sessions')).body.sessions).toHaveLength(1);

    // Another account never sees nor signs out these devices.
    const stranger = await newParent(c, 'autre@example.fr');
    await unlock(stranger.agent);
    expect((await stranger.agent.delete(`/api/auth/sessions/${current.id}`).set(XRW)).status).toBe(404);
  });
});

describe('« Mot de passe oublié » (§20)', () => {
  it('is unavailable while e-mails are not configured', async () => {
    ctx = await createTestContext();
    const c = ctx;
    expect((await request(c.app).get('/api/auth/status')).body.passwordResetAvailable).toBe(false);
    expect((await request(c.app).post('/api/auth/password-reset').set(XRW).send({ email: 'x@example.fr' })).status).toBe(503);
  });

  it('the link of the e-mail and the code of the Réglages are both needed; the link works once; every device is signed out', async () => {
    const mailer = createMemoryMailer('https://carnet.example.fr');
    ctx = await createTestContext({ mailer });
    const c = ctx;
    const { agent } = await newParent(c, 'oubli@example.fr');
    expect((await request(c.app).get('/api/auth/status')).body.passwordResetAvailable).toBe(true);

    // Same answer for an unknown address, and no e-mail.
    expect((await request(c.app).post('/api/auth/password-reset').set(XRW).send({ email: 'inconnu@example.fr' })).body).toEqual({ ok: true });
    expect((await request(c.app).post('/api/auth/password-reset').set(XRW).send({ email: 'OUBLI@example.fr' })).body).toEqual({ ok: true });
    const mail = await waitFor(() => mailer.sent[0]);
    expect(mailer.sent).toHaveLength(1);
    expect(mail.to).toBe('oubli@example.fr');
    expect(mail.text).toContain('https://carnet.example.fr/nouveau-mot-de-passe?jeton=');
    const token = tokenOf(mail.text);

    const confirm = (body: Record<string, unknown>) => request(c.app).post('/api/auth/password-reset/confirm').set(XRW).send(body);
    expect((await confirm({ token, pin: '000000', newPassword: 'nouveau-mot-de-passe-1' })).status).toBe(403);
    expect((await confirm({ token: 'x'.repeat(43), pin: PIN, newPassword: 'nouveau-mot-de-passe-1' })).status).toBe(400);
    expect((await confirm({ token, pin: PIN, newPassword: 'nouveau-mot-de-passe-1' })).status).toBe(200);
    expect((await confirm({ token, pin: PIN, newPassword: 'encore-un-autre-mdp' })).status).toBe(400);

    expect((await agent.get('/api/auth/status')).body.authenticated).toBe(false);
    expect((await request(c.app).post('/api/auth/login').set(XRW).send({ email: 'oubli@example.fr', password: PASSWORD })).status).toBe(401);
    expect((await request(c.app).post('/api/auth/login').set(XRW).send({ email: 'oubli@example.fr', password: 'nouveau-mot-de-passe-1' })).status).toBe(200);
  });

  it('a link expires after 30 minutes and a new request replaces the previous link', async () => {
    const mailer = createMemoryMailer();
    ctx = await createTestContext({ mailer });
    const c = ctx;
    await newParent(c, 'expire@example.fr');
    await request(c.app).post('/api/auth/password-reset').set(XRW).send({ email: 'expire@example.fr' });
    const first = tokenOf((await waitFor(() => mailer.sent[0])).text);
    await request(c.app).post('/api/auth/password-reset').set(XRW).send({ email: 'expire@example.fr' });
    const second = tokenOf((await waitFor(() => mailer.sent[1])).text);
    const confirm = (token: string) => request(c.app).post('/api/auth/password-reset/confirm').set(XRW).send({ token, pin: PIN, newPassword: 'nouveau-mot-de-passe-1' });
    expect((await confirm(first)).status).toBe(400);
    c.advance(31 * 60_000);
    expect((await confirm(second)).status).toBe(400);
  });
});

describe('confirmation of use every 180 days (§20)', () => {
  it('asks by e-mail after 180 days; the link confirms; without it every device is signed out after 14 days', async () => {
    const mailer = createMemoryMailer('https://carnet.example.fr');
    ctx = await createTestContext({ mailer });
    const c = ctx;
    const { agent, parent } = await newParent(c, 'suite@example.fr');
    const run = () => runContinuity({ db: c.db, now: c.clock.now, mailer, logger: silentLogger });
    // The iPad is used every few weeks (a session unused for 180 days expires by itself).
    const passDays = async (days: number): Promise<void> => {
      for (let d = 0; d < days; d += 30) {
        c.advance(Math.min(30, days - d) * DAY);
        await agent.get('/api/auth/status');
      }
    };

    await passDays(179);
    expect(await run()).toMatchObject({ asked: 0 });
    await passDays(2);
    expect(await run()).toMatchObject({ asked: 1 });
    expect(mailer.sent[0]!.text).toContain('https://carnet.example.fr/confirmer?jeton=');
    expect(await run()).toMatchObject({ asked: 0, signedOut: 0 });

    // Confirmed by the link: nothing more for 180 days.
    const confirmed = await request(c.app).post('/api/auth/continuity/confirm').set(XRW).send({ token: tokenOf(mailer.sent[0]!.text) });
    expect(confirmed.status).toBe(200);
    await passDays(15);
    expect(await run()).toMatchObject({ asked: 0, signedOut: 0 });
    expect((await agent.get('/api/auth/status')).body.authenticated).toBe(true);

    // Next time, no click: signed out 14 days after the e-mail.
    await passDays(180);
    expect(await run()).toMatchObject({ asked: 1 });
    await passDays(15);
    expect(await run()).toMatchObject({ signedOut: 1 });
    expect((await agent.get('/api/auth/status')).body.authenticated).toBe(false);
    expect((await request(c.app).post('/api/auth/continuity/confirm').set(XRW).send({ token: tokenOf(mailer.sent[1]!.text) })).status).toBe(400);

    // Signing in again with the password confirms the use.
    await login(c, 'suite@example.fr');
    const row = await c.db('users').where('id', parent.id).first();
    expect(row).toMatchObject({ continuity_email_sent_at: null });
    expect(Number(row.continuity_confirmed_at)).toBe(c.clock.now);
  });

  it('does nothing while e-mails are not configured (nobody is signed out)', async () => {
    ctx = await createTestContext();
    const c = ctx;
    const { agent } = await newParent(c, 'sansmail@example.fr');
    for (let d = 0; d < 400; d += 30) {
      c.advance(30 * DAY);
      await agent.get('/api/auth/status');
    }
    const { disabledMailer } = await import('../../src/email/mailer');
    expect(await runContinuity({ db: c.db, now: c.clock.now, mailer: disabledMailer, logger: silentLogger })).toEqual({ asked: 0, failed: 0, signedOut: 0 });
    expect((await agent.get('/api/auth/status')).body.authenticated).toBe(true);
  });
});
