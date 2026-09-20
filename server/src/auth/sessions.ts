import { createHash, randomBytes } from 'node:crypto';
import { TIMINGS } from '@aide/shared';
import type { CookieOptions, Request, Response } from 'express';
import type { AppConfig } from '../config';
import type { Db } from '../db/repositories/common';
import {
  deleteSession, findSession, insertSession, renewSession, type SessionRecord,
} from '../db/repositories/sessions';

export const SESSION_COOKIE = 'aide_sid';
/** Sliding renewal is written at most once per hour per session. */
export const SESSION_RENEW_AFTER_MS = 60 * 60_000;

/**
 * `parentUnlockedUntil`: end of the unlocked adult area; when the account does not ask for the code (§20 `pinRequired`
 * false) it is always « now + unlock duration ».
 */
export interface AuthContext { userId: string; sessionId: string; parentUnlockedUntil: number | null; pinRequired: boolean }

/** Random 32-byte token (base64url) and its sha256, which is the only value stored. */
export function newSessionToken(): { token: string; id: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, id: hashSessionToken(token) };
}

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function sessionCookieOptions(config: AppConfig): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProduction,
    path: '/',
    maxAge: TIMINGS.sessionTtlMs,
  };
}

export function setSessionCookie(res: Response, config: AppConfig, token: string): void {
  res.cookie(SESSION_COOKIE, token, sessionCookieOptions(config));
}

export function clearSessionCookie(res: Response, config: AppConfig): void {
  const { maxAge: _maxAge, ...options } = sessionCookieOptions(config);
  res.clearCookie(SESSION_COOKIE, options);
}

/** Session token of `Authorization: Bearer …` (§29: the bundled app has no cookie jar), or null. */
function readBearerToken(req: Request): string | null {
  const match = /^Bearer ([A-Za-z0-9._~+/=-]{1,128})$/.exec(req.get('authorization') ?? '');
  return match?.[1] ?? null;
}

/** Session token of the request: the `aide_sid` cookie (browser), else a bearer token (native app). */
export function readSessionToken(req: Request): string | null {
  const cookies = req.cookies as Record<string, unknown> | undefined;
  const value = cookies?.[SESSION_COOKIE];
  if (typeof value === 'string' && value.length > 0 && value.length <= 128) return value;
  return readBearerToken(req);
}

/** True when the caller keeps the session token itself instead of a cookie (bundled app). */
export function wantsSessionToken(req: Request): boolean {
  return req.get('x-aide-client') === 'native';
}

export async function createSession(
  db: Db, userId: string, now: number, userAgent: string | null, ip: string | null = null,
): Promise<{ token: string; session: SessionRecord }> {
  const { token, id } = newSessionToken();
  const session: SessionRecord = {
    id,
    userId,
    createdAt: now,
    expiresAt: now + TIMINGS.sessionTtlMs,
    lastSeenAt: now,
    parentUnlockedUntil: null,
    userAgent,
    ip,
    deviceName: null,
  };
  await insertSession(db, session);
  return { token, session };
}

/**
 * Resolves the session of the request cookie. Expired or unknown sessions clear the cookie.
 * Valid sessions are renewed (sliding expiry) when last seen more than an hour ago.
 */
export async function resolveSession(
  deps: { db: Db; config: AppConfig; now(): number },
  req: Request,
  res: Response,
): Promise<AuthContext | null> {
  const token = readSessionToken(req);
  if (!token) return null;
  const now = deps.now();
  const id = hashSessionToken(token);
  const session = await findSession(deps.db, id);
  if (!session || session.expiresAt <= now) {
    if (session) await deleteSession(deps.db, id);
    clearSessionCookie(res, deps.config);
    return null;
  }
  if (now - session.lastSeenAt >= SESSION_RENEW_AFTER_MS) {
    await renewSession(deps.db, id, now, now + TIMINGS.sessionTtlMs, req.ip ?? null);
    setSessionCookie(res, deps.config, token);
  }
  const unlocked = !session.pinRequired
    ? now + TIMINGS.parentUnlockMs
    : session.parentUnlockedUntil !== null && session.parentUnlockedUntil > now ? session.parentUnlockedUntil : null;
  return { userId: session.userId, sessionId: session.id, parentUnlockedUntil: unlocked, pinRequired: session.pinRequired };
}
