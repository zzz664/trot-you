import 'server-only';
import { getServerEnv } from '@/config/env.server';
import { SCHEDULE_NOTICE } from '@/config/schedule-notices';
import { createCheckoutServiceClient } from '@/server/db/checkout-client';
import { createScheduleNoticeQueuePort } from '@/server/db/schedule-notice-queue';
import type { ScheduleNoticeQueueDependencies } from '@/server/services/schedule-notices/create-due';

export function createScheduleNoticeQueueDependencies(): ScheduleNoticeQueueDependencies | null {
  const parsed = getServerEnv();
  if (
    !parsed.ok ||
    !parsed.data.SCHEDULE_NOTICES_ENABLED ||
    !parsed.data.SCHEDULE_NOTICES_CRON_SECRET
  )
    return null;
  const client = createCheckoutServiceClient(SCHEDULE_NOTICE.databaseTimeoutMs);
  return client
    ? { port: createScheduleNoticeQueuePort(client), now: Date.now }
    : null;
}
