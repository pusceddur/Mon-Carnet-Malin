import type { JSX } from 'react';
import { common } from '../../i18n/fr/common';
import { cx } from './internal/cx';
import './Spinner.css';

export interface SpinnerProps {
  /** sm 20px · md 32px (default) · lg 48px. */
  size?: 'sm' | 'md' | 'lg';
  /** Announced text (default « Chargement… »). Ignored when `decorative`. */
  label?: string;
  /** Purely visual (e.g. inside a button that already exposes aria-busy). */
  decorative?: boolean;
  className?: string;
}

/** Loading indicator. Announces its label politely unless decorative. */
export function Spinner({ size = 'md', label = common.loading, decorative = false, className }: SpinnerProps): JSX.Element {
  const svg = (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" className="ui-spinner__svg">
      <circle className="ui-spinner__track" cx="12" cy="12" r="9" />
      <path className="ui-spinner__arc" d="M12 3a9 9 0 0 1 9 9" />
    </svg>
  );
  if (decorative) {
    return (
      <span className={cx('ui-spinner', `ui-spinner--${size}`, className)} aria-hidden="true">
        {svg}
      </span>
    );
  }
  return (
    <span className={cx('ui-spinner', `ui-spinner--${size}`, className)} role="status">
      {svg}
      <span className="visually-hidden">{label}</span>
    </span>
  );
}
