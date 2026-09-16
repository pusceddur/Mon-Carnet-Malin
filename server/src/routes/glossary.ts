// STUB: server-platform
import type { Router } from 'express';
import type { AppDeps } from '../types';
import { notImplementedRouter } from './notImplemented';

/** Mounted by app.ts at `/api/glossary`: declare paths relative to that prefix. */
export function createGlossaryRouter(deps: AppDeps): Router {
  void deps;
  return notImplementedRouter();
}
