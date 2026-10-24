// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createEnrollmentDbPort } from '@/server/db/enrollment';
import type { CheckoutServiceClient } from '@/server/db/checkout-client';
const id = (n: number) =>
  `b1720000-0000-4000-8000-${n.toString().padStart(12, '0')}`;
const actor = {
  actorId: id(1),
  authSessionHash: 'a'.repeat(64),
  nonceHash: 'b'.repeat(64),
};
function client(
  data: unknown = null,
  error: { message: string } | null = null,
) {
  const rpc = vi.fn().mockResolvedValue({ data, error });
  return {
    rpc,
    port: createEnrollmentDbPort({ rpc } as unknown as CheckoutServiceClient),
  };
}
describe('enrollment database RPC contract and error boundary', () => {
  it('binds start to immutable actor/session/nonces and merchant, without a charge flag', async () => {
    const { rpc, port } = client();
    await port.start(actor, id(2), 'c'.repeat(64), 'fictional_mid');
    expect(rpc).toHaveBeenCalledExactlyOnceWith('enrollment_start', {
      p_user_id: id(1),
      p_session_id: id(2),
      p_nonce_hash: actor.nonceHash,
      p_auth_session_hash: actor.authSessionHash,
      p_callback_state_hash: 'c'.repeat(64),
      p_merchant_account: 'fictional_mid',
    });
  });
  it('status read omits nonce while financial recovery read validates original nonce', async () => {
    const { rpc, port } = client();
    await port.read(
      { actorId: id(1), authSessionHash: actor.authSessionHash },
      id(2),
    );
    expect(rpc).toHaveBeenLastCalledWith('enrollment_read', {
      p_user_id: id(1),
      p_session_id: id(2),
      p_auth_session_hash: actor.authSessionHash,
    });
    await port.read(actor, id(2));
    expect(rpc).toHaveBeenLastCalledWith('enrollment_read', {
      p_user_id: id(1),
      p_session_id: id(2),
      p_auth_session_hash: actor.authSessionHash,
      p_nonce_hash: actor.nonceHash,
    });
  });
  it('claim forwards only explicit exact consent and financial period', async () => {
    const { rpc, port } = client();
    await port.claim(actor, id(2), 'charge', {
      accepted: true,
      policyVersion: id(3),
      amountKrw: 1000,
      periodStart: '2026-10-24T12:00:00Z',
      periodEnd: '2026-11-24T12:00:00Z',
    });
    expect(rpc).toHaveBeenCalledExactlyOnceWith('enrollment_claim', {
      p_user_id: id(1),
      p_session_id: id(2),
      p_nonce_hash: actor.nonceHash,
      p_auth_session_hash: actor.authSessionHash,
      p_stage: 'charge',
      p_accepted: true,
      p_policy_version: id(3),
      p_amount_krw: 1000,
      p_period_start: '2026-10-24T12:00:00Z',
      p_period_end: '2026-11-24T12:00:00Z',
    });
  });
  it.each([
    ['ENROLLMENT_INVALID_INPUT', 'INVALID_INPUT'],
    ['ENROLLMENT_NOT_FOUND', 'NOT_FOUND'],
    ['ENROLLMENT_BINDING_INVALID', 'FORBIDDEN'],
    ['ENROLLMENT_AUTHORIZATION_EXPIRED', 'SESSION_EXPIRED'],
    ['ENROLLMENT_CANNOT_CANCEL', 'SESSION_CONSUMED'],
    ['CHECKOUT_POLICY_CHANGED', 'POLICY_CHANGED'],
    ['DISCOVERY_FORBIDDEN', 'FORBIDDEN'],
    ['ENROLLMENT_NOT_FOUND secret-token', 'UNAVAILABLE'],
    ['__proto__', 'UNAVAILABLE'],
    ['raw provider secret', 'UNAVAILABLE'],
  ])('maps exact %s only to %s', async (message, code) => {
    const { port } = client(null, { message });
    expect(await port.read(actor, id(2))).toEqual({ ok: false, code });
  });
  it.each([
    null,
    {},
    { session_id: id(2), state: 'paid' },
    { credential_ciphertext: 'plain_secret' },
  ])(
    'rejects malformed private result without reflecting it %j',
    async (value) => {
      const { port } = client(value);
      expect(await port.read(actor, id(2))).toEqual({
        ok: false,
        code: 'UNAVAILABLE',
      });
    },
  );
});
