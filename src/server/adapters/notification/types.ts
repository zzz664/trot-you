import 'server-only';

export type WebPushSubscription = {
  endpoint: string;
  p256dh: string;
  auth: string;
};
export type WebPushOutcome =
  | 'provider_accepted'
  | 'not_sent'
  | 'unknown'
  | 'dead_endpoint'
  | 'permanent_failure';
export type WebPushResult = {
  outcome: WebPushOutcome;
  retryAfterSeconds?: number;
};
export type WebPushMessage = WebPushSubscription & {
  /** Already privacy-filtered generic JSON, never source body or fan PII. */
  payload: string;
  /** Stable per-job opaque collapse token, not an exactly-once guarantee. */
  topic: string;
};
export type NotificationChannel = {
  send(input: WebPushMessage): Promise<WebPushResult>;
};
export type WebPushConfiguration = {
  publicKey: string;
  privateKey: string;
  subject: string;
  timeoutMs?: number;
};
export type WebPushHttpRequest = {
  endpoint: string;
  headers: Readonly<Record<string, string>>;
  body: Buffer;
  timeoutMs: number;
};
export type WebPushTransportResult =
  | { kind: 'response'; status: number; retryAfter?: string }
  | { kind: 'not_sent' | 'unknown' };
export type WebPushTransport = (
  request: WebPushHttpRequest,
) => Promise<WebPushTransportResult>;
