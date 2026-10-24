// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createOnboardingPort, readProfileFont } from '@/server/db/onboarding';
import type { ActorClient } from '@/server/db/client';

function client(result: unknown) {
  const single = vi.fn().mockResolvedValue(result);
  const rpc = vi.fn().mockReturnValue({
    ...Promise.resolve(result),
    single,
    then: Promise.resolve(result).then.bind(Promise.resolve(result)),
  });
  return { actor: { rpc } as unknown as ActorClient, rpc };
}
const state = {
  font_scale: 'xlarge',
  font_selected_at: 'now',
  call_name: '별님',
  name_policy_ready: true,
  call_name_min: 2,
  call_name_max: 10,
  profile_completed_at: null,
  terms_version: 'terms',
  terms_title: 'T',
  terms_body: 'fixture',
  privacy_version: null,
  privacy_title: null,
  privacy_body: null,
  analytics_available: false,
  analytics_version: null,
  analytics_title: null,
  analytics_body: null,
};
describe('actor-scoped onboarding RPC adapter', () => {
  it('maps only safe DTO fields and withholds unavailable bodies', async () => {
    const { actor, rpc } = client({ data: state, error: null });
    const read = await createOnboardingPort(actor).read();
    expect(rpc).toHaveBeenCalledWith('onboarding_get_state');
    expect(read).toEqual({
      ok: true,
      data: {
        fontScale: 'xlarge',
        fontSelected: true,
        callName: '별님',
        nameReady: true,
        nameMin: 2,
        nameMax: 10,
        profileCompleted: false,
        terms: { version: 'terms', title: 'T', body: 'fixture' },
        privacy: null,
        analytics: null,
      },
    });
  });
  it('does not display blank policy text even if version was supplied', async () => {
    const { actor } = client({
      data: { ...state, terms_body: ' \n ' },
      error: null,
    });
    expect(await createOnboardingPort(actor).read()).toMatchObject({
      ok: true,
      data: { terms: null },
    });
  });
  it.each([
    ['ONBOARDING_SETUP_NOT_READY', 'SETUP_NOT_READY'],
    ['ONBOARDING_ACTOR_FORBIDDEN', 'FORBIDDEN'],
    ['ONBOARDING_ALREADY_COMPLETED', 'FORBIDDEN'],
    ['ONBOARDING_NAME_INVALID', 'NAME_INVALID'],
    ['ONBOARDING_POLICY_CHANGED', 'POLICY_CHANGED'],
    ['ONBOARDING_ANALYTICS_UNAVAILABLE', 'POLICY_CHANGED'],
    ['private SQL', 'UNAVAILABLE'],
    ['toString', 'UNAVAILABLE'],
    ['__proto__', 'UNAVAILABLE'],
  ])('maps only known database error %s', async (message, code) => {
    const { actor } = client({ error: { message } });
    expect(
      await createOnboardingPort(actor).save({
        step: 'name',
        callName: '별님',
      }),
    ).toEqual({ ok: false, code });
  });
  it('passes only parameter-bound fields, never actor id or authority', async () => {
    const { actor, rpc } = client({ error: null });
    const adapter = createOnboardingPort(actor);
    await adapter.save({ step: 'font', fontScale: 'normal' });
    expect(rpc).toHaveBeenLastCalledWith('onboarding_save_font', {
      p_font_scale: 'normal',
    });
    await adapter.save({
      step: 'consent',
      ageConfirmed: true,
      termsAccepted: true,
      privacyAccepted: true,
      termsVersion: 'terms',
      privacyVersion: 'privacy',
      analyticsAccepted: false,
      analyticsVersion: null,
    });
    expect(rpc).toHaveBeenLastCalledWith('onboarding_complete_profile', {
      p_age_over_14: true,
      p_terms_accepted: true,
      p_terms_version: 'terms',
      p_privacy_accepted: true,
      p_privacy_version: 'privacy',
      p_analytics_granted: false,
    });
  });
  it('queries only font of the verified subject for SSR', async () => {
    const maybeSingle = vi
      .fn()
      .mockResolvedValue({ data: { font_scale: 'normal' }, error: null });
    const eq = vi.fn().mockReturnValue({ maybeSingle });
    const select = vi.fn().mockReturnValue({ eq });
    const from = vi.fn().mockReturnValue({ select });
    await readProfileFont(
      { from } as unknown as ActorClient,
      'verified-subject',
    );
    expect(from).toHaveBeenCalledWith('profiles');
    expect(select).toHaveBeenCalledWith('font_scale');
    expect(eq).toHaveBeenCalledWith('id', 'verified-subject');
  });
});
