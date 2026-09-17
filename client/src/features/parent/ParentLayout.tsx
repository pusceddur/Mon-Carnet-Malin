import type { AuthStatus } from '@aide/shared';
import { useEffect, useState, type JSX } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router';
import { getAuthStatus, lock, unlock } from '../../api/auth';
import { ApiError } from '../../api/http';
import { Button, OfflineBadge, PinPad, useToast } from '../../design/components';
import { format } from '../../i18n/fr';
import { parent } from '../../i18n/fr/parent';
import { useOnlineStatus } from '../../platform/online';
import { describeError } from '../../state/errors';
import { PATHS } from '../../state/guards';
import { useParentUnlocked, useSelectedChild, useSessionStore } from '../../state/session';
import { useDocumentTitle } from '../../state/useDocumentTitle';
import { formatTime } from './format';
import { lockRemainingText } from './lockout';
import './parent.css';

const NAV_ITEMS = [
  { to: 'documents', emoji: '📚', label: parent.layout.nav.documents },
  { to: 'importer', emoji: '➕', label: parent.layout.nav.importer },
  { to: 'enfants', emoji: '🧒', label: parent.layout.nav.enfants },
  { to: 'ia', emoji: '⚙️', label: parent.layout.nav.ia },
  { to: 'activite', emoji: '📊', label: parent.layout.nav.activite },
  { to: 'glossaire', emoji: '📖', label: parent.layout.nav.glossaire },
  { to: 'synchronisation', emoji: '🔄', label: parent.layout.nav.synchronisation },
  { to: 'compte', emoji: '👤', label: parent.layout.nav.compte },
] as const;

/** Ticks every second while `until` is in the future. */
function useNow(until: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (until === null || until <= Date.now()) return undefined;
    const timer = setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (current >= until) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [until]);
  return now;
}

function ParentGate(): JSX.Element {
  const t = parent.gate;
  const navigate = useNavigate();
  const online = useOnlineStatus();
  const status = useSessionStore((s) => s.authStatus);
  const hasChild = useSelectedChild() !== null;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lockedUntil = status?.pinLockedUntil ?? null;
  const now = useNow(lockedUntil);
  const locked = lockedUntil !== null && lockedUntil > now;

  const refreshStatus = async (): Promise<AuthStatus | null> => {
    try {
      const next = await getAuthStatus();
      await useSessionStore.getState().setAuthStatus(next);
      return next;
    } catch {
      return null;
    }
  };

  const onSubmit = async (pin: string): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const next = await unlock({ pin });
      await useSessionStore.getState().setAuthStatus(next);
    } catch (err) {
      const code = err instanceof ApiError ? err.code : 'unknown';
      const httpStatus = err instanceof ApiError ? err.status : 0;
      if (code === 'offline') {
        setError(t.offline);
      } else {
        const refreshed = await refreshStatus();
        const lockedNow = (refreshed?.pinLockedUntil ?? 0) > Date.now();
        if (lockedNow) setError(null);
        else if (code === 'invalid_pin' || httpStatus === 401 || httpStatus === 403) setError(t.wrongPin);
        else setError(describeError(err));
      }
    } finally {
      setBusy(false);
    }
  };

  let message: string | null = error;
  if (!online) message = t.offline;
  else if (locked) message = format(t.locked, { duree: lockRemainingText(lockedUntil - now) });
  else if (status && !status.pinSet) message = t.noPin;

  return (
    <main className="parent-gate">
      <div className="parent-gate__card">
        <h1 className="parent-gate__title">
          <span aria-hidden="true">🔒 </span>
          {t.title}
        </h1>
        <PinPad
          label={t.pinLabel}
          hint={t.hint}
          onSubmit={(pin) => void onSubmit(pin)}
          busy={busy}
          disabled={!online || locked || (status !== null && !status.pinSet)}
          error={message}
        />
        <Button variant="ghost" size="child" onClick={() => navigate(hasChild ? PATHS.home : PATHS.childSelect)}>
          {t.back}
        </Button>
      </div>
    </main>
  );
}

/** PIN gate (server-side unlock, C8) + parent navigation; renders child routes in <Outlet />. */
export default function ParentLayout(): JSX.Element {
  const t = parent.layout;
  useDocumentTitle(t.documentTitle);
  const navigate = useNavigate();
  const toast = useToast();
  const unlocked = useParentUnlocked();
  const until = useSessionStore((s) => s.authStatus?.parentUnlockedUntil ?? null);
  const hasChild = useSelectedChild() !== null;
  const [locking, setLocking] = useState(false);

  if (!unlocked) return <ParentGate />;

  const leave = (): void => {
    void navigate(hasChild ? PATHS.home : PATHS.childSelect);
  };

  const onLock = async (): Promise<void> => {
    setLocking(true);
    try {
      await useSessionStore.getState().setAuthStatus(await lock());
    } catch (err) {
      // Offline or server error: lock this device anyway.
      await useSessionStore.getState().markParentLocked();
      if (!(err instanceof ApiError && err.code === 'offline')) toast.warning(describeError(err));
    } finally {
      setLocking(false);
    }
    leave();
  };

  return (
    <div className="parent-shell">
      <header className="parent-shell__header">
        <div className="parent-shell__brand">
          <h1 className="parent-shell__title">{t.title}</h1>
          {until !== null && <p className="parent-shell__autolock">{format(t.autoLock, { heure: formatTime(until) })}</p>}
        </div>
        <div className="parent-shell__actions">
          <OfflineBadge />
          <Button variant="secondary" size="parent" icon="🔒" loading={locking} onClick={() => void onLock()}>
            {t.lock}
          </Button>
        </div>
      </header>
      <div className="parent-shell__main">
        <nav className="parent-nav" aria-label={t.navLabel}>
          <ul className="parent-nav__list">
            {NAV_ITEMS.map((item) => (
              <li key={item.to}>
                <NavLink to={item.to} className={({ isActive }) => `parent-nav__link${isActive ? ' parent-nav__link--active' : ''}`}>
                  <span className="parent-nav__emoji" aria-hidden="true">
                    {item.emoji}
                  </span>
                  <span>{item.label}</span>
                </NavLink>
              </li>
            ))}
          </ul>
          <Button variant="ghost" size="parent" className="parent-nav__leave" onClick={leave}>
            {t.backToChild}
          </Button>
        </nav>
        <div className="parent-shell__content">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
