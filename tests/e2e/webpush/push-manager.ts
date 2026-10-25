import { randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';
import {
  WEBPUSH_CI_ENV,
  WEBPUSH_CI_SUBSCRIPTION,
} from '../../../scripts/webpush-local-fixtures.mjs';
import { WEBPUSH_CLIENT } from '../../../src/config/webpush-client';

type Snapshot = {
  permission: NotificationPermission;
  permissionRequests: number;
  subscriptions: number;
  unsubscriptions: number;
  active: boolean;
  endpoint: string;
  userVisibleOnly: boolean | null;
  applicationServerKey: string | null;
  capabilityRequests: number;
  unsafeWorkerMessages: number;
};
type WorkerMode = 'native' | 'waiting' | 'installing' | 'stale';
type PushHarness = {
  snapshot(): Snapshot;
  permission(value: NotificationPermission): void;
  answerPermission(value: NotificationPermission): void;
  failSubscribe(value: boolean): void;
  failUnsubscribe(value: boolean): void;
  applicationServerKey(value: string): void;
  worker(value: WorkerMode): void;
};
declare global {
  interface Window {
    __webpushFixture: PushHarness;
  }
}

// Synthetic browser API contract only: no actual OS permission prompt, browser
// subscription, push provider request, device notification or delivery claim.
// Native service-worker registration still runs, including its script identity.
export async function installPushManager(
  page: Page,
  options: {
    permission?: NotificationPermission;
    answer?: NotificationPermission;
    unsupported?: boolean;
    installed?: boolean;
    ios?: boolean;
    deferPermission?: boolean;
    active?: boolean;
  } = {},
) {
  await page.addInitScript(
    ({ initial, subscription, options, workerCapability }) => {
      const storageKey = '__syntheticWebPushFixture';
      const saved = sessionStorage.getItem(storageKey);
      const state: Snapshot = saved ? JSON.parse(saved) : initial;
      let answer = options.answer ?? 'granted';
      let rejectSubscribe = false;
      let rejectUnsubscribe = false;
      let workerMode: WorkerMode = 'native';
      let resolvePermission: ((value: NotificationPermission) => void) | null =
        null;
      const persist = () =>
        sessionStorage.setItem(storageKey, JSON.stringify(state));
      const decode = (value: string) =>
        Uint8Array.from(
          atob(value.replace(/-/g, '+').replace(/_/g, '/')),
          (character) => character.charCodeAt(0),
        ).buffer;
      const encode = (value: BufferSource | string | null | undefined) => {
        if (typeof value === 'string') return value;
        if (value === null || value === undefined) return null;
        const array = ArrayBuffer.isView(value)
          ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
          : new Uint8Array(value);
        return btoa(String.fromCharCode(...array))
          .replace(/\+/g, '-')
          .replace(/\//g, '_')
          .replace(/=+$/, '');
      };
      const currentSubscription = () => ({
        endpoint: state.endpoint,
        expirationTime: null,
        options: {
          userVisibleOnly: true,
          applicationServerKey: state.applicationServerKey
            ? decode(state.applicationServerKey)
            : null,
        },
        getKey: (name: 'p256dh' | 'auth') => decode(subscription.keys[name]),
        toJSON: () => ({
          endpoint: state.endpoint,
          expirationTime: null,
          keys: subscription.keys,
        }),
        async unsubscribe() {
          state.unsubscriptions++;
          persist();
          if (rejectUnsubscribe)
            throw new DOMException(
              'Synthetic unsubscribe failure',
              'AbortError',
            );
          state.active = false;
          persist();
          return true;
        },
      });
      const manager = {
        async getSubscription() {
          return state.active ? currentSubscription() : null;
        },
        async permissionState() {
          return state.permission === 'default' ? 'prompt' : state.permission;
        },
        async subscribe(config: PushSubscriptionOptionsInit) {
          state.subscriptions++;
          state.userVisibleOnly = config.userVisibleOnly ?? null;
          state.applicationServerKey = encode(config.applicationServerKey);
          persist();
          if (rejectSubscribe)
            throw new DOMException('Synthetic subscribe failure', 'AbortError');
          if (state.permission !== 'granted')
            throw new DOMException(
              'Synthetic permission denied',
              'NotAllowedError',
            );
          if (!state.active)
            state.endpoint = `${initial.endpoint}-${state.subscriptions}`;
          state.active = true;
          persist();
          return currentSubscription();
        },
      };
      Object.defineProperty(
        ServiceWorkerRegistration.prototype,
        'pushManager',
        {
          configurable: true,
          get: () => manager,
        },
      );
      // Leave the real worker untouched for ordinary cases. Failure cases can
      // simulate lifecycle/version mismatches; they never activate another
      // worker, call skipWaiting, or synthesize a successful capability reply.
      for (const property of ['waiting', 'installing'] as const) {
        const descriptor = Object.getOwnPropertyDescriptor(
          ServiceWorkerRegistration.prototype,
          property,
        );
        Object.defineProperty(ServiceWorkerRegistration.prototype, property, {
          configurable: true,
          get(this: ServiceWorkerRegistration) {
            return workerMode === property
              ? this.active
              : descriptor?.get?.call(this);
          },
        });
      }
      const nativePostMessage = ServiceWorker.prototype.postMessage;
      Object.defineProperty(ServiceWorker.prototype, 'postMessage', {
        configurable: true,
        value(
          this: ServiceWorker,
          message: unknown,
          transferOrOptions?: Transferable[] | StructuredSerializeOptions,
        ) {
          if (
            message === 'SKIP_WAITING' ||
            (typeof message === 'object' &&
              message !== null &&
              'type' in message &&
              message.type === 'SKIP_WAITING')
          )
            state.unsafeWorkerMessages++;
          if (message === workerCapability.request) {
            state.capabilityRequests++;
            persist();
            if (workerMode === 'stale') {
              const ports = Array.isArray(transferOrOptions)
                ? transferOrOptions
                : transferOrOptions?.transfer;
              const port = ports?.[0];
              if (port instanceof MessagePort)
                port.postMessage({
                  type: workerCapability.response,
                  version: 0,
                });
              return;
            }
          }
          return Reflect.apply(
            nativePostMessage,
            this,
            transferOrOptions === undefined
              ? [message]
              : [message, transferOrOptions],
          );
        },
      });
      Object.defineProperty(Notification, 'permission', {
        configurable: true,
        get: () => state.permission,
      });
      Object.defineProperty(Notification, 'requestPermission', {
        configurable: true,
        value: () => {
          state.permissionRequests++;
          persist();
          if (options.deferPermission)
            return new Promise<NotificationPermission>((resolve) => {
              resolvePermission = resolve;
            });
          state.permission = answer;
          persist();
          return Promise.resolve(answer);
        },
      });
      if (options.unsupported) Reflect.deleteProperty(window, 'PushManager');
      if (options.ios) {
        Object.defineProperty(navigator, 'userAgent', {
          configurable: true,
          value:
            'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1',
        });
        Object.defineProperty(navigator, 'platform', {
          configurable: true,
          value: 'iPhone',
        });
      }
      if (options.installed !== undefined)
        Object.defineProperty(navigator, 'standalone', {
          configurable: true,
          value: options.installed,
        });
      Object.defineProperty(window, '__webpushFixture', {
        configurable: true,
        value: {
          snapshot: () => ({ ...state }),
          permission(value: NotificationPermission) {
            state.permission = value;
            persist();
          },
          answerPermission(value: NotificationPermission) {
            answer = value;
            state.permission = value;
            persist();
            resolvePermission?.(value);
            resolvePermission = null;
          },
          failSubscribe(value: boolean) {
            rejectSubscribe = value;
          },
          failUnsubscribe(value: boolean) {
            rejectUnsubscribe = value;
          },
          applicationServerKey(value: string) {
            state.applicationServerKey = value;
            persist();
          },
          worker(value: WorkerMode) {
            workerMode = value;
          },
        } satisfies PushHarness,
      });
      persist();
    },
    {
      initial: {
        permission: options.permission ?? 'default',
        permissionRequests: 0,
        subscriptions: 0,
        unsubscriptions: 0,
        active: options.active ?? false,
        endpoint: `${WEBPUSH_CI_SUBSCRIPTION.endpoint}-${randomUUID()}`,
        userVisibleOnly: null,
        applicationServerKey: options.active
          ? WEBPUSH_CI_ENV.VAPID_PUBLIC_KEY
          : null,
        capabilityRequests: 0,
        unsafeWorkerMessages: 0,
      } satisfies Snapshot,
      subscription: WEBPUSH_CI_SUBSCRIPTION,
      workerCapability: {
        request: WEBPUSH_CLIENT.capabilityRequest,
        response: WEBPUSH_CLIENT.capabilityResponse,
      },
      options,
    },
  );
}
export async function pushSnapshot(page: Page) {
  return page.evaluate(() => window.__webpushFixture.snapshot());
}
export async function setPermission(page: Page, value: NotificationPermission) {
  await page.evaluate(
    (next) => window.__webpushFixture.permission(next),
    value,
  );
}

export async function waitForPushWorker(page: Page) {
  await page.waitForFunction(async () => {
    const registration = await navigator.serviceWorker.getRegistration('/');
    return (
      registration?.active?.state === 'activated' &&
      !registration.waiting &&
      !registration.installing
    );
  });
}
