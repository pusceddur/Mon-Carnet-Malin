// §25 Pages read by the home computer: while a page of this device waits for its text, the app asks the server for news
// every few seconds instead of every minute, so the text shows up as soon as the page has been read (usually 10-30 s).
import type { Id } from '@aide/shared';
import { syncNow } from '../sync/SyncEngine';
import { getPage } from './DocumentCache';

/** Pace of the first minutes, then a slower one; after WATCH_MAX_MS the normal sync takes over (home computer off…). */
export const FAST_POLL_MS = 3_000;
export const SLOW_POLL_MS = 15_000;
export const FAST_PHASE_MS = 2 * 60_000;
export const WATCH_MAX_MS = 10 * 60_000;

export interface AiReadingWatchDeps {
  syncNow(): Promise<void>;
  /** updatedAt of the page on this device, null when it is gone. */
  pageVersion(documentId: Id, pageIndex: number): Promise<number | null>;
  visible(): boolean;
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
}

interface Watched { documentId: Id; pageIndex: number; version: number | null; startedAt: number }

export function createAiReadingWatch(deps: AiReadingWatchDeps): { watch(documentId: Id, pageIndex: number): void; watching(): number } {
  const watched = new Map<string, Watched>();
  let scheduled = false;

  const schedule = (delay: number): void => {
    if (scheduled) return;
    scheduled = true;
    deps.setTimeout(() => {
      scheduled = false;
      void tick();
    }, delay);
  };

  async function tick(): Promise<void> {
    if (watched.size === 0) return;
    // Pushes the page (the server needs it before the text can be applied) and pulls the text when it is there.
    if (deps.visible()) await deps.syncNow().catch(() => undefined);
    const now = deps.now();
    let fast = false;
    for (const [key, w] of watched) {
      const version = await deps.pageVersion(w.documentId, w.pageIndex).catch(() => null);
      if (w.version === null) w.version = version;
      // The page changed after the hand-over (text of the home computer, correction) or is gone: done.
      const changed = version === null || version !== w.version;
      if (changed || now - w.startedAt >= WATCH_MAX_MS) {
        watched.delete(key);
        continue;
      }
      if (now - w.startedAt < FAST_PHASE_MS) fast = true;
    }
    if (watched.size > 0) schedule(fast ? FAST_POLL_MS : SLOW_POLL_MS);
  }

  return {
    watch(documentId: Id, pageIndex: number): void {
      const key = `${documentId}:${pageIndex}`;
      watched.set(key, { documentId, pageIndex, version: null, startedAt: deps.now() });
      schedule(0);
    },
    watching: () => watched.size,
  };
}

const defaultWatch = createAiReadingWatch({
  syncNow,
  pageVersion: async (documentId, pageIndex) => (await getPage(documentId, pageIndex))?.updatedAt ?? null,
  visible: () => typeof document === 'undefined' || document.visibilityState !== 'hidden',
  now: () => Date.now(),
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
});

/** The page `pageIndex` of `documentId` waits for its text from the home computer. */
export function watchAiReading(documentId: Id, pageIndex: number): void {
  defaultWatch.watch(documentId, pageIndex);
}
