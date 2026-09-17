// Feature detection and small platform helpers (iPadOS / Safari 18+ target, contract §15.6).
// Every probe accepts an injectable environment so it can be tested without a real browser.
import { isNativeApp } from './nativeApp';

export interface BrowserSupport {
  /** false when at least one required feature is missing. */
  supported: boolean;
  /** Required features that are missing (technical names, shown only in « Détails techniques »). */
  missing: string[];
  /** Optional features that are missing (the app degrades gracefully). */
  optionalMissing: string[];
}

export interface SupportProbeTarget {
  WebAssembly?: unknown;
  indexedDB?: unknown;
  PointerEvent?: unknown;
  Worker?: unknown;
  Intl?: unknown;
}

export const FEATURE_WEBASSEMBLY = 'WebAssembly';
export const FEATURE_INDEXEDDB = 'IndexedDB';
export const FEATURE_POINTER_EVENTS = 'PointerEvent';
export const FEATURE_MODULE_WORKER = 'Worker (module)';
export const FEATURE_INTL_SEGMENTER = 'Intl.Segmenter';

// Smallest valid module: "\0asm" magic + version 1.
const WASM_HEADER = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00];

function safeProbe(probe: () => boolean): boolean {
  try {
    return probe();
  } catch {
    return false;
  }
}

/** WebAssembly is missing in iPadOS Lockdown Mode (« mode Isolement »). */
export function hasWebAssembly(target: SupportProbeTarget = globalThis): boolean {
  return safeProbe(() => {
    const wasm = target.WebAssembly as { validate?: unknown; instantiate?: unknown } | undefined;
    if (typeof wasm !== 'object' || wasm === null) return false;
    if (typeof wasm.instantiate !== 'function' || typeof wasm.validate !== 'function') return false;
    return (wasm.validate as (bytes: Uint8Array) => boolean)(new Uint8Array(WASM_HEADER)) === true;
  });
}

export function hasIndexedDB(target: SupportProbeTarget = globalThis): boolean {
  // Reading `indexedDB` can throw a SecurityError when storage is blocked.
  return safeProbe(() => {
    const idb = target.indexedDB as { open?: unknown } | null | undefined;
    return typeof idb === 'object' && idb !== null && typeof idb.open === 'function';
  });
}

export function hasPointerEvents(target: SupportProbeTarget = globalThis): boolean {
  return safeProbe(() => typeof target.PointerEvent === 'function');
}

/**
 * Detects `new Worker(url, { type: 'module' })` without starting a worker: engines that know the `type` option read it
 * while converting the options dictionary, before the (deliberately invalid) URL is parsed and rejected.
 */
export function hasModuleWorker(target: SupportProbeTarget = globalThis): boolean {
  return safeProbe(() => {
    const WorkerCtor = target.Worker as (new (url: string, options: WorkerOptions) => { terminate?: () => void }) | undefined;
    if (typeof WorkerCtor !== 'function') return false;
    let typeRead = false;
    const options = {
      get type(): WorkerType {
        typeRead = true;
        return 'module';
      },
    };
    try {
      new WorkerCtor('http://[', options).terminate?.();
    } catch {
      // Expected: the URL is invalid.
    }
    return typeRead;
  });
}

export function hasIntlSegmenter(target: SupportProbeTarget = globalThis): boolean {
  return safeProbe(() => {
    const intl = target.Intl as { Segmenter?: unknown } | undefined;
    return typeof intl === 'object' && intl !== null && typeof intl.Segmenter === 'function';
  });
}

/** Required: WebAssembly, IndexedDB, PointerEvent, module Worker. Optional (non-blocking): Intl.Segmenter. */
export function checkBrowserSupport(target: SupportProbeTarget = globalThis): BrowserSupport {
  const missing: string[] = [];
  if (!hasWebAssembly(target)) missing.push(FEATURE_WEBASSEMBLY);
  if (!hasIndexedDB(target)) missing.push(FEATURE_INDEXEDDB);
  if (!hasPointerEvents(target)) missing.push(FEATURE_POINTER_EVENTS);
  if (!hasModuleWorker(target)) missing.push(FEATURE_MODULE_WORKER);
  const optionalMissing: string[] = [];
  if (!hasIntlSegmenter(target)) optionalMissing.push(FEATURE_INTL_SEGMENTER);
  return { supported: missing.length === 0, missing, optionalMissing };
}

export interface NavigatorLike {
  userAgent?: string;
  platform?: string;
  maxTouchPoints?: number;
}

function currentNavigator(): Navigator | undefined {
  return typeof navigator === 'undefined' ? undefined : navigator;
}

/** True on iPad, including iPadOS in desktop mode (Safari reports « Macintosh » but has a multi-touch screen). */
export function isIPad(nav: NavigatorLike | undefined = currentNavigator()): boolean {
  if (!nav) return false;
  const ua = nav.userAgent ?? '';
  if (/\biPad\b/.test(ua)) return true;
  const multiTouch = (nav.maxTouchPoints ?? 0) > 1;
  return multiTouch && (/\bMacintosh\b/.test(ua) || nav.platform === 'MacIntel');
}

export interface StandaloneEnv {
  navigator?: { standalone?: boolean };
  matchMedia?: (query: string) => { matches: boolean };
}

/** True when the app runs from the home screen (installed PWA) rather than in a Safari tab. */
export function isStandalonePwa(
  env: StandaloneEnv | undefined = typeof window === 'undefined' ? undefined : (window as StandaloneEnv),
): boolean {
  if (!env) return false;
  // The iPad app is installed by definition (no « add to home screen » guide, persistent storage).
  if (env === (globalThis as unknown) && isNativeApp()) return true;
  if (env.navigator?.standalone === true) return true;
  return safeProbe(() => typeof env.matchMedia === 'function' && env.matchMedia('(display-mode: standalone)').matches);
}

export interface WakeLockSentinelLike {
  readonly released?: boolean;
  release(): Promise<void>;
}

export interface WakeLockEnv {
  navigator?: { wakeLock?: { request(type: 'screen'): Promise<WakeLockSentinelLike> } };
  document?: Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'>;
}

export interface WakeLockOptions {
  /** Requests the lock again when the page becomes visible (the system drops it when hidden). Default true. */
  reacquireOnVisible?: boolean;
  env?: WakeLockEnv;
}

function noop(): void {}

async function releaseQuietly(sentinel: WakeLockSentinelLike): Promise<void> {
  try {
    await sentinel.release();
  } catch {
    // Already released by the system.
  }
}

/**
 * Keeps the screen awake (OCR processing, speech). Never throws: without the Screen Wake Lock API, or when the system
 * refuses (Low Power Mode, hidden page), it resolves with a release function that does nothing harmful.
 * The returned function is idempotent.
 */
export async function requestWakeLock(options: WakeLockOptions = {}): Promise<() => void> {
  const env: WakeLockEnv = options.env ?? {
    navigator: currentNavigator() as WakeLockEnv['navigator'],
    document: typeof document === 'undefined' ? undefined : document,
  };
  const wakeLock = env.navigator?.wakeLock;
  if (!wakeLock || typeof wakeLock.request !== 'function') return noop;

  const doc = env.document;
  const reacquire = options.reacquireOnVisible !== false && doc !== undefined;
  let sentinel: WakeLockSentinelLike | null = null;
  let released = false;

  const acquire = async (): Promise<void> => {
    try {
      const next = await wakeLock.request('screen');
      if (released) {
        await releaseQuietly(next);
        return;
      }
      sentinel = next;
    } catch {
      sentinel = null;
    }
  };

  const onVisibilityChange = (): void => {
    if (released || doc?.visibilityState !== 'visible') return;
    if (sentinel === null || sentinel.released === true) void acquire();
  };

  await acquire();
  if (reacquire) doc.addEventListener('visibilitychange', onVisibilityChange);

  return () => {
    if (released) return;
    released = true;
    if (reacquire) doc.removeEventListener('visibilitychange', onVisibilityChange);
    const current = sentinel;
    sentinel = null;
    if (current && current.released !== true) void releaseQuietly(current);
  };
}

export interface StorageManagerLike {
  persisted?: () => Promise<boolean>;
  persist?: () => Promise<boolean>;
}

/**
 * Asks the browser to keep IndexedDB data (Safari may evict data of non-installed sites after 7 days of inactivity).
 * Resolves true when storage is (or becomes) persistent. Never throws.
 */
export async function requestPersistentStorage(
  storage: StorageManagerLike | undefined = currentNavigator()?.storage,
): Promise<boolean> {
  if (!storage) return false;
  try {
    if (typeof storage.persisted === 'function' && (await storage.persisted()) === true) return true;
    if (typeof storage.persist !== 'function') return false;
    return (await storage.persist()) === true;
  } catch {
    return false;
  }
}
