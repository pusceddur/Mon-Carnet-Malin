// Applies pending database migrations (static migration source, works in the bundled migrate.cjs).
import { loadConfig, loadEnvFileIfPresent } from '../src/config';
import { createDb, runMigrations } from '../src/db/knex';
import { createLogger } from '../src/logger';

async function main(): Promise<void> {
  loadEnvFileIfPresent();
  const config = loadConfig(process.env);
  const logger = createLogger({ level: config.logLevel === 'silent' ? 'info' : config.logLevel });
  const db = createDb(config.databaseUrl);
  try {
    const applied = await runMigrations(db);
    logger.info('migrations_done', { applied });
  } finally {
    await db.destroy();
  }
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(JSON.stringify({ level: 'error', msg: 'migrate_failed', error: message }) + '\n');
  process.exitCode = 1;
});
