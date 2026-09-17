// Fake Web Speech API for engine tests: cancel() fires `end` asynchronously, like Safari.
import type { SynthLike, UtteranceLike } from '../../src/tts/SpeechEngine';
import type { VoiceLike } from '../../src/tts/voices';

export class FakeUtterance implements UtteranceLike {
  text: string;
  lang = '';
  rate = 1;
  pitch = 1;
  voice: SpeechSynthesisVoice | null = null;
  onstart: UtteranceLike['onstart'] = null;
  onend: UtteranceLike['onend'] = null;
  onerror: UtteranceLike['onerror'] = null;
  onboundary: UtteranceLike['onboundary'] = null;

  constructor(text: string) {
    this.text = text;
  }
}

export class FakeSynth implements SynthLike {
  spoken: FakeUtterance[] = [];
  current: FakeUtterance | null = null;
  cancelCount = 0;
  voices: VoiceLike[] = [];
  /** When false, `start` is never fired (watchdog tests). */
  autoStart = true;
  speaking = false;
  pending = false;
  paused = false;

  speak(utterance: UtteranceLike): void {
    const u = utterance as FakeUtterance;
    this.spoken.push(u);
    this.current = u;
    this.speaking = true;
    if (this.autoStart) setTimeout(() => u.onstart?.({}), 0);
  }

  cancel(): void {
    this.cancelCount += 1;
    const u = this.current;
    this.current = null;
    this.speaking = false;
    if (u) setTimeout(() => u.onend?.({}), 0);
  }

  getVoices(): SpeechSynthesisVoice[] {
    return this.voices as unknown as SpeechSynthesisVoice[];
  }

  /** Natural end of the utterance being spoken. */
  finishCurrent(): void {
    const u = this.current;
    this.current = null;
    this.speaking = false;
    u?.onend?.({});
  }

  get texts(): string[] {
    return this.spoken.map((u) => u.text);
  }
}

export function voice(voiceURI: string, lang: string, localService = true, name = voiceURI): VoiceLike {
  return { voiceURI, name, lang, localService, default: false };
}

export class FakeDocument {
  visibilityState: DocumentVisibilityState = 'visible';
  private listeners: (() => void)[] = [];

  addEventListener(_type: string, listener: () => void): void {
    this.listeners.push(listener);
  }

  removeEventListener(_type: string, listener: () => void): void {
    this.listeners = this.listeners.filter((l) => l !== listener);
  }

  setVisibility(state: DocumentVisibilityState): void {
    this.visibilityState = state;
    for (const l of this.listeners) l();
  }
}
