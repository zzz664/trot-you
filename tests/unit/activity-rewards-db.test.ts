// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { ACTIVITY_REWARDS } from '@/config/activity-rewards';
import { createActivityRewardsPort } from '@/server/db/activity-rewards';
import type { ActorClient } from '@/server/db/client';
import * as f from './activity-rewards-fixtures';
function fixture(data: unknown, error: { message: string } | null = null) {
  const rpc = vi.fn().mockResolvedValue({ data, error });
  return {
    rpc,
    port: createActivityRewardsPort({ rpc } as unknown as ActorClient),
  };
}
it('reads only the current actor activity RPC with fixed transport limit', async () => {
  const p = fixture(f.activitySnapshot);
  expect(await p.port.snapshot(null)).toEqual({
    ok: true,
    data: f.activitySnapshot,
  });
  expect(p.rpc).toHaveBeenCalledExactlyOnceWith('point_ui_activity', {
    p_limit: ACTIVITY_REWARDS.pageSize,
  });
});
it('forwards precise cursor without caller identity, amount or completion data', async () => {
  const p = fixture(f.activitySnapshot);
  await p.port.snapshot({ id: f.activityEntry.id, created_at: f.activityTime });
  expect(p.rpc).toHaveBeenCalledExactlyOnceWith('point_ui_activity', {
    p_limit: ACTIVITY_REWARDS.pageSize,
    p_before_created_at: f.activityTime,
    p_before_id: f.activityEntry.id,
  });
});
it.each([
  null,
  {},
  { raw: 'private' },
  { ...f.activitySnapshot, post_id: f.activityEntry.id },
])('rejects malformed/private RPC output %#', async (data) => {
  expect(await fixture(data).port.snapshot(null)).toEqual({
    ok: false,
    code: 'UNAVAILABLE',
  });
});
it.each([
  ['COMMUNITY_FORBIDDEN', 'FORBIDDEN'],
  ['POINT_ACTOR_REQUIRED', 'FORBIDDEN'],
  ['POINT_PAGE_INVALID', 'INVALID_INPUT'],
  ['POINT_ACTIVITY_COUNT_OUT_OF_RANGE', 'UNAVAILABLE'],
  ['BOARD_ISOLATION_UNSUPPORTED', 'UNAVAILABLE'],
  ['unknown private SQL', 'UNAVAILABLE'],
  ['__proto__', 'UNAVAILABLE'],
])('maps exact safe %s to %s', async (message, code) => {
  expect(await fixture(null, { message }).port.snapshot(null)).toEqual({
    ok: false,
    code,
  });
});
it('missing contribution policy is readable, not a guessed default or setup failure', async () => {
  const data = { ...f.activitySnapshot, contribution_policy: null };
  expect(await fixture(data).port.snapshot(null)).toEqual({ ok: true, data });
});
