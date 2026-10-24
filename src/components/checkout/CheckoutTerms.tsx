'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  prepareCheckout,
  cancelCheckout,
  checkoutExpiryDelay,
} from '@/client/checkout';
import { EnrollmentLauncher } from './EnrollmentLauncher';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Checkbox, RadioGroup } from '@/components/ui/Checkbox';
import { IconButton } from '@/components/ui/IconButton';
import { InlineError } from '@/components/ui/InlineError';
import type {
  CheckoutError,
  CheckoutIntent,
  CheckoutPageData,
  CheckoutProvider,
} from '@/config/checkout';
import { artistPreviewPath, routes } from '@/config/routes';

// Preparation consent is separate from provider registration and first charge.
export function CheckoutTerms({ data }: { data: CheckoutPageData }) {
  const t = useTranslations('checkout');
  const uiCopy = useTranslations('ui');
  const router = useRouter();
  const [provider, setProvider] = useState<CheckoutProvider | ''>('');
  const [accepted, setAccepted] = useState(false);
  const [intent, setIntent] = useState<CheckoutIntent | null>(null);
  const [error, setError] = useState<CheckoutError | null>(null);
  const [pending, setPending] = useState<'prepare' | 'cancel' | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const [enrollmentStarted, setEnrollmentStarted] = useState(false);
  const [refreshing, startRefresh] = useTransition();
  const active = useRef(true);
  const saving = useRef(false);
  const requestVersion = useRef(0);
  const requestKey = useRef<string | null>(null);
  const busy = pending !== null || refreshing;
  const selectedReady = data.providers.some(
    (option) => option.provider === provider && option.configured,
  );
  const locked = busy || uncertain || intent !== null;

  useEffect(() => {
    active.current = true;
    const invalidate = () => {
      requestVersion.current += 1;
      if (saving.current) {
        setUncertain(true);
        setError('UNAVAILABLE');
      }
      saving.current = false;
      setPending(null);
    };
    window.addEventListener('popstate', invalidate);
    return () => {
      active.current = false;
      requestVersion.current += 1;
      window.removeEventListener('popstate', invalidate);
    };
  }, []);

  useEffect(() => {
    if (!intent || intent.status !== 'pending_intent') return;
    const current = intent;
    let timer: ReturnType<typeof setTimeout>;
    const checkExpiry = () => {
      clearTimeout(timer);
      const remaining = checkoutExpiryDelay(current.expiresAt);
      if (remaining === 0) {
        setIntent((latest) =>
          latest?.id === current.id && latest.status === 'pending_intent'
            ? { ...latest, status: 'expired' }
            : latest,
        );
      } else timer = setTimeout(checkExpiry, remaining);
    };
    timer = setTimeout(checkExpiry, checkoutExpiryDelay(current.expiresAt));
    document.addEventListener('visibilitychange', checkExpiry);
    window.addEventListener('pageshow', checkExpiry);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', checkExpiry);
      window.removeEventListener('pageshow', checkExpiry);
    };
  }, [intent]);

  function back() {
    requestVersion.current += 1;
    if (saving.current) setUncertain(true);
    saving.current = false;
    setPending(null);
    router.replace(artistPreviewPath(data.offer.artist.slug));
  }

  async function submit(action: 'prepare' | 'cancel') {
    if (saving.current || refreshing || uncertain) return;
    if (
      action === 'prepare' &&
      (!provider || !selectedReady || !accepted || intent)
    )
      return;
    if (action === 'cancel' && intent?.status !== 'pending_intent') return;
    saving.current = true;
    const version = ++requestVersion.current;
    setPending(action);
    setError(null);
    try {
      requestKey.current ??= crypto.randomUUID();
      const result =
        action === 'prepare'
          ? await prepareCheckout({
              artistSlug: data.offer.artist.slug,
              provider: provider as CheckoutProvider,
              policyVersion: data.offer.policy.version,
              accepted: true,
              idempotencyKey: requestKey.current,
            })
          : await cancelCheckout({ sessionId: intent!.id });
      if (!active.current || version !== requestVersion.current) return;
      if (!result.ok) {
        setError(result.code);
        if (
          result.code === 'UNAVAILABLE' ||
          result.code === 'CHECKOUT_EXISTS' ||
          result.code === 'POLICY_CHANGED'
        )
          setUncertain(true);
        if (result.code === 'POLICY_CHANGED') setAccepted(false);
        if (result.code === 'UNAUTHENTICATED') {
          router.replace(routes.start);
          router.refresh();
        }
        return;
      }
      setIntent(result.data);
    } catch {
      if (active.current && version === requestVersion.current) {
        setError('UNAVAILABLE');
        setUncertain(true);
      }
    } finally {
      if (version === requestVersion.current) {
        saving.current = false;
        if (active.current) setPending(null);
      }
    }
  }

  return (
    <main className="app-shell onboarding-shell">
      <nav aria-label={t('navigation')}>
        <IconButton
          label={uiCopy('back')}
          icon="←"
          variant="secondary"
          onClick={back}
        />
      </nav>
      <header className="onboarding-stack">
        <h1>{t('title', { name: data.offer.artist.name })}</h1>
        <p>
          {t(
            data.launchAvailable ? 'enrollmentExplanation' : 'preparationOnly',
          )}
        </p>
      </header>
      <Card title={t('priceTitle')}>
        <p>
          {t('regularPrice', {
            price: (
              intent?.regularPriceKrw ?? data.offer.policy.regularPriceKrw
            ).toLocaleString('ko-KR'),
          })}
        </p>
        {(intent?.introEligible ?? data.offer.introEligible) ? (
          <p>
            {t('introPrice', {
              price: (
                intent?.initialPriceKrw ?? data.offer.policy.introPriceKrw
              ).toLocaleString('ko-KR'),
            })}
          </p>
        ) : (
          <p>{t('introUsed')}</p>
        )}
        <p className="ui-hint">
          {t(data.launchAvailable ? 'enrollmentPriceNotice' : 'noChargeToday')}
        </p>
      </Card>
      <Card title={data.offer.policy.title}>
        <p className="artist-copy">{data.offer.policy.body}</p>
      </Card>
      <section className="onboarding-stack" aria-busy={busy || undefined}>
        <RadioGroup<CheckoutProvider | ''>
          label={t('providerLabel')}
          options={data.providers.map((option) => ({
            value: option.provider,
            label: t(
              option.configured ? 'providerConfigured' : 'providerUnconfigured',
              { provider: t(`providers.${option.provider}`) },
            ),
          }))}
          value={provider}
          onChange={(value) => {
            setProvider(value);
            setError(null);
          }}
          disabled={locked}
        />
        <p className="ui-hint">{t('configurationNotApproval')}</p>
        <Checkbox
          label={t('consent')}
          hint={t(
            data.launchAvailable ? 'enrollmentConsentHint' : 'consentHint',
          )}
          checked={accepted}
          onChange={(event) => setAccepted(event.target.checked)}
          disabled={locked}
        />
        <Button
          disabled={locked || !accepted || !selectedReady}
          isLoading={pending === 'prepare'}
          onClick={() => void submit('prepare')}
        >
          {pending === 'prepare' ? t('preparing') : t('prepare')}
        </Button>
        {error && (
          <InlineError
            message={t(`errors.${error}`)}
            onRetry={() => startRefresh(() => router.refresh())}
          />
        )}
        {uncertain && <p className="ui-hint">{t('unknownNotice')}</p>}
      </section>
      {intent && (
        <Card title={t('intentTitle')}>
          <p role="status">{t(`intentStatuses.${intent.status}`)}</p>
          <p>
            {t(
              data.launchAvailable
                ? 'enrollmentIntentNotice'
                : 'intentNotPayment',
            )}
          </p>
          <p>
            {t('intentInitialPrice', {
              price: intent.initialPriceKrw.toLocaleString('ko-KR'),
            })}
          </p>
          <p>
            {t('intentRegularPrice', {
              price: intent.regularPriceKrw.toLocaleString('ko-KR'),
            })}
          </p>
          <p className="ui-hint">{t('intentPriceNotice')}</p>
          {intent.status === 'pending_intent' && !enrollmentStarted && (
            <>
              <p className="ui-hint">{t('expirationNotice')}</p>
              <Button
                variant="secondary"
                onClick={() => void submit('cancel')}
                disabled={busy || uncertain}
                isLoading={pending === 'cancel'}
              >
                {pending === 'cancel' ? t('canceling') : t('cancelIntent')}
              </Button>
            </>
          )}
        </Card>
      )}
      {data.launchAvailable && intent ? (
        <EnrollmentLauncher
          intent={intent}
          disabled={busy || uncertain || intent.status !== 'pending_intent'}
          onStart={() => setEnrollmentStarted(true)}
        />
      ) : !data.launchAvailable ? (
        <section className="onboarding-stack">
          <Button disabled>{t('completionUnavailable')}</Button>
          <p>{t('completionExplanation')}</p>
        </section>
      ) : null}
    </main>
  );
}
