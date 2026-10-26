import type { Knex } from 'knex';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { loadConfig } from '../../src/config';
import { createDb, runMigrations } from '../../src/db/knex';
import { silentLogger } from '../../src/logger';

async function appWith(env: Record<string, string>): Promise<{ app: ReturnType<typeof createApp>; db: Knex }> {
  const config = loadConfig({ NODE_ENV: 'test', DATABASE_URL: 'sqlite::memory:', CLIENT_DIST_DIR: './__no_client_dist__', ...env });
  const db = createDb(config.databaseUrl);
  await runMigrations(db);
  return { app: createApp({ config, db, logger: silentLogger, now: () => Date.now() }), db };
}

describe('privacy policy page', () => {
  let filled: Awaited<ReturnType<typeof appWith>>;
  let empty: Awaited<ReturnType<typeof appWith>>;

  beforeAll(async () => {
    filled = await appWith({
      LEGAL_OPERATOR: 'Famille <Exemple>',
      LEGAL_CONTACT: 'vie-privee@example.fr',
      LEGAL_HOSTING: 'Hébergeur, France',
      LEGAL_AI_PROVIDERS: 'Service A (France); Service B (États-Unis)',
    });
    empty = await appWith({});
  });

  afterAll(async () => {
    await filled.db.destroy();
    await empty.db.destroy();
  });

  it('is public HTML, without an account', async () => {
    const res = await request(filled.app).get('/confidentialite');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.text).toContain('Politique de confidentialité');
  });

  it('shows the operator, escaped, and every AI service', async () => {
    const res = await request(filled.app).get('/confidentialite');
    expect(res.text).toContain('Famille &lt;Exemple&gt;');
    expect(res.text).not.toContain('Famille <Exemple>');
    expect(res.text).toContain('mailto:vie-privee@example.fr');
    expect(res.text).toContain('<li>Service A (France)</li>');
    expect(res.text).toContain('<li>Service B (États-Unis)</li>');
    expect(res.text).not.toContain('à compléter');
  });

  it('marks what the operator has not filled in, instead of leaving it out', async () => {
    const res = await request(empty.app).get('/confidentialite');
    expect(res.status).toBe(200);
    expect(res.text).toContain('<mark>[à compléter par l’exploitant]</mark>');
  });
});
