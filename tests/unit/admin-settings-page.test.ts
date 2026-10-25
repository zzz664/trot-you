// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
import { getAdminSettingsPage } from '@/server/admin-settings/page';
import { routes } from '@/config/routes';
import { settingsActor } from './admin-settings-fixtures';
const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  session: vi.fn(),
  redirect: vi.fn(),
}));
vi.mock('next/headers', () => ({
  cookies: async () => ({ getAll: () => [] }),
}));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));
vi.mock('@/server/auth/context', () => ({ createAuthContext: mocks.context }));
vi.mock('@/server/services/auth/session', () => ({
  readSession: mocks.session,
}));
beforeEach(() => {
  vi.resetAllMocks();
  mocks.context.mockReturnValue({ client: {}, port: {} });
  mocks.session.mockResolvedValue({
    status: 'authenticated',
    profile: { id: settingsActor, role: 'admin' },
  });
  mocks.redirect.mockImplementation(() => {
    throw new Error('redirect');
  });
});
it('returns only actor identity, never a stale reusable settings snapshot', async () => {
  expect(await getAdminSettingsPage()).toEqual({
    ok: true,
    data: { key: settingsActor },
  });
});
it('redirects signed-out actor', async () => {
  mocks.session.mockResolvedValue({ status: 'anonymous' });
  await expect(getAdminSettingsPage()).rejects.toThrow('redirect');
  expect(mocks.redirect).toHaveBeenCalledWith(routes.start);
});
it.each(['fan', 'artist'])('rejects %s', async (role) => {
  mocks.session.mockResolvedValue({
    status: 'authenticated',
    profile: { role },
  });
  expect(await getAdminSettingsPage()).toEqual({
    ok: false,
    code: 'FORBIDDEN',
  });
});
it('rejects restricted admin', async () => {
  mocks.session.mockResolvedValue({
    status: 'authenticated',
    profile: { role: 'admin', is_restricted: true, restricted_until: null },
  });
  expect(await getAdminSettingsPage()).toEqual({
    ok: false,
    code: 'FORBIDDEN',
  });
});
it.each(['unavailable', 'unconfigured'])('reports %s', async (status) => {
  mocks.session.mockResolvedValue({ status });
  expect(await getAdminSettingsPage()).toEqual({
    ok: false,
    code: status === 'unconfigured' ? 'SETUP_NOT_READY' : 'UNAVAILABLE',
  });
});
