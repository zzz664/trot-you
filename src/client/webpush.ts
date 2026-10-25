import { identifyInstallPlatform } from '@/config/install';
import { PWA } from '@/config/pwa';
import { routes } from '@/config/routes';
import {
  WEBPUSH_ERROR_STATUS,
  webPushStatusSchema,
  webPushSubscriptionSchema,
  type WebPushError,
  type WebPushResult,
  type WebPushStatus,
} from '@/config/webpush';
import {
  INITIAL_WEBPUSH_BROWSER_STATE,
  WEBPUSH_CLIENT,
  type WebPushBrowserError,
  type WebPushBrowserState,
} from '@/config/webpush-client';

export type WebPushClientData = {
  status: WebPushStatus;
  browser: WebPushBrowserState;
};
export type WebPushClientResult =
  | { ok: true; data: WebPushClientData }
  | {
      ok: false;
      code: WebPushError | WebPushBrowserError;
      data?: WebPushClientData;
    };
let changing = false;
let operationVersion = 0;
const isCurrentDefault = () => true;

export function webPushBrowserState(): WebPushBrowserState {
  if (typeof window === 'undefined') return INITIAL_WEBPUSH_BROWSER_STATE;
  const secure = window.isSecureContext === true;
  const platform = identifyInstallPlatform(
    navigator.userAgent,
    navigator.platform,
    navigator.maxTouchPoints,
  );
  const standalone =
    window.matchMedia?.(WEBPUSH_CLIENT.displayMode).matches === true ||
    ('standalone' in navigator && navigator.standalone === true);
  const supported =
    secure &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window &&
    typeof window.Notification?.requestPermission === 'function';
  const permission =
    supported &&
    ['granted', 'default', 'denied'].includes(Notification.permission)
      ? Notification.permission
      : 'unsupported';
  return {
    secure,
    platform,
    standalone,
    supported,
    permission,
    installRequired: platform === 'ios' && !standalone,
    subscriptionPresent: false,
    needsRenewal: false,
  };
}

async function requestStatus(
  method: 'POST' | 'DELETE',
  body: unknown,
): Promise<WebPushResult<WebPushStatus>> {
  try {
    const response = await fetch(routes.pushSubscription, {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(WEBPUSH_CLIENT.requestTimeoutMs),
    });
    const result: unknown = await response.json();
    if (result !== null && typeof result === 'object' && 'ok' in result) {
      if (result.ok === true && response.ok && 'data' in result) {
        const parsed = webPushStatusSchema.safeParse(result.data);
        if (parsed.success) return { ok: true, data: parsed.data };
      }
      if (
        result.ok === false &&
        'code' in result &&
        typeof result.code === 'string' &&
        Object.hasOwn(WEBPUSH_ERROR_STATUS, result.code)
      )
        return { ok: false, code: result.code as WebPushError };
    }
  } catch {
    // Never log browser endpoint/key material, status payloads or credentials.
  }
  return { ok: false, code: 'UNAVAILABLE' };
}

function bounded<T>(promise: Promise<T>): Promise<T> {
  let timeout: ReturnType<typeof setTimeout>;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timeout = setTimeout(
        () => reject(new Error('WEBPUSH_BROWSER_TIMEOUT')),
        WEBPUSH_CLIENT.workerTimeoutMs,
      );
    }),
  ]).finally(() => clearTimeout(timeout));
}
function ownRegistration(registration: ServiceWorkerRegistration | undefined) {
  return registration?.active?.scriptURL ===
    new URL(PWA.workerUrl, window.location.origin).href
    ? registration
    : undefined;
}
async function registration(wait: boolean) {
  const current = ownRegistration(
    await bounded(navigator.serviceWorker.getRegistration(PWA.scope)),
  );
  if (current || !wait) return current;
  return ownRegistration(await bounded(navigator.serviceWorker.ready));
}
async function workerSupportsPush(
  registered: ServiceWorkerRegistration,
): Promise<boolean> {
  const worker = registered.active;
  if (
    !worker ||
    registered.waiting ||
    registered.installing ||
    typeof MessageChannel === 'undefined'
  )
    return false;
  const channel = new MessageChannel();
  let timer: ReturnType<typeof setTimeout>;
  try {
    return await new Promise<boolean>((resolve) => {
      timer = setTimeout(
        () => resolve(false),
        WEBPUSH_CLIENT.capabilityTimeoutMs,
      );
      channel.port1.onmessage = (event: MessageEvent<unknown>) => {
        const value = event.data;
        resolve(
          value !== null &&
            typeof value === 'object' &&
            'type' in value &&
            value.type === WEBPUSH_CLIENT.capabilityResponse &&
            'version' in value &&
            value.version === WEBPUSH_CLIENT.workerVersion &&
            registered.active === worker &&
            !registered.waiting &&
            !registered.installing,
        );
      };
      channel.port1.onmessageerror = () => resolve(false);
      worker.postMessage(WEBPUSH_CLIENT.capabilityRequest, [channel.port2]);
    });
  } catch {
    return false;
  } finally {
    clearTimeout(timer!);
    channel.port1.close();
    channel.port2.close();
  }
}
async function currentSubscription(wait = false) {
  const registered = await registration(wait);
  if (!registered) return { registered, subscription: null };
  const subscription = await bounded(registered.pushManager.getSubscription());
  return { registered, subscription };
}
function data(
  status: WebPushStatus,
  browser: WebPushBrowserState,
  subscription: PushSubscription | null,
): WebPushClientData {
  return {
    status,
    browser: { ...browser, subscriptionPresent: subscription !== null },
  };
}
async function unsubscribe(subscription: PushSubscription) {
  try {
    if (await bounded(subscription.unsubscribe())) return true;
    const current = await currentSubscription();
    return (
      current.subscription === null ||
      current.subscription.endpoint !== subscription.endpoint
    );
  } catch {
    return false;
  }
}

/** Reads capabilities and current session ownership; never requests permission or subscribes. */
export async function readWebPush(
  isCurrent = isCurrentDefault,
): Promise<WebPushClientResult> {
  if (changing || !isCurrent()) return { ok: false, code: 'INTERRUPTED' };
  const version = ++operationVersion;
  const current = () => isCurrent() && operationVersion === version;
  const browser = webPushBrowserState();
  let ownsChangeLock = false;
  try {
    const subscription = browser.supported
      ? (await currentSubscription()).subscription
      : null;
    if (!current()) return { ok: false, code: 'INTERRUPTED' };
    // A browser permission withdrawal is a revocation, not a new consent.
    const denied = browser.permission === 'denied' && subscription !== null;
    if (denied) {
      changing = true;
      ownsChangeLock = true;
    }
    const result = await requestStatus(
      denied ? 'DELETE' : 'POST',
      denied && subscription
        ? { endpoint: subscription.endpoint }
        : { action: 'status', endpoint: subscription?.endpoint ?? null },
    );
    if (!result.ok) return result;
    if (!current()) return { ok: false, code: 'INTERRUPTED' };
    let status = result.data;
    const foreign =
      status.configured && status.deviceId === null && !status.deviceActive;
    const keyChanged =
      subscription !== null &&
      status.configured &&
      status.publicKey !== null &&
      !webPushSubscriptionUsesKey(subscription, status.publicKey);
    // Revocation serializes against newer explicit enrollment. Neither key
    // rotation nor another account's endpoint causes background enrollment.
    if (subscription && (denied || foreign || keyChanged)) {
      changing = true;
      ownsChangeLock = true;
      if (keyChanged && !denied && !foreign) {
        const revoked = await requestStatus('DELETE', {
          endpoint: subscription.endpoint,
        });
        if (!revoked.ok) return revoked;
        status = revoked.data;
      }
      const cleaned = await unsubscribe(subscription);
      const next = data(
        status,
        { ...browser, needsRenewal: keyChanged },
        cleaned ? null : subscription,
      );
      return cleaned
        ? { ok: true, data: next }
        : { ok: false, code: 'BROWSER_CLEANUP_REQUIRED', data: next };
    }
    return { ok: true, data: data(status, browser, subscription) };
  } catch {
    return { ok: false, code: 'BROWSER_UNAVAILABLE' };
  } finally {
    if (ownsChangeLock) changing = false;
  }
}

export function decodeWebPushPublicKey(
  value: string,
): Uint8Array<ArrayBuffer> | null {
  try {
    if (!/^[A-Za-z0-9_-]{87}$/.test(value)) return null;
    const decoded = Uint8Array.from(
      atob(value.replace(/-/g, '+').replace(/_/g, '/')),
      (character) => character.charCodeAt(0),
    );
    return decoded.length === WEBPUSH_CLIENT.publicKeyBytes &&
      decoded[0] === WEBPUSH_CLIENT.publicKeyPrefix
      ? decoded
      : null;
  } catch {
    return null;
  }
}

export function webPushSubscriptionUsesKey(
  subscription: PushSubscription,
  publicKey: string,
): boolean {
  const expected = decodeWebPushPublicKey(publicKey);
  const actual = subscription.options?.applicationServerKey;
  if (!expected || !actual) return false;
  try {
    const bytes = new Uint8Array(actual);
    return (
      bytes.length === expected.length &&
      bytes.every((value, index) => value === expected[index])
    );
  } catch {
    return false;
  }
}

/** Only call from an explicit checked-consent button action. */
export async function enableWebPush(
  status: WebPushStatus,
  isCurrent = isCurrentDefault,
): Promise<WebPushClientResult> {
  if (changing || !isCurrent()) return { ok: false, code: 'INTERRUPTED' };
  const browser = webPushBrowserState();
  if (browser.installRequired) return { ok: false, code: 'INSTALL_REQUIRED' };
  if (!browser.supported) return { ok: false, code: 'BROWSER_UNSUPPORTED' };
  if (browser.permission === 'denied')
    return { ok: false, code: 'PERMISSION_DENIED' };
  const publicKey = status.publicKey
    ? decodeWebPushPublicKey(status.publicKey)
    : null;
  if (!status.configured || !status.consentVersion || !publicKey)
    return { ok: false, code: 'SETUP_NOT_READY' };
  changing = true;
  operationVersion += 1;
  try {
    // The permission invocation stays before the first await; user activation
    // is not consumed by status I/O, worker readiness or an automatic effect.
    const permission =
      browser.permission === 'default'
        ? await Notification.requestPermission()
        : browser.permission;
    if (!isCurrent()) return { ok: false, code: 'INTERRUPTED' };
    if (permission !== 'granted')
      return {
        ok: false,
        code:
          permission === 'denied'
            ? 'PERMISSION_DENIED'
            : 'PERMISSION_DISMISSED',
      };
    const current = await currentSubscription(true);
    if (!isCurrent()) return { ok: false, code: 'INTERRUPTED' };
    if (!current.registered) return { ok: false, code: 'BROWSER_UNAVAILABLE' };
    if (!(await workerSupportsPush(current.registered)))
      return { ok: false, code: 'WORKER_UPDATE_REQUIRED' };
    if (!isCurrent()) return { ok: false, code: 'INTERRUPTED' };
    let subscription = current.subscription;
    if (subscription) {
      const existing = await requestStatus('POST', {
        action: 'status',
        endpoint: subscription.endpoint,
      });
      if (!existing.ok) return existing;
      if (!isCurrent()) return { ok: false, code: 'INTERRUPTED' };
      if (
        !existing.data.configured ||
        existing.data.publicKey !== status.publicKey ||
        existing.data.consentVersion !== status.consentVersion
      )
        return {
          ok: false,
          code: 'CONFLICT',
          data: data(
            existing.data,
            {
              ...webPushBrowserState(),
              needsRenewal: existing.data.publicKey !== status.publicKey,
            },
            subscription,
          ),
        };

      if (
        existing.data.deviceActive &&
        existing.data.webpushEnabled &&
        existing.data.newMessage &&
        webPushSubscriptionUsesKey(subscription, status.publicKey!)
      )
        return {
          ok: true,
          data: data(existing.data, webPushBrowserState(), subscription),
        };
      if (
        !existing.data.deviceActive ||
        !webPushSubscriptionUsesKey(subscription, status.publicKey!)
      ) {
        const revoked = await requestStatus('DELETE', {
          endpoint: subscription.endpoint,
        });
        if (!revoked.ok) return revoked;
        if (!(await unsubscribe(subscription)))
          return {
            ok: false,
            code: 'BROWSER_CLEANUP_REQUIRED',
            data: data(revoked.data, webPushBrowserState(), subscription),
          };
        subscription = null;
      }
    }
    if (!isCurrent()) return { ok: false, code: 'INTERRUPTED' };
    if (!subscription) {
      subscription = await bounded(
        current.registered.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: publicKey,
        }),
      );
      if (!isCurrent()) {
        await unsubscribe(subscription);
        return { ok: false, code: 'INTERRUPTED' };
      }
    }
    // Browser JSON includes expirationTime, which is intentionally not sent.
    const json = subscription.toJSON();
    const parsed = webPushSubscriptionSchema.safeParse({
      endpoint: json.endpoint,
      keys: json.keys,
    });
    if (!parsed.success) return { ok: false, code: 'BROWSER_UNAVAILABLE' };
    const payload = parsed.data;
    const result = await requestStatus('POST', {
      action: 'subscribe',
      applicationServerKey: status.publicKey,
      subscription: payload,
      consentVersion: status.consentVersion,
      confirmed: true,
    });
    return result.ok
      ? {
          ok: true,
          data: data(result.data, webPushBrowserState(), subscription),
        }
      : result;
  } catch {
    return { ok: false, code: 'BROWSER_UNAVAILABLE' };
  } finally {
    changing = false;
  }
}

export async function disableWebPush(
  isCurrent = isCurrentDefault,
): Promise<WebPushClientResult> {
  if (changing || !isCurrent()) return { ok: false, code: 'INTERRUPTED' };
  changing = true;
  operationVersion += 1;
  try {
    const browser = webPushBrowserState();
    const subscription = browser.supported
      ? (await currentSubscription()).subscription
      : null;
    if (!isCurrent()) return { ok: false, code: 'INTERRUPTED' };
    if (!subscription) {
      const result = await requestStatus('POST', {
        action: 'status',
        endpoint: null,
      });
      return result.ok
        ? { ok: true, data: data(result.data, browser, null) }
        : result;
    }
    // Never claim disabled before the durable server revocation succeeds.
    const result = await requestStatus('DELETE', {
      endpoint: subscription.endpoint,
    });
    if (!result.ok) return result;
    const cleaned = await unsubscribe(subscription);
    const next = data(
      result.data,
      webPushBrowserState(),
      cleaned ? null : subscription,
    );
    return cleaned
      ? { ok: true, data: next }
      : { ok: false, code: 'BROWSER_CLEANUP_REQUIRED', data: next };
  } catch {
    return { ok: false, code: 'BROWSER_UNAVAILABLE' };
  } finally {
    changing = false;
  }
}
