// STUB: server-platform
import type { Router } from 'express';
import type { AppDeps } from '../types';
import { notImplementedRouter } from './notImplemented';

/** Mounted by app.ts at `/api/settings`: declare paths relative to that prefix. */
export function createSettingsRouter(deps: AppDeps): Router {
  void deps;
  return notImplementedRouter();
}
