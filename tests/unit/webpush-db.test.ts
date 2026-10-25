// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthSessionMissingError } from '@supabase/supabase-js';
import { WEBPUSH } from '@/config/webpush';
import type { ActorClient } from '@/server/db/client';
import type { CheckoutServiceClient } from '@/server/db/checkout-client';
import {
  createWebPushQueuePort,
  createWebPushSubscriptionPort,
  revokeWebPushSession,
} from '@/server/db/webpush';
const actor = {
  actorId: 'a4000000-0000-4000-8000-000000000001',
  sessionId: 'a4000000-0000-4000-8000-000000000002',
};
const jobId = 'a4000000-0000-4000-8000-000000000003';
const endpoint = 'https://fcm.googleapis.com/wp/synthetic';
const subscription = {
  endpoint,
  keys: { p256dh: 'B'.repeat(87), auth: 'A'.repeat(22) },
};
const lease = {
  jobId,
  token: actor.sessionId,
  expiresAt: '2026-10-25T01:00:30.000Z',
};
const rawLease = {
  job_id: jobId,
  lease_token: actor.sessionId,
  lease_expires_at: lease.expiresAt,
};
const device = {
  configured: true,
  consent_version: 'ci-v1',
  webpush_enabled: true,
  new_message: true,
  device_id: jobId,
  device_active: true,
};
const rpc = vi.fn();
const actorRpc = vi.fn();
const claims = vi.fn();
const client = { rpc } as unknown as CheckoutServiceClient;
const actorClient = {
  rpc: actorRpc,
  auth: { getClaims: claims },
} as unknown as ActorClient;
beforeEach(() => {
  vi.resetAllMocks();
  rpc.mockResolvedValue({ data: null, error: null });
  actorRpc.mockResolvedValue({ data: null, error: null });
  claims.mockResolvedValue({
    data: { claims: { sub: actor.actorId, session_id: actor.sessionId } },
    error: null,
  });
});
describe('narrow webpush subscription RPC mapping', () => {
  it('uses authenticated current status without exposing actor-controlled identity or endpoint directory', async () => {
    actorRpc.mockResolvedValue({
      data: [
        {
          ...device,
          endpoint,
          p256dh: 'private-key',
          auth: 'private-auth',
          email: 'private-contact',
        },
      ],
      error: null,
    });
    const port = createWebPushSubscriptionPort(client, actorClient);
    expect(await port.status(actor, endpoint)).toEqual({
      ok: true,
      data: {
        configured: true,
        consentVersion: 'ci-v1',
        webpushEnabled: true,
        newMessage: true,
        deviceId: jobId,
        deviceActive: true,
      },
    });
    expect(actorRpc).toHaveBeenCalledExactlyOnceWith('webpush_current_status', {
      p_endpoint: endpoint,
    });
    expect(rpc).not.toHaveBeenCalled();
  });
  it('omits nullable optional endpoint and preserves unconfigured null state', async () => {
    actorRpc.mockResolvedValue({
      data: [
        {
          configured: false,
          consent_version: null,
          webpush_enabled: false,
          new_message: false,
          device_id: null,
          device_active: false,
        },
      ],
      error: null,
    });
    expect(
      (
        await createWebPushSubscriptionPort(null, actorClient).status(
          actor,
          null,
        )
      ).ok,
    ).toBe(true);
    expect(actorRpc).toHaveBeenCalledWith('webpush_current_status', {});
  });
  it('registration uses service capability with explicit verified actor/session and exact keys only', async () => {
    rpc.mockResolvedValue({ data: jobId, error: null });
    expect(
      await createWebPushSubscriptionPort(client, actorClient).register(
        actor,
        subscription,
        'ci-v1',
      ),
    ).toEqual({ ok: true, data: jobId });
    expect(rpc).toHaveBeenCalledExactlyOnceWith('webpush_register_device', {
      p_actor_id: actor.actorId,
      p_auth_session_id: actor.sessionId,
      p_endpoint: endpoint,
      p_p256dh: subscription.keys.p256dh,
      p_auth: subscription.keys.auth,
      p_consent_version: 'ci-v1',
    });
    expect(actorRpc).not.toHaveBeenCalled();
  });
  it('register cannot fake success without a service client', async () => {
    expect(
      await createWebPushSubscriptionPort(null, actorClient).register(
        actor,
        subscription,
        'ci-v1',
      ),
    ).toEqual({ ok: false, code: 'SETUP_NOT_READY' });
    expect(actorRpc).not.toHaveBeenCalled();
  });
  it('revocation remains authenticated and provider-independent', async () => {
    expect(
      await createWebPushSubscriptionPort(null, actorClient).revoke(
        actor,
        endpoint,
      ),
    ).toEqual({ ok: true, data: null });
    expect(actorRpc).toHaveBeenCalledExactlyOnceWith(
      'webpush_revoke_current_device',
      { p_endpoint: endpoint },
    );
    expect(rpc).not.toHaveBeenCalled();
  });
  it.each([
    ['WEBPUSH_SESSION_REQUIRED', 'UNAUTHENTICATED'],
    ['NOTIFICATION_ACTOR_FORBIDDEN', 'FORBIDDEN'],
    ['WEBPUSH_ENDPOINT_INVALID', 'INVALID_INPUT'],
    ['NOTIFICATION_DEVICE_CONFLICT', 'CONFLICT'],
    ['NOTIFICATION_DEVICE_INACTIVE', 'CONFLICT'],
    ['WEBPUSH_DEVICE_LIMIT', 'CONFLICT'],
    ['NOTIFICATION_CONSENT_REQUIRED', 'SETUP_NOT_READY'],
    ['PRIVATE_ENDPOINT_AUTH_KEY', 'UNAVAILABLE'],
    ['toString', 'UNAVAILABLE'],
  ])('maps %s without leaking raw DB cause', async (message, code) => {
    rpc.mockResolvedValue({ data: null, error: { message } });
    expect(
      await createWebPushSubscriptionPort(client, actorClient).register(
        actor,
        subscription,
        'ci-v1',
      ),
    ).toEqual({ ok: false, code });
  });
  it.each([
    null,
    [],
    [device, device],
    [{ ...device, configured: 'true' }],
    [{ ...device, consent_version: 5 }],
    [{ ...device, device_id: 'not-uuid' }],
  ])('rejects malformed status %#', async (data) => {
    actorRpc.mockResolvedValue({ data, error: null });
    expect(
      await createWebPushSubscriptionPort(client, actorClient).status(
        actor,
        null,
      ),
    ).toEqual({ ok: false, code: 'UNAVAILABLE' });
  });
  it.each([null, {}, 'not-uuid', 1])(
    'rejects malformed registration UUID %#',
    async (data) => {
      rpc.mockResolvedValue({ data, error: null });
      expect(
        await createWebPushSubscriptionPort(client, actorClient).register(
          actor,
          subscription,
          'ci-v1',
        ),
      ).toEqual({ ok: false, code: 'UNAVAILABLE' });
    },
  );
  it('maps native optout and status failures', async () => {
    actorRpc.mockResolvedValue({
      data: null,
      error: { message: 'WEBPUSH_SESSION_REQUIRED' },
    });
    const port = createWebPushSubscriptionPort(null, actorClient);
    expect(await port.revoke(actor, endpoint)).toEqual({
      ok: false,
      code: 'UNAUTHENTICATED',
    });
    expect(await port.status(actor, endpoint)).toEqual({
      ok: false,
      code: 'UNAUTHENTICATED',
    });
  });
});
describe('leased webpush queue RPC mapping', () => {
  it('lists only filtered opaque due handles and discards extra data', async () => {
    rpc.mockResolvedValue({ data: [{ id: jobId, endpoint }], error: null });
    expect(await createWebPushQueuePort(client).due(10)).toEqual({
      ok: true,
      data: [jobId],
    });
    expect(rpc).toHaveBeenCalledWith('webpush_list_due', { p_limit: 10 });
  });
  it('lists uncertain lease handles without endpoint material', async () => {
    rpc.mockResolvedValue({
      data: [
        {
          ...rawLease,
          endpoint,
          auth: 'private',
          cancellation_requested_at: null,
        },
      ],
      error: null,
    });
    expect(await createWebPushQueuePort(client).uncertain(10)).toEqual({
      ok: true,
      data: [lease],
    });
    expect(rpc).toHaveBeenCalledWith('webpush_list_uncertain', { p_limit: 10 });
  });
  it('claim deliberately strips endpoints until prepare authorization', async () => {
    rpc.mockResolvedValue({
      data: [
        { ...rawLease, source_kind: 'message', endpoint, ...subscription.keys },
      ],
      error: null,
    });
    expect(await createWebPushQueuePort(client).claim(jobId)).toEqual({
      ok: true,
      data: lease,
    });
    expect(rpc).toHaveBeenCalledWith('notification_claim', { p_job_id: jobId });
  });
  it('prepare returns only current lease and validated key material shape', async () => {
    rpc.mockResolvedValue({
      data: [
        {
          ...rawLease,
          source_kind: 'message',
          endpoint,
          ...subscription.keys,
          email: 'private',
        },
      ],
      error: null,
    });
    expect(await createWebPushQueuePort(client).prepare(lease)).toEqual({
      ok: true,
      data: { ...lease, sourceKind: 'message', endpoint, ...subscription.keys },
    });
    expect(rpc).toHaveBeenCalledWith('webpush_prepare_delivery', {
      p_job_id: jobId,
      p_token: lease.token,
    });
  });
  it.each(['claim', 'prepare'] as const)(
    'empty %s means no authority to send',
    async (method) => {
      rpc.mockResolvedValue({ data: [], error: null });
      const port = createWebPushQueuePort(client);
      expect(
        await (method === 'claim' ? port.claim(jobId) : port.prepare(lease)),
      ).toEqual({ ok: true, data: null });
    },
  );
  it('completion binds token and evidence UUID without optimistic state replacement', async () => {
    rpc.mockResolvedValue({ data: 'provider_accepted', error: null });
    expect(
      await createWebPushQueuePort(client).complete(
        lease,
        'provider_accepted',
        actor.actorId,
      ),
    ).toEqual({ ok: true, data: 'provider_accepted' });
    expect(rpc).toHaveBeenCalledWith('webpush_complete', {
      p_job_id: jobId,
      p_token: lease.token,
      p_outcome: 'provider_accepted',
      p_evidence_ref: actor.actorId,
    });
  });
  it('recovery carries only expired handle token', async () => {
    rpc.mockResolvedValue({ data: 'retry_wait', error: null });
    expect(await createWebPushQueuePort(client).recover(lease)).toEqual({
      ok: true,
      data: 'retry_wait',
    });
    expect(rpc).toHaveBeenCalledWith('webpush_recover_expired', {
      p_job_id: jobId,
      p_token: lease.token,
    });
  });
  it.each(['claim', 'prepare'] as const)(
    'rejects multiple leases returned by %s',
    async (method) => {
      rpc.mockResolvedValue({
        data: [
          {
            ...rawLease,
            source_kind: 'message',
            endpoint,
            ...subscription.keys,
          },
          {
            ...rawLease,
            source_kind: 'message',
            endpoint,
            ...subscription.keys,
          },
        ],
        error: null,
      });
      const port = createWebPushQueuePort(client);
      expect(
        await (method === 'claim' ? port.claim(jobId) : port.prepare(lease)),
      ).toEqual({ ok: false, code: 'UNAVAILABLE' });
    },
  );
  it.each(['due', 'uncertain'] as const)(
    'bounds %s results independently of SQL limit',
    async (method) => {
      rpc.mockResolvedValue({
        data: Array.from({ length: WEBPUSH.batchSize + 1 }, () =>
          method === 'due' ? { id: jobId } : rawLease,
        ),
        error: null,
      });
      expect(
        await createWebPushQueuePort(client)[method](WEBPUSH.batchSize),
      ).toEqual({ ok: false, code: 'UNAVAILABLE' });
    },
  );
  it.each([
    'due',
    'uncertain',
    'claim',
    'prepare',
    'recover',
    'complete',
  ] as const)('redacts DB error from %s', async (method) => {
    rpc.mockResolvedValue({ data: null, error: { message: 'PRIVATE_KEY' } });
    const port = createWebPushQueuePort(client);
    const result =
      method === 'due' || method === 'uncertain'
        ? await port[method](10)
        : method === 'claim'
          ? await port.claim(jobId)
          : method === 'complete'
            ? await port.complete(lease, 'unknown', actor.actorId)
            : await port[method](lease);
    expect(result).toEqual({ ok: false, code: 'UNAVAILABLE' });
  });
});
describe('logout revokes current authenticated push session', () => {
  it('calls native session revoke without service actor parameters', async () => {
    expect(await revokeWebPushSession(actorClient)).toBe(true);
    expect(actorRpc).toHaveBeenCalledExactlyOnceWith('webpush_revoke_session');
    expect(rpc).not.toHaveBeenCalled();
  });
  it('cannot revoke without an actor client', async () => {
    expect(await revokeWebPushSession(null)).toBe(false);
    expect(actorRpc).not.toHaveBeenCalled();
  });
  it('already absent session is idempotent and does not send unauthenticated RPC', async () => {
    claims.mockResolvedValue({ data: null, error: null });
    expect(await revokeWebPushSession(actorClient)).toBe(true);
    claims.mockResolvedValue({
      data: null,
      error: new AuthSessionMissingError(),
    });
    expect(await revokeWebPushSession(actorClient)).toBe(true);
    expect(actorRpc).not.toHaveBeenCalled();
  });
  it('auth outage, RPC failure and exceptions never claim revocation', async () => {
    claims.mockResolvedValueOnce({
      data: null,
      error: { message: 'private outage' },
    });
    expect(await revokeWebPushSession(actorClient)).toBe(false);
    actorRpc.mockResolvedValueOnce({ error: { message: 'private' } });
    expect(await revokeWebPushSession(actorClient)).toBe(false);
    actorRpc.mockRejectedValueOnce(new Error('private'));
    expect(await revokeWebPushSession(actorClient)).toBe(false);
  });
});

it.each([undefined, 'payment', 'schedule_notice', 'unknown'])(
  'new delivery discriminator rejects unsupported source %# before transport',
  async (source_kind) => {
    rpc.mockResolvedValue({
      data: [
        {
          ...rawLease,
          endpoint,
          ...subscription.keys,
          ...(source_kind === undefined ? {} : { source_kind }),
        },
      ],
      error: null,
    });
    expect(await createWebPushQueuePort(client).prepare(lease)).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
    });
  },
);
it('billing notice discriminator is the only added delivery field; source price and identity remain private', async () => {
  rpc.mockResolvedValue({
    data: [
      {
        ...rawLease,
        endpoint,
        ...subscription.keys,
        source_kind: 'billing_notice',
        amount_krw: 7200,
        subscription_id: 'private',
      },
    ],
    error: null,
  });
  expect(await createWebPushQueuePort(client).prepare(lease)).toEqual({
    ok: true,
    data: {
      ...lease,
      endpoint,
      ...subscription.keys,
      sourceKind: 'billing_notice',
    },
  });
});

it('approved schedule discriminator forwards no event identity or location into the transport layer', async () => {
  rpc.mockResolvedValue({
    data: [
      {
        ...rawLease,
        endpoint,
        ...subscription.keys,
        source_kind: 'schedule',
        schedule_id: 'private-event',
        lat: 37.5,
        artist_name: 'private-artist',
        starts_at: 'private-time',
      },
    ],
    error: null,
  });
  expect(await createWebPushQueuePort(client).prepare(lease)).toEqual({
    ok: true,
    data: { ...lease, endpoint, ...subscription.keys, sourceKind: 'schedule' },
  });
});
