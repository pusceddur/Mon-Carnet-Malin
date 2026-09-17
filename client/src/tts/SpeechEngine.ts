// Read-aloud engine over the Web Speech API (§11.4, C4, §15.7).
// One utterance per sentence; pause = cancel + remember the sentence; resume = speak the sentence again.
// Every speak gets a new `generation`: events of older utterances (including the asynchronous `end` fired by cancel())
// are ignored, and a new speak waits at least CANCEL_GAP_MS after a cancel().
import { DEFAULT_TTS_PREFERENCES, PREFERENCE_RANGES, TIMINGS } from '@aide/shared';
import { requestWakeLock } from '../platform/support';
import { createNativeSpeechEnv, getNativeSpeechPlugin } from './nativeSpeech';
import { prepareSpokenText } from './speechText';
import { loadVoices, normalizeLang, pickFrenchVoice, sortFrenchVoices, type VoiceSource } from './voices';

export interface SpeechItem { id: string /* `${pageIndex}:${blockIndex}:${sentenceIndex}` */; text: string }
export interface SpeechState { status: 'idle' | 'playing' | 'paused'; index: number; itemId: string | null; rate: number; wordRange: { start: number; end: number } | null; supported: boolean }

/** Out-of-band notifications: end of the queue, or a failure the UI should show (toast). */
export type SpeechEvent =
  | { type: 'ended' }
  | { type: 'error'; kind: 'start_failed' | 'unsupported'; itemId: string | null };

type Handler<E> = ((event: E) => void) | null;

/** The part of SpeechSynthesisUtterance used by the engine. */
export interface UtteranceLike {
  text: string;
  lang: string;
  rate: number;
  pitch: number;
  voice: SpeechSynthesisVoice | null;
  onstart: Handler<unknown>;
  onend: Handler<unknown>;
  onerror: Handler<{ error?: string }>;
  onboundary: Handler<{ charIndex: number; charLength?: number; name?: string }>;
}

/** The part of SpeechSynthesis used by the engine. */
export interface SynthLike extends VoiceSource {
  speak(utterance: UtteranceLike): void;
  cancel(): void;
  resume?(): void;
  readonly speaking?: boolean;
  readonly pending?: boolean;
  readonly paused?: boolean;
}

export interface SpeechEnv {
  synth: SynthLike;
  createUtterance(text: string): UtteranceLike;
  document?: Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'>;
  /** Resolves with a release function (screen wake lock). */
  acquireWakeLock?: () => Promise<() => void>;
  now?: () => number;
}

/** Minimum delay between cancel() and the next speak() (Safari drops utterances spoken right after a cancel). */
export const CANCEL_GAP_MS = 50;
const MAX_START_RETRIES = 1;

export function clampRate(rate: number): number {
  const { min, max } = PREFERENCE_RANGES.ttsRate;
  if (!Number.isFinite(rate)) return DEFAULT_TTS_PREFERENCES.rate;
  return Math.round(Math.min(max, Math.max(min, rate)) * 100) / 100;
}

/** Word range from a `boundary` event; Safari may omit charLength, so the word is measured from the text. */
export function wordRangeAt(text: string, charIndex: number, charLength?: number): { start: number; end: number } | null {
  if (!Number.isFinite(charIndex) || charIndex < 0 || charIndex >= text.length) return null;
  if (charLength !== undefined && charLength > 0) return { start: charIndex, end: Math.min(text.length, charIndex + charLength) };
  const match = /^[\p{L}\p{N}]+(?:[-'’][\p{L}\p{N}]+)*/u.exec(text.slice(charIndex));
  return match ? { start: charIndex, end: charIndex + match[0].length } : null;
}

function sameRange(a: SpeechState['wordRange'], b: SpeechState['wordRange']): boolean {
  if (a === null || b === null) return a === b;
  return a.start === b.start && a.end === b.end;
}

export class SpeechEngine {
  private readonly listeners = new Set<(s: SpeechState) => void>();
  private readonly eventListeners = new Set<(e: SpeechEvent) => void>();
  private readonly injectedEnv: SpeechEnv | null;
  private browserEnv: SpeechEnv | null = null;
  private state: SpeechState;
  private queue: SpeechItem[] = [];
  private index = 0;
  private generation = 0;
  private lastCancelAt = Number.NEGATIVE_INFINITY;
  private speakTimer: ReturnType<typeof setTimeout> | null = null;
  private watchdogTimer: ReturnType<typeof setTimeout> | null = null;
  private startRetries = 0;
  private onceActive = false;
  private pitch: number = DEFAULT_TTS_PREFERENCES.pitch;
  private sentencePauseMs: number = DEFAULT_TTS_PREFERENCES.sentencePauseMs;
  private paragraphPauseMs: number = DEFAULT_TTS_PREFERENCES.paragraphPauseMs;
  private voiceURI: string | null = null;
  private voice: SpeechSynthesisVoice | null = null;
  private voiceResolved = false;
  private wakeRelease: (() => void) | null = null;
  private wakePending = false;
  private wakeToken = 0;
  private visibilityBound = false;

  constructor(env?: SpeechEnv) {
    this.injectedEnv = env ?? null;
    this.state = {
      status: 'idle',
      index: 0,
      itemId: null,
      rate: DEFAULT_TTS_PREFERENCES.rate,
      wordRange: null,
      supported: env ? true : SpeechEngine.isSupported(),
    };
  }

  static isSupported(): boolean {
    if (getNativeSpeechPlugin() !== null) return true;
    try {
      return typeof window !== 'undefined'
        && typeof window.speechSynthesis === 'object' && window.speechSynthesis !== null
        && typeof SpeechSynthesisUtterance === 'function';
    } catch {
      return false;
    }
  }

  getState(): SpeechState {
    return this.state;
  }

  async frenchVoices(): Promise<SpeechSynthesisVoice[]> {
    const env = this.env();
    if (!env) return [];
    return sortFrenchVoices(await loadVoices(env.synth));
  }

  /**
   * Replaces the queue. While playing or paused, when the current item id still exists the position is kept and speech
   * is not interrupted (pages that finish processing extend the queue); otherwise speech stops at `startIndex`.
   */
  setQueue(items: SpeechItem[], startIndex = 0): void {
    const currentId = this.queue[this.index]?.id ?? null;
    if (this.state.status !== 'idle' && currentId !== null) {
      const found = items.findIndex((item) => item.id === currentId);
      if (found >= 0) {
        this.queue = items.slice();
        this.index = found;
        this.patch({ index: found, itemId: currentId });
        return;
      }
    }
    if (this.state.status !== 'idle') this.halt('idle');
    this.queue = items.slice();
    this.index = this.clampIndex(startIndex);
    this.patch({ status: 'idle', index: this.index, itemId: this.currentId(), wordRange: null });
  }

  /** Starts or resumes. Call it from a tap handler: the first speak() must happen inside a user gesture (iOS). */
  play(): void {
    const env = this.env();
    if (!env) {
      this.emitEvent({ type: 'error', kind: 'unsupported', itemId: null });
      return;
    }
    if (this.state.status === 'playing' || this.queue.length === 0) return;
    this.index = this.clampIndex(this.index);
    this.startRetries = 0;
    this.bindVisibility(env);
    if (this.onceActive || env.synth.speaking === true || env.synth.pending === true) this.cancelSynth(env);
    this.onceActive = false;
    this.patch({ status: 'playing', index: this.index, itemId: this.currentId(), wordRange: null });
    this.holdWakeLock(env);
    this.scheduleSpeak(env);
  }

  pause(): void {
    if (this.state.status !== 'playing') return;
    this.halt('paused');
  }

  stop(): void {
    if (this.state.status === 'idle' && !this.onceActive && this.speakTimer === null) return;
    this.halt('idle');
  }

  next(): void {
    if (this.index + 1 >= this.queue.length) return;
    this.moveTo(this.index + 1);
  }

  previous(): void {
    if (this.queue.length === 0) return;
    this.moveTo(Math.max(0, this.index - 1));
  }

  /** Jumps to an item (tap on a sentence while listening). */
  seek(index: number): void {
    if (this.queue.length === 0) return;
    this.moveTo(this.clampIndex(index));
  }

  setRate(rate: number): void {
    const next = clampRate(rate);
    if (next === this.state.rate) return;
    this.patch({ rate: next });
    // Rate cannot change inside an utterance: restart the current sentence.
    if (this.state.status === 'playing') this.moveTo(this.index);
  }

  setPitch(pitch: number): void {
    const { min, max } = PREFERENCE_RANGES.ttsPitch;
    this.pitch = Number.isFinite(pitch) ? Math.min(max, Math.max(min, pitch)) : DEFAULT_TTS_PREFERENCES.pitch;
  }

/** Silences between sentences and before a new paragraph (ms). */
  setPauses(sentencePauseMs: number, paragraphPauseMs: number): void {
    const clamp = (value: number, range: { min: number; max: number }, fallback: number): number =>
      Number.isFinite(value) ? Math.round(Math.min(range.max, Math.max(range.min, value))) : fallback;
    this.sentencePauseMs = clamp(sentencePauseMs, PREFERENCE_RANGES.ttsSentencePauseMs, DEFAULT_TTS_PREFERENCES.sentencePauseMs);
    this.paragraphPauseMs = clamp(paragraphPauseMs, PREFERENCE_RANGES.ttsParagraphPauseMs, DEFAULT_TTS_PREFERENCES.paragraphPauseMs);
  }

  setVoice(voiceURI: string | null): void {
    this.voiceURI = voiceURI;
    this.voice = null;
    this.voiceResolved = false;
    const env = this.env();
    if (!env) return;
    void loadVoices(env.synth).then((voices) => {
      if (this.voiceURI !== voiceURI) return;
      this.voice = pickFrenchVoice(voices, voiceURI);
      this.voiceResolved = voices.length > 0;
    });
  }

  /** For « 🔊 Lire » on a selection / an answer. Pauses the queue if it was playing. */
  speakOnce(text: string): void {
    const env = this.env();
    if (!env) {
      this.emitEvent({ type: 'error', kind: 'unsupported', itemId: null });
      return;
    }
    const clean = text.trim();
    if (clean === '') return;
    this.bindVisibility(env);
    if (this.state.status === 'playing') this.halt('paused');
    else if (this.onceActive || env.synth.speaking === true || env.synth.pending === true) this.cancelSynth(env);
    this.clearTimers();
    const gen = ++this.generation;
    const speak = (): void => {
      this.speakTimer = null;
      if (gen !== this.generation) return;
      const spokenText = prepareSpokenText(clean).text;
      if (spokenText === '') return;
      const utterance = env.createUtterance(spokenText);
      this.configure(env, utterance);
      const done = (): void => {
        if (gen === this.generation) this.onceActive = false;
      };
      utterance.onend = done;
      utterance.onerror = done;
      this.onceActive = true;
      try {
        if (env.synth.paused === true) env.synth.resume?.();
        env.synth.speak(utterance);
      } catch {
        this.onceActive = false;
      }
    };
    const wait = this.gapBeforeSpeak(env);
    if (wait > 0) this.speakTimer = setTimeout(speak, wait);
    else speak();
  }

  subscribe(listener: (s: SpeechState) => void): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => {
      this.listeners.delete(listener);
    };
  }

  subscribeEvents(listener: (e: SpeechEvent) => void): () => void {
    this.eventListeners.add(listener);
    return () => {
      this.eventListeners.delete(listener);
    };
  }

  // ---------- internals ----------

  private env(): SpeechEnv | null {
    if (this.injectedEnv) return this.injectedEnv;
    if (this.browserEnv) return this.browserEnv;
    // iPad app: system voices, including the downloaded « Premium » voices Safari does not expose.
    const native = getNativeSpeechPlugin();
    if (native) {
      this.browserEnv = createNativeSpeechEnv(native, typeof document === 'undefined' ? {} : { document });
      return this.browserEnv;
    }
    if (!SpeechEngine.isSupported()) return null;
    this.browserEnv = {
      synth: window.speechSynthesis as unknown as SynthLike,
      createUtterance: (text) => new SpeechSynthesisUtterance(text) as unknown as UtteranceLike,
      document: typeof document === 'undefined' ? undefined : document,
      acquireWakeLock: () => requestWakeLock(),
    };
    return this.browserEnv;
  }

  private now(env: SpeechEnv): number {
    return env.now ? env.now() : Date.now();
  }

  private currentId(): string | null {
    return this.queue[this.index]?.id ?? null;
  }

  private clampIndex(index: number): number {
    if (this.queue.length === 0 || !Number.isFinite(index)) return 0;
    return Math.min(this.queue.length - 1, Math.max(0, Math.trunc(index)));
  }

  private gapBeforeSpeak(env: SpeechEnv): number {
    return Math.max(0, CANCEL_GAP_MS - (this.now(env) - this.lastCancelAt));
  }

  private cancelSynth(env: SpeechEnv): void {
    this.lastCancelAt = this.now(env);
    try {
      env.synth.cancel();
    } catch {
      // Nothing to cancel.
    }
  }

  private clearTimers(): void {
    if (this.speakTimer !== null) clearTimeout(this.speakTimer);
    if (this.watchdogTimer !== null) clearTimeout(this.watchdogTimer);
    this.speakTimer = null;
    this.watchdogTimer = null;
  }

  /** Stops speech (generation bumped before cancel) and settles in `status`. */
  private halt(status: 'idle' | 'paused'): void {
    this.generation += 1;
    this.clearTimers();
    const env = this.env();
    if (env) this.cancelSynth(env);
    this.onceActive = false;
    this.dropWakeLock();
    this.patch({ status, index: this.index, itemId: this.currentId(), wordRange: null });
  }

  private moveTo(index: number): void {
    if (this.state.status !== 'playing') {
      this.index = index;
      this.patch({ index, itemId: this.currentId(), wordRange: null });
      return;
    }
    const env = this.env();
    if (!env) return;
    this.generation += 1;
    this.clearTimers();
    this.cancelSynth(env);
    this.index = index;
    this.startRetries = 0;
    this.scheduleSpeak(env);
  }

  private scheduleSpeak(env: SpeechEnv, pauseMs = 0): void {
    if (this.speakTimer !== null) clearTimeout(this.speakTimer);
    this.speakTimer = null;
    const gen = ++this.generation;
    const wait = Math.max(this.gapBeforeSpeak(env), pauseMs);
    if (wait > 0) {
      this.speakTimer = setTimeout(() => {
        this.speakTimer = null;
        this.speakNow(env, gen);
      }, wait);
    } else {
      this.speakNow(env, gen);
    }
  }

  private speakNow(env: SpeechEnv, gen: number): void {
    if (gen !== this.generation || this.state.status !== 'playing') return;
    const item = this.queue[this.index];
    if (!item) {
      this.finish();
      return;
    }
    const spoken = prepareSpokenText(item.text);
    if (spoken.text === '') {
      // Nothing to say (OCR noise only): go on without a pause.
      if (this.index + 1 < this.queue.length) {
        this.index += 1;
        this.scheduleSpeak(env);
      } else {
        this.finish();
      }
      return;
    }
    const utterance = env.createUtterance(spoken.text);
    this.configure(env, utterance);
    utterance.onstart = () => {
      if (gen !== this.generation) return;
      this.clearWatchdog();
      this.startRetries = 0;
      this.patch({ index: this.index, itemId: item.id, wordRange: null });
    };
    utterance.onend = () => {
      if (gen !== this.generation) return;
      this.clearWatchdog();
      if (this.index + 1 < this.queue.length) {
        const pause = this.pauseAfter(item, this.queue[this.index + 1]!);
        this.index += 1;
        this.scheduleSpeak(env, pause);
      } else {
        this.finish();
      }
    };
    utterance.onerror = (event) => {
      if (gen !== this.generation) return;
      this.clearWatchdog();
      const code = event?.error;
      // Interrupted by the system (another app, a call): settle in pause, never resume on our own.
      if (code === 'interrupted' || code === 'canceled') this.halt('paused');
      else this.retryOrFail(env);
    };
    utterance.onboundary = (event) => {
      if (gen !== this.generation) return;
      if (event.name !== undefined && event.name !== 'word') return;
      if (!Number.isFinite(event.charIndex)) return;
      const start = spoken.toSource(event.charIndex);
      const range = wordRangeAt(item.text, start);
      if (range) this.patch({ wordRange: range });
    };
    try {
      if (env.synth.paused === true) env.synth.resume?.();
      env.synth.speak(utterance);
    } catch {
      this.retryOrFail(env);
      return;
    }
    this.clearWatchdog();
    this.watchdogTimer = setTimeout(() => {
      this.watchdogTimer = null;
      if (gen !== this.generation || this.state.status !== 'playing') return;
      this.retryOrFail(env);
    }, TIMINGS.ttsWatchdogMs);
  }

/** Longer silence when the next sentence belongs to another paragraph (ids are "page:block:sentence"). */
  private pauseAfter(current: SpeechItem, next: SpeechItem): number {
    const block = (id: string): string => id.split(':').slice(0, 2).join(':');
    return block(current.id) === block(next.id) ? this.sentencePauseMs : this.paragraphPauseMs;
  }

  private clearWatchdog(): void {
    if (this.watchdogTimer !== null) clearTimeout(this.watchdogTimer);
    this.watchdogTimer = null;
  }

  /** Watchdog / synthesis error: cancel and try once more, then give up (idle + event for a toast). */
  private retryOrFail(env: SpeechEnv): void {
    if (this.startRetries < MAX_START_RETRIES) {
      this.startRetries += 1;
      this.clearWatchdog();
      this.cancelSynth(env);
      this.scheduleSpeak(env);
      return;
    }
    const itemId = this.currentId();
    this.halt('idle');
    this.emitEvent({ type: 'error', kind: 'start_failed', itemId });
  }

  private finish(): void {
    this.generation += 1;
    this.clearTimers();
    this.dropWakeLock();
    this.patch({ status: 'idle', index: this.index, itemId: this.currentId(), wordRange: null });
    this.emitEvent({ type: 'ended' });
  }

  private configure(env: SpeechEnv, utterance: UtteranceLike): void {
    if (!this.voiceResolved) {
      try {
        const voices = env.synth.getVoices();
        if (voices.length > 0) {
          this.voice = pickFrenchVoice(voices, this.voiceURI);
          this.voiceResolved = true;
        }
      } catch {
        // Voices not available yet.
      }
    }
    if (this.voice) utterance.voice = this.voice;
    utterance.lang = this.voice ? normalizeLang(this.voice.lang) : 'fr-FR';
    utterance.rate = this.state.rate;
    utterance.pitch = this.pitch;
  }

  private bindVisibility(env: SpeechEnv): void {
    const doc = env.document;
    if (this.visibilityBound || !doc) return;
    this.visibilityBound = true;
    doc.addEventListener('visibilitychange', () => {
      if (doc.visibilityState !== 'hidden') return;
      // No automatic resume when the page comes back.
      if (this.state.status === 'playing') this.halt('paused');
      else if (this.onceActive) {
        this.generation += 1;
        this.cancelSynth(env);
        this.onceActive = false;
      }
    });
  }

  private holdWakeLock(env: SpeechEnv): void {
    if (this.wakeRelease !== null || this.wakePending || !env.acquireWakeLock) return;
    const token = ++this.wakeToken;
    this.wakePending = true;
    env.acquireWakeLock().then(
      (release) => {
        if (token !== this.wakeToken) {
          release();
          return;
        }
        this.wakePending = false;
        this.wakeRelease = release;
      },
      () => {
        if (token === this.wakeToken) this.wakePending = false;
      },
    );
  }

  private dropWakeLock(): void {
    this.wakeToken += 1;
    this.wakePending = false;
    const release = this.wakeRelease;
    this.wakeRelease = null;
    release?.();
  }

  private patch(changes: Partial<SpeechState>): void {
    const next: SpeechState = { ...this.state, ...changes };
    const prev = this.state;
    if (
      next.status === prev.status && next.index === prev.index && next.itemId === prev.itemId && next.rate === prev.rate
      && next.supported === prev.supported && sameRange(next.wordRange, prev.wordRange)
    ) {
      return;
    }
    this.state = next;
    for (const listener of Array.from(this.listeners)) listener(next);
  }

  private emitEvent(event: SpeechEvent): void {
    for (const listener of Array.from(this.eventListeners)) listener(event);
  }
}

export const speechEngine: SpeechEngine = new SpeechEngine();
