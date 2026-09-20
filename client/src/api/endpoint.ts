// §29 Where the API lives, and how this client proves who it is.
//
// Browser: the server also serves the web app, so paths stay relative and the httpOnly `aide_sid` cookie does the work.
// Bundled native app: the web app lives inside the app, so every call crosses an origin. A cookie would never be sent,
// and asking for one would mean allowing credentials across origins; the session token travels in an Authorization
// header instead, which also leaves no CSRF surface at all.
import { isNativeApp } from '../platform/nativeApp';

/** Address of the server, set at build time for the native app (empty in the browser: same origin). */
const CONFIGURED_BASE = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/+$/, '');

/**
 * Where the session token of the app is kept between launches. `localStorage` is private to the app on iOS (its own
 * WKWebView data store, no other app or site can read it) and the token can be revoked from « Appareils connectés ».
 */
const STORAGE_KEY = 'aide.sessionToken';

/** Tells the server this client keeps the session token itself instead of a cookie. */
export const NATIVE_CLIENT_HEADER = { 'X-Aide-Client': 'native' } as const;

/** Base address of the API: empty in the browser, the configured server inside the app. */
export function apiBaseUrl(): string {
  return isNativeApp() ? CONFIGURED_BASE : '';
}

/** Absolute URL of an API path inside the app, the path itself in the browser. */
export function apiUrl(path: string): string {
  const base = apiBaseUrl();
  return base === '' ? path : `${base}${path}`;
}

let cached: string | null | undefined;

/** Session token of the app, or null (always null in the browser: the cookie holds it). */
export function sessionToken(): string | null {
  if (cached !== undefined) return cached;
  try {
    cached = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    // Storage refused (private mode, disabled): the session then lasts only as long as the app stays open.
    cached = null;
  }
  return cached;
}

/** Keeps the token of a session that just opened, or forgets it on sign-out. Never called in the browser. */
export function setSessionToken(token: string | null): void {
  cached = token;
  try {
    if (token === null) window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, token);
  } catch {
    // Kept in memory for this run.
  }
}

/** Headers that prove who this client is: nothing in the browser (the cookie travels on its own), the token in the app. */
export function authHeaders(): Record<string, string> {
  if (!isNativeApp()) return {};
  const token = sessionToken();
  return token === null ? { ...NATIVE_CLIENT_HEADER } : { ...NATIVE_CLIENT_HEADER, Authorization: `Bearer ${token}` };
}

/**
 * Cookie policy of a request. The app must not ask for credentials across origins: the server never allows them, and
 * the browser would refuse the whole answer.
 */
export function credentialsMode(): RequestCredentials {
  return isNativeApp() ? 'omit' : 'include';
}
