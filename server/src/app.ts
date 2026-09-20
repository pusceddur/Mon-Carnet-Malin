import { existsSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { LIMITS } from '@aide/shared';
import cookieParser from 'cookie-parser';
import express, { type Express, type RequestHandler } from 'express';
import helmet from 'helmet';
import { requireXRequestedWith } from './auth/middleware';
import { createAuthRouter } from './auth/routes';
import { appCors } from './cors';
import { errorHandler, notFound } from './errors';
import { clientDistDir } from './paths';
import { createActivityRouter } from './routes/activity';
import { createAdminRouter } from './routes/admin';
import { createAiRouter } from './routes/ai';
import { createChildrenRouter } from './routes/children';
import { createDiagnosticsRouter } from './routes/diagnostics';
import { createDictionaryRouter } from './routes/dictionary';
import { createDocumentsRouter } from './routes/documents';
import { createGlossaryRouter } from './routes/glossary';
import { createHealthRouter } from './routes/health';
import { createOcrRouter } from './routes/ocr';
import { createSettingsRouter } from './routes/settings';
import { createSyncRouter } from './routes/sync';
import { createWorkerRouter } from './routes/worker';
import type { AppDeps } from './types';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const NO_CACHE_FILES = new Set(['index.html', 'sw.js', 'registerSW.js', 'manifest.webmanifest']);
/** Routes with their own JSON parser, run after authentication: 25 MB (routes/sync.ts), 64 kB (routes/diagnostics.ts). */
const OWN_PARSER_PATHS = ['/api/sync', '/api/diagnostics'] as const;

/**
 * External worker API (§17.3): a non-browser client authenticated by a bearer token, exempt from the header check.
 * Its only cookie-authenticated route (POST /api/worker/transcriptions) checks the header itself (routes/worker.ts).
 */
const WORKER_API_PATH = /^\/worker(?:\/|$)/i;

function mutationGuard(): RequestHandler {
  const check = requireXRequestedWith();
  return (req, res, next) => (MUTATING_METHODS.has(req.method) && !WORKER_API_PATH.test(req.path) ? check(req, res, next) : next());
}

/** JSON bodies limited to 2 MB everywhere except OWN_PARSER_PATHS (413 `payload_too_large` via errorHandler). */
function jsonBodies(): RequestHandler {
  const parse = express.json({ limit: LIMITS.jsonBodyMaxBytes });
  return (req, res, next) => {
    if (OWN_PARSER_PATHS.some((path) => req.path === path || req.path.startsWith(`${path}/`))) {
      next();
      return;
    }
    parse(req, res, next);
  };
}

export function createApp(deps: AppDeps): Express {
  const { config, logger } = deps;
  const app = express();

  app.disable('x-powered-by');
  if (config.trustProxy !== false) app.set('trust proxy', config.trustProxy);

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
          // §15.6: OCR/pdf.js assets may be fetched from blob:/data: URLs inside workers.
          connectSrc: ["'self'", 'blob:', 'data:'],
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

  app.use(cookieParser());
  // §29: before the mutation guard, so that the preflight of the bundled app is answered instead of refused.
  if (config.appOrigins.length > 0) app.use('/api', appCors(config.appOrigins));
  // API: mutations require `X-Requested-With: aide` (checked before any body is read).
  app.use('/api', mutationGuard());
  app.use(jsonBodies());

  // Routers declare paths relative to their prefix.
  app.use('/api/health', createHealthRouter(deps));
  app.use('/api/auth', createAuthRouter(deps));
  app.use('/api/admin', createAdminRouter(deps));
  app.use('/api/children', createChildrenRouter(deps));
  app.use('/api/settings', createSettingsRouter(deps));
  app.use('/api/documents', createDocumentsRouter(deps));
  app.use('/api/sync', createSyncRouter(deps));
  app.use('/api/activity', createActivityRouter(deps));
  app.use('/api/glossary', createGlossaryRouter(deps));
  app.use('/api/dictionary', createDictionaryRouter(deps));
  app.use('/api/ocr', createOcrRouter(deps));
  app.use('/api/ai', createAiRouter(deps));
  app.use('/api/diagnostics', createDiagnosticsRouter(deps));
  app.use('/api/worker', createWorkerRouter(deps));
  app.use('/api', notFound);

  // Static client (PWA) + SPA fallback.
  const distDir = clientDistDir(config);
  if (distDir) {
    const indexHtml = join(distDir, 'index.html');
    app.use(
      express.static(distDir, {
        index: false,
        setHeaders: (res, filePath) => {
          const rel = relative(distDir, filePath).replace(/\\/g, '/');
          const base = rel.slice(rel.lastIndexOf('/') + 1);
          if (rel.startsWith('assets/')) {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          } else if (NO_CACHE_FILES.has(base)) {
            res.setHeader('Cache-Control', 'no-cache');
          }
          // §15.6: tesseract.js downloads *.gz itself and gunzips it; the browser must not decode it.
          if (rel.startsWith('ocr/') && base.endsWith('.gz')) {
            res.setHeader('Content-Type', 'application/octet-stream');
            res.removeHeader('Content-Encoding');
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
