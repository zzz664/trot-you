import { SettlementReportsEntry } from '@/components/settlement-reports/SettlementReportsEntry';
import { AnalyticsFunnelEntry } from '@/components/analytics-funnel/AnalyticsFunnelEntry';
import { AttendancePointsEntry } from '@/components/attendance-points/AttendancePointsEntry';
import { ModerationEntry } from '@/components/community-moderation/ModerationEntry';
import { CommunityEntry } from '@/components/community-posts/CommunityEntry';
import { ContentCalendarEntry } from '@/components/content-calendar/ContentCalendarEntry';
import { ScheduleEntry } from '@/components/schedules/ScheduleEntry';
import { AdminSubscriptionsEntry } from '@/components/admin-subscriptions/AdminSubscriptionsEntry';
import { AdminSettingsEntry } from '@/components/admin-settings/AdminSettingsEntry';
import { getTranslations } from 'next-intl/server';
import { InstallStatusCard } from '@/components/onboarding/InstallStatusCard';
import { BillingNoticeEntry } from '@/components/billing-notices/BillingNoticeEntry';
import { WebPushEntry } from '@/components/webpush/WebPushEntry';
import { SubscriptionEntry } from '@/components/subscription/SubscriptionEntry';
import { RefundEntry } from '@/components/admin/refunds/RefundEntry';
import { ReconciliationEntry } from '@/components/admin/reconciliation/ReconciliationEntry';
import { ArtistCatalogEntry } from '@/components/artists/ArtistCatalogEntry';
import {
  AdminArtistsEntry,
  ArtistAccessEntry,
} from '@/components/admin-artists/AdminArtistsEntry';
import { AuthForm } from './AuthForm';
import { Card } from '@/components/ui/Card';
import { routes } from '@/config/routes';
import { guardPage } from '@/server/auth/page';

export async function SessionPage({ path }: { path: string }) {
  const state = await guardPage(path);
  if (state.status !== 'authenticated') return null;
  const t = await getTranslations('auth');
  const artistCopy = await getTranslations('adminArtists');
  const settingsCopy = await getTranslations('adminSettings');
  const subscriptionsCopy = await getTranslations('adminSubscriptions');
  const analyticsCopy = await getTranslations('analyticsFunnel');
  const settlementCopy = await getTranslations('settlementReports');
  const calendarCopy = await getTranslations('contentCalendar');
  const title =
    path === routes.restricted
      ? 'restrictedTitle'
      : path === routes.onboarding
        ? 'pendingTitle'
        : state.profile.role === 'artist'
          ? 'artistTitle'
          : state.profile.role === 'admin'
            ? 'adminTitle'
            : 'fanTitle';
  const description =
    path === routes.restricted
      ? 'restrictedDescription'
      : path === routes.onboarding
        ? 'pendingDescription'
        : 'featurePending';
  return (
    <main className="app-shell">
      <h1>{t(title)}</h1>
      <p>{t(description)}</p>
      {path === routes.home && state.profile.role === 'fan' && (
        <>
          <InstallStatusCard />
          <WebPushEntry />
          <BillingNoticeEntry />
          <ArtistCatalogEntry />
          <ScheduleEntry />
          <CommunityEntry />
          <ModerationEntry />
          <AttendancePointsEntry />
        </>
      )}
      <SubscriptionEntry />
      {path === routes.home && state.profile.role !== 'admin' && (
        <ArtistAccessEntry label={artistCopy('accessEntry')} />
      )}
      {path === routes.admin && state.profile.role === 'admin' && (
        <>
          <AdminArtistsEntry
            title={artistCopy('entryTitle')}
            description={artistCopy('entryDescription')}
            label={artistCopy('entryOpen')}
          />
          <AdminSettingsEntry
            title={settingsCopy('entryTitle')}
            description={settingsCopy('entryDescription')}
            label={settingsCopy('entryOpen')}
          />
          <SettlementReportsEntry
            title={settlementCopy('title')}
            description={settlementCopy('entryDescription')}
            label={settlementCopy('entryOpen')}
          />
          <AnalyticsFunnelEntry
            title={analyticsCopy('title')}
            description={analyticsCopy('entryDescription')}
            label={analyticsCopy('entryOpen')}
          />
          <AdminSubscriptionsEntry
            title={subscriptionsCopy('title')}
            description={subscriptionsCopy('entryDescription')}
            label={subscriptionsCopy('open')}
          />
          <ScheduleEntry admin />
          <CommunityEntry />
          <ModerationEntry admin />
          <ModerationEntry />
          <ContentCalendarEntry
            title={calendarCopy('adminTitle')}
            description={calendarCopy('adminDescription')}
            label={calendarCopy('entryOpen')}
          />
          <RefundEntry />
          <ReconciliationEntry />
        </>
      )}
      <Card title={t('sessionTitle')}>
        <p>{t('sessionDescription')}</p>
        <p>{t('roleLabel', { role: t(state.profile.role) })}</p>
        <AuthForm
          action={routes.authLogout}
          label={t('logout')}
          pendingLabel={t('logoutPending')}
        />
      </Card>
    </main>
  );
}
