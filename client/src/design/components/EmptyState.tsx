import type { JSX, ReactNode } from 'react';
import { cx } from './internal/cx';
import './EmptyState.css';

export interface EmptyStateProps {
  /** Decorative emoji (« 📚 »). */
  emoji?: string;
  /** What is empty, in a few words (« Pas encore de livre »). */
  title: string;
  /** What to do next, one short sentence. */
  message?: string;
  /** Usually one Button. */
  action?: ReactNode;
  /** Heading level of the title. Default 2. */
  headingLevel?: 2 | 3;
  className?: string;
}

/** Empty or blocked screen area: emoji, title, next step. */
export function EmptyState({ emoji, title, message, action, headingLevel = 2, className }: EmptyStateProps): JSX.Element {
  const Heading = headingLevel === 3 ? 'h3' : 'h2';
  return (
    <div className={cx('ui-empty', className)}>
      {emoji && (
        <span className="ui-empty__emoji" aria-hidden="true">
          {emoji}
        </span>
      )}
      <Heading className="ui-empty__title">{title}</Heading>
      {message && <p className="ui-empty__message">{message}</p>}
      {action !== undefined && action !== null && <div className="ui-empty__action">{action}</div>}
    </div>
  );
}
