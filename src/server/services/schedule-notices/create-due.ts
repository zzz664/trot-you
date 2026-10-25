import 'server-only';
import {
  SCHEDULE_NOTICE,
  type ScheduleNoticeCreated,
  type ScheduleNoticeResult,
  type ScheduleNoticeWorkerSummary,
} from '@/config/schedule-notices';
export type ScheduleNoticeQueuePort = {
  candidates(limit: number): Promise<ScheduleNoticeResult<string[]>>;
  create(
    scheduleId: string,
  ): Promise<ScheduleNoticeResult<ScheduleNoticeCreated>>;
};
export type ScheduleNoticeQueueDependencies = {
  port: ScheduleNoticeQueuePort;
  now(): number;
};

// This selects the current approved next-KST-day window and queues opted-in
// schedule pushes only. It never contacts a provider or asserts device delivery.
// The database rechecks eligibility under locks before each idempotent creation.
export async function createDueScheduleNotices(
  deps: ScheduleNoticeQueueDependencies,
): Promise<ScheduleNoticeResult<ScheduleNoticeWorkerSummary>> {
  const startedAt = deps.now();
  const canWork = () => deps.now() - startedAt < SCHEDULE_NOTICE.workerBudgetMs;
  const summary: ScheduleNoticeWorkerSummary = {
    examined: 0,
    created: 0,
    skipped: 0,
    failed: 0,
    pushJobsQueued: 0,
    hasMore: false,
  };
  const seen = new Set<string>();
  try {
    for (
      let page = 0;
      page < SCHEDULE_NOTICE.workerPages && canWork();
      page++
    ) {
      const batch = await deps.port.candidates(SCHEDULE_NOTICE.scanLimit);
      if (!batch.ok) return batch;
      if (
        batch.data.length > SCHEDULE_NOTICE.scanLimit ||
        new Set(batch.data).size !== batch.data.length
      )
        return { ok: false, code: 'UNAVAILABLE' };
      if (batch.data.length === 0) return { ok: true, data: summary };
      for (const id of batch.data) {
        if (seen.has(id)) {
          summary.hasMore = true;
          continue;
        }
        if (!canWork()) {
          summary.hasMore = true;
          break;
        }
        seen.add(id);
        summary.examined++;
        try {
          const created = await deps.port.create(id);
          if (!created.ok) summary.failed++;
          else {
            if (created.data.created) summary.created++;
            else summary.skipped++;
            summary.pushJobsQueued += created.data.pushJobs;
          }
        } catch {
          summary.failed++;
        }
      }
      // A repeated page can be ineligible after a concurrent change or a commit
      // response can be lost. Never spin or falsely count a replay as creation.
      if (summary.hasMore) break;
      if (batch.data.length < SCHEDULE_NOTICE.scanLimit)
        return { ok: true, data: summary };
      if (page === SCHEDULE_NOTICE.workerPages - 1) summary.hasMore = true;
    }
    if (!canWork()) summary.hasMore = true;
    return { ok: true, data: summary };
  } catch {
    return { ok: false, code: 'UNAVAILABLE' };
  }
}
