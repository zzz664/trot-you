'use client';

import * as Label from '@radix-ui/react-label';
import { useId, type ChangeEventHandler, type Ref } from 'react';

type InputProps = {
  label: string;
  id?: string;
  name?: string;
  value?: string;
  defaultValue?: string;
  onChange?: ChangeEventHandler<HTMLInputElement>;
  type?:
    'text' | 'email' | 'password' | 'search' | 'tel' | 'url' | 'datetime-local';
  autoComplete?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  disabled?: boolean;
  readOnly?: boolean;
  ref?: Ref<HTMLInputElement>;
};

export function Input({
  label,
  id,
  name,
  value,
  defaultValue,
  onChange,
  type = 'text',
  autoComplete,
  hint,
  error,
  required,
  disabled,
  readOnly,
  ref,
}: InputProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;
  const describedBy = [hint && hintId, error && errorId]
    .filter(Boolean)
    .join(' ');
  return (
    <div className="ui-field">
      <Label.Root htmlFor={inputId}>{label}</Label.Root>
      {hint && (
        <p className="ui-hint" id={hintId}>
          {hint}
        </p>
      )}
      <input
        ref={ref}
        className="ui-input"
        id={inputId}
        name={name}
        type={type}
        value={value}
        defaultValue={defaultValue}
        onChange={onChange}
        autoComplete={autoComplete}
        required={required}
        disabled={disabled}
        readOnly={readOnly}
        aria-invalid={Boolean(error) || undefined}
        aria-describedby={describedBy || undefined}
      />
      {error && (
        <p className="ui-error-text" id={errorId} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
