import type { ComponentPropsWithRef, JSX, MouseEvent, ReactNode } from 'react';
import { cx } from './internal/cx';
import { Spinner } from './Spinner';
import './Button.css';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
/** `child`: 56px touch target (child screens) · `parent`: 44px (parent area). */
export type ControlSize = 'child' | 'parent';

export interface ButtonProps extends Omit<ComponentPropsWithRef<'button'>, 'type'> {
  /** Visual weight. Default `primary`. Keep one primary action per screen. */
  variant?: ButtonVariant;
  /** Default `child`. */
  size?: ControlSize;
  /** Shows a spinner, sets aria-busy and ignores clicks while keeping focus. */
  loading?: boolean;
  /** Leading icon: emoji string or SVG element. */
  icon?: ReactNode;
  /** Full width. */
  block?: boolean;
  /** Default `button` (never submits a form by accident). */
  type?: 'button' | 'submit' | 'reset';
}

/** Text button. */
export function Button({
  variant = 'primary',
  size = 'child',
  loading = false,
  icon,
  block = false,
  type = 'button',
  className,
  children,
  onClick,
  ref,
  ...rest
}: ButtonProps): JSX.Element {
  const handleClick = (event: MouseEvent<HTMLButtonElement>): void => {
    if (loading) {
      event.preventDefault();
      return;
    }
    onClick?.(event);
  };

  return (
    <button
      {...rest}
      ref={ref}
      type={type}
      aria-busy={loading || undefined}
      aria-disabled={loading || undefined}
      onClick={handleClick}
      className={cx('ui-btn', `ui-btn--${variant}`, `ui-btn--${size}`, block && 'ui-btn--block', className)}
    >
      {loading ? (
        <Spinner size="sm" decorative />
      ) : icon !== undefined && icon !== null ? (
        <span className="ui-btn__icon" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      {children !== undefined && children !== null && <span className="ui-btn__label">{children}</span>}
    </button>
  );
}
