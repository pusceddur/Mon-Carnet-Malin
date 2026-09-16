import type { Knex } from 'knex';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { loadConfig } from '../../src/config';
import { createDb, runMigrations } from '../../src/db/knex';
import { INITIAL_TABLES } from '../../src/db/migrations/001_initial';
import { silentLogger } from '../../src/logger';

describe('foundations: app + sqlite migrations', () => {
  let db: Knex;
  let app: ReturnType<typeof createApp>;

  beforeAll(async () => {
    const config = loadConfig({ NODE_ENV: 'test', DATABASE_URL: 'sqlite::memory:', CLIENT_DIST_DIR: './__no_client_dist__' });
    db = createDb(config.databaseUrl);
    await runMigrations(db);
    app = createApp({ config, db, logger: silentLogger, now: () => Date.now() });
  });

  afterAll(async () => {
    await db.destroy();
  });

  it('creates every table of migration 001 and is idempotent', async () => {
    for (const table of INITIAL_TABLES) {
      expect(await db.schema.hasTable(table), table).toBe(true);
    }
    expect(await runMigrations(db)).toEqual([]);
  });

  it('GET /api/health answers ok with db ping', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, db: true, ai: { light: false, complex: false } });
    expect(res.headers['content-security-policy']).toContain("'wasm-unsafe-eval'");
  });

  it('unknown /api route answers JSON 404', async () => {
    const res = await request(app).get('/api/nope');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('not_found');
  });

  it('mutations without X-Requested-With are rejected', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'a@b.fr', password: 'x' });
    expect(res.status).toBe(403);
    const ok = await request(app).post('/api/auth/login').set('X-Requested-With', 'aide').send({});
    expect(ok.status).toBe(501);
    expect(ok.body.error.code).toBe('not_implemented');
  });
});
