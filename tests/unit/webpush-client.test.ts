import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  decodeWebPushPublicKey,
  disableWebPush,
  enableWebPush,
  readWebPush,
  webPushBrowserState,
} from '@/client/webpush';
import { PWA } from '@/config/pwa';
import { routes } from '@/config/routes';
import type { WebPushStatus } from '@/config/webpush';
import { WEBPUSH_CLIENT } from '@/config/webpush-client';

const key = btoa(String.fromCharCode(4, ...new Array<number>(64).fill(1)))
  .replace(/\+/g, '-')
  .replace(/\//g, '_')
  .replace(/=/g, '');
const status: WebPushStatus = {
  configured: true,
  publicKey: key,
  consentVersion: 'test-v1',
  webpushEnabled: false,
  newMessage: false,
  deviceId: null,
  deviceActive: false,
};
const on: WebPushStatus = {
  ...status,
  webpushEnabled: true,
  newMessage: true,
  deviceId: '00000000-0000-4000-8000-000000000001',
  deviceActive: true,
};
let endpoint = 'https://fcm.googleapis.com/wp/synthetic-only';
let subscription: PushSubscription | null;
let notification: {
  permission: NotificationPermission;
  requestPermission: ReturnType<typeof vi.fn>;
};
let manager: {
  getSubscription: ReturnType<typeof vi.fn>;
  subscribe: ReturnType<typeof vi.fn>;
};
let worker: {
  getRegistration: ReturnType<typeof vi.fn>;
  ready: Promise<ServiceWorkerRegistration>;
};
let network: ReturnType<typeof vi.fn>;
let unsubscribe: ReturnType<typeof vi.fn>;
function sub() {
  return {
    endpoint,
    options: {
      userVisibleOnly: true,
      applicationServerKey: decodeWebPushPublicKey(key)?.buffer,
    },
    unsubscribe,
    toJSON: () => ({
      endpoint,
      expirationTime: null,
      keys: { p256dh: key, auth: 'A'.repeat(22) },
    }),
  } as unknown as PushSubscription;
}
function response(data = status) {
  return new Response(JSON.stringify({ ok: true, data }));
}
function properties(object: object, values: Record<string, unknown>) {
  for (const [name, value] of Object.entries(values))
    Object.defineProperty(object, name, { configurable: true, value });
}
beforeEach(() => {
  notification = {
    permission: 'default',
    requestPermission: vi.fn().mockImplementation(async () => {
      notification.permission = 'granted';
      return 'granted';
    }),
  };
  vi.stubGlobal('Notification', notification);
  vi.stubGlobal('PushManager', class {});
  vi.stubGlobal(
    'MessageChannel',
    class {
      port1 = {
        onmessage: null as ((event: { data: unknown }) => void) | null,
        onmessageerror: null,
        close: vi.fn(),
      };
      port2 = {
        postMessage: (data: unknown) => this.port1.onmessage?.({ data }),
        close: vi.fn(),
      };
    },
  );
  vi.stubGlobal('isSecureContext', true);
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false }));
  vi.stubGlobal('navigator', Object.create(navigator));
  properties(navigator, {
    userAgent: 'Mozilla/5.0 desktop',
    platform: 'Linux',
    maxTouchPoints: 0,
  });
  subscription = null;
  endpoint = 'https://fcm.googleapis.com/wp/synthetic-only';
  unsubscribe = vi.fn().mockImplementation(async () => {
    subscription = null;
    return true;
  });
  manager = {
    getSubscription: vi.fn().mockImplementation(async () => subscription),
    subscribe: vi.fn().mockImplementation(async () => {
      subscription = sub();
      return subscription;
    }),
  };
  const registration = {
    active: {
      scriptURL: new URL(PWA.workerUrl, window.location.origin).href,
      postMessage: (_value: string, ports: MessagePort[]) =>
        ports[0]?.postMessage({
          type: WEBPUSH_CLIENT.capabilityResponse,
          version: WEBPUSH_CLIENT.workerVersion,
        }),
    },
    pushManager: manager,
  } as unknown as ServiceWorkerRegistration;
  worker = {
    getRegistration: vi.fn().mockResolvedValue(registration),
    ready: Promise.resolve(registration),
  };
  vi.stubGlobal(
    'navigator',
    Object.create(navigator, {
      serviceWorker: { configurable: true, value: worker },
    }),
  );
  network = vi.fn().mockImplementation(async () => response());
  vi.stubGlobal('fetch', network);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it('observes without requesting permission, subscribing, or persisting any material', async () => {
  expect(await readWebPush()).toMatchObject({
    ok: true,
    data: {
      status,
      browser: {
        supported: true,
        permission: 'default',
        subscriptionPresent: false,
      },
    },
  });
  expect(notification.requestPermission).not.toHaveBeenCalled();
  expect(manager.subscribe).not.toHaveBeenCalled();
  expect(network).toHaveBeenCalledWith(
    routes.pushSubscription,
    expect.objectContaining({
      method: 'POST',
      credentials: 'same-origin',
      redirect: 'error',
      cache: 'no-store',
      body: JSON.stringify({ action: 'status', endpoint: null }),
    }),
  );
});
it('passes known endpoint only in no-store JSON body, not URL', async () => {
  subscription = sub();
  await readWebPush();
  expect(network.mock.calls[0]![0]).toBe(routes.pushSubscription);
  expect(JSON.parse(network.mock.calls[0]![1].body)).toEqual({
    action: 'status',
    endpoint,
  });
});
it('revokes a foreign-account browser endpoint on authoritative unowned status without opt-in', async () => {
  subscription = sub();
  expect(await readWebPush()).toMatchObject({
    ok: true,
    data: { browser: { subscriptionPresent: false } },
  });
  expect(unsubscribe).toHaveBeenCalledOnce();
  expect(manager.subscribe).not.toHaveBeenCalled();
  expect(notification.requestPermission).not.toHaveBeenCalled();
});
it('does not revoke current active ownership on ordinary reads', async () => {
  subscription = sub();
  network.mockResolvedValue(response(on));
  expect(await readWebPush()).toMatchObject({
    ok: true,
    data: { browser: { subscriptionPresent: true } },
  });
  expect(unsubscribe).not.toHaveBeenCalled();
});
it('does not treat unconfigured status as proof of foreign ownership', async () => {
  subscription = sub();
  network.mockResolvedValue(response({ ...status, configured: false }));
  await readWebPush();
  expect(unsubscribe).not.toHaveBeenCalled();
});
it('keeps same-device inactive consent state until explicit repair', async () => {
  subscription = sub();
  network.mockResolvedValue(response({ ...status, deviceId: on.deviceId }));
  await readWebPush();
  expect(unsubscribe).not.toHaveBeenCalled();
});
it('does not revoke on interrupted stale account status', async () => {
  subscription = sub();
  let current = true;
  network.mockImplementation(async () => {
    current = false;
    return response();
  });
  expect(await readWebPush(() => current)).toEqual({
    ok: false,
    code: 'INTERRUPTED',
  });
  expect(unsubscribe).not.toHaveBeenCalled();
});
it('reports foreign local cleanup failure without enrolling a new account', async () => {
  subscription = sub();
  unsubscribe.mockResolvedValue(false);
  expect(await readWebPush()).toMatchObject({
    ok: false,
    code: 'BROWSER_CLEANUP_REQUIRED',
  });
  expect(manager.subscribe).not.toHaveBeenCalled();
});
it('a newer explicit operation invalidates a slower observation before foreign cleanup', async () => {
  notification.permission = 'granted';
  subscription = sub();
  let finish!: (value: Response) => void;
  network
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValue(response(on));
  const oldRead = readWebPush();
  await vi.waitFor(() => expect(network).toHaveBeenCalledOnce());
  expect(await enableWebPush(status)).toMatchObject({ ok: true });
  finish(response());
  expect(await oldRead).toEqual({ ok: false, code: 'INTERRUPTED' });
  expect(unsubscribe).not.toHaveBeenCalled();
});
it('requests permission synchronously before worker or HTTP await and submits narrowed browser material', async () => {
  network.mockResolvedValue(response(on));
  const pending = enableWebPush(status);
  expect(notification.requestPermission).toHaveBeenCalledOnce();
  expect(worker.getRegistration).not.toHaveBeenCalled();
  expect(await pending).toMatchObject({
    ok: true,
    data: {
      status: on,
      browser: { permission: 'granted', subscriptionPresent: true },
    },
  });
  expect(manager.subscribe).toHaveBeenCalledWith({
    userVisibleOnly: true,
    applicationServerKey: decodeWebPushPublicKey(key),
  });
  expect(JSON.parse(network.mock.calls[0]![1].body)).toEqual({
    action: 'subscribe',
    applicationServerKey: key,
    subscription: { endpoint, keys: { p256dh: key, auth: 'A'.repeat(22) } },
    consentVersion: status.consentVersion,
    confirmed: true,
  });
});
it('recovers a response-lost successful registration from status without replacement or second registration', async () => {
  notification.permission = 'granted';
  subscription = sub();
  network.mockResolvedValue(response(on));
  expect(await enableWebPush(status)).toMatchObject({
    ok: true,
    data: { status: on },
  });
  expect(network).toHaveBeenCalledOnce();
  expect(manager.subscribe).not.toHaveBeenCalled();
  expect(unsubscribe).not.toHaveBeenCalled();
});
it('replaces an inactive other-session endpoint only on explicit enable', async () => {
  notification.permission = 'granted';
  subscription = sub();
  network.mockResolvedValueOnce(response()).mockResolvedValueOnce(response(on));
  expect(await enableWebPush(status)).toMatchObject({ ok: true });
  expect(unsubscribe).toHaveBeenCalledOnce();
  expect(manager.subscribe).toHaveBeenCalledOnce();
  expect(network).toHaveBeenCalledTimes(3);
});
it('rejects contradictory active-with-disabled-preferences status without destructive inference', async () => {
  notification.permission = 'granted';
  subscription = sub();
  network
    .mockResolvedValueOnce(response({ ...on, webpushEnabled: false }))
    .mockResolvedValueOnce(response(on));
  expect(await enableWebPush(status)).toMatchObject({
    ok: false,
    code: 'UNAVAILABLE',
  });
  expect(unsubscribe).not.toHaveBeenCalled();
  expect(manager.subscribe).not.toHaveBeenCalled();
  expect(network).toHaveBeenCalledTimes(1);
});
it('repairs a preference-inactive owned device only after explicit reconsent and durable revoke', async () => {
  notification.permission = 'granted';
  subscription = sub();
  const inactive = { ...on, deviceActive: false, webpushEnabled: false };
  network
    .mockResolvedValueOnce(response(inactive))
    .mockResolvedValueOnce(response(inactive))
    .mockResolvedValueOnce(response(on));
  expect(await enableWebPush(status)).toMatchObject({
    ok: true,
    data: { status: on },
  });
  expect(network).toHaveBeenCalledTimes(3);
  expect(JSON.parse(network.mock.calls[1]![1].body)).toEqual({ endpoint });
  expect(network.mock.calls[1]![1].method).toBe('DELETE');
  expect(unsubscribe).toHaveBeenCalledOnce();
  expect(manager.subscribe).toHaveBeenCalledOnce();
});
it('does not destroy an existing endpoint after status transport failure', async () => {
  notification.permission = 'granted';
  subscription = sub();
  network.mockRejectedValue(new Error('offline'));
  expect(await enableWebPush(status)).toEqual({
    ok: false,
    code: 'UNAVAILABLE',
  });
  expect(unsubscribe).not.toHaveBeenCalled();
  expect(manager.subscribe).not.toHaveBeenCalled();
});
it('does not enroll if inactive endpoint browser unsubscribe fails', async () => {
  notification.permission = 'granted';
  subscription = sub();
  unsubscribe.mockResolvedValue(false);
  expect(await enableWebPush(status)).toMatchObject({
    ok: false,
    code: 'BROWSER_CLEANUP_REQUIRED',
  });
  expect(manager.subscribe).not.toHaveBeenCalled();
});
it('revokes server first and cleans browser only after durable success', async () => {
  notification.permission = 'granted';
  subscription = sub();
  expect(await disableWebPush()).toMatchObject({
    ok: true,
    data: { browser: { subscriptionPresent: false } },
  });
  expect(JSON.parse(network.mock.calls[0]![1].body)).toEqual({ endpoint });
  expect(network.mock.calls[0]![1].method).toBe('DELETE');
  expect(network.mock.invocationCallOrder[0]).toBeLessThan(
    unsubscribe.mock.invocationCallOrder[0]!,
  );
});
it('keeps browser connection when durable server revoke fails', async () => {
  subscription = sub();
  network.mockResolvedValue(
    new Response(JSON.stringify({ ok: false, code: 'UNAVAILABLE' }), {
      status: 503,
    }),
  );
  expect(await disableWebPush()).toEqual({ ok: false, code: 'UNAVAILABLE' });
  expect(unsubscribe).not.toHaveBeenCalled();
});
it('reports durable server disabled separately from incomplete browser cleanup', async () => {
  subscription = sub();
  unsubscribe.mockRejectedValue(new Error('browser'));
  expect(await disableWebPush()).toMatchObject({
    ok: false,
    code: 'BROWSER_CLEANUP_REQUIRED',
    data: { status, browser: { subscriptionPresent: true } },
  });
});
it('safely accepts false unsubscribe if browser already removed subscription', async () => {
  subscription = sub();
  unsubscribe.mockImplementation(async () => {
    subscription = null;
    return false;
  });
  expect(await disableWebPush()).toMatchObject({
    ok: true,
    data: { browser: { subscriptionPresent: false } },
  });
});
it('withdrawn browser permission revokes known server endpoint without asking or enrolling', async () => {
  notification.permission = 'denied';
  subscription = sub();
  expect(await readWebPush()).toMatchObject({
    ok: true,
    data: { browser: { permission: 'denied', subscriptionPresent: false } },
  });
  expect(network.mock.calls[0]![1].method).toBe('DELETE');
  expect(notification.requestPermission).not.toHaveBeenCalled();
  expect(manager.subscribe).not.toHaveBeenCalled();
});
it.each(['denied', 'default'] as const)(
  'stops after permission %s',
  async (permission) => {
    notification.requestPermission.mockResolvedValue(permission);
    expect(await enableWebPush(status)).toEqual({
      ok: false,
      code:
        permission === 'denied' ? 'PERMISSION_DENIED' : 'PERMISSION_DISMISSED',
    });
    expect(manager.subscribe).not.toHaveBeenCalled();
    expect(network).not.toHaveBeenCalled();
  },
);
it('does not request already denied permission', async () => {
  notification.permission = 'denied';
  expect(await enableWebPush(status)).toEqual({
    ok: false,
    code: 'PERMISSION_DENIED',
  });
  expect(notification.requestPermission).not.toHaveBeenCalled();
});
it('does not request permission when unconfigured', async () => {
  expect(await enableWebPush({ ...status, configured: false })).toEqual({
    ok: false,
    code: 'SETUP_NOT_READY',
  });
  expect(notification.requestPermission).not.toHaveBeenCalled();
});
it('requires iOS installed mode independent from API presence', async () => {
  properties(navigator, { userAgent: 'iPhone', platform: 'iPhone' });
  expect(webPushBrowserState()).toMatchObject({
    supported: true,
    installRequired: true,
  });
  expect(await enableWebPush(status)).toEqual({
    ok: false,
    code: 'INSTALL_REQUIRED',
  });
  expect(notification.requestPermission).not.toHaveBeenCalled();
});
it('detects touch iPad desktop UA as installation guidance only', () => {
  properties(navigator, {
    userAgent: 'Macintosh',
    platform: 'MacIntel',
    maxTouchPoints: 5,
  });
  expect(webPushBrowserState().installRequired).toBe(true);
});
it('allows standalone iOS capabilities', () => {
  properties(navigator, { userAgent: 'iPhone', platform: 'iPhone' });
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true }));
  expect(webPushBrowserState()).toMatchObject({
    supported: true,
    installRequired: false,
  });
});
it('fails closed in an insecure context without worker I/O', async () => {
  vi.stubGlobal('isSecureContext', false);
  expect(await enableWebPush(status)).toEqual({
    ok: false,
    code: 'BROWSER_UNSUPPORTED',
  });
  await readWebPush();
  expect(worker.getRegistration).not.toHaveBeenCalled();
});
it('rejects another worker script without subscribing', async () => {
  const registration = {
    active: { scriptURL: 'https://other.example/sw.js' },
    pushManager: manager,
  };
  worker.getRegistration.mockResolvedValue(registration);
  worker.ready = Promise.resolve(
    registration as unknown as ServiceWorkerRegistration,
  );
  expect(await enableWebPush(status)).toEqual({
    ok: false,
    code: 'BROWSER_UNAVAILABLE',
  });
  expect(manager.subscribe).not.toHaveBeenCalled();
});
it('serializes repeated user enables while permission is pending', async () => {
  let finish!: (value: string) => void;
  notification.requestPermission.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const first = enableWebPush(status);
  expect(await enableWebPush(status)).toEqual({
    ok: false,
    code: 'INTERRUPTED',
  });
  finish('default');
  await first;
  expect(notification.requestPermission).toHaveBeenCalledOnce();
});
it('stops deferred permission after a newer navigation/account screen', async () => {
  let finish!: (value: string) => void;
  let current = true;
  notification.requestPermission.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const pending = enableWebPush(status, () => current);
  current = false;
  finish('granted');
  expect(await pending).toEqual({ ok: false, code: 'INTERRUPTED' });
  expect(worker.getRegistration).not.toHaveBeenCalled();
});
it('cleans a newly-created subscription after interruption before registration', async () => {
  notification.permission = 'granted';
  let current = true;
  manager.subscribe.mockImplementation(async () => {
    subscription = sub();
    current = false;
    return subscription;
  });
  expect(await enableWebPush(status, () => current)).toEqual({
    ok: false,
    code: 'INTERRUPTED',
  });
  expect(unsubscribe).toHaveBeenCalledOnce();
  expect(network).not.toHaveBeenCalled();
});
it('bounds a worker readiness that never resolves', async () => {
  vi.useFakeTimers();
  notification.permission = 'granted';
  worker.getRegistration.mockResolvedValue(undefined);
  worker.ready = new Promise(() => {});
  const pending = enableWebPush(status);
  await vi.advanceTimersByTimeAsync(WEBPUSH_CLIENT.workerTimeoutMs);
  expect(await pending).toEqual({ ok: false, code: 'BROWSER_UNAVAILABLE' });
});
it.each([
  {},
  { ok: true, data: { ...status, surprise: true } },
  { ok: false, code: 'invented' },
])('rejects malformed API result %j', async (body) => {
  network.mockResolvedValue(new Response(JSON.stringify(body)));
  expect(await readWebPush()).toEqual({ ok: false, code: 'UNAVAILABLE' });
});
it('never treats error HTTP as successful status', async () => {
  network.mockResolvedValue(
    new Response(JSON.stringify({ ok: true, data: status }), { status: 500 }),
  );
  expect(await readWebPush()).toEqual({ ok: false, code: 'UNAVAILABLE' });
});
it('rejects malformed browser material before registration', async () => {
  manager.subscribe.mockResolvedValue({
    endpoint,
    toJSON: () => ({ endpoint, keys: {} }),
  });
  expect(await enableWebPush(status)).toEqual({
    ok: false,
    code: 'BROWSER_UNAVAILABLE',
  });
  expect(network).not.toHaveBeenCalled();
});
describe('public application key parsing', () => {
  it('decodes the uncompressed P-256 public point framing', () =>
    expect(decodeWebPushPublicKey(key)).toHaveLength(65));
  it.each([
    '',
    'A'.repeat(87),
    key + '=',
    'https://secret.invalid',
    key.slice(1),
  ])('rejects %s', (input) => expect(decodeWebPushPublicKey(input)).toBeNull());
});

it.each(['waiting', 'installing'] as const)(
  'blocks opt-in while a newer worker is %s without changing activation policy',
  async (field) => {
    const registration = await worker.ready;
    Object.defineProperty(registration, field, {
      value: {},
      configurable: true,
    });
    expect(await enableWebPush(status)).toEqual({
      ok: false,
      code: 'WORKER_UPDATE_REQUIRED',
    });
    expect(manager.subscribe).not.toHaveBeenCalled();
    expect(network).not.toHaveBeenCalled();
  },
);
it('bounds an older active worker with no capability listener even when no worker is waiting', async () => {
  const registration = await worker.ready;
  Object.defineProperty(registration.active, 'postMessage', {
    value: vi.fn(),
    configurable: true,
  });
  vi.useFakeTimers();
  const pending = enableWebPush(status);
  await vi.advanceTimersByTimeAsync(WEBPUSH_CLIENT.capabilityTimeoutMs);
  expect(await pending).toEqual({ ok: false, code: 'WORKER_UPDATE_REQUIRED' });
  expect(manager.subscribe).not.toHaveBeenCalled();
});
it('does not accept malformed or future worker capability responses', async () => {
  const registration = await worker.ready;
  Object.defineProperty(registration.active, 'postMessage', {
    value: (_value: string, ports: MessagePort[]) =>
      ports[0]?.postMessage({
        type: WEBPUSH_CLIENT.capabilityResponse,
        version: 999,
      }),
    configurable: true,
  });
  expect(await enableWebPush(status)).toEqual({
    ok: false,
    code: 'WORKER_UPDATE_REQUIRED',
  });
  expect(manager.subscribe).not.toHaveBeenCalled();
});
it('does not claim a capability handshake when messaging throws', async () => {
  const registration = await worker.ready;
  Object.defineProperty(registration.active, 'postMessage', {
    value: () => {
      throw new Error('gone');
    },
    configurable: true,
  });
  expect(await enableWebPush(status)).toEqual({
    ok: false,
    code: 'WORKER_UPDATE_REQUIRED',
  });
});
it('rejects a capability reply from a worker replaced during its response', async () => {
  const registration = await worker.ready;
  Object.defineProperty(registration.active, 'postMessage', {
    value: (_value: string, ports: MessagePort[]) => {
      Object.defineProperty(registration, 'active', {
        value: {},
        configurable: true,
      });
      ports[0]?.postMessage({
        type: WEBPUSH_CLIENT.capabilityResponse,
        version: WEBPUSH_CLIENT.workerVersion,
      });
    },
    configurable: true,
  });
  expect(await enableWebPush(status)).toEqual({
    ok: false,
    code: 'WORKER_UPDATE_REQUIRED',
  });
});
it('VAPID rotation revokes old key-bound server device and native endpoint without auto enrollment', async () => {
  subscription = sub();
  notification.permission = 'granted';
  const rotated = btoa(String.fromCharCode(4, ...new Array<number>(64).fill(2)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
  network
    .mockResolvedValueOnce(response({ ...on, publicKey: rotated }))
    .mockResolvedValueOnce(response({ ...status, publicKey: rotated }));
  expect(await readWebPush()).toMatchObject({
    ok: true,
    data: { browser: { needsRenewal: true, subscriptionPresent: false } },
  });
  expect(network.mock.calls.map((call) => call[1].method)).toEqual([
    'POST',
    'DELETE',
  ]);
  expect(unsubscribe).toHaveBeenCalledOnce();
  expect(manager.subscribe).not.toHaveBeenCalled();
  expect(notification.requestPermission).not.toHaveBeenCalled();
});
it('does not native-unsubscribe a rotated key if durable revoke fails', async () => {
  subscription = sub();
  network
    .mockResolvedValueOnce(response({ ...on, publicKey: 'B'.repeat(87) }))
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: false, code: 'UNAVAILABLE' }), {
        status: 503,
      }),
    );
  expect(await readWebPush()).toEqual({ ok: false, code: 'UNAVAILABLE' });
  expect(unsubscribe).not.toHaveBeenCalled();
});
it('explicit repair of a sameowner inactive device revokes server before native replacement', async () => {
  subscription = sub();
  notification.permission = 'granted';
  network
    .mockResolvedValueOnce(response({ ...status, deviceId: on.deviceId }))
    .mockResolvedValueOnce(response())
    .mockResolvedValueOnce(response(on));
  expect(await enableWebPush(status)).toMatchObject({ ok: true });
  expect(network.mock.calls.map((call) => call[1].method)).toEqual([
    'POST',
    'DELETE',
    'POST',
  ]);
  expect(network.mock.invocationCallOrder[1]).toBeLessThan(
    unsubscribe.mock.invocationCallOrder[0]!,
  );
  expect(unsubscribe.mock.invocationCallOrder[0]).toBeLessThan(
    manager.subscribe.mock.invocationCallOrder[0]!,
  );
});
it('explicit repair stops without replacing browser endpoint when server revoke fails', async () => {
  subscription = sub();
  notification.permission = 'granted';
  network
    .mockResolvedValueOnce(response({ ...status, deviceId: on.deviceId }))
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: false, code: 'UNAVAILABLE' }), {
        status: 503,
      }),
    );
  expect(await enableWebPush(status)).toEqual({
    ok: false,
    code: 'UNAVAILABLE',
  });
  expect(unsubscribe).not.toHaveBeenCalled();
  expect(manager.subscribe).not.toHaveBeenCalled();
});
it('missing browser application-server key is a repair state, not assumed compatible', async () => {
  subscription = sub();
  Object.defineProperty(subscription, 'options', {
    value: { applicationServerKey: null },
  });
  network.mockResolvedValueOnce(response(on)).mockResolvedValueOnce(response());
  expect(await readWebPush()).toMatchObject({
    ok: true,
    data: { browser: { needsRenewal: true } },
  });
  expect(unsubscribe).toHaveBeenCalledOnce();
});
it('fresh status config change refuses stale key enrollment and requires retry with renewed status', async () => {
  subscription = sub();
  notification.permission = 'granted';
  const rotated = btoa(String.fromCharCode(4, ...new Array<number>(64).fill(2)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
  network.mockResolvedValue(response({ ...on, publicKey: rotated }));
  expect(await enableWebPush(status)).toMatchObject({
    ok: false,
    code: 'CONFLICT',
    data: { status: { publicKey: rotated }, browser: { needsRenewal: true } },
  });
  expect(unsubscribe).not.toHaveBeenCalled();
  expect(manager.subscribe).not.toHaveBeenCalled();
  expect(network).toHaveBeenCalledOnce();
});
it('does not submit stale consent version when fresh current endpoint status changed', async () => {
  subscription = sub();
  notification.permission = 'granted';
  network.mockResolvedValue(response({ ...on, consentVersion: 'renewed-v2' }));
  expect(await enableWebPush(status)).toMatchObject({
    ok: false,
    code: 'CONFLICT',
  });
  expect(unsubscribe).not.toHaveBeenCalled();
  expect(manager.subscribe).not.toHaveBeenCalled();
});
