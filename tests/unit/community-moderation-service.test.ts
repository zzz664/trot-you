// @vitest-environment node
import { expect, it, vi } from 'vitest';
import {
  COMMUNITY_MODERATION,
  moderationBefore,
  moderationSameInstant,
  moderationQueueSchema,
  moderationReportInputSchema,
  moderationResolveInputSchema,
  moderationRestrictInputSchema,
  moderationNoticesSchema,
  moderationContextSchema,
} from '@/config/community-moderation';
import {
  getModerationContext,
  listModerationQueue,
  listModerationNotices,
  reportCommunityTarget,
  resolveModerationReport,
  restrictModerationUser,
  resolveModerationCursor,
} from '@/server/services/community-moderation/manage';
import * as f from './community-moderation-fixtures';
const ok = (data: unknown) => ({ ok: true, data });
function port() {
  return {
    context: vi.fn().mockResolvedValue(ok(f.moderationContext)),
    queue: vi.fn().mockResolvedValue(ok(f.moderationQueue)),
    notices: vi.fn().mockResolvedValue(ok(f.moderationNotices)),
    report: vi.fn().mockResolvedValue(ok(f.moderationReported)),
    resolve: vi.fn().mockResolvedValue(ok(f.moderationResolved)),
    restrict: vi.fn().mockResolvedValue(ok(f.moderationRestricted)),
  };
}
const writes = [
  [
    'report',
    reportCommunityTarget,
    f.moderationReportInput,
    f.moderationReported,
  ],
  [
    'resolve',
    resolveModerationReport,
    f.moderationResolveInput,
    f.moderationResolved,
  ],
  [
    'restrict',
    restrictModerationUser,
    f.moderationRestrictInput,
    f.moderationRestricted,
  ],
] as const;
const reads = [
  ['context', getModerationContext, f.moderationTarget, f.moderationContext],
  ['queue', listModerationQueue, null, f.moderationQueue],
  ['notices', listModerationNotices, null, f.moderationNotices],
] as const;
it.each(writes)(
  '%s preserves exact intent and validates receipt',
  async (method, call, input, output) => {
    const p = port();
    expect(await call(p, input)).toEqual(ok(output));
    expect(p[method]).toHaveBeenCalledExactlyOnceWith(input);
  },
);
it.each(reads)(
  '%s returns current-actor private data',
  async (method, call, input, output) => {
    const p = port();
    expect(await call(p, input, f.moderationActor)).toEqual(ok(output));
    expect(p[method]).toHaveBeenCalledExactlyOnceWith(input);
  },
);
for (const [method, call, input] of writes) {
  it.each([
    undefined,
    null,
    {},
    { ...input, unexpected: true },
    { ...input, operation_id: 'invalid' },
    { ...input, reason: '' },
    { ...input, reason: ' \n ' },
    { ...input, reason: 'x'.repeat(COMMUNITY_MODERATION.reasonMax + 1) },
    { ...input, reason: '\u0000' },
    { ...input, reason: '\ud800' },
  ])(`${method} rejects malformed input %# before IO`, async (value) => {
    const p = port();
    expect(await call(p, value)).toEqual({ ok: false, code: 'INVALID_INPUT' });
    expect(p[method]).not.toHaveBeenCalled();
  });
  it.each([null, {}, { bad: true }])(
    `${method} fails closed on malformed receipt %#`,
    async (output) => {
      const p = port();
      p[method].mockResolvedValue(ok(output));
      expect(await call(p, input)).toEqual({ ok: false, code: 'UNAVAILABLE' });
    },
  );
  it(`${method} preserves business error without logging`, async () => {
    const p = port();
    p[method].mockResolvedValue({ ok: false, code: 'CONFLICT' });
    expect(await call(p, input)).toEqual({ ok: false, code: 'CONFLICT' });
  });
  it(`${method} catches unavailable port`, async () => {
    const p = port();
    p[method].mockRejectedValue(new Error('private reason'));
    expect(await call(p, input)).toEqual({ ok: false, code: 'UNAVAILABLE' });
  });
}
for (const [method, call, input, output] of reads) {
  it(`${method} rejects actor mismatch`, async () => {
    const p = port();
    p[method].mockResolvedValue(ok({ ...output, actor_id: f.moderationOther }));
    expect(await call(p, input, f.moderationActor)).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
    });
  });
  it.each(['', 'bad'])(
    `${method} rejects invalid actor %s before IO`,
    async (actor) => {
      const p = port();
      expect(await call(p, input, actor)).toEqual({
        ok: false,
        code: 'INVALID_INPUT',
      });
      expect(p[method]).not.toHaveBeenCalled();
    },
  );
  it(`${method} catches unavailable port`, async () => {
    const p = port();
    p[method].mockRejectedValue(new Error('private'));
    expect(await call(p, input, f.moderationActor)).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
    });
  });
  it(`${method} preserves a denial`, async () => {
    const p = port();
    p[method].mockResolvedValue({ ok: false, code: 'FORBIDDEN' });
    expect(await call(p, input, f.moderationActor)).toEqual({
      ok: false,
      code: 'FORBIDDEN',
    });
  });
}
it.each(['target_type', 'target_id'] as const)(
  'binds context %s to input',
  async (key) => {
    const p = port();
    p.context.mockResolvedValue(
      ok({
        ...f.moderationContext,
        [key]: key === 'target_type' ? 'comment' : f.moderationOther,
      }),
    );
    expect(
      await getModerationContext(p, f.moderationTarget, f.moderationActor),
    ).toEqual({ ok: false, code: 'UNAVAILABLE' });
  },
);
it.each(['target_type', 'target_id'] as const)(
  'binds report receipt %s to input',
  async (key) => {
    const p = port();
    p.report.mockResolvedValue(
      ok({
        ...f.moderationReported,
        [key]: key === 'target_type' ? 'comment' : f.moderationOther,
      }),
    );
    expect(await reportCommunityTarget(p, f.moderationReportInput)).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
    });
  },
);
it.each([
  { report_id: f.moderationOther },
  { decision: 'delete' },
  { revision: 3 },
])('rejects mismatched resolve receipt %#', async (extra) => {
  const p = port();
  p.resolve.mockResolvedValue(ok({ ...f.moderationResolved, ...extra }));
  expect(await resolveModerationReport(p, f.moderationResolveInput)).toEqual({
    ok: false,
    code: 'UNAVAILABLE',
  });
});
it.each([
  { user_id: f.moderationActor },
  { is_restricted: false, restricted_until: null },
  { restricted_until: '2099-10-31T15:00:00.000001+00:00' },
])('rejects mismatched restriction receipt %#', async (extra) => {
  const p = port();
  p.restrict.mockResolvedValue(ok({ ...f.moderationRestricted, ...extra }));
  expect(await restrictModerationUser(p, f.moderationRestrictInput)).toEqual({
    ok: false,
    code: 'UNAVAILABLE',
  });
});
it('allows exact replay even after requested restriction expiry; current policy checked only by DB', async () => {
  const input = {
    ...f.moderationRestrictInput,
    until: '2000-01-01T00:00:00+09:00',
  };
  const p = port();
  p.restrict.mockResolvedValue(
    ok({ ...f.moderationRestricted, restricted_until: '1999-12-31T15:00:00Z' }),
  );
  expect((await restrictModerationUser(p, input)).ok).toBe(true);
});
it('unrestrict requires null expiry and retains explicit false', async () => {
  const p = port(),
    input = { ...f.moderationRestrictInput, restricted: false, until: null };
  const receipt = {
    ...f.moderationRestricted,
    is_restricted: false,
    restricted_until: null,
  };
  p.restrict.mockResolvedValue(ok(receipt));
  expect(await restrictModerationUser(p, input)).toEqual(ok(receipt));
});
it.each([false, undefined, null])(
  'resolution requires explicit confirmation %s',
  (confirmed) =>
    expect(
      moderationResolveInputSchema.safeParse({
        ...f.moderationResolveInput,
        confirmed,
      }).success,
    ).toBe(false),
);
it.each([false, undefined, null])(
  'restriction requires explicit confirmation %s',
  (confirmed) =>
    expect(
      moderationRestrictInputSchema.safeParse({
        ...f.moderationRestrictInput,
        confirmed,
      }).success,
    ).toBe(false),
);
it.each([{ restricted: false }, { until: null }, { until: 'Infinity' }])(
  'rejects invalid restriction bounds %#',
  (extra) =>
    expect(
      moderationRestrictInputSchema.safeParse({
        ...f.moderationRestrictInput,
        ...extra,
      }).success,
    ).toBe(false),
);
it.each(['user', '', null])(
  'rejects unsupported report type %s',
  (target_type) =>
    expect(
      moderationReportInputSchema.safeParse({
        ...f.moderationReportInput,
        target_type,
      }).success,
    ).toBe(false),
);
it('does not normalize reason text or astral Unicode', () => {
  const reason = '  이유\n😀\t ';
  expect(
    moderationReportInputSchema.parse({ ...f.moderationReportInput, reason })
      .reason,
  ).toBe(reason);
});
it('distinguishes microseconds and equivalent timezone timestamps', () => {
  const base = { created_at: f.moderationTime, id: f.moderationReport.id };
  expect(
    moderationBefore(
      { ...base, created_at: '2026-10-26T06:00:00.123455Z' },
      base,
    ),
  ).toBe(true);
  expect(moderationBefore({ ...base, id: f.moderationActor }, base)).toBe(true);
  expect(moderationBefore(base, base)).toBe(false);
  expect(
    moderationSameInstant(f.moderationTime, '2026-10-26T15:00:00.123456+09:00'),
  ).toBe(true);
});
it('parses the bounded optional cursor without normalization', () => {
  const cursor = { created_at: f.moderationTime, id: f.moderationReport.id };
  expect(resolveModerationCursor({})).toEqual(ok(null));
  expect(resolveModerationCursor({ cursor: JSON.stringify(cursor) })).toEqual(
    ok(cursor),
  );
});
it.each([
  null,
  { cursor: '' },
  { cursor: '{}' },
  { cursor: '{' },
  { cursor: 'x'.repeat(513) },
  { cursor: [], other: true },
])('rejects invalid cursor transport %#', (input) => {
  expect(resolveModerationCursor(input)).toEqual({
    ok: false,
    code: 'INVALID_INPUT',
  });
});
it.each([null, {}, { target_type: 'post', target_id: 'bad' }])(
  'rejects malformed context request %#',
  async (input) => {
    const p = port();
    expect(await getModerationContext(p, input, f.moderationActor)).toEqual({
      ok: false,
      code: 'INVALID_INPUT',
    });
    expect(p.context).not.toHaveBeenCalled();
  },
);
it.each(['queue', 'notices'] as const)(
  'rejects %s items at or above cursor',
  async (kind) => {
    const p = port(),
      call = kind === 'queue' ? listModerationQueue : listModerationNotices;
    expect(
      await call(
        p,
        { created_at: f.moderationTime, id: f.moderationActor },
        f.moderationActor,
      ),
    ).toEqual({ ok: false, code: 'UNAVAILABLE' });
  },
);
it.each([0, 10001, null])(
  'fails closed on invalid approved reason maximum %s',
  (max_reason_length) =>
    expect(
      moderationContextSchema.safeParse({
        ...f.moderationContext,
        max_reason_length,
      }).success,
    ).toBe(false),
);
it.each([
  { reports: [f.moderationReport, f.moderationReport] },
  { reports: Array(21).fill(f.moderationReport) },
  { next_cursor: { created_at: f.moderationTime, id: f.moderationReport.id } },
  { reports: [{ ...f.moderationReport, resolved_at: f.moderationTime }] },
  { reports: [{ ...f.moderationReport, status: 'restored' }] },
  {
    reports: [
      {
        ...f.moderationReport,
        target: { ...f.moderationReport.target, post_id: null },
      },
    ],
  },
  { reports: [{ ...f.moderationReport, target_type: 'reply' }] },
])('rejects malformed queue shape or order %#', (extra) =>
  expect(
    moderationQueueSchema.safeParse({ ...f.moderationQueue, ...extra }).success,
  ).toBe(false),
);
it('rejects duplicate inbox notices and unsupported decisions', () => {
  expect(
    moderationNoticesSchema.safeParse({
      ...f.moderationNotices,
      notices: [f.moderationNotices.notices[0], f.moderationNotices.notices[0]],
    }).success,
  ).toBe(false);
  expect(
    moderationNoticesSchema.safeParse({
      ...f.moderationNotices,
      notices: [{ ...f.moderationNotices.notices[0], decision: 'hidden' }],
    }).success,
  ).toBe(false);
});
it('accepts a full valid descending page with last-row cursor and Unicode code-point title limit', () => {
  const reports = Array.from(
    { length: COMMUNITY_MODERATION.pageSize },
    (_, index) => ({
      ...f.moderationReport,
      id: `10000000-0000-4000-8000-${String(100 - index).padStart(12, '0')}`,
      target: { ...f.moderationReport.target, title: '😀'.repeat(1000) },
    }),
  );
  const last = reports.at(-1)!;
  expect(
    moderationQueueSchema.safeParse({
      actor_id: f.moderationActor,
      reports,
      next_cursor: { id: last.id, created_at: last.created_at },
    }).success,
  ).toBe(true);
  expect(
    moderationQueueSchema.safeParse({
      actor_id: f.moderationActor,
      reports,
      next_cursor: { id: reports[0]!.id, created_at: last.created_at },
    }).success,
  ).toBe(false);
});
