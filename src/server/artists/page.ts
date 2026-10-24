import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type {
  ArtistCatalogData,
  ArtistError,
  ArtistInterest,
  ArtistPreviewData,
  ArtistResult,
} from '@/config/artists';
import { routes } from '@/config/routes';
import { createAuthContext } from '@/server/auth/context';
import {
  createArtistCatalogPort,
  createArtistInterestPort,
  createArtistPreviewPort,
} from '@/server/db/artists';
import { createDiscoveryServiceClient } from '@/server/db/discovery-client';
import { createOnboardingPort } from '@/server/db/onboarding';
import { getOnboardingPage } from '@/server/onboarding/page';
import {
  listArtists,
  readArtistInterest,
  readArtistPreview,
} from '@/server/services/artists/discovery';
import { isRestricted, landingPath } from '@/server/services/auth/access';
import { readSession } from '@/server/services/auth/session';
import {
  readOnboarding,
  resumeOnboarding,
} from '@/server/services/onboarding/profile';

function onboardingError(code: string): ArtistResult<never> {
  const mapped: ArtistError =
    code === 'SETUP_NOT_READY'
      ? code
      : code === 'FORBIDDEN'
        ? code
        : code === 'UNAVAILABLE'
          ? code
          : 'PROFILE_REQUIRED';
  return { ok: false, code: mapped };
}

export async function getArtistCatalogPage(
  page: unknown,
  onboarding = false,
): Promise<ArtistResult<ArtistCatalogData>> {
  if (onboarding) {
    const profile = await getOnboardingPage('artists');
    if (!profile.ok) return onboardingError(profile.code);
  }
  const context = createAuthContext((await cookies()).getAll());
  if (!context.client) return { ok: false, code: 'SETUP_NOT_READY' };
  // The public catalog intentionally needs no session. Only the owner-rights
  // active safe view is read; no private image path or contract is selected.
  const result = await listArtists(
    createArtistCatalogPort(context.client),
    page,
  );
  if (!result.ok || !onboarding) return result;
  const interest = await readArtistInterest(
    createArtistInterestPort(context.client),
  );
  if (!interest.ok) return interest;
  return {
    ok: true,
    data: {
      ...result.data,
      onboarding: true,
      selectedSlug: interest.data.selectedSlug,
      selectedName: interest.data.selectedName,
    },
  };
}

export async function getArtistPreviewPage(
  slug: unknown,
): Promise<ArtistResult<ArtistPreviewData>> {
  const context = createAuthContext((await cookies()).getAll());
  const session = await readSession(context.port);
  if (session.status === 'anonymous') redirect(routes.start);
  if (session.status !== 'authenticated' || !context.client)
    return {
      ok: false,
      code:
        session.status === 'unconfigured' ? 'SETUP_NOT_READY' : 'UNAVAILABLE',
    };
  if (isRestricted(session.profile)) redirect(routes.restricted);
  if (session.profile.role !== 'fan') redirect(landingPath(session.profile));
  const profile = await readOnboarding(createOnboardingPort(context.client));
  if (!profile.ok) return onboardingError(profile.code);
  if (!profile.data.profileCompleted) {
    if (!session.profile.onboarding_completed_at)
      redirect(resumeOnboarding(profile.data));
    return { ok: false, code: 'PROFILE_REQUIRED' };
  }
  const interest = await readArtistInterest(
    createArtistInterestPort(context.client),
  );
  if (!interest.ok) return interest;
  const service = createDiscoveryServiceClient();
  if (!service) return { ok: false, code: 'SETUP_NOT_READY' };
  // The subject comes solely from verified Auth + current profile, never from
  // a URL/body or a service-role session. RPC rechecks current fan readiness.
  const result = await readArtistPreview(
    createArtistPreviewPort(service),
    session.profile.id,
    slug,
  );
  return result.ok
    ? {
        ok: true,
        data: {
          ...result.data,
          selectedSlug: interest.data.selectedSlug,
          onboarding: session.profile.onboarding_completed_at === null,
        },
      }
    : result;
}

export async function getArtistInstallPage(): Promise<
  ArtistResult<ArtistInterest>
> {
  const profile = await getOnboardingPage('artists');
  if (!profile.ok) return onboardingError(profile.code);
  const context = createAuthContext((await cookies()).getAll());
  if (!context.client) return { ok: false, code: 'SETUP_NOT_READY' };
  const interest = await readArtistInterest(
    createArtistInterestPort(context.client),
  );
  if (!interest.ok) return interest;
  if (!interest.data.selectedSlug) redirect(routes.onboardingArtists);
  return interest;
}
