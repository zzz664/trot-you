import 'server-only';
import { buildWebPushChannel } from './channel';
import { sendPinnedWebPushRequest } from './transport';
import type { WebPushConfiguration } from './types';

export type {
  NotificationChannel,
  WebPushConfiguration,
  WebPushMessage,
  WebPushOutcome,
  WebPushResult,
  WebPushSubscription,
} from './types';
export {
  isAllowedWebPushEndpoint,
  validateWebPushConfiguration,
  validateWebPushSubscription,
  validP256PublicKey,
  validWebPushSubject,
} from './validation';

/** No transport/origin override is accepted by the production constructor. */
export function createWebPushChannel(configuration: WebPushConfiguration) {
  return buildWebPushChannel(configuration, sendPinnedWebPushRequest, Date.now);
}
