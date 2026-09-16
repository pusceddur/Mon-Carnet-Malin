import { existsSync } from 'node:fs';
import { extname, join } from 'node:path';
import cookieParser from 'cookie-parser';
import express, { type Express, type RequestHandler } from 'express';
import helmet from 'helmet';
import { requireXRequestedWith } from './auth/middleware';
import { createAuthRouter } from './auth/routes';
import { errorHandler, notFound } from './errors';
import { clientDistDir } from './paths';
import { createActivityRouter } from './routes/activity';
import { createAiRouter } from './routes/ai';
import { createChildrenRouter } from './routes/children';
import { createDictionaryRouter } from './routes/dictionary';
import { createDocumentsRouter } from './routes/documents';
import { createGlossaryRouter } from './routes/glossary';
import { createHealthRouter } from './routes/health';
import { createOcrRouter } from './routes/ocr';
import { createSettingsRouter } from './routes/settings';
import { createSyncRouter } from './routes/sync';
import type { AppDeps } from './types';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const NO_CACHE_FILES = new Set(['index.html', 'sw.js', 'registerSW.js', 'manifest.webmanifest']);

function mutationGuard(): RequestHandler {
  const check = requireXRequestedWith();
  return (req, res, next) => (MUTATING_METHODS.has(req.method) ? check(req, res, next) : next());
}

export function createApp(deps: AppDeps): Express {
  const { config, logger } = deps;
  const app = express();

  app.disable('x-powered-by');
  if (config.isProduction) app.set('trust proxy', 1);

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'wasm-unsafe-eval'"],
          workerSrc: ["'self'", 'blob:'],
          imgSrc: ["'self'", 'blob:', 'data:'],
          mediaSrc: ["'self'", 'blob:'],
          connectSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          fontSrc: ["'self'", 'data:'],
          manifestSrc: ["'self'"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          frameAncestors: ["'none'"],
          ...(config.isProduction ? { upgradeInsecureRequests: [] } : {}),
        },
      },
      // HSTS only behind HTTPS in production (dev runs on plain HTTP in the LAN).
      strictTransportSecurity: config.isProduction,
    }),
  );

  app.use(express.json({ limit: '20mb' }));
  app.use(cookieParser());

  // API: mutations require `X-Requested-With: aide`. Routers declare paths relative to their prefix.
  app.use('/api', mutationGuard());
  app.use('/api/health', createHealthRouter(deps));
  app.use('/api/auth', createAuthRouter(deps));
  app.use('/api/children', createChildrenRouter(deps));
  app.use('/api/settings', createSettingsRouter(deps));
  app.use('/api/documents', createDocumentsRouter(deps));
  app.use('/api/sync', createSyncRouter(deps));
  app.use('/api/activity', createActivityRouter(deps));
  app.use('/api/glossary', createGlossaryRouter(deps));
  app.use('/api/dictionary', createDictionaryRouter(deps));
  app.use('/api/ocr', createOcrRouter(deps));
  app.use('/api/ai', createAiRouter(deps));
  app.use('/api', notFound);

  // Static client (PWA) + SPA fallback.
  const distDir = clientDistDir(config);
  if (distDir) {
    const indexHtml = join(distDir, 'index.html');
    app.use(
      express.static(distDir, {
        index: false,
        setHeaders: (res, filePath) => {
          const normalized = filePath.replace(/\\/g, '/');
          const base = normalized.slice(normalized.lastIndexOf('/') + 1);
          if (normalized.includes('/assets/')) {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          } else if (NO_CACHE_FILES.has(base)) {
            res.setHeader('Cache-Control', 'no-cache');
          }
        },
      }),
    );
    app.use((req, res, next) => {
      if ((req.method !== 'GET' && req.method !== 'HEAD') || extname(req.path) !== '' || !existsSync(indexHtml)) {
        next();
        return;
      }
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(indexHtml);
    });
  } else {
    logger.warn('client_dist_not_found');
  }

  app.use(notFound);
  app.use(errorHandler(logger));
  return app;
}
