import 'server-only';
import {
  clientAnalyticsEventSchema,
  type ClientAnalyticsEventInput,
} from '@/config/analytics-events';
import type { AnalyticsResult } from '@/config/analytics';

export type AnalyticsPort = {
  record(
    input: ClientAnalyticsEventInput,
    signal?: AbortSignal,
  ): Promise<AnalyticsResult<null>>;
};

// Actor identity is the request-bound DB capability, not client JSON. This
// generic client-observation boundary cannot ingest server/charge events.
export async function track(
  port: AnalyticsPort,
  input: unknown,
  signal?: AbortSignal,
): Promise<AnalyticsResult<null>> {
  const parsed = clientAnalyticsEventSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'INVALID_INPUT' };
  if (signal?.aborted) return { ok: false, code: 'UNAVAILABLE' };
  try {
    return await port.record(parsed.data, signal);
  } catch {
    return { ok: false, code: 'UNAVAILABLE' };
  }
}
