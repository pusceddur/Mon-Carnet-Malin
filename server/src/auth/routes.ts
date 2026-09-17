import {
  type AuthStatus, ChangePasswordRequestSchema, ChangePinRequestSchema, LoginRequestSchema, type OkResponse, RegisterRequestSchema,
  SetupRequestSchema, TIMINGS, UnlockRequestSchema,
} from '@aide/shared';
import { type Request, type Response, Router } from 'express';
import { isMysql } from '../db/repositories/common';
import { deleteOtherSessions, deleteSession, setParentUnlockedUntil } from '../db/repositories/sessions';
import {
  type AttemptKind, countUsers, findUserByEmail, findUserById, incrementFailedAttempts, resetAttempts, setLockedUntil,
  toParentUser, updatePasswordHash, updatePinHash, type UserRecord,
} from '../db/repositories/users';
import { appError, parseOrThrow } from '../errors';
import type { AppDeps } from '../types';
import { createParentAccount } from './createParent';
import {
  getInvitation, invitationLockedUntil, inviteCodeMatches, isInvitationUsable, registerInvitationFailure, resetInvitationFailures,
} from './invitation';
import { isLocked, lockUntilAfterFailure } from './lockout';
import { rateLimiter, requireAuth, requireParentUnlock } from './middleware';
import { dummyHash, hashSecret, timingSafeEqualString, verifySecret } from './passwords';
import { type AuthContext, clearSessionCookie, createSession, readSessionToken, hashSessionToken, resolveSession, setSessionCookie } from './sessions';

const FIFTEEN_MINUTES = 15 * 60_000;

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
  };
}

/** Registers a failure (atomic increment) and applies the progressive lock. */
async function registerFailure(deps: AppDeps, user: UserRecord, kind: AttemptKind): Promise<void> {
  const count = await incrementFailedAttempts(deps.db, user.id, kind);
  const until = lockUntilAfterFailure(count, deps.now());
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

async function startSession(deps: AppDeps, req: Request, res: Response, userId: string): Promise<AuthContext> {
  const previous = readSessionToken(req);
  if (previous) await deleteSession(deps.db, hashSessionToken(previous));
  const { token, session } = await createSession(deps.db, userId, deps.now(), req.get('user-agent') ?? null);
  setSessionCookie(res, deps.config, token);
  return { userId, sessionId: session.id, parentUnlockedUntil: null };
}

/** Mounted by app.ts at `/api/auth`: declare paths relative to that prefix. */
export function createAuthRouter(deps: AppDeps): Router {
  const router = Router();
  const auth = requireAuth(deps);
  const unlocked = requireParentUnlock(deps);

  const setupLimiter = rateLimiter(deps, { windowMs: FIFTEEN_MINUTES, limit: 10, key: () => 'setup', failedOnly: true });
  const registerLimiter = rateLimiter(deps, { windowMs: FIFTEEN_MINUTES, limit: 10, key: () => 'register', failedOnly: true });
  const loginLimiter = rateLimiter(deps, { windowMs: FIFTEEN_MINUTES, limit: 10, key: emailKey, failedOnly: true });
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
    const ctx = await startSession(deps, req, res, parent.id);
    res.json(await buildAuthStatus(deps, ctx));
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
    const ctx = await startSession(deps, req, res, parent.id);
    res.status(201).json(await buildAuthStatus(deps, ctx));
  });

  router.post('/login', loginLimiter, async (req, res) => {
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
    const ctx = await startSession(deps, req, res, user.id);
    res.json(await buildAuthStatus(deps, ctx));
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
    res.json(await buildAuthStatus(deps, { ...ctx, parentUnlockedUntil: null }));
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

  return router;
}
