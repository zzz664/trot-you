import 'server-only';
import {
  BILLING_NOTICE,
  type BillingNoticeCreated,
  type BillingNoticeResult,
  type BillingNoticeWorkerSummary,
} from '@/config/billing-notices';
export type BillingNoticeQueuePort = {
  candidates(limit: number): Promise<BillingNoticeResult<string[]>>;
  create(
    subscriptionId: string,
  ): Promise<BillingNoticeResult<BillingNoticeCreated>>;
};
export type BillingNoticeQueueDependencies = {
  port: BillingNoticeQueuePort;
  now(): number;
};

// This creates a durable in-app notice and queues optional push only. It never
// contacts a provider, charges money, or asserts delivery/read/renewal evidence.
export async function createDueBillingNotices(
  deps: BillingNoticeQueueDependencies,
): Promise<BillingNoticeResult<BillingNoticeWorkerSummary>> {
  const startedAt = deps.now();
  const canWork = () => deps.now() - startedAt < BILLING_NOTICE.workerBudgetMs;
  const summary: BillingNoticeWorkerSummary = {
    examined: 0,
    created: 0,
    skipped: 0,
    failed: 0,
    pushJobsQueued: 0,
    hasMore: false,
  };
  const seen = new Set<string>();
  try {
    for (let page = 0; page < BILLING_NOTICE.workerPages && canWork(); page++) {
      const batch = await deps.port.candidates(BILLING_NOTICE.scanLimit);
      if (
        !batch.ok ||
        batch.data.length > BILLING_NOTICE.scanLimit ||
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
      if (batch.data.length < BILLING_NOTICE.scanLimit)
        return { ok: true, data: summary };
      if (page === BILLING_NOTICE.workerPages - 1) summary.hasMore = true;
    }
    if (!canWork()) summary.hasMore = true;
    return { ok: true, data: summary };
  } catch {
    return { ok: false, code: 'UNAVAILABLE' };
  }
}
