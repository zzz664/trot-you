// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { success, failure } from '@/lib/result';
import { routes } from '@/config/routes';
import { getCheckoutPage } from '@/server/checkout/page';
const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  read: vi.fn(),
  providers: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`redirect:${url}`);
  }),
}));
vi.mock('next/headers', () => ({
  cookies: async () => ({ getAll: () => [] }),
}));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));
vi.mock('@/server/auth/context', () => ({ createAuthContext: mocks.context }));
vi.mock('@/server/db/checkout', () => ({
  createCheckoutOfferPort: () => ({ read: mocks.read }),
}));
vi.mock('@/server/checkout/configuration', () => ({
  checkoutProviderConfiguration: mocks.providers,
}));
const profile = {
  id: 'c1100000-0000-4000-8000-000000000001',
  role: 'fan',
  onboarding_completed_at: '2026-10-24T12:00:00Z',
  is_restricted: false,
  restricted_until: null,
};
const offer = {
  artist: { slug: 'fictional-star', name: '허구가수' },
  policy: {
    version: 'c1100000-0000-4000-8000-000000000003',
    title: '허구약관',
    body: '허구본문',
    regularPriceKrw: 6500,
    introPriceKrw: 1000,
  },
  introEligible: true,
};
function context() {
  return {
    client: {},
    port: {
      verifySubject: vi.fn().mockResolvedValue(success(profile.id)),
      readProfile: vi.fn().mockResolvedValue(success(profile)),
    },
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.context.mockReturnValue(context());
  mocks.read.mockResolvedValue({ ok: true, data: offer });
  mocks.providers.mockReturnValue([
    { provider: 'toss_card_billing', configured: false },
    { provider: 'kakaopay_subscription', configured: false },
  ]);
});
describe('checkout terms page authority', () => {
  it('shows only actor-authorized approved offer and always marks launch unavailable', async () => {
    expect(await getCheckoutPage(offer.artist.slug)).toEqual({
      ok: true,
      data: { offer, providers: mocks.providers(), launchAvailable: false },
    });
    expect(mocks.read).toHaveBeenCalledExactlyOnceWith(offer.artist.slug);
  });
  it('redirects anonymous without reading prices or policies', async () => {
    const ctx = context();
    ctx.port.verifySubject.mockResolvedValue(success(null));
    mocks.context.mockReturnValue(ctx);
    await expect(getCheckoutPage(offer.artist.slug)).rejects.toThrow(
      `redirect:${routes.start}`,
    );
    expect(mocks.read).not.toHaveBeenCalled();
  });
  it.each([
    [{ is_restricted: true }, routes.restricted],
    [{ role: 'admin' }, routes.admin],
    [{ role: 'artist' }, routes.artist],
    [{ onboarding_completed_at: null }, routes.onboarding],
  ] as const)(
    'does not disclose offer to ineligible actor %j',
    async (patch, path) => {
      const ctx = context();
      ctx.port.readProfile.mockResolvedValue(success({ ...profile, ...patch }));
      mocks.context.mockReturnValue(ctx);
      await expect(getCheckoutPage(offer.artist.slug)).rejects.toThrow(
        `redirect:${path}`,
      );
      expect(mocks.read).not.toHaveBeenCalled();
    },
  );
  it('fails closed with missing or unavailable verified authentication', async () => {
    mocks.context.mockReturnValue({ client: null, port: null });
    expect(await getCheckoutPage(offer.artist.slug)).toEqual({
      ok: false,
      code: 'SETUP_NOT_READY',
    });
    const ctx = context();
    ctx.port.verifySubject.mockResolvedValue(failure('INTERNAL'));
    mocks.context.mockReturnValue(ctx);
    expect(await getCheckoutPage(offer.artist.slug)).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
    });
    expect(mocks.read).not.toHaveBeenCalled();
  });
  it.each([
    'SETUP_NOT_READY',
    'POLICY_CHANGED',
    'FORBIDDEN',
    'UNAVAILABLE',
    'NOT_FOUND',
  ] as const)('does not invent terms/prices after %s', async (code) => {
    mocks.read.mockResolvedValue({ ok: false, code });
    expect(await getCheckoutPage(offer.artist.slug)).toEqual({
      ok: false,
      code,
    });
    expect(mocks.providers).not.toHaveBeenCalled();
  });
  it('rejects malformed route before actor RPC', async () => {
    expect(await getCheckoutPage('../arbitrary')).toEqual({
      ok: false,
      code: 'NOT_FOUND',
    });
    expect(mocks.read).not.toHaveBeenCalled();
  });
});
