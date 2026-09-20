// §20 account security in « Compte »: code of the Réglages asked or not, devices signed in.
import type { DeviceSession } from '@aide/shared';
import { useEffect, useState, type FormEvent, type JSX } from 'react';
import { listDeviceSessions, setPinRequired, signOutDevice, signOutOtherDevices } from '../../api/auth';
import { Button, Field, Spinner, TextInput, Toggle, useToast } from '../../design/components';
import { format } from '../../i18n/fr';
import { parent } from '../../i18n/fr/parent';
import { useOnlineStatus } from '../../platform/online';
import { describeError, reportSessionError } from '../../state/errors';
import { useSessionStore } from '../../state/session';
import { ParentSection } from './ParentPage';

const tp = parent.account.pinRequired;
const td = parent.account.devices;

/** Toggle « Demander le code pour ouvrir les Réglages »; the password of the account confirms the change. */
export function PinRequiredSection(): JSX.Element {
  const toast = useToast();
  const online = useOnlineStatus();
  const pinRequired = useSessionStore((s) => s.authStatus?.pinRequired !== false);
  const [asking, setAsking] = useState<boolean | null>(null);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (asking === null || password === '') return;
    setBusy(true);
    try {
      await useSessionStore.getState().setAuthStatus(await setPinRequired({ required: asking, password }));
      toast.success(asking ? tp.doneOn : tp.doneOff);
      setAsking(null);
      setPassword('');
    } catch (error) {
      await reportSessionError(error);
      toast.error(describeError(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ParentSection title={tp.title}>
      <Toggle
        size="parent"
        label={tp.label}
        description={pinRequired ? tp.hintOn : tp.hintOff}
        checked={asking ?? pinRequired}
        disabled={!online || busy}
        onChange={(next) => {
          setPassword('');
          setAsking(next === pinRequired ? null : next);
        }}
      />
      {asking !== null && (
        <form className="stack" noValidate onSubmit={(e) => void submit(e)}>
          <p className="parent-section__hint">{asking ? tp.askOn : tp.askOff}</p>
          <Field label={tp.passwordLabel} required size="parent">
            <TextInput type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <div className="parent-actions">
            <Button type="submit" size="parent" loading={busy} disabled={password === ''}>
              {tp.confirm}
            </Button>
            <Button variant="ghost" size="parent" onClick={() => setAsking(null)}>
              {tp.cancel}
            </Button>
          </div>
        </form>
      )}
    </ParentSection>
  );
}

const dateFormat = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
const relativeFormat = new Intl.RelativeTimeFormat('fr-FR', { numeric: 'auto' });

/** « à l'instant », « il y a 3 heures », « hier »… */
export function formatLastSeen(millis: number, now: number): string {
  const minutes = Math.round((now - millis) / 60_000);
  if (minutes < 2) return td.justNow;
  if (minutes < 60) return relativeFormat.format(-minutes, 'minute');
  const hours = Math.round(minutes / 60);
  if (hours < 24) return relativeFormat.format(-hours, 'hour');
  const days = Math.round(hours / 24);
  if (days < 31) return relativeFormat.format(-days, 'day');
  return dateFormat.format(new Date(millis));
}

export function deviceLabel(session: DeviceSession): string {
  if (session.name) return session.name;
  const kind = td.kinds[session.device];
  return session.browser ? `${kind} · ${session.browser}` : kind;
}

/** « Appareils connectés »: where the account is signed in, with a way to sign each one out. */
export function DevicesSection(): JSX.Element {
  const toast = useToast();
  const online = useOnlineStatus();
  const [sessions, setSessions] = useState<DeviceSession[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = async (): Promise<void> => {
    try {
      setSessions(await listDeviceSessions());
      setFailed(false);
    } catch (error) {
      await reportSessionError(error);
      setFailed(true);
    }
  };

  useEffect(() => {
    if (online) void load();
  }, [online]);

  const run = async (key: string, action: () => Promise<unknown>, done: string): Promise<void> => {
    setBusy(key);
    try {
      await action();
      toast.success(done);
      await load();
    } catch (error) {
      await reportSessionError(error);
      toast.error(describeError(error));
    } finally {
      setBusy(null);
    }
  };

  const now = Date.now();
  const others = sessions?.filter((s) => !s.current) ?? [];
  return (
    <ParentSection title={td.title} hint={td.intro}>
      {!online ? (
        <p className="form-notice">{td.offline}</p>
      ) : sessions === null ? (
        failed ? <p className="form-error" role="alert">{td.loadFailed}</p> : <Spinner />
      ) : (
        <>
          <ul className="parent-list device-list">
            {sessions.map((session) => (
              <li key={session.id} className="parent-list__item">
                <span className="parent-list__main">
                  <span className="parent-list__title">
                    {deviceLabel(session)}
                    {session.current && <span className="tag device-list__current">{td.current}</span>}
                  </span>
                  <span className="parent-list__meta">{format(td.lastSeen, { when: formatLastSeen(session.lastSeenAt, now) })}</span>
                  <span className="parent-list__meta">
                    {format(td.since, { date: dateFormat.format(new Date(session.createdAt)) })}
                    {session.ip && <> · {format(td.ip, { ip: session.ip })}</>}
                  </span>
                </span>
                {!session.current && (
                  <Button
                    variant="secondary"
                    size="parent"
                    aria-label={format(td.signOutLabel, { name: deviceLabel(session) })}
                    loading={busy === session.id}
                    disabled={busy !== null}
                    onClick={() => void run(session.id, () => signOutDevice(session.id), td.signedOut)}
                  >
                    {td.signOut}
                  </Button>
                )}
              </li>
            ))}
          </ul>
          {others.length > 0 && (
            <div className="parent-actions">
              <Button variant="danger" size="parent" loading={busy === 'others'} disabled={busy !== null} onClick={() => void run('others', signOutOtherDevices, td.othersSignedOut)}>
                {td.signOutOthers}
              </Button>
            </div>
          )}
        </>
      )}
    </ParentSection>
  );
}
