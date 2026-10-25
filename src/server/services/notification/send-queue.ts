import 'server-only';
import {
  WEBPUSH,
  type WebPushResult,
  type WebPushWorkerSummary,
} from '@/config/webpush';
import { routes } from '@/config/routes';

export type WebPushOutcome =
  | 'provider_accepted'
  | 'not_sent'
  | 'unknown'
  | 'dead_endpoint'
  | 'permanent_failure';
export type WebPushLease = { jobId: string; token: string; expiresAt: string };
export type WebPushDelivery = WebPushLease & {
  sourceKind: 'message' | 'billing_notice' | 'schedule';
  endpoint: string;
  p256dh: string;
  auth: string;
};
export type WebPushQueuePort = {
  uncertain(limit: number): Promise<WebPushResult<WebPushLease[]>>;
  recover(lease: WebPushLease): Promise<WebPushResult<string>>;
  due(limit: number): Promise<WebPushResult<string[]>>;
  claim(jobId: string): Promise<WebPushResult<WebPushLease | null>>;
  prepare(lease: WebPushLease): Promise<WebPushResult<WebPushDelivery | null>>;
  complete(
    lease: WebPushLease,
    outcome: WebPushOutcome,
    evidenceRef: string,
    retryAfterSeconds?: number,
  ): Promise<WebPushResult<string>>;
};
export type WebPushDeliveryChannel = {
  send(input: {
    endpoint: string;
    p256dh: string;
    auth: string;
    payload: string;
    topic: string;
  }): Promise<{ outcome: WebPushOutcome; retryAfterSeconds?: number }>;
};
export type WebPushQueueDependencies = {
  port: WebPushQueuePort;
  channel: WebPushDeliveryChannel;
  now(): number;
  evidenceId(): string;
};

// A finite pool, never Promise.all over an unbounded recipient list. The same
// invocation deadline covers recovery and sending. No automatic scheduler is
// created here; a separately authorized operator enables the protected route.
async function pool<T>(
  items: readonly T[],
  run: (item: T) => Promise<void>,
  continueWork: () => boolean,
) {
  let offset = 0;
  await Promise.all(
    Array.from({ length: WEBPUSH.concurrency }, async () => {
      while (offset < items.length && continueWork()) {
        const item = items[offset++];
        if (item !== undefined) await run(item);
      }
    }),
  );
}

export async function sendWebPushQueue(
  deps: WebPushQueueDependencies,
): Promise<WebPushResult<WebPushWorkerSummary>> {
  const startedAt = deps.now();
  const canWork = () => deps.now() - startedAt < WEBPUSH.workerBudgetMs;
  const summary: WebPushWorkerSummary = {
    examined: 0,
    recoveryChecked: 0,
    acceptedByPushService: 0,
    skipped: 0,
    uncertain: 0,
    failed: 0,
    hasMore: false,
  };
  try {
    const uncertain = await deps.port.uncertain(WEBPUSH.recoveryLimit);
    if (!uncertain.ok || uncertain.data.length > WEBPUSH.recoveryLimit)
      return { ok: false, code: 'UNAVAILABLE' };
    await pool(
      uncertain.data,
      async (lease) => {
        if (Date.parse(lease.expiresAt) > deps.now()) return;
        const result = await deps.port.recover(lease);
        if (!result.ok) throw new Error('RECOVERY_UNAVAILABLE');
        summary.recoveryChecked++;
      },
      canWork,
    );
    if (!canWork()) return { ok: true, data: { ...summary, hasMore: true } };
    const seen = new Set<string>();
    summary.hasMore = uncertain.data.length === WEBPUSH.recoveryLimit;
    for (let page = 0; page < WEBPUSH.maxWorkerPages && canWork(); page++) {
      const due = await deps.port.due(WEBPUSH.batchSize);
      if (
        !due.ok ||
        due.data.length > WEBPUSH.batchSize ||
        new Set(due.data).size !== due.data.length
      )
        return { ok: false, code: 'UNAVAILABLE' };
      if (due.data.length === 0) break;
      const candidates = due.data.filter((id) => !seen.has(id));
      if (candidates.length === 0) {
        summary.hasMore = true;
        break;
      }
      let pageExamined = 0;
      await pool(
        candidates,
        async (jobId) => {
          summary.examined++;
          pageExamined++;
          seen.add(jobId);
          let lease: WebPushLease | null = null;
          try {
            const claim = await deps.port.claim(jobId);
            if (!claim.ok) {
              summary.failed++;
              return;
            }
            lease = claim.data;
            if (!lease) {
              summary.skipped++;
              return;
            }
            if (lease.jobId !== jobId) {
              summary.uncertain++;
              return;
            }
            const prepared = await deps.port.prepare(lease);
            if (!prepared.ok) {
              summary.uncertain++;
              return;
            }
            if (!prepared.data) {
              summary.skipped++;
              return;
            }
            const delivery = prepared.data;
            if (
              delivery.jobId !== lease.jobId ||
              delivery.token !== lease.token ||
              !Number.isFinite(Date.parse(delivery.expiresAt)) ||
              Date.parse(delivery.expiresAt) - deps.now() <
                WEBPUSH.minimumLeaseRemainingMs ||
              !canWork()
            ) {
              // No external request started. DB records evidence of a definite
              // non-send; stale tokens are rejected rather than recycled locally.
              const result = await deps.port.complete(
                lease,
                'not_sent',
                deps.evidenceId(),
              );
              if (result.ok) summary.skipped++;
              else summary.uncertain++;
              return;
            }
            const sent = await deps.channel.send({
              endpoint: delivery.endpoint,
              p256dh: delivery.p256dh,
              auth: delivery.auth,
              payload: JSON.stringify({
                version: 1,
                notificationId: jobId,
                ...(delivery.sourceKind === 'billing_notice'
                  ? { kind: 'billing_notice', url: routes.billingNotices }
                  : delivery.sourceKind === 'schedule'
                    ? { kind: 'schedule_notice', url: routes.schedules }
                    : { url: routes.subscriptions }),
              }),
              // Stable per-job topic coalesces pending duplicates at compatible
              // push services; it is NOT an exactly-once guarantee or read receipt.
              topic: jobId.replaceAll('-', ''),
            });
            let outcome = sent.outcome;
            const retryAfter = sent.retryAfterSeconds;
            const safeRetryAfter =
              typeof retryAfter === 'number' &&
              Number.isInteger(retryAfter) &&
              retryAfter >= 0 &&
              retryAfter <= WEBPUSH.retryAfterMaxSeconds
                ? retryAfter
                : undefined;
            // An invalid/unsupported provider wait must never accidentally
            // become an earlier fallback retry through a future adapter.
            if (retryAfter !== undefined && safeRetryAfter === undefined)
              outcome = 'permanent_failure';
            const evidence = deps.evidenceId();
            const completed =
              safeRetryAfter === undefined
                ? await deps.port.complete(lease, outcome, evidence)
                : await deps.port.complete(
                    lease,
                    outcome,
                    evidence,
                    safeRetryAfter,
                  );
            if (!completed.ok) {
              summary.uncertain++;
              return;
            }
            if (outcome === 'provider_accepted')
              summary.acceptedByPushService++;
            else if (outcome === 'unknown') summary.uncertain++;
            else summary.failed++;
          } catch {
            // Transport/commit ambiguity is never misreported as not_sent. Leave
            // durable lease recovery to the DB if even this completion fails.
            if (lease) {
              try {
                await deps.port.complete(lease, 'unknown', deps.evidenceId());
              } catch {
                /* recovery owns this lease */
              }
            }
            summary.uncertain++;
          }
        },
        canWork,
      );
      if (pageExamined < candidates.length || !canWork()) {
        summary.hasMore = true;
        break;
      }
      if (due.data.length < WEBPUSH.batchSize) break;
      if (page === WEBPUSH.maxWorkerPages - 1) summary.hasMore = true;
    }
    if (!canWork()) summary.hasMore = true;
    return { ok: true, data: summary };
  } catch {
    return { ok: false, code: 'UNAVAILABLE' };
  }
}
