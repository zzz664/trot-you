'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  cancelEnrollment,
  confirmEnrollment,
  readEnrollment,
  reconcileEnrollment,
} from '@/client/enrollment';
import { checkoutExpiryDelay } from '@/client/checkout';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Checkbox } from '@/components/ui/Checkbox';
import { IconButton } from '@/components/ui/IconButton';
import type { CheckoutError } from '@/config/checkout';
import {
  ENROLLMENT_STATUS_POLL_MS,
  type EnrollmentStatus,
} from '@/config/enrollment';
import { artistPreviewPath, routes } from '@/config/routes';

type Action = 'read' | 'confirm' | 'cancel' | 'reconcile';
export function EnrollmentStatusScreen({ sessionId }: { sessionId: string }) {
  const t = useTranslations('enrollment');
  const ui = useTranslations('ui');
  const router = useRouter();
  const [status, setStatus] = useState<EnrollmentStatus | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState<CheckoutError | null>(null);
  const [pending, setPending] = useState<Action | null>('read');
  const [uncertain, setUncertain] = useState(false);
  const active = useRef(true);
  const saving = useRef(false);
  const version = useRef(0);
  const latest = useRef<EnrollmentStatus | null>(null);
  const actionRef = useRef<Action | null>(null);
  const displayedState = status?.status;
  const displayedExpiry = status?.expiresAt;

  const read = useCallback(async () => {
    if (saving.current) return;
    saving.current = true;
    const requestVersion = ++version.current;
    setPending('read');
    const result = await readEnrollment({ sessionId });
    if (!active.current || requestVersion !== version.current) return;
    saving.current = false;
    setPending(null);
    if (!result.ok) {
      setError(result.code);
      setAccepted(false);
      setUncertain(true);
      if (result.code === 'UNAUTHENTICATED') {
        router.replace(routes.start);
        router.refresh();
      }
      return;
    }
    setError(null);
    if (
      latest.current?.policy.version !== result.data.policy.version ||
      latest.current?.amountKrw !== result.data.amountKrw ||
      latest.current?.policy.billingPeriodCalendar !==
        result.data.policy.billingPeriodCalendar ||
      latest.current?.policy.paymentTaxBasis !==
        result.data.policy.paymentTaxBasis
    )
      setAccepted(false);
    latest.current = result.data;
    setStatus(result.data);
    setUncertain(false);
  }, [router, sessionId]);

  useEffect(() => {
    active.current = true;
    const invalidate = () => {
      version.current += 1;
      if (saving.current && actionRef.current) setUncertain(true);
      saving.current = false;
      setPending(null);
    };
    window.addEventListener('popstate', invalidate);
    const initialRead = setTimeout(() => void read(), 0);
    return () => {
      clearTimeout(initialRead);
      active.current = false;
      version.current += 1;
      window.removeEventListener('popstate', invalidate);
    };
  }, [read]);

  useEffect(() => {
    // Only read local status automatically. Unknown/manual review requires an
    // explicit reconcile action and never replays approval or first charge.
    if (status?.status !== 'processing' || error || uncertain) return;
    const timer = setInterval(() => void read(), ENROLLMENT_STATUS_POLL_MS);
    return () => clearInterval(timer);
  }, [status?.status, error, uncertain, read]);

  useEffect(() => {
    if (
      !displayedState ||
      !displayedExpiry ||
      !['awaiting_authorization', 'awaiting_confirmation'].includes(
        displayedState,
      )
    )
      return;
    const expiresAt = displayedExpiry;
    let timer: ReturnType<typeof setTimeout>;
    const checkExpiry = () => {
      clearTimeout(timer);
      const remaining = checkoutExpiryDelay(expiresAt);
      if (remaining === 0) {
        setAccepted(false);
        void read();
      } else timer = setTimeout(checkExpiry, remaining);
    };
    timer = setTimeout(checkExpiry, checkoutExpiryDelay(expiresAt));
    document.addEventListener('visibilitychange', checkExpiry);
    window.addEventListener('pageshow', checkExpiry);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', checkExpiry);
      window.removeEventListener('pageshow', checkExpiry);
    };
  }, [displayedState, displayedExpiry, read]);

  function dismiss() {
    version.current += 1;
    router.replace(
      status ? artistPreviewPath(status.artist.slug) : routes.artists,
    );
  }

  async function act(action: Exclude<Action, 'read'>) {
    const snapshot = latest.current;
    if (!snapshot || saving.current || uncertain) return;
    if (
      action === 'confirm' &&
      (!accepted ||
        !snapshot.canConfirm ||
        snapshot.status !== 'awaiting_confirmation')
    )
      return;
    if (action === 'cancel' && !snapshot.canCancel) return;
    if (action === 'reconcile' && !snapshot.canReconcile) return;
    if (action === 'confirm' && Date.parse(snapshot.expiresAt) <= Date.now()) {
      setError('SESSION_EXPIRED');
      setAccepted(false);
      void read();
      return;
    }
    saving.current = true;
    actionRef.current = action;
    setPending(action);
    setError(null);
    const requestVersion = ++version.current;
    const result =
      action === 'confirm'
        ? await confirmEnrollment({
            sessionId,
            policyVersion: snapshot.policy.version,
            amountKrw: snapshot.amountKrw,
            accepted: true,
          })
        : action === 'cancel'
          ? await cancelEnrollment({ sessionId })
          : await reconcileEnrollment({ sessionId });
    if (!active.current || requestVersion !== version.current) return;
    saving.current = false;
    actionRef.current = null;
    setPending(null);
    setAccepted(false);
    if (!result.ok) {
      setError(result.code);
      // Do not permit a second mutation after a lost or conflicting response.
      setUncertain(true);
      if (result.code === 'UNAUTHENTICATED') router.replace(routes.start);
      return;
    }
    latest.current = result.data;
    setStatus(result.data);
  }

  const busy = pending !== null;
  return (
    <main className="app-shell onboarding-shell">
      <nav aria-label={t('navigation')}>
        <IconButton
          label={ui('back')}
          icon="←"
          variant="secondary"
          onClick={dismiss}
        />
      </nav>
      <header className="onboarding-stack">
        <h1>{t('title')}</h1>
        <p>{t('confirmationExplanation')}</p>
      </header>
      {!status && !error && <p role="status">{t('loading')}</p>}
      {error && <p role="alert">{t(`errors.${error}`)}</p>}
      {uncertain && <p className="ui-hint">{t('noBlindRetry')}</p>}
      {status && (
        <>
          <Card title={status.artist.name}>
            <p role="status">{t(`statuses.${status.status}`)}</p>
            <p>{t(`environments.${status.environment}`)}</p>
            <p>
              {t('amount', { price: status.amountKrw.toLocaleString('ko-KR') })}
            </p>
            <p>
              {t('regularPrice', {
                price: status.regularPriceKrw.toLocaleString('ko-KR'),
              })}
            </p>
          </Card>
          {status.status === 'awaiting_confirmation' && (
            <Card title={status.policy.title}>
              <p className="artist-copy">{status.policy.body}</p>
              <p>{t(`calendars.${status.policy.billingPeriodCalendar}`)}</p>
              <p>{t(`taxBases.${status.policy.paymentTaxBasis}`)}</p>
              <Checkbox
                label={t('chargeConsent', {
                  price: status.amountKrw.toLocaleString('ko-KR'),
                })}
                hint={t('chargeConsentHint')}
                checked={accepted}
                onChange={(event) => setAccepted(event.target.checked)}
                disabled={busy || uncertain || !status.canConfirm}
              />
              <Button
                disabled={busy || uncertain || !accepted || !status.canConfirm}
                isLoading={pending === 'confirm'}
                onClick={() => void act('confirm')}
              >
                {pending === 'confirm'
                  ? t('confirming')
                  : t('confirm', {
                      price: status.amountKrw.toLocaleString('ko-KR'),
                    })}
              </Button>
            </Card>
          )}
          {(status.status === 'unknown' ||
            status.status === 'manual_review') && <p>{t('reviewNotice')}</p>}
          {status.canReconcile && (
            <Button
              variant="secondary"
              disabled={busy || uncertain}
              isLoading={pending === 'reconcile'}
              onClick={() => void act('reconcile')}
            >
              {t('reconcile')}
            </Button>
          )}
          {status.canCancel && (
            <Button
              variant="secondary"
              disabled={busy || uncertain}
              isLoading={pending === 'cancel'}
              onClick={() => void act('cancel')}
            >
              {pending === 'cancel' ? t('canceling') : t('cancel')}
            </Button>
          )}
        </>
      )}
      <section className="onboarding-stack" aria-busy={busy || undefined}>
        <Button
          variant="secondary"
          onClick={() => void read()}
          disabled={busy}
          isLoading={pending === 'read'}
        >
          {t('refresh')}
        </Button>
        <Button variant="secondary" onClick={dismiss}>
          {t('dismiss')}
        </Button>
        <p className="ui-hint">{t('dismissNotice')}</p>
      </section>
    </main>
  );
}
