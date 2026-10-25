// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  notificationOptions,
  openWebPush,
  showWebPush,
} from '@/worker/webpush';
import { routes } from '@/config/routes';
import { WEBPUSH_CLIENT } from '@/config/webpush-client';
import messages from '@/messages/ko.json';
const id = '00000000-0000-4000-8000-000000000123';
const raw = JSON.stringify({
  version: 1,
  notificationId: id,
  url: routes.subscriptions,
});
it('shows only fixed privacy-safe copy, icon and authenticated destination', async () => {
  const showNotification = vi.fn();
  await showWebPush({ showNotification }, raw);
  expect(showNotification).toHaveBeenCalledWith(
    messages.notifications.pushTitle,
    expect.objectContaining({
      body: messages.notifications.pushBody,
      data: { url: routes.subscriptions },
      tag: `${WEBPUSH_CLIENT.notificationTagPrefix}${id}`,
    }),
  );
});
it('deduplicates browser display by stable outbox notification identity, not false provider exactly-once', () => {
  expect(notificationOptions(raw).tag).toBe(notificationOptions(raw).tag);
  expect(
    notificationOptions(raw.replace(id, '00000000-0000-4000-8000-000000000124'))
      .tag,
  ).not.toBe(notificationOptions(raw).tag);
});
it('ignores arbitrary remote title/body/account/artist fields', () => {
  const options = notificationOptions(
    JSON.stringify({
      version: 1,
      notificationId: id,
      url: routes.subscriptions,
      title: 'private fan',
      body: 'secret message',
      token: 'secret',
    }),
  );
  expect(JSON.stringify(options)).not.toMatch(/private fan|secret/);
});
it.each([
  null,
  '',
  '{',
  JSON.stringify({ version: 9, notificationId: id, url: routes.subscriptions }),
  JSON.stringify({
    version: 1,
    notificationId: id,
    url: 'https://evil.example',
  }),
  JSON.stringify({ version: 1, notificationId: id, url: '//evil.example' }),
  JSON.stringify({
    version: 1,
    notificationId: '../secret',
    url: routes.subscriptions,
  }),
  'x'.repeat(WEBPUSH_CLIENT.payloadLimit + 1),
])(
  'malformed/unsupported input still shows only a generic visible notification: %s',
  (input) => {
    expect(notificationOptions(input)).toMatchObject({
      body: messages.notifications.pushBody,
      data: { url: routes.subscriptions },
      tag: WEBPUSH_CLIENT.fallbackNotificationTag,
    });
  },
);
describe('click destination', () => {
  const origin = 'https://app.example';
  const destination = `${origin}${routes.subscriptions}`;
  it('focuses only an exact existing authenticated destination', async () => {
    const focus = vi.fn();
    const otherFocus = vi.fn();
    const openWindow = vi.fn();
    const matchAll = vi.fn().mockResolvedValue([
      { url: 'https://evil.example', focus: otherFocus },
      { url: destination, focus },
    ]);
    await openWebPush({ matchAll, openWindow } as unknown as Clients, origin);
    expect(focus).toHaveBeenCalledOnce();
    expect(otherFocus).not.toHaveBeenCalled();
    expect(openWindow).not.toHaveBeenCalled();
    expect(matchAll).toHaveBeenCalledWith({
      type: 'window',
      includeUncontrolled: false,
    });
  });
  it('does not navigate or hijack another open compose/payment page', async () => {
    const navigate = vi.fn();
    const openWindow = vi.fn();
    const matchAll = vi
      .fn()
      .mockResolvedValue([{ url: `${origin}/checkout/private`, navigate }]);
    await openWebPush({ matchAll, openWindow } as unknown as Clients, origin);
    expect(navigate).not.toHaveBeenCalled();
    expect(openWindow).toHaveBeenCalledWith(destination);
  });
  it('opens intended route if exact window closes during focus', async () => {
    const openWindow = vi.fn();
    const matchAll = vi.fn().mockResolvedValue([
      {
        url: destination,
        focus: vi.fn().mockRejectedValue(new Error('closed')),
      },
    ]);
    await openWebPush({ matchAll, openWindow } as unknown as Clients, origin);
    expect(openWindow).toHaveBeenCalledWith(destination);
  });
});

it('billing notice uses generic copy and only the fixed authenticated inbox destination', async () => {
  const options = notificationOptions(
    JSON.stringify({
      version: 1,
      notificationId: id,
      kind: 'billing_notice',
      url: routes.billingNotices,
      amount: 9900,
      billingAt: 'private-date',
      artist: 'private-artist',
    }),
  );
  expect(options).toMatchObject({
    body: messages.billingNotices.pushBody,
    data: { url: routes.billingNotices },
  });
  expect(JSON.stringify(options)).not.toMatch(
    /9900|private-date|private-artist/,
  );
  const openWindow = vi.fn();
  await openWebPush(
    {
      matchAll: vi.fn().mockResolvedValue([]),
      openWindow,
    } as unknown as Clients,
    'https://app.example',
    options.data,
  );
  expect(openWindow).toHaveBeenCalledWith(
    `https://app.example${routes.billingNotices}`,
  );
});
it('an arbitrary click destination cannot escape the fixed authenticated routes', async () => {
  const openWindow = vi.fn();
  await openWebPush(
    {
      matchAll: vi.fn().mockResolvedValue([]),
      openWindow,
    } as unknown as Clients,
    'https://app.example',
    { url: 'https://evil.example' },
  );
  expect(openWindow).toHaveBeenCalledWith(
    `https://app.example${routes.subscriptions}`,
  );
});
it('a billing URL without its supported source discriminator is not trusted', () => {
  expect(
    notificationOptions(
      JSON.stringify({
        version: 1,
        notificationId: id,
        url: routes.billingNotices,
      }),
    ),
  ).toMatchObject({
    body: messages.notifications.pushBody,
    data: { url: routes.subscriptions },
    tag: WEBPUSH_CLIENT.fallbackNotificationTag,
  });
});

it('schedule notice displays generic local copy and opens only the fixed current-account calendar', async () => {
  const options = notificationOptions(
    JSON.stringify({
      version: 1,
      notificationId: id,
      kind: 'schedule_notice',
      url: routes.schedules,
      title: 'private-event',
      lat: 37.5,
      startsAt: 'private-time',
    }),
  );
  expect(options).toMatchObject({
    body: messages.scheduleNotices.pushBody,
    data: { url: routes.schedules },
  });
  expect(JSON.stringify(options)).not.toMatch(
    /private-event|37.5|private-time/,
  );
  const openWindow = vi.fn();
  await openWebPush(
    {
      matchAll: vi.fn().mockResolvedValue([]),
      openWindow,
    } as unknown as Clients,
    'https://app.example',
    options.data,
  );
  expect(openWindow).toHaveBeenCalledWith(
    `https://app.example${routes.schedules}`,
  );
});
it.each([
  { url: routes.schedules },
  { kind: 'billing_notice', url: routes.schedules },
  { kind: 'schedule_notice', url: '/schedules/private-id' },
])('does not trust a mismatched schedule destination %#', (payload) => {
  expect(
    notificationOptions(
      JSON.stringify({ version: 1, notificationId: id, ...payload }),
    ),
  ).toMatchObject({
    body: messages.notifications.pushBody,
    data: { url: routes.subscriptions },
    tag: WEBPUSH_CLIENT.fallbackNotificationTag,
  });
});
