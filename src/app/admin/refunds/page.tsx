import { RefundsScreen } from '@/components/admin/refunds/RefundsScreen';
import { ManagementErrorScreen } from '@/components/subscription/ManagementErrorScreen';
import { getAdminRefundsPage } from '@/server/subscription-management/page';

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ page?: string | string[] }>;
}) {
  const result = await getAdminRefundsPage((await searchParams).page);
  return result.ok ? (
    <RefundsScreen data={result.data} />
  ) : (
    <ManagementErrorScreen code={result.code} admin />
  );
}
