import type { Request, RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import { findUserById } from '../db/repositories/users';
import { appError, ERROR_MESSAGES_FR, sendError } from '../errors';
import type { AppDeps } from '../types';
import { resolveSession } from './sessions';

/** 401 `not_authenticated` unless a valid `aide_sid` session exists; sets `req.auth` (sliding renewal). */
export function requireAuth(deps: AppDeps): RequestHandler {
  return async (req, res, next) => {
    const auth = await resolveSession(deps, req, res);
    if (!auth) {
      sendError(req, res, 401, 'not_authenticated', ERROR_MESSAGES_FR.not_authenticated);
      return;
    }
    req.auth = auth;
    next();
  };
}

/** Id of the authenticated parent (use after requireAuth). */
export function parentIdOf(req: Request): string {
  if (!req.auth) throw appError(401, 'not_authenticated');
  return req.auth.userId;
}

/** 403 `parent_locked` unless `req.auth.parentUnlockedUntil > now`. Use after requireAuth. */
export function requireParentUnlock(deps: AppDeps): RequestHandler {
  return (req, res, next) => {
    const until = req.auth?.parentUnlockedUntil ?? null;
    if (until !== null && until > deps.now()) {
      next();
      return;
    }
    sendError(req, res, 403, 'parent_locked', ERROR_MESSAGES_FR.parent_locked);
  };
}

/** 403 `forbidden` unless the authenticated parent is the owner account. Use after requireAuth. */
export function requireOwner(deps: AppDeps): RequestHandler {
  return async (req, res, next) => {
    const user = req.auth ? await findUserById(deps.db, req.auth.userId) : null;
    if (user?.isOwner) {
      next();
      return;
    }
    sendError(req, res, 403, 'forbidden', ERROR_MESSAGES_FR.forbidden);
  };
}

/** 403 unless header `X-Requested-With: aide`. app.ts applies it to mutating /api requests only. */
export function requireXRequestedWith(): RequestHandler {
  return (req, res, next) => {
    if (req.get('x-requested-with') === 'aide') {
      next();
      return;
    }
    sendError(req, res, 403, 'forbidden', ERROR_MESSAGES_FR.forbidden);
  };
}

export interface LimiterOptions {
  windowMs: number;
  limit: number;
  /** Rate-limit key; requests are grouped per returned string. */
  key: (req: Parameters<RequestHandler>[0]) => string;
  /** Count only failed requests (status >= 400). */
  failedOnly?: boolean;
}

/** In-memory rate limiter answering 429 `rate_limited` (no-op when deps.disableRateLimits). */
export function rateLimiter(deps: AppDeps, opts: LimiterOptions): RequestHandler {
  if (deps.disableRateLimits) return (_req, _res, next) => next();
  return rateLimit({
    windowMs: opts.windowMs,
    limit: opts.limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skipSuccessfulRequests: opts.failedOnly ?? false,
    // Keys are e-mails or session ids, never raw IPs; the built-in checks would only log to the console.
    validate: false,
    keyGenerator: (req) => opts.key(req),
    handler: (req, res) => {
      sendError(req, res, 429, 'rate_limited', ERROR_MESSAGES_FR.rate_limited);
    },
  });
}
