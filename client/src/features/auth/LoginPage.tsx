import { APP_NAME } from '@aide/shared';
import { useEffect, useState, type FormEvent, type JSX } from 'react';
import { useNavigate } from 'react-router';
import { login } from '../../api/auth';
import { Button, Field, TextInput } from '../../design/components';
import { parent } from '../../i18n/fr/parent';
import { useOnlineStatus } from '../../platform/online';
import { describeError } from '../../state/errors';
import { PATHS } from '../../state/guards';
import { useSessionStore } from '../../state/session';
import { useDocumentTitle } from '../../state/useDocumentTitle';
import { toLoginRequest, validateLoginForm, type FormErrors, type LoginFormValues } from './authForms';
import './auth.css';

const t = parent.login;

/** Parent sign-in (email + password); links to the invitation sign-up while registrations are open. */
export default function LoginPage(): JSX.Element {
  useDocumentTitle(t.documentTitle);
  const navigate = useNavigate();
  const online = useOnlineStatus();
  const registrationOpen = useSessionStore((s) => s.authStatus?.registrationOpen === true);
  const passwordResetAvailable = useSessionStore((s) => s.authStatus?.passwordResetAvailable === true);
  const [values, setValues] = useState<LoginFormValues>({ email: '', password: '' });
  const [errors, setErrors] = useState<FormErrors<keyof LoginFormValues>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // The cached status may predate a change of the invitation settings (e.g. after a sign-out).
  useEffect(() => {
    void useSessionStore.getState().refresh();
  }, []);

  const change = (field: keyof LoginFormValues, value: string): void => {
    setValues((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: undefined }));
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (busy) return;
    const found = validateLoginForm(values);
    setErrors(found);
    if (Object.values(found).some(Boolean)) return;
    if (!online) {
      setFormError(t.offline);
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      const status = await login(toLoginRequest(values));
      await useSessionStore.getState().setAuthStatus(status);
      void useSessionStore.getState().refresh();
      navigate(PATHS.root, { replace: true });
    } catch (error) {
      setValues((prev) => ({ ...prev, password: '' }));
      setFormError(describeError(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="auth-page">
      <div className="auth-card">
        <div className="auth-card__brand">
          <img className="auth-card__logo" src="/icons/icon.svg" alt="" width={64} height={64} />
          <div>
            <p className="auth-card__intro">{APP_NAME}</p>
            <h1 className="auth-card__title">{t.title}</h1>
          </div>
        </div>
        <p className="auth-card__intro">{t.intro}</p>
        {!online && <p className="form-notice" role="status">{t.offline}</p>}

        <form className="auth-form" noValidate onSubmit={(e) => void onSubmit(e)}>
          <Field label={t.emailLabel} error={errors.email} required size="parent">
            <TextInput
              type="email"
              value={values.email}
              onChange={(e) => change('email', e.target.value)}
              autoComplete="username"
              autoCapitalize="off"
              inputMode="email"
              spellCheck={false}
            />
          </Field>
          <Field label={t.passwordLabel} error={errors.password} required size="parent">
            <TextInput type="password" value={values.password} onChange={(e) => change('password', e.target.value)} autoComplete="current-password" />
          </Field>
          {formError && <p className="form-error" role="alert">{formError}</p>}
          <Button type="submit" size="parent" block loading={busy}>
            {t.submit}
          </Button>
        </form>
        {(registrationOpen || passwordResetAvailable) && (
          <div className="auth-links">
            {passwordResetAvailable && (
              <Button variant="ghost" size="parent" onClick={() => navigate(PATHS.forgotPassword)}>
                {t.forgotLink}
              </Button>
            )}
            {registrationOpen && (
              <Button variant="ghost" size="parent" onClick={() => navigate(PATHS.register)}>
                {t.registerLink}
              </Button>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
