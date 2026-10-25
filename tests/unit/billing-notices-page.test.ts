// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
import { getBillingNoticesPage } from '@/server/billing-notices/page';
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
const id = '00000000-0000-4000-8000-000000000001';
beforeEach(() => {
  vi.resetAllMocks();
  mocks.context.mockReturnValue({ client: {}, port: {} });
  mocks.session.mockResolvedValue({ status: 'authenticated', profile: { id } });
  mocks.redirect.mockImplementation(() => {
    throw new Error('redirect');
  });
});
it('returns no financial detail or provider setting in reusable page payload', async () => {
  expect(await getBillingNoticesPage()).toEqual({
    ok: true,
    data: { key: id, cursor: null },
  });
});
it('validates cursor after current account authentication', async () => {
  expect(await getBillingNoticesPage(['a', 'b'])).toEqual({
    ok: false,
    code: 'INVALID_INPUT',
  });
});
it('redirects anonymous viewer rather than exposing notice metadata', async () => {
  mocks.session.mockResolvedValue({ status: 'anonymous' });
  await expect(getBillingNoticesPage()).rejects.toThrow('redirect');
});
it.each(['unconfigured', 'unavailable'])(
  'keeps %s a controlled error',
  async (status) => {
    mocks.session.mockResolvedValue({ status });
    expect(await getBillingNoticesPage()).toEqual({
      ok: false,
      code: status === 'unconfigured' ? 'SETUP_NOT_READY' : 'UNAVAILABLE',
    });
  },
);
