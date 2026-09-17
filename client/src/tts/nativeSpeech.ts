// Speech environment backed by the iPad system voices (native app only).
// Safari only exposes the pre-installed voices to web pages; the native speech engine of the app also sees the
// « Améliorée » / « Premium » voices downloaded in Réglages › Accessibilité › Contenu énoncé › Voix.
import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { isNativePluginAvailable } from '../platform/nativeApp';
import type { SpeechEnv, SynthLike, UtteranceLike } from './SpeechEngine';
import type { VoiceLike, VoiceQuality } from './voices';

export const NATIVE_SPEECH_PLUGIN = 'NativeSpeech';

export interface NativeVoice {
  identifier: string;
  name: string;
  language: string;
  quality: 'default' | 'enhanced' | 'premium';
  novelty: boolean;
  personal: boolean;
}

export interface NativeSpeakOptions {
  id: string;
  text: string;
  voiceIdentifier?: string;
  lang: string;
  /** Web Speech scale (1 = normal); the app converts it to the system scale. */
  rate: number;
  pitch: number;
  volume?: number;
}

export interface NativeSpeechPlugin {
  getVoices(): Promise<{ voices: NativeVoice[] }>;
  speak(options: NativeSpeakOptions): Promise<void>;
  stop(): Promise<void>;
  /** Keeps the screen on while reading aloud. */
  keepAwake(options: { enabled: boolean }): Promise<void>;
  addListener(event: 'speechStart' | 'speechEnd', listener: (event: { id: string }) => void): Promise<PluginListenerHandle>;
  addListener(event: 'speechRange', listener: (event: { id: string; start: number; length: number }) => void): Promise<PluginListenerHandle>;
  addListener(event: 'speechCancel', listener: (event: { id: string; reason: 'canceled' | 'interrupted' }) => void): Promise<PluginListenerHandle>;
}

/** Voice as seen by the engine: a SpeechSynthesisVoice shape plus the quality reported by the system. */
export type NativeVoiceLike = VoiceLike & { qualityHint: VoiceQuality };

export function nativeVoiceToVoice(voice: NativeVoice): NativeVoiceLike {
  const qualityHint: VoiceQuality = voice.novelty ? 'robotic' : voice.quality === 'premium' ? 'premium' : voice.quality === 'enhanced' ? 'enhanced' : 'standard';
  return { voiceURI: voice.identifier, name: voice.name, lang: voice.language, localService: true, default: false, qualityHint };
}

let plugin: NativeSpeechPlugin | null = null;

/** The plugin when running inside the iPad app, otherwise null. */
export function getNativeSpeechPlugin(): NativeSpeechPlugin | null {
  if (!isNativePluginAvailable(NATIVE_SPEECH_PLUGIN)) return null;
  plugin ??= registerPlugin<NativeSpeechPlugin>(NATIVE_SPEECH_PLUGIN);
  return plugin;
}

export interface NativeSpeechEnvOptions {
  document?: SpeechEnv['document'];
  now?: () => number;
}

/**
 * SpeechEnv over the native plugin, with the Web Speech semantics the engine relies on:
 * voices load asynchronously (`voiceschanged`), cancel() makes pending utterances silent, a system interruption
 * (phone call, other audio) is reported as the `interrupted` error.
 */
export function createNativeSpeechEnv(native: NativeSpeechPlugin, options: NativeSpeechEnvOptions = {}): SpeechEnv {
  let voices: SpeechSynthesisVoice[] = [];
  const voiceListeners = new Set<() => void>();
  const utterances = new Map<string, UtteranceLike>();
  let speakingId: string | null = null;
  let counter = 0;

  void native.getVoices().then(
    ({ voices: list }) => {
      voices = list.filter((v) => !v.personal).map((v) => nativeVoiceToVoice(v) as unknown as SpeechSynthesisVoice);
      for (const listener of voiceListeners) listener();
    },
    () => undefined,
  );

  const listen = (register: () => Promise<PluginListenerHandle>): void => {
    register().catch(() => undefined);
  };
  listen(() => native.addListener('speechStart', ({ id }) => {
    const utterance = utterances.get(id);
    if (!utterance) return;
    speakingId = id;
    utterance.onstart?.({});
  }));
  listen(() => native.addListener('speechRange', ({ id, start, length }) => {
    utterances.get(id)?.onboundary?.({ charIndex: start, charLength: length, name: 'word' });
  }));
  listen(() => native.addListener('speechEnd', ({ id }) => {
    const utterance = utterances.get(id);
    if (!utterance) return;
    utterances.delete(id);
    if (speakingId === id) speakingId = null;
    utterance.onend?.({});
  }));
  listen(() => native.addListener('speechCancel', ({ id, reason }) => {
    const utterance = utterances.get(id);
    if (!utterance) return;
    utterances.delete(id);
    if (speakingId === id) speakingId = null;
    utterance.onerror?.({ error: reason === 'interrupted' ? 'interrupted' : 'canceled' });
  }));

  const synth: SynthLike = {
    getVoices: () => voices,
    addEventListener: (_type, listener) => {
      voiceListeners.add(listener);
    },
    removeEventListener: (_type, listener) => {
      voiceListeners.delete(listener);
    },
    speak(utterance) {
      counter += 1;
      const id = `u${counter}`;
      utterances.set(id, utterance);
      const request: NativeSpeakOptions = {
        id,
        text: utterance.text,
        lang: utterance.lang || 'fr-FR',
        rate: utterance.rate,
        pitch: utterance.pitch,
        ...(utterance.voice ? { voiceIdentifier: utterance.voice.voiceURI } : {}),
      };
      native.speak(request).catch(() => {
        if (!utterances.delete(id)) return;
        utterance.onerror?.({ error: 'synthesis-failed' });
      });
    },
    cancel() {
      // Events of the utterances cancelled here are never delivered (the engine already moved on).
      utterances.clear();
      speakingId = null;
      native.stop().catch(() => undefined);
    },
    resume() {
      // Pause is implemented by the engine as cancel + speak again.
    },
    get speaking() {
      return speakingId !== null;
    },
    get pending() {
      return utterances.size > 0 && speakingId === null;
    },
    get paused() {
      return false;
    },
  };

  return {
    synth,
    createUtterance: (text) => ({
      text, lang: 'fr-FR', rate: 1, pitch: 1, voice: null, onstart: null, onend: null, onerror: null, onboundary: null,
    }),
    ...(options.document ? { document: options.document } : {}),
    ...(options.now ? { now: options.now } : {}),
    acquireWakeLock: async () => {
      await native.keepAwake({ enabled: true }).catch(() => undefined);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        native.keepAwake({ enabled: false }).catch(() => undefined);
      };
    },
  };
}
