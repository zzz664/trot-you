import { SubscriptionsScreen } from '@/components/subscription/SubscriptionsScreen';
import { ManagementErrorScreen } from '@/components/subscription/ManagementErrorScreen';
import { getSubscriptionsPage } from '@/server/subscription-management/page';

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ page?: string | string[] }>;
}) {
  const result = await getSubscriptionsPage((await searchParams).page);
  return result.ok ? (
    <SubscriptionsScreen data={result.data} />
  ) : (
    <ManagementErrorScreen code={result.code} />
  );
}
