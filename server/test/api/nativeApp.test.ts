// §29 the bundled native app: it is not same-origin with the server, so it has no cookie jar. It asks for the session
// token once, sends it back as a bearer token, and its origin is the only one allowed across origins.
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { createParentAccount } from '../../src/auth/createParent';
import { createTestContext, PASSWORD, PIN, type TestContext, XRW } from '../platform/helpers';

const EMAIL = 'app@example.fr';
const APP_ORIGIN = 'capacitor://localhost';
const NATIVE = { 'X-Aide-Client': 'native' } as const;

let ctx: TestContext;
afterEach(async () => ctx.close());

async function withParent(env: Record<string, string> = {}): Promise<TestContext> {
  ctx = await createTestContext({ env });
  await createParentAccount(
    ctx.db,
    { email: EMAIL, displayName: 'Parent', password: PASSWORD, pin: PIN },
    { now: ctx.clock.now, rounds: ctx.config.passwordHashRounds },
  );
  return ctx;
}

describe('native app: bearer session (§29)', () => {
  it('gives the session token only to a client that asks for it, and accepts it as a bearer token', async () => {
    const c = await withParent();

    // A browser never asks: its token stays in the httpOnly cookie.
    const browser = await request(c.app).post('/api/auth/login').set(XRW).send({ email: EMAIL, password: PASSWORD });
    expect(browser.status).toBe(200);
    expect(browser.body.authenticated).toBe(true);
    expect(browser.body.sessionToken).toBeUndefined();

    // The app asks, and gets it once.
    const native = await request(c.app).post('/api/auth/login').set(XRW).set(NATIVE).send({ email: EMAIL, password: PASSWORD });
    expect(native.status).toBe(200);
    const token = native.body.sessionToken as string;
    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThan(20);

    // The token alone authenticates: no cookie is sent with these requests.
    const status = await request(c.app).get('/api/auth/status').set(`Authorization`, `Bearer ${token}`);
    expect(status.body.authenticated).toBe(true);
    expect(status.body.parent.email).toBe(EMAIL);

    const children = await request(c.app).get('/api/children').set('Authorization', `Bearer ${token}`);
    expect(children.status).toBe(200);

    // Without it, nothing.
    expect((await request(c.app).get('/api/children')).status).toBe(401);
    expect((await request(c.app).get('/api/children').set('Authorization', 'Bearer not-a-real-token')).status).toBe(401);
  });

  it('signing out invalidates the bearer token', async () => {
    const c = await withParent();
    const login = await request(c.app).post('/api/auth/login').set(XRW).set(NATIVE).send({ email: EMAIL, password: PASSWORD });
    const token = login.body.sessionToken as string;
    const auth = { Authorization: `Bearer ${token}` };

    // /logout needs the adult area open: the code is typed with the bearer token too.
    const unlocked = await request(c.app).post('/api/auth/unlock').set(XRW).set(auth).send({ pin: PIN });
    expect(unlocked.status).toBe(200);
    expect(unlocked.body.parentUnlockedUntil).not.toBeNull();

    expect((await request(c.app).post('/api/auth/logout').set(XRW).set(auth)).status).toBe(200);
    expect((await request(c.app).get('/api/children').set(auth)).status).toBe(401);
  });
});

describe('native app: CORS (§29)', () => {
  it('is off unless APP_ORIGINS lists the origin', async () => {
    const c = await withParent();
    const res = await request(c.app).get('/api/health').set('Origin', APP_ORIGIN);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('answers the preflight of a listed origin and refuses the others', async () => {
    const c = await withParent({ APP_ORIGINS: APP_ORIGIN });

    const preflight = await request(c.app)
      .options('/api/auth/login')
      .set('Origin', APP_ORIGIN)
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'authorization, content-type');
    expect(preflight.status).toBe(204);
    expect(preflight.headers['access-control-allow-origin']).toBe(APP_ORIGIN);
    expect(preflight.headers['access-control-allow-headers']).toContain('Authorization');
    expect(preflight.headers['vary']).toContain('Origin');
    // The app carries a bearer token, never a cookie: credentials stay refused.
    expect(preflight.headers['access-control-allow-credentials']).toBeUndefined();

    const allowed = await request(c.app).get('/api/health').set('Origin', APP_ORIGIN);
    expect(allowed.headers['access-control-allow-origin']).toBe(APP_ORIGIN);

    const stranger = await request(c.app).get('/api/health').set('Origin', 'https://evil.example');
    expect(stranger.headers['access-control-allow-origin']).toBeUndefined();
    const strangerPreflight = await request(c.app)
      .options('/api/auth/login')
      .set('Origin', 'https://evil.example')
      .set('Access-Control-Request-Method', 'POST');
    expect(strangerPreflight.status).toBe(403);
  });

  it('keeps only well-formed origins from APP_ORIGINS', async () => {
    const c = await withParent({ APP_ORIGINS: `${APP_ORIGIN}, https://app.example.fr , not-an-origin, https://bad.example/path` });
    expect(c.config.appOrigins).toEqual([APP_ORIGIN, 'https://app.example.fr']);
  });
});
