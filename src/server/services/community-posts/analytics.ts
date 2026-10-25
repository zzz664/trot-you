import 'server-only';
import { z } from 'zod';
import type { AnalyticsResult } from '@/config/analytics';

const observation = z.strictObject({
  actor_id: z.uuid(),
  event_key: z.uuid(),
  post_id: z.uuid(),
});
export type CommunityPostObservation = z.output<typeof observation>;
export type CommunityPostAnalyticsPort = {
  record(input: CommunityPostObservation): Promise<AnalyticsResult<null>>;
};
// Optional observation after a verified commit. The DB derives occurrence time
// and ownership from the persisted post and enforces current policy/consent.
export async function recordCommunityPostCreation(
  port: CommunityPostAnalyticsPort | null,
  input: unknown,
): Promise<AnalyticsResult<null>> {
  const parsed = observation.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'INVALID_INPUT' };
  if (!port) return { ok: false, code: 'SETUP_NOT_READY' };
  try {
    const result = await port.record(parsed.data);
    return result.ok && result.data !== null
      ? { ok: false, code: 'UNAVAILABLE' }
      : result;
  } catch {
    return { ok: false, code: 'UNAVAILABLE' };
  }
}
