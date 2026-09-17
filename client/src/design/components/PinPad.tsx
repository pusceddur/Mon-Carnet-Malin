import { LIMITS } from '@aide/shared';
import { useEffect, useId, useLayoutEffect, useRef, useState, type JSX } from 'react';
import { format } from '../../i18n/fr';
import { common } from '../../i18n/fr/common';
import { cx } from './internal/cx';
import { isEditableTarget } from './internal/focus';
import { BackspaceIcon, CheckIcon } from './internal/icons';
import { appendDigit, canSubmitPin, pinSlotCount, removeLastDigit, resolvePinRules } from './internal/pin';
import { Spinner } from './Spinner';
import './PinPad.css';

export interface PinPadProps {
  /** Visible heading and group name (« Code des réglages »). */
  label: string;
  /** Receives the digits; the entry is cleared right after. */
  onSubmit: (pin: string) => void;
  /** Exact number of digits: submits automatically when reached. */
  length?: number;
  /** Default 4 (LIMITS.pinMinDigits). Ignored when `length` is set. */
  minLength?: number;
  /** Default 8 (LIMITS.pinMaxDigits). Ignored when `length` is set. */
  maxLength?: number;
  /** Short help under the heading. */
  hint?: string;
  /** Error message, shown while the entry is empty (typing a new digit hides it). */
  error?: string | null;
  /** Verification in progress: keys disabled, spinner shown. */
  busy?: boolean;
  disabled?: boolean;
  /** Called with the number of digits entered (never exposes the digits). */
  onLengthChange?: (length: number) => void;
  /** Listen to a hardware keyboard (digits, Backspace, Enter). Default true. */
  keyboard?: boolean;
  className?: string;
}

const DIGIT_ROWS = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
] as const;

/** Large masked numeric keypad for PIN codes (4 to 8 digits). */
export function PinPad({
  label,
  onSubmit,
  length,
  minLength = LIMITS.pinMinDigits,
  maxLength = LIMITS.pinMaxDigits,
  hint,
  error = null,
  busy = false,
  disabled = false,
  onLengthChange,
  keyboard = true,
  className,
}: PinPadProps): JSX.Element {
  const labelId = useId();
  const hintId = useId();
  const errorId = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [pin, setPin] = useState('');
  const pinRef = useRef('');
  const { min, max, exact } = resolvePinRules({ length, minLength, maxLength });
  const locked = busy || disabled;

  const update = (next: string): void => {
    if (next === pinRef.current) return;
    pinRef.current = next;
    setPin(next);
    onLengthChange?.(next.length);
  };

  const submit = (value: string): void => {
    if (locked || !canSubmitPin(value, min, max)) return;
    update('');
    onSubmit(value);
  };

  const press = (digit: string): void => {
    if (locked) return;
    const next = appendDigit(pinRef.current, digit, max);
    update(next);
    if (exact && next.length === max) submit(next);
  };

  const erase = (): void => {
    if (!locked) update(removeLastDigit(pinRef.current));
  };

  // Latest handlers for the window listener without re-subscribing on every render.
  const handlers = useRef({ press, erase, submit });
  useLayoutEffect(() => {
    handlers.current = { press, erase, submit };
  });

  useEffect(() => {
    if (!keyboard) return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      if (isEditableTarget(event.target)) return;
      const root = rootRef.current;
      if (!root || root.closest('[inert]')) return;
      if (/^\d$/.test(event.key)) {
        event.preventDefault();
        handlers.current.press(event.key);
      } else if (event.key === 'Backspace') {
        event.preventDefault();
        handlers.current.erase();
      } else if (event.key === 'Enter') {
        event.preventDefault();
        handlers.current.submit(pinRef.current);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [keyboard]);

  const slots = pinSlotCount(pin.length, min, max);
  const countText =
    pin.length === 0 ? '' : format(pin.length === 1 ? common.pin.countOne : common.pin.countMany, { count: pin.length });
  const announce = exact && countText ? format(common.pin.countOf, { digits: countText, total: max }) : countText;
  const showError = Boolean(error) && pin.length === 0 && !busy;
  const describedBy = [hint ? hintId : null, showError ? errorId : null].filter(Boolean).join(' ') || undefined;

  const key = (digit: string): JSX.Element => (
    <button
      key={digit}
      type="button"
      className="ui-pin__key"
      disabled={locked || pin.length >= max}
      onClick={() => press(digit)}
    >
      {digit}
    </button>
  );

  return (
    <div
      ref={rootRef}
      role="group"
      aria-labelledby={labelId}
      aria-describedby={describedBy}
      aria-busy={busy || undefined}
      className={cx('ui-pin', className)}
    >
      <p id={labelId} className="ui-pin__label">
        {label}
      </p>
      {hint && (
        <p id={hintId} className="ui-pin__hint">
          {hint}
        </p>
      )}

      <div className="ui-pin__status">
        {busy ? (
          <Spinner size="md" label={common.pleaseWait} />
        ) : (
          <div className="ui-pin__dots" aria-hidden="true" data-error={showError || undefined}>
            {Array.from({ length: slots }, (_, index) => (
              <span key={index} className="ui-pin__dot" data-filled={index < pin.length || undefined} />
            ))}
          </div>
        )}
        <span className="visually-hidden" aria-live="polite">
          {announce}
        </span>
      </div>

      <p id={errorId} className="ui-pin__error" aria-live="assertive">
        {showError ? error : ''}
      </p>

      <div className="ui-pin__grid">
        {DIGIT_ROWS.map((row) => row.map(key))}
        <button
          type="button"
          className="ui-pin__key ui-pin__key--action"
          aria-label={common.pin.backspace}
          disabled={locked || pin.length === 0}
          onClick={erase}
        >
          <BackspaceIcon size={30} />
        </button>
        {key('0')}
        <button
          type="button"
          className="ui-pin__key ui-pin__key--submit"
          aria-label={common.pin.submit}
          disabled={locked || !canSubmitPin(pin, min, max)}
          onClick={() => submit(pinRef.current)}
        >
          <CheckIcon size={32} />
        </button>
      </div>
    </div>
  );
}
