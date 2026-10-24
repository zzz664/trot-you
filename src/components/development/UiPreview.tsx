'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { BackButton } from '@/components/ui/BackButton';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { type DialogResult } from '@/components/ui/Dialog';
import { useDialog } from '@/components/ui/DialogProvider';
import { InlineError } from '@/components/ui/InlineError';
import { Input } from '@/components/ui/Input';
import { Loading } from '@/components/ui/Loading';
import { previewDialogKeys } from '@/config/ui-preview';

export function UiPreview() {
  const t = useTranslations('uiPreview');
  const { showDialog, cancelDialog } = useDialog();
  const [result, setResult] = useState<DialogResult | null>(null);
  const [hasRetried, setHasRetried] = useState(false);
  const resultKeys = {
    confirmed: 'resultConfirmed',
    canceled: 'resultCanceled',
    dismissed: 'resultDismissed',
  } as const;
  function openFirst() {
    return showDialog({
      key: previewDialogKeys.first,
      title: t('dialogTitle'),
      description: t('dialogDescription'),
    });
  }
  function openQueue(shouldCancelSecond = false) {
    void openFirst().then(setResult);
    void showDialog({
      key: previewDialogKeys.second,
      title: t('secondTitle'),
      description: t('dialogDescription'),
    });
    if (shouldCancelSecond) cancelDialog(previewDialogKeys.second);
  }
  return (
    <main className="app-shell" tabIndex={-1}>
      <BackButton />
      <h1>{t('title')}</h1>
      <p>{t('description')}</p>
      <Card title={t('controlsTitle')}>
        <Input
          label={t('inputLabel')}
          hint={t('inputHint')}
          error={t('inputError')}
        />
        <Button disabled>{t('disabled')}</Button>
        <Button isLoading>{t('loadingButton')}</Button>
      </Card>
      <Card title={t('statusTitle')}>
        <Loading />
        <InlineError
          message={t('error')}
          onRetry={() => {
            setHasRetried(true);
          }}
        />
        {hasRetried && <p role="status">{t('retryResult')}</p>}
      </Card>
      <Card title={t('dialogTitle')}>
        <Button
          onClick={() => {
            void openFirst().then(setResult);
          }}
        >
          {t('openDialog')}
        </Button>
        <Button onClick={() => openQueue()}>{t('openQueue')}</Button>
        <Button onClick={() => openQueue(true)}>{t('cancelQueued')}</Button>
        {result && <p role="status">{t(resultKeys[result])}</p>}
      </Card>
    </main>
  );
}
