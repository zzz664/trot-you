'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { submitOnboarding } from '@/client/onboarding';
import { AuthForm } from '@/components/auth/AuthForm';
import { BackButton } from '@/components/ui/BackButton';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Checkbox, RadioGroup } from '@/components/ui/Checkbox';
import { InlineError } from '@/components/ui/InlineError';
import { Input } from '@/components/ui/Input';
import { designTokens, type FontScale } from '@/config/design-tokens';
import type { OnboardingData, OnboardingStep } from '@/config/onboarding';
import { routes } from '@/config/routes';

export function ProfileOnboarding({
  step,
  data,
}: {
  step: OnboardingStep;
  data: OnboardingData;
}) {
  const t = useTranslations('onboarding');
  const router = useRouter();
  const [fontScale, setFontScale] = useState(data.fontScale);
  const [callName, setCallName] = useState(data.callName ?? '');
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  // A checked box belongs to the exact document shown, not to a future version
  // that could arrive after a retry/refresh. Every new version needs a new tap.
  const [acceptedTerms, setAcceptedTerms] = useState<string | null>(null);
  const [acceptedPrivacy, setAcceptedPrivacy] = useState<string | null>(null);
  const [acceptedAnalytics, setAcceptedAnalytics] = useState<string | null>(
    null,
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const saving = useRef(false);
  const active = useRef(true);
  const persistedScale = useRef(data.fontScale);
  const termsAccepted = Boolean(
    data.terms && acceptedTerms === data.terms.version,
  );
  const privacyAccepted = Boolean(
    data.privacy && acceptedPrivacy === data.privacy.version,
  );
  const analyticsAccepted = Boolean(
    data.analytics && acceptedAnalytics === data.analytics.version,
  );
  const setupReady =
    step === 'name'
      ? data.nameReady
      : step === 'consent'
        ? Boolean(data.nameReady && data.terms && data.privacy)
        : true;
  const previousPath =
    step === 'font'
      ? routes.onboarding
      : step === 'name'
        ? routes.onboardingFont
        : step === 'consent'
          ? routes.onboardingName
          : routes.onboardingConsent;

  useEffect(() => {
    active.current = true;
    // The root layout is reused on client navigation. A save may have committed
    // after this screen was left, so resuming must apply fresh server state.
    document.documentElement.dataset.fontScale = persistedScale.current;
    return () => {
      active.current = false;
      // Unsaved previews must not overwrite the persisted preference after Back.
      document.documentElement.dataset.fontScale = persistedScale.current;
    };
  }, []);

  function previewScale(scale: FontScale) {
    setFontScale(scale);
    document.documentElement.dataset.fontScale = scale;
    setError(null);
  }

  async function save() {
    if (saving.current || step === 'artists' || !setupReady) return;
    saving.current = true;
    setPending(true);
    setError(null);
    try {
      const result = await submitOnboarding(
        step === 'font'
          ? { step, fontScale }
          : step === 'name'
            ? { step, callName }
            : {
                step,
                ageConfirmed,
                termsVersion: data.terms!.version,
                privacyVersion: data.privacy!.version,
                termsAccepted,
                privacyAccepted,
                analyticsAccepted,
                analyticsVersion: data.analytics?.version ?? null,
              },
      );
      if (!active.current) return;
      if (!result.ok) {
        setError(result.code);
        return;
      }
      if (step === 'font') persistedScale.current = fontScale;
      router.push(result.next);
      router.refresh();
    } catch {
      if (active.current) setError('UNAVAILABLE');
    } finally {
      saving.current = false;
      if (active.current) setPending(false);
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void save();
  }

  function retryConfiguration() {
    setError(null);
    router.refresh();
  }

  return (
    <main className="app-shell onboarding-shell">
      <nav aria-label={t('navigation')}>
        <BackButton fallbackHref={previousPath} />
      </nav>
      <header className="onboarding-stack">
        <p className="ui-hint">{t(`${step}Progress`)}</p>
        <h1>{t(`${step}Title`)}</h1>
        <p>{t(`${step}Description`)}</p>
      </header>
      {step === 'artists' ? (
        <Card title={t('profileSavedTitle')}>
          <p>{t('profileSavedDescription')}</p>
        </Card>
      ) : (
        <form className="onboarding-stack" onSubmit={onSubmit}>
          {step === 'font' && (
            <>
              <RadioGroup
                label={t('fontLabel')}
                options={Object.keys(designTokens.scales).map((scale) => ({
                  value: scale as FontScale,
                  label: t(`fontOptions.${scale}`),
                }))}
                value={fontScale}
                onChange={previewScale}
                disabled={pending}
              />
              <Card title={t('previewTitle')}>
                <p>{t('previewBody')}</p>
                <p className="ui-hint">{t('previewHint')}</p>
              </Card>
            </>
          )}
          {step === 'name' && (
            <Input
              label={t('nameLabel')}
              value={callName}
              onChange={(event) => {
                setCallName(event.target.value);
                setError(null);
              }}
              autoComplete="nickname"
              hint={
                data.nameMin !== null && data.nameMax !== null
                  ? t('nameHint', { min: data.nameMin, max: data.nameMax })
                  : t('namePendingHint')
              }
              disabled={pending}
              required
            />
          )}
          {step === 'consent' && (
            <>
              <Checkbox
                label={t('ageLabel')}
                hint={t('ageHint')}
                checked={ageConfirmed}
                onChange={(event) => setAgeConfirmed(event.target.checked)}
                disabled={pending}
              />
              {data.terms && (
                <Card title={data.terms.title}>
                  <p className="ui-hint">
                    {t('policyVersion', { version: data.terms.version })}
                  </p>
                  <p className="onboarding-policy-body">{data.terms.body}</p>
                  <Checkbox
                    label={t('termsLabel')}
                    checked={termsAccepted}
                    onChange={(event) =>
                      setAcceptedTerms(
                        event.target.checked ? data.terms!.version : null,
                      )
                    }
                    disabled={pending || !setupReady}
                  />
                </Card>
              )}
              {data.privacy && (
                <Card title={data.privacy.title}>
                  <p className="ui-hint">
                    {t('policyVersion', { version: data.privacy.version })}
                  </p>
                  <p className="onboarding-policy-body">{data.privacy.body}</p>
                  <Checkbox
                    label={t('privacyLabel')}
                    checked={privacyAccepted}
                    onChange={(event) =>
                      setAcceptedPrivacy(
                        event.target.checked ? data.privacy!.version : null,
                      )
                    }
                    disabled={pending || !setupReady}
                  />
                </Card>
              )}
              {data.analytics ? (
                <Card title={data.analytics.title}>
                  <p className="ui-hint">
                    {t('policyVersion', { version: data.analytics.version })}
                  </p>
                  <p className="onboarding-policy-body">
                    {data.analytics.body}
                  </p>
                  <Checkbox
                    label={t('analyticsLabel')}
                    hint={t('analyticsHint')}
                    checked={analyticsAccepted}
                    onChange={(event) =>
                      setAcceptedAnalytics(
                        event.target.checked ? data.analytics!.version : null,
                      )
                    }
                    disabled={pending || !setupReady}
                  />
                </Card>
              ) : (
                <p className="ui-hint">{t('analyticsUnavailable')}</p>
              )}
            </>
          )}
          {!setupReady && (
            <InlineError
              message={t('setupNotReady')}
              onRetry={retryConfiguration}
            />
          )}
          {error && (
            <InlineError
              message={t(`errors.${error}`)}
              onRetry={
                error === 'POLICY_CHANGED' || error === 'SETUP_NOT_READY'
                  ? retryConfiguration
                  : save
              }
            />
          )}
          <Button type="submit" isLoading={pending} disabled={!setupReady}>
            {pending ? t('saving') : t('continue')}
          </Button>
        </form>
      )}
      <footer className="onboarding-stack">
        <p className="ui-hint">{t('resumeHint')}</p>
        <AuthForm
          action={routes.authLogout}
          label={t('cancel')}
          pendingLabel={t('cancelPending')}
          disabled={pending}
        />
      </footer>
    </main>
  );
}
