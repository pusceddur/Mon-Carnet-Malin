import { APP_NAME } from '@aide/shared';
import { useState, type FormEvent, type JSX } from 'react';
import { useNavigate } from 'react-router';
import { setup } from '../../api/auth';
import { Button, Field, TextInput } from '../../design/components';
import { format } from '../../i18n/fr';
import { parent } from '../../i18n/fr/parent';
import { useOnlineStatus } from '../../platform/online';
import { describeError } from '../../state/errors';
import { PATHS } from '../../state/guards';
import { useSessionStore } from '../../state/session';
import { useDocumentTitle } from '../../state/useDocumentTitle';
import { AccountFields } from './AccountFields';
import { toSetupRequest, validateSetupForm, type FormErrors, type SetupFormValues } from './authForms';
import './auth.css';

const t = parent.setup;

const EMPTY: SetupFormValues = { setupToken: '', displayName: '', email: '', password: '', passwordConfirm: '', pin: '', pinConfirm: '' };

/** First installation: creates the owner parent account with the server setup token (§7). */
export default function SetupPage(): JSX.Element {
  useDocumentTitle(t.documentTitle);
  const navigate = useNavigate();
  const online = useOnlineStatus();
  const [values, setValues] = useState<SetupFormValues>(EMPTY);
  const [errors, setErrors] = useState<FormErrors<keyof SetupFormValues>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const change = (field: keyof SetupFormValues, value: string): void => {
    setValues((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: undefined }));
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (busy) return;
    const found = validateSetupForm(values);
    setErrors(found);
    if (Object.values(found).some(Boolean)) return;
    if (!online) {
      setFormError(t.offline);
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      const status = await setup(toSetupRequest(values));
      await useSessionStore.getState().setAuthStatus(status);
      void useSessionStore.getState().refresh();
      navigate(PATHS.root, { replace: true });
    } catch (error) {
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
          <h1 className="auth-card__title">{format(t.title, { app: APP_NAME })}</h1>
        </div>
        <p className="auth-card__intro">{t.intro}</p>
        {!online && <p className="form-notice" role="status">{t.offline}</p>}

        <form className="auth-form" noValidate onSubmit={(e) => void onSubmit(e)}>
          <Field label={t.tokenLabel} hint={t.tokenHint} error={errors.setupToken} required size="parent">
            <TextInput value={values.setupToken} onChange={(e) => change('setupToken', e.target.value)} autoComplete="off" autoCapitalize="off" spellCheck={false} />
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
