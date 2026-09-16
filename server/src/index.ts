import { createApp } from './app';
import { loadConfig, loadEnvFileIfPresent } from './config';
import { createDb, runMigrations } from './db/knex';
import { createLogger } from './logger';

async function main(): Promise<void> {
  loadEnvFileIfPresent();
  const config = loadConfig(process.env);
  const logger = createLogger({ level: config.logLevel });
  const db = createDb(config.databaseUrl);

  const applied = await runMigrations(db);
  if (applied.length > 0) logger.info('migrations_applied', { migrations: applied });

  const app = createApp({ config, db, logger, now: () => Date.now() });
  const server = app.listen(config.port, () => {
    logger.info('server_listening', { port: config.port, env: config.nodeEnv });
  });

  let closing = false;
  const shutdown = (signal: string): void => {
    if (closing) return;
    closing = true;
    logger.info('server_shutdown', { signal });
    server.close(() => {
      db.destroy().finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(JSON.stringify({ time: new Date().toISOString(), level: 'error', msg: 'startup_failed', error: message }) + '\n');
  process.exit(1);
});
