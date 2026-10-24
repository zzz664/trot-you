import { CheckoutErrorScreen } from '@/components/checkout/CheckoutErrorScreen';
export const dynamic = 'force-dynamic';
export default function CheckoutReturnPage() {
  return <CheckoutErrorScreen code="COMPLETION_UNAVAILABLE" />;
}
