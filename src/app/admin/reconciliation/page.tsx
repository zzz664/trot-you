import { ReconciliationScreen } from '@/components/admin/reconciliation/ReconciliationScreen';
import { ReconciliationErrorScreen } from '@/components/admin/reconciliation/ReconciliationErrorScreen';
import { getAdminReconciliationPage } from '@/server/reconciliation/page';

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ page?: string | string[] }>;
}) {
  const result = await getAdminReconciliationPage((await searchParams).page);
  return result.ok ? (
    <ReconciliationScreen data={result.data} />
  ) : (
    <ReconciliationErrorScreen code={result.code} />
  );
}
