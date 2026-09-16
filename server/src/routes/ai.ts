// STUB: server-ai
import type { Router } from 'express';
import type { AppDeps } from '../types';
import { notImplementedRouter } from './notImplemented';

/** Mounted by app.ts at `/api/ai`: declare paths relative to that prefix. */
export function createAiRouter(deps: AppDeps): Router {
  void deps;
  return notImplementedRouter();
}
