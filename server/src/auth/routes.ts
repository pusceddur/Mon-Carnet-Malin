// STUB: server-platform
import type { Router } from 'express';
import type { AppDeps } from '../types';
import { notImplementedRouter } from '../routes/notImplemented';

/** Mounted by app.ts at `/api/auth`: declare paths relative to that prefix. */
export function createAuthRouter(deps: AppDeps): Router {
  void deps;
  return notImplementedRouter();
}
