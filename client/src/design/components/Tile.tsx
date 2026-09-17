import type { ComponentPropsWithRef, JSX } from 'react';
import { cx } from './internal/cx';
import './Tile.css';

export type TileTone = 'blue' | 'warm' | 'green' | 'violet' | 'neutral';

export interface TileProps extends Omit<ComponentPropsWithRef<'button'>, 'type' | 'children'> {
  /** Large emoji shown on a tinted disc (decorative, hidden from assistive tech). */
  emoji: string;
  /** Short label, 1 to 3 words (« Mes livres »). */
  label: string;
  /** Optional one-line detail (« Page 12 »). */
  description?: string;
  /** Tint of the emoji disc. Default `blue`. */
  tone?: TileTone;
  /** `stack` (default): big square-ish tile for the child home grid · `row`: wide tile, emoji on the left. */
  layout?: 'stack' | 'row';
}

/** Large tappable tile (child home). */
export function Tile({ emoji, label, description, tone = 'blue', layout = 'stack', className, ref, ...rest }: TileProps): JSX.Element {
  return (
    <button {...rest} ref={ref} type="button" className={cx('ui-tile', `ui-tile--${layout}`, `ui-tile--${tone}`, className)}>
      <span className="ui-tile__emoji" aria-hidden="true">
        {emoji}
      </span>
      <span className="ui-tile__text">
        <span className="ui-tile__label">{label}</span>
        {description && <span className="ui-tile__desc">{description}</span>}
      </span>
    </button>
  );
}
