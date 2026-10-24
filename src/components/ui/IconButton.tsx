'use client';

import type { ReactNode } from 'react';
import { Button, type ButtonProps } from './Button';

type IconButtonProps = Omit<ButtonProps, 'children'> & {
  label: string;
  icon: ReactNode;
};

export function IconButton({
  label,
  icon,
  onClick,
  type,
  variant,
  disabled,
  isLoading,
  ref,
}: IconButtonProps) {
  return (
    <Button
      ref={ref}
      type={type}
      variant={variant}
      disabled={disabled}
      isLoading={isLoading}
      onClick={onClick}
    >
      <span aria-hidden="true">{icon}</span>
      <span>{label}</span>
    </Button>
  );
}
