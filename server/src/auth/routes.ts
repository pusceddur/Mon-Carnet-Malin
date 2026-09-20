import {
  type AuthStatus, ChangePasswordRequestSchema, ChangePinRequestSchema, ContinuityConfirmSchema, DeviceNameRequestSchema,
  type DeviceSessionsResponse, LoginRequestSchema, type OkResponse, PasswordResetConfirmSchema, PasswordResetRequestSchema,
  PinRequiredRequestSchema, RegisterRequestSchema, SetupRequestSchema, TIMINGS, UnlockRequestSchema,
} from '@aide/shared';
import { type Request, type Response, Router } from 'express';
import { isMysql } from '../db/repositories/common';
import { consumeEmailToken, createEmailToken, findValidEmailToken } from '../db/repositories/emailTokens';
import {
  deleteOtherSessions, deleteSession, deleteUserSessions, listUserSessions, setParentUnlockedUntil, setSessionDeviceName,
} from '../db/repositories/sessions';
import {
  type AttemptKind, confirmContinuity, countUsers, findUserByEmail, findUserById, incrementFailedAttempts, resetAttempts,
  setLockedUntil, setPinRequired, toParentUser, updatePasswordHash, updatePinHash, type UserRecord,
} from '../db/repositories/users';
import { mailerFor } from '../email/mailer';
import { passwordResetEmail } from '../email/templates.fr';
import { appError, parseOrThrow } from '../errors';
import type { AppDeps } from '../types';
import { createParentAccount } from './createParent';
import { publicSessionId, toDeviceSession } from './devices';
import {
  getInvitation, invitationLockedUntil, inviteCodeMatches, isInvitationUsable, registerInvitationFailure, resetInvitationFailures,
} from './invitation';
import { isLocked, LOCKOUT, LOGIN_LOCKOUT, lockUntilAfterFailure } from './lockout';
import { rateLimiter, requireAuth, requireParentUnlock, ipKey } from './middleware';
import { dummyHash, hashSecret, timingSafeEqualString, verifySecret } from './passwords';
import {
  type AuthContext, clearSessionCookie, createSession, readSessionToken, hashSessionToken, resolveSession, setSessionCookie,
  wantsSessionToken,
} from './sessions';

const FIFTEEN_MINUTES = 15 * 60_000;
const HOUR = 60 * 60_000;
/** §20 life of the « Mot de passe oublié » link. */
export const PASSWORD_RESET_TTL_MS = 30 * 60_000;
export const PASSWORD_RESET_PATH = '/nouveau-mot-de-passe';

function authOf(req: Request): AuthContext {
  if (!req.auth) throw appError(401, 'not_authenticated');
  return req.auth;
}

function emailKey(req: Request): string {
  const body = req.body as { email?: unknown } | undefined;
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase().slice(0, 254) : '';
  return `login:${email}`;
}

export async function buildAuthStatus(deps: AppDeps, auth: AuthContext | null): Promise<AuthStatus> {
  const now = deps.now();
  const user = auth ? await findUserById(deps.db, auth.userId) : null;
  const registrationOpen = isInvitationUsable(await getInvitation(deps.db));
  const passwordResetAvailable = mailerFor(deps).enabled;
  if (!auth || !user) {
    const setupRequired = (await countUsers(deps.db)) === 0;
    return {
      setupRequired,
      authenticated: false,
      parent: null,
      parentUnlockedUntil: null,
      pinSet: false,
      pinLockedUntil: null,
      registrationOpen: registrationOpen && !setupRequired,
      pinRequired: true,
      passwordResetAvailable,
      aiReading: false,
    };
  }
  return {
    setupRequired: false,
    authenticated: true,
    parent: toParentUser(user),
    parentUnlockedUntil: auth.parentUnlockedUntil !== null && auth.parentUnlockedUntil > now ? auth.parentUnlockedUntil : null,
    pinSet: user.pinHash !== null,
    pinLockedUntil: isLocked(user.pinLockedUntil, now) ? user.pinLockedUntil : null,
    registrationOpen,
    pinRequired: user.pinRequired,
    passwordResetAvailable,
    aiReading: deps.config.worker.tokenSha256 !== null,
  };
}

/**
 * Registers a failure (atomic increment) and applies the progressive lock. §20: the password lock stops at 15 minutes, so
 * that someone who only knows the e-mail cannot keep the owner out for a whole day.
 */
async function registerFailure(deps: AppDeps, user: UserRecord, kind: AttemptKind): Promise<void> {
  const count = await incrementFailedAttempts(deps.db, user.id, kind);
  const until = lockUntilAfterFailure(count, deps.now(), kind === 'login' ? LOGIN_LOCKOUT : LOCKOUT);
  if (until !== null) await setLockedUntil(deps.db, user.id, kind, until);
}

/** Password re-check shared by login-less endpoints; counts against the login lockout of the account. */
async function checkPassword(deps: AppDeps, user: UserRecord, password: string): Promise<void> {
  if (isLocked(user.loginLockedUntil, deps.now())) throw appError(429, 'login_locked');
  if (!(await verifySecret(password, user.passwordHash))) {
    await registerFailure(deps, user, 'login');
    throw appError(403, 'invalid_password');
  }
  await resetAttempts(deps.db, user.id, ['login']);
}

/** New session after a password (setup, sign-up, login): it also confirms that the account is in use (§20). */
async function startSession(deps: AppDeps, req: Request, res: Response, userId: string): Promise<{ ctx: AuthContext; token: string }> {
  const previous = readSessionToken(req);
  if (previous) await deleteSession(deps.db, hashSessionToken(previous));
  const now = deps.now();
  const { token, session } = await createSession(deps.db, userId, now, req.get('user-agent') ?? null, req.ip ?? null);
  setSessionCookie(res, deps.config, token);
  await confirmContinuity(deps.db, userId, now);
  const pinRequired = (await findUserById(deps.db, userId))?.pinRequired ?? true;
  const ctx: AuthContext = {
    userId, sessionId: session.id, parentUnlockedUntil: pinRequired ? null : now + TIMINGS.parentUnlockMs, pinRequired,
  };
  return { ctx, token };
}

/**
 * §29: the bundled app is not same-origin with the server, so the session cookie never reaches it. When it asks
 * (`X-Aide-Client: native`) it receives the session token once, at the moment the session opens, and sends it back as
 * `Authorization: Bearer …`. A browser never asks, so its token stays in the httpOnly cookie and out of reach of scripts.
 */
function withSessionToken(req: Request, status: AuthStatus, token: string): AuthStatus {
  return wantsSessionToken(req) ? { ...status, sessionToken: token } : status;
}

/** Mounted by app.ts at `/api/auth`: declare paths relative to that prefix. */
export function createAuthRouter(deps: AppDeps): Router {
  const router = Router();
  const auth = requireAuth(deps);
  const unlocked = requireParentUnlock(deps);

  const setupLimiter = rateLimiter(deps, { windowMs: FIFTEEN_MINUTES, limit: 10, key: () => 'setup', failedOnly: true });
  const registerLimiter = rateLimiter(deps, { windowMs: FIFTEEN_MINUTES, limit: 10, key: () => 'register', failedOnly: true });
  const loginLimiter = rateLimiter(deps, { windowMs: FIFTEEN_MINUTES, limit: 10, key: emailKey, failedOnly: true });
  // Every login verifies a password hash on purpose (also for unknown e-mails, against account enumeration), which costs
  // CPU: these two limiters bound that cost before the hash is computed, per caller and for the whole server.
  const loginIpLimiter = rateLimiter(deps, { windowMs: FIFTEEN_MINUTES, limit: 30, key: (req) => `login-ip:${ipKey(req)}` });
  const loginAllLimiter = rateLimiter(deps, { windowMs: 60_000, limit: 60, key: () => 'login-all' });
  const unlockLimiter = rateLimiter(deps, {
    windowMs: FIFTEEN_MINUTES,
    limit: 5,
    key: (req) => `unlock:${req.auth?.sessionId ?? ''}`,
    failedOnly: true,
  });

  router.get('/status', async (req, res) => {
    const ctx = await resolveSession(deps, req, res);
    res.set('Cache-Control', 'no-store').json(await buildAuthStatus(deps, ctx));
  });

  router.post('/setup', setupLimiter, async (req, res) => {
    const body = parseOrThrow(SetupRequestSchema, req.body);
    const expected = deps.config.setupToken;
    if (!expected) throw appError(403, 'setup_not_allowed');
    if (!timingSafeEqualString(body.setupToken, expected)) throw appError(403, 'invalid_setup_token');
    // One transaction holding a lock on `users` so that two concurrent setups cannot both create an account.
    const parent = await deps.db.transaction(async (trx) => {
      const existing = trx('users').select('id').limit(1);
      if ((await (isMysql(trx) ? existing.forUpdate() : existing)).length > 0) throw appError(403, 'setup_not_allowed');
      return createParentAccount(
        trx,
        { email: body.email, password: body.password, displayName: body.displayName, pin: body.pin },
        { now: deps.now(), rounds: deps.config.passwordHashRounds, isOwner: true },
      );
    });
    deps.logger.info('parent_setup_done', { userId: parent.id });
    const { ctx, token } = await startSession(deps, req, res, parent.id);
    res.json(withSessionToken(req, await buildAuthStatus(deps, ctx), token));
  });

  // Invitation-only sign-up: the code is checked before anything else (no e-mail enumeration without it).
  router.post('/register', registerLimiter, async (req, res) => {
    const body = parseOrThrow(RegisterRequestSchema, req.body);
    const now = deps.now();
    if ((await invitationLockedUntil(deps.db, now)) !== null) throw appError(429, 'too_many_attempts');
    const invitation = await getInvitation(deps.db);
    if (!inviteCodeMatches(invitation, body.inviteCode)) {
      // Nothing to guess while registrations are closed: only wrong codes against an open invitation count.
      if (isInvitationUsable(invitation)) await registerInvitationFailure(deps.db, now);
      throw appError(403, 'invalid_invitation');
    }
    const parent = await createParentAccount(
      deps.db,
      { email: body.email, password: body.password, displayName: body.displayName, pin: body.pin },
      { now, rounds: deps.config.passwordHashRounds, isOwner: false },
    );
    await resetInvitationFailures(deps.db, now);
    deps.logger.info('parent_registered', { userId: parent.id });
    const { ctx, token } = await startSession(deps, req, res, parent.id);
    res.status(201).json(withSessionToken(req, await buildAuthStatus(deps, ctx), token));
  });

  router.post('/login', loginAllLimiter, loginIpLimiter, loginLimiter, async (req, res) => {
    const body = parseOrThrow(LoginRequestSchema, req.body);
    const user = await findUserByEmail(deps.db, body.email);
    if (!user) {
      await verifySecret(body.password, await dummyHash(deps.config.passwordHashRounds));
      throw appError(401, 'invalid_credentials');
    }
    if (isLocked(user.loginLockedUntil, deps.now())) throw appError(429, 'login_locked');
    if (!(await verifySecret(body.password, user.passwordHash))) {
      await registerFailure(deps, user, 'login');
      throw appError(401, 'invalid_credentials');
    }
    await resetAttempts(deps.db, user.id, ['login', 'pin']);
    const { ctx, token } = await startSession(deps, req, res, user.id);
    res.json(withSessionToken(req, await buildAuthStatus(deps, ctx), token));
  });

  router.post('/logout', auth, unlocked, async (req, res) => {
    await deleteSession(deps.db, authOf(req).sessionId);
    clearSessionCookie(res, deps.config);
    const body: OkResponse = { ok: true };
    res.json(body);
  });

  router.post('/unlock', auth, unlockLimiter, async (req, res) => {
    const ctx = authOf(req);
    const body = parseOrThrow(UnlockRequestSchema, req.body);
    const user = await findUserById(deps.db, ctx.userId);
    if (!user) throw appError(401, 'not_authenticated');
    if (!user.pinHash) throw appError(409, 'pin_not_set');
    if (isLocked(user.pinLockedUntil, deps.now())) throw appError(429, 'pin_locked');
    if (!(await verifySecret(body.pin, user.pinHash))) {
      await registerFailure(deps, user, 'pin');
      throw appError(403, 'invalid_pin');
    }
    await resetAttempts(deps.db, user.id, ['pin']);
    const until = deps.now() + TIMINGS.parentUnlockMs;
    await setParentUnlockedUntil(deps.db, ctx.sessionId, until);
    res.json(await buildAuthStatus(deps, { ...ctx, parentUnlockedUntil: until }));
  });

  router.post('/lock', auth, async (req, res) => {
    const ctx = authOf(req);
    await setParentUnlockedUntil(deps.db, ctx.sessionId, null);
    // Without the code (§20) the adult area stays open.
    res.json(await buildAuthStatus(deps, { ...ctx, parentUnlockedUntil: ctx.pinRequired ? null : ctx.parentUnlockedUntil }));
  });

  // §15.8: resetting a forgotten PIN needs the password, not the PIN.
  router.put('/pin', auth, async (req, res) => {
    const ctx = authOf(req);
    const body = parseOrThrow(ChangePinRequestSchema, req.body);
    const user = await findUserById(deps.db, ctx.userId);
    if (!user) throw appError(401, 'not_authenticated');
    await checkPassword(deps, user, body.password);
    await updatePinHash(deps.db, user.id, await hashSecret(body.newPin, deps.config.passwordHashRounds), deps.now());
    const ok: OkResponse = { ok: true };
    res.json(ok);
  });

  router.put('/password', auth, unlocked, async (req, res) => {
    const ctx = authOf(req);
    const body = parseOrThrow(ChangePasswordRequestSchema, req.body);
    const user = await findUserById(deps.db, ctx.userId);
    if (!user) throw appError(401, 'not_authenticated');
    await checkPassword(deps, user, body.currentPassword);
    await updatePasswordHash(deps.db, user.id, await hashSecret(body.newPassword, deps.config.passwordHashRounds), deps.now());
    await deleteOtherSessions(deps.db, user.id, ctx.sessionId);
    const ok: OkResponse = { ok: true };
    res.json(ok);
  });

  // ---------- §20 account security ----------

  // Code of the Réglages asked or not; the password confirms the change. The PIN itself is kept (password reset).
  router.put('/pin-required', auth, unlocked, async (req, res) => {
    const ctx = authOf(req);
    const body = parseOrThrow(PinRequiredRequestSchema, req.body);
    const user = await findUserById(deps.db, ctx.userId);
    if (!user) throw appError(401, 'not_authenticated');
    await checkPassword(deps, user, body.password);
    const now = deps.now();
    await setPinRequired(deps.db, user.id, body.required, now);
    // Asked again: this device stays unlocked for the usual time, like after typing the code.
    const until = now + TIMINGS.parentUnlockMs;
    if (body.required) await setParentUnlockedUntil(deps.db, ctx.sessionId, until);
    res.json(await buildAuthStatus(deps, { ...ctx, pinRequired: body.required, parentUnlockedUntil: until }));
  });

  // Name of this device in « Appareils connectés » (sent by the app when it starts).
  router.put('/device', auth, async (req, res) => {
    const body = parseOrThrow(DeviceNameRequestSchema, req.body);
    await setSessionDeviceName(deps.db, authOf(req).sessionId, body.name);
    const ok: OkResponse = { ok: true };
    res.json(ok);
  });

  router.get('/sessions', auth, unlocked, async (req, res) => {
    const ctx = authOf(req);
    const response: DeviceSessionsResponse = {
      sessions: (await listUserSessions(deps.db, ctx.userId)).map((s) => toDeviceSession(s, ctx.sessionId)),
    };
    res.set('Cache-Control', 'no-store').json(response);
  });

  router.delete('/sessions/:id', auth, unlocked, async (req, res) => {
    const ctx = authOf(req);
    const id = typeof req.params.id === 'string' ? req.params.id : '';
    const target = (await listUserSessions(deps.db, ctx.userId)).find((s) => publicSessionId(s.id) === id);
    if (!target) throw appError(404, 'not_found');
    if (target.id === ctx.sessionId) throw appError(400, 'current_session');
    await deleteSession(deps.db, target.id);
    const ok: OkResponse = { ok: true };
    res.json(ok);
  });

  router.post('/sessions/revoke-others', auth, unlocked, async (req, res) => {
    const ctx = authOf(req);
    await deleteOtherSessions(deps.db, ctx.userId, ctx.sessionId);
    const ok: OkResponse = { ok: true };
    res.json(ok);
  });

  // « Mot de passe oublié »: the same answer whether the e-mail has an account or not (the e-mail leaves in the background).
  const resetIpLimiter = rateLimiter(deps, { windowMs: FIFTEEN_MINUTES, limit: 5, key: (req) => `reset-ip:${ipKey(req)}` });
  const resetEmailLimiter = rateLimiter(deps, { windowMs: HOUR, limit: 3, key: (req) => `reset-${emailKey(req)}` });
  router.post('/password-reset', resetIpLimiter, resetEmailLimiter, async (req, res) => {
    const body = parseOrThrow(PasswordResetRequestSchema, req.body);
    const mailer = mailerFor(deps);
    const publicUrl = mailer.publicUrl;
    if (!mailer.enabled || !publicUrl) throw appError(503, 'mail_unavailable');
    const user = await findUserByEmail(deps.db, body.email);
    if (user) {
      void (async () => {
        const token = await createEmailToken(deps.db, user.id, 'password_reset', deps.now(), PASSWORD_RESET_TTL_MS);
        await mailer.send(passwordResetEmail(user.email, user.displayName, `${publicUrl}${PASSWORD_RESET_PATH}?jeton=${encodeURIComponent(token)}`));
        deps.logger.info('password_reset_sent', { userId: user.id });
      })().catch((err: unknown) => deps.logger.error('password_reset_failed', { userId: user.id, error: err }));
    }
    const ok: OkResponse = { ok: true };
    res.json(ok);
  });

  // The link proves the e-mail, the code of the Réglages proves the person: both are needed. Every device is signed out.
  const resetConfirmLimiter = rateLimiter(deps, {
    windowMs: FIFTEEN_MINUTES, limit: 10, key: (req) => `reset-confirm:${ipKey(req)}`, failedOnly: true,
  });
  router.post('/password-reset/confirm', resetConfirmLimiter, async (req, res) => {
    const body = parseOrThrow(PasswordResetConfirmSchema, req.body);
    const now = deps.now();
    const userId = await findValidEmailToken(deps.db, body.token, 'password_reset', now);
    const user = userId ? await findUserById(deps.db, userId) : null;
    if (!user) throw appError(400, 'invalid_token');
    if (!user.pinHash) throw appError(409, 'pin_not_set');
    if (isLocked(user.pinLockedUntil, now)) throw appError(429, 'pin_locked');
    if (!(await verifySecret(body.pin, user.pinHash))) {
      await registerFailure(deps, user, 'pin');
      throw appError(403, 'invalid_pin');
    }
    if ((await consumeEmailToken(deps.db, body.token, 'password_reset', now)) !== user.id) throw appError(400, 'invalid_token');
    await updatePasswordHash(deps.db, user.id, await hashSecret(body.newPassword, deps.config.passwordHashRounds), now);
    await resetAttempts(deps.db, user.id, ['login', 'pin']);
    await deleteUserSessions(deps.db, user.id);
    await confirmContinuity(deps.db, user.id, now);
    deps.logger.info('password_reset_done', { userId: user.id });
    const ok: OkResponse = { ok: true };
    res.json(ok);
  });

  // Link of the e-mail sent every 180 days.
  const continuityLimiter = rateLimiter(deps, {
    windowMs: FIFTEEN_MINUTES, limit: 10, key: (req) => `continuity:${ipKey(req)}`, failedOnly: true,
  });
  router.post('/continuity/confirm', continuityLimiter, async (req, res) => {
    const body = parseOrThrow(ContinuityConfirmSchema, req.body);
    const now = deps.now();
    const userId = await consumeEmailToken(deps.db, body.token, 'continuity', now);
    if (!userId) throw appError(400, 'invalid_token');
    await confirmContinuity(deps.db, userId, now);
    const ok: OkResponse = { ok: true };
    res.json(ok);
  });

  return router;
}

