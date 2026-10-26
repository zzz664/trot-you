import 'server-only';
import { z } from 'zod';
import {
  ANALYTICS_REQUEST_TIMEOUT_MS,
  type AnalyticsError,
  type AnalyticsResult,
} from '@/config/analytics';
import { AnalyticsEvent } from '@/config/analytics-events';
import type { AnalyticsCapturePort } from '@/server/services/analytics/capture';
import type { MediaServiceClient } from './media-client';

const errors: Record<string, AnalyticsError> = {
  ANALYTICS_ACTOR_FORBIDDEN: 'FORBIDDEN',
  ANALYTICS_SOURCE_FORBIDDEN: 'FORBIDDEN',
  ANALYTICS_SERVER_EVENT_FORBIDDEN: 'FORBIDDEN',
  ANALYTICS_VERIFIED_CHARGE_REQUIRED: 'FORBIDDEN',
  ANALYTICS_CONSENT_REQUIRED: 'CONSENT_REQUIRED',
  ANALYTICS_CAPTURE_POLICY_REQUIRED: 'SETUP_NOT_READY',
  ANALYTICS_CAPTURE_SOURCE_BEFORE_START: 'FORBIDDEN',
  ANALYTICS_CAPTURE_SOURCE_UNAVAILABLE: 'UNAVAILABLE',
  ANALYTICS_CAPTURE_ISOLATION_UNSUPPORTED: 'UNAVAILABLE',
  ANALYTICS_EVENT_REQUIRED: 'INVALID_INPUT',
  ANALYTICS_EVENT_TIME_INVALID: 'INVALID_INPUT',
  ANALYTICS_EVENT_CONFLICT: 'IDEMPOTENCY_CONFLICT',
};
function result(
  data: unknown,
  error: { message: string } | null,
): AnalyticsResult<null> {
  if (error)
    return {
      ok: false,
      code: Object.hasOwn(errors, error.message)
        ? errors[error.message]!
        : 'UNAVAILABLE',
    };
  // Internal row/source IDs never leave this private adapter.
  return z.uuid().safeParse(data).success
    ? { ok: true, data: null }
    : { ok: false, code: 'UNAVAILABLE' };
}
function boundedSignal(signal?: AbortSignal) {
  const timeout = AbortSignal.timeout(ANALYTICS_REQUEST_TIMEOUT_MS);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}
export function createAnalyticsCapturePort(
  client: MediaServiceClient,
): AnalyticsCapturePort {
  return {
    async server({ actor_id, event }, signal) {
      const { data, error } = await client
        .rpc('analytics_capture_server', {
          p_actor_id: actor_id,
          p_event_key: event.event_key,
          p_name: event.name,
          ...(event.name === AnalyticsEvent.FONT_SIZE_SELECTED
            ? { p_font_scale: event.properties.font_scale }
            : event.name === AnalyticsEvent.SIGNUP_COMPLETE
              ? {}
              : { p_source_id: event.properties.source_id }),
        })
        .abortSignal(boundedSignal(signal));
      return result(data, error);
    },
    async charge(eventId, signal) {
      const { data, error } = await client
        .rpc('analytics_capture_charge', { p_event_id: eventId })
        .abortSignal(boundedSignal(signal));
      return result(data, error);
    },
    async cancellation(input, signal) {
      const { data, error } = await client
        .rpc('analytics_record_cancellation', {
          p_actor_id: input.actor_id,
          p_subscription_id: input.subscription_id,
        })
        .abortSignal(boundedSignal(signal));
      return result(data, error);
    },
  };
}
