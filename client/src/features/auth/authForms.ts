import { LIMITS, PIN_DEFAULT_DIGITS, type LoginRequest, type RegisterRequest, type SetupRequest } from '@aide/shared';
import { format } from '../../i18n/fr';
import { parent } from '../../i18n/fr/parent';

const v = parent.validation;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const PIN_RE = new RegExp(`^\\d{${LIMITS.pinMinDigits},${LIMITS.pinMaxDigits}}$`, 'u');
const INVITE_CODE_RE = new RegExp(`^[A-Za-z0-9-]{${LIMITS.inviteCodeMinChars},${LIMITS.inviteCodeMaxChars}}$`, 'u');

export function isValidEmail(email: string): boolean {
  const value = email.trim();
  return value.length <= 254 && EMAIL_RE.test(value);
}

export function pinFormatError(pin: string): string | null {
  return PIN_RE.test(pin) ? null : format(v.pinFormat, { min: LIMITS.pinMinDigits, max: LIMITS.pinMaxDigits });
}

/** Valid but shorter than the recommended length (4–5 digits): shown as a warning, not an error. */
export function pinShortWarning(pin: string): string | null {
  return PIN_RE.test(pin) && pin.length < PIN_DEFAULT_DIGITS ? format(v.pinShortWarning, { digits: PIN_DEFAULT_DIGITS }) : null;
}

export function passwordError(password: string): string | null {
  if (password.length < LIMITS.passwordMinChars) return format(v.passwordLength, { min: LIMITS.passwordMinChars });
  if (password.length > 200) return format(v.tooLong, { max: 200 });
  return null;
}

/** Invitation code typed by a parent or chosen by the owner (trimmed; the server ignores case). */
export function inviteCodeError(code: string): string | null {
  const value = code.trim();
  if (value === '') return v.required;
  return INVITE_CODE_RE.test(value) ? null : format(v.inviteCodeFormat, { min: LIMITS.inviteCodeMinChars, max: LIMITS.inviteCodeMaxChars });
}

/** Fields shared by the first installation and the invitation sign-up. */
export interface AccountFormValues {
  displayName: string;
  email: string;
  password: string;
  passwordConfirm: string;
  pin: string;
  pinConfirm: string;
}

export interface SetupFormValues extends AccountFormValues {
  setupToken: string;
}

export interface RegisterFormValues extends AccountFormValues {
  inviteCode: string;
}

export type FormErrors<K extends string> = Partial<Record<K, string>>;

export function validateAccountForm(values: AccountFormValues): FormErrors<keyof AccountFormValues> {
  const errors: FormErrors<keyof AccountFormValues> = {};
  const name = values.displayName.trim();
  if (name === '') errors.displayName = v.required;
  else if (name.length > 80) errors.displayName = format(v.tooLong, { max: 80 });
  if (values.email.trim() === '') errors.email = v.required;
  else if (!isValidEmail(values.email)) errors.email = v.email;
  const pwd = passwordError(values.password);
  if (pwd) errors.password = pwd;
  else if (values.passwordConfirm !== values.password) errors.passwordConfirm = v.passwordMismatch;
  const pin = pinFormatError(values.pin);
  if (pin) errors.pin = pin;
  else if (values.pinConfirm !== values.pin) errors.pinConfirm = v.pinMismatch;
  return errors;
}

export function validateSetupForm(values: SetupFormValues): FormErrors<keyof SetupFormValues> {
  const errors: FormErrors<keyof SetupFormValues> = {};
  if (values.setupToken.trim() === '') errors.setupToken = v.required;
  return { ...errors, ...validateAccountForm(values) };
}

export function validateRegisterForm(values: RegisterFormValues): FormErrors<keyof RegisterFormValues> {
  const errors: FormErrors<keyof RegisterFormValues> = {};
  const code = inviteCodeError(values.inviteCode);
  if (code) errors.inviteCode = code;
  return { ...errors, ...validateAccountForm(values) };
}

function toAccountRequest(values: AccountFormValues): Omit<SetupRequest, 'setupToken'> {
  return {
    displayName: values.displayName.trim(),
    email: values.email.trim().toLowerCase(),
    password: values.password,
    pin: values.pin,
  };
}

export function toSetupRequest(values: SetupFormValues): SetupRequest {
  return { setupToken: values.setupToken.trim(), ...toAccountRequest(values) };
}

export function toRegisterRequest(values: RegisterFormValues): RegisterRequest {
  return { inviteCode: values.inviteCode.trim(), ...toAccountRequest(values) };
}

export interface LoginFormValues { email: string; password: string }

export function validateLoginForm(values: LoginFormValues): FormErrors<keyof LoginFormValues> {
  const errors: FormErrors<keyof LoginFormValues> = {};
  if (values.email.trim() === '') errors.email = v.required;
  if (values.password === '') errors.password = v.required;
  return errors;
}

export function toLoginRequest(values: LoginFormValues): LoginRequest {
  return { email: values.email.trim().toLowerCase(), password: values.password };
}

/** Keeps digits only, at most LIMITS.pinMaxDigits (PIN text inputs). */
export function sanitizePinInput(value: string): string {
  return value.replace(/\D/gu, '').slice(0, LIMITS.pinMaxDigits);
}
