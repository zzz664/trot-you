'use client';

import * as Label from '@radix-ui/react-label';
import { useId } from 'react';

type FileInputProps = {
  label: string;
  accept: string;
  onFile: (file: File) => void;
  hint?: string;
  error?: string;
  disabled?: boolean;
};
export function FileInput({
  label,
  accept,
  onFile,
  hint,
  error,
  disabled,
}: FileInputProps) {
  const id = useId();
  return (
    <div className="ui-field">
      <Label.Root htmlFor={id}>{label}</Label.Root>
      {hint && (
        <p className="ui-hint" id={`${id}-hint`}>
          {hint}
        </p>
      )}
      <input
        id={id}
        className="ui-input"
        type="file"
        accept={accept}
        disabled={disabled}
        aria-invalid={Boolean(error) || undefined}
        aria-describedby={
          [hint && `${id}-hint`, error && `${id}-error`]
            .filter(Boolean)
            .join(' ') || undefined
        }
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          // Never retain a native filename in the form or prevent choosing the
          // same file again after cancellation. The owner holds bytes in memory.
          event.currentTarget.value = '';
          if (file) onFile(file);
        }}
      />
      {error && (
        <p className="ui-error-text" id={`${id}-error`} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
