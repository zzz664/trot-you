import { SubscriptionDetailScreen } from '@/components/subscription/SubscriptionDetailScreen';
import { ManagementErrorScreen } from '@/components/subscription/ManagementErrorScreen';
import { getSubscriptionPage } from '@/server/subscription-management/page';

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string | string[] }>;
}) {
  const result = await getSubscriptionPage(
    (await params).id,
    (await searchParams).page,
  );
  return result.ok ? (
    <SubscriptionDetailScreen
      key={JSON.stringify(result.data)}
      data={result.data}
    />
  ) : (
    <ManagementErrorScreen code={result.code} />
  );
}
