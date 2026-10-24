'use client';

import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
} from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { submitInstall } from '@/client/install';
import {
  getInstallBrowserServerSnapshot,
  getInstallBrowserSnapshot,
  promptInstall,
  requestInstallNotificationPermission,
  subscribeInstallBrowser,
} from '@/client/install-browser';
import { AuthForm } from '@/components/auth/AuthForm';
import { IconButton } from '@/components/ui/IconButton';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { RadioGroup } from '@/components/ui/Checkbox';
import { InlineError } from '@/components/ui/InlineError';
import {
  INSTALL_CHOICES,
  type InstallChoice,
  type InstallData,
  type InstallError,
  type InstallInput,
} from '@/config/install';
import { routes } from '@/config/routes';

export function InstallOnboarding({ data }: { data: InstallData }) {
  const t = useTranslations('install');
  const onboardingCopy = useTranslations('onboarding');
  const artistCopy = useTranslations('artists');
  const uiCopy = useTranslations('ui');
  const router = useRouter();
  const browser = useSyncExternalStore(
    subscribeInstallBrowser,
    getInstallBrowserSnapshot,
    getInstallBrowserServerSnapshot,
  );
  const [choice, setChoice] = useState<InstallChoice | ''>(data.choice ?? '');
  const [savedChoice, setSavedChoice] = useState(data.choice);
  const [pending, setPending] = useState<InstallInput['action'] | null>(null);
  const [error, setError] = useState<InstallError | null>(null);
  const [refreshing, startRefresh] = useTransition();
  const saving = useRef(false);
  const active = useRef(true);
  const requestVersion = useRef(0);
  const lastInput = useRef<InstallInput | null>(null);
  const busy = pending !== null || refreshing;
  const guidanceSaved = savedChoice !== null && choice === savedChoice;

  useEffect(() => {
    active.current = true;
    // Browser Back can start newer navigation before this component unmounts.
    const invalidatePending = () => {
      if (saving.current) setError('UNAVAILABLE');
      requestVersion.current += 1;
      saving.current = false;
      setPending(null);
    };
    window.addEventListener('popstate', invalidatePending);
    return () => {
      active.current = false;
      window.removeEventListener('popstate', invalidatePending);
    };
  }, []);

  async function submit(input: InstallInput) {
    if (saving.current || refreshing) return;
    saving.current = true;
    requestVersion.current += 1;
    const version = requestVersion.current;
    lastInput.current = input;
    setPending(input.action);
    setError(null);
    try {
      const result = await submitInstall(input);
      if (!active.current || version !== requestVersion.current) return;
      if (!result.ok) {
        setError(result.code);
        if (result.code === 'GUIDANCE_REQUIRED') setSavedChoice(null);
        if (result.code === 'PROFILE_REQUIRED') {
          router.replace(routes.onboarding);
          router.refresh();
        } else if (result.code === 'INTEREST_REQUIRED') {
          router.replace(routes.onboardingArtists);
          router.refresh();
        } else if (result.code === 'UNAUTHENTICATED') {
          router.replace(routes.start);
          router.refresh();
        }
        return;
      }
      if (input.action === 'acknowledge') {
        setSavedChoice(input.choice);
        // Do not accept another draft while a fresh authoritative RSC key is
        // replacing this form after the committed choice.
        startRefresh(() => router.refresh());
      } else {
        router.replace(result.next);
        router.refresh();
      }
    } catch {
      if (active.current && version === requestVersion.current)
        setError('UNAVAILABLE');
    } finally {
      if (version === requestVersion.current) {
        saving.current = false;
        if (active.current) setPending(null);
      }
    }
  }
  function retry() {
    if (error === 'SETUP_NOT_READY' || error === 'FORBIDDEN')
      startRefresh(() => router.refresh());
    else if (error === 'GUIDANCE_REQUIRED' && choice)
      void submit({ action: 'acknowledge', choice });
    else if (lastInput.current) void submit(lastInput.current);
  }

  return (
    <main className="app-shell onboarding-shell">
      <nav aria-label={t('navigation')}>
        <IconButton
          label={uiCopy('back')}
          icon="←"
          variant="secondary"
          onClick={() => {
            // Invalidate before routing; a slower completion must not override
            // the user's newer Back action while RSC navigation is pending.
            requestVersion.current += 1;
            saving.current = false;
            setPending(null);
            router.replace(routes.onboardingArtists);
          }}
        />
      </nav>
      <header className="onboarding-stack">
        <p className="ui-hint">{t('progress')}</p>
        <h1>{t('title')}</h1>
        <p>{t('description')}</p>
      </header>
      {data.selectedName && (
        <p className="artist-selected">
          {artistCopy('selectedSummary', { name: data.selectedName })}
        </p>
      )}
      <Card title={t('guideTitle')}>
        {browser.standalone ? (
          <p>{t('standalone')}</p>
        ) : (
          <>
            <p>{t(`platforms.${browser.platform}.intro`)}</p>
            <ol className="onboarding-stack">
              <li>{t(`platforms.${browser.platform}.step1`)}</li>
              <li>{t(`platforms.${browser.platform}.step2`)}</li>
              <li>{t(`platforms.${browser.platform}.step3`)}</li>
            </ol>
            {browser.canPrompt && (
              <Button onClick={() => void promptInstall()} disabled={busy}>
                {t('installAction')}
              </Button>
            )}
            {!browser.canPrompt && <p className="ui-hint">{t('noPrompt')}</p>}
          </>
        )}
        {browser.promptState !== 'idle' && (
          <p role="status">{t(`promptStates.${browser.promptState}`)}</p>
        )}
        {browser.installedEventObserved && (
          <p role="status">{t('installedEventObserved')}</p>
        )}
        <p className="ui-hint">{t('installNotRequired')}</p>
      </Card>
      <Card title={t('notificationTitle')}>
        <p>{t('notificationDescription')}</p>
        <p role="status">{t(`notificationStates.${browser.notification}`)}</p>
        {!browser.standalone && <p>{t('notificationAfterInstall')}</p>}
        {browser.standalone && browser.notification === 'default' && (
          <Button
            variant="secondary"
            onClick={() => void requestInstallNotificationPermission()}
            isLoading={browser.notificationPending}
            disabled={busy}
          >
            {t('notificationAction')}
          </Button>
        )}
        {browser.notificationFailed && (
          <p role="alert">{t('notificationFailed')}</p>
        )}
        <p className="ui-hint">{t('notificationNotEnabled')}</p>
      </Card>
      <section className="onboarding-stack" aria-busy={busy || undefined}>
        <RadioGroup<InstallChoice | ''>
          label={t('choiceLabel')}
          options={INSTALL_CHOICES.map((value) => ({
            value,
            label: t(`choices.${value}`),
          }))}
          value={choice}
          onChange={(value) => {
            setChoice(value);
            setError(null);
          }}
          disabled={busy}
        />
        <p className="ui-hint">{t('selfReportNotice')}</p>
        <Button
          variant="secondary"
          onClick={() => {
            if (choice) void submit({ action: 'acknowledge', choice });
          }}
          disabled={!choice || busy || guidanceSaved}
          isLoading={pending === 'acknowledge'}
        >
          {pending === 'acknowledge' ? t('savingChoice') : t('saveChoice')}
        </Button>
        {guidanceSaved && <p role="status">{t('savedChoice')}</p>}
        {error && (
          <InlineError message={t(`errors.${error}`)} onRetry={retry} />
        )}
        <Button
          onClick={() => void submit({ action: 'complete' })}
          disabled={!guidanceSaved || busy}
          isLoading={pending === 'complete'}
        >
          {pending === 'complete' ? t('completing') : t('complete')}
        </Button>
        <p className="ui-hint">{artistCopy('interestNotice')}</p>
      </section>
      <Button
        variant="secondary"
        onClick={() => router.push(routes.onboardingArtists)}
        disabled={busy}
      >
        {artistCopy('changeSelection')}
      </Button>
      <footer className="onboarding-stack">
        <p className="ui-hint">{onboardingCopy('resumeHint')}</p>
        <AuthForm
          action={routes.authLogout}
          label={onboardingCopy('cancel')}
          pendingLabel={onboardingCopy('cancelPending')}
          disabled={busy}
        />
      </footer>
    </main>
  );
}
