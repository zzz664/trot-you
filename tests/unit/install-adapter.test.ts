// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createInstallPort } from '@/server/db/install';
import type { ActorClient } from '@/server/db/client';
function client(result: unknown) {
  const single = vi.fn().mockResolvedValue(result);
  const rpc = vi.fn().mockReturnValue({
    single,
    then: Promise.resolve(result).then.bind(Promise.resolve(result)),
  });
  return { actor: { rpc } as unknown as ActorClient, rpc };
}
const now = '2026-10-24T00:00:00+00:00';
const state = {
  choice: 'skipped',
  acknowledged_at: now,
  installation_self_reported_at: null,
  onboarding_completed_at: null,
};
describe('actor-scoped real onboarding completion adapter', () => {
  it('only reads a safe explicit DTO, never reports skip as installation', async () => {
    const { actor, rpc } = client({
      data: {
        ...state,
        user_id: 'private',
        notification_permission: 'granted',
      },
      error: null,
    });
    expect(await createInstallPort(actor).read()).toEqual({
      ok: true,
      data: {
        choice: 'skipped',
        acknowledgedAt: now,
        installationSelfReportedAt: null,
        completedAt: null,
      },
    });
    expect(rpc).toHaveBeenCalledExactlyOnceWith('onboarding_get_install_state');
  });
  it.each([
    null,
    {},
    { ...state, choice: 'installed' },
    { ...state, acknowledged_at: 'invalid' },
  ])('rejects malformed persisted state %j', async (data) => {
    expect(
      await createInstallPort(client({ data, error: null }).actor).read(),
    ).toEqual({ ok: false, code: 'UNAVAILABLE' });
  });
  it('passes choice only and no actor/browser-derived permission authority', async () => {
    const { actor, rpc } = client({ data: now, error: null });
    const port = createInstallPort(actor);
    await port.acknowledge('installed_self_reported');
    expect(rpc).toHaveBeenLastCalledWith('onboarding_acknowledge_install', {
      p_choice: 'installed_self_reported',
    });
    expect(await port.complete()).toEqual({ ok: true, data: now });
    expect(rpc).toHaveBeenLastCalledWith('onboarding_complete');
  });
  it.each([null, undefined, 'invalid', {}])(
    'never claims completion without actual timestamp %j',
    async (data) => {
      expect(
        await createInstallPort(client({ data, error: null }).actor).complete(),
      ).toEqual({ ok: false, code: 'UNAVAILABLE' });
    },
  );
  it.each([
    ['ONBOARDING_INSTALL_INVALID', 'INVALID_INPUT'],
    ['ONBOARDING_INSTALL_REQUIRED', 'GUIDANCE_REQUIRED'],
    ['ONBOARDING_ARTIST_REQUIRED', 'INTEREST_REQUIRED'],
    ['ONBOARDING_ALREADY_COMPLETED', 'FORBIDDEN'],
    ['DISCOVERY_FORBIDDEN', 'FORBIDDEN'],
    ['DISCOVERY_PROFILE_REQUIRED', 'PROFILE_REQUIRED'],
    ['DISCOVERY_SETUP_NOT_READY', 'SETUP_NOT_READY'],
    ['private SQL actor-id', 'UNAVAILABLE'],
    ['toString', 'UNAVAILABLE'],
    ['__proto__', 'UNAVAILABLE'],
  ])('maps only fixed SQL error %s', async (message, code) => {
    const port = createInstallPort(client({ error: { message } }).actor);
    expect(await port.read()).toEqual({ ok: false, code });
    expect(await port.acknowledge('acknowledged')).toEqual({ ok: false, code });
    expect(await port.complete()).toEqual({ ok: false, code });
  });
});
