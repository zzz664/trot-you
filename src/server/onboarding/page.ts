import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createAuthContext } from '@/server/auth/context';
import { createArtistInterestPort } from '@/server/db/artists';
import { readArtistInterest } from '@/server/services/artists/discovery';
import { createOnboardingPort, readProfileFont } from '@/server/db/onboarding';
import { pageRedirect } from '@/server/services/auth/access';
import { readSession } from '@/server/services/auth/session';
import {
  readOnboarding,
  onboardingStepRedirect,
} from '@/server/services/onboarding/profile';
import {
  ONBOARDING_STEP_PATHS,
  type OnboardingStep,
} from '@/config/onboarding';
import { FONT_SCALE_COOKIE } from '@/config/constants';
import { routes } from '@/config/routes';
import { resolveFontScale } from '@/lib/design-tokens';

export async function getOnboardingPage(step?: OnboardingStep) {
  const context = createAuthContext((await cookies()).getAll());
  const session = await readSession(context.port);
  const path = step ? ONBOARDING_STEP_PATHS[step] : routes.onboarding;
  const target = pageRedirect(session, path);
  if (target) redirect(target);
  if (!context.client || session.status !== 'authenticated')
    return { ok: false, code: 'UNAVAILABLE' } as const;
  const result = await readOnboarding(createOnboardingPort(context.client));
  if (!result.ok) return result;
  // Overview resumes the persisted interest stage, never claims installation
  // or full onboarding completion. Earlier profile screens remain editable.
  if (!step && result.data.profileCompleted && session.profile.role === 'fan') {
    const interest = await readArtistInterest(
      createArtistInterestPort(context.client),
    );
    if (!interest.ok && interest.code === 'PROFILE_REQUIRED')
      return {
        ok: true,
        data: {
          ...result.data,
          profileCompleted: false,
          artistSelected: false,
          // Readiness can fail because an approved name policy changed after
          // the original save. Reopen name validation before asking consent;
          // do not silently erase or rewrite the durable saved calling name.
          nameRevalidationRequired: true,
        },
      } as const;
    if (!interest.ok)
      return {
        ok: false,
        code:
          interest.code === 'SETUP_NOT_READY'
            ? 'SETUP_NOT_READY'
            : 'UNAVAILABLE',
      } as const;
    return {
      ok: true,
      data: {
        ...result.data,
        artistSelected: interest.data.selectedSlug !== null,
      },
    } as const;
  }
  const destination = step ? onboardingStepRedirect(result.data, step) : null;
  if (destination) redirect(destination);
  return result;
}

export async function getServerFontScale() {
  const jar = await cookies();
  const fallback = resolveFontScale(jar.get(FONT_SCALE_COOKIE)?.value);
  const context = createAuthContext(jar.getAll());
  const session = await readSession(context.port);
  if (session.status !== 'authenticated' || !context.client) return fallback;
  try {
    const { data, error } = await readProfileFont(
      context.client,
      session.profile.id,
    );
    return error || !data ? fallback : resolveFontScale(data.font_scale);
  } catch {
    return fallback;
  }
}
