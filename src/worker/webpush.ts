/// <reference lib="webworker" />
import { PWA } from '@/config/pwa';
import { routes } from '@/config/routes';
import { WEBPUSH_CLIENT } from '@/config/webpush-client';
import messages from '@/messages/ko.json';

const notificationIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Neither remote copy nor an arbitrary destination enters the system UI. */
export function notificationOptions(raw: string | null): NotificationOptions {
  let id: string | null = null;
  if (raw && raw.length <= WEBPUSH_CLIENT.payloadLimit) {
    try {
      const payload: unknown = JSON.parse(raw);
      if (
        payload !== null &&
        typeof payload === 'object' &&
        'version' in payload &&
        payload.version === WEBPUSH_CLIENT.payloadVersion &&
        'notificationId' in payload &&
        typeof payload.notificationId === 'string' &&
        notificationIdPattern.test(payload.notificationId) &&
        'url' in payload &&
        payload.url === routes.subscriptions
      )
        id = payload.notificationId;
    } catch {
      // A malformed or empty push still gets a generic, user-visible notice.
    }
  }
  return {
    body: messages.notifications.pushBody,
    icon: PWA.icon192,
    badge: PWA.icon192,
    tag: id
      ? `${WEBPUSH_CLIENT.notificationTagPrefix}${id}`
      : WEBPUSH_CLIENT.fallbackNotificationTag,
    // No endpoint, account, artist, content or authorization data is persisted.
    data: { url: routes.subscriptions },
  };
}

export async function showWebPush(
  registration: Pick<ServiceWorkerRegistration, 'showNotification'>,
  raw: string | null,
) {
  await registration.showNotification(
    messages.notifications.pushTitle,
    notificationOptions(raw),
  );
}

export async function openWebPush(clients: Clients, origin: string) {
  // Do not navigate an already-open authoring/payment page or trust notification
  // data. The authenticated destination resolves only the current account.
  const destination = new URL(routes.subscriptions, origin).href;
  const windows = await clients.matchAll({
    type: 'window',
    includeUncontrolled: false,
  });
  for (const client of windows) {
    if (client.url === destination) {
      try {
        await client.focus();
        return;
      } catch {
        // A window can close while the notification is being selected.
      }
    }
  }
  await clients.openWindow(destination);
}

/** A public version response only; never skipWaiting, cache commands or state mutation. */
export function respondWebPushCapability(
  event: Pick<ExtendableMessageEvent, 'data' | 'ports'>,
) {
  if (
    event.data !== WEBPUSH_CLIENT.capabilityRequest ||
    event.ports.length !== 1
  )
    return;
  event.ports[0]?.postMessage({
    type: WEBPUSH_CLIENT.capabilityResponse,
    version: WEBPUSH_CLIENT.workerVersion,
  });
}
