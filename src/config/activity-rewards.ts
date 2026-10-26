import { z } from 'zod';
import {
  ATTENDANCE_POINTS,
  pointCursorSchema,
  pointEntrySchema,
  pointBefore,
  pointSameInstant,
} from './attendance-points';

// Transport bounds only. No amount, cap, score or completion rule is approved here.
export const ACTIVITY_REWARDS = {
  pageSize: ATTENDANCE_POINTS.pageSize,
  actorHeader: ATTENDANCE_POINTS.actorHeader,
  timeZone: ATTENDANCE_POINTS.timeZone,
  requestTimeoutMs: ATTENDANCE_POINTS.requestTimeoutMs,
  responseMaxBytes: ATTENDANCE_POINTS.responseMaxBytes,
  httpOk: ATTENDANCE_POINTS.httpOk,
  policyVersionMax: 100,
  dailyCapMax: 2147483647,
} as const;
const count = z.number().int().safe().nonnegative();
export const activityRuleSchema = z
  .strictObject({
    amount: count,
    daily_cap: count.max(ACTIVITY_REWARDS.dailyCapMax).nullable(),
    used: count,
    awarded: count,
    remaining: count.max(ACTIVITY_REWARDS.dailyCapMax).nullable(),
  })
  .refine(
    (rule) =>
      rule.awarded <= rule.used &&
      (rule.daily_cap === null
        ? rule.remaining === null
        : rule.remaining === Math.max(0, rule.daily_cap - rule.used)),
  );
export type ActivityRule = z.output<typeof activityRuleSchema>;
export const activityEntrySchema = pointEntrySchema
  .safeExtend({
    reason: z.enum(['post', 'comment']),
    outcome: z.enum(['awarded', 'zero_amount', 'daily_cap', 'legacy']),
  })
  .refine((entry) =>
    entry.outcome === 'legacy'
      ? true
      : entry.outcome === 'awarded'
        ? entry.amount > 0
        : entry.amount === 0,
  );
export type ActivityEntry = z.output<typeof activityEntrySchema>;
export const activitySnapshotSchema = z
  .strictObject({
    actor_id: z.uuid().toLowerCase(),
    kst_date: pointEntrySchema.shape.earned_on,
    contribution_policy: z
      .strictObject({
        version: z.string().max(ACTIVITY_REWARDS.policyVersionMax).regex(/\S/),
        post: activityRuleSchema,
        comment: activityRuleSchema,
        deleted_content_treatment: z.literal('retain'),
      })
      .nullable(),
    // Completion verification and grade-score definitions remain unspecified.
    // A future configured capability requires its own approved implementation;
    // an unexpected true flag fails closed, rather than displaying fake readiness.
    share: z.strictObject({
      configured: z.literal(false),
      reason: z.literal('verification_unconfigured'),
    }),
    missions: z.strictObject({
      configured: z.literal(false),
      reason: z.literal('rules_unconfigured'),
    }),
    grade: z.strictObject({
      configured: z.literal(false),
      reason: z.literal('score_definition_unconfigured'),
    }),
    entries: z.array(activityEntrySchema).max(ACTIVITY_REWARDS.pageSize),
    next_cursor: pointCursorSchema.nullable(),
  })
  .refine((snapshot) => {
    const ids = new Set<string>();
    for (let index = 0; index < snapshot.entries.length; index += 1) {
      const entry = snapshot.entries[index]!;
      if (
        ids.has(entry.id) ||
        (index > 0 && !pointBefore(entry, snapshot.entries[index - 1]!))
      )
        return false;
      ids.add(entry.id);
    }
    const last = snapshot.entries.at(-1);
    return (
      snapshot.next_cursor === null ||
      (snapshot.entries.length === ACTIVITY_REWARDS.pageSize &&
        last !== undefined &&
        last.id === snapshot.next_cursor.id &&
        pointSameInstant(last.created_at, snapshot.next_cursor.created_at))
    );
  });
export type ActivitySnapshot = z.output<typeof activitySnapshotSchema>;
