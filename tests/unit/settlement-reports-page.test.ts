// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
import { getSettlementReportsPage } from '@/server/settlement-reports/page';
import { routes } from '@/config/routes';
import { reportActor } from './settlement-reports-ui-fixtures';
const mocks = vi.hoisted(() => ({
  cookies: vi.fn(),
  context: vi.fn(),
  session: vi.fn(),
  redirect: vi.fn(),
}));
vi.mock('next/headers', () => ({ cookies: mocks.cookies }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));
vi.mock('@/server/auth/context', () => ({ createAuthContext: mocks.context }));
vi.mock('@/server/services/auth/session', () => ({
  readSession: mocks.session,
}));
function state(extra = {}) {
  return {
    status: 'authenticated',
    profile: {
      id: reportActor,
      role: 'admin',
      is_restricted: false,
      restricted_until: null,
      onboarding_completed_at: null,
      ...extra,
    },
  };
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.cookies.mockResolvedValue({ getAll: () => [] });
  mocks.context.mockReturnValue({ client: {}, port: {} });
  mocks.session.mockResolvedValue(state());
  mocks.redirect.mockImplementation((path) => {
    throw new Error(`redirect:${path}`);
  });
});
it('transports identity only, not private reports or policy', async () =>
  expect(await getSettlementReportsPage('admin')).toEqual({
    ok: true,
    data: { key: reportActor },
  }));
it('anonymous redirects to login', async () => {
  mocks.session.mockResolvedValue({ status: 'anonymous' });
  await expect(getSettlementReportsPage('admin')).rejects.toThrow(
    `redirect:${routes.start}`,
  );
});
it.each([
  ['unconfigured', 'SETUP_NOT_READY'],
  ['unavailable', 'UNAVAILABLE'],
])('fails closed for %s', async (status, code) => {
  mocks.session.mockResolvedValue({ status });
  expect(await getSettlementReportsPage('admin')).toEqual({ ok: false, code });
});
it('missing client gives no useful identity', async () => {
  mocks.context.mockReturnValue({ client: null, port: {} });
  expect(await getSettlementReportsPage('admin')).toEqual({
    ok: false,
    code: 'UNAVAILABLE',
  });
});
it.each([
  { role: 'fan' },
  { role: 'artist' },
  { is_restricted: true, restricted_until: null },
  { is_restricted: true, restricted_until: '2099-01-01T00:00:00Z' },
  { is_restricted: true, restricted_until: 'bad' },
])('current restriction/role blocks %#', async (extra) => {
  mocks.session.mockResolvedValue(state(extra));
  expect(await getSettlementReportsPage('admin')).toEqual({
    ok: false,
    code: 'FORBIDDEN',
  });
});
it('expired restriction stays read-only and permits current admin', async () => {
  mocks.session.mockResolvedValue(
    state({ is_restricted: true, restricted_until: '2000-01-01T00:00:00Z' }),
  );
  expect(await getSettlementReportsPage('admin')).toEqual({
    ok: true,
    data: { key: reportActor },
  });
});
