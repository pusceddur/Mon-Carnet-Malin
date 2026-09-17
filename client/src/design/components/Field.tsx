import { createContext, useContext, useId, type ComponentPropsWithRef, type JSX, type ReactNode } from 'react';
import { common } from '../../i18n/fr/common';
import type { ControlSize } from './Button';
import { cx } from './internal/cx';
import { AlertIcon, ChevronDownIcon } from './internal/icons';
import './Field.css';

interface FieldContextValue {
  id: string;
  describedBy: string | undefined;
  invalid: boolean;
  required: boolean;
  size: ControlSize;
}

const FieldContext = createContext<FieldContextValue | null>(null);

export interface FieldProps {
  /** Visible label, linked to the control. */
  label: string;
  /** Help shown under the label (read before typing). */
  hint?: string;
  /** Error message under the control; marks the control aria-invalid. */
  error?: string | null;
  required?: boolean;
  /** Appends « (facultatif) » to the label. */
  optional?: boolean;
  /** Default `child`; propagated to the control. */
  size?: ControlSize;
  /** Id of the control (generated when omitted). */
  id?: string;
  className?: string;
  /** One TextInput, TextArea or Select: it picks up id, aria-describedby and aria-invalid automatically. */
  children: ReactNode;
}

/** Label + hint + control + error. */
export function Field({ label, hint, error, required = false, optional = false, size = 'child', id, className, children }: FieldProps): JSX.Element {
  const autoId = useId();
  const controlId = id ?? autoId;
  const hintId = `${controlId}-hint`;
  const errorId = `${controlId}-error`;
  const invalid = Boolean(error);
  const describedBy = [hint ? hintId : null, invalid ? errorId : null].filter(Boolean).join(' ') || undefined;

  return (
    <div className={cx('ui-field', `ui-field--${size}`, className)}>
      <label htmlFor={controlId} className="ui-field__label">
        {label}
        {optional && <span className="ui-field__optional"> ({common.optional})</span>}
      </label>
      {hint && (
        <p id={hintId} className="ui-field__hint">
          {hint}
        </p>
      )}
      <FieldContext.Provider value={{ id: controlId, describedBy, invalid, required, size }}>{children}</FieldContext.Provider>
      {invalid && (
        <p id={errorId} className="ui-field__error">
          <AlertIcon size={18} className="ui-field__error-icon" />
          <span>{error}</span>
        </p>
      )}
    </div>
  );
}

function useFieldProps(props: {
  id?: string;
  size?: ControlSize;
  required?: boolean;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean | 'true' | 'false' | 'grammar' | 'spelling';
}): { id: string | undefined; size: ControlSize; required: boolean | undefined; describedBy: string | undefined; invalid: boolean } {
  const field = useContext(FieldContext);
  const describedBy = [field?.describedBy, props['aria-describedby']].filter(Boolean).join(' ') || undefined;
  const ariaInvalid = props['aria-invalid'];
  return {
    id: props.id ?? field?.id,
    size: props.size ?? field?.size ?? 'child',
    required: props.required ?? (field?.required || undefined),
    describedBy,
    invalid: field?.invalid === true || ariaInvalid === true || ariaInvalid === 'true',
  };
}

export interface TextInputProps extends Omit<ComponentPropsWithRef<'input'>, 'size'> {
  /** Default: the Field size, else `child`. */
  size?: ControlSize;
}

/** Single-line text input (≥ 16px font: no zoom on focus in iPad Safari; Scribble works). */
export function TextInput({ size, id, required, className, type = 'text', ref, ...rest }: TextInputProps): JSX.Element {
  const field = useFieldProps({ id, size, required, 'aria-describedby': rest['aria-describedby'], 'aria-invalid': rest['aria-invalid'] });
  return (
    <input
      {...rest}
      ref={ref}
      id={field.id}
      type={type}
      required={field.required}
      aria-describedby={field.describedBy}
      aria-invalid={field.invalid || undefined}
      className={cx('ui-input', `ui-input--${field.size}`, className)}
    />
  );
}

export interface TextAreaProps extends ComponentPropsWithRef<'textarea'> {
  size?: ControlSize;
}

/** Multi-line text input. */
export function TextArea({ size, id, required, className, rows = 4, ref, ...rest }: TextAreaProps): JSX.Element {
  const field = useFieldProps({ id, size, required, 'aria-describedby': rest['aria-describedby'], 'aria-invalid': rest['aria-invalid'] });
  return (
    <textarea
      {...rest}
      ref={ref}
      id={field.id}
      rows={rows}
      required={field.required}
      aria-describedby={field.describedBy}
      aria-invalid={field.invalid || undefined}
      className={cx('ui-input', 'ui-input--multiline', `ui-input--${field.size}`, className)}
    />
  );
}

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps extends Omit<ComponentPropsWithRef<'select'>, 'size'> {
  /** Options (alternative to `<option>` children). */
  options?: readonly SelectOption[];
  size?: ControlSize;
}

/** Native select (iPad shows its own picker) with a custom chevron. */
export function Select({ size, id, required, className, options, children, ref, ...rest }: SelectProps): JSX.Element {
  const field = useFieldProps({ id, size, required, 'aria-describedby': rest['aria-describedby'], 'aria-invalid': rest['aria-invalid'] });
  return (
    <span className={cx('ui-select', `ui-select--${field.size}`, className)}>
      <select
        {...rest}
        ref={ref}
        id={field.id}
        required={field.required}
        aria-describedby={field.describedBy}
        aria-invalid={field.invalid || undefined}
        className={cx('ui-input', `ui-input--${field.size}`, 'ui-select__control')}
      >
        {options?.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
        {children}
      </select>
      <ChevronDownIcon size={22} className="ui-select__chevron" />
    </span>
  );
}
