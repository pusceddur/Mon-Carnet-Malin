// STUB: server-platform
import type { Router } from 'express';
import type { AppDeps } from '../types';
import { notImplementedRouter } from './notImplemented';

/** Mounted by app.ts at `/api/children`: declare paths relative to that prefix. */
export function createChildrenRouter(deps: AppDeps): Router {
  void deps;
  return notImplementedRouter();
}
