import { Router } from 'express';
import type { HealthStatus } from '@aide/shared';
import type { Knex } from 'knex';
import { aiHealth } from '../ai/status';
import { pingDb } from '../db/knex';
import { rawRows } from '../db/repositories/common';
import { ocrHealth } from '../ocr/status';
import type { AppDeps } from '../types';

/** 4-byte UTF-8 (emoji) + French accents: detects a connection that is not utf8mb4 (§15.3). */
export const UTF8_PROBE = 'Élève 📚 œ';

export async function utf8RoundTrip(db: Knex): Promise<boolean> {
  try {
    const rows = rawRows(await db.raw('select ? as probe', [UTF8_PROBE]));
    return rows[0]?.probe === UTF8_PROBE;
  } catch {
    return false;
  }
}

/** Mounted by app.ts at `/api/health`. */
export function createHealthRouter(deps: AppDeps): Router {
  const router = Router();
  router.get('/', async (_req, res) => {
    const db = (await pingDb(deps.db)) && (await utf8RoundTrip(deps.db));
    const body: HealthStatus = { ok: true, db, ai: await aiHealth(deps), ocr: ocrHealth() };
    res.set('Cache-Control', 'no-store').json(body);
  });
  return router;
}
