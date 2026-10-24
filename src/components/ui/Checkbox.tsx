'use client';

import { useId, type ChangeEventHandler } from 'react';

type CheckboxProps = {
  label: string;
  checked: boolean;
  onChange: ChangeEventHandler<HTMLInputElement>;
  disabled?: boolean;
  hint?: string;
};

export function Checkbox({
  label,
  checked,
  onChange,
  disabled,
  hint,
}: CheckboxProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  return (
    <div className="ui-field">
      <label className="ui-choice" htmlFor={id}>
        <input
          id={id}
          type="checkbox"
          checked={checked}
          onChange={onChange}
          disabled={disabled}
          aria-describedby={hint ? hintId : undefined}
        />
        <span>{label}</span>
      </label>
      {hint && (
        <p className="ui-hint" id={hintId}>
          {hint}
        </p>
      )}
    </div>
  );
}

type RadioGroupProps<T extends string> = {
  label: string;
  options: ReadonlyArray<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
};

export function RadioGroup<T extends string>({
  label,
  options,
  value,
  onChange,
  disabled,
}: RadioGroupProps<T>) {
  const name = useId();
  return (
    <fieldset className="ui-choice-group" disabled={disabled}>
      <legend>{label}</legend>
      {options.map((option) => (
        <label className="ui-choice" key={option.value}>
          <input
            type="radio"
            name={name}
            value={option.value}
            checked={value === option.value}
            onChange={() => onChange(option.value)}
          />
          <span>{option.label}</span>
        </label>
      ))}
    </fieldset>
  );
}
