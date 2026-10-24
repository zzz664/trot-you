'use client';

import type { MouseEventHandler, ReactNode, Ref } from 'react';

export type ButtonProps = {
  children: ReactNode;
  onClick?: MouseEventHandler<HTMLButtonElement> | undefined;
  type?: 'button' | 'submit' | 'reset' | undefined;
  variant?: 'primary' | 'secondary' | undefined;
  disabled?: boolean | undefined;
  isLoading?: boolean | undefined;
  describedBy?: string | undefined;
  ref?: Ref<HTMLButtonElement> | undefined;
};

export function Button({
  children,
  onClick,
  type = 'button',
  variant = 'primary',
  disabled = false,
  isLoading = false,
  describedBy,
  ref,
}: ButtonProps) {
  return (
    <button
      ref={ref}
      className={`ui-button ui-button--${variant}`}
      type={type}
      disabled={disabled || isLoading}
      aria-busy={isLoading || undefined}
      aria-describedby={describedBy}
      onClick={onClick}
    >
      {isLoading && <span className="ui-spinner" aria-hidden="true" />}
      {children}
    </button>
  );
}
