// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { routes } from '@/config/routes';
import {
  readInstallState,
  submitInstall,
  type InstallPort,
} from '@/server/services/onboarding/install';
const state = {
  choice: null,
  acknowledgedAt: null,
  installationSelfReportedAt: null,
  completedAt: null,
};
function port(): InstallPort {
  return {
    read: vi.fn().mockResolvedValue({ ok: true, data: state }),
    acknowledge: vi.fn().mockResolvedValue({ ok: true, data: null }),
    complete: vi
      .fn()
      .mockResolvedValue({ ok: true, data: '2026-10-24T00:00:00Z' }),
  };
}
describe('honest optional installation and authoritative completion', () => {
  it.each(['acknowledged', 'skipped', 'installed_self_reported'] as const)(
    'stores explicit %s without completing',
    async (choice) => {
      const db = port();
      expect(
        await submitInstall(db, { action: 'acknowledge', choice }),
      ).toEqual({ ok: true, next: routes.onboardingInstall });
      expect(db.acknowledge).toHaveBeenCalledExactlyOnceWith(choice);
      expect(db.complete).not.toHaveBeenCalled();
    },
  );
  it('repeats completion through the authoritative RPC without trusting browser state', async () => {
    const db = port();
    for (let i = 0; i < 2; i++)
      expect(await submitInstall(db, { action: 'complete' })).toEqual({
        ok: true,
        next: routes.home,
      });
    expect(db.complete).toHaveBeenCalledTimes(2);
    expect(db.acknowledge).not.toHaveBeenCalled();
  });
  it.each([
    {},
    null,
    [],
    { action: 'complete', installed: true },
    { action: 'complete', notificationPermission: 'granted' },
    { action: 'complete', userId: 'victim' },
    { action: 'complete', role: 'admin' },
    { action: 'complete', policyValid: true },
    { action: 'acknowledge', choice: 'installed' },
    { action: 'acknowledge' },
    { action: 'skip' },
  ])('rejects untrusted or ambiguous input %j', async (input) => {
    const db = port();
    expect(await submitInstall(db, input)).toEqual({
      ok: false,
      code: 'INVALID_INPUT',
    });
    expect(db.complete).not.toHaveBeenCalled();
    expect(db.acknowledge).not.toHaveBeenCalled();
  });
  it.each([
    'PROFILE_REQUIRED',
    'INTEREST_REQUIRED',
    'GUIDANCE_REQUIRED',
    'SETUP_NOT_READY',
    'FORBIDDEN',
    'UNAVAILABLE',
  ] as const)(
    'retains failclosed %s instead of forging completion',
    async (code) => {
      const db = port();
      vi.mocked(db.complete).mockResolvedValue({ ok: false, code });
      expect(await submitInstall(db, { action: 'complete' })).toEqual({
        ok: false,
        code,
      });
    },
  );
  it('sanitizes transport exceptions and reads only persisted evidence', async () => {
    const db = port();
    expect(await readInstallState(db)).toEqual({ ok: true, data: state });
    vi.mocked(db.read).mockRejectedValue(new Error('private SQL user-id'));
    vi.mocked(db.complete).mockRejectedValue(new Error('private SQL user-id'));
    expect(await readInstallState(db)).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
    });
    expect(await submitInstall(db, { action: 'complete' })).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
    });
  });
});
