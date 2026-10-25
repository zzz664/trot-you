import 'server-only';
import { buildWebPushChannel } from './channel';
import type { WebPushConfiguration, WebPushTransport } from './types';

/** Explicit dependency seam for isolated protocol tests, never env-configured. */
export function createWebPushChannelForTests(
  configuration: WebPushConfiguration,
  transport: WebPushTransport,
  now: () => number = Date.now,
) {
  return buildWebPushChannel(configuration, transport, now);
}
