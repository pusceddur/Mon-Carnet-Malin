import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import knexFactory, { type Knex } from 'knex';
import * as m001 from './migrations/001_initial';
import * as m002 from './migrations/002_invitations';
import * as m003 from './migrations/003_client_diagnostics';
import * as m004 from './migrations/004_worker_jobs';
import * as m005 from './migrations/005_free_questions';
import * as m006 from './migrations/006_document_text_mode';
import * as m007 from './migrations/007_homework';
import * as m008 from './migrations/008_account_security';
import * as m009 from './migrations/009_worker_usage';
import * as m010 from './migrations/010_writing_corrections';
import * as m011 from './migrations/011_account_deletion';
import * as m012 from './migrations/012_reader_nickname';

// Migrations are imported statically (no filesystem loader) so they work inside the esbuild bundle.
const MIGRATIONS: ReadonlyArray<readonly [string, Knex.Migration]> = [
  ['001_initial', { up: m001.up, down: m001.down }],
  ['002_invitations', { up: m002.up, down: m002.down }],
  ['003_client_diagnostics', { up: m003.up, down: m003.down }],
  ['004_worker_jobs', { up: m004.up, down: m004.down }],
  ['005_free_questions', { up: m005.up, down: m005.down }],
  ['006_document_text_mode', { up: m006.up, down: m006.down }],
  ['007_homework', { up: m007.up, down: m007.down }],
  ['008_account_security', { up: m008.up, down: m008.down }],
  ['009_worker_usage', { up: m009.up, down: m009.down }],
  ['010_writing_corrections', { up: m010.up, down: m010.down }],
  ['011_account_deletion', { up: m011.up, down: m011.down }],
  ['012_reader_nickname', { up: m012.up, down: m012.down }],
];

/** Names of the bundled migrations, in order. */
export const MIGRATION_NAMES: readonly string[] = MIGRATIONS.map(([name]) => name);

class StaticMigrationSource implements Knex.MigrationSource<string> {
  getMigrations(): Promise<string[]> {
    return Promise.resolve(MIGRATIONS.map(([name]) => name));
  }
  getMigrationName(migration: string): string {
    return migration;
  }
  getMigration(migration: string): Promise<Knex.Migration> {
    const found = MIGRATIONS.find(([name]) => name === migration);
    if (!found) return Promise.reject(new Error(`Unknown migration ${migration}`));
    return Promise.resolve(found[1]);
  }
}

export const migrationSource: Knex.MigrationSource<string> = new StaticMigrationSource();

export type DbClient = 'mysql2' | 'better-sqlite3';

export function dbClientOf(db: Knex): DbClient {
  return db.client.config.client === 'mysql2' ? 'mysql2' : 'better-sqlite3';
}

interface SqliteConnection { pragma(source: string): unknown }

/**
 * DATABASE_URL: `mysql://user:pass@host:3306/db` (production), `sqlite:./data/dev.sqlite` or `sqlite::memory:`.
 */
export function createDb(databaseUrl: string): Knex {
  if (databaseUrl.startsWith('sqlite:')) {
    const raw = databaseUrl.slice('sqlite:'.length);
    const filename = raw === ':memory:' || raw === '' ? ':memory:' : resolve(process.cwd(), raw);
    if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true });
    return knexFactory({
      client: 'better-sqlite3',
      connection: { filename },
      useNullAsDefault: true,
      // One connection: required for :memory: and avoids SQLITE_BUSY in dev.
      pool: {
        min: 1,
        max: 1,
        afterCreate: (conn: SqliteConnection, done: (err: Error | null, conn: SqliteConnection) => void) => {
          try {
            conn.pragma('foreign_keys = ON');
            conn.pragma('journal_mode = WAL');
            done(null, conn);
          } catch (err) {
            done(err as Error, conn);
          }
        },
      },
    });
  }

  if (/^mysql2?:\/\//.test(databaseUrl)) {
    const url = new URL(databaseUrl.replace(/^mysql2:/, 'mysql:'));
    return knexFactory({
      client: 'mysql2',
      connection: {
        host: url.hostname,
        port: url.port ? Number(url.port) : 3306,
        user: decodeURIComponent(url.username),
        password: decodeURIComponent(url.password),
        database: decodeURIComponent(url.pathname.replace(/^\//, '')),
        charset: 'utf8mb4',
        timezone: 'Z',
        supportBigNumbers: true,
        bigNumberStrings: false,
        decimalNumbers: true,
      },
      pool: { min: 0, max: 5 },
    });
  }

  throw new Error('Unsupported DATABASE_URL (expected mysql:// or sqlite:)');
}

export async function runMigrations(db: Knex): Promise<string[]> {
  const [, applied] = (await db.migrate.latest({ migrationSource })) as [number, string[]];
  return applied;
}

export async function pingDb(db: Knex): Promise<boolean> {
  try {
    await db.raw('select 1');
    return true;
  } catch {
    return false;
  }
}
