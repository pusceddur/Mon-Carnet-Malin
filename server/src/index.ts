import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { peekAIServices } from './ai/services';
import { createApp } from './app';
import { loadConfig, loadEnvFileIfPresent } from './config';
import { createDb, runMigrations } from './db/knex';
import { ERROR_MESSAGES_FR, errorBody } from './errors';
import { createLogger } from './logger';
import { startMaintenance } from './maintenance/retention';
import { peekSharedServerOcr } from './ocr/instance';
import { uploadsDir } from './paths';
import { peekWorkerRuntime } from './worker/runtime';

type Handler = (req: IncomingMessage, res: ServerResponse) => void;

/** Until migrations are done, /api answers 503 (static files are already served). */
function startupGate(app: Handler, isReady: () => boolean): Handler {
  return (req, res) => {
    if (isReady() || !(req.url ?? '').startsWith('/api/')) {
      app(req, res);
      return;
    }
    let answered = false;
    const answer = (): void => {
      if (answered || res.headersSent) return;
      answered = true;
      res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8', 'Retry-After': '5', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(errorBody('server_starting', ERROR_MESSAGES_FR.server_starting)));
    };
    if (req.complete) answer();
    else req.on('end', answer).on('error', answer).resume();
  };
}

function main(): void {
  loadEnvFileIfPresent();
  const config = loadConfig(process.env);
  const logger = createLogger({ level: config.logLevel });
  const db = createDb(config.databaseUrl);
  const now = (): number => Date.now();
  const deps = { config, db, logger, now };
  const app = createApp(deps);

  let ready = false;
  let closing = false;
  let stopMaintenance: (() => void) | null = null;
  // §15.9: listen first (the host expects the port quickly); heavy initialisation follows.
  const server = createServer(startupGate(app, () => ready));
  server.listen(config.port, () => {
    logger.info('server_listening', { port: config.port, env: config.nodeEnv });
  });

  const migrate = (attempt: number): void => {
    runMigrations(db)
      .then((applied) => {
        if (applied.length > 0) logger.info('migrations_applied', { migrations: applied });
        ready = true;
        stopMaintenance = startMaintenance({ db, now, uploadsRoot: uploadsDir(config), logger });
      })
      .catch((err: unknown) => {
        // The database may still be starting: retry with a capped backoff while /api answers 503.
        logger.error('migrations_failed', { error: err, attempt });
        if (!closing) setTimeout(() => migrate(attempt + 1), Math.min(60_000, 5_000 * attempt)).unref();
      });
  };
  migrate(1);

  const shutdown = (signal: string): void => {
    if (closing) return;
    closing = true;
    logger.info('server_shutdown', { signal });
    stopMaintenance?.();
    // Worker long polls answer at once and requests waiting for the worker give up (their jobs are marked expired),
    // so that the AI jobs below settle quickly; the timer still bounds the whole shutdown.
    peekWorkerRuntime(deps)?.close();
    server.close(() => {
      // Let AI jobs already accepted finish and stop the OCR worker; the timer below still bounds the wait.
      const pendingAi = peekAIServices(deps)?.then((services) => services.router.idle());
      void Promise.allSettled([pendingAi, peekSharedServerOcr()?.shutdown()])
        .then(() => db.destroy())
        .finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

try {
  main();
} catch (err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(JSON.stringify({ time: new Date().toISOString(), level: 'error', msg: 'startup_failed', error: message }) + '\n');
  process.exit(1);
}
