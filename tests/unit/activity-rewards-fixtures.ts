import type {
  ActivityEntry,
  ActivityRule,
  ActivitySnapshot,
} from '@/config/activity-rewards';
export const activityActor = '30000000-0000-4000-8000-000000000001';
export const activityOther = '30000000-0000-4000-8000-000000000002';
export const activityTime = '2026-10-26T06:00:00.123456+00:00';
export const activityEntry: ActivityEntry = {
  id: '30000000-0000-4000-8000-000000000003',
  amount: 7,
  reason: 'post',
  earned_on: '2026-10-26',
  created_at: activityTime,
  outcome: 'awarded',
};
export const activityRule: ActivityRule = {
  amount: 7,
  daily_cap: 3,
  used: 1,
  awarded: 1,
  remaining: 2,
};
export const activitySnapshot: ActivitySnapshot = {
  actor_id: activityActor,
  kst_date: '2026-10-26',
  contribution_policy: {
    version: 'fictional-unit-only',
    post: activityRule,
    comment: {
      amount: 2,
      daily_cap: null,
      used: 0,
      awarded: 0,
      remaining: null,
    },
    deleted_content_treatment: 'retain',
  },
  share: { configured: false, reason: 'verification_unconfigured' },
  missions: { configured: false, reason: 'rules_unconfigured' },
  grade: { configured: false, reason: 'score_definition_unconfigured' },
  entries: [activityEntry],
  next_cursor: null,
};
export function activityPage(count = 20): ActivitySnapshot {
  const entries = Array.from({ length: count }, (_, index) => ({
    ...activityEntry,
    id: `40000000-0000-4000-8000-${String(count - index).padStart(12, '0')}`,
  }));
  const last = entries.at(-1);
  return {
    ...activitySnapshot,
    entries,
    next_cursor: last ? { created_at: last.created_at, id: last.id } : null,
  };
}
