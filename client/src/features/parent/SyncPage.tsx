import type { SyncTable } from '@aide/shared';
import { useEffect, useRef, useState, type JSX } from 'react';
import { Button, useToast } from '../../design/components';
import { format } from '../../i18n/fr';
import { parent } from '../../i18n/fr/parent';
import { useOnlineStatus } from '../../platform/online';
import { describeErrorCode } from '../../state/errors';
import { useSessionStore } from '../../state/session';
import {
  getLastRejections, getPendingCounts, SYNC_TABLE_ORDER, subscribeSync, syncNow, type SyncRejectionLog, type SyncStatus,
} from '../../sync/SyncEngine';
import { formatDateTime } from './format';
import { ParentPage, ParentSection } from './ParentPage';

const t = parent.sync;

/** Sync status of this device: state, last sync, pending items, manual sync. */
export default function SyncPage(): JSX.Element {
  const toast = useToast();
  const online = useOnlineStatus();
  const annotationsDisabled = useSessionStore((s) => s.parentSettings?.privacy.syncAnnotations === false);
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [counts, setCounts] = useState<Record<SyncTable, number> | null>(null);
  const [rejections, setRejections] = useState<SyncRejectionLog | null>(null);
  const [running, setRunning] = useState(false);

  const latest = useRef<SyncStatus | null>(null);

  useEffect(
    () =>
      subscribeSync((next) => {
        latest.current = next;
        setStatus(next);
      }),
    [],
  );

  // Refresh the per-table detail whenever the status changes.
  const pending = status?.pending;
  const state = status?.state;
  useEffect(() => {
    let cancelled = false;
    void Promise.all([getPendingCounts(), getLastRejections()]).then(([c, r]) => {
      if (cancelled) return;
      setCounts(c);
      setRejections(r);
    });
    return () => {
      cancelled = true;
    };
  }, [pending, state]);

  const onSync = async (): Promise<void> => {
    setRunning(true);
    try {
      await syncNow();
      if (latest.current?.state === 'idle') toast.success(t.done);
    } finally {
      setRunning(false);
    }
  };

  const currentState = status?.state ?? 'idle';
  const pendingText =
    !status || status.pending === 0
      ? t.pendingNone
      : format(status.pending === 1 ? t.pendingOne : t.pendingMany, { count: status.pending });

  return (
    <ParentPage title={t.title} intro={t.intro}>
      <ParentSection title={t.deviceTitle}>
        <p className="sync-state" role="status">
          <span className={`sync-state__dot sync-state__dot--${currentState}`} aria-hidden="true" />
          {t.states[currentState]}
        </p>
        <p className="parent-page__intro">
          {status?.lastSyncAt ? format(t.lastSync, { date: formatDateTime(status.lastSyncAt) }) : t.never}
        </p>
        <p className="parent-page__intro">{pendingText}</p>
        {status?.state === 'error' && status.lastError && <p className="form-error">{describeErrorCode(status.lastError)}</p>}
        {!online && <p className="form-notice">{t.offlineHint}</p>}
        <div className="parent-actions">
          <Button size="parent" icon="🔄" loading={running || currentState === 'syncing'} disabled={!online} onClick={() => void onSync()}>
            {t.syncNow}
          </Button>
        </div>
      </ParentSection>

      {counts && Object.values(counts).some((n) => n > 0) && (
        <ParentSection title={t.pendingTitle}>
          <ul className="parent-list">
            {SYNC_TABLE_ORDER.filter((table) => counts[table] > 0).map((table) => (
              <li key={table} className="parent-list__item">
                <span className="parent-list__main">
                  <span className="parent-list__title">{t.tables[table]}</span>
                </span>
                <span className="tag">{counts[table]}</span>
              </li>
            ))}
          </ul>
          {annotationsDisabled && counts.annotations > 0 && <p className="parent-section__hint">{t.annotationsDisabled}</p>}
        </ParentSection>
      )}

      {rejections && rejections.items.length > 0 && (
        <ParentSection title={t.rejectedTitle} hint={t.rejectedHint}>
          <p className="parent-section__hint">{formatDateTime(rejections.at)}</p>
          <ul className="parent-list">
            {rejections.items.slice(0, 10).map((r, i) => (
              <li key={`${r.table}:${r.entityKey}:${i}`} className="parent-list__item">
                <span className="parent-list__main">
                  <span className="parent-list__title">{t.tables[r.table]}</span>
                  <span className="parent-list__meta">{t.rejectedReasons[r.reason]}</span>
                </span>
              </li>
            ))}
          </ul>
        </ParentSection>
      )}
    </ParentPage>
  );
}
