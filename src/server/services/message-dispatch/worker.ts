import 'server-only';
import {
  DISPATCH_WORKER_LIMIT,
  dispatchWorkerSummarySchema,
  type DispatchWorkerSummary,
} from '@/config/message-dispatch';

type WorkerResult =
  | { ok: true; data: DispatchWorkerSummary }
  | { ok: false; code: 'UNAVAILABLE' };
export type DispatchWorkerPort = { run(limit: number): Promise<WorkerResult> };
export async function dispatchDueMessages(
  port: DispatchWorkerPort,
): Promise<WorkerResult> {
  try {
    // One bounded database transaction; never drain indefinitely, call a
    // provider, or repeat an uncertain transaction inside the same request.
    const result = await port.run(DISPATCH_WORKER_LIMIT);
    if (!result.ok) return { ok: false, code: 'UNAVAILABLE' };
    const parsed = dispatchWorkerSummarySchema.safeParse(result.data);
    return parsed.success
      ? { ok: true, data: parsed.data }
      : { ok: false, code: 'UNAVAILABLE' };
  } catch {
    return { ok: false, code: 'UNAVAILABLE' };
  }
}
