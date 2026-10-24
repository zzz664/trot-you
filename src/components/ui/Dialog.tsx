'use client';

import * as RadixDialog from '@radix-ui/react-dialog';
import { useTranslations } from 'next-intl';
import { useRef } from 'react';
import { Button } from './Button';
import { IconButton } from './IconButton';

export type DialogResult = 'confirmed' | 'canceled' | 'dismissed';
export type DialogOptions = {
  key: string;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
};

type DialogProps = {
  options: DialogOptions;
  isOpen: boolean;
  onFinish: (result: DialogResult) => void;
  onAfterClose: () => void;
  onPresented: () => void;
};

// Rendered only by DialogProvider; do not mount independent dialog roots.
export function Dialog({
  options,
  isOpen,
  onFinish,
  onAfterClose,
  onPresented,
}: DialogProps) {
  const t = useTranslations('ui');
  const cancelRef = useRef<HTMLButtonElement>(null);
  return (
    <RadixDialog.Root
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onFinish('dismissed');
      }}
    >
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="ui-dialog-overlay" />
        <RadixDialog.Content
          className="ui-dialog"
          aria-modal="true"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            onPresented();
            cancelRef.current?.focus();
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            onAfterClose();
          }}
        >
          <RadixDialog.Title className="ui-dialog-title">
            {options.title}
          </RadixDialog.Title>
          <RadixDialog.Description>
            {options.description}
          </RadixDialog.Description>
          <div className="ui-actions">
            <Button
              ref={cancelRef}
              variant="secondary"
              onClick={() => onFinish('canceled')}
            >
              {options.cancelLabel ?? t('cancel')}
            </Button>
            <Button onClick={() => onFinish('confirmed')}>
              {options.confirmLabel ?? t('confirm')}
            </Button>
          </div>
          <IconButton
            label={t('close')}
            icon="×"
            variant="secondary"
            onClick={() => onFinish('dismissed')}
          />
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
