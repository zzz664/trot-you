import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cancelCheckout,
  prepareCheckout,
  checkoutExpiryDelay,
} from '@/client/checkout';
import {
  CHECKOUT_ERROR_STATUS,
  CHECKOUT_INTENT_TTL_MS,
  CHECKOUT_PROVIDERS,
  type CheckoutCancelInput,
  type CheckoutInput,
  type CheckoutIntent,
} from '@/config/checkout';
import { routes } from '@/config/routes';

const fetchMock = vi.fn();
const input: CheckoutInput = {
  artistSlug: 'fictional-star',
  provider: 'toss_card_billing',
  accepted: true,
  policyVersion: 'ae3f06df-e2b1-4c57-838b-c472bc460ab7',
  idempotencyKey: 'b926e114-2d5b-44e7-ad76-7d888967913f',
};
const intent: CheckoutIntent = {
  id: 'ec3f74d6-0745-4a1f-ad46-42eac6fb9713',
  status: 'pending_intent',
  provider: input.provider,
  expiresAt: '2026-10-24T13:30:00+00:00',
  initialPriceKrw: 1000,
  regularPriceKrw: 6500,
  introEligible: true,
};
beforeEach(() => vi.stubGlobal('fetch', fetchMock));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

describe('checkout intent transport, never a provider/charge transport', () => {
  it.each(CHECKOUT_PROVIDERS)(
    'posts only explicit %s preparation input and expects a pending intent',
    async (provider) => {
      const body = { ...intent, provider };
      fetchMock.mockResolvedValue(Response.json({ ok: true, data: body }));
      expect(await prepareCheckout({ ...input, provider })).toEqual({
        ok: true,
        data: body,
      });
      expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
        routes.checkoutSubmit,
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          cache: 'no-store',
          redirect: 'error',
          signal: expect.any(AbortSignal),
          body: expect.any(String),
        }),
      );
      expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toEqual({
        ...input,
        provider,
      });
    },
  );
  it('cancels only the requested intent with same-origin cookies and no nonce in JSON', async () => {
    fetchMock.mockResolvedValue(
      Response.json({ ok: true, data: { ...intent, status: 'canceled' } }),
    );
    expect(await cancelCheckout({ sessionId: intent.id })).toEqual({
      ok: true,
      data: { ...intent, status: 'canceled' },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      routes.checkoutCancel,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ sessionId: intent.id }),
        credentials: 'same-origin',
      }),
    );
  });
  it.each([
    { ...input, userId: 'someone-else' },
    { ...input, amount: 1 },
    { ...input, returnUrl: 'https://untrusted.test' },
    { ...input, accepted: false },
    { ...input, provider: 'mock' },
    { ...input, artistSlug: '../admin' },
    { ...input, policyVersion: 'draft' },
    { ...input, idempotencyKey: 'predictable' },
    { ...input, authKey: 'private' },
    {},
  ])('rejects invalid or extra preparation fields %j', async (candidate) => {
    expect(await prepareCheckout(candidate as CheckoutInput)).toEqual({
      ok: false,
      code: 'INVALID_INPUT',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each([
    { sessionId: 'invalid' },
    { sessionId: intent.id, nonce: 'private' },
    { sessionId: intent.id, userId: 'somebody' },
  ])('rejects invalid or extra cancellation fields %j', async (candidate) => {
    expect(await cancelCheckout(candidate as CheckoutCancelInput)).toEqual({
      ok: false,
      code: 'INVALID_INPUT',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each(Object.keys(CHECKOUT_ERROR_STATUS))(
    'returns controlled error %s',
    async (code) => {
      fetchMock.mockResolvedValue(
        Response.json({ ok: false, code }, { status: 409 }),
      );
      expect(await prepareCheckout(input)).toEqual({ ok: false, code });
    },
  );
  it.each([
    null,
    [],
    'success',
    { ok: true },
    { ok: true, data: intent, redirectUrl: 'https://untrusted.test' },
    { ok: true, data: { ...intent, secret: 'private' } },
    { ok: true, data: { ...intent, status: 'active' } },
    { ok: true, data: { ...intent, status: 'canceled' } },
    { ok: true, data: { ...intent, provider: 'kakaopay_subscription' } },
    { ok: true, data: { ...intent, expiresAt: 'not-a-date' } },
    { ok: true, data: { ...intent, id: 'non-opaque-id' } },
    { ok: false, code: 'RAW_PROVIDER_ERROR' },
    { ok: false, code: 'FORBIDDEN', privateDetail: 'private' },
  ])(
    'fails closed on invalid or credential-bearing response %j',
    async (body) => {
      fetchMock.mockResolvedValue(Response.json(body));
      expect(await prepareCheckout(input)).toEqual({
        ok: false,
        code: 'UNAVAILABLE',
      });
    },
  );
  it('does not accept a different session cancellation', async () => {
    fetchMock.mockResolvedValue(
      Response.json({ ok: true, data: { ...intent, status: 'canceled' } }),
    );
    expect(
      await cancelCheckout({
        sessionId: '72b22340-3ec9-4bfb-a273-b8725f45efa5',
      }),
    ).toEqual({ ok: false, code: 'UNAVAILABLE' });
  });
  it('rejects apparent success on failed HTTP status', async () => {
    fetchMock.mockResolvedValue(
      Response.json({ ok: true, data: intent }, { status: 503 }),
    );
    expect(await prepareCheckout(input)).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
    });
  });
  it.each(['network', 'json'] as const)(
    'does not automatically replay after an uncertain %s outcome',
    async (kind) => {
      if (kind === 'network')
        fetchMock.mockRejectedValue(new Error('private-provider-detail'));
      else fetchMock.mockResolvedValue(new Response('<html>private</html>'));
      expect(await prepareCheckout(input)).toEqual({
        ok: false,
        code: 'UNAVAILABLE',
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );
});

describe('local expiry display scheduling', () => {
  it('is bounded, handles elapsed/invalid timestamps and does not perform I/O', () => {
    const now = Date.parse('2026-10-24T13:00:00Z');
    expect(checkoutExpiryDelay('2026-10-24T13:15:00Z', now)).toBe(
      CHECKOUT_INTENT_TTL_MS,
    );
    expect(checkoutExpiryDelay('2026-10-24T14:00:00Z', now)).toBe(
      CHECKOUT_INTENT_TTL_MS,
    );
    expect(checkoutExpiryDelay('2026-10-24T13:00:00Z', now)).toBe(0);
    expect(checkoutExpiryDelay('2026-10-24T12:59:00Z', now)).toBe(0);
    expect(checkoutExpiryDelay('invalid', now)).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
