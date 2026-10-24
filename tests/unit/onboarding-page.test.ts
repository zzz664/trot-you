// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getOnboardingPage,
  getServerFontScale,
} from '@/server/onboarding/page';
import { routes } from '@/config/routes';
import { resumeOnboarding } from '@/server/services/onboarding/profile';
import type { OnboardingData } from '@/config/onboarding';
const mocks = vi.hoisted(() => ({
  cookies: vi.fn(),
  context: vi.fn(),
  session: vi.fn(),
  read: vi.fn(),
  font: vi.fn(),
  redirect: vi.fn(),
  interest: vi.fn(),
}));
vi.mock('next/headers', () => ({ cookies: mocks.cookies }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));
vi.mock('@/server/auth/context', () => ({ createAuthContext: mocks.context }));
vi.mock('@/server/services/auth/session', () => ({
  readSession: mocks.session,
}));
vi.mock('@/server/db/artists', () => ({
  createArtistInterestPort: () => ({ read: mocks.interest }),
}));
vi.mock('@/server/db/onboarding', () => ({
  createOnboardingPort: () => ({ read: mocks.read }),
  readProfileFont: mocks.font,
}));
const profile = {
  id: 'verified-fixture',
  role: 'fan',
  onboarding_completed_at: null,
  is_restricted: false,
  restricted_until: null,
};
const data: OnboardingData = {
  fontScale: 'large',
  fontSelected: false,
  callName: null,
  nameMin: null,
  nameMax: null,
  nameReady: false,
  profileCompleted: false,
  terms: null,
  privacy: null,
  analytics: null,
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.cookies.mockResolvedValue({
    getAll: () => [],
    get: () => ({ value: 'normal' }),
  });
  mocks.context.mockReturnValue({ client: {}, port: {} });
  mocks.session.mockResolvedValue({ status: 'authenticated', profile });
  mocks.read.mockResolvedValue({ ok: true, data });
  mocks.redirect.mockImplementation((path: string) => {
    throw new Error(`redirect:${path}`);
  });
  mocks.font.mockResolvedValue({ data: { font_scale: 'xlarge' }, error: null });
  mocks.interest.mockResolvedValue({
    ok: true,
    data: { selectedSlug: null, selectedName: null, selectedAt: null },
  });
});
describe('onboarding RSC authorization and first-render font', () => {
  it.each(['anonymous', 'unavailable', 'unconfigured'])(
    'redirects %s away from protected step before profile read',
    async (status) => {
      mocks.session.mockResolvedValue({ status });
      await expect(getOnboardingPage('consent')).rejects.toThrow(
        `redirect:${routes.start}`,
      );
      expect(mocks.read).not.toHaveBeenCalled();
    },
  );
  it.each([
    [{ ...profile, is_restricted: true }, routes.restricted],
    [{ ...profile, onboarding_completed_at: 'done' }, routes.home],
    [
      { ...profile, onboarding_completed_at: 'done', role: 'admin' },
      routes.admin,
    ],
  ])(
    'respects current restriction/completion/role before reading onboarding',
    async (actor, target) => {
      mocks.session.mockResolvedValue({
        status: 'authenticated',
        profile: actor,
      });
      await expect(getOnboardingPage('font')).rejects.toThrow(
        `redirect:${target}`,
      );
      expect(mocks.read).not.toHaveBeenCalled();
    },
  );
  it('keeps overview readable but enforces persisted prerequisites on every step', async () => {
    expect(await getOnboardingPage()).toEqual({ ok: true, data });
    await expect(getOnboardingPage('name')).rejects.toThrow(
      `redirect:${routes.onboardingFont}`,
    );
    mocks.read.mockResolvedValue({
      ok: true,
      data: { ...data, fontSelected: true },
    });
    await expect(getOnboardingPage('consent')).rejects.toThrow(
      `redirect:${routes.onboardingName}`,
    );
  });
  it('surfaces unavailable data without a fabricated successful stage', async () => {
    mocks.read.mockResolvedValue({ ok: false, code: 'UNAVAILABLE' });
    expect(await getOnboardingPage('font')).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
    });
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
  it('uses authenticated persisted profile on first SSR, even with a stale cookie', async () => {
    expect(await getServerFontScale()).toBe('xlarge');
    expect(mocks.font).toHaveBeenCalledWith({}, profile.id);
  });
  it('uses cookie before login without reading any profile', async () => {
    mocks.session.mockResolvedValue({ status: 'anonymous' });
    expect(await getServerFontScale()).toBe('normal');
    expect(mocks.font).not.toHaveBeenCalled();
  });
  it.each([{ data: null, error: { message: 'unavailable' } }, null])(
    'keeps readable cookie fallback on unavailable profile fetch',
    async (result) => {
      if (result === null)
        mocks.font.mockRejectedValue(new Error('private network detail'));
      else mocks.font.mockResolvedValue(result);
      expect(await getServerFontScale()).toBe('normal');
    },
  );
});

describe('onboarding overview resumes durable artist interest', () => {
  const ready = {
    ...data,
    fontSelected: true,
    callName: '별님',
    profileCompleted: true,
  };
  it.each([
    ['fictional-star', true],
    [null, false],
  ] as const)(
    'uses current active selected slug %s, not local memory or a paid entitlement',
    async (selectedSlug, artistSelected) => {
      mocks.read.mockResolvedValue({ ok: true, data: ready });
      mocks.interest.mockResolvedValue({
        ok: true,
        data: {
          selectedSlug,
          selectedName: selectedSlug ? '허구 가수' : null,
          selectedAt: selectedSlug ? '2026-10-24T00:00:00Z' : null,
        },
      });
      expect(await getOnboardingPage()).toEqual({
        ok: true,
        data: { ...ready, artistSelected },
      });
      expect(mocks.interest).toHaveBeenCalledOnce();
      expect(ready).not.toHaveProperty('artistSelected');
    },
  );
  it('reopens name validation after current readiness fails without erasing the saved name', async () => {
    mocks.read.mockResolvedValue({ ok: true, data: ready });
    mocks.interest.mockResolvedValue({ ok: false, code: 'PROFILE_REQUIRED' });
    const result = await getOnboardingPage();
    expect(result).toEqual({
      ok: true,
      data: {
        ...ready,
        profileCompleted: false,
        artistSelected: false,
        nameRevalidationRequired: true,
      },
    });
    expect(result.ok && resumeOnboarding(result.data)).toBe(
      routes.onboardingName,
    );
    expect(result.ok && result.data.callName).toBe(ready.callName);
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
  it.each([
    ['SETUP_NOT_READY', 'SETUP_NOT_READY'],
    ['UNAVAILABLE', 'UNAVAILABLE'],
    ['FORBIDDEN', 'UNAVAILABLE'],
  ] as const)(
    'fails closed on interest readiness %s',
    async (code, expected) => {
      mocks.read.mockResolvedValue({ ok: true, data: ready });
      mocks.interest.mockResolvedValue({ ok: false, code });
      expect(await getOnboardingPage()).toEqual({ ok: false, code: expected });
    },
  );
  it('keeps unavailable interest transport generic', async () => {
    mocks.read.mockResolvedValue({ ok: true, data: ready });
    mocks.interest.mockRejectedValue(new Error('private query detail'));
    expect(await getOnboardingPage()).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
    });
  });
  it('does not consult interest for incomplete profiles, nonfan roles, or unlocked Back screens', async () => {
    expect(await getOnboardingPage()).toEqual({ ok: true, data });
    mocks.read.mockResolvedValue({ ok: true, data: ready });
    expect(await getOnboardingPage('artists')).toEqual({
      ok: true,
      data: ready,
    });
    expect(await getOnboardingPage('name')).toEqual({ ok: true, data: ready });
    mocks.session.mockResolvedValue({
      status: 'authenticated',
      profile: { ...profile, role: 'artist' },
    });
    expect(await getOnboardingPage()).toEqual({ ok: true, data: ready });
    expect(mocks.interest).not.toHaveBeenCalled();
  });
});
