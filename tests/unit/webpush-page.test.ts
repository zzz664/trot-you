// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getWebPushPage } from '@/server/webpush/page';
import { routes } from '@/config/routes';
const mocks = vi.hoisted(() => ({
  cookies: vi.fn(),
  redirect: vi.fn(),
  context: vi.fn(),
  session: vi.fn(),
  actor: vi.fn(),
  dependencies: vi.fn(),
  read: vi.fn(),
}));
vi.mock('next/headers', () => ({ cookies: mocks.cookies }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));
vi.mock('@/server/auth/context', () => ({ createAuthContext: mocks.context }));
vi.mock('@/server/services/auth/session', () => ({
  readSession: mocks.session,
}));
vi.mock('@/server/webpush/security', () => ({
  verifiedWebPushActor: mocks.actor,
}));
vi.mock('@/server/webpush/dependencies', () => ({
  createWebPushSubscriptionDependencies: mocks.dependencies,
}));
vi.mock('@/server/services/notification/subscription', () => ({
  readWebPushStatus: mocks.read,
}));
const actor = {
  actorId: 'a4000000-0000-4000-8000-000000000001',
  sessionId: 'a4000000-0000-4000-8000-000000000002',
};
const profile = {
  id: actor.actorId,
  role: 'fan',
  onboarding_completed_at: '2026-10-24T00:00:00Z',
  is_restricted: false,
  restricted_until: null,
};
const initial = {
  configured: false,
  publicKey: null,
  consentVersion: null,
  webpushEnabled: false,
  newMessage: false,
  deviceId: null,
  deviceActive: false,
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.cookies.mockResolvedValue({
    getAll: () => [{ name: 'fixture', value: 'private-cookie' }],
  });
  mocks.context.mockReturnValue({
    client: { actor: true },
    port: { verified: true },
  });
  mocks.session.mockResolvedValue({ status: 'authenticated', profile });
  mocks.actor.mockResolvedValue(actor);
  mocks.dependencies.mockReturnValue({ fixture: true });
  mocks.read.mockResolvedValue({ ok: true, data: initial });
  mocks.redirect.mockImplementation((path: string) => {
    throw new Error(`redirect:${path}`);
  });
});
describe('webpush settings server page', () => {
  it('independently verifies actor and keys UI lifecycle to the current session', async () => {
    expect(await getWebPushPage()).toEqual({
      ok: true,
      data: { initial, key: actor.sessionId },
    });
    expect(mocks.context).toHaveBeenCalledWith([
      { name: 'fixture', value: 'private-cookie' },
    ]);
    expect(mocks.actor).toHaveBeenCalledWith({ actor: true }, actor.actorId);
    expect(mocks.read).toHaveBeenCalledWith({ fixture: true }, actor, {
      action: 'status',
      endpoint: null,
    });
  });
  it.each([
    ['artist', routes.artist],
    ['admin', routes.admin],
  ])('redirects %s to role landing before dependencies', async (role, path) => {
    mocks.session.mockResolvedValue({
      status: 'authenticated',
      profile: { ...profile, role },
    });
    await expect(getWebPushPage()).rejects.toThrow(`redirect:${path}`);
    expect(mocks.dependencies).not.toHaveBeenCalled();
  });
  it.each([
    [{ is_restricted: true }, routes.restricted],
    [{ onboarding_completed_at: null }, routes.onboarding],
  ])('enforces current profile %#', async (change, path) => {
    mocks.session.mockResolvedValue({
      status: 'authenticated',
      profile: { ...profile, ...change },
    });
    await expect(getWebPushPage()).rejects.toThrow(`redirect:${path}`);
    expect(mocks.actor).not.toHaveBeenCalled();
  });
  it('redirects anonymous actor without data access', async () => {
    mocks.session.mockResolvedValue({ status: 'anonymous' });
    await expect(getWebPushPage()).rejects.toThrow(`redirect:${routes.start}`);
    expect(mocks.dependencies).not.toHaveBeenCalled();
  });
  it.each([
    ['unconfigured', 'SETUP_NOT_READY'],
    ['unavailable', 'UNAVAILABLE'],
  ])('reports %s honestly', async (status, code) => {
    mocks.session.mockResolvedValue({ status });
    expect(await getWebPushPage()).toEqual({ ok: false, code });
    expect(mocks.dependencies).not.toHaveBeenCalled();
  });
  it('requires a current actor client and verified session id', async () => {
    mocks.context.mockReturnValue({ client: null });
    expect(await getWebPushPage()).toEqual({ ok: false, code: 'UNAVAILABLE' });
    mocks.context.mockReturnValue({ client: { actor: true } });
    mocks.actor.mockResolvedValue(null);
    expect(await getWebPushPage()).toEqual({
      ok: false,
      code: 'UNAUTHENTICATED',
    });
  });
  it('does not fabricate data if dependencies or status fail', async () => {
    mocks.dependencies.mockReturnValue(null);
    expect(await getWebPushPage()).toEqual({
      ok: false,
      code: 'SETUP_NOT_READY',
    });
    mocks.dependencies.mockReturnValue({ fixture: true });
    mocks.read.mockResolvedValue({ ok: false, code: 'UNAVAILABLE' });
    expect(await getWebPushPage()).toEqual({ ok: false, code: 'UNAVAILABLE' });
  });
});
