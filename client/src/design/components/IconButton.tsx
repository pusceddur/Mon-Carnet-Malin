import type { ComponentPropsWithRef, JSX, MouseEvent, ReactNode } from 'react';
import type { ButtonVariant, ControlSize } from './Button';
import { cx } from './internal/cx';
import { Spinner } from './Spinner';
import './Button.css';

export interface IconButtonProps extends Omit<ComponentPropsWithRef<'button'>, 'type' | 'children' | 'aria-label'> {
  /** Required French accessible name: the icon alone carries no text. */
  'aria-label': string;
  /** Emoji string or SVG element. */
  icon: ReactNode;
  /** Default `ghost`. */
  variant?: ButtonVariant;
  /** Default `child` (56px square); `parent` is 44px. */
  size?: ControlSize;
  /** Toggle state for tool buttons (sets aria-pressed). */
  pressed?: boolean;
  /** Replaces the icon with a spinner and ignores clicks. */
  loading?: boolean;
  type?: 'button' | 'submit' | 'reset';
}

/** Square icon-only button. */
export function IconButton({
  icon,
  variant = 'ghost',
  size = 'child',
  pressed,
  loading = false,
  type = 'button',
  className,
  onClick,
  ref,
  ...rest
}: IconButtonProps): JSX.Element {
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
      aria-pressed={pressed}
      aria-busy={loading || undefined}
      aria-disabled={loading || undefined}
      onClick={handleClick}
      className={cx('ui-btn', 'ui-btn--icon', `ui-btn--${variant}`, `ui-btn--${size}`, className)}
    >
      {loading ? (
        <Spinner size="sm" decorative />
      ) : (
        <span className="ui-btn__glyph" aria-hidden="true">
          {icon}
        </span>
      )}
    </button>
  );
}
