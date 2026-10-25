import { BillingNoticesScreen } from '@/components/billing-notices/BillingNoticesScreen';
import { BillingNoticesErrorScreen } from '@/components/billing-notices/BillingNoticesErrorScreen';
import { getBillingNoticesPage } from '@/server/billing-notices/page';

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ cursor?: string | string[] }>;
}) {
  const result = await getBillingNoticesPage((await searchParams).cursor);
  return result.ok ? (
    <BillingNoticesScreen key={result.data.key} cursor={result.data.cursor} />
  ) : (
    <BillingNoticesErrorScreen code={result.code} />
  );
}
