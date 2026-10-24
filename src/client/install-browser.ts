import {
  identifyInstallPlatform,
  INITIAL_INSTALL_BROWSER_STATE,
  INSTALL_BROWSER_EVENTS,
  type InstallBrowserState,
  type InstallPermission,
} from '@/config/install';

type PromptChoice = { outcome: 'accepted' | 'dismissed' };
type InstallPromptEvent = Event & {
  prompt(): Promise<PromptChoice | void>;
  userChoice?: Promise<PromptChoice>;
};
let snapshot = INITIAL_INSTALL_BROWSER_STATE;
let promptEvent: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();
let stopObserving: (() => void) | null = null;

function update(patch: Partial<InstallBrowserState>) {
  const next = { ...snapshot, ...patch };
  if (
    Object.keys(next).every(
      (key) =>
        next[key as keyof InstallBrowserState] ===
        snapshot[key as keyof InstallBrowserState],
    )
  )
    return;
  snapshot = next;
  listeners.forEach((listener) => listener());
}
function readPermission(): InstallPermission {
  if (
    !window.isSecureContext ||
    !('Notification' in window) ||
    typeof window.Notification?.requestPermission !== 'function'
  )
    return 'unsupported';
  const permission = window.Notification.permission;
  return ['default', 'denied', 'granted'].includes(permission)
    ? permission
    : 'unsupported';
}
function readBrowser() {
  const standalone =
    window.matchMedia?.(INSTALL_BROWSER_EVENTS.displayMode).matches === true ||
    ('standalone' in navigator && navigator.standalone === true);
  if (standalone) promptEvent = null;
  update({
    platform: identifyInstallPlatform(
      navigator.userAgent,
      navigator.platform,
      navigator.maxTouchPoints,
    ),
    standalone,
    secure: window.isSecureContext,
    canPrompt: !standalone && promptEvent !== null,
    notification: readPermission(),
  });
}
function observe() {
  if (typeof window === 'undefined') return () => {};
  const beforeInstall = (event: Event) => {
    if ('prompt' in event && typeof event.prompt === 'function') {
      event.preventDefault();
      promptEvent = event as InstallPromptEvent;
      update({ promptState: 'idle' });
      readBrowser();
    }
  };
  const installed = () => {
    promptEvent = null;
    update({ canPrompt: false, installedEventObserved: true });
    readBrowser();
  };
  const visibility = () => {
    if (document.visibilityState === 'visible') readBrowser();
  };
  const mode = window.matchMedia?.(INSTALL_BROWSER_EVENTS.displayMode);
  window.addEventListener(INSTALL_BROWSER_EVENTS.prompt, beforeInstall);
  window.addEventListener(INSTALL_BROWSER_EVENTS.installed, installed);
  window.addEventListener('focus', readBrowser);
  window.addEventListener('pageshow', readBrowser);
  document.addEventListener('visibilitychange', visibility);
  mode?.addEventListener('change', readBrowser);
  readBrowser();
  return () => {
    window.removeEventListener(INSTALL_BROWSER_EVENTS.prompt, beforeInstall);
    window.removeEventListener(INSTALL_BROWSER_EVENTS.installed, installed);
    window.removeEventListener('focus', readBrowser);
    window.removeEventListener('pageshow', readBrowser);
    document.removeEventListener('visibilitychange', visibility);
    mode?.removeEventListener('change', readBrowser);
  };
}

export function subscribeInstallBrowser(listener: () => void) {
  listeners.add(listener);
  if (!stopObserving) stopObserving = observe();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      stopObserving?.();
      stopObserving = null;
    }
  };
}
export function getInstallBrowserSnapshot() {
  return snapshot;
}
export function getInstallBrowserServerSnapshot() {
  return INITIAL_INSTALL_BROWSER_STATE;
}

// Called only from the user's button click. The genuine browser event is
// consumed once; neither a click nor accepted prompt sets a persisted choice.
export async function promptInstall() {
  const event = promptEvent;
  if (!event || snapshot.standalone || snapshot.promptState === 'pending')
    return;
  promptEvent = null;
  update({ canPrompt: false, promptState: 'pending' });
  try {
    const result = await event.prompt();
    const choice = event.userChoice ? await event.userChoice : result;
    update({
      promptState:
        choice?.outcome === 'accepted' || choice?.outcome === 'dismissed'
          ? choice.outcome
          : 'unavailable',
    });
  } catch {
    update({ promptState: 'unavailable' });
  }
}

// Permission is optional and is not a Web Push registration. No subscription,
// test notification or permission request is performed by observation/rendering.
export async function requestInstallNotificationPermission() {
  readBrowser();
  if (
    !snapshot.standalone ||
    !snapshot.secure ||
    snapshot.notification !== 'default' ||
    snapshot.notificationPending
  )
    return;
  update({ notificationPending: true, notificationFailed: false });
  try {
    // Keep this call before an await so the browser's user activation is intact.
    await window.Notification.requestPermission();
    readBrowser();
  } catch {
    update({ notificationFailed: true });
  } finally {
    update({ notificationPending: false });
  }
}
