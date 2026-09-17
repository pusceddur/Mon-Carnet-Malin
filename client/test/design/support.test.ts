import { describe, expect, it, vi } from 'vitest';
import {
  checkBrowserSupport,
  FEATURE_INDEXEDDB,
  FEATURE_INTL_SEGMENTER,
  FEATURE_MODULE_WORKER,
  FEATURE_POINTER_EVENTS,
  FEATURE_WEBASSEMBLY,
  isIPad,
  isStandalonePwa,
  requestPersistentStorage,
  requestWakeLock,
  type SupportProbeTarget,
  type WakeLockEnv,
  type WakeLockSentinelLike,
} from '../../src/platform/support';

/** Worker constructor that reads `options.type` like engines supporting module workers, then rejects the URL. */
class ModuleAwareWorker {
  constructor(url: string, options: WorkerOptions) {
    void options.type;
    if (url === 'http://[') throw new SyntaxError('Invalid URL');
  }
}

/** Worker constructor of an engine without module workers: never looks at options.type. */
class ClassicWorker {
  constructor(url: string) {
    if (url === 'http://[') throw new SyntaxError('Invalid URL');
  }
}

function modernTarget(overrides: Partial<SupportProbeTarget> = {}): SupportProbeTarget {
  return {
    WebAssembly: { validate: () => true, instantiate: () => Promise.resolve() },
    indexedDB: { open: () => ({}) },
    PointerEvent: class {},
    Worker: ModuleAwareWorker,
    Intl: { Segmenter: class {} },
    ...overrides,
  };
}

describe('checkBrowserSupport', () => {
  it('accepts a modern environment', () => {
    expect(checkBrowserSupport(modernTarget())).toEqual({ supported: true, missing: [], optionalMissing: [] });
  });

  it('lists every missing required feature', () => {
    const result = checkBrowserSupport({ Intl: {} });
    expect(result.supported).toBe(false);
    expect(result.missing).toEqual([FEATURE_WEBASSEMBLY, FEATURE_INDEXEDDB, FEATURE_POINTER_EVENTS, FEATURE_MODULE_WORKER]);
    expect(result.optionalMissing).toEqual([FEATURE_INTL_SEGMENTER]);
  });

  it('treats a missing Intl.Segmenter as non-blocking', () => {
    const result = checkBrowserSupport(modernTarget({ Intl: {} }));
    expect(result.supported).toBe(true);
    expect(result.optionalMissing).toEqual([FEATURE_INTL_SEGMENTER]);
  });

  it('detects module workers from the options dictionary', () => {
    expect(checkBrowserSupport(modernTarget({ Worker: ClassicWorker })).missing).toEqual([FEATURE_MODULE_WORKER]);
    // An engine that does not reject the probe URL synchronously: the worker is terminated at once.
    const terminate = vi.fn();
    class LenientWorker {
      constructor(_url: string, options: WorkerOptions) {
        void options.type;
      }
      terminate = terminate;
    }
    expect(checkBrowserSupport(modernTarget({ Worker: LenientWorker })).supported).toBe(true);
    expect(terminate).toHaveBeenCalledTimes(1);
  });

  it('flags WebAssembly disabled or broken (Lockdown Mode)', () => {
    expect(checkBrowserSupport(modernTarget({ WebAssembly: undefined })).missing).toEqual([FEATURE_WEBASSEMBLY]);
    expect(checkBrowserSupport(modernTarget({ WebAssembly: { validate: () => false, instantiate: () => undefined } })).missing).toEqual([
      FEATURE_WEBASSEMBLY,
    ]);
    const throwing = {
      validate: () => {
        throw new Error('disabled');
      },
      instantiate: () => undefined,
    };
    expect(checkBrowserSupport(modernTarget({ WebAssembly: throwing })).missing).toEqual([FEATURE_WEBASSEMBLY]);
  });

  it('survives a throwing indexedDB getter (blocked storage)', () => {
    const target = modernTarget();
    Object.defineProperty(target, 'indexedDB', {
      get() {
        throw new DOMException('blocked', 'SecurityError');
      },
    });
    expect(checkBrowserSupport(target).missing).toEqual([FEATURE_INDEXEDDB]);
    expect(checkBrowserSupport(modernTarget({ indexedDB: null })).missing).toEqual([FEATURE_INDEXEDDB]);
  });

  it('works against the real test environment without throwing', () => {
    const result = checkBrowserSupport();
    expect(Array.isArray(result.missing)).toBe(true);
  });
});

describe('isIPad', () => {
  const IPAD_OLD = 'Mozilla/5.0 (iPad; CPU OS 12_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';
  const IPAD_DESKTOP = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
  const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
  const WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';

  it('recognises iPads, including iPadOS presenting itself as a Mac', () => {
    expect(isIPad({ userAgent: IPAD_OLD, maxTouchPoints: 5 })).toBe(true);
    expect(isIPad({ userAgent: IPAD_DESKTOP, maxTouchPoints: 5, platform: 'MacIntel' })).toBe(true);
    expect(isIPad({ userAgent: 'Mozilla/5.0', maxTouchPoints: 5, platform: 'MacIntel' })).toBe(true);
  });

  it('rejects Macs, iPhones and other devices', () => {
    expect(isIPad({ userAgent: IPAD_DESKTOP, maxTouchPoints: 0, platform: 'MacIntel' })).toBe(false);
    expect(isIPad({ userAgent: IPHONE, maxTouchPoints: 5, platform: 'iPhone' })).toBe(false);
    expect(isIPad({ userAgent: WINDOWS, maxTouchPoints: 10, platform: 'Win32' })).toBe(false);
    expect(isIPad(undefined)).toBe(false);
  });
});

describe('isStandalonePwa', () => {
  it('uses navigator.standalone (iPadOS) or the display-mode media query', () => {
    expect(isStandalonePwa({ navigator: { standalone: true } })).toBe(true);
    expect(isStandalonePwa({ navigator: { standalone: false }, matchMedia: () => ({ matches: true }) })).toBe(true);
    expect(isStandalonePwa({ navigator: {}, matchMedia: () => ({ matches: false }) })).toBe(false);
    expect(
      isStandalonePwa({
        navigator: {},
        matchMedia: () => {
          throw new Error('unsupported');
        },
      }),
    ).toBe(false);
    expect(isStandalonePwa(undefined)).toBe(false);
  });
});

class FakeSentinel implements WakeLockSentinelLike {
  released = false;
  release = vi.fn(async () => {
    this.released = true;
  });
}

function fakeDocument(): WakeLockEnv['document'] & { state: DocumentVisibilityState; fire(): void } {
  const listeners = new Set<() => void>();
  const doc = {
    state: 'visible' as DocumentVisibilityState,
    get visibilityState() {
      return doc.state;
    },
    addEventListener: (_type: string, cb: () => void) => listeners.add(cb),
    removeEventListener: (_type: string, cb: () => void) => listeners.delete(cb),
    fire: () => listeners.forEach((cb) => cb()),
  };
  return doc as unknown as WakeLockEnv['document'] & { state: DocumentVisibilityState; fire(): void };
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('requestWakeLock', () => {
  it('resolves to a harmless release function without the API', async () => {
    const release = await requestWakeLock({ env: { navigator: {}, document: fakeDocument() } });
    expect(() => release()).not.toThrow();
  });

  it('acquires the screen lock and releases it once', async () => {
    const sentinel = new FakeSentinel();
    const request = vi.fn(async () => sentinel);
    const release = await requestWakeLock({ env: { navigator: { wakeLock: { request } }, document: fakeDocument() } });
    expect(request).toHaveBeenCalledWith('screen');
    release();
    release();
    expect(sentinel.release).toHaveBeenCalledTimes(1);
  });

  it('re-acquires when the page becomes visible again, until released', async () => {
    const doc = fakeDocument();
    const sentinels: FakeSentinel[] = [];
    const request = vi.fn(async () => {
      const s = new FakeSentinel();
      sentinels.push(s);
      return s;
    });
    const release = await requestWakeLock({ env: { navigator: { wakeLock: { request } }, document: doc } });
    // the system drops the lock when the page is hidden
    (sentinels[0] as FakeSentinel).released = true;
    doc.state = 'hidden';
    doc.fire();
    expect(request).toHaveBeenCalledTimes(1);
    doc.state = 'visible';
    doc.fire();
    await flush();
    expect(request).toHaveBeenCalledTimes(2);

    release();
    expect(sentinels[1]?.release).toHaveBeenCalledTimes(1);
    doc.fire();
    await flush();
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('never throws when the system refuses the lock', async () => {
    const request = vi.fn(async () => {
      throw new DOMException('Low Power Mode', 'NotAllowedError');
    });
    const release = await requestWakeLock({ reacquireOnVisible: false, env: { navigator: { wakeLock: { request } }, document: fakeDocument() } });
    expect(() => release()).not.toThrow();
  });

  it('releases a lock granted after the caller already released', async () => {
    const doc = fakeDocument();
    const sentinel = new FakeSentinel();
    let grant: (s: FakeSentinel) => void = () => {};
    const request = vi
      .fn<(type: 'screen') => Promise<WakeLockSentinelLike>>()
      .mockResolvedValueOnce(new FakeSentinel())
      .mockImplementationOnce(() => new Promise<FakeSentinel>((resolve) => (grant = resolve)));
    const release = await requestWakeLock({ env: { navigator: { wakeLock: { request } }, document: doc } });
    const first = (await request.mock.results[0]?.value) as FakeSentinel;
    first.released = true;
    doc.fire(); // pending re-acquisition
    release();
    grant(sentinel);
    await flush();
    expect(sentinel.release).toHaveBeenCalledTimes(1);
  });
});

describe('requestPersistentStorage', () => {
  it('returns true when already persisted, without asking again', async () => {
    const persist = vi.fn(async () => true);
    await expect(requestPersistentStorage({ persisted: async () => true, persist })).resolves.toBe(true);
    expect(persist).not.toHaveBeenCalled();
  });

  it('asks for persistence and reports the answer', async () => {
    await expect(requestPersistentStorage({ persisted: async () => false, persist: async () => true })).resolves.toBe(true);
    await expect(requestPersistentStorage({ persisted: async () => false, persist: async () => false })).resolves.toBe(false);
  });

  it('returns false without the API or on errors', async () => {
    await expect(requestPersistentStorage(undefined)).resolves.toBe(false);
    await expect(requestPersistentStorage({})).resolves.toBe(false);
    await expect(
      requestPersistentStorage({
        persist: async () => {
          throw new Error('denied');
        },
      }),
    ).resolves.toBe(false);
  });
});
