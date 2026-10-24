// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { routes } from '@/config/routes';
import type { OnboardingData, OnboardingInput } from '@/config/onboarding';
import {
  onboardingStepRedirect,
  readOnboarding,
  resumeOnboarding,
  saveOnboarding,
  type OnboardingPort,
} from '@/server/services/onboarding/profile';

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
const consent: OnboardingInput = {
  step: 'consent',
  ageConfirmed: true,
  termsAccepted: true,
  privacyAccepted: true,
  termsVersion: '10000000-0000-4000-8000-000000000001',
  privacyVersion: '10000000-0000-4000-8000-000000000002',
  analyticsAccepted: false,
  analyticsVersion: null,
};
const port = (): OnboardingPort => ({
  read: vi.fn().mockResolvedValue({ ok: true, data }),
  save: vi.fn().mockResolvedValue({ ok: true, data: null }),
});

describe('profile stage resume and prerequisite gates', () => {
  it('resumes exactly from persisted state, never finishes full onboarding', () => {
    expect(resumeOnboarding(data)).toBe(routes.onboardingFont);
    expect(resumeOnboarding({ ...data, fontSelected: true })).toBe(
      routes.onboardingName,
    );
    expect(
      resumeOnboarding({ ...data, fontSelected: true, callName: '별님' }),
    ).toBe(routes.onboardingConsent);
    expect(resumeOnboarding({ ...data, profileCompleted: true })).toBe(
      routes.onboardingArtists,
    );
  });
  it('permits Back only to prior unlocked stages, not skipping mandatory steps', () => {
    expect(onboardingStepRedirect(data, 'font')).toBeNull();
    for (const step of ['name', 'consent', 'artists'] as const)
      expect(onboardingStepRedirect(data, step)).toBe(routes.onboardingFont);
    const named = { ...data, fontSelected: true, callName: '별님' };
    expect(onboardingStepRedirect(named, 'name')).toBeNull();
    expect(onboardingStepRedirect(named, 'consent')).toBeNull();
    expect(onboardingStepRedirect(named, 'artists')).toBe(
      routes.onboardingConsent,
    );
    expect(
      onboardingStepRedirect({ ...named, profileCompleted: true }, 'artists'),
    ).toBeNull();
  });
});

describe('artist stage resume respects prior profile gates', () => {
  it('resumes selected active interest at pending install, never home/full completion', () => {
    expect(
      resumeOnboarding({
        ...data,
        profileCompleted: true,
        artistSelected: true,
      }),
    ).toBe(routes.onboardingInstall);
    expect(
      resumeOnboarding({
        ...data,
        profileCompleted: true,
        artistSelected: false,
      }),
    ).toBe(routes.onboardingArtists);
  });
  it('does not let persisted interest skip a now-incomplete profile', () => {
    expect(resumeOnboarding({ ...data, artistSelected: true })).toBe(
      routes.onboardingFont,
    );
    expect(
      resumeOnboarding({
        ...data,
        fontSelected: true,
        callName: '별님',
        artistSelected: true,
      }),
    ).toBe(routes.onboardingConsent);
  });
  it('allows Back from pending install to choose again after mandatory profile readiness', () => {
    const selected = {
      ...data,
      fontSelected: true,
      callName: '별님',
      profileCompleted: true,
      artistSelected: true,
    };
    expect(onboardingStepRedirect(selected, 'artists')).toBeNull();
    expect(
      onboardingStepRedirect(
        { ...selected, profileCompleted: false },
        'artists',
      ),
    ).toBe(routes.onboardingConsent);
  });
});

describe('validated onboarding mutations', () => {
  it.each([
    null,
    {},
    { step: 'font', fontScale: 'huge' },
    { step: 'name', callName: '' },
    { step: 'name', callName: '별님', role: 'admin' },
    { ...consent, userId: 'victim' },
    { ...consent, termsVersion: 'unknown' },
    { ...consent, ageConfirmed: 'true' },
    { ...consent, analyticsVersion: 'unknown' },
  ])(
    'rejects malformed or privilege-bearing payload %j before I/O',
    async (input) => {
      const adapter = port();
      expect(await saveOnboarding(adapter, input)).toEqual({
        ok: false,
        code: 'INVALID_INPUT',
      });
      expect(adapter.save).not.toHaveBeenCalled();
    },
  );
  it.each([
    [{ ...consent, ageConfirmed: false }, 'AGE_REQUIRED'],
    [{ ...consent, termsAccepted: false }, 'CONSENT_REQUIRED'],
    [{ ...consent, privacyAccepted: false }, 'CONSENT_REQUIRED'],
    [{ ...consent, analyticsAccepted: true }, 'CONSENT_REQUIRED'],
  ])('requires separate explicit declarations %j', async (input, code) => {
    const adapter = port();
    expect(await saveOnboarding(adapter, input)).toEqual({ ok: false, code });
    expect(adapter.save).not.toHaveBeenCalled();
  });
  it.each([
    [{ step: 'font', fontScale: 'xlarge' }, routes.onboardingName],
    [{ step: 'name', callName: '별님' }, routes.onboardingConsent],
    [consent, routes.onboardingArtists],
  ])(
    'moves forward only after a committed transaction %j',
    async (input, next) => {
      const adapter = port();
      expect(await saveOnboarding(adapter, input)).toEqual({ ok: true, next });
      expect(adapter.save).toHaveBeenCalledWith(input);
    },
  );
  it('does not invent success when policy is absent or version changed', async () => {
    const adapter = port();
    for (const code of [
      'SETUP_NOT_READY',
      'POLICY_CHANGED',
      'NAME_FORBIDDEN',
    ] as const) {
      vi.mocked(adapter.save).mockResolvedValue({ ok: false, code });
      expect(await saveOnboarding(adapter, consent)).toEqual({
        ok: false,
        code,
      });
    }
  });
  it('allows independent default-off analytics and repeated identical saves', async () => {
    const adapter = port();
    await saveOnboarding(adapter, consent);
    await saveOnboarding(adapter, consent);
    expect(adapter.save).toHaveBeenCalledTimes(2);
    expect(adapter.save).toHaveBeenLastCalledWith(
      expect.objectContaining({ analyticsAccepted: false }),
    );
  });
  it('maps uncertain transport errors without exposing private details', async () => {
    const adapter = port();
    vi.mocked(adapter.save).mockRejectedValue(new Error('private name'));
    expect(await saveOnboarding(adapter, consent)).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
    });
    vi.mocked(adapter.read).mockRejectedValue(new Error('secret SQL'));
    expect(await readOnboarding(adapter)).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
    });
  });
  it('preserves explicit read state including setup readiness without defaults', async () => {
    expect(await readOnboarding(port())).toEqual({ ok: true, data });
  });
});
