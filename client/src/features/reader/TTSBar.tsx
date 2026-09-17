import { PREFERENCE_RANGES } from '@aide/shared';
import type { JSX } from 'react';
import { IconButton } from '../../design/components';
import { format } from '../../i18n/fr';
import { tts as t } from '../../i18n/fr/tts';
import type { SpeechState } from '../../tts/SpeechEngine';

export const RATE_STEP = 0.05;

const rateFormat = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export interface TTSBarProps {
  state: SpeechState;
  rate: number;
  canPrevious: boolean;
  canNext: boolean;
  onPlay(): void;
  onPause(): void;
  onStop(): void;
  onPrevious(): void;
  onNext(): void;
  onRateChange(rate: number): void;
  onClose(): void;
}

/** ▶︎ ⏸ ⏹ ⏮ ⏭ + speed. Playback starts only from these taps (iOS user-gesture rule). */
export function TTSBar({ state, rate, canPrevious, canNext, onPlay, onPause, onStop, onPrevious, onNext, onRateChange, onClose }: TTSBarProps): JSX.Element {
  const playing = state.status === 'playing';
  const { min, max } = PREFERENCE_RANGES.ttsRate;
  const round = (value: number): number => Math.round(value * 100) / 100;

  if (!state.supported) {
    return (
      <div className="rd-tts rd-tts--unsupported" role="status">
        <p className="rd-tts__notice">{t.unsupported}</p>
        <IconButton aria-label={t.close} icon="✕" onClick={onClose} />
      </div>
    );
  }

  return (
    <div className="rd-tts" role="toolbar" aria-label={t.barLabel}>
      <div className="rd-tts__transport">
        <IconButton aria-label={t.previous} icon="⏮" disabled={!canPrevious} onClick={onPrevious} />
        {playing
          ? <IconButton aria-label={t.pause} icon="⏸" variant="primary" onClick={onPause} className="rd-tts__main" />
          : <IconButton aria-label={state.status === 'paused' ? t.resume : t.play} icon="▶︎" variant="primary" onClick={onPlay} className="rd-tts__main" />}
        <IconButton aria-label={t.stop} icon="⏹" disabled={state.status === 'idle'} onClick={onStop} />
        <IconButton aria-label={t.next} icon="⏭" disabled={!canNext} onClick={onNext} />
      </div>
      <div className="rd-tts__rate" role="group" aria-label={t.rate}>
        <IconButton aria-label={t.slower} icon="🐢" disabled={rate <= min} onClick={() => onRateChange(Math.max(min, round(rate - RATE_STEP)))} />
        <output className="rd-tts__rate-value" aria-live="polite">
          <span className="visually-hidden">{t.rate} </span>
          {format(t.rateValue, { value: rateFormat.format(rate) })}
        </output>
        <IconButton aria-label={t.faster} icon="🐇" disabled={rate >= max} onClick={() => onRateChange(Math.min(max, round(rate + RATE_STEP)))} />
      </div>
      <IconButton aria-label={t.close} icon="✕" onClick={onClose} className="rd-tts__close" />
    </div>
  );
}
