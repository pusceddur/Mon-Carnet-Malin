// STUB: server-platform
import type { RequestHandler } from 'express';
import { ERROR_MESSAGES_FR, errorBody } from '../errors';
import type { AppDeps } from '../types';

/** 401 `not_authenticated` unless a valid `aide_sid` session exists; sets `req.auth`. */
export function requireAuth(deps: AppDeps): RequestHandler {
  void deps;
  return (_req, res) => {
    res.status(401).json(errorBody('not_authenticated', ERROR_MESSAGES_FR.not_authenticated));
  };
}

/** 403 `parent_locked` unless `req.auth.parentUnlockedUntil > now`. Use after requireAuth. */
export function requireParentUnlock(deps: AppDeps): RequestHandler {
  return (req, res, next) => {
    const until = req.auth?.parentUnlockedUntil ?? null;
    if (until !== null && until > deps.now()) {
      next();
      return;
    }
    res.status(403).json(errorBody('parent_locked', ERROR_MESSAGES_FR.parent_locked));
  };
}

/** 403 unless header `X-Requested-With: aide`. app.ts applies it to mutating /api requests only. */
export function requireXRequestedWith(): RequestHandler {
  return (req, res, next) => {
    if (req.get('x-requested-with') === 'aide') {
      next();
      return;
    }
    res.status(403).json(errorBody('forbidden', ERROR_MESSAGES_FR.forbidden));
  };
}
