import { TIMINGS } from '@aide/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CANCEL_GAP_MS,
  SpeechEngine,
  clampRate,
  wordRangeAt,
  type SpeechEvent,
  type SpeechItem,
  type SpeechState,
} from '../../src/tts/SpeechEngine';
import { FakeDocument, FakeSynth, FakeUtterance, voice } from './fakeSpeech';

const items: SpeechItem[] = [
  { id: '0:0:0', text: 'Le chat dort.' },
  { id: '0:0:1', text: 'Le chien joue.' },
  { id: '0:1:0', text: 'La pluie tombe.' },
];

interface Harness {
  engine: SpeechEngine;
  synth: FakeSynth;
  doc: FakeDocument;
  states: SpeechState[];
  events: SpeechEvent[];
  wakeRequests: number;
  wakeReleases: number;
}

function setup(): Harness {
  const synth = new FakeSynth();
  const doc = new FakeDocument();
  const h: Harness = { engine: undefined as unknown as SpeechEngine, synth, doc, states: [], events: [], wakeRequests: 0, wakeReleases: 0 };
  h.engine = new SpeechEngine({
    synth,
    createUtterance: (text) => new FakeUtterance(text),
    document: doc as unknown as Document,
    now: () => Date.now(),
    acquireWakeLock: async () => {
      h.wakeRequests += 1;
      return () => {
        h.wakeReleases += 1;
      };
    },
  });
  // Timing tests below expect the next sentence right away; pauses have their own test.
  h.engine.setPauses(0, 0);
  h.engine.subscribe((s) => h.states.push(s));
  h.engine.subscribeEvents((e) => h.events.push(e));
  return h;
}

const last = (h: Harness): SpeechState => h.engine.getState();
// Zero-delay timers created inside a fake tick are scheduled 1 ms later.
const flush = (): Promise<unknown> => vi.advanceTimersByTimeAsync(1);

describe('SpeechEngine', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('speaks one utterance per sentence, highlights on start and advances on end', async () => {
    const h = setup();
    h.engine.setQueue(items, 0);
    h.engine.play();
    expect(h.synth.texts).toEqual(['Le chat dort.']);
    expect(h.synth.spoken[0]?.lang).toBe('fr-FR');
    expect(last(h).status).toBe('playing');

    await flush();
    expect(last(h).itemId).toBe('0:0:0');

    h.synth.finishCurrent();
    expect(h.synth.texts).toEqual(['Le chat dort.', 'Le chien joue.']);
    // Highlight moves only when the new utterance really starts.
    expect(last(h).itemId).toBe('0:0:0');
    await flush();
    expect(last(h).itemId).toBe('0:0:1');

    h.synth.finishCurrent();
    await flush();
    h.synth.finishCurrent();
    expect(last(h).status).toBe('idle');
    expect(h.events).toContainEqual({ type: 'ended' });
  });

  it('pause cancels, ignores the asynchronous end of the cancelled utterance, resume re-speaks the sentence', async () => {
    const h = setup();
    h.engine.setQueue(items, 1);
    h.engine.play();
    await flush();
    h.engine.pause();
    expect(h.synth.cancelCount).toBe(1);
    expect(last(h)).toMatchObject({ status: 'paused', index: 1, itemId: '0:0:1' });

    // Old generation: the `end` fired by cancel() must not advance the queue.
    await vi.advanceTimersByTimeAsync(10);
    expect(h.synth.spoken).toHaveLength(1);
    expect(last(h)).toMatchObject({ status: 'paused', index: 1 });

    await vi.advanceTimersByTimeAsync(CANCEL_GAP_MS);
    h.engine.play();
    expect(h.synth.texts).toEqual(['Le chien joue.', 'Le chien joue.']);
    await flush();
    expect(last(h)).toMatchObject({ status: 'playing', itemId: '0:0:1' });
  });

  it('next and previous bump the generation, cancel, and wait at least 50 ms before speaking', async () => {
    const h = setup();
    h.engine.setQueue(items, 0);
    h.engine.play();
    await flush();

    h.engine.next();
    expect(h.synth.cancelCount).toBe(1);
    expect(h.synth.spoken).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(CANCEL_GAP_MS - 1);
    expect(h.synth.spoken).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.synth.texts).toEqual(['Le chat dort.', 'Le chien joue.']);
    await flush();
    expect(last(h).itemId).toBe('0:0:1');

    h.engine.previous();
    await vi.advanceTimersByTimeAsync(CANCEL_GAP_MS);
    expect(h.synth.texts.at(-1)).toBe('Le chat dort.');
    await flush();
    expect(last(h)).toMatchObject({ status: 'playing', index: 0, itemId: '0:0:0' });
    // Every stale `end` was ignored: exactly three utterances.
    expect(h.synth.spoken).toHaveLength(3);
  });

  it('next and previous only move the position when not playing', () => {
    const h = setup();
    h.engine.setQueue(items, 0);
    h.engine.next();
    h.engine.next();
    h.engine.next();
    expect(last(h)).toMatchObject({ status: 'idle', index: 2, itemId: '0:1:0' });
    h.engine.previous();
    expect(last(h).index).toBe(1);
    expect(h.synth.spoken).toHaveLength(0);
  });

  it('watchdog: no start within 3 s → cancel and one retry, then idle and a start_failed event', async () => {
    const h = setup();
    h.synth.autoStart = false;
    h.engine.setQueue(items, 0);
    h.engine.play();
    await vi.advanceTimersByTimeAsync(TIMINGS.ttsWatchdogMs);
    expect(h.synth.cancelCount).toBe(1);
    await vi.advanceTimersByTimeAsync(CANCEL_GAP_MS);
    expect(h.synth.spoken).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(TIMINGS.ttsWatchdogMs);
    expect(last(h).status).toBe('idle');
    expect(h.events).toContainEqual({ type: 'error', kind: 'start_failed', itemId: '0:0:0' });
    expect(h.synth.spoken).toHaveLength(2);
  });

  it('pauses when the page is hidden and never resumes on its own', async () => {
    const h = setup();
    h.engine.setQueue(items, 0);
    h.engine.play();
    await flush();
    h.doc.setVisibility('hidden');
    expect(last(h).status).toBe('paused');
    expect(h.synth.cancelCount).toBe(1);
    h.doc.setVisibility('visible');
    await vi.advanceTimersByTimeAsync(1000);
    expect(last(h).status).toBe('paused');
    expect(h.synth.spoken).toHaveLength(1);
  });

  it('holds a wake lock while playing and releases it on pause and stop', async () => {
    const h = setup();
    h.engine.setQueue(items, 0);
    h.engine.play();
    await flush();
    expect(h.wakeRequests).toBe(1);
    h.engine.pause();
    expect(h.wakeReleases).toBe(1);
    await vi.advanceTimersByTimeAsync(CANCEL_GAP_MS);
    h.engine.play();
    await flush();
    h.engine.stop();
    expect(h.wakeRequests).toBe(2);
    expect(h.wakeReleases).toBe(2);
  });

  it('keeps the position when the queue grows while playing', async () => {
    const h = setup();
    h.engine.setQueue(items.slice(0, 2), 1);
    h.engine.play();
    await flush();
    h.engine.setQueue([{ id: 'x', text: 'Avant.' }, ...items], 0);
    expect(last(h)).toMatchObject({ status: 'playing', index: 2, itemId: '0:0:1' });
    expect(h.synth.cancelCount).toBe(0);
    h.synth.finishCurrent();
    expect(h.synth.texts.at(-1)).toBe('La pluie tombe.');
  });

  it('stops and restarts at startIndex when the current item disappears from the queue', async () => {
    const h = setup();
    h.engine.setQueue(items, 0);
    h.engine.play();
    await flush();
    h.engine.setQueue([{ id: 'other', text: 'Autre.' }, { id: 'other2', text: 'Encore.' }], 1);
    expect(last(h)).toMatchObject({ status: 'idle', index: 1, itemId: 'other2' });
  });

  it('chooses the preferred voice, else fr-FR on device, and sets lang', async () => {
    const h = setup();
    h.synth.voices = [voice('en', 'en-US'), voice('ca-remote', 'fr-CA', false), voice('fr-remote', 'fr-FR', false), voice('fr-local', 'fr_FR', true)];
    h.engine.setQueue(items, 0);
    h.engine.play();
    expect(h.synth.spoken[0]?.voice).toMatchObject({ voiceURI: 'fr-local' });
    expect(h.synth.spoken[0]?.lang).toBe('fr-FR');

    h.engine.setVoice('ca-remote');
    await flush();
    h.engine.next();
    await vi.advanceTimersByTimeAsync(CANCEL_GAP_MS);
    expect(h.synth.spoken.at(-1)?.voice).toMatchObject({ voiceURI: 'ca-remote' });
    expect(h.synth.spoken.at(-1)?.lang).toBe('fr-CA');
  });

  it('restarts the current sentence when the rate changes during playback', async () => {
    const h = setup();
    h.engine.setQueue(items, 0);
    h.engine.play();
    await flush();
    h.engine.setRate(1.2);
    expect(last(h).rate).toBe(1.2);
    await vi.advanceTimersByTimeAsync(CANCEL_GAP_MS);
    expect(h.synth.spoken).toHaveLength(2);
    expect(h.synth.spoken[1]).toMatchObject({ text: 'Le chat dort.', rate: 1.2 });
  });

  it('speakOnce pauses the queue and speaks the text after the cancel gap', async () => {
    const h = setup();
    h.engine.setQueue(items, 0);
    h.engine.play();
    await flush();
    h.engine.speakOnce('  photosynthèse ');
    expect(last(h).status).toBe('paused');
    await vi.advanceTimersByTimeAsync(CANCEL_GAP_MS);
    expect(h.synth.texts.at(-1)).toBe('photosynthèse');
  });

  it('speakOnce speaks synchronously when nothing was cancelled (user gesture on iOS)', () => {
    const h = setup();
    h.engine.speakOnce('Bonjour');
    expect(h.synth.texts).toEqual(['Bonjour']);
  });

  it('reports word boundaries as a range in the sentence', async () => {
    const h = setup();
    h.engine.setQueue(items, 0);
    h.engine.play();
    await flush();
    h.synth.current?.onboundary?.({ charIndex: 3, name: 'word' });
    expect(last(h).wordRange).toEqual({ start: 3, end: 7 });
  });

  it('waits a short pause between sentences and a longer one before a new paragraph', async () => {
    const h = setup();
    h.engine.setPauses(300, 900);
    h.engine.setQueue(items, 0);
    h.engine.play();
    await flush();
    h.synth.finishCurrent();
    await vi.advanceTimersByTimeAsync(250);
    expect(h.synth.texts).toEqual(['Le chat dort.']);
    await vi.advanceTimersByTimeAsync(60);
    expect(h.synth.texts).toEqual(['Le chat dort.', 'Le chien joue.']);
    h.synth.finishCurrent();
    await vi.advanceTimersByTimeAsync(800);
    expect(h.synth.texts).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(110);
    expect(h.synth.texts.at(-1)).toBe('La pluie tombe.');
  });

  it('reads abbreviations in words but highlights the displayed word', async () => {
    const h = setup();
    const text = 'M. Dupont lit au XIXe siècle.';
    h.engine.setQueue([{ id: '0:0:0', text }], 0);
    h.engine.play();
    await flush();
    expect(h.synth.texts).toEqual(['Monsieur Dupont lit au dix-neuvième siècle.']);
    const spoken = h.synth.texts[0]!;
    h.synth.current?.onboundary?.({ charIndex: spoken.indexOf('Dupont'), name: 'word' });
    expect(text.slice(last(h).wordRange!.start, last(h).wordRange!.end)).toBe('Dupont');
    h.synth.current?.onboundary?.({ charIndex: spoken.indexOf('siècle'), name: 'word' });
    expect(text.slice(last(h).wordRange!.start, last(h).wordRange!.end)).toBe('siècle');
  });

  it('a system interruption settles in pause', async () => {
    const h = setup();
    h.engine.setQueue(items, 0);
    h.engine.play();
    await flush();
    h.synth.current?.onerror?.({ error: 'interrupted' });
    expect(last(h).status).toBe('paused');
  });

  it('without speech synthesis, play emits an unsupported event', () => {
    const engine = new SpeechEngine();
    const events: SpeechEvent[] = [];
    engine.subscribeEvents((e) => events.push(e));
    if (SpeechEngine.isSupported()) return;
    expect(engine.getState().supported).toBe(false);
    engine.setQueue(items);
    engine.play();
    expect(events).toEqual([{ type: 'error', kind: 'unsupported', itemId: null }]);
  });
});

describe('speech helpers', () => {
  it('clampRate keeps 0.5..1.5 with two decimals', () => {
    expect(clampRate(0.1)).toBe(0.5);
    expect(clampRate(9)).toBe(1.5);
    expect(clampRate(0.8499)).toBe(0.85);
    expect(clampRate(Number.NaN)).toBe(0.85);
  });

  it('wordRangeAt measures the word when charLength is missing', () => {
    expect(wordRangeAt('Un arc-en-ciel brille', 3)).toEqual({ start: 3, end: 14 });
    expect(wordRangeAt('l’arbre', 2, 5)).toEqual({ start: 2, end: 7 });
    expect(wordRangeAt('abc', 10)).toBeNull();
  });
});
