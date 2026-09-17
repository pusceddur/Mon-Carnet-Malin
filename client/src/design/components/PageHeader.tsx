import type { JSX, ReactNode } from 'react';
import { common } from '../../i18n/fr/common';
import { Button, type ControlSize } from './Button';
import { cx } from './internal/cx';
import { ArrowLeftIcon } from './internal/icons';
import './PageHeader.css';

export interface PageHeaderProps {
  /** Page title (rendered as h1). */
  title: string;
  /** Optional line under the title. */
  subtitle?: string;
  /** Shows the back button when provided. */
  onBack?: () => void;
  /** Default « Retour ». */
  backLabel?: string;
  /** Right-aligned actions (IconButtons, OfflineBadge…). */
  actions?: ReactNode;
  /** Sticks under the status bar while scrolling. Default true. */
  sticky?: boolean;
  /** Default `child`. */
  size?: ControlSize;
  className?: string;
}

/** Top bar: back button with visible « Retour », title, optional actions. */
export function PageHeader({
  title,
  subtitle,
  onBack,
  backLabel = common.back,
  actions,
  sticky = true,
  size = 'child',
  className,
}: PageHeaderProps): JSX.Element {
  return (
    <header className={cx('ui-page-header', `ui-page-header--${size}`, sticky && 'ui-page-header--sticky', className)}>
      {onBack && (
        <Button
          variant="ghost"
          size={size}
          icon={<ArrowLeftIcon size={size === 'child' ? 26 : 22} />}
          className="ui-page-header__back"
          onClick={onBack}
        >
          {backLabel}
        </Button>
      )}
      <div className="ui-page-header__titles">
        <h1 className="ui-page-header__title">{title}</h1>
        {subtitle && <p className="ui-page-header__subtitle">{subtitle}</p>}
      </div>
      {actions !== undefined && actions !== null && <div className="ui-page-header__actions">{actions}</div>}
    </header>
  );
}
