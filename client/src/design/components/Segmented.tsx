import { useId, useRef, type JSX, type KeyboardEvent, type ReactNode } from 'react';
import type { ControlSize } from './Button';
import { cx } from './internal/cx';
import './Segmented.css';

export interface SegmentedOption<T extends string> {
  value: T;
  /** Visible text. */
  label: string;
  /** Optional leading emoji or SVG. */
  icon?: ReactNode;
  disabled?: boolean;
}

export interface SegmentedProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: readonly SegmentedOption<T>[];
  /** Group label (visible above the control unless `hideLabel`). */
  label: string;
  hideLabel?: boolean;
  disabled?: boolean;
  /** Default `child`. */
  size?: ControlSize;
  className?: string;
}

/** Single choice among 2 to 4 short options (radiogroup with arrow-key navigation). */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  hideLabel = false,
  disabled = false,
  size = 'child',
  className,
}: SegmentedProps<T>): JSX.Element {
  const labelId = useId();
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const enabled = options.map((option) => !disabled && !option.disabled);
  const selectedIndex = options.findIndex((option) => option.value === value);
  // Roving tabindex: the selected option, or the first enabled one.
  const tabStop = selectedIndex >= 0 && enabled[selectedIndex] ? selectedIndex : enabled.indexOf(true);

  const move = (from: number, direction: 1 | -1): void => {
    const count = options.length;
    for (let i = 1; i <= count; i += 1) {
      const index = (from + direction * i + count) % count;
      const option = options[index];
      if (option && enabled[index]) {
        onChange(option.value);
        buttons.current[index]?.focus();
        return;
      }
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        event.preventDefault();
        move(index, 1);
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        event.preventDefault();
        move(index, -1);
        break;
      default:
        break;
    }
  };

  return (
    <div className={cx('ui-seg', `ui-seg--${size}`, className)}>
      <span id={labelId} className={cx('ui-seg__label', hideLabel && 'visually-hidden')}>
        {label}
      </span>
      <div role="radiogroup" aria-labelledby={labelId} aria-disabled={disabled || undefined} className="ui-seg__track">
        {options.map((option, index) => {
          const selected = option.value === value;
          return (
            <button
              key={option.value}
              ref={(el) => {
                buttons.current[index] = el;
              }}
              type="button"
              role="radio"
              aria-checked={selected}
              tabIndex={index === tabStop ? 0 : -1}
              disabled={!enabled[index]}
              onClick={() => {
                if (!selected) onChange(option.value);
              }}
              onKeyDown={(event) => onKeyDown(event, index)}
              className="ui-seg__option"
            >
              {option.icon !== undefined && (
                <span className="ui-seg__icon" aria-hidden="true">
                  {option.icon}
                </span>
              )}
              <span className="ui-seg__text">{option.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
