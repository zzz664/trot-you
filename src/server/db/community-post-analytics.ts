import 'server-only';
import { z } from 'zod';
import {
  ANALYTICS_REQUEST_TIMEOUT_MS,
  type AnalyticsError,
} from '@/config/analytics';
import { AnalyticsEvent } from '@/config/analytics-events';
import type { CommunityPostAnalyticsPort } from '@/server/services/community-posts/analytics';
import type { MediaServiceClient } from './media-client';
const errors: Record<string, AnalyticsError> = {
  ANALYTICS_ACTOR_FORBIDDEN: 'FORBIDDEN',
  ANALYTICS_SOURCE_FORBIDDEN: 'FORBIDDEN',
  ANALYTICS_CONSENT_REQUIRED: 'CONSENT_REQUIRED',
  ANALYTICS_EVENT_REQUIRED: 'INVALID_INPUT',
  ANALYTICS_EVENT_TIME_INVALID: 'INVALID_INPUT',
  ANALYTICS_EVENT_CONFLICT: 'IDEMPOTENCY_CONFLICT',
};
export function createCommunityPostAnalyticsPort(
  client: MediaServiceClient,
): CommunityPostAnalyticsPort {
  return {
    async record(input) {
      const { data, error } = await client
        .rpc('analytics_record_server', {
          p_actor_id: input.actor_id,
          p_event_key: input.event_key,
          p_name: AnalyticsEvent.POST_CREATE,
          p_source_id: input.post_id,
        })
        .abortSignal(AbortSignal.timeout(ANALYTICS_REQUEST_TIMEOUT_MS));
      if (error)
        return {
          ok: false,
          code: Object.hasOwn(errors, error.message)
            ? errors[error.message]!
            : 'UNAVAILABLE',
        };
      // Internal analytics UUIDs are not exposed through the board response.
      return z.uuid().safeParse(data).success
        ? { ok: true, data: null }
        : { ok: false, code: 'UNAVAILABLE' };
    },
  };
}
