// Incoming notifications are hints, never verified financial facts. These are
// transport/storage bounds, not commercial policy or provider authentication.
export const PROVIDER_EVENT_BODY_LIMIT_BYTES = 16_384;
export const PROVIDER_EVENT_BODY_TIMEOUT_MS = 1_000;
export const PROVIDER_EVENT_MAX_CHUNKS = 256;
export const PROVIDER_EVENT_TRANSMISSION_ID_MAX_LENGTH = 200;
export const PROVIDER_EVENT_CREATED_AT_MAX_LENGTH = 40;
export const TOSS_PROVIDER_EVENT_TYPE = 'PAYMENT_STATUS_CHANGED';
export const TOSS_PROVIDER_EVENT_STATUSES = [
  'DONE',
  'CANCELED',
  'PARTIAL_CANCELED',
] as const;
export const TOSS_PROVIDER_EVENT_TRANSMISSION_HEADER =
  'tosspayments-webhook-transmission-id';
export const PROVIDER_EVENT_SEMANTIC_KEY_VERSION = 'trot-you.payment-hint.v1';
