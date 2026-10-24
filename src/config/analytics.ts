import { z } from 'zod';
import { AnalyticsEvent, analyticsPropertySchemas } from './analytics-events';

// This feature exposes voice observation only. Other event routes need their own
// integration and must not use the inclusive event vocabulary as an allowlist.
export const voiceInputEventSchema = z.strictObject({
  event_key: z.uuid(),
  name: z.literal(AnalyticsEvent.VOICE_INPUT_USED),
  properties: analyticsPropertySchemas[AnalyticsEvent.VOICE_INPUT_USED],
});
export type VoiceInputContext = z.infer<
  typeof analyticsPropertySchemas.voice_input_used
>['voice_context'];
export const ANALYTICS_BODY_LIMIT = 1024;
export const ANALYTICS_BODY_TIMEOUT_MS = 5_000;
export const ANALYTICS_REQUEST_TIMEOUT_MS = 5_000;
export const ANALYTICS_HTTP_OK = 200;
export const ANALYTICS_ERROR_STATUS = {
  INVALID_INPUT: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  CONSENT_REQUIRED: 403,
  PROFILE_REQUIRED: 409,
  IDEMPOTENCY_CONFLICT: 409,
  SETUP_NOT_READY: 503,
  UNAVAILABLE: 503,
} as const;
export type AnalyticsError = keyof typeof ANALYTICS_ERROR_STATUS;
export type AnalyticsResult<T> =
  { ok: true; data: T } | { ok: false; code: AnalyticsError };
