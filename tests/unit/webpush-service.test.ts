import { describe, expect, it, vi } from 'vitest';
import {
  readWebPushStatus,
  revokeWebPush,
  subscribeWebPush,
  type WebPushSubscriptionDependencies,
} from '@/server/services/notification/subscription';
import {
  sendWebPushQueue,
  type WebPushQueueDependencies,
  type WebPushOutcome,
} from '@/server/services/notification/send-queue';
import { WEBPUSH } from '@/config/webpush';

const actor = {
  actorId: '00000000-0000-4000-8000-000000000001',
  sessionId: '00000000-0000-4000-8000-000000000002',
};
const id = '00000000-0000-4000-8000-000000000003';
const key = 'B'.repeat(87);
const subscription = {
  endpoint: 'https://fcm.googleapis.com/wp/synthetic',
  keys: { p256dh: key, auth: 'A'.repeat(22) },
};
function subscriptions(): WebPushSubscriptionDependencies {
  return {
    publicKey: key,
    validateSubscription: vi.fn(() => true),
    port: {
      status: vi.fn(async () => ({
        ok: true as const,
        data: {
          configured: true,
          consentVersion: 'ci-v1',
          webpushEnabled: true,
          newMessage: true,
          deviceId: id,
          deviceActive: true,
        },
      })),
      register: vi.fn(async () => ({ ok: true as const, data: id })),
      revoke: vi.fn(async () => ({ ok: true as const, data: null })),
    },
  };
}
describe('webpush subscription services', () => {
  const input = {
    action: 'subscribe',
    subscription,
    applicationServerKey: key,
    consentVersion: 'ci-v1',
    confirmed: true,
  };
  it('binds registration only to caller-provided verified identity and refreshes status', async () => {
    const deps = subscriptions();
    expect((await subscribeWebPush(deps, actor, input)).ok).toBe(true);
    expect(deps.port.register).toHaveBeenCalledWith(
      actor,
      subscription,
      'ci-v1',
    );
    expect(deps.port.status).toHaveBeenCalledWith(actor, subscription.endpoint);
  });
  it.each([
    null,
    {},
    { ...input, confirmed: false },
    { ...input, actorId: actor.actorId },
    { ...input, sessionId: actor.sessionId },
    { ...input, consentVersion: '' },
    {
      ...input,
      subscription: {
        ...subscription,
        keys: { ...subscription.keys, p256dh: 'invalid' },
      },
    },
  ])('rejects malformed or authority-bearing input %j', async (value) => {
    const deps = subscriptions();
    expect(await subscribeWebPush(deps, actor, value)).toEqual({
      ok: false as const,
      code: 'INVALID_INPUT',
    });
    expect(deps.port.register).not.toHaveBeenCalled();
  });
  it('fails closed with invalid subscription/provider readiness', async () => {
    const deps = subscriptions();
    deps.publicKey = null;
    expect(await subscribeWebPush(deps, actor, input)).toEqual({
      ok: false as const,
      code: 'SETUP_NOT_READY',
    });
    deps.publicKey = key;
    deps.validateSubscription = () => false;
    expect(await subscribeWebPush(deps, actor, input)).toEqual({
      ok: false as const,
      code: 'INVALID_INPUT',
    });
    expect(deps.port.register).not.toHaveBeenCalled();
  });
  it('rejects stale browser VAPID key before registering an endpoint', async () => {
    const deps = subscriptions();
    expect(
      await subscribeWebPush(deps, actor, {
        ...input,
        applicationServerKey: 'C'.repeat(87),
      }),
    ).toEqual({ ok: false, code: 'CONFLICT' });
    expect(deps.port.register).not.toHaveBeenCalled();
  });
  it('preserves conflict, DB failure and lost-response ambiguity', async () => {
    const deps = subscriptions();
    vi.mocked(deps.port.register).mockResolvedValueOnce({
      ok: false as const,
      code: 'CONFLICT',
    });
    expect(await subscribeWebPush(deps, actor, input)).toEqual({
      ok: false as const,
      code: 'CONFLICT',
    });
    vi.mocked(deps.port.status).mockRejectedValueOnce(new Error('offline'));
    expect(await subscribeWebPush(deps, actor, input)).toEqual({
      ok: false as const,
      code: 'UNAVAILABLE',
    });
    expect(deps.port.register).toHaveBeenCalledTimes(2);
  });
  it('allows revoke without provider config and never enables preferences', async () => {
    const deps = subscriptions();
    deps.publicKey = null;
    const result = await revokeWebPush(deps, actor, {
      endpoint: subscription.endpoint,
    });
    expect(result.ok && result.data.configured).toBe(false);
    expect(deps.port.revoke).toHaveBeenCalledWith(actor, subscription.endpoint);
    expect(deps.port.register).not.toHaveBeenCalled();
  });
  it('bounds status/revoke schemas and catches boundary exceptions', async () => {
    const deps = subscriptions();
    expect(
      await readWebPushStatus(deps, actor, {
        action: 'status',
        endpoint: 'a'.repeat(WEBPUSH.endpointMaxLength + 1),
      }),
    ).toEqual({ ok: false as const, code: 'INVALID_INPUT' });
    expect(await revokeWebPush(deps, actor, { endpoint: '' })).toEqual({
      ok: false as const,
      code: 'INVALID_INPUT',
    });
    vi.mocked(deps.port.revoke).mockRejectedValueOnce(new Error('offline'));
    expect(
      await revokeWebPush(deps, actor, { endpoint: subscription.endpoint }),
    ).toEqual({ ok: false as const, code: 'UNAVAILABLE' });
  });
});

const now = Date.parse('2026-10-25T00:00:00.000Z');
const lease = {
  jobId: id,
  token: actor.sessionId,
  expiresAt: new Date(now + 30_000).toISOString(),
};
function queue(
  outcome: WebPushOutcome = 'provider_accepted',
): WebPushQueueDependencies {
  return {
    now: () => now,
    evidenceId: () => actor.actorId,
    channel: { send: vi.fn(async () => ({ outcome })) },
    port: {
      uncertain: vi.fn(async () => ({ ok: true as const, data: [] })),
      recover: vi.fn(async () => ({ ok: true as const, data: 'retry_wait' })),
      due: vi.fn(async () => ({ ok: true as const, data: [id] })),
      claim: vi.fn(async () => ({ ok: true as const, data: lease })),
      prepare: vi.fn(async () => ({
        ok: true as const,
        data: {
          ...lease,
          endpoint: subscription.endpoint,
          p256dh: key,
          auth: subscription.keys.auth,
        },
      })),
      complete: vi.fn(async () => ({ ok: true as const, data: outcome })),
    },
  };
}
describe('bounded leased webpush worker', () => {
  it('checks latest eligibility before minimal generic delivery and distinguishes push-service acceptance', async () => {
    const deps = queue();
    const result = await sendWebPushQueue(deps);
    expect(result.ok && result.data.acceptedByPushService).toBe(1);
    expect(deps.port.prepare).toHaveBeenCalledWith(lease);
    expect(deps.channel.send).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: JSON.stringify({
          version: 1,
          notificationId: id,
          url: '/me/subscriptions',
        }),
        topic: id.replaceAll('-', ''),
      }),
    );
    expect(deps.port.complete).toHaveBeenCalledWith(
      lease,
      'provider_accepted',
      actor.actorId,
    );
    expect(JSON.stringify(result)).not.toContain('displayed');
  });
  it.each([
    'not_sent',
    'unknown',
    'dead_endpoint',
    'permanent_failure',
  ] as const)('records %s without an immediate retry', async (outcome) => {
    const deps = queue(outcome);
    expect((await sendWebPushQueue(deps)).ok).toBe(true);
    expect(deps.channel.send).toHaveBeenCalledTimes(1);
    expect(deps.port.complete).toHaveBeenCalledWith(
      lease,
      outcome,
      actor.actorId,
    );
  });
  it('canceled/revoked/changed current recipient is not sent', async () => {
    const deps = queue();
    vi.mocked(deps.port.prepare).mockResolvedValue({
      ok: true as const,
      data: null,
    });
    const result = await sendWebPushQueue(deps);
    expect(result.ok && result.data.skipped).toBe(1);
    expect(deps.channel.send).not.toHaveBeenCalled();
  });
  it('rejects duplicate due handles and unbounded lists', async () => {
    const deps = queue();
    vi.mocked(deps.port.due).mockResolvedValue({
      ok: true as const,
      data: [id, id],
    });
    expect(await sendWebPushQueue(deps)).toEqual({
      ok: false as const,
      code: 'UNAVAILABLE',
    });
    expect(deps.port.claim).not.toHaveBeenCalled();
  });
  it('does not send with insufficient lease time and records definite not-sent', async () => {
    const deps = queue();
    vi.mocked(deps.port.prepare).mockResolvedValue({
      ok: true as const,
      data: {
        ...lease,
        endpoint: subscription.endpoint,
        p256dh: key,
        auth: subscription.keys.auth,
        expiresAt: new Date(now + 4999).toISOString(),
      },
    });
    await sendWebPushQueue(deps);
    expect(deps.channel.send).not.toHaveBeenCalled();
    expect(deps.port.complete).toHaveBeenCalledWith(
      lease,
      'not_sent',
      actor.actorId,
    );
  });
  it('exceptions and lost completion are ambiguous, never proven non-send', async () => {
    const deps = queue();
    vi.mocked(deps.channel.send).mockRejectedValueOnce(new Error('socket'));
    const result = await sendWebPushQueue(deps);
    expect(result.ok && result.data.uncertain).toBe(1);
    expect(deps.port.complete).toHaveBeenCalledWith(
      lease,
      'unknown',
      actor.actorId,
    );
    expect(deps.port.complete).not.toHaveBeenCalledWith(
      lease,
      'not_sent',
      expect.anything(),
    );
  });
  it('recovers expired only, not a still-live uncertain lease', async () => {
    const deps = queue();
    const expired = { ...lease, expiresAt: new Date(now - 1).toISOString() };
    vi.mocked(deps.port.uncertain).mockResolvedValue({
      ok: true as const,
      data: [lease, expired],
    });
    await sendWebPushQueue(deps);
    expect(deps.port.recover).toHaveBeenCalledExactlyOnceWith(expired);
  });
  it('caps active provider calls and keeps finite batch', async () => {
    const deps = queue();
    const jobs = Array.from(
      { length: 27 },
      (_, index) =>
        `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    );
    vi.mocked(deps.port.due).mockResolvedValue({
      ok: true as const,
      data: jobs,
    });
    vi.mocked(deps.port.claim).mockImplementation(async (jobId) => ({
      ok: true as const,
      data: { ...lease, jobId },
    }));
    vi.mocked(deps.port.prepare).mockImplementation(async (claimed) => ({
      ok: true as const,
      data: {
        ...claimed,
        endpoint: subscription.endpoint,
        p256dh: key,
        auth: subscription.keys.auth,
      },
    }));
    let active = 0;
    let maximum = 0;
    vi.mocked(deps.channel.send).mockImplementation(async () => {
      active++;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active--;
      return { outcome: 'provider_accepted' };
    });
    const result = await sendWebPushQueue(deps);
    expect(result.ok && result.data.acceptedByPushService).toBe(jobs.length);
    expect(maximum).toBeLessThanOrEqual(WEBPUSH.concurrency);
  });
  it('stops scheduling when invocation budget expires', async () => {
    const deps = queue();
    let reads = 0;
    deps.now = () => (reads++ === 0 ? now : now + WEBPUSH.workerBudgetMs);
    const result = await sendWebPushQueue(deps);
    expect(result.ok && result.data.hasMore).toBe(true);
    expect(deps.port.due).not.toHaveBeenCalled();
    expect(deps.channel.send).not.toHaveBeenCalled();
  });
  it('persists a bounded provider Retry-After minimum instead of sleeping or retrying in-process', async () => {
    const deps = queue('not_sent');
    vi.mocked(deps.channel.send).mockResolvedValue({
      outcome: 'not_sent',
      retryAfterSeconds: 120,
    });
    await sendWebPushQueue(deps);
    expect(deps.port.complete).toHaveBeenCalledExactlyOnceWith(
      lease,
      'not_sent',
      actor.actorId,
      120,
    );
    expect(deps.channel.send).toHaveBeenCalledTimes(1);
  });
  it.each([-1, 86401, Number.POSITIVE_INFINITY, Number.NaN, 0.5])(
    'does not turn unsupported provider wait %s into an earlier fallback retry',
    async (retryAfterSeconds) => {
      const deps = queue('not_sent');
      vi.mocked(deps.channel.send).mockResolvedValue({
        outcome: 'not_sent',
        retryAfterSeconds,
      });
      await sendWebPushQueue(deps);
      expect(deps.port.complete).toHaveBeenCalledExactlyOnceWith(
        lease,
        'permanent_failure',
        actor.actorId,
      );
    },
  );
  it('drains a 1001-job synthetic backlog with bounded pages, not a claimed device-delivery SLA', async () => {
    const deps = queue();
    const pending = new Set(
      Array.from(
        { length: 1001 },
        (_, index) =>
          `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      ),
    );
    const claimed = new Set<string>();
    vi.mocked(deps.port.due).mockImplementation(async (limit) => ({
      ok: true,
      data: [...pending].slice(0, limit),
    }));
    vi.mocked(deps.port.claim).mockImplementation(async (jobId) => {
      if (claimed.has(jobId) || !pending.has(jobId))
        return { ok: true, data: null };
      claimed.add(jobId);
      return { ok: true, data: { ...lease, jobId } };
    });
    vi.mocked(deps.port.prepare).mockImplementation(async (handle) => ({
      ok: true,
      data: {
        ...handle,
        endpoint: subscription.endpoint,
        p256dh: key,
        auth: subscription.keys.auth,
      },
    }));
    vi.mocked(deps.port.complete).mockImplementation(async (handle) => {
      pending.delete(handle.jobId);
      return { ok: true, data: 'provider_accepted' };
    });
    let accepted = 0;
    for (let iteration = 0; iteration < 2; iteration++) {
      const result = await sendWebPushQueue(deps);
      expect(result.ok).toBe(true);
      if (result.ok) {
        accepted += result.data.acceptedByPushService;
        expect(result.data.examined).toBeLessThanOrEqual(WEBPUSH.workerLimit);
        expect(result.data.examined).toBe(iteration === 0 ? 1000 : 1);
        expect(result.data.hasMore).toBe(iteration === 0);
      }
    }
    expect(accepted).toBe(1001);
    expect(pending.size).toBe(0);
    expect(deps.channel.send).toHaveBeenCalledTimes(1001);
    expect(deps.port.due).toHaveBeenCalledTimes(11);
    const empty = await sendWebPushQueue(deps);
    expect(empty.ok && empty.data.hasMore).toBe(false);
    expect(empty.ok && empty.data.examined).toBe(0);
  });
  it('stops repeated full pages without retrying the same job during one invocation', async () => {
    const deps = queue();
    const jobs = Array.from(
      { length: WEBPUSH.batchSize },
      (_, index) =>
        `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    );
    vi.mocked(deps.port.due).mockResolvedValue({ ok: true, data: jobs });
    vi.mocked(deps.port.claim).mockResolvedValue({
      ok: false,
      code: 'UNAVAILABLE',
    });
    const result = await sendWebPushQueue(deps);
    expect(result.ok && result.data.examined).toBe(WEBPUSH.batchSize);
    expect(result.ok && result.data.hasMore).toBe(true);
    expect(deps.port.due).toHaveBeenCalledTimes(2);
    expect(deps.port.claim).toHaveBeenCalledTimes(WEBPUSH.batchSize);
    expect(deps.channel.send).not.toHaveBeenCalled();
  });
});
