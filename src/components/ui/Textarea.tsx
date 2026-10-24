'use client';

import * as Label from '@radix-ui/react-label';
import { useId, type ChangeEventHandler, type Ref } from 'react';

type TextareaProps = {
  label: string;
  value: string;
  onChange: ChangeEventHandler<HTMLTextAreaElement>;
  hint?: string;
  error?: string | undefined;
  disabled?: boolean;
  readOnly?: boolean;
  ref?: Ref<HTMLTextAreaElement>;
};

export function Textarea({
  label,
  value,
  onChange,
  hint,
  error,
  disabled,
  readOnly,
  ref,
}: TextareaProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  return (
    <div className="ui-field">
      <Label.Root htmlFor={id}>{label}</Label.Root>
      {hint && (
        <p className="ui-hint" id={hintId}>
          {hint}
        </p>
      )}
      <textarea
        ref={ref}
        id={id}
        className="ui-input ui-textarea"
        value={value}
        onChange={onChange}
        disabled={disabled}
        readOnly={readOnly}
        aria-invalid={Boolean(error) || undefined}
        aria-describedby={
          [hint && hintId, error && errorId].filter(Boolean).join(' ') ||
          undefined
        }
      />
      {error && (
        <p className="ui-error-text" id={errorId} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
