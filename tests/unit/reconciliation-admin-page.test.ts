// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { routes } from '@/config/routes';
import { getAdminReconciliationPage } from '@/server/reconciliation/page';
import {
  reconciliationAdminIds as ids,
  reconciliationAdminList,
} from './reconciliation-admin-fixtures';
const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  db: vi.fn(),
  cookies: vi.fn(),
  list: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`);
  }),
}));
vi.mock('next/headers', () => ({ cookies: mocks.cookies }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));
vi.mock('@/server/auth/context', () => ({ createAuthContext: mocks.context }));
vi.mock('@/server/db/reconciliation-admin', () => ({
  createReconciliationAdminDbPort: mocks.db,
}));
const profile = {
  id: ids.admin,
  role: 'admin',
  onboarding_completed_at: '2026-10-24T12:00:00Z',
  is_restricted: false,
  restricted_until: null,
};
function context(patch: Record<string, unknown> = {}) {
  return {
    client: { actorClient: true },
    port: {
      verifySubject: vi.fn().mockResolvedValue({ ok: true, data: profile.id }),
      readProfile: vi
        .fn()
        .mockResolvedValue({ ok: true, data: { ...profile, ...patch } }),
    },
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.context.mockReturnValue(context());
  mocks.db.mockReturnValue({ list: mocks.list });
  mocks.cookies.mockResolvedValue({
    getAll: () => [{ name: 'fictional-session', value: 'not-a-real-token' }],
  });
  mocks.list.mockResolvedValue({ ok: true, data: reconciliationAdminList });
});
describe('current authority for reconciliation admin server page', () => {
  it('verifies current actor session and only passes a safe read-only port', async () => {
    expect(await getAdminReconciliationPage()).toEqual({
      ok: true,
      data: reconciliationAdminList,
    });
    expect(mocks.context).toHaveBeenCalledWith([
      { name: 'fictional-session', value: 'not-a-real-token' },
    ]);
    expect(mocks.db).toHaveBeenCalledWith({ actorClient: true });
    expect(mocks.list).toHaveBeenCalledExactlyOnceWith(1);
  });
  it('redirects anonymous before database access', async () => {
    const ctx = context();
    ctx.port.verifySubject.mockResolvedValue({ ok: true, data: null });
    mocks.context.mockReturnValue(ctx);
    await expect(getAdminReconciliationPage()).rejects.toThrow(
      `redirect:${routes.start}`,
    );
    expect(mocks.db).not.toHaveBeenCalled();
  });
  it.each([
    [{ role: 'fan' }, routes.home],
    [{ role: 'artist' }, routes.artist],
    [{ role: 'admin', is_restricted: true }, routes.restricted],
    [
      { role: 'admin', is_restricted: true, restricted_until: 'not-a-date' },
      routes.restricted,
    ],
    [{ role: 'fan', onboarding_completed_at: null }, routes.onboarding],
  ] as const)(
    'rejects current unauthorized profile %j',
    async (patch, target) => {
      mocks.context.mockReturnValue(context(patch));
      await expect(getAdminReconciliationPage()).rejects.toThrow(
        `redirect:${target}`,
      );
      expect(mocks.list).not.toHaveBeenCalled();
      expect(mocks.db).not.toHaveBeenCalled();
    },
  );
  it('checks role again after refresh instead of trusting previous authorization', async () => {
    mocks.context
      .mockReturnValueOnce(context())
      .mockReturnValueOnce(context({ role: 'fan' }));
    expect((await getAdminReconciliationPage()).ok).toBe(true);
    await expect(getAdminReconciliationPage()).rejects.toThrow(
      `redirect:${routes.home}`,
    );
    expect(mocks.list).toHaveBeenCalledOnce();
    expect(mocks.cookies).toHaveBeenCalledTimes(2);
  });
  it('requires database authority even with a correct application role', async () => {
    mocks.list.mockResolvedValue({ ok: false, code: 'FORBIDDEN' });
    expect(await getAdminReconciliationPage()).toEqual({
      ok: false,
      code: 'FORBIDDEN',
    });
  });
  it('reports unavailable/unconfigured authentication without disclosure', async () => {
    mocks.context.mockReturnValue({ port: null, client: null });
    expect(await getAdminReconciliationPage()).toEqual({
      ok: false,
      code: 'SETUP_NOT_READY',
    });
    const ctx = context();
    ctx.port.verifySubject.mockResolvedValue({
      ok: false,
      error: { code: 'INTERNAL' },
    });
    mocks.context.mockReturnValue(ctx);
    expect(await getAdminReconciliationPage()).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
    });
    mocks.context.mockReturnValue({ ...context(), client: null });
    expect(await getAdminReconciliationPage()).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
    });
    expect(mocks.db).not.toHaveBeenCalled();
  });
  it('rejects malformed navigation pages without invoking list RPC', async () => {
    expect(await getAdminReconciliationPage(['1', '2'])).toEqual({
      ok: false,
      code: 'INVALID_INPUT',
    });
    expect(mocks.list).not.toHaveBeenCalled();
  });
});
