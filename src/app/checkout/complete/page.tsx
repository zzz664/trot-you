import { redirect } from 'next/navigation';
import { CheckoutErrorScreen } from '@/components/checkout/CheckoutErrorScreen';
import { EnrollmentStatusScreen } from '@/components/checkout/EnrollmentStatusScreen';
import { enrollmentSessionSchema } from '@/config/enrollment';
import { enrollmentCompletePath } from '@/config/routes';

export const dynamic = 'force-dynamic';
export default async function EnrollmentCompletePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const parsed = enrollmentSessionSchema.safeParse({
    sessionId: query.session,
  });
  if (!parsed.success) return <CheckoutErrorScreen code="NOT_FOUND" />;
  if (Object.keys(query).some((key) => key !== 'session'))
    redirect(enrollmentCompletePath(parsed.data.sessionId));
  return (
    <EnrollmentStatusScreen
      key={parsed.data.sessionId}
      sessionId={parsed.data.sessionId}
    />
  );
}
