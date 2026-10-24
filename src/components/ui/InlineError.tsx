'use client';

import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import { Button } from './Button';

type InlineErrorProps = {
  message: string;
  onRetry: () => void | Promise<void>;
};

export function InlineError({ message, onRetry }: InlineErrorProps) {
  const t = useTranslations('ui');
  const retryingRef = useRef(false);
  const [isRetrying, setIsRetrying] = useState(false);
  async function retry() {
    if (retryingRef.current) return;
    retryingRef.current = true;
    setIsRetrying(true);
    try {
      await onRetry();
    } catch {
      // Keep the caller's inline error visible; a retry is never fake success.
    } finally {
      retryingRef.current = false;
      setIsRetrying(false);
    }
  }
  return (
    <div className="ui-inline-error">
      <p role="alert">{message}</p>
      <Button variant="secondary" isLoading={isRetrying} onClick={retry}>
        {isRetrying ? t('retrying') : t('retry')}
      </Button>
    </div>
  );
}
