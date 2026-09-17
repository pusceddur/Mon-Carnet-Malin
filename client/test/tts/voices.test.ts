import { afterAll, describe, expect, it, vi } from 'vitest';
import { db } from '../../src/db/localDb';
import {
  getStoredVoiceURI,
  isFrenchVoice,
  loadVoices,
  normalizeLang,
  bestFrenchVoiceQuality,
  pickFrenchVoice,
  setStoredVoiceURI,
  sortFrenchVoices,
  voiceQuality,
  type VoiceSource,
} from '../../src/tts/voices';
import { voice } from './fakeSpeech';

describe('voices', () => {
  afterAll(() => {
    db.close();
  });

  it('normalizes language tags', () => {
    expect(normalizeLang('fr_fr')).toBe('fr-FR');
    expect(normalizeLang('FR')).toBe('fr');
    expect(isFrenchVoice({ lang: 'fr-CA' })).toBe(true);
    expect(isFrenchVoice({ lang: 'en-FR' })).toBe(false);
  });

  it('sorts French voices: fr-FR first, on-device first, then by name', () => {
    const list = [
      voice('b', 'fr-CA', true, 'Amélie'),
      voice('c', 'fr-FR', false, 'Audrey'),
      voice('d', 'en-GB', true, 'Daniel'),
      voice('e', 'fr-FR', true, 'Thomas'),
      voice('f', 'fr-FR', true, 'Marie'),
    ];
    expect(sortFrenchVoices(list).map((v) => v.voiceURI)).toEqual(['f', 'e', 'c', 'b']);
  });

  it('picks the preferred voice when installed, otherwise the best French voice, otherwise null', () => {
    const list = [voice('ca', 'fr-CA', true), voice('fr-remote', 'fr-FR', false), voice('en', 'en-US', true)];
    expect(pickFrenchVoice(list, 'ca')?.voiceURI).toBe('ca');
    expect(pickFrenchVoice(list, 'gone')?.voiceURI).toBe('fr-remote');
    expect(pickFrenchVoice(list, null)?.voiceURI).toBe('fr-remote');
    expect(pickFrenchVoice([voice('en', 'en-US')], null)).toBeNull();
  });

  it('rates Apple, desktop and novelty voices by quality', () => {
    const q = (voiceURI: string, name: string, localService = true): string => voiceQuality({ voiceURI, name, localService });
    expect(q('com.apple.voice.premium.fr-FR.Audrey', 'Audrey (Premium)')).toBe('premium');
    expect(q('com.apple.voice.enhanced.fr-FR.Thomas', 'Thomas (Amélioré)')).toBe('enhanced');
    expect(q('x', 'Thomas (Amélioré)')).toBe('enhanced');
    expect(q('com.apple.voice.compact.fr-FR.Thomas', 'Thomas')).toBe('standard');
    expect(q('com.apple.ttsbundle.siri_Marie_fr-FR_compact', 'Marie')).toBe('enhanced');
    expect(q('com.apple.eloquence.fr-FR.Eddy', 'Eddy (français (France))')).toBe('robotic');
    expect(q('com.apple.speech.synthesis.voice.Grandma', 'Grand-mère (français (France))')).toBe('robotic');
    expect(q('x', 'Shelley')).toBe('robotic');
    expect(q('Microsoft Denise Online (Natural) - French (France)', 'Microsoft Denise Online (Natural) - French (France)', false)).toBe('natural');
    expect(q('Google français', 'Google français', false)).toBe('natural');
    expect(q('x', 'Premiumx')).toBe('standard');
  });

  it('never picks a robotic voice automatically when a real voice exists (Eddy sorts before Thomas by name)', () => {
    const list = [
      voice('com.apple.eloquence.fr-FR.Eddy', 'fr-FR', true, 'Eddy'),
      voice('com.apple.eloquence.fr-FR.Flo', 'fr-FR', true, 'Flo'),
      voice('com.apple.voice.compact.fr-FR.Thomas', 'fr-FR', true, 'Thomas'),
      voice('com.apple.voice.compact.fr-CA.Amelie', 'fr-CA', true, 'Amélie'),
    ];
    expect(pickFrenchVoice(list, null)?.name).toBe('Thomas');
    expect(sortFrenchVoices(list).map((v) => v.name)).toEqual(['Thomas', 'Amélie', 'Eddy', 'Flo']);
    expect(bestFrenchVoiceQuality(list)).toBe('standard');
    // Downloaded premium / enhanced voices win.
    const better = [...list, voice('com.apple.voice.enhanced.fr-FR.Thomas', 'fr-FR', true, 'Thomas (Amélioré)'), voice('com.apple.voice.premium.fr-FR.Audrey', 'fr-FR', true, 'Audrey (Premium)')];
    expect(pickFrenchVoice(better, null)?.name).toBe('Audrey (Premium)');
    expect(bestFrenchVoiceQuality(better)).toBe('premium');
    // Only robotic voices: still better than nothing.
    expect(pickFrenchVoice([list[0]!], null)?.name).toBe('Eddy');
  });

  it('prefers on-device voices over network voices when offline', () => {
    const list = [voice('google', 'fr-FR', false, 'Google français'), voice('thomas', 'fr-FR', true, 'Thomas')];
    expect(pickFrenchVoice(list, null, true)?.voiceURI).toBe('google');
    expect(pickFrenchVoice(list, null, false)?.voiceURI).toBe('thomas');
  });

  it('waits for voices that load late', async () => {
    vi.useFakeTimers();
    let voices: SpeechSynthesisVoice[] = [];
    const source: VoiceSource = { getVoices: () => voices };
    const promise = loadVoices(source, 2000, 100);
    voices = [voice('x', 'fr-FR') as unknown as SpeechSynthesisVoice];
    await vi.advanceTimersByTimeAsync(100);
    await expect(promise).resolves.toHaveLength(1);

    voices = [];
    const empty = loadVoices(source, 500, 100);
    await vi.advanceTimersByTimeAsync(500);
    await expect(empty).resolves.toEqual([]);
    vi.useRealTimers();
  });

  it('stores the voice per device in kv', async () => {
    expect(await getStoredVoiceURI()).toBeNull();
    await setStoredVoiceURI('com.apple.voice.fr-FR.Thomas');
    expect(await getStoredVoiceURI()).toBe('com.apple.voice.fr-FR.Thomas');
    expect((await db.kv.get('ttsVoiceURI'))?.value).toBe('com.apple.voice.fr-FR.Thomas');
    await setStoredVoiceURI(null);
    expect(await getStoredVoiceURI()).toBeNull();
  });
});
