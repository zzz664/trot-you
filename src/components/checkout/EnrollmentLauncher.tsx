'use client';

import { useEffect, useRef, useState } from 'react';
import Script from 'next/script';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  chooseKakaoEnrollmentRedirect,
  openTossEnrollment,
  startEnrollment,
} from '@/client/enrollment';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import type { CheckoutError, CheckoutIntent } from '@/config/checkout';
import type { EnrollmentStart } from '@/config/enrollment';
import { enrollmentCompletePath, routes } from '@/config/routes';

export function EnrollmentLauncher({
  intent,
  disabled,
  onStart,
}: {
  intent: CheckoutIntent;
  disabled: boolean;
  onStart: () => void;
}) {
  const t = useTranslations('enrollment');
  const checkout = useTranslations('checkout');
  const router = useRouter();
  const [result, setResult] = useState<EnrollmentStart | null>(null);
  const [error, setError] = useState<CheckoutError | null>(null);
  const [pending, setPending] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [sdkReady, setSdkReady] = useState(false);
  const [opened, setOpened] = useState(false);
  const active = useRef(true);
  const saving = useRef(false);
  const launched = useRef(false);
  const started = useRef(false);
  const version = useRef(0);

  useEffect(() => {
    active.current = true;
    const invalidate = () => {
      version.current += 1;
      saving.current = false;
      setPending(false);
      if (started.current) setError('UNAVAILABLE');
    };
    window.addEventListener('popstate', invalidate);
    return () => {
      active.current = false;
      version.current += 1;
      window.removeEventListener('popstate', invalidate);
    };
  }, []);

  async function start() {
    if (
      saving.current ||
      attempted ||
      disabled ||
      intent.status !== 'pending_intent'
    )
      return;
    saving.current = true;
    started.current = true;
    setAttempted(true);
    setPending(true);
    onStart();
    const requestVersion = ++version.current;
    const next = await startEnrollment({ sessionId: intent.id });
    if (!active.current || requestVersion !== version.current) return;
    saving.current = false;
    setPending(false);
    if (!next.ok) {
      setError(next.code);
      if (next.code === 'UNAUTHENTICATED') router.replace(routes.start);
      return;
    }
    setResult(next.data);
  }

  async function open() {
    if (!result?.launch || launched.current || disabled) return;
    launched.current = true;
    setOpened(true);
    if (result.launch.kind === 'kakaopay_redirect') {
      const target = chooseKakaoEnrollmentRedirect(
        result.launch,
        result.status,
        navigator.userAgent,
      );
      if (!target) {
        setError('UNAVAILABLE');
        return;
      }
      window.location.assign(target);
      return;
    }
    const requestVersion = version.current;
    const success = await openTossEnrollment(result.launch, result.status);
    if (active.current && requestVersion === version.current && !success)
      setError('UNAVAILABLE');
  }

  return (
    <Card title={t('launchTitle')}>
      <p>{t('launchExplanation')}</p>
      {!attempted && (
        <Button
          onClick={() => void start()}
          disabled={disabled || intent.status !== 'pending_intent'}
        >
          {t('start')}
        </Button>
      )}
      {pending && <p role="status">{t('starting')}</p>}
      {result?.launch?.kind === 'toss_billing_auth' && (
        <Script
          src={result.launch.sdkUrl}
          strategy="afterInteractive"
          onReady={() => setSdkReady(true)}
          onError={() => setError('UNAVAILABLE')}
        />
      )}
      {result && <p>{t(`environments.${result.status.environment}`)}</p>}
      {result?.launch && !opened && (
        <Button
          onClick={() => void open()}
          disabled={
            disabled ||
            (result.launch.kind === 'toss_billing_auth' && !sdkReady)
          }
        >
          {t(
            result.launch.kind === 'toss_billing_auth'
              ? 'openToss'
              : 'openKakao',
          )}
        </Button>
      )}
      {opened && <p role="status">{t('opened')}</p>}
      {error && <p role="alert">{checkout(`errors.${error}`)}</p>}
      {attempted && (
        <>
          <p className="ui-hint">{t('noBlindRetry')}</p>
          <Button
            variant="secondary"
            onClick={() => router.replace(enrollmentCompletePath(intent.id))}
          >
            {t('viewStatus')}
          </Button>
        </>
      )}
    </Card>
  );
}
