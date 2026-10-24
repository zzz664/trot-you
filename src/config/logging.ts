/** Only these fixed identifiers may become log text. Never use user/provider text. */
export const LOG_EVENTS = [
  'configuration.validated',
  'configuration.rejected',
  'integration.unavailable',
  'operation.failed',
  'log.input_rejected',
] as const;

export const LOG_LEVELS = ['info', 'warn', 'error'] as const;
export const LOG_PROVIDERS = [
  'supabase',
  'toss_card_billing',
  'kakaopay_subscription',
  'webpush',
  'alimtalk',
  'cron',
] as const;
export const LOG_MODES = ['disabled', 'test', 'live'] as const;
export const LOG_OUTCOMES = [
  'configured',
  'disabled',
  'unconfigured',
  'invalid',
  'succeeded',
  'failed',
  'unknown',
] as const;

/** HTTP status bounds are protocol constraints, not operational settings. */
export const LOG_HTTP_STATUS_MIN = 100;
export const LOG_HTTP_STATUS_MAX = 599;
export const LOG_METADATA_FIELDS = [
  'provider',
  'mode',
  'outcome',
  'errorCode',
  'statusCode',
  'durationMs',
  'attemptCount',
  'error',
] as const;

export type LogEvent = (typeof LOG_EVENTS)[number];
export type LogLevel = (typeof LOG_LEVELS)[number];
