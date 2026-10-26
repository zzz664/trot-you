// @vitest-environment node
import { expect, it, vi } from 'vitest';
import {
  ACTIVITY_REWARDS,
  activitySnapshotSchema,
  activityEntrySchema,
  activityRuleSchema,
} from '@/config/activity-rewards';
import { POINTS_ERROR_STATUS } from '@/config/attendance-points';
import {
  getActivitySnapshot,
  resolveActivityCursor,
} from '@/server/services/activity-rewards/manage';
import * as f from './activity-rewards-fixtures';
const ok = (data: unknown) => ({ ok: true, data });
const port = () => ({
  snapshot: vi.fn().mockResolvedValue(ok(f.activitySnapshot)),
});
it('reads only the bound actor without creating rewards or approving policy', async () => {
  const p = port();
  expect(await getActivitySnapshot(p, null, f.activityActor)).toEqual(
    ok(f.activitySnapshot),
  );
  expect(p.snapshot).toHaveBeenCalledExactlyOnceWith(null);
});
it.each(['', 'bad'])('invalid actor %# stops before IO', async (actor) => {
  const p = port();
  expect(await getActivitySnapshot(p, null, actor)).toEqual({
    ok: false,
    code: 'INVALID_INPUT',
  });
  expect(p.snapshot).not.toHaveBeenCalled();
});
it.each([
  undefined,
  {},
  { id: f.activityEntry.id },
  { created_at: f.activityTime },
  { id: 'bad', created_at: f.activityTime },
  { id: f.activityEntry.id, created_at: 'infinity' },
  {
    id: f.activityEntry.id,
    created_at: f.activityTime,
    user_id: f.activityOther,
  },
])('rejects malformed cursor %# before IO', async (cursor) => {
  const p = port();
  expect(await getActivitySnapshot(p, cursor, f.activityActor)).toEqual({
    ok: false,
    code: 'INVALID_INPUT',
  });
  expect(p.snapshot).not.toHaveBeenCalled();
});
it.each([
  null,
  {},
  { ...f.activitySnapshot, private: true },
  { ...f.activitySnapshot, actor_id: f.activityOther },
])('rejects malformed or unbound output %#', async (data) => {
  const p = port();
  p.snapshot.mockResolvedValue(ok(data));
  expect(await getActivitySnapshot(p, null, f.activityActor)).toEqual({
    ok: false,
    code: 'UNAVAILABLE',
  });
});
it.each(Object.keys(POINTS_ERROR_STATUS))(
  'preserves safe error %s',
  async (code) => {
    const p = port();
    p.snapshot.mockResolvedValue({ ok: false, code });
    expect(await getActivitySnapshot(p, null, f.activityActor)).toEqual({
      ok: false,
      code,
    });
  },
);
it('conceals thrown SQL details', async () => {
  const p = port();
  p.snapshot.mockRejectedValue(new Error('private SQL'));
  expect(await getActivitySnapshot(p, null, f.activityActor)).toEqual({
    ok: false,
    code: 'UNAVAILABLE',
  });
});
it('bounds history by precise cursor rather than millisecond approximation', async () => {
  const p = port(),
    cursor = {
      id: f.activityEntry.id,
      created_at: '2026-10-26T06:00:00.123457Z',
    };
  expect(await getActivitySnapshot(p, cursor, f.activityActor)).toEqual(
    ok(f.activitySnapshot),
  );
  expect(p.snapshot).toHaveBeenCalledExactlyOnceWith(cursor);
  expect(
    await getActivitySnapshot(
      p,
      { ...cursor, created_at: f.activityTime },
      f.activityActor,
    ),
  ).toEqual({ ok: false, code: 'UNAVAILABLE' });
});
it('allows missing policy with preserved historical receipts and no inferred defaults', () => {
  expect(
    activitySnapshotSchema.parse({
      ...f.activitySnapshot,
      contribution_policy: null,
    }).contribution_policy,
  ).toBeNull();
});
it('does not infer historical amounts from current policy or current browser day', () => {
  const data = {
    ...f.activitySnapshot,
    kst_date: '2099-01-01',
    contribution_policy: {
      ...f.activitySnapshot.contribution_policy!,
      post: { ...f.activityRule, amount: 0 },
    },
    entries: [{ ...f.activityEntry, earned_on: '2020-01-01' }],
  };
  expect(activitySnapshotSchema.safeParse(data).success).toBe(true);
});
it.each([
  { ...f.activityRule, daily_cap: null, remaining: null },
  { amount: 0, daily_cap: 0, used: 0, awarded: 0, remaining: 0 },
  { amount: 0, daily_cap: 2, used: 9, awarded: 3, remaining: 0 },
  { ...f.activityRule, amount: Number.MAX_SAFE_INTEGER },
])(
  'accepts explicit unlimited/zero/exhausted rules without changing cap semantics %#',
  (rule) => {
    expect(activityRuleSchema.safeParse(rule).success).toBe(true);
  },
);
it.each([
  { amount: -1 },
  { amount: 1.5 },
  { amount: Number.MAX_SAFE_INTEGER + 1 },
  { daily_cap: -1 },
  { daily_cap: 1.5 },
  { daily_cap: ACTIVITY_REWARDS.dailyCapMax + 1 },
  { daily_cap: null },
  { remaining: null },
  { remaining: 0 },
  { remaining: -1 },
  { used: -1 },
  { used: Number.MAX_SAFE_INTEGER + 1 },
  { awarded: -1 },
  { awarded: 2 },
  { private: true },
])('rejects incoherent current rule %#', (extra) => {
  expect(
    activityRuleSchema.safeParse({ ...f.activityRule, ...extra }).success,
  ).toBe(false);
});
it.each([
  { outcome: 'awarded', amount: 1 },
  { outcome: 'zero_amount', amount: 0 },
  { outcome: 'daily_cap', amount: 0 },
  { outcome: 'legacy', amount: 0 },
  { outcome: 'legacy', amount: 99 },
])('accepts explicit receipt evidence %#', (extra) => {
  expect(
    activityEntrySchema.safeParse({ ...f.activityEntry, ...extra }).success,
  ).toBe(true);
});
it.each([
  { outcome: 'awarded', amount: 0 },
  { outcome: 'zero_amount', amount: 7 },
  { outcome: 'daily_cap', amount: 7 },
  { outcome: 'legacy', amount: -1 },
  { outcome: 'unconfigured' },
  { reason: 'attendance' },
  { reason: 'share' },
  { reason: 'admin_adjust' },
  { reason: 'mission' },
  { amount: Number.MAX_SAFE_INTEGER + 1 },
  { post_id: f.activityEntry.id },
  { policy_snapshot: {} },
  { ref_id: 'private' },
  { created_at: '2026-10-26T06:00:00.1234567Z' },
  { earned_on: '2026-02-30' },
])('rejects invented outcomes or hidden source data %#', (extra) => {
  expect(
    activityEntrySchema.safeParse({ ...f.activityEntry, ...extra }).success,
  ).toBe(false);
});
it.each([
  { share: { configured: true, reason: 'verification_unconfigured' } },
  { share: { configured: false, reason: 'click_verified' } },
  {
    share: {
      configured: false,
      reason: 'verification_unconfigured',
      amount: 5,
    },
  },
  { missions: { configured: true, reason: 'rules_unconfigured' } },
  { grade: { configured: true, reason: 'score_definition_unconfigured' } },
  {
    grade: {
      configured: false,
      reason: 'score_definition_unconfigured',
      score: 0,
    },
  },
  { kst_date: '0000-01-01' },
  { kst_date: '2026-02-30' },
  { entries: [f.activityEntry, f.activityEntry] },
  { next_cursor: { id: f.activityEntry.id, created_at: f.activityTime } },
])(
  'rejects unsupported capability or incoherent private snapshot %#',
  (extra) => {
    expect(
      activitySnapshotSchema.safeParse({ ...f.activitySnapshot, ...extra })
        .success,
    ).toBe(false);
  },
);
it.each([
  { version: '' },
  { version: '   ' },
  { version: 'x'.repeat(ACTIVITY_REWARDS.policyVersionMax + 1) },
  { deleted_content_treatment: 'clawback' },
  { private: true },
])('rejects malformed policy %#', (extra) => {
  expect(
    activitySnapshotSchema.safeParse({
      ...f.activitySnapshot,
      contribution_policy: {
        ...f.activitySnapshot.contribution_policy,
        ...extra,
      },
    }).success,
  ).toBe(false);
});
it('requires exact full-page cursor, descending ordering and uniqueness', () => {
  const data = f.activityPage();
  expect(activitySnapshotSchema.safeParse(data).success).toBe(true);
  expect(
    activitySnapshotSchema.safeParse({
      ...data,
      entries: [...data.entries].reverse(),
    }).success,
  ).toBe(false);
  expect(
    activitySnapshotSchema.safeParse({
      ...data,
      entries: [...data.entries, f.activityEntry],
    }).success,
  ).toBe(false);
  expect(
    activitySnapshotSchema.safeParse({
      ...data,
      next_cursor: { ...data.next_cursor!, id: f.activityOther },
    }).success,
  ).toBe(false);
  expect(
    activitySnapshotSchema.safeParse({
      ...data,
      next_cursor: {
        ...data.next_cursor!,
        created_at: '2026-10-26T15:00:00.123456+09:00',
      },
    }).success,
  ).toBe(true);
});
it('reuses bounded encoded cursor parsing without accepting caller-supplied policy', () => {
  expect(resolveActivityCursor({})).toEqual({ ok: true, data: null });
  expect(resolveActivityCursor({ cursor: 'null' })).toEqual({
    ok: true,
    data: null,
  });
  const cursor = { created_at: f.activityTime, id: f.activityEntry.id };
  expect(resolveActivityCursor({ cursor: JSON.stringify(cursor) })).toEqual(
    ok(cursor),
  );
  expect(resolveActivityCursor({ policy: 'approved' })).toEqual({
    ok: false,
    code: 'INVALID_INPUT',
  });
});
it('normalizes actor UUID case before comparing identity', async () => {
  const p = port(),
    actor = 'ABCDEF12-0000-4000-8000-000000000001';
  p.snapshot.mockResolvedValue(ok({ ...f.activitySnapshot, actor_id: actor }));
  expect(await getActivitySnapshot(p, null, actor)).toEqual(
    ok({ ...f.activitySnapshot, actor_id: actor.toLowerCase() }),
  );
});

it('matches PostgreSQL policy version character bounds for supplementary Unicode', () => {
  const policy = f.activitySnapshot.contribution_policy!;
  expect(
    activitySnapshotSchema.safeParse({
      ...f.activitySnapshot,
      contribution_policy: {
        ...policy,
        version: '🌱'.repeat(ACTIVITY_REWARDS.policyVersionMax),
      },
    }).success,
  ).toBe(true);
  expect(
    activitySnapshotSchema.safeParse({
      ...f.activitySnapshot,
      contribution_policy: {
        ...policy,
        version: '🌱'.repeat(ACTIVITY_REWARDS.policyVersionMax + 1),
      },
    }).success,
  ).toBe(false);
});
