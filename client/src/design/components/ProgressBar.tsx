import { useId, type JSX } from 'react';
import { format } from '../../i18n/fr';
import { common } from '../../i18n/fr/common';
import { cx } from './internal/cx';
import './ProgressBar.css';

export interface ProgressBarProps {
  /** Current value, or `null` for an indeterminate bar. */
  value: number | null;
  /** Default 100. */
  max?: number;
  /** Visible label and accessible name (« Chapitre »). */
  label: string;
  /** Keeps the label for assistive tech only. */
  hideLabel?: boolean;
  /** Shows the percentage next to the label. Default true. */
  showValue?: boolean;
  /** Replaces the percentage text (« Page 13 sur 25 »), also used as aria-valuetext. */
  valueText?: string;
  /** Default `accent`. */
  tone?: 'accent' | 'ok' | 'warm';
  className?: string;
}

/** Percentage of `value` over `max`, clamped to 0..100 and rounded. */
export function progressPercent(value: number, max = 100): number {
  if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0) return 0;
  return Math.round(Math.min(100, Math.max(0, (value / max) * 100)));
}

/** Horizontal progress bar with a visible, accessible label. */
export function ProgressBar({
  value,
  max = 100,
  label,
  hideLabel = false,
  showValue = true,
  valueText,
  tone = 'accent',
  className,
}: ProgressBarProps): JSX.Element {
  const labelId = useId();
  const indeterminate = value === null;
  const percent = indeterminate ? 0 : progressPercent(value, max);
  const text = valueText ?? (indeterminate ? undefined : format(common.progress.percent, { value: percent }));

  return (
    <div className={cx('ui-progress', `ui-progress--${tone}`, indeterminate && 'ui-progress--indeterminate', className)}>
      <div className={cx('ui-progress__top', hideLabel && !showValue && 'visually-hidden')}>
        <span id={labelId} className={cx('ui-progress__label', hideLabel && 'visually-hidden')}>
          {label}
        </span>
        {showValue && text !== undefined && (
          <span className="ui-progress__value" aria-hidden="true">
            {text}
          </span>
        )}
      </div>
      <div
        className="ui-progress__track"
        role="progressbar"
        aria-labelledby={labelId}
        aria-valuemin={indeterminate ? undefined : 0}
        aria-valuemax={indeterminate ? undefined : 100}
        aria-valuenow={indeterminate ? undefined : percent}
        aria-valuetext={text}
      >
        <div className="ui-progress__fill" style={indeterminate ? undefined : { transform: `scaleX(${percent / 100})` }} />
      </div>
    </div>
  );
}
