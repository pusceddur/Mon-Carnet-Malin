import { APP_NAME } from '@aide/shared';
import { useEffect, useState, type FormEvent, type JSX } from 'react';
import { useNavigate } from 'react-router';
import { register } from '../../api/auth';
import { Button, Field, Spinner, TextInput } from '../../design/components';
import { parent } from '../../i18n/fr/parent';
import { useOnlineStatus } from '../../platform/online';
import { describeError } from '../../state/errors';
import { PATHS } from '../../state/guards';
import { useSessionStore } from '../../state/session';
import { useDocumentTitle } from '../../state/useDocumentTitle';
import { AccountFields } from './AccountFields';
import { toRegisterRequest, validateRegisterForm, type FormErrors, type RegisterFormValues } from './authForms';
import './auth.css';

const t = parent.register;

const EMPTY: RegisterFormValues = { inviteCode: '', displayName: '', email: '', password: '', passwordConfirm: '', pin: '', pinConfirm: '' };

/** Invitation-only sign-up: creates a (non-owner) parent account with the code shared by the owner. */
export default function RegisterPage(): JSX.Element {
  useDocumentTitle(t.documentTitle);
  const navigate = useNavigate();
  const online = useOnlineStatus();
  const registrationOpen = useSessionStore((s) => s.authStatus?.registrationOpen === true);
  const [checking, setChecking] = useState(online && !registrationOpen);
  const [values, setValues] = useState<RegisterFormValues>(EMPTY);
  const [errors, setErrors] = useState<FormErrors<keyof RegisterFormValues>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Re-reads the status: registrations may have been opened or closed since it was cached.
  useEffect(() => {
    let cancelled = false;
    void useSessionStore.getState().refresh().finally(() => {
      if (!cancelled) setChecking(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const change = (field: keyof RegisterFormValues, value: string): void => {
    setValues((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: undefined }));
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (busy) return;
    const found = validateRegisterForm(values);
    setErrors(found);
    if (Object.values(found).some(Boolean)) return;
    if (!online) {
      setFormError(t.offline);
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      const status = await register(toRegisterRequest(values));
      await useSessionStore.getState().setAuthStatus(status);
      void useSessionStore.getState().refresh();
      navigate(PATHS.root, { replace: true });
    } catch (error) {
      setFormError(describeError(error));
    } finally {
      setBusy(false);
    }
  };

  const header = (
    <div className="auth-card__brand">
      <img className="auth-card__logo" src="/icons/icon.svg" alt="" width={64} height={64} />
      <div>
        <p className="auth-card__intro">{APP_NAME}</p>
        <h1 className="auth-card__title">{t.title}</h1>
      </div>
    </div>
  );

  if (!registrationOpen) {
    return (
      <main className="auth-page">
        <div className="auth-card">
          {header}
          {checking ? (
            <Spinner size="lg" />
          ) : (
            <>
              <p className="form-notice" role="status">{t.closed}</p>
              <div className="auth-links">
                <Button variant="secondary" size="parent" onClick={() => navigate(PATHS.login)}>
                  {t.backToLogin}
                </Button>
              </div>
            </>
          )}
        </div>
      </main>
    );
  }

  return (
    <main className="auth-page">
      <div className="auth-card">
        {header}
        <p className="auth-card__intro">{t.intro}</p>
        {!online && <p className="form-notice" role="status">{t.offline}</p>}

        <form className="auth-form" noValidate onSubmit={(e) => void onSubmit(e)}>
          <Field label={t.inviteCodeLabel} hint={t.inviteCodeHint} error={errors.inviteCode} required size="parent">
            <TextInput
              value={values.inviteCode}
              onChange={(e) => change('inviteCode', e.target.value)}
              autoComplete="off"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
            />
          </Field>
          <AccountFields values={values} errors={errors} onChange={change} />
          {formError && <p className="form-error" role="alert">{formError}</p>}
          <Button type="submit" size="parent" block loading={busy}>
            {t.submit}
          </Button>
        </form>
        <div className="auth-links">
          <Button variant="ghost" size="parent" onClick={() => navigate(PATHS.login)}>
            {t.haveAccount}
          </Button>
        </div>
      </div>
    </main>
  );
}
