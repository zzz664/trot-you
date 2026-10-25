'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  disableWebPush,
  enableWebPush,
  readWebPush,
  webPushBrowserState,
  type WebPushClientResult,
} from '@/client/webpush';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Checkbox } from '@/components/ui/Checkbox';
import { IconButton } from '@/components/ui/IconButton';
import { InlineError } from '@/components/ui/InlineError';
import { Loading } from '@/components/ui/Loading';
import { routes } from '@/config/routes';
import type { WebPushError, WebPushStatus } from '@/config/webpush';
import {
  INITIAL_WEBPUSH_BROWSER_STATE,
  WEBPUSH_CLIENT,
  type WebPushBrowserError,
} from '@/config/webpush-client';
import styles from './webpush.module.css';

type Operation = 'read' | 'enable' | 'disable';
export function WebPushSettings({ initial }: { initial: WebPushStatus }) {
  const t = useTranslations('notifications');
  const router = useRouter();
  const [status, setStatus] = useState(initial);
  const [browser, setBrowser] = useState(INITIAL_WEBPUSH_BROWSER_STATE);
  const [checked, setChecked] = useState(false);
  const [observed, setObserved] = useState(false);
  const [pending, setPending] = useState<Operation | null>('read');
  const [error, setError] = useState<WebPushError | WebPushBrowserError | null>(
    null,
  );
  const request = useRef(0);
  const active = useRef(false);
  const busy = useRef(false);
  const cleanupRequired = error === 'BROWSER_CLEANUP_REQUIRED';
  const enabled =
    status.configured &&
    status.deviceActive &&
    status.webpushEnabled &&
    status.newMessage &&
    browser.subscriptionPresent &&
    browser.permission === 'granted' &&
    !browser.needsRenewal;
  const unavailable =
    !status.configured ||
    !browser.supported ||
    browser.installRequired ||
    browser.permission === 'denied';

  function apply(result: WebPushClientResult) {
    if (result.ok || result.data) {
      const next = result.data!;
      setStatus(next.status);
      setBrowser(next.browser);
      setObserved(true);
    }
    if (!result.ok && !result.data) {
      const currentBrowser = webPushBrowserState();
      setBrowser((previous) => ({
        ...currentBrowser,
        subscriptionPresent: previous.subscriptionPresent,
      }));
      setObserved(true);
    }
    setError(result.ok ? null : result.code);
    if (result.ok) setChecked(false);
  }

  useEffect(() => {
    active.current = true;
    const read = async () => {
      if (busy.current) return;
      busy.current = true;
      const version = ++request.current;
      setPending('read');
      const result = await readWebPush(
        () => active.current && request.current === version,
      );
      if (active.current && request.current === version) {
        apply(result);
        busy.current = false;
        setPending(null);
      }
    };
    const invalidate = () => {
      request.current += 1;
      busy.current = false;
      setPending(null);
      setChecked(false);
    };
    const visibility = () => {
      if (document.visibilityState === 'visible') void read();
    };
    const mode = window.matchMedia?.(WEBPUSH_CLIENT.displayMode);
    window.addEventListener('focus', read);
    window.addEventListener('pageshow', read);
    window.addEventListener('popstate', invalidate);
    document.addEventListener('visibilitychange', visibility);
    mode?.addEventListener('change', read);
    void read();
    return () => {
      active.current = false;
      request.current += 1;
      busy.current = false;
      window.removeEventListener('focus', read);
      window.removeEventListener('pageshow', read);
      window.removeEventListener('popstate', invalidate);
      document.removeEventListener('visibilitychange', visibility);
      mode?.removeEventListener('change', read);
    };
  }, []);

  async function run(operation: Operation) {
    if (busy.current || (operation === 'enable' && !checked)) return;
    busy.current = true;
    const version = ++request.current;
    const isCurrent = () => active.current && request.current === version;
    setPending(operation);
    setError(null);
    const result = await (operation === 'enable'
      ? enableWebPush(status, isCurrent)
      : operation === 'disable'
        ? disableWebPush(isCurrent)
        : readWebPush(isCurrent));
    if (!isCurrent()) return;
    apply(result);
    busy.current = false;
    setPending(null);
  }
  function navigate() {
    request.current += 1;
    busy.current = false;
    setChecked(false);
    setPending(null);
  }

  return (
    <main className={`app-shell ${styles.stack}`}>
      <nav aria-label={t('navigation')}>
        <IconButton
          label={t('back')}
          icon="←"
          variant="secondary"
          onClick={() => {
            navigate();
            router.replace(routes.home);
          }}
        />
      </nav>
      <header className={styles.stack}>
        <h1>{t('title')}</h1>
        <p>{t('description')}</p>
      </header>
      <Card title={t('privacyTitle')}>
        <p>{t('privacy')}</p>
        <p className="ui-hint">{t('deliveryNotice')}</p>
      </Card>
      <Card title={t('settingsTitle')}>
        <div className={styles.stack} aria-busy={pending !== null || undefined}>
          {pending === 'read' && <Loading label={t('checking')} />}
          {!status.configured && <p role="status">{t('unconfigured')}</p>}
          {observed && (
            <>
              <div>
                <h3>{t('permissionLabel')}</h3>
                <p>{t(`permissions.${browser.permission}`)}</p>
              </div>
              {!browser.secure && <p>{t('insecure')}</p>}
              {browser.installRequired ? (
                <p>{t('iosInstall')}</p>
              ) : (
                !browser.supported && <p>{t('unsupported')}</p>
              )}
              {browser.permission === 'denied' && <p>{t('denied')}</p>}
              <p role="status">{t(enabled ? 'active' : 'inactive')}</p>
              {browser.needsRenewal && <p>{t('renewalNotice')}</p>}
            </>
          )}
          {!enabled && !cleanupRequired && (
            <>
              <Checkbox
                label={t('consent')}
                hint={t('consentHint')}
                checked={checked}
                onChange={(event) => setChecked(event.target.checked)}
                disabled={pending !== null || unavailable || !observed}
              />
              <Button
                onClick={() => void run('enable')}
                disabled={
                  !checked || unavailable || !observed || pending !== null
                }
                isLoading={pending === 'enable'}
              >
                {t(pending === 'enable' ? 'enabling' : 'enable')}
              </Button>
            </>
          )}
          {(enabled || browser.subscriptionPresent || cleanupRequired) && (
            <Button
              variant="secondary"
              onClick={() => void run('disable')}
              disabled={pending !== null}
              isLoading={pending === 'disable'}
            >
              {t(pending === 'disable' ? 'disabling' : 'disable')}
            </Button>
          )}
          {cleanupRequired && <p>{t('cleanupNotice')}</p>}
          {error && (
            <InlineError
              message={t(`errors.${error}`)}
              onRetry={() => run(cleanupRequired ? 'disable' : 'read')}
            />
          )}
          <Button
            variant="secondary"
            onClick={() => void run('read')}
            disabled={pending !== null}
          >
            {t(pending === 'read' ? 'refreshing' : 'refresh')}
          </Button>
          <p className="ui-hint">{t('refreshNotice')}</p>
          <p className="ui-hint">{t('revocationNotice')}</p>
          <p className="ui-hint">{t('sessionNotice')}</p>
        </div>
      </Card>
      <section
        className={`ui-card ${styles.stack}`}
        aria-labelledby={WEBPUSH_CLIENT.installGuideId}
      >
        <h2 id={WEBPUSH_CLIENT.installGuideId} tabIndex={-1}>
          {t('guideTitle')}
        </h2>
        <h3>{t('guideIosTitle')}</h3>
        <ol className={styles.stack}>
          <li>{t('guideIosStep1')}</li>
          <li>{t('guideIosStep2')}</li>
          <li>{t('guideIosStep3')}</li>
        </ol>
        <h3>{t('guideOtherTitle')}</h3>
        <ol className={styles.stack}>
          <li>{t('guideOtherStep1')}</li>
          <li>{t('guideOtherStep2')}</li>
        </ol>
        <p>{t('guideCaution')}</p>
      </section>
      <nav className={styles.actions} aria-label={t('navigation')}>
        <Link
          href={routes.subscriptions}
          prefetch={false}
          className="ui-button ui-button--secondary"
          onClick={navigate}
        >
          {t('subscriptions')}
        </Link>
        <Link
          href={routes.notificationInstallGuide}
          prefetch={false}
          className="ui-button ui-button--secondary"
          onClick={() => {
            navigate();
            document.getElementById(WEBPUSH_CLIENT.installGuideId)?.focus();
          }}
        >
          {t('installGuide')}
        </Link>
      </nav>
    </main>
  );
}
