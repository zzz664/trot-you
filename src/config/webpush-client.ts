import { type InstallPermission, type InstallPlatform } from './install';

export const WEBPUSH_CLIENT = {
  requestTimeoutMs: 15_000,
  workerTimeoutMs: 10_000,
  capabilityTimeoutMs: 1500,
  capabilityRequest: 'TROT_YOU_WEBPUSH_CAPABILITY',
  capabilityResponse: 'TROT_YOU_WEBPUSH_READY',
  workerVersion: 1,
  publicKeyBytes: 65,
  publicKeyPrefix: 4,
  payloadLimit: 1024,
  payloadVersion: 1,
  notificationTagPrefix: 'trot-you-message-',
  fallbackNotificationTag: 'trot-you-message',
  displayMode: '(display-mode: standalone)',
  installGuideId: 'notification-install-guide',
} as const;

export type WebPushBrowserState = {
  supported: boolean;
  secure: boolean;
  platform: InstallPlatform;
  standalone: boolean;
  installRequired: boolean;
  permission: InstallPermission;
  subscriptionPresent: boolean;
  needsRenewal: boolean;
};
export const INITIAL_WEBPUSH_BROWSER_STATE: WebPushBrowserState = {
  supported: false,
  secure: false,
  platform: 'unknown',
  standalone: false,
  installRequired: false,
  permission: 'unsupported',
  subscriptionPresent: false,
  needsRenewal: false,
};
export type WebPushBrowserError =
  | 'BROWSER_UNSUPPORTED'
  | 'INSTALL_REQUIRED'
  | 'PERMISSION_DENIED'
  | 'PERMISSION_DISMISSED'
  | 'BROWSER_UNAVAILABLE'
  | 'BROWSER_CLEANUP_REQUIRED'
  | 'WORKER_UPDATE_REQUIRED'
  | 'INTERRUPTED';
