import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createNativeSpeechEnv, getNativeSpeechPlugin, nativeVoiceToVoice, type NativeSpeakOptions, type NativeSpeechPlugin, type NativeVoice,
} from '../../src/tts/nativeSpeech';
import { SpeechEngine } from '../../src/tts/SpeechEngine';
import { pickFrenchVoice, voiceQuality } from '../../src/tts/voices';

type Listener = (event: never) => void;

/** In-memory stand-in for the iPad plugin: records calls, lets the test fire the system events. */
class FakeNativePlugin implements NativeSpeechPlugin {
  readonly spoken: NativeSpeakOptions[] = [];
  stops = 0;
  readonly awake: boolean[] = [];
  private readonly listeners = new Map<string, Listener[]>();

  constructor(private readonly voices: NativeVoice[] = []) {}

  getVoices(): Promise<{ voices: NativeVoice[] }> {
    return Promise.resolve({ voices: this.voices });
  }

  speak(options: NativeSpeakOptions): Promise<void> {
    this.spoken.push(options);
    return Promise.resolve();
  }

  stop(): Promise<void> {
    this.stops += 1;
    return Promise.resolve();
  }

  keepAwake(options: { enabled: boolean }): Promise<void> {
    this.awake.push(options.enabled);
    return Promise.resolve();
  }

  addListener(event: string, listener: Listener): Promise<{ remove: () => Promise<void> }> {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
    return Promise.resolve({ remove: () => Promise.resolve() });
  }

  emit(event: 'speechStart' | 'speechEnd', data: { id: string }): void;
  emit(event: 'speechRange', data: { id: string; start: number; length: number }): void;
  emit(event: 'speechCancel', data: { id: string; reason: 'canceled' | 'interrupted' }): void;
  emit(event: string, data: unknown): void {
    for (const listener of this.listeners.get(event) ?? []) (listener as (e: unknown) => void)(data);
  }

  lastId(): string {
    return this.spoken.at(-1)!.id;
  }
}

const nativeVoice = (identifier: string, name: string, quality: NativeVoice['quality'], extra: Partial<NativeVoice> = {}): NativeVoice => ({
  identifier, name, language: 'fr-FR', quality, novelty: false, personal: false, ...extra,
});

const flush = (): Promise<unknown> => vi.advanceTimersByTimeAsync(1);

describe('native speech (iPad app)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('is not used in a browser', () => {
    expect(getNativeSpeechPlugin()).toBeNull();
  });

  it('uses the quality reported by the system, keeps robotic voices last and skips the personal voice', async () => {
    const plugin = new FakeNativePlugin([
      nativeVoice('com.apple.eloquence.fr-FR.Eddy', 'Eddy', 'default'),
      nativeVoice('com.apple.voice.compact.fr-FR.Thomas', 'Thomas', 'default'),
      nativeVoice('com.apple.speech.voice.Audrey', 'Audrey', 'premium'),
      nativeVoice('com.apple.speech.personal.1', 'Ma voix', 'premium', { personal: true }),
      nativeVoice('com.apple.speech.synthesis.voice.Bells', 'Cloches', 'default', { novelty: true }),
    ]);
    const env = createNativeSpeechEnv(plugin);
    const changed = vi.fn();
    env.synth.addEventListener?.('voiceschanged', changed);
    await flush();
    expect(changed).toHaveBeenCalledTimes(1);
    const voices = env.synth.getVoices();
    expect(voices.map((v) => v.name)).toEqual(['Eddy', 'Thomas', 'Audrey', 'Cloches']);
    expect(voices.map((v) => voiceQuality(v))).toEqual(['robotic', 'standard', 'premium', 'robotic']);
    expect(pickFrenchVoice(voices, null)?.name).toBe('Audrey');
    expect(voiceQuality(nativeVoiceToVoice(nativeVoice('x', 'Grandma', 'premium')))).toBe('robotic');
  });

  it('maps the system events to utterance events (start, word range, end)', async () => {
    const plugin = new FakeNativePlugin();
    const env = createNativeSpeechEnv(plugin);
    await flush();
    const utterance = env.createUtterance('Le volcan dort.');
    utterance.rate = 1.2;
    const events: string[] = [];
    utterance.onstart = () => events.push('start');
    utterance.onboundary = (e) => events.push(`word ${e.charIndex}+${e.charLength} ${e.name}`);
    utterance.onend = () => events.push('end');
    env.synth.speak(utterance);
    await flush();
    expect(plugin.spoken[0]).toMatchObject({ text: 'Le volcan dort.', lang: 'fr-FR', rate: 1.2, pitch: 1 });
    expect(env.synth.pending).toBe(true);

    const id = plugin.lastId();
    plugin.emit('speechStart', { id });
    expect(env.synth.speaking).toBe(true);
    plugin.emit('speechRange', { id, start: 3, length: 6 });
    plugin.emit('speechEnd', { id });
    // Events of an unknown or finished utterance are ignored.
    plugin.emit('speechEnd', { id });
    expect(events).toEqual(['start', 'word 3+6 word', 'end']);
    expect(env.synth.speaking).toBe(false);
  });

  it('cancel silences pending utterances; a system interruption is reported as `interrupted`', async () => {
    const plugin = new FakeNativePlugin();
    const env = createNativeSpeechEnv(plugin);
    await flush();
    const first = env.createUtterance('Un.');
    const firstErrors: unknown[] = [];
    first.onerror = (e) => firstErrors.push(e);
    env.synth.speak(first);
    const firstId = plugin.lastId();
    env.synth.cancel();
    await flush();
    expect(plugin.stops).toBe(1);
    plugin.emit('speechCancel', { id: firstId, reason: 'canceled' });
    expect(firstErrors).toEqual([]);

    const second = env.createUtterance('Deux.');
    const secondErrors: unknown[] = [];
    second.onerror = (e) => secondErrors.push(e);
    env.synth.speak(second);
    plugin.emit('speechCancel', { id: plugin.lastId(), reason: 'interrupted' });
    expect(secondErrors).toEqual([{ error: 'interrupted' }]);
  });

  it('keeps the screen on while reading', async () => {
    const plugin = new FakeNativePlugin();
    const env = createNativeSpeechEnv(plugin);
    const release = await env.acquireWakeLock!();
    release();
    release();
    await flush();
    expect(plugin.awake).toEqual([true, false]);
  });

  it('drives the reading engine with the chosen system voice and word highlighting', async () => {
    const plugin = new FakeNativePlugin([
      nativeVoice('com.apple.voice.compact.fr-FR.Thomas', 'Thomas', 'default'),
      nativeVoice('com.apple.voice.premium.fr-FR.Audrey', 'Audrey', 'premium'),
    ]);
    const engine = new SpeechEngine(createNativeSpeechEnv(plugin));
    engine.setPauses(0, 0);
    await flush();
    engine.setQueue([{ id: '0:0:0', text: 'Le chat dort.' }, { id: '0:0:1', text: 'Il rêve.' }], 0);
    engine.play();
    await flush();
    expect(plugin.spoken[0]).toMatchObject({ text: 'Le chat dort.', voiceIdentifier: 'com.apple.voice.premium.fr-FR.Audrey', lang: 'fr-FR' });

    plugin.emit('speechStart', { id: plugin.lastId() });
    plugin.emit('speechRange', { id: plugin.lastId(), start: 3, length: 4 });
    expect(engine.getState()).toMatchObject({ status: 'playing', itemId: '0:0:0', wordRange: { start: 3, end: 7 } });

    plugin.emit('speechEnd', { id: plugin.lastId() });
    await flush();
    expect(plugin.spoken.map((s) => s.text)).toEqual(['Le chat dort.', 'Il rêve.']);

    engine.pause();
    await flush();
    expect(plugin.stops).toBe(1);
    expect(engine.getState().status).toBe('paused');
  });
});
