// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { routes } from '@/config/routes';
import type { OnboardingData } from '@/config/onboarding';
import {
  getArtistCatalogPage,
  getArtistInstallPage,
  getArtistPreviewPage,
} from '@/server/artists/page';
const mocks = vi.hoisted(() => ({
  cookies: vi.fn(),
  context: vi.fn(),
  session: vi.fn(),
  redirect: vi.fn(),
  onboarding: vi.fn(),
  profileRead: vi.fn(),
  catalog: vi.fn(),
  interest: vi.fn(),
  preview: vi.fn(),
  service: vi.fn(),
  previewFactory: vi.fn(),
}));
vi.mock('next/headers', () => ({ cookies: mocks.cookies }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));
vi.mock('@/server/auth/context', () => ({ createAuthContext: mocks.context }));
vi.mock('@/server/services/auth/session', () => ({
  readSession: mocks.session,
}));
vi.mock('@/server/onboarding/page', () => ({
  getOnboardingPage: mocks.onboarding,
}));
vi.mock('@/server/db/onboarding', () => ({
  createOnboardingPort: () => ({ read: mocks.profileRead }),
}));
vi.mock('@/server/db/discovery-client', () => ({
  createDiscoveryServiceClient: mocks.service,
}));
vi.mock('@/server/db/artists', () => ({
  createArtistCatalogPort: () => ({ list: mocks.catalog }),
  createArtistInterestPort: () => ({ read: mocks.interest }),
  createArtistPreviewPort: (client: unknown) => {
    mocks.previewFactory(client);
    return { read: mocks.preview };
  },
}));
const id = 'a1100000-0000-4000-8000-000000000001';
const profile = {
  id,
  role: 'fan',
  onboarding_completed_at: null,
  is_restricted: false,
  restricted_until: null,
};
const data: OnboardingData = {
  fontScale: 'large',
  fontSelected: true,
  callName: '별님',
  nameMin: 2,
  nameMax: 10,
  nameReady: true,
  profileCompleted: true,
  terms: { version: id, title: '허구', body: '허구 본문' },
  privacy: { version: id, title: '허구', body: '허구 본문' },
  analytics: null,
};
const artist = { slug: 'fictional-star', name: '허구 가수', description: null };
const interest = {
  selectedSlug: artist.slug,
  selectedName: artist.name,
  selectedAt: '2026-10-24T00:00:00Z',
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.cookies.mockResolvedValue({
    getAll: () => [{ name: 'fixture', value: 'actor-cookie' }],
  });
  mocks.context.mockReturnValue({
    client: { actor: true },
    port: { verified: true },
  });
  mocks.session.mockResolvedValue({ status: 'authenticated', profile });
  mocks.onboarding.mockResolvedValue({ ok: true, data });
  mocks.profileRead.mockResolvedValue({ ok: true, data });
  mocks.catalog.mockResolvedValue({ ok: true, data: [artist] });
  mocks.interest.mockResolvedValue({ ok: true, data: interest });
  mocks.preview.mockResolvedValue({
    ok: true,
    data: {
      artist,
      callName: '별님',
      messages: [
        {
          id,
          kind: 'text',
          template: '{이름}의 허구 맛보기',
          sentAt: '2026-10-24T00:00:00Z',
          media: [],
        },
      ],
    },
  });
  mocks.service.mockReturnValue({ privileged: true });
  mocks.redirect.mockImplementation((path: string) => {
    throw new Error(`redirect:${path}`);
  });
});

describe('public versus onboarded artist catalog page', () => {
  it('allows anonymous public catalog without private session/profile reads', async () => {
    mocks.session.mockResolvedValue({ status: 'anonymous' });
    expect(await getArtistCatalogPage(undefined)).toMatchObject({
      ok: true,
      data: {
        artists: [artist],
        page: 1,
        onboarding: false,
        selectedSlug: null,
        selectedName: null,
      },
    });
    expect(mocks.session).not.toHaveBeenCalled();
    expect(mocks.onboarding).not.toHaveBeenCalled();
    expect(mocks.interest).not.toHaveBeenCalled();
    expect(mocks.service).not.toHaveBeenCalled();
  });
  it('guards onboarding first, then combines only current selected active interest', async () => {
    expect(await getArtistCatalogPage('2', true)).toMatchObject({
      ok: true,
      data: {
        onboarding: true,
        selectedSlug: artist.slug,
        selectedName: artist.name,
        page: 2,
      },
    });
    expect(mocks.onboarding).toHaveBeenCalledExactlyOnceWith('artists');
    expect(mocks.interest).toHaveBeenCalledOnce();
  });
  it.each([
    ['SETUP_NOT_READY', 'SETUP_NOT_READY'],
    ['FORBIDDEN', 'FORBIDDEN'],
    ['UNAVAILABLE', 'UNAVAILABLE'],
    ['CONSENT_REQUIRED', 'PROFILE_REQUIRED'],
  ] as const)(
    'blocks onboarding %s before reading catalog',
    async (code, mapped) => {
      mocks.onboarding.mockResolvedValue({ ok: false, code });
      expect(await getArtistCatalogPage(undefined, true)).toEqual({
        ok: false,
        code: mapped,
      });
      expect(mocks.catalog).not.toHaveBeenCalled();
      expect(mocks.interest).not.toHaveBeenCalled();
    },
  );
  it('fails closed without public DB configuration', async () => {
    mocks.context.mockReturnValue({ client: null, port: null });
    expect(await getArtistCatalogPage(undefined)).toEqual({
      ok: false,
      code: 'SETUP_NOT_READY',
    });
    expect(mocks.catalog).not.toHaveBeenCalled();
  });
  it('does not read private interest after invalid page input or catalog failure', async () => {
    expect(await getArtistCatalogPage(['1'], true)).toEqual({
      ok: false,
      code: 'INVALID_INPUT',
    });
    mocks.catalog.mockResolvedValue({ ok: false, code: 'UNAVAILABLE' });
    expect(await getArtistCatalogPage(undefined, true)).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
    });
    expect(mocks.interest).not.toHaveBeenCalled();
  });
  it('withholds the onboarding catalog on fresh interest readiness failure', async () => {
    mocks.interest.mockResolvedValue({ ok: false, code: 'PROFILE_REQUIRED' });
    expect(await getArtistCatalogPage(undefined, true)).toEqual({
      ok: false,
      code: 'PROFILE_REQUIRED',
    });
  });
});

describe('personalized preview page independent authority checks', () => {
  it('derives actor exclusively from the verified session and never exposes the capability or calling-name field', async () => {
    const result = await getArtistPreviewPage(artist.slug);
    expect(mocks.session).toHaveBeenCalledExactlyOnceWith({ verified: true });
    expect(mocks.preview).toHaveBeenCalledExactlyOnceWith(id, artist.slug);
    expect(mocks.previewFactory).toHaveBeenCalledExactlyOnceWith({
      privileged: true,
    });
    expect(result).toMatchObject({
      ok: true,
      data: {
        onboarding: true,
        selectedSlug: artist.slug,
        messages: [{ text: '별님의 허구 맛보기' }],
      },
    });
    if (result.ok) expect(result.data).not.toHaveProperty('observationActorId');
    for (const forbidden of [
      'privileged',
      'actor-cookie',
      'callName',
      'template',
      'body_template',
    ])
      expect(JSON.stringify(result)).not.toContain(forbidden);
  });
  it('allows a completed fan only after current profile and policy checks, without offering onboarding selection', async () => {
    mocks.session.mockResolvedValue({
      status: 'authenticated',
      profile: { ...profile, onboarding_completed_at: '2026-10-01T00:00:00Z' },
    });
    expect(await getArtistPreviewPage(artist.slug)).toMatchObject({
      ok: true,
      data: { onboarding: false, observationActorId: id },
    });
    expect(mocks.profileRead).toHaveBeenCalledOnce();
    expect(mocks.interest).toHaveBeenCalledOnce();
  });
  it('sends anonymous users to sign-in before private reads', async () => {
    mocks.session.mockResolvedValue({ status: 'anonymous' });
    await expect(getArtistPreviewPage(artist.slug)).rejects.toThrow(
      `redirect:${routes.start}`,
    );
    expect(mocks.profileRead).not.toHaveBeenCalled();
    expect(mocks.preview).not.toHaveBeenCalled();
  });
  it.each([
    ['unconfigured', 'SETUP_NOT_READY'],
    ['unavailable', 'UNAVAILABLE'],
  ] as const)('fails closed on %s session', async (status, code) => {
    mocks.session.mockResolvedValue({ status });
    expect(await getArtistPreviewPage(artist.slug)).toEqual({
      ok: false,
      code,
    });
    expect(mocks.service).not.toHaveBeenCalled();
    expect(mocks.preview).not.toHaveBeenCalled();
  });
  it.each([
    [{ ...profile, is_restricted: true }, routes.restricted],
    [
      {
        ...profile,
        is_restricted: true,
        restricted_until: '2999-01-01T00:00:00Z',
      },
      routes.restricted,
    ],
    [
      { ...profile, role: 'admin', onboarding_completed_at: 'done' },
      routes.admin,
    ],
    [
      { ...profile, role: 'artist', onboarding_completed_at: 'done' },
      routes.artist,
    ],
    [{ ...profile, role: 'artist' }, routes.onboarding],
  ])(
    'redirects current restriction/role before any privileged read',
    async (actor, target) => {
      mocks.session.mockResolvedValue({
        status: 'authenticated',
        profile: actor,
      });
      await expect(getArtistPreviewPage(artist.slug)).rejects.toThrow(
        `redirect:${target}`,
      );
      expect(mocks.profileRead).not.toHaveBeenCalled();
      expect(mocks.service).not.toHaveBeenCalled();
    },
  );
  it.each([
    [
      { ...data, profileCompleted: false, fontSelected: false, callName: null },
      routes.onboardingFont,
    ],
    [
      { ...data, profileCompleted: false, callName: null },
      routes.onboardingName,
    ],
    [{ ...data, profileCompleted: false }, routes.onboardingConsent],
  ])(
    'requires persisted profile prerequisites before personalization',
    async (state, target) => {
      mocks.profileRead.mockResolvedValue({ ok: true, data: state });
      await expect(getArtistPreviewPage(artist.slug)).rejects.toThrow(
        `redirect:${target}`,
      );
      expect(mocks.interest).not.toHaveBeenCalled();
      expect(mocks.preview).not.toHaveBeenCalled();
    },
  );
  it('does not route a completed but now policy-stale fan through a redirect loop', async () => {
    mocks.session.mockResolvedValue({
      status: 'authenticated',
      profile: { ...profile, onboarding_completed_at: 'done' },
    });
    mocks.profileRead.mockResolvedValue({
      ok: true,
      data: { ...data, profileCompleted: false },
    });
    expect(await getArtistPreviewPage(artist.slug)).toEqual({
      ok: false,
      code: 'PROFILE_REQUIRED',
    });
    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(mocks.preview).not.toHaveBeenCalled();
  });
  it.each(['SETUP_NOT_READY', 'FORBIDDEN', 'UNAVAILABLE'] as const)(
    'surfaces profile %s before service capability creation',
    async (code) => {
      mocks.profileRead.mockResolvedValue({ ok: false, code });
      expect(await getArtistPreviewPage(artist.slug)).toEqual({
        ok: false,
        code,
      });
      expect(mocks.service).not.toHaveBeenCalled();
    },
  );
  it.each(['PROFILE_REQUIRED', 'SETUP_NOT_READY', 'FORBIDDEN'] as const)(
    'rechecks current interest readiness %s before preview',
    async (code) => {
      mocks.interest.mockResolvedValue({ ok: false, code });
      expect(await getArtistPreviewPage(artist.slug)).toEqual({
        ok: false,
        code,
      });
      expect(mocks.service).not.toHaveBeenCalled();
    },
  );
  it('reports server preview capability unavailability without inventing media or messages', async () => {
    mocks.service.mockReturnValue(null);
    expect(await getArtistPreviewPage(artist.slug)).toEqual({
      ok: false,
      code: 'SETUP_NOT_READY',
    });
    expect(mocks.preview).not.toHaveBeenCalled();
  });
  it('keeps hidden/missing artist and privileged RPC errors as controlled states', async () => {
    mocks.preview.mockResolvedValue({ ok: false, code: 'NOT_FOUND' });
    expect(await getArtistPreviewPage(artist.slug)).toEqual({
      ok: false,
      code: 'NOT_FOUND',
    });
    mocks.preview.mockRejectedValue(new Error('private service query'));
    expect(await getArtistPreviewPage(artist.slug)).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
    });
  });
});

describe('pending install requires durable active interest without full completion', () => {
  it('returns persisted selection only after profile-stage page guard', async () => {
    expect(await getArtistInstallPage()).toEqual({ ok: true, data: interest });
    expect(mocks.onboarding).toHaveBeenCalledExactlyOnceWith('artists');
    expect(mocks.preview).not.toHaveBeenCalled();
    expect(mocks.service).not.toHaveBeenCalled();
  });
  it('redirects absent or deactivated selected artist back to selection', async () => {
    mocks.interest.mockResolvedValue({
      ok: true,
      data: { selectedSlug: null, selectedName: null, selectedAt: null },
    });
    await expect(getArtistInstallPage()).rejects.toThrow(
      `redirect:${routes.onboardingArtists}`,
    );
  });
  it('cannot cross current policy or configuration failures', async () => {
    mocks.onboarding.mockResolvedValue({ ok: false, code: 'CONSENT_REQUIRED' });
    expect(await getArtistInstallPage()).toEqual({
      ok: false,
      code: 'PROFILE_REQUIRED',
    });
    expect(mocks.interest).not.toHaveBeenCalled();
    mocks.onboarding.mockResolvedValue({ ok: true, data });
    mocks.context.mockReturnValue({ client: null });
    expect(await getArtistInstallPage()).toEqual({
      ok: false,
      code: 'SETUP_NOT_READY',
    });
    mocks.context.mockReturnValue({ client: { actor: true } });
    mocks.interest.mockResolvedValue({ ok: false, code: 'FORBIDDEN' });
    expect(await getArtistInstallPage()).toEqual({
      ok: false,
      code: 'FORBIDDEN',
    });
  });
});
