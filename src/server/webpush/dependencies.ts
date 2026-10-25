import 'server-only';
import { randomUUID } from 'node:crypto';
import { getServerEnv } from '@/config/env.server';
import { WEBPUSH } from '@/config/webpush';
import {
  createWebPushChannel,
  validateWebPushConfiguration,
  validateWebPushSubscription,
} from '@/server/adapters/notification/webpush';
import { createCheckoutServiceClient } from '@/server/db/checkout-client';
import {
  createWebPushQueuePort,
  createWebPushSubscriptionPort,
} from '@/server/db/webpush';
import type { WebPushSubscriptionDependencies } from '@/server/services/notification/subscription';
import type { WebPushQueueDependencies } from '@/server/services/notification/send-queue';
import type { ActorClient } from '@/server/db/client';

export function webPushConfiguration() {
  const parsed = getServerEnv();
  if (!parsed.ok || !parsed.data.WEBPUSH_ENABLED) return null;
  const config = {
    publicKey: parsed.data.VAPID_PUBLIC_KEY ?? '',
    privateKey: parsed.data.VAPID_PRIVATE_KEY ?? '',
    subject: parsed.data.VAPID_SUBJECT ?? '',
    timeoutMs: WEBPUSH.providerTimeoutMs,
  };
  return validateWebPushConfiguration(config) ? config : null;
}

export function createWebPushSubscriptionDependencies(
  actorClient: ActorClient,
): WebPushSubscriptionDependencies {
  const client = createCheckoutServiceClient(WEBPUSH.databaseTimeoutMs);
  const configuration = webPushConfiguration();
  return {
    port: createWebPushSubscriptionPort(client, actorClient),
    publicKey: client && configuration ? configuration.publicKey : null,
    validateSubscription: (subscription) =>
      validateWebPushSubscription({
        endpoint: subscription.endpoint,
        ...subscription.keys,
      }),
  };
}

export function createWebPushQueueDependencies(): WebPushQueueDependencies | null {
  const parsed = getServerEnv();
  if (
    !parsed.ok ||
    !parsed.data.WEBPUSH_WORKER_ENABLED ||
    !parsed.data.WEBPUSH_CRON_SECRET
  )
    return null;
  const configuration = webPushConfiguration();
  if (!configuration) return null;
  const client = createCheckoutServiceClient(WEBPUSH.databaseTimeoutMs);
  const channel = createWebPushChannel(configuration);
  return client && channel
    ? {
        port: createWebPushQueuePort(client),
        channel,
        now: Date.now,
        evidenceId: randomUUID,
      }
    : null;
}
