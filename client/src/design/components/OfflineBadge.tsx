import type { JSX } from 'react';
import { common } from '../../i18n/fr/common';
import { useOnlineStatus } from '../../platform/online';
import { cx } from './internal/cx';
import { CloudOffIcon } from './internal/icons';
import './OfflineBadge.css';

export interface OfflineBadgeProps {
  /** Also render a discreet « En ligne » badge when connected. Default false (renders nothing online). */
  showWhenOnline?: boolean;
  /** Default « Hors ligne ». */
  label?: string;
  className?: string;
}

/** Small status pill driven by navigator.onLine and the online/offline events. */
export function OfflineBadge({ showWhenOnline = false, label = common.offline, className }: OfflineBadgeProps): JSX.Element | null {
  const online = useOnlineStatus();
  if (online && !showWhenOnline) return null;
  return (
    <span role="status" className={cx('ui-offline', online ? 'ui-offline--online' : 'ui-offline--offline', className)}>
      {online ? (
        <span className="ui-offline__dot" aria-hidden="true" />
      ) : (
        <CloudOffIcon size={18} className="ui-offline__icon" />
      )}
      <span>{online ? common.online : label}</span>
    </span>
  );
}
