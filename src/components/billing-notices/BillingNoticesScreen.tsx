'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { InlineError } from '@/components/ui/InlineError';
import { Loading } from '@/components/ui/Loading';
import { APP_LOCALE } from '@/config/constants';
import { BILLING_NOTICE_TIME_ZONE } from '@/config/billing-notices';
import { billingNoticePath, routes, subscriptionPath } from '@/config/routes';
import { useBillingNotices } from './useBillingNotices';
import styles from './billing-notices.module.css';

export function billingNoticeDate(value: string) {
  return new Intl.DateTimeFormat(APP_LOCALE, {
    timeZone: BILLING_NOTICE_TIME_ZONE,
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(value));
}

export function BillingNoticesScreen({ cursor }: { cursor: string | null }) {
  const t = useTranslations('billingNotices');
  const state = useBillingNotices(cursor);
  const data = state.page;
  return (
    <main className="app-shell onboarding-shell">
      <Link
        href={routes.subscriptions}
        prefetch={false}
        onNavigate={state.clear}
        className="ui-button ui-button--secondary"
      >
        {t('back')}
      </Link>
      <header className="onboarding-stack">
        <h1>{t('title')}</h1>
        <p>{t('description')}</p>
        <p className="ui-hint">{t('timeZone')}</p>
      </header>
      <Button
        variant="secondary"
        disabled={state.busy}
        onClick={() => void state.refresh()}
      >
        {t('refresh')}
      </Button>
      {state.busy && <Loading label={t('loading')} />}
      {state.error && (
        <InlineError
          message={t(`errors.${state.error}`)}
          onRetry={state.refresh}
        />
      )}
      {state.error === 'UNAUTHENTICATED' && (
        <Link
          href={routes.start}
          prefetch={false}
          onNavigate={state.clear}
          className="ui-button ui-button--primary"
        >
          {t('signIn')}
        </Link>
      )}
      {data && (
        <>
          <Card title={t('preferenceTitle')}>
            <p>{t('preferenceDescription')}</p>
            <p data-billing-preference={String(data.billingEnabled)}>
              {t(data.billingEnabled ? 'preferenceOn' : 'preferenceOff')}
            </p>
            <Button
              variant="secondary"
              disabled={state.busy}
              onClick={() => void state.setPreference(!data.billingEnabled)}
            >
              {t(
                data.billingEnabled ? 'disablePreference' : 'enablePreference',
              )}
            </Button>
            <p className="ui-hint">{t('mandatoryPreferenceNote')}</p>
          </Card>
          {data.notices.length === 0 ? (
            <Card title={t('emptyTitle')}>
              <p>{t('emptyDescription')}</p>
              <Link
                href={routes.subscriptions}
                prefetch={false}
                onNavigate={state.clear}
                className="ui-button ui-button--secondary"
              >
                {t('manageSubscriptions')}
              </Link>
            </Card>
          ) : (
            <ul className="artist-list">
              {data.notices.map((notice) => (
                <li key={notice.id} data-billing-notice-id={notice.id}>
                  <Card title={notice.artistName}>
                    <dl className={styles.details}>
                      <div>
                        <dt>{t('amountLabel')}</dt>
                        <dd>
                          {t('amount', {
                            amount: new Intl.NumberFormat(APP_LOCALE).format(
                              notice.amountKrw,
                            ),
                          })}
                        </dd>
                      </div>
                      <div>
                        <dt>{t('billingAtLabel')}</dt>
                        <dd>
                          <time dateTime={notice.billingAt}>
                            {billingNoticeDate(notice.billingAt)}
                          </time>
                        </dd>
                      </div>
                    </dl>
                    <p className="ui-hint">
                      {t(notice.mandatory ? 'mandatory' : 'optional')}
                    </p>
                    <p className="ui-hint">
                      {t('createdAt', {
                        date: billingNoticeDate(notice.createdAt),
                      })}
                    </p>
                    <p>
                      {notice.readAt
                        ? t('read', { date: billingNoticeDate(notice.readAt) })
                        : t('unread')}
                    </p>
                    <p className="ui-hint">{t('readMeaning')}</p>
                    <div className={styles.actions}>
                      {!notice.readAt && (
                        <Button
                          variant="secondary"
                          disabled={state.busy}
                          onClick={() => void state.markRead(notice.id)}
                        >
                          {t('markRead')}
                        </Button>
                      )}
                      <Link
                        href={subscriptionPath(notice.subscriptionId)}
                        prefetch={false}
                        onNavigate={state.clear}
                        className="ui-button ui-button--primary"
                      >
                        {t('manage', { name: notice.artistName })}
                      </Link>
                    </div>
                  </Card>
                </li>
              ))}
            </ul>
          )}
          <nav className={styles.actions} aria-label={t('pagination')}>
            {cursor && (
              <Link
                href={routes.billingNotices}
                prefetch={false}
                onNavigate={state.clear}
                className="ui-button ui-button--secondary"
              >
                {t('first')}
              </Link>
            )}
            {data.hasMore && data.nextCursor && (
              <Link
                href={billingNoticePath(data.nextCursor)}
                prefetch={false}
                onNavigate={state.clear}
                className="ui-button ui-button--secondary"
              >
                {t('next')}
              </Link>
            )}
          </nav>
        </>
      )}
    </main>
  );
}
