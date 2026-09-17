import { useId, type JSX } from 'react';
import type { ControlSize } from './Button';
import { cx } from './internal/cx';
import { CheckIcon } from './internal/icons';
import './Toggle.css';

export interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Visible label (the whole row is tappable). */
  label: string;
  /** Optional detail under the label. */
  description?: string;
  disabled?: boolean;
  /** Default `child`. */
  size?: ControlSize;
  id?: string;
  className?: string;
}

/** On/off switch (role switch). */
export function Toggle({ checked, onChange, label, description, disabled = false, size = 'child', id, className }: ToggleProps): JSX.Element {
  const autoId = useId();
  const baseId = id ?? autoId;
  const labelId = `${baseId}-label`;
  const descId = `${baseId}-desc`;

  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={labelId}
      aria-describedby={description ? descId : undefined}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx('ui-toggle', `ui-toggle--${size}`, className)}
    >
      <span className="ui-toggle__text">
        <span id={labelId} className="ui-toggle__label">
          {label}
        </span>
        {description && (
          <span id={descId} className="ui-toggle__desc">
            {description}
          </span>
        )}
      </span>
      <span className="ui-toggle__track" aria-hidden="true">
        <span className="ui-toggle__thumb">
          <CheckIcon size={size === 'child' ? 16 : 14} className="ui-toggle__check" />
        </span>
      </span>
    </button>
  );
}
