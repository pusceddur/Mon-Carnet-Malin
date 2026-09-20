// §29 CORS for the bundled native app. The browser app is served by this server and is same-origin: it needs none, so
// APP_ORIGINS is empty by default and nothing changes. The app bundles its own copy of the web app, so its requests
// come from another origin (`capacitor://localhost`) and the browser asks first.
import type { RequestHandler } from 'express';

/** Headers the app sends: bearer session token, JSON bodies, the mutation guard and the native marker. */
const ALLOWED_HEADERS = 'Authorization, Content-Type, Accept, X-Requested-With, X-Aide-Client';
const ALLOWED_METHODS = 'GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS';
/** Preflight answers are reused for 10 minutes. */
const MAX_AGE_SECONDS = 600;

/**
 * Answers the preflight and marks the response for the listed origins only.
 * Credentials are never allowed: the app authenticates with a bearer token, never with a cookie, so a hostile page
 * cannot make an authenticated request from a browser that happens to hold the session cookie.
 */
export function appCors(origins: readonly string[]): RequestHandler {
  const allowed = new Set(origins);
  return (req, res, next) => {
    const origin = req.get('origin');
    if (origin === undefined || !allowed.has(origin)) {
      // Unknown origin: no CORS headers, so the browser refuses to show the answer. A preflight is still ended here
      // rather than handed to the routers, which would answer 404 for a method they do not declare.
      if (req.method === 'OPTIONS' && req.get('access-control-request-method') !== undefined) {
        res.status(403).end();
        return;
      }
      next();
      return;
    }
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', ALLOWED_HEADERS);
    res.setHeader('Access-Control-Allow-Methods', ALLOWED_METHODS);
    res.setHeader('Access-Control-Max-Age', String(MAX_AGE_SECONDS));
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  };
}
