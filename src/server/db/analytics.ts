import 'server-only';
import { z } from 'zod';
import { AnalyticsEvent } from '@/config/analytics-events';
import {
  ANALYTICS_REQUEST_TIMEOUT_MS,
  type AnalyticsError,
  type AnalyticsResult,
} from '@/config/analytics';
import type { AnalyticsPort } from '@/server/services/analytics/track';
import type { ActorClient } from './client';

const codes: Record<string, AnalyticsError> = {
  ANALYTICS_ACTOR_FORBIDDEN: 'FORBIDDEN',
  ANALYTICS_CLIENT_EVENT_FORBIDDEN: 'FORBIDDEN',
  ANALYTICS_SOURCE_FORBIDDEN: 'FORBIDDEN',
  ANALYTICS_CONSENT_REQUIRED: 'CONSENT_REQUIRED',
  ANALYTICS_EVENT_REQUIRED: 'INVALID_INPUT',
  ANALYTICS_EVENT_TIME_INVALID: 'INVALID_INPUT',
  ANALYTICS_EVENT_CONFLICT: 'IDEMPOTENCY_CONFLICT',
};
function failure(message: string): AnalyticsResult<never> {
  return {
    ok: false,
    code: Object.hasOwn(codes, message) ? codes[message]! : 'UNAVAILABLE',
  };
}
export function createAnalyticsPort(client: ActorClient): AnalyticsPort {
  return {
    async record(input, signal) {
      const request = client.rpc('analytics_record_client', {
        p_event_key: input.event_key,
        p_name: input.name,
        ...(input.name === AnalyticsEvent.VOICE_INPUT_USED
          ? { p_voice_context: input.properties.voice_context }
          : { p_source_id: input.properties.source_id }),
      });
      const timeout = AbortSignal.timeout(ANALYTICS_REQUEST_TIMEOUT_MS);
      const { data, error } = await request.abortSignal(
        signal ? AbortSignal.any([signal, timeout]) : timeout,
      );
      if (error) return failure(error.message);
      // The DB returns an internal row UUID. Do not expose it to the browser.
      return z.uuid().safeParse(data).success
        ? { ok: true, data: null }
        : { ok: false, code: 'UNAVAILABLE' };
    },
  };
}
