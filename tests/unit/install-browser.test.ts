import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  identifyInstallPlatform,
  INITIAL_INSTALL_BROWSER_STATE,
  INSTALL_BROWSER_EVENTS,
} from '@/config/install';

type BrowserModule = typeof import('@/client/install-browser');
let browser: BrowserModule;
let unsubscribe: (() => void) | undefined;
let matches = false;
let permission: NotificationPermission = 'default';
const permissionRequest = vi.fn();
const changes = new Set<EventListenerOrEventListenerObject>();
const originalUserAgent = navigator.userAgent;
const originalPlatform = navigator.platform;
const originalTouchPoints = navigator.maxTouchPoints;

function device(userAgent: string, platform = '', touchPoints = 0) {
  Object.defineProperty(navigator, 'userAgent', {
    configurable: true,
    value: userAgent,
  });
  Object.defineProperty(navigator, 'platform', {
    configurable: true,
    value: platform,
  });
  Object.defineProperty(navigator, 'maxTouchPoints', {
    configurable: true,
    value: touchPoints,
  });
}
function observe() {
  unsubscribe = browser.subscribeInstallBrowser(vi.fn());
}
function promptEvent(outcome: 'accepted' | 'dismissed' = 'accepted') {
  const event = new Event(INSTALL_BROWSER_EVENTS.prompt, { cancelable: true });
  const prompt = vi.fn().mockResolvedValue(undefined);
  Object.assign(event, { prompt, userChoice: Promise.resolve({ outcome }) });
  window.dispatchEvent(event);
  return { event, prompt };
}

beforeEach(async () => {
  vi.resetModules();
  matches = false;
  permission = 'default';
  changes.clear();
  permissionRequest.mockReset();
  permissionRequest.mockImplementation(async () => permission);
  vi.stubGlobal('isSecureContext', true);
  vi.stubGlobal('Notification', {
    get permission() {
      return permission;
    },
    requestPermission: permissionRequest,
  });
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({
      get matches() {
        return matches;
      },
      addEventListener: (
        _event: string,
        listener: EventListenerOrEventListenerObject,
      ) => changes.add(listener),
      removeEventListener: (
        _event: string,
        listener: EventListenerOrEventListenerObject,
      ) => changes.delete(listener),
    })),
  );
  device('Mozilla Android test');
  browser = await import('@/client/install-browser');
});
afterEach(() => {
  unsubscribe?.();
  unsubscribe = undefined;
  device(originalUserAgent, originalPlatform, originalTouchPoints);
  vi.unstubAllGlobals();
});

describe('browser install observation', () => {
  it.each([
    ['iPhone', '', 0, 'ios'],
    ['iPad', '', 0, 'ios'],
    ['Desktop Safari', 'MacIntel', 5, 'ios'],
    ['Desktop Safari', 'MacIntel', 0, 'desktop'],
    ['Android Chrome', '', 5, 'android'],
    ['Windows Edge', '', 0, 'desktop'],
    ['', '', 0, 'unknown'],
  ] as const)(
    'uses %s only as a manual guidance hint',
    (agent, platform, touch, expected) => {
      expect(identifyInstallPlatform(agent, platform, touch)).toBe(expected);
    },
  );
  it('has a stable server snapshot and never asks permission or opens an install UI on observe', () => {
    expect(browser.getInstallBrowserServerSnapshot()).toEqual(
      INITIAL_INSTALL_BROWSER_STATE,
    );
    expect(browser.getInstallBrowserServerSnapshot()).toBe(
      browser.getInstallBrowserServerSnapshot(),
    );
    observe();
    expect(browser.getInstallBrowserSnapshot()).toMatchObject({
      platform: 'android',
      standalone: false,
      notification: 'default',
      canPrompt: false,
    });
    expect(permissionRequest).not.toHaveBeenCalled();
  });
  it('only reveals a prompt after a real event and invokes it once on request', async () => {
    observe();
    const { event, prompt } = promptEvent();
    expect(event.defaultPrevented).toBe(true);
    expect(prompt).not.toHaveBeenCalled();
    expect(browser.getInstallBrowserSnapshot().canPrompt).toBe(true);
    await Promise.all([browser.promptInstall(), browser.promptInstall()]);
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(browser.getInstallBrowserSnapshot()).toMatchObject({
      canPrompt: false,
      promptState: 'accepted',
      standalone: false,
      installedEventObserved: false,
    });
    expect(permissionRequest).not.toHaveBeenCalled();
  });
  it('supports browsers returning the choice from prompt without userChoice', async () => {
    observe();
    const event = new Event(INSTALL_BROWSER_EVENTS.prompt, {
      cancelable: true,
    });
    Object.assign(event, {
      prompt: vi.fn().mockResolvedValue({ outcome: 'dismissed' }),
    });
    window.dispatchEvent(event);
    await browser.promptInstall();
    expect(browser.getInstallBrowserSnapshot().promptState).toBe('dismissed');
  });
  it('preserves manual guidance when the event is missing or malformed', async () => {
    observe();
    window.dispatchEvent(new Event(INSTALL_BROWSER_EVENTS.prompt));
    await browser.promptInstall();
    expect(browser.getInstallBrowserSnapshot().canPrompt).toBe(false);
  });
  it('does not claim installation after dismissal or rejection', async () => {
    observe();
    promptEvent('dismissed');
    await browser.promptInstall();
    expect(browser.getInstallBrowserSnapshot()).toMatchObject({
      promptState: 'dismissed',
      installedEventObserved: false,
    });
    const next = promptEvent();
    next.prompt.mockRejectedValue(new Error('not available'));
    await browser.promptInstall();
    expect(browser.getInstallBrowserSnapshot()).toMatchObject({
      promptState: 'unavailable',
      installedEventObserved: false,
    });
  });
  it('records appinstalled as observation only and never requests permission', () => {
    observe();
    const { prompt } = promptEvent();
    window.dispatchEvent(new Event(INSTALL_BROWSER_EVENTS.installed));
    expect(browser.getInstallBrowserSnapshot()).toMatchObject({
      canPrompt: false,
      installedEventObserved: true,
      standalone: false,
    });
    expect(prompt).not.toHaveBeenCalled();
    expect(permissionRequest).not.toHaveBeenCalled();
  });
  it('updates standalone and permission state when returning from device settings', () => {
    observe();
    promptEvent();
    matches = true;
    permission = 'denied';
    window.dispatchEvent(new Event('focus'));
    expect(browser.getInstallBrowserSnapshot()).toMatchObject({
      standalone: true,
      notification: 'denied',
      canPrompt: false,
    });
    expect(permissionRequest).not.toHaveBeenCalled();
  });
  it('shares one observer between capture and page and removes it after final unsubscribe', () => {
    observe();
    const removeSecond = browser.subscribeInstallBrowser(vi.fn());
    expect(changes.size).toBe(1);
    unsubscribe?.();
    unsubscribe = undefined;
    expect(changes.size).toBe(1);
    removeSecond();
    expect(changes.size).toBe(0);
  });
});

describe('optional notification permission', () => {
  it('does not request outside standalone even in a secure supported browser', async () => {
    observe();
    await browser.requestInstallNotificationPermission();
    expect(permissionRequest).not.toHaveBeenCalled();
  });
  it.each(['denied', 'granted'] as const)(
    'never repeats a request with %s permission',
    async (value) => {
      matches = true;
      permission = value;
      observe();
      await browser.requestInstallNotificationPermission();
      expect(permissionRequest).not.toHaveBeenCalled();
    },
  );
  it('does not request in an insecure or unsupported context', async () => {
    matches = true;
    vi.stubGlobal('isSecureContext', false);
    observe();
    await browser.requestInstallNotificationPermission();
    expect(browser.getInstallBrowserSnapshot().notification).toBe(
      'unsupported',
    );
    expect(permissionRequest).not.toHaveBeenCalled();
    vi.stubGlobal('isSecureContext', true);
    vi.stubGlobal('Notification', undefined);
    await browser.requestInstallNotificationPermission();
    expect(browser.getInstallBrowserSnapshot().notification).toBe(
      'unsupported',
    );
  });
  it('calls the browser only after an explicit request and displays its actual permission', async () => {
    matches = true;
    observe();
    permissionRequest.mockImplementation(async () => {
      permission = 'granted';
      return permission;
    });
    expect(permissionRequest).not.toHaveBeenCalled();
    const task = browser.requestInstallNotificationPermission();
    expect(permissionRequest).toHaveBeenCalledTimes(1);
    await task;
    expect(browser.getInstallBrowserSnapshot()).toMatchObject({
      notification: 'granted',
      notificationPending: false,
    });
  });
  it('serializes repeated clicks without blocking other onboarding work', async () => {
    matches = true;
    observe();
    let finish: (value: NotificationPermission) => void = () => {};
    permissionRequest.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const first = browser.requestInstallNotificationPermission();
    await browser.requestInstallNotificationPermission();
    expect(permissionRequest).toHaveBeenCalledTimes(1);
    finish('default');
    await first;
    expect(browser.getInstallBrowserSnapshot().notificationPending).toBe(false);
  });
  it('does not invent permission when the request rejects or returns without granting', async () => {
    matches = true;
    observe();
    permissionRequest.mockRejectedValueOnce(new Error('private failure'));
    await browser.requestInstallNotificationPermission();
    expect(browser.getInstallBrowserSnapshot()).toMatchObject({
      notification: 'default',
      notificationPending: false,
      notificationFailed: true,
    });
    await browser.requestInstallNotificationPermission();
    expect(browser.getInstallBrowserSnapshot()).toMatchObject({
      notification: 'default',
      notificationFailed: false,
    });
  });
});
