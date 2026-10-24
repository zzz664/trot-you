import { z } from 'zod';
import { routes } from './routes';

export const INSTALL_BODY_LIMIT = 1024;
export const INSTALL_REQUEST_TIMEOUT_MS = 15_000;
export const INSTALL_CHOICES = [
  'acknowledged',
  'skipped',
  'installed_self_reported',
] as const;
export type InstallChoice = (typeof INSTALL_CHOICES)[number];
export type InstallData = {
  selectedName: string | null;
  choice: InstallChoice | null;
  acknowledgedAt: string | null;
  installationSelfReportedAt: string | null;
  completedAt: string | null;
};
export const installInputSchema = z.discriminatedUnion('action', [
  z.strictObject({
    action: z.literal('acknowledge'),
    choice: z.enum(INSTALL_CHOICES),
  }),
  z.strictObject({ action: z.literal('complete') }),
]);
export type InstallInput = z.output<typeof installInputSchema>;
export const INSTALL_ERROR_STATUS = {
  SETUP_NOT_READY: 503,
  INVALID_INPUT: 400,
  PROFILE_REQUIRED: 409,
  INTEREST_REQUIRED: 409,
  GUIDANCE_REQUIRED: 409,
  FORBIDDEN: 403,
  UNAUTHENTICATED: 401,
  UNAVAILABLE: 503,
} as const;
export type InstallError = keyof typeof INSTALL_ERROR_STATUS;
export type InstallResult<T> =
  { ok: true; data: T } | { ok: false; code: InstallError };
export type InstallSubmitResult =
  { ok: true; next: string } | { ok: false; code: InstallError };
export const INSTALL_RESPONSE_PATHS = [
  routes.onboardingInstall,
  routes.home,
] as const;
export const INSTALL_BROWSER_EVENTS = {
  prompt: 'beforeinstallprompt',
  installed: 'appinstalled',
  displayMode: '(display-mode: standalone)',
} as const;
export type InstallPlatform = 'ios' | 'android' | 'desktop' | 'unknown';
export type InstallPermission = NotificationPermission | 'unsupported';
export type InstallPromptState =
  'idle' | 'pending' | 'accepted' | 'dismissed' | 'unavailable';
export type InstallBrowserState = {
  platform: InstallPlatform;
  standalone: boolean;
  secure: boolean;
  canPrompt: boolean;
  promptState: InstallPromptState;
  installedEventObserved: boolean;
  notification: InstallPermission;
  notificationPending: boolean;
  notificationFailed: boolean;
};
export const INITIAL_INSTALL_BROWSER_STATE: InstallBrowserState = {
  platform: 'unknown',
  standalone: false,
  secure: false,
  canPrompt: false,
  promptState: 'idle',
  installedEventObserved: false,
  notification: 'unsupported',
  notificationPending: false,
  notificationFailed: false,
};

// A display hint only. This must never become a claim of API support or proof
// that an installation took place. Capability checks remain independent.
export function identifyInstallPlatform(
  userAgent: string,
  platform: string,
  maxTouchPoints: number,
): InstallPlatform {
  if (
    /iPad|iPhone|iPod/i.test(userAgent) ||
    (platform === 'MacIntel' && maxTouchPoints > 1)
  )
    return 'ios';
  if (/Android/i.test(userAgent)) return 'android';
  return userAgent ? 'desktop' : 'unknown';
}
