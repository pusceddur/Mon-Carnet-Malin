import { LIMITS, type InvitationConfig, type UpdateInvitationRequest } from '@aide/shared';
import { useEffect, useRef, useState, type FormEvent, type JSX } from 'react';
import { useNavigate } from 'react-router';
import { getInvitation, updateInvitation } from '../../api/admin';
import { changePassword, changePin, logout } from '../../api/auth';
import { Button, ConfirmDialog, Field, ProgressBar, Spinner, TextInput, Toggle, useToast } from '../../design/components';
import { format } from '../../i18n/fr';
import { parent } from '../../i18n/fr/parent';
import { copyText } from '../../platform/clipboard';
import { useOnlineStatus } from '../../platform/online';
import { isIPad, isStandalonePwa, requestPersistentStorage } from '../../platform/support';
import { describeError, reportSessionError } from '../../state/errors';
import { PATHS } from '../../state/guards';
import { OfflineAssetsError, prepareOfflineAssets, type OfflineAssetsProgress } from '../../state/offlineAssets';
import { useSessionStore } from '../../state/session';
import { subscribeSync, syncNow } from '../../sync/SyncEngine';
import { inviteCodeError, passwordError, pinFormatError, pinShortWarning, sanitizePinInput } from '../auth/authForms';
import { DevicesSection, PinRequiredSection } from './AccountSecurity';
import { formatBytes } from './format';
import { ParentPage, ParentSection } from './ParentPage';

const t = parent.account;
const v = parent.validation;

function ChangePinForm(): JSX.Element {
  const toast = useToast();
  const [password, setPassword] = useState('');
  const [pin, setPin] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<{ password?: string; pin?: string; confirm?: string }>({});
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const found = {
      password: password === '' ? v.required : undefined,
      pin: pinFormatError(pin) ?? undefined,
      confirm: pinFormatError(pin) === null && confirm !== pin ? v.pinMismatch : undefined,
    };
    setErrors(found);
    if (found.password || found.pin || found.confirm) return;
    setBusy(true);
    try {
      await changePin({ password, newPin: pin });
      setPassword('');
      setPin('');
      setConfirm('');
      toast.success(t.pin.done);
    } catch (error) {
      await reportSessionError(error);
      toast.error(describeError(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="stack" noValidate onSubmit={(e) => void submit(e)}>
      <Field label={t.pin.password} error={errors.password} required size="parent">
        <TextInput type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      <div className="form-grid">
        <Field label={t.pin.newPin} hint={pinShortWarning(pin) ?? undefined} error={errors.pin} required size="parent">
          <TextInput type="password" inputMode="numeric" pattern="[0-9]*" autoComplete="off" value={pin} onChange={(e) => setPin(sanitizePinInput(e.target.value))} />
        </Field>
        <Field label={t.pin.confirm} error={errors.confirm} required size="parent">
          <TextInput type="password" inputMode="numeric" pattern="[0-9]*" autoComplete="off" value={confirm} onChange={(e) => setConfirm(sanitizePinInput(e.target.value))} />
        </Field>
      </div>
      <div className="parent-actions">
        <Button type="submit" size="parent" loading={busy}>
          {t.pin.submit}
        </Button>
      </div>
    </form>
  );
}

function ChangePasswordForm(): JSX.Element {
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<{ current?: string; next?: string; confirm?: string }>({});
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const nextError = passwordError(next);
    const found = {
      current: current === '' ? v.required : undefined,
      next: nextError ?? undefined,
      confirm: nextError === null && confirm !== next ? v.passwordMismatch : undefined,
    };
    setErrors(found);
    if (found.current || found.next || found.confirm) return;
    setBusy(true);
    try {
      await changePassword({ currentPassword: current, newPassword: next });
      setCurrent('');
      setNext('');
      setConfirm('');
      toast.success(t.password.done);
    } catch (error) {
      await reportSessionError(error);
      toast.error(describeError(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="stack" noValidate onSubmit={(e) => void submit(e)}>
      <Field label={t.password.current} error={errors.current} required size="parent">
        <TextInput type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
      </Field>
      <div className="form-grid">
        <Field label={t.password.next} hint={format(v.passwordLength, { min: LIMITS.passwordMinChars })} error={errors.next} required size="parent">
          <TextInput type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
        </Field>
        <Field label={t.password.confirm} error={errors.confirm} required size="parent">
          <TextInput type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </Field>
      </div>
      <div className="parent-actions">
        <Button type="submit" size="parent" loading={busy}>
          {t.password.submit}
        </Button>
      </div>
    </form>
  );
}

type InvitationAction = 'toggle' | 'regenerate' | 'custom';

/** Owner only: opens or closes the invitation-based sign-up and manages its code. */
function InvitationsSection(): JSX.Element {
  const toast = useToast();
  const online = useOnlineStatus();
  const ti = t.invitations;
  const [config, setConfig] = useState<InvitationConfig | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState<InvitationAction | null>(null);
  const [custom, setCustom] = useState('');
  const [customError, setCustomError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getInvitation()
      .then((fresh) => {
        if (!cancelled) setConfig(fresh);
      })
      .catch(async (error: unknown) => {
        await reportSessionError(error);
        if (!cancelled) setLoadFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const save = async (action: InvitationAction, body: UpdateInvitationRequest, done: (next: InvitationConfig) => string): Promise<boolean> => {
    setBusy(action);
    try {
      const next = await updateInvitation(body);
      setConfig(next);
      toast.success(done(next));
      return true;
    } catch (error) {
      await reportSessionError(error);
      toast.error(describeError(error));
      return false;
    } finally {
      setBusy(null);
    }
  };

  const copy = async (code: string): Promise<void> => {
    if (await copyText(code)) toast.success(ti.copied);
    else toast.error(ti.copyFailed);
  };

  const submitCustom = async (event: FormEvent<HTMLFormElement>, enabled: boolean): Promise<void> => {
    event.preventDefault();
    const error = inviteCodeError(custom);
    setCustomError(error);
    if (error) return;
    if (await save('custom', { enabled, code: custom.trim() }, () => ti.customSaved)) setCustom('');
  };

  if (config === null) {
    return (
      <ParentSection title={ti.title} hint={ti.intro}>
        {loadFailed ? <p className="form-error" role="alert">{ti.loadFailed}</p> : <Spinner />}
      </ParentSection>
    );
  }

  const disabled = busy !== null || !online;
  return (
    <ParentSection title={ti.title} hint={ti.intro}>
      {!online && <p className="form-notice">{ti.offline}</p>}
      <Toggle
        size="parent"
        checked={config.enabled}
        label={ti.enabled}
        description={config.enabled ? undefined : ti.enabledHint}
        disabled={disabled}
        onChange={(enabled) => void save('toggle', { enabled }, (next) => (next.enabled ? ti.opened : ti.closed))}
      />
      <div className="invite-code">
        <p className="invite-code__label">{ti.currentCode}</p>
        {config.code === '' ? (
          <p className="parent-section__hint">{ti.noCode}</p>
        ) : (
          <p className="invite-code__value" translate="no">
            {config.code}
          </p>
        )}
      </div>
      <div className="parent-actions">
        {config.code !== '' && (
          <Button variant="secondary" size="parent" onClick={() => void copy(config.code)}>
            {ti.copy}
          </Button>
        )}
        <Button
          variant="secondary"
          size="parent"
          loading={busy === 'regenerate'}
          disabled={disabled && busy !== 'regenerate'}
          onClick={() => void save('regenerate', { enabled: config.enabled, regenerate: true }, () => ti.regenerated)}
        >
          {ti.regenerate}
        </Button>
      </div>
      <form className="stack" noValidate onSubmit={(e) => void submitCustom(e, config.enabled)}>
        <Field
          label={ti.customLabel}
          hint={format(v.inviteCodeFormat, { min: LIMITS.inviteCodeMinChars, max: LIMITS.inviteCodeMaxChars })}
          error={customError}
          size="parent"
        >
          <TextInput
            value={custom}
            maxLength={LIMITS.inviteCodeMaxChars}
            autoComplete="off"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            onChange={(e) => {
              setCustom(e.target.value);
              setCustomError(null);
            }}
          />
        </Field>
        <div className="parent-actions">
          <Button type="submit" variant="secondary" size="parent" loading={busy === 'custom'} disabled={disabled && busy !== 'custom'}>
            {ti.customSubmit}
          </Button>
        </div>
      </form>
    </ParentSection>
  );
}

function StorageSection(): JSX.Element {
  const toast = useToast();
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [estimate, setEstimate] = useState<{ usage: number; quota: number } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const storage = typeof navigator === 'undefined' ? undefined : navigator.storage;
    void storage?.persisted?.().then(setPersisted, () => setPersisted(false));
    void storage?.estimate?.().then(
      (e) => setEstimate(e.usage !== undefined && e.quota !== undefined ? { usage: e.usage, quota: e.quota } : null),
      () => undefined,
    );
  }, []);

  const request = async (): Promise<void> => {
    setBusy(true);
    const granted = await requestPersistentStorage();
    setPersisted(granted);
    setBusy(false);
    if (granted) toast.success(t.storage.granted);
    else toast.warning(t.storage.denied);
  };

  return (
    <ParentSection title={t.storage.title}>
      {persisted !== null && <p className="parent-page__intro">{persisted ? t.storage.persisted : t.storage.notPersisted}</p>}
      {estimate && <p className="parent-section__hint">{format(t.storage.usage, { used: formatBytes(estimate.usage), quota: formatBytes(estimate.quota) })}</p>}
      {persisted !== true && (
        <div className="parent-actions">
          <Button variant="secondary" size="parent" loading={busy} onClick={() => void request()}>
            {t.storage.request}
          </Button>
        </div>
      )}
    </ParentSection>
  );
}

function OfflineSection(): JSX.Element {
  const toast = useToast();
  const online = useOnlineStatus();
  const [progress, setProgress] = useState<OfflineAssetsProgress | null>(null);
  const [running, setRunning] = useState(false);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => () => controller.current?.abort(), []);

  const prepare = async (): Promise<void> => {
    const abort = new AbortController();
    controller.current = abort;
    setRunning(true);
    setProgress(null);
    try {
      const result = await prepareOfflineAssets({
        fetch: (url, init) => fetch(url, init),
        caches: typeof caches === 'undefined' ? undefined : caches,
        onProgress: setProgress,
        signal: abort.signal,
      });
      if (result.failed.length > 0) toast.warning(format(t.offline.partial, { failed: result.failed.length }));
      else toast.success(format(t.offline.done, { count: result.total }));
    } catch (error) {
      if (error instanceof OfflineAssetsError && error.code !== 'aborted') {
        toast.error(error.code === 'unsupported' ? t.offline.unsupported : t.offline.manifestUnavailable);
      }
    } finally {
      controller.current = null;
      setRunning(false);
    }
  };

  return (
    <ParentSection title={t.offline.title} hint={t.offline.intro}>
      {!online && <p className="form-notice">{t.offline.needsOnline}</p>}
      {running && (
        <ProgressBar
          label={t.offline.progress}
          value={progress && progress.total > 0 ? progress.done : null}
          max={progress?.total ?? 100}
          valueText={progress ? format(t.offline.progressValue, { done: progress.done, total: progress.total }) : undefined}
        />
      )}
      <div className="parent-actions">
        <Button size="parent" icon="📥" loading={running} disabled={!online} onClick={() => void prepare()}>
          {t.offline.prepare}
        </Button>
        {running && (
          <Button variant="ghost" size="parent" onClick={() => controller.current?.abort()}>
            {t.offline.cancel}
          </Button>
        )}
      </div>
    </ParentSection>
  );
}

function InstallSection(): JSX.Element {
  const installed = isStandalonePwa();
  return (
    <ParentSection title={t.install.title}>
      {installed ? (
        <p className="parent-page__intro">
          <span aria-hidden="true">✅ </span>
          {t.install.installed}
        </p>
      ) : (
        <>
          <p className="parent-page__intro">{t.install.why}</p>
          {!isIPad() && <p className="parent-section__hint">{t.install.notIpad}</p>}
          <ol className="steps">
            {t.install.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </>
      )}
    </ParentSection>
  );
}

function LogoutSection(): JSX.Element {
  const navigate = useNavigate();
  const toast = useToast();
  const online = useOnlineStatus();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(0);
  // §20: by default the family's books and notes leave this device with the sign-out.
  const [wipe, setWipe] = useState(true);

  useEffect(() => subscribeSync((s) => setPending(s.pending)), []);

  const confirm = async (): Promise<void> => {
    try {
      if (online) await syncNow();
      await logout();
      if (wipe) await useSessionStore.getState().forgetThisDevice();
      else await useSessionStore.getState().markSignedOut();
      setOpen(false);
      navigate(PATHS.login, { replace: true });
    } catch (error) {
      await reportSessionError(error);
      toast.error(describeError(error));
    }
  };

  return (
    <ParentSection title={t.logout.title}>
      <div className="parent-actions">
        <Button variant="danger" size="parent" onClick={() => setOpen(true)}>
          {t.logout.button}
        </Button>
      </div>
      <ConfirmDialog
        open={open}
        size="parent"
        tone="danger"
        title={t.logout.confirmTitle}
        message={
          <>
            <p>{t.logout.confirmMessage}</p>
            {pending > 0 && <p>{format(t.logout.pendingWarning, { count: pending })}</p>}
            <Toggle size="parent" label={t.logout.wipeLabel} description={t.logout.wipeHint} checked={wipe} onChange={setWipe} />
          </>
        }
        confirmLabel={t.logout.confirm}
        onConfirm={confirm}
        onCancel={() => setOpen(false)}
      />
    </ParentSection>
  );
}

/**
 * Parent account: PIN (and whether it is asked, §20), password, devices signed in (§20), invitations (owner), installation,
 * storage, offline assets, sign-out.
 */
export default function AccountPage(): JSX.Element {
  const account = useSessionStore((s) => s.authStatus?.parent ?? null);
  return (
    <ParentPage title={t.title} intro={account ? format(t.signedInAs, { nom: account.displayName, email: account.email }) : undefined}>
      <ParentSection title={t.pin.title}>
        <ChangePinForm />
      </ParentSection>
      <PinRequiredSection />
      <ParentSection title={t.password.title}>
        <ChangePasswordForm />
      </ParentSection>
      <DevicesSection />
      {account?.isOwner === true && <InvitationsSection />}
      <InstallSection />
      <StorageSection />
      <OfflineSection />
      <LogoutSection />
    </ParentPage>
  );
}
