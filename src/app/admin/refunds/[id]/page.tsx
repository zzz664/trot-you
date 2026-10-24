import { RefundDetailScreen } from '@/components/admin/refunds/RefundDetailScreen';
import { ManagementErrorScreen } from '@/components/subscription/ManagementErrorScreen';
import { getAdminRefundPage } from '@/server/subscription-management/page';

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const result = await getAdminRefundPage((await params).id);
  return result.ok ? (
    <RefundDetailScreen key={JSON.stringify(result.data)} data={result.data} />
  ) : (
    <ManagementErrorScreen code={result.code} admin />
  );
}
