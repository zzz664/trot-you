import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, expect, it, vi } from 'vitest';
import { WebPushSettings } from '@/components/webpush/WebPushSettings';
import { WebPushErrorScreen } from '@/components/webpush/WebPushErrorScreen';
import type { WebPushClientData, WebPushClientResult } from '@/client/webpush';
import { WEBPUSH_ERROR_STATUS, type WebPushStatus } from '@/config/webpush';
import type { WebPushBrowserState } from '@/config/webpush-client';
import messages from '@/messages/ko.json';
import { routes } from '@/config/routes';

const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  enable: vi.fn(),
  disable: vi.fn(),
  browser: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock('@/client/webpush', () => ({
  readWebPush: mocks.read,
  enableWebPush: mocks.enable,
  disableWebPush: mocks.disable,
  webPushBrowserState: mocks.browser,
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mocks.replace, refresh: mocks.refresh }),
}));
const status: WebPushStatus = {
  configured: true,
  publicKey: 'B'.repeat(87),
  consentVersion: 'test-v1',
  webpushEnabled: false,
  newMessage: false,
  deviceId: null,
  deviceActive: false,
};
const browser: WebPushBrowserState = {
  supported: true,
  secure: true,
  platform: 'desktop',
  standalone: false,
  installRequired: false,
  permission: 'default',
  subscriptionPresent: false,
  needsRenewal: false,
};
const base: WebPushClientData = { status, browser };
const enabled: WebPushClientData = {
  status: {
    ...status,
    webpushEnabled: true,
    newMessage: true,
    deviceId: '00000000-0000-4000-8000-000000000001',
    deviceActive: true,
  },
  browser: { ...browser, permission: 'granted', subscriptionPresent: true },
};
function subject(initial = status, key = 'first') {
  return (
    <NextIntlClientProvider locale="ko" messages={messages}>
      <WebPushSettings key={key} initial={initial} />
    </NextIntlClientProvider>
  );
}
async function loaded(data = base) {
  mocks.read.mockResolvedValue({ ok: true, data });
  const result = render(subject(data.status));
  await waitFor(() =>
    expect(
      screen.queryByText(messages.notifications.checking),
    ).not.toBeInTheDocument(),
  );
  return result;
}
function button(key: 'enable' | 'disable' | 'refresh') {
  return screen.getByRole('button', { name: messages.notifications[key] });
}
async function consent() {
  await userEvent.click(
    screen.getByRole('checkbox', { name: messages.notifications.consent }),
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.read.mockResolvedValue({ ok: true, data: base });
  mocks.enable.mockResolvedValue({ ok: true, data: enabled });
  mocks.disable.mockResolvedValue({ ok: true, data: base });
  mocks.browser.mockReturnValue(browser);
});
it('renders honest privacy and delivery distinctions and never auto-enables', async () => {
  await loaded();
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
    messages.notifications.title,
  );
  expect(screen.getByText(messages.notifications.privacy)).toBeVisible();
  expect(screen.getByText(messages.notifications.deliveryNotice)).toBeVisible();
  expect(screen.getByRole('checkbox')).not.toBeChecked();
  expect(button('enable')).toBeDisabled();
  expect(mocks.enable).not.toHaveBeenCalled();
  expect(mocks.disable).not.toHaveBeenCalled();
});
it('requires explicit consent then exact enable click', async () => {
  await loaded();
  await consent();
  expect(button('enable')).toBeEnabled();
  await userEvent.click(button('enable'));
  expect(mocks.enable).toHaveBeenCalledWith(status, expect.any(Function));
  expect(await screen.findByText(messages.notifications.active)).toBeVisible();
  expect(button('disable')).toBeEnabled();
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
});
it('turns off and resets consent rather than immediately re-enrolling', async () => {
  await loaded(enabled);
  await userEvent.click(button('disable'));
  expect(
    await screen.findByText(messages.notifications.inactive),
  ).toBeVisible();
  expect(screen.getByRole('checkbox')).not.toBeChecked();
  expect(button('enable')).toBeDisabled();
  expect(mocks.enable).not.toHaveBeenCalled();
});
it('serializes repeated enable clicks and disables competing actions', async () => {
  let finish!: (result: WebPushClientResult) => void;
  mocks.enable.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await loaded();
  await consent();
  fireEvent.click(button('enable'));
  fireEvent.click(
    screen.getByRole('button', { name: messages.notifications.enabling }),
  );
  expect(mocks.enable).toHaveBeenCalledOnce();
  expect(button('refresh')).toBeDisabled();
  expect(screen.getByRole('checkbox')).toBeDisabled();
  await act(async () => finish({ ok: true, data: enabled }));
  expect(button('disable')).toBeEnabled();
});
it('Back invalidates pending enable before navigation', async () => {
  let finish!: (result: WebPushClientResult) => void;
  mocks.enable.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await loaded();
  await consent();
  fireEvent.click(button('enable'));
  const isCurrent = mocks.enable.mock.calls[0]![1];
  expect(isCurrent()).toBe(true);
  await userEvent.click(
    screen.getByRole('button', { name: messages.notifications.back }),
  );
  expect(isCurrent()).toBe(false);
  expect(mocks.replace).toHaveBeenCalledWith(routes.home);
  await act(async () => finish({ ok: true, data: enabled }));
  expect(
    screen.queryByText(messages.notifications.active),
  ).not.toBeInTheDocument();
});
it('browser Back and later response cannot apply previous action', async () => {
  let finish!: (result: WebPushClientResult) => void;
  mocks.enable.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await loaded();
  await consent();
  fireEvent.click(button('enable'));
  fireEvent.popState(window);
  expect(mocks.enable.mock.calls[0]![1]()).toBe(false);
  await act(async () => finish({ ok: true, data: enabled }));
  expect(
    screen.queryByText(messages.notifications.active),
  ).not.toBeInTheDocument();
  expect(screen.getByRole('checkbox')).not.toBeChecked();
});
it('unmount invalidates a pending permission or registration before account replacement', async () => {
  let finish!: (result: WebPushClientResult) => void;
  mocks.enable.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const view = await loaded();
  await consent();
  fireEvent.click(button('enable'));
  const isCurrent = mocks.enable.mock.calls[0]![1];
  view.rerender(subject(status, 'new-account'));
  expect(isCurrent()).toBe(false);
  await act(async () => finish({ ok: true, data: enabled }));
  expect(
    screen.queryByText(messages.notifications.active),
  ).not.toBeInTheDocument();
});
it.each(['subscriptions', 'installGuide'] as const)(
  'visible %s link uses fixed destination and invalidates a pending action',
  async (name) => {
    let finish!: (result: WebPushClientResult) => void;
    mocks.enable.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await loaded();
    await consent();
    fireEvent.click(button('enable'));
    const link = screen.getByRole('link', {
      name: messages.notifications[name],
    });
    expect(link).toHaveAttribute(
      'href',
      name === 'subscriptions'
        ? routes.subscriptions
        : routes.notificationInstallGuide,
    );
    fireEvent.click(link);
    expect(mocks.enable.mock.calls[0]![1]()).toBe(false);
    await act(async () => finish({ ok: true, data: enabled }));
  },
);
it('shows iOS installed guidance rather than a permission button', async () => {
  await loaded({
    status,
    browser: { ...browser, platform: 'ios', installRequired: true },
  });
  expect(screen.getByText(messages.notifications.iosInstall)).toBeVisible();
  expect(button('enable')).toBeDisabled();
});
it('supports standalone iOS with feature detection', async () => {
  await loaded({
    status,
    browser: { ...browser, platform: 'ios', standalone: true },
  });
  await consent();
  expect(button('enable')).toBeEnabled();
});
it('does not offer unsupported capabilities as installed success', async () => {
  await loaded({
    status,
    browser: { ...browser, supported: false, permission: 'unsupported' },
  });
  expect(screen.getByText(messages.notifications.unsupported)).toBeVisible();
  expect(button('enable')).toBeDisabled();
});
it('shows insecure connection guidance', async () => {
  await loaded({
    status,
    browser: {
      ...browser,
      supported: false,
      secure: false,
      permission: 'unsupported',
    },
  });
  expect(screen.getByText(messages.notifications.insecure)).toBeVisible();
});
it('denied permission gives settings guidance, not repeated browser prompts', async () => {
  await loaded({ status, browser: { ...browser, permission: 'denied' } });
  expect(screen.getByText(messages.notifications.denied)).toBeVisible();
  expect(button('enable')).toBeDisabled();
});
it('updates denied state after an explicit permission response', async () => {
  await loaded();
  mocks.browser.mockReturnValue({ ...browser, permission: 'denied' });
  mocks.enable.mockResolvedValue({ ok: false, code: 'PERMISSION_DENIED' });
  await consent();
  await userEvent.click(button('enable'));
  expect(await screen.findByText(messages.notifications.denied)).toBeVisible();
  expect(button('enable')).toBeDisabled();
  expect(screen.getByRole('alert')).toHaveTextContent(
    messages.notifications.errors.PERMISSION_DENIED,
  );
});
it('unconfigured service does not enable browser permission', async () => {
  await loaded({ status: { ...status, configured: false }, browser });
  expect(screen.getByText(messages.notifications.unconfigured)).toBeVisible();
  expect(button('enable')).toBeDisabled();
  expect(mocks.enable).not.toHaveBeenCalled();
});
it('does not present a retained device registration as operational when service configuration is disabled', async () => {
  await loaded({
    ...enabled,
    status: { ...enabled.status, configured: false, publicKey: null },
  });
  expect(screen.getByText(messages.notifications.unconfigured)).toBeVisible();
  expect(screen.getByText(messages.notifications.inactive)).toBeVisible();
  expect(
    screen.queryByText(messages.notifications.active),
  ).not.toBeInTheDocument();
  expect(button('enable')).toBeDisabled();
  expect(button('disable')).toBeEnabled();
});
it('keeps disabled-server/browser-cleanup uncertainty explicit and retries only disable', async () => {
  await loaded(enabled);
  mocks.disable.mockResolvedValueOnce({
    ok: false,
    code: 'BROWSER_CLEANUP_REQUIRED',
    data: { status, browser: { ...browser, subscriptionPresent: true } },
  });
  await userEvent.click(button('disable'));
  expect(
    await screen.findByText(messages.notifications.cleanupNotice),
  ).toBeVisible();
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  await userEvent.click(
    screen.getByRole('button', { name: messages.ui.retry }),
  );
  expect(mocks.disable).toHaveBeenCalledTimes(2);
  expect(mocks.enable).not.toHaveBeenCalled();
});
it('a lost response presents error and Retry refreshes status rather than enrolling blindly', async () => {
  await loaded();
  mocks.enable.mockResolvedValueOnce({ ok: false, code: 'UNAVAILABLE' });
  await consent();
  await userEvent.click(button('enable'));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    messages.notifications.errors.UNAVAILABLE,
  );
  mocks.read.mockResolvedValue({ ok: true, data: enabled });
  await userEvent.click(
    screen.getByRole('button', { name: messages.ui.retry }),
  );
  expect(await screen.findByText(messages.notifications.active)).toBeVisible();
  expect(mocks.enable).toHaveBeenCalledOnce();
});
it('focus refreshes permission/session ownership but never enrolls', async () => {
  await loaded(enabled);
  mocks.read.mockResolvedValue({ ok: true, data: base });
  fireEvent.focus(window);
  expect(
    await screen.findByText(messages.notifications.inactive),
  ).toBeVisible();
  expect(mocks.enable).not.toHaveBeenCalled();
});
it.each(
  Object.keys(WEBPUSH_ERROR_STATUS) as Array<keyof typeof WEBPUSH_ERROR_STATUS>,
)('shows recoverable %s error within main', async (code) => {
  mocks.read.mockResolvedValue({ ok: false, code });
  render(subject());
  expect(await screen.findByRole('alert')).toHaveTextContent(
    messages.notifications.errors[code],
  );
  expect(screen.getByRole('main')).toContainElement(screen.getByRole('alert'));
});
it('server error screen retries RSC and has fixed back route', async () => {
  render(
    <NextIntlClientProvider locale="ko" messages={messages}>
      <WebPushErrorScreen code="UNAVAILABLE" />
    </NextIntlClientProvider>,
  );
  await userEvent.click(
    screen.getByRole('button', { name: messages.ui.retry }),
  );
  expect(mocks.refresh).toHaveBeenCalledOnce();
  expect(
    screen.getByRole('link', { name: messages.notifications.back }),
  ).toHaveAttribute('href', routes.home);
});
it('old-worker guidance preserves explicit opt-in and never claims activation', async () => {
  await loaded();
  mocks.enable.mockResolvedValue({ ok: false, code: 'WORKER_UPDATE_REQUIRED' });
  await consent();
  await userEvent.click(button('enable'));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    messages.notifications.errors.WORKER_UPDATE_REQUIRED,
  );
  expect(
    screen.queryByText(messages.notifications.active),
  ).not.toBeInTheDocument();
  await userEvent.click(
    screen.getByRole('button', { name: messages.ui.retry }),
  );
  expect(mocks.enable).toHaveBeenCalledOnce();
});
it('completed users can focus the in-page installation guide without reopening onboarding', async () => {
  await loaded();
  const link = screen.getByRole('link', {
    name: messages.notifications.installGuide,
  });
  expect(link).toHaveAttribute('href', routes.notificationInstallGuide);
  await userEvent.click(link);
  expect(
    screen.getByRole('heading', { name: messages.notifications.guideTitle }),
  ).toHaveFocus();
  expect(screen.getByText(messages.notifications.guideCaution)).toBeVisible();
});
it('key rotation repair requires fresh explicit consent and does not claim enabled receipt', async () => {
  await loaded({ status, browser: { ...browser, needsRenewal: true } });
  expect(screen.getByText(messages.notifications.renewalNotice)).toBeVisible();
  expect(screen.getByText(messages.notifications.inactive)).toBeVisible();
  expect(button('enable')).toBeDisabled();
  expect(screen.getByRole('checkbox')).not.toBeChecked();
  expect(mocks.enable).not.toHaveBeenCalled();
});
