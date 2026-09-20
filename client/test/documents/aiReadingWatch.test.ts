import { describe, expect, it, vi } from 'vitest';
import { createAiReadingWatch, FAST_POLL_MS, SLOW_POLL_MS, WATCH_MAX_MS, type AiReadingWatchDeps } from '../../src/documents/aiReadingWatch';

function harness(): { deps: AiReadingWatchDeps; timers: { fn: () => void; ms: number }[]; versions: Map<string, number | null>; clock: { now: number }; visible: { value: boolean } } {
  const timers: { fn: () => void; ms: number }[] = [];
  const versions = new Map<string, number | null>();
  const clock = { now: 0 };
  const visible = { value: true };
  const deps: AiReadingWatchDeps = {
    syncNow: vi.fn(async () => undefined),
    pageVersion: async (documentId, pageIndex) => versions.get(`${documentId}:${pageIndex}`) ?? null,
    visible: () => visible.value,
    now: () => clock.now,
    setTimeout: (fn, ms) => timers.push({ fn, ms }),
  };
  return { deps, timers, versions, clock, visible };
}

async function fire(timers: { fn: () => void; ms: number }[]): Promise<number> {
  const next = timers.shift();
  if (!next) throw new Error('no timer');
  next.fn();
  await new Promise((r) => setTimeout(r, 0));
  return next.ms;
}

describe('aiReadingWatch (§25)', () => {
  it('syncs at once, then every few seconds until the page changes', async () => {
    const h = harness();
    h.versions.set('d:0', 10);
    const watch = createAiReadingWatch(h.deps);
    watch.watch('d', 0);
    watch.watch('d', 0);
    expect(h.timers).toHaveLength(1);
    expect(await fire(h.timers)).toBe(0);
    expect(h.deps.syncNow).toHaveBeenCalledTimes(1);
    expect(h.timers[0]?.ms).toBe(FAST_POLL_MS);

    h.clock.now = 3_000;
    await fire(h.timers);
    expect(h.deps.syncNow).toHaveBeenCalledTimes(2);
    expect(watch.watching()).toBe(1);

    // The text of the home computer arrived with the sync.
    h.versions.set('d:0', 20);
    h.clock.now = 6_000;
    await fire(h.timers);
    expect(watch.watching()).toBe(0);
    expect(h.timers).toHaveLength(0);
  });

  it('slows down after two minutes and gives up after ten; no sync while the app is hidden', async () => {
    const h = harness();
    h.versions.set('d:1', 10);
    const watch = createAiReadingWatch(h.deps);
    watch.watch('d', 1);
    await fire(h.timers);
    h.clock.now = 3 * 60_000;
    h.visible.value = false;
    await fire(h.timers);
    expect(h.deps.syncNow).toHaveBeenCalledTimes(1);
    expect(h.timers[0]?.ms).toBe(SLOW_POLL_MS);
    h.clock.now = WATCH_MAX_MS;
    await fire(h.timers);
    expect(watch.watching()).toBe(0);
    expect(h.timers).toHaveLength(0);
  });

  it('stops watching a page that is gone', async () => {
    const h = harness();
    const watch = createAiReadingWatch(h.deps);
    watch.watch('gone', 0);
    await fire(h.timers);
    expect(watch.watching()).toBe(0);
  });
});
