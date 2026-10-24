import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createAuthContext } from '@/server/auth/context';
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
