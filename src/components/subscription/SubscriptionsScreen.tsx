'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { BackButton } from '@/components/ui/BackButton';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import type { SubscriptionList } from '@/config/subscription-management';
import {
  artistPreviewPath,
  routes,
  subscriptionListPath,
  subscriptionPath,
} from '@/config/routes';
import { ManagementPagination } from './ManagementPagination';
import { SubscriptionStatus } from './SubscriptionStatus';

export function SubscriptionsScreen({ data }: { data: SubscriptionList }) {
  const router = useRouter();
  const t = useTranslations('subscriptions');
  const chat = useTranslations('chat');
  const billing = useTranslations('billingNotices');
  return (
    <main className="app-shell onboarding-shell">
      <nav aria-label={t('navigation')}>
        <BackButton fallbackHref={routes.home} />
      </nav>
      <header className="onboarding-stack">
        <h1>{t('title')}</h1>
        <p>{t('description')}</p>
        <p className="ui-hint">{t('timeZone')}</p>
      </header>
      <Link
        href={routes.billingNotices}
        prefetch={false}
        className="ui-button ui-button--secondary"
      >
        {billing('entryOpen')}
      </Link>
      {data.subscriptions.length === 0 ? (
        <Card title={t('emptyTitle')}>
          <p>{t('emptyDescription')}</p>
          <Button
            variant="secondary"
            onClick={() => router.push(routes.artists)}
          >
            {t('catalog')}
          </Button>
        </Card>
      ) : (
        <ul className="artist-list">
          {data.subscriptions.map((subscription) => (
            <li key={subscription.id}>
              <Card title={subscription.artist_name}>
                <SubscriptionStatus data={subscription} />
                {subscription.has_access && (
                  <Link
                    className="ui-button ui-button--primary"
                    href={artistPreviewPath(subscription.artist_slug)}
                    prefetch={false}
                  >
                    {chat('open', { name: subscription.artist_name })}
                  </Link>
                )}
                <Button
                  onClick={() => router.push(subscriptionPath(subscription.id))}
                >
                  {t('open', { name: subscription.artist_name })}
                </Button>
              </Card>
            </li>
          ))}
        </ul>
      )}
      <ManagementPagination
        page={data.page}
        moreAvailable={data.more_available}
        onPage={(page) => router.push(subscriptionListPath(page))}
      />
      <Button variant="secondary" onClick={() => router.refresh()}>
        {t('refresh')}
      </Button>
    </main>
  );
}
