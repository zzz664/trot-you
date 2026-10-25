// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WEBPUSH } from '@/config/webpush';
import type { ActorClient } from '@/server/db/client';
import {
  createWebPushQueueDependencies,
  createWebPushSubscriptionDependencies,
  webPushConfiguration,
} from '@/server/webpush/dependencies';
const mocks = vi.hoisted(() => ({
  env: vi.fn(),
  client: vi.fn(),
  queue: vi.fn(),
  subscription: vi.fn(),
  channel: vi.fn(),
  configuration: vi.fn(),
  validate: vi.fn(),
}));
vi.mock('@/config/env.server', () => ({ getServerEnv: mocks.env }));
vi.mock('@/server/db/checkout-client', () => ({
  createCheckoutServiceClient: mocks.client,
}));
vi.mock('@/server/db/webpush', () => ({
  createWebPushQueuePort: mocks.queue,
  createWebPushSubscriptionPort: mocks.subscription,
}));
vi.mock('@/server/adapters/notification/webpush', () => ({
  createWebPushChannel: mocks.channel,
  validateWebPushConfiguration: mocks.configuration,
  validateWebPushSubscription: mocks.validate,
}));
const values = {
  WEBPUSH_ENABLED: true,
  WEBPUSH_WORKER_ENABLED: true,
  WEBPUSH_CRON_SECRET: 'synthetic-worker-secret',
  VAPID_PUBLIC_KEY: 'public',
  VAPID_PRIVATE_KEY: 'private',
  VAPID_SUBJECT: 'mailto:synthetic@example.invalid',
};
const actorClient = { actor: true } as unknown as ActorClient;
beforeEach(() => {
  vi.resetAllMocks();
  mocks.env.mockReturnValue({ ok: true, data: values });
  mocks.client.mockReturnValue({ service: true });
  mocks.queue.mockReturnValue({ queue: true });
  mocks.subscription.mockReturnValue({ subscription: true });
  mocks.channel.mockReturnValue({ channel: true });
  mocks.configuration.mockReturnValue(true);
  mocks.validate.mockReturnValue(true);
});
describe('webpush configuration and dependency wiring', () => {
  it('projects only the explicitly enabled VAPID triple and bounded timeout', () => {
    expect(webPushConfiguration()).toEqual({
      publicKey: 'public',
      privateKey: 'private',
      subject: 'mailto:synthetic@example.invalid',
      timeoutMs: WEBPUSH.providerTimeoutMs,
    });
    expect(mocks.configuration).toHaveBeenCalledOnce();
  });
  it.each([
    { ok: false, code: 'CONFIGURATION_INVALID' },
    { ok: true, data: { ...values, WEBPUSH_ENABLED: false } },
  ])('does not validate/use secrets in disabled state %#', (env) => {
    mocks.env.mockReturnValue(env);
    expect(webPushConfiguration()).toBeNull();
    expect(mocks.configuration).not.toHaveBeenCalled();
  });
  it('validates missing key material without generating or replacing credentials', () => {
    mocks.env.mockReturnValue({ ok: true, data: { WEBPUSH_ENABLED: true } });
    mocks.configuration.mockReturnValue(false);
    expect(webPushConfiguration()).toBeNull();
    expect(mocks.configuration).toHaveBeenCalledWith({
      publicKey: '',
      privateKey: '',
      subject: '',
      timeoutMs: WEBPUSH.providerTimeoutMs,
    });
  });
  it('public subscription capability contains public key only and flattens endpoint for validation', () => {
    const deps = createWebPushSubscriptionDependencies(actorClient);
    expect(deps.publicKey).toBe('public');
    expect(deps.port).toEqual({ subscription: true });
    expect(JSON.stringify(deps)).not.toContain('private');
    expect(mocks.subscription).toHaveBeenCalledWith(
      { service: true },
      actorClient,
    );
    expect(mocks.client).toHaveBeenCalledWith(WEBPUSH.databaseTimeoutMs);
    const subscription = {
      endpoint: 'https://fcm.googleapis.com/wp/synthetic',
      keys: { p256dh: 'public-device', auth: 'synthetic-auth' },
    };
    expect(deps.validateSubscription(subscription)).toBe(true);
    expect(mocks.validate).toHaveBeenCalledWith({
      endpoint: subscription.endpoint,
      ...subscription.keys,
    });
  });
  it('preserves actor-only status and revocation when service env is unavailable', () => {
    mocks.client.mockReturnValue(null);
    mocks.env.mockReturnValue({ ok: false, code: 'CONFIGURATION_INVALID' });
    const deps = createWebPushSubscriptionDependencies(actorClient);
    expect(deps.publicKey).toBeNull();
    expect(deps.port).toEqual({ subscription: true });
    expect(mocks.subscription).toHaveBeenCalledWith(null, actorClient);
    expect(mocks.channel).not.toHaveBeenCalled();
  });
  it('does not advertise enrollment readiness when VAPID exists but the registration service is absent', () => {
    mocks.client.mockReturnValue(null);
    const deps = createWebPushSubscriptionDependencies(actorClient);
    expect(deps.publicKey).toBeNull();
    expect(deps.port).toEqual({ subscription: true });
    expect(mocks.subscription).toHaveBeenCalledWith(null, actorClient);
  });
  it.each([
    { ok: false, code: 'CONFIGURATION_INVALID' },
    { ok: true, data: { ...values, WEBPUSH_WORKER_ENABLED: false } },
    { ok: true, data: { ...values, WEBPUSH_CRON_SECRET: undefined } },
    { ok: true, data: { ...values, WEBPUSH_ENABLED: false } },
  ])('does not construct delivery channel when gate absent %#', (env) => {
    mocks.env.mockReturnValue(env);
    expect(createWebPushQueueDependencies()).toBeNull();
    expect(mocks.channel).not.toHaveBeenCalled();
  });
  it('does not construct worker after invalid key pair', () => {
    mocks.configuration.mockReturnValue(false);
    expect(createWebPushQueueDependencies()).toBeNull();
    expect(mocks.client).not.toHaveBeenCalled();
    expect(mocks.channel).not.toHaveBeenCalled();
  });
  it.each(['client', 'channel'] as const)(
    'fails unavailable %s without mock success',
    (kind) => {
      mocks[kind].mockReturnValue(null);
      expect(createWebPushQueueDependencies()).toBeNull();
      expect(mocks.queue).not.toHaveBeenCalled();
    },
  );
  it('constructs real capability and separate evidence UUID factory only when enabled', () => {
    const deps = createWebPushQueueDependencies();
    expect(deps).not.toBeNull();
    expect(deps?.channel).toEqual({ channel: true });
    expect(deps?.port).toEqual({ queue: true });
    expect(deps?.now).toBe(Date.now);
    expect(deps?.evidenceId()).toMatch(/^[0-9a-f-]{36}$/);
    expect(mocks.queue).toHaveBeenCalledWith({ service: true });
  });
});
