// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { routes } from '@/config/routes';
import { getInstallPage, getInstallStatus } from '@/server/install/page';
const mocks = vi.hoisted(() => ({
  cookies: vi.fn(),
  context: vi.fn(),
  interest: vi.fn(),
  read: vi.fn(),
  redirect: vi.fn(),
}));
vi.mock('next/headers', () => ({ cookies: mocks.cookies }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));
vi.mock('@/server/auth/context', () => ({ createAuthContext: mocks.context }));
vi.mock('@/server/artists/page', () => ({
  getArtistInstallPage: mocks.interest,
}));
vi.mock('@/server/db/install', () => ({
  createInstallPort: () => ({ read: mocks.read }),
}));
const data = {
  choice: 'skipped',
  acknowledgedAt: '2026-10-24T00:00:00Z',
  installationSelfReportedAt: null,
  completedAt: null,
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.cookies.mockResolvedValue({ getAll: () => [] });
  mocks.context.mockReturnValue({ client: { actor: true } });
  mocks.interest.mockResolvedValue({
    ok: true,
    data: { selectedName: '허구 가수' },
  });
  mocks.read.mockResolvedValue({ ok: true, data });
  mocks.redirect.mockImplementation((path) => {
    throw new Error(`redirect:${path}`);
  });
});
describe('install page current prerequisites and durable resume', () => {
  it('combines only safe guidance state and artist name after guarded prerequisites', async () => {
    expect(await getInstallPage()).toEqual({
      ok: true,
      data: { ...data, selectedName: '허구 가수' },
    });
    expect(mocks.interest).toHaveBeenCalledOnce();
    expect(mocks.read).toHaveBeenCalledOnce();
  });
  it('recovers changed name policy via the authoritative onboarding overview', async () => {
    mocks.interest.mockResolvedValue({ ok: false, code: 'PROFILE_REQUIRED' });
    await expect(getInstallPage()).rejects.toThrow(
      `redirect:${routes.onboarding}`,
    );
    expect(mocks.read).not.toHaveBeenCalled();
  });
  it.each(['SETUP_NOT_READY', 'UNAVAILABLE', 'FORBIDDEN'] as const)(
    'propagates prerequisite %s without reading guidance',
    async (code) => {
      mocks.interest.mockResolvedValue({ ok: false, code });
      expect(await getInstallPage()).toEqual({ ok: false, code });
      expect(mocks.read).not.toHaveBeenCalled();
    },
  );
  it('does not reopen an already-finished screen after racing completion', async () => {
    mocks.read.mockResolvedValue({
      ok: true,
      data: { ...data, completedAt: '2026-10-24T00:00:00Z' },
    });
    await expect(getInstallPage()).rejects.toThrow(`redirect:${routes.home}`);
  });
  it('fails closed on missing actor client and failed read', async () => {
    mocks.context.mockReturnValue({ client: null });
    expect(await getInstallPage()).toEqual({
      ok: false,
      code: 'SETUP_NOT_READY',
    });
    mocks.context.mockReturnValue({ client: { actor: true } });
    mocks.read.mockResolvedValue({ ok: false, code: 'UNAVAILABLE' });
    expect(await getInstallPage()).toEqual({ ok: false, code: 'UNAVAILABLE' });
  });
  it('home status cannot fabricate legacy guidance when no state is readable', async () => {
    mocks.read.mockResolvedValue({ ok: false, code: 'PROFILE_REQUIRED' });
    expect(await getInstallStatus()).toEqual({
      ok: false,
      code: 'PROFILE_REQUIRED',
    });
    expect(mocks.interest).not.toHaveBeenCalled();
  });
});
