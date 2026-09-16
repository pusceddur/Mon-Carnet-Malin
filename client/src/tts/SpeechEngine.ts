// STUB: client-reader
import { DEFAULT_TTS_PREFERENCES } from '@aide/shared';

export interface SpeechItem { id: string /* `${pageIndex}:${blockIndex}:${sentenceIndex}` */; text: string }
export interface SpeechState { status: 'idle' | 'playing' | 'paused'; index: number; itemId: string | null; rate: number; wordRange: { start: number; end: number } | null; supported: boolean }

export class SpeechEngine {
  private listeners = new Set<(s: SpeechState) => void>();
  private queue: SpeechItem[] = [];
  private state: SpeechState = {
    status: 'idle',
    index: 0,
    itemId: null,
    rate: DEFAULT_TTS_PREFERENCES.rate,
    wordRange: null,
    supported: SpeechEngine.isSupported(),
  };

  static isSupported(): boolean {
    return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';
  }

  frenchVoices(): Promise<SpeechSynthesisVoice[]> {
    return Promise.resolve([]);
  }

  setQueue(items: SpeechItem[], startIndex = 0): void {
    this.queue = items;
    this.emit({ index: startIndex, itemId: items[startIndex]?.id ?? null, status: 'idle', wordRange: null });
  }

  play(): void {}
  pause(): void {}
  stop(): void {
    this.emit({ status: 'idle', wordRange: null });
  }
  next(): void {}
  previous(): void {}

  setRate(rate: number): void {
    this.emit({ rate });
  }

  setVoice(voiceURI: string | null): void {
    void voiceURI;
  }

  /** For « 🔊 Lire » on a selection / answers. */
  speakOnce(text: string): void {
    void text;
  }

  subscribe(listener: (s: SpeechState) => void): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(patch: Partial<SpeechState>): void {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l(this.state);
  }
}

export const speechEngine: SpeechEngine = new SpeechEngine();
