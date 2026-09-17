import type { ChildProfile, ReadingProgress, ReadingSession } from '@aide/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mergePatch, savePreferences, type PreferencesDeps } from '../../src/features/reader/preferences';
import { ProgressSaver, ReadingSessionTracker } from '../../src/features/reader/tracking';
import { makeChild } from '../ai/helpers';

describe('ProgressSaver', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('debounces, saves the last position once and skips identical positions', async () => {
    const saved: ReadingProgress[] = [];
    const saver = new ProgressSaver('c', 'd', async (p) => {
      saved.push(p);
    }, 1000, () => 42);
    saver.prime({ pageIndex: 2, blockIndex: 0, sentenceIndex: 3 });
    saver.update({ pageIndex: 2, blockIndex: 0, sentenceIndex: 3 });
    await vi.advanceTimersByTimeAsync(1000);
    expect(saved).toEqual([]);

    saver.update({ pageIndex: 3, blockIndex: 0, sentenceIndex: 0 });
    saver.update({ pageIndex: 3, blockIndex: 1, sentenceIndex: 2 });
    await vi.advanceTimersByTimeAsync(999);
    expect(saved).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(saved).toEqual([{ childId: 'c', documentId: 'd', pageIndex: 3, blockIndex: 1, sentenceIndex: 2, updatedAt: 42 }]);

    saver.update({ pageIndex: 4, blockIndex: 0, sentenceIndex: 0 });
    await saver.flush();
    expect(saved).toHaveLength(2);
  });

  it('retries a failed save on the next change', async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error('quota')).mockResolvedValue(undefined);
    const saver = new ProgressSaver('c', 'd', save);
    saver.update({ pageIndex: 1, blockIndex: 0, sentenceIndex: 0 });
    await saver.flush();
    saver.update({ pageIndex: 1, blockIndex: 0, sentenceIndex: 0 });
    await saver.flush();
    expect(save).toHaveBeenCalledTimes(2);
  });
});

describe('ReadingSessionTracker', () => {
  it('saves nothing until something happens, then counts pages, lookups, AI requests and listening time', async () => {
    let now = 1_000;
    const saved: ReadingSession[] = [];
    const tracker = new ReadingSessionTracker('c', 'd', async (s) => {
      saved.push(s);
    }, () => now);
    await tracker.persist();
    expect(saved).toEqual([]);

    tracker.markPage(4);
    tracker.markPage(1);
    tracker.markPage(4);
    tracker.countLookup();
    tracker.countAiRequest();
    tracker.ttsStarted();
    now += 12_400;
    tracker.ttsStopped();
    now += 1_000;
    await tracker.persist();
    expect(saved[0]).toMatchObject({
      childId: 'c', documentId: 'd', startedAt: 1_000, endedAt: 14_400, updatedAt: 14_400, pagesViewed: [1, 4], ttsSeconds: 12, wordsLookedUp: 1,
      aiRequests: 1,
    });

    // Listening still running: counted at persist time without stopping the measure.
    tracker.ttsStarted();
    now += 5_000;
    await tracker.persist();
    now += 5_000;
    tracker.ttsStopped();
    await tracker.persist();
    expect(saved.map((s) => s.ttsSeconds)).toEqual([12, 17, 22]);
    expect(new Set(saved.map((s) => s.id)).size).toBe(1);
  });
});

describe('savePreferences', () => {
  function deps(overrides: Partial<PreferencesDeps> = {}): PreferencesDeps & { published: ChildProfile[]; local: ChildProfile[]; remote: ChildProfile[] } {
    const published: ChildProfile[] = [];
    const local: ChildProfile[] = [];
    const remote: ChildProfile[] = [];
    return {
      published, local, remote,
      loadChild: async () => makeChild({ updatedAt: 10 }),
      online: () => true,
      patchServer: async (_id, patch) => ({ ...makeChild(), reading: { ...makeChild().reading, ...patch.reading }, updatedAt: 500 }),
      storeRemote: async (c) => {
        remote.push(c);
      },
      storeLocal: async (c) => {
        local.push(c);
      },
      publish: (c) => published.push(c),
      now: () => 100,
      ...overrides,
    };
  }

  it('PATCHes online and stores the server profile without the outbox', async () => {
    const d = deps();
    expect(await savePreferences('child-1', { reading: { fontSizePx: 30 } }, d)).toBe('server');
    expect(d.remote[0]?.reading.fontSizePx).toBe(30);
    expect(d.local).toEqual([]);
    expect(d.published.map((c) => c.updatedAt)).toEqual([100, 500]);
  });

  it('offline or on server failure: saves locally through the sync outbox', async () => {
    const offline = deps({ online: () => false });
    expect(await savePreferences('child-1', { tts: { rate: 0.7 } }, offline)).toBe('local');
    expect(offline.local[0]).toMatchObject({ tts: { rate: 0.7, pitch: 1 }, updatedAt: 100 });

    const failing = deps({ patchServer: async () => Promise.reject(new Error('offline')) });
    expect(await savePreferences('child-1', { reading: { theme: 'sombre' } }, failing)).toBe('local');
    expect(failing.local[0]?.reading.theme).toBe('sombre');
  });

  it('skips empty patches, reports a missing child, merges patches', async () => {
    expect(await savePreferences('child-1', { reading: {} }, deps())).toBe('skipped');
    expect(await savePreferences('child-1', { reading: { font: 'andika' } }, deps({ loadChild: async () => null }))).toBe('failed');
    expect(mergePatch({ reading: { font: 'andika', fontSizePx: 20 } }, { reading: { fontSizePx: 22 }, tts: { rate: 1 } }))
      .toEqual({ reading: { font: 'andika', fontSizePx: 22 }, tts: { rate: 1 } });
  });
});
