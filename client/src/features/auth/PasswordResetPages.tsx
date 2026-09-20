// §20 « Mot de passe oublié » (e-mail link + code of the Réglages) and the link of the e-mail sent every 180 days.
import { APP_NAME, LIMITS } from '@aide/shared';
import { useState, type FormEvent, type JSX, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { confirmContinuity, confirmPasswordReset, requestPasswordReset } from '../../api/auth';
import { Button, Field, TextInput } from '../../design/components';
import { format } from '../../i18n/fr';
import { parent } from '../../i18n/fr/parent';
import { useOnlineStatus } from '../../platform/online';
import { describeError } from '../../state/errors';
import { PATHS } from '../../state/guards';
import { useDocumentTitle } from '../../state/useDocumentTitle';
import { passwordError, sanitizePinInput } from './authForms';
import './auth.css';

const t = parent.passwordReset;
const tc = parent.continuity;
const v = parent.validation;

function AuthCard({ title, intro, children }: { title: string; intro: string; children: ReactNode }): JSX.Element {
  return (
    <main className="auth-page">
      <div className="auth-card">
        <div className="auth-card__brand">
          <img className="auth-card__logo" src="/icons/icon.svg" alt="" width={64} height={64} />
          <div>
            <p className="auth-card__intro">{APP_NAME}</p>
            <h1 className="auth-card__title">{title}</h1>
          </div>
        </div>
        <p className="auth-card__intro">{intro}</p>
        {children}
      </div>
    </main>
  );
}

/** Link sent by e-mail: `?jeton=…`. */
function useLinkToken(): string | null {
  const [params] = useSearchParams();
  const token = params.get('jeton');
  return token && token.length >= 20 && token.length <= 200 ? token : null;
}

export function ForgotPasswordPage(): JSX.Element {
  useDocumentTitle(t.documentTitle);
  const navigate = useNavigate();
  const online = useOnlineStatus();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (busy) return;
    if (email.trim() === '') {
      setError(v.required);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await requestPasswordReset({ email: email.trim() });
      setSent(true);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthCard title={t.title} intro={t.intro}>
      {sent ? (
        <p className="form-notice" role="status">{t.sent}</p>
      ) : (
        <form className="auth-form" noValidate onSubmit={(e) => void submit(e)}>
          <Field label={t.emailLabel} required size="parent">
            <TextInput type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" autoCapitalize="off" inputMode="email" spellCheck={false} />
          </Field>
          {error && <p className="form-error" role="alert">{error}</p>}
          <Button type="submit" size="parent" block loading={busy} disabled={!online}>
            {t.submit}
          </Button>
        </form>
      )}
      <div className="auth-links">
        <Button variant="ghost" size="parent" onClick={() => navigate(PATHS.login)}>
          {t.back}
        </Button>
      </div>
    </AuthCard>
  );
}

export function ResetPasswordPage(): JSX.Element {
  useDocumentTitle(t.newDocumentTitle);
  const navigate = useNavigate();
  const token = useLinkToken();
  const [pin, setPin] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<{ pin?: string; password?: string; confirm?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (busy || !token) return;
    const passwordProblem = passwordError(password);
    const found = {
      pin: pin === '' ? v.required : undefined,
      password: passwordProblem ?? undefined,
      confirm: passwordProblem === null && confirm !== password ? v.passwordMismatch : undefined,
    };
    setErrors(found);
    if (found.pin || found.password || found.confirm) return;
    setBusy(true);
    setFormError(null);
    try {
      await confirmPasswordReset({ token, pin, newPassword: password });
      setDone(true);
    } catch (err) {
      setPin('');
      setFormError(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  if (!token) {
    return (
      <AuthCard title={t.newTitle} intro={t.missingLink}>
        <div className="auth-links">
          <Button size="parent" onClick={() => navigate(PATHS.forgotPassword)}>
            {t.newLink}
          </Button>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard title={t.newTitle} intro={done ? t.done : t.newIntro}>
      {done ? (
        <Button size="parent" block onClick={() => navigate(PATHS.login, { replace: true })}>
          {t.back}
        </Button>
      ) : (
        <form className="auth-form" noValidate onSubmit={(e) => void submit(e)}>
          <Field label={t.pinLabel} error={errors.pin} required size="parent">
            <TextInput type="password" inputMode="numeric" pattern="[0-9]*" autoComplete="off" value={pin} onChange={(e) => setPin(sanitizePinInput(e.target.value))} />
          </Field>
          <Field label={t.passwordLabel} hint={format(v.passwordLength, { min: LIMITS.passwordMinChars })} error={errors.password} required size="parent">
            <TextInput type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <Field label={t.confirmLabel} error={errors.confirm} required size="parent">
            <TextInput type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </Field>
          {formError && <p className="form-error" role="alert">{formError}</p>}
          <Button type="submit" size="parent" block loading={busy}>
            {t.newSubmit}
          </Button>
          <div className="auth-links">
            <Button variant="ghost" size="parent" onClick={() => navigate(PATHS.forgotPassword)}>
              {t.newLink}
            </Button>
          </div>
        </form>
      )}
    </AuthCard>
  );
}

export function ContinuityPage(): JSX.Element {
  useDocumentTitle(tc.documentTitle);
  const navigate = useNavigate();
  const token = useLinkToken();
  const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle');
  const [error, setError] = useState<string | null>(null);

  const submit = async (): Promise<void> => {
    if (!token) return;
    setState('busy');
    setError(null);
    try {
      await confirmContinuity({ token });
      setState('done');
    } catch (err) {
      setError(describeError(err));
      setState('idle');
    }
  };

  return (
    <AuthCard title={tc.title} intro={!token ? tc.missingLink : state === 'done' ? tc.done : tc.intro}>
      {error && <p className="form-error" role="alert">{error}</p>}
      {token && state !== 'done' && (
        <Button size="parent" block loading={state === 'busy'} onClick={() => void submit()}>
          {tc.submit}
        </Button>
      )}
      <div className="auth-links">
        <Button variant="ghost" size="parent" onClick={() => navigate(PATHS.root, { replace: true })}>
          {tc.open}
        </Button>
      </div>
    </AuthCard>
  );
}
