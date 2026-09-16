// STUB: server-dict-ocr
import type { Router } from 'express';
import type { AppDeps } from '../types';
import { notImplementedRouter } from './notImplemented';

/** Mounted by app.ts at `/api/ocr`: declare paths relative to that prefix. */
export function createOcrRouter(deps: AppDeps): Router {
  void deps;
  return notImplementedRouter();
}
