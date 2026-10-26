import 'server-only';
import { z } from 'zod';
import { serverAnalyticsEventSchema } from '@/config/analytics-events';
import {
  ANALYTICS_ERROR_STATUS,
  type AnalyticsResult,
} from '@/config/analytics';

const serverObservation = z.strictObject({
  actor_id: z.uuid(),
  event: serverAnalyticsEventSchema,
});
const cancellationObservation = z.strictObject({
  actor_id: z.uuid(),
  subscription_id: z.uuid(),
});
export type ServerObservation = z.output<typeof serverObservation>;
export type CancellationObservation = z.output<typeof cancellationObservation>;
export type AnalyticsCapturePort = {
  server(
    input: ServerObservation,
    signal?: AbortSignal,
  ): Promise<AnalyticsResult<null>>;
  charge(eventId: string, signal?: AbortSignal): Promise<AnalyticsResult<null>>;
  cancellation(
    input: CancellationObservation,
    signal?: AbortSignal,
  ): Promise<AnalyticsResult<null>>;
};

async function optionalCapture<T>(
  port: AnalyticsCapturePort | null,
  schema: z.ZodType<T>,
  input: unknown,
  send: (
    port: AnalyticsCapturePort,
    input: T,
  ) => Promise<AnalyticsResult<null>>,
  signal?: AbortSignal,
): Promise<AnalyticsResult<null>> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'INVALID_INPUT' };
  if (signal?.aborted) return { ok: false, code: 'UNAVAILABLE' };
  if (!port) return { ok: false, code: 'SETUP_NOT_READY' };
  try {
    const result = await send(port, parsed.data);
    if (result.ok === true && result.data === null)
      return { ok: true, data: null };
    if (
      result.ok === false &&
      Object.hasOwn(ANALYTICS_ERROR_STATUS, result.code)
    )
      return { ok: false, code: result.code };
    return { ok: false, code: 'UNAVAILABLE' };
  } catch {
    // Optional observation never retries or alters the committed source operation.
    return { ok: false, code: 'UNAVAILABLE' };
  }
}
export function captureServerEvent(
  port: AnalyticsCapturePort | null,
  input: unknown,
  signal?: AbortSignal,
) {
  return optionalCapture(
    port,
    serverObservation,
    input,
    (value, parsed) => value.server(parsed, signal),
    signal,
  );
}
// Charge classification and source identity come exclusively from the verified
// immutable ledger. Callers cannot label an initial charge as a renewal.
export function captureChargeEvent(
  port: AnalyticsCapturePort | null,
  eventId: unknown,
  signal?: AbortSignal,
) {
  return optionalCapture(
    port,
    z.uuid(),
    eventId,
    (value, parsed) => value.charge(parsed, signal),
    signal,
  );
}
export function captureCancellation(
  port: AnalyticsCapturePort | null,
  input: unknown,
  signal?: AbortSignal,
) {
  return optionalCapture(
    port,
    cancellationObservation,
    input,
    (value, parsed) => value.cancellation(parsed, signal),
    signal,
  );
}
