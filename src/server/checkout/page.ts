import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { routes } from '@/config/routes';
import type { CheckoutPageData, CheckoutResult } from '@/config/checkout';
import { createAuthContext } from '@/server/auth/context';
import { createCheckoutOfferPort } from '@/server/db/checkout';
import { isRestricted, landingPath } from '@/server/services/auth/access';
import { readSession } from '@/server/services/auth/session';
import { readCheckoutOffer } from '@/server/services/checkout/sessions';
import { checkoutProviderConfiguration } from './configuration';
import { enrollmentLaunchAvailable } from '@/server/enrollment/dependencies';

export async function getCheckoutPage(
  slug: unknown,
): Promise<CheckoutResult<CheckoutPageData>> {
  const context = createAuthContext((await cookies()).getAll());
  const state = await readSession(context.port);
  if (state.status === 'anonymous') redirect(routes.start);
  if (state.status !== 'authenticated' || !context.client)
    return {
      ok: false,
      code: state.status === 'unconfigured' ? 'SETUP_NOT_READY' : 'UNAVAILABLE',
    };
  if (isRestricted(state.profile)) redirect(routes.restricted);
  if (state.profile.role !== 'fan' || !state.profile.onboarding_completed_at)
    redirect(landingPath(state.profile));
  const result = await readCheckoutOffer(
    createCheckoutOfferPort(context.client),
    slug,
  );
  return result.ok
    ? {
        ok: true,
        data: {
          offer: result.data,
          providers: checkoutProviderConfiguration(),
          launchAvailable: enrollmentLaunchAvailable(),
        },
      }
    : result;
}
