import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import knexFactory, { type Knex } from 'knex';
import * as m001 from './migrations/001_initial';

// Migrations are imported statically (no filesystem loader) so they work inside the esbuild bundle.
const MIGRATIONS: ReadonlyArray<readonly [string, Knex.Migration]> = [
  ['001_initial', { up: m001.up, down: m001.down }],
];

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
