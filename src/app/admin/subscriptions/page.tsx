import { AdminSubscriptionsScreen } from '@/components/admin-subscriptions/AdminSubscriptionsScreen';
import { AdminSubscriptionsErrorScreen } from '@/components/admin-subscriptions/AdminSubscriptionsErrorScreen';
import { getAdminSubscriptionPage } from '@/server/admin-subscriptions/page';
import { resolveAdminSubscriptionQuery } from '@/server/services/admin-subscriptions/read';
import { routes } from '@/config/routes';
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const identity = await getAdminSubscriptionPage();
  if (!identity.ok)
    return <AdminSubscriptionsErrorScreen code={identity.code} />;
  const params = await searchParams;
  const query = resolveAdminSubscriptionQuery(params);
  if (!query.ok) return <AdminSubscriptionsErrorScreen code={query.code} />;
  const search = new URLSearchParams(
    Object.entries(params).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  ).toString();
  const path = `${routes.adminSubscriptions}${search ? `?${search}` : ''}`;
  return (
    <AdminSubscriptionsScreen
      key={`${identity.data.key}:${path}`}
      query={query.data}
      path={path}
    />
  );
}
