// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  createCheckoutOfferPort,
  createCheckoutSessionPort,
} from '@/server/db/checkout';
import type { ActorClient } from '@/server/db/client';
import type { CheckoutServiceClient } from '@/server/db/checkout-client';

const actor = 'c1100000-0000-4000-8000-000000000001';
const id = 'c1100000-0000-4000-8000-000000000002';
const policyVersion = 'c1100000-0000-4000-8000-000000000003';
const key = 'c1100000-0000-4000-8000-000000000004';
const hash = 'a'.repeat(64);
const row = {
  session_id: id,
  status: 'pending_intent',
  provider: 'toss',
  environment: 'test',
  artist_slug: 'fictional-star',
  artist_name: '허구가수',
  policy_version: policyVersion,
  policy_title: '허구약관',
  policy_body: 'CI 전용 허구 본문',
  regular_price_krw: 6500,
  intro_price_krw: 1000,
  initial_price_krw: 1000,
  intro_eligible: true,
  expires_at: '2026-10-24T12:15:00+00:00',
  customer_ref: 'private-customer',
  order_id: 'private-order',
  nonce_matches: true,
  nonce_hash: hash,
  credential: 'never-project',
};
function mockClient(data: unknown = row, error: unknown = null) {
  const result = { data, error };
  const rpc = vi.fn(() => ({
    ...result,
    single: vi.fn().mockResolvedValue(result),
  }));
  return {
    rpc,
    client: { rpc } as unknown as ActorClient & CheckoutServiceClient,
  };
}
describe('checkout database adapter', () => {
  it('reads offer using actor RPC and safe fields only', async () => {
    const { client, rpc } = mockClient();
    expect(
      await createCheckoutOfferPort(client).read('fictional-star'),
    ).toEqual({
      ok: true,
      data: {
        artist: { slug: row.artist_slug, name: row.artist_name },
        policy: {
          version: policyVersion,
          title: row.policy_title,
          body: row.policy_body,
          regularPriceKrw: 6500,
          introPriceKrw: 1000,
        },
        introEligible: true,
      },
    });
    expect(rpc).toHaveBeenCalledExactlyOnceWith('checkout_get_offer', {
      p_artist_slug: 'fictional-star',
    });
  });
  it.each([
    ['toss_card_billing', 'toss'],
    ['kakaopay_subscription', 'kakaopay'],
  ] as const)(
    'maps app %s to exact SQL enum %s in both directions',
    async (provider, sqlProvider) => {
      const { client, rpc } = mockClient({ ...row, provider: sqlProvider });
      const input = {
        artistSlug: 'fictional-star',
        provider,
        policyVersion,
        accepted: true as const,
        idempotencyKey: key,
      };
      const result = await createCheckoutSessionPort(client).prepare(
        actor,
        input,
        'test',
        hash,
      );
      expect(rpc).toHaveBeenNthCalledWith(1, 'enrollment_abandon_expired', {
        p_user_id: actor,
        p_artist_slug: input.artistSlug,
      });
      expect(rpc).toHaveBeenNthCalledWith(2, 'checkout_prepare_session', {
        p_user_id: actor,
        p_artist_slug: input.artistSlug,
        p_provider: sqlProvider,
        p_environment: 'test',
        p_idempotency_key: key,
        p_nonce_hash: hash,
        p_policy_version: policyVersion,
        p_terms_accepted: true,
      });
      expect(result).toEqual({
        ok: true,
        data: {
          id,
          status: 'pending_intent',
          provider,
          expiresAt: row.expires_at,
          nonceMatches: true,
          initialPriceKrw: 1000,
          regularPriceKrw: 6500,
          introEligible: true,
        },
      });
      expect(JSON.stringify(result)).not.toMatch(
        /private-customer|private-order|never-project|nonce_hash/,
      );
    },
  );
  it('passes trusted actor for reads and cancellation; ignores provider-returned identities', async () => {
    const { client, rpc } = mockClient();
    const port = createCheckoutSessionPort(client);
    await port.read(actor, id);
    expect(rpc).toHaveBeenLastCalledWith('checkout_read_session', {
      p_user_id: actor,
      p_session_id: id,
    });
    expect(await port.cancel(actor, id, hash)).toEqual({
      ok: true,
      data: null,
    });
    expect(rpc).toHaveBeenLastCalledWith('checkout_cancel_session', {
      p_user_id: actor,
      p_session_id: id,
      p_nonce_hash: hash,
    });
  });
  it.each([
    ['CHECKOUT_INVALID_INPUT', 'INVALID_INPUT'],
    ['CHECKOUT_ACTOR_FORBIDDEN', 'FORBIDDEN'],
    ['CHECKOUT_ONBOARDING_REQUIRED', 'FORBIDDEN'],
    ['DISCOVERY_FORBIDDEN', 'FORBIDDEN'],
    ['DISCOVERY_PROFILE_REQUIRED', 'FORBIDDEN'],
    ['DISCOVERY_SETUP_NOT_READY', 'SETUP_NOT_READY'],
    ['CHECKOUT_PROFILE_REQUIRED', 'FORBIDDEN'],
    ['CHECKOUT_SETUP_NOT_READY', 'SETUP_NOT_READY'],
    ['CHECKOUT_POLICY_CHANGED', 'POLICY_CHANGED'],
    ['CHECKOUT_CONSENT_REQUIRED', 'CONSENT_REQUIRED'],
    ['CHECKOUT_NOT_FOUND', 'NOT_FOUND'],
    ['CHECKOUT_SUBSCRIPTION_EXISTS', 'SUBSCRIPTION_EXISTS'],
    ['CHECKOUT_SESSION_EXISTS', 'CHECKOUT_EXISTS'],
    ['CHECKOUT_IDEMPOTENCY_CONFLICT', 'CHECKOUT_EXISTS'],
    ['CHECKOUT_NONCE_INVALID', 'FORBIDDEN'],
    ['CHECKOUT_SESSION_REPLAY', 'SESSION_CONSUMED'],
    ['CHECKOUT_SESSION_EXPIRED', 'SESSION_EXPIRED'],
    ['CHECKOUT_NONCE_INVALID secret', 'UNAVAILABLE'],
    ['__proto__', 'UNAVAILABLE'],
    ['private SQL body and secret', 'UNAVAILABLE'],
  ])('maps only exact controlled SQL error %s to %s', async (message, code) => {
    const { client } = mockClient(null, { message });
    const port = createCheckoutSessionPort(client);
    expect(await port.read(actor, id)).toEqual({ ok: false, code });
    expect(await port.cancel(actor, id, hash)).toEqual({ ok: false, code });
    expect(
      await createCheckoutOfferPort(client).read('fictional-star'),
    ).toEqual({ ok: false, code });
  });
  it.each([
    null,
    { ...row, status: 'paid' },
    { ...row, provider: 'mock' },
    { ...row, expires_at: 'invalid' },
    { ...row, session_id: '../secret' },
    { ...row, initial_price_krw: -1 },
    { ...row, regular_price_krw: 0 },
  ])('rejects malformed/unimplemented session results %j', async (value) => {
    const { client } = mockClient(value);
    expect(await createCheckoutSessionPort(client).read(actor, id)).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
    });
  });
});
