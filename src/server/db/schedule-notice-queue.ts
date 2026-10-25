import 'server-only';
import { z } from 'zod';
import {
  SCHEDULE_NOTICE,
  scheduleNoticeCreatedSchema,
  type ScheduleNoticeResult,
} from '@/config/schedule-notices';
import type { ScheduleNoticeQueuePort } from '@/server/services/schedule-notices/create-due';
import type { CheckoutServiceClient } from './checkout-client';

function parsed<T>(
  schema: z.ZodType<T>,
  data: unknown,
  error: { message: string } | null,
): ScheduleNoticeResult<T> {
  if (error)
    return {
      ok: false,
      code:
        error.message === 'SCHEDULE_NOTICE_POLICY_NOT_APPROVED'
          ? 'SETUP_NOT_READY'
          : 'UNAVAILABLE',
    };
  const result = schema.safeParse(data);
  return result.success
    ? { ok: true, data: result.data }
    : { ok: false, code: 'UNAVAILABLE' };
}

// Service-only bounded candidate and atomic queue RPCs. The DB owns time,
// recipient consent, session access, immutable policy and dedupe authority.
export function createScheduleNoticeQueuePort(
  client: CheckoutServiceClient,
): ScheduleNoticeQueuePort {
  return {
    async candidates(limit) {
      const { data, error } = await client.rpc('schedule_notice_candidates', {
        p_limit: limit,
      });
      return parsed(
        z
          .array(z.object({ schedule_id: z.uuid() }))
          .max(SCHEDULE_NOTICE.scanLimit)
          .transform((rows) => rows.map((row) => row.schedule_id)),
        data,
        error,
      );
    },
    async create(scheduleId) {
      const { data, error } = await client.rpc('schedule_notice_create', {
        p_schedule_id: scheduleId,
      });
      return parsed(
        z
          .array(
            z
              .object({ created: z.boolean(), push_jobs: z.number() })
              .transform((row) => ({
                created: row.created,
                pushJobs: row.push_jobs,
              }))
              .pipe(scheduleNoticeCreatedSchema),
          )
          .max(1)
          .transform((rows) => rows[0] ?? { created: false, pushJobs: 0 }),
        data,
        error,
      );
    },
  };
}
