import { z } from 'zod';
import {
  ACTIVITY_REWARDS,
  activitySnapshotSchema,
  type ActivitySnapshot,
} from '@/config/activity-rewards';
import {
  POINTS_ERROR_STATUS,
  pointCursorSchema,
  pointBefore,
  type PointsResult,
  type PointsError,
  type PointCursor,
} from '@/config/attendance-points';
import { activityRewardsHistoryPath } from '@/config/routes';

export async function fetchActivitySnapshot(
  cursor: PointCursor | null,
  signal?: AbortSignal,
  actorKey?: string,
): Promise<PointsResult<ActivitySnapshot>> {
  const input = pointCursorSchema.nullable().safeParse(cursor);
  if (!input.success) return { ok: false, code: 'INVALID_INPUT' };
  const actor = z.uuid().toLowerCase().safeParse(actorKey);
  if (!actor.success) return { ok: false, code: 'FORBIDDEN' };
  if (signal?.aborted) return { ok: false, code: 'UNAVAILABLE' };
  try {
    const timeout = AbortSignal.timeout(ACTIVITY_REWARDS.requestTimeoutMs);
    const response = await fetch(
      activityRewardsHistoryPath(
        input.data ? JSON.stringify(input.data) : null,
      ),
      {
        method: 'GET',
        headers: { [ACTIVITY_REWARDS.actorHeader]: actor.data },
        credentials: 'same-origin',
        cache: 'no-store',
        redirect: 'error',
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      },
    );
    if (
      response.headers.get('content-type')?.split(';')[0]?.trim() !==
      'application/json'
    )
      return { ok: false, code: 'UNAVAILABLE' };
    const reader = response.body?.getReader();
    if (!reader) return { ok: false, code: 'UNAVAILABLE' };
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let bytes = 0;
    let text = '';
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > ACTIVITY_REWARDS.responseMaxBytes) {
          await reader.cancel();
          return { ok: false, code: 'UNAVAILABLE' };
        }
        text += decoder.decode(value, { stream: true });
      }
      text += decoder.decode();
    } finally {
      reader.releaseLock();
    }
    const parsed = z
      .union([
        z.strictObject({ ok: z.literal(true), data: activitySnapshotSchema }),
        z.strictObject({ ok: z.literal(false), code: z.string() }),
      ])
      .safeParse(JSON.parse(text));
    if (!parsed.success || signal?.aborted || timeout.aborted)
      return { ok: false, code: 'UNAVAILABLE' };
    if (parsed.data.ok)
      return response.status === ACTIVITY_REWARDS.httpOk &&
        parsed.data.data.actor_id === actor.data &&
        (input.data === null ||
          parsed.data.data.entries.every((entry) =>
            pointBefore(entry, input.data!),
          ))
        ? parsed.data
        : { ok: false, code: 'UNAVAILABLE' };
    if (Object.hasOwn(POINTS_ERROR_STATUS, parsed.data.code)) {
      const code = parsed.data.code as PointsError;
      if (response.status === POINTS_ERROR_STATUS[code])
        return { ok: false, code };
    }
  } catch {
    /* Never log private reward history or session data. */
  }
  return { ok: false, code: 'UNAVAILABLE' };
}
