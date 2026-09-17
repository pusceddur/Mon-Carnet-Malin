import { LIMITS, PIN_DEFAULT_DIGITS } from '@aide/shared';
import type { JSX } from 'react';
import { Field, TextInput } from '../../design/components';
import { format } from '../../i18n/fr';
import { parent } from '../../i18n/fr/parent';
import { pinShortWarning, sanitizePinInput, type AccountFormValues, type FormErrors } from './authForms';

const t = parent.setup;

export interface AccountFieldsProps {
  values: AccountFormValues;
  errors: FormErrors<keyof AccountFormValues>;
  onChange: (field: keyof AccountFormValues, value: string) => void;
}

/** Name, e-mail, password and parent PIN fields (first installation and invitation sign-up). */
export function AccountFields({ values, errors, onChange }: AccountFieldsProps): JSX.Element {
  const warning = pinShortWarning(values.pin);
  return (
    <>
      <Field label={t.nameLabel} error={errors.displayName} required size="parent">
        <TextInput value={values.displayName} onChange={(e) => onChange('displayName', e.target.value)} autoComplete="given-name" maxLength={80} />
      </Field>
      <Field label={t.emailLabel} error={errors.email} required size="parent">
        <TextInput type="email" value={values.email} onChange={(e) => onChange('email', e.target.value)} autoComplete="username" autoCapitalize="off" inputMode="email" spellCheck={false} />
      </Field>
      <div className="auth-form__pair">
        <Field label={t.passwordLabel} hint={format(t.passwordHint, { min: LIMITS.passwordMinChars })} error={errors.password} required size="parent">
          <TextInput type="password" value={values.password} onChange={(e) => onChange('password', e.target.value)} autoComplete="new-password" />
        </Field>
        <Field label={t.passwordConfirmLabel} error={errors.passwordConfirm} required size="parent">
          <TextInput type="password" value={values.passwordConfirm} onChange={(e) => onChange('passwordConfirm', e.target.value)} autoComplete="new-password" />
        </Field>
      </div>
      <div className="auth-form__pair">
        <Field label={t.pinLabel} hint={warning ?? format(t.pinHint, { digits: PIN_DEFAULT_DIGITS })} error={errors.pin} required size="parent">
          <TextInput type="password" inputMode="numeric" pattern="[0-9]*" autoComplete="off" value={values.pin} onChange={(e) => onChange('pin', sanitizePinInput(e.target.value))} />
        </Field>
        <Field label={t.pinConfirmLabel} error={errors.pinConfirm} required size="parent">
          <TextInput type="password" inputMode="numeric" pattern="[0-9]*" autoComplete="off" value={values.pinConfirm} onChange={(e) => onChange('pinConfirm', sanitizePinInput(e.target.value))} />
        </Field>
      </div>
    </>
  );
}
