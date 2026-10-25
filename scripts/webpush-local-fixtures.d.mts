export const WEBPUSH_CI_ENV: Readonly<{
  WEBPUSH_LOCAL_E2E: string;
  WEBPUSH_ENABLED: string;
  WEBPUSH_WORKER_ENABLED: string;
  VAPID_PUBLIC_KEY: string;
  VAPID_PRIVATE_KEY: string;
  VAPID_SUBJECT: string;
}>;
export const WEBPUSH_CI_SUBSCRIPTION: Readonly<{
  endpoint: string;
  expirationTime: null;
  keys: Readonly<{ p256dh: string; auth: string }>;
}>;
