import { CheckoutTerms } from '@/components/checkout/CheckoutTerms';
import { CheckoutErrorScreen } from '@/components/checkout/CheckoutErrorScreen';
import { getCheckoutPage } from '@/server/checkout/page';
export const dynamic = 'force-dynamic';
export default async function CheckoutPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const result = await getCheckoutPage(slug);
  return result.ok ? (
    <CheckoutTerms
      key={`${slug}:${result.data.offer.policy.version}`}
      data={result.data}
    />
  ) : (
    <CheckoutErrorScreen code={result.code} />
  );
}
