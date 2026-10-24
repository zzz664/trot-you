// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  prepareCheckout,
  cancelCheckout,
  readCheckoutOffer,
} from '@/server/services/checkout/sessions';

const actorId = 'c1100000-0000-4000-8000-000000000001';
const sessionId = 'c1100000-0000-4000-8000-000000000002';
const input = {
  artistSlug: 'fictional-star',
  provider: 'toss_card_billing' as const,
  policyVersion: 'c1100000-0000-4000-8000-000000000003',
  idempotencyKey: 'c1100000-0000-4000-8000-000000000004',
  accepted: true as const,
};
const nonceHash = 'a'.repeat(64);
const pending = {
  id: sessionId,
  status: 'pending_intent',
  provider: input.provider,
  expiresAt: '2026-10-24T12:15:00+00:00',
  nonceMatches: true,
  initialPriceKrw: 1000,
  regularPriceKrw: 6500,
  introEligible: true,
  customerRef: 'private-customer',
  orderId: 'private-order',
  nonceHash: 'private-hash',
  credential: 'must-never-project',
};
const port = { prepare: vi.fn(), read: vi.fn(), cancel: vi.fn() };
beforeEach(() => {
  vi.clearAllMocks();
  port.prepare.mockResolvedValue({ ok: true, data: pending });
  port.cancel.mockResolvedValue({ ok: true, data: null });
  port.read.mockResolvedValue({
    ok: true,
    data: { ...pending, status: 'canceled' },
  });
});
describe('checkout preparation service', () => {
  it('projects only opaque pending intent; never exposes private identities or promises payment', async () => {
    const result = await prepareCheckout(
      port,
      actorId,
      input,
      'test',
      nonceHash,
    );
    expect(result).toEqual({
      ok: true,
      data: {
        id: sessionId,
        status: 'pending_intent',
        provider: input.provider,
        expiresAt: pending.expiresAt,
        initialPriceKrw: 1000,
        regularPriceKrw: 6500,
        introEligible: true,
      },
    });
    expect(port.prepare).toHaveBeenCalledExactlyOnceWith(
      actorId,
      input,
      'test',
      nonceHash,
    );
  });
  it.each([
    null,
    {},
    { ...input, amount: 1 },
    { ...input, actorId },
    { ...input, accepted: false },
    { ...input, policyVersion: 'wrong' },
    { ...input, provider: 'mock' },
    { ...input, artistSlug: '../unsafe' },
  ])(
    'rejects client authority, malformed data and absent consent %j',
    async (value) => {
      expect(
        await prepareCheckout(port, actorId, value, 'test', nonceHash),
      ).toEqual({ ok: false, code: 'INVALID_INPUT' });
      expect(port.prepare).not.toHaveBeenCalled();
    },
  );
  it('fails closed when provider configuration missing before database mutation', async () => {
    expect(
      await prepareCheckout(port, actorId, input, null, nonceHash),
    ).toEqual({ ok: false, code: 'PROVIDER_NOT_READY' });
    expect(port.prepare).not.toHaveBeenCalled();
  });
  it.each([
    ['not-uuid', nonceHash],
    [actorId, 'short'],
    [actorId, 'A'.repeat(64)],
  ])('rejects unverified actor/hash %s', async (actor, hash) => {
    expect(await prepareCheckout(port, actor!, input, 'test', hash!)).toEqual({
      ok: false,
      code: 'FORBIDDEN',
    });
    expect(port.prepare).not.toHaveBeenCalled();
  });
  it.each([
    'POLICY_CHANGED',
    'SUBSCRIPTION_EXISTS',
    'CHECKOUT_EXISTS',
    'FORBIDDEN',
    'NOT_FOUND',
    'SETUP_NOT_READY',
  ] as const)('preserves safe current authoritative error %s', async (code) => {
    port.prepare.mockResolvedValue({ ok: false, code });
    expect(
      await prepareCheckout(port, actorId, input, 'test', nonceHash),
    ).toEqual({ ok: false, code });
  });
  it.each([
    ['expired', 'SESSION_EXPIRED'],
    ['canceled', 'SESSION_CONSUMED'],
  ] as const)(
    'does not treat prior %s as new preparation',
    async (status, code) => {
      port.prepare.mockResolvedValue({
        ok: true,
        data: { ...pending, status },
      });
      expect(
        await prepareCheckout(port, actorId, input, 'test', nonceHash),
      ).toEqual({ ok: false, code });
    },
  );
  it('does not overwrite an original nonce after an uncertain first response', async () => {
    port.prepare.mockResolvedValue({
      ok: true,
      data: { ...pending, nonceMatches: false },
    });
    expect(
      await prepareCheckout(port, actorId, input, 'test', nonceHash),
    ).toEqual({ ok: false, code: 'CHECKOUT_EXISTS' });
    expect(port.prepare).toHaveBeenCalledTimes(1);
  });
  it('never automatically retries an uncertain database outcome or leaks thrown content', async () => {
    port.prepare.mockRejectedValue(new Error('secret-provider-payload'));
    expect(
      await prepareCheckout(port, actorId, input, 'test', nonceHash),
    ).toEqual({ ok: false, code: 'UNAVAILABLE' });
    expect(port.prepare).toHaveBeenCalledTimes(1);
  });
  it('requires cancellation nonce and ownership at the trusted RPC boundary', async () => {
    expect(
      await cancelCheckout(port, actorId, { sessionId }, nonceHash),
    ).toEqual({
      ok: true,
      data: {
        id: sessionId,
        status: 'canceled',
        provider: input.provider,
        expiresAt: pending.expiresAt,
        initialPriceKrw: 1000,
        regularPriceKrw: 6500,
        introEligible: true,
      },
    });
    expect(port.cancel).toHaveBeenCalledExactlyOnceWith(
      actorId,
      sessionId,
      nonceHash,
    );
    expect(port.read).toHaveBeenCalledExactlyOnceWith(actorId, sessionId);
  });
  it.each([
    'FORBIDDEN',
    'SESSION_CONSUMED',
    'SESSION_EXPIRED',
    'NOT_FOUND',
  ] as const)(
    'does not re-read after rejected cancellation %s',
    async (code) => {
      port.cancel.mockResolvedValue({ ok: false, code });
      expect(
        await cancelCheckout(port, actorId, { sessionId }, nonceHash),
      ).toEqual({ ok: false, code });
      expect(port.read).not.toHaveBeenCalled();
    },
  );
  it('treats failed verification after cancellation as unknown, not success', async () => {
    port.read.mockResolvedValue({ ok: true, data: pending });
    expect(
      await cancelCheckout(port, actorId, { sessionId }, nonceHash),
    ).toEqual({ ok: false, code: 'UNAVAILABLE' });
  });
  it('rejects forged cancellation inputs before I/O', async () => {
    expect(
      await cancelCheckout(port, actorId, { sessionId, actorId }, nonceHash),
    ).toEqual({ ok: false, code: 'INVALID_INPUT' });
    expect(await cancelCheckout(port, actorId, { sessionId }, 'bad')).toEqual({
      ok: false,
      code: 'FORBIDDEN',
    });
    expect(port.cancel).not.toHaveBeenCalled();
  });
  it('bounds offer paths and handles unavailable reads without fallback prices', async () => {
    expect(await readCheckoutOffer(port, '../other')).toEqual({
      ok: false,
      code: 'NOT_FOUND',
    });
    expect(port.read).not.toHaveBeenCalled();
    port.read.mockRejectedValue(new Error('private SQL'));
    expect(await readCheckoutOffer(port, input.artistSlug)).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
    });
  });
});
