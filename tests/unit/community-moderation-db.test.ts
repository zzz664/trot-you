// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { COMMUNITY_MODERATION } from '@/config/community-moderation';
import { createCommunityModerationPort } from '@/server/db/community-moderation';
import type { ActorClient } from '@/server/db/client';
import * as f from './community-moderation-fixtures';
function fixture(data: unknown, error: { message: string } | null = null) {
  const rpc = vi.fn().mockResolvedValue({ data, error });
  return {
    rpc,
    port: createCommunityModerationPort({ rpc } as unknown as ActorClient),
  };
}
const cases = [
  [
    'context',
    f.moderationTarget,
    f.moderationContext,
    { p_target_type: 'post', p_target_id: f.moderationTarget.target_id },
  ],
  [
    'queue',
    null,
    f.moderationQueue,
    { p_limit: COMMUNITY_MODERATION.pageSize },
  ],
  [
    'notices',
    null,
    f.moderationNotices,
    { p_limit: COMMUNITY_MODERATION.pageSize },
  ],
  [
    'report',
    f.moderationReportInput,
    f.moderationReported,
    {
      p_operation_id: f.moderationReportInput.operation_id,
      p_target_type: 'post',
      p_target_id: f.moderationTarget.target_id,
      p_reason: f.moderationReportInput.reason,
    },
  ],
  [
    'resolve',
    f.moderationResolveInput,
    f.moderationResolved,
    {
      p_operation_id: f.moderationResolveInput.operation_id,
      p_report_id: f.moderationReport.id,
      p_expected_revision: 1,
      p_decision: 'restore',
      p_reason: f.moderationResolveInput.reason,
      p_confirmed: true,
    },
  ],
  [
    'restrict',
    f.moderationRestrictInput,
    f.moderationRestricted,
    {
      p_operation_id: f.moderationRestrictInput.operation_id,
      p_user_id: f.moderationOther,
      p_expected_updated_at: f.moderationTime,
      p_restricted: true,
      p_until: f.moderationRestrictInput.until,
      p_reason: f.moderationRestrictInput.reason,
      p_confirmed: true,
    },
  ],
] as const;
for (const [method, input, output, args] of cases) {
  it(`${method} invokes only actor-bound RPC with original inputs`, async () => {
    const p = fixture(output);
    // This dispatch exists only in a parameterized test; production port is typed per RPC.
    const call = p.port[method] as (value: unknown) => Promise<unknown>;
    expect(await call(input)).toEqual({ ok: true, data: output });
    expect(p.rpc).toHaveBeenCalledExactlyOnceWith(
      `community_moderation_${method}`,
      args,
    );
  });
  it.each([null, {}, { raw: 'secret' }])(
    `${method} rejects malformed RPC output %#`,
    async (data) => {
      const p = fixture(data),
        call = p.port[method] as (value: unknown) => Promise<unknown>;
      expect(await call(input)).toEqual({ ok: false, code: 'UNAVAILABLE' });
    },
  );
}
it.each(['queue', 'notices'] as const)(
  '%s forwards cursor timestamp without precision loss',
  async (method) => {
    const p = fixture(
      method === 'queue' ? f.moderationQueue : f.moderationNotices,
    );
    await p.port[method]({
      created_at: f.moderationTime,
      id: f.moderationReport.id,
    });
    expect(p.rpc).toHaveBeenCalledExactlyOnceWith(
      `community_moderation_${method}`,
      {
        p_limit: COMMUNITY_MODERATION.pageSize,
        p_before_created_at: f.moderationTime,
        p_before_id: f.moderationReport.id,
      },
    );
  },
);
it('unrestriction omits optional timestamp instead of inventing expiry', async () => {
  const p = fixture({
    ...f.moderationRestricted,
    is_restricted: false,
    restricted_until: null,
  });
  await p.port.restrict({
    ...f.moderationRestrictInput,
    restricted: false,
    until: null,
  });
  expect(p.rpc.mock.calls[0]![1]).toMatchObject({ p_restricted: false });
  expect(p.rpc.mock.calls[0]![1]).not.toHaveProperty('p_until');
});
it.each([
  ['COMMUNITY_FORBIDDEN', 'FORBIDDEN'],
  ['COMMUNITY_RESTRICTION_TARGET_FORBIDDEN', 'FORBIDDEN'],
  ['COMMUNITY_BOARD_UNAVAILABLE', 'NOT_FOUND'],
  ['COMMUNITY_TARGET_UNAVAILABLE', 'NOT_FOUND'],
  ['COMMUNITY_POLICY_REQUIRED', 'SETUP_NOT_READY'],
  ['COMMUNITY_POLICY_INVALID', 'SETUP_NOT_READY'],
  ['COMMUNITY_CONTENT_INVALID', 'INVALID_INPUT'],
  ['COMMUNITY_CONTENT_BLOCKED', 'CONTENT_BLOCKED'],
  ['COMMUNITY_RATE_LIMITED', 'RATE_LIMITED'],
  ['COMMUNITY_TARGET_REQUIRED', 'INVALID_INPUT'],
  ['COMMUNITY_REQUEST_REQUIRED', 'INVALID_INPUT'],
  ['COMMUNITY_RESTRICTION_INVALID', 'INVALID_INPUT'],
  ['COMMUNITY_DECISION_INVALID', 'INVALID_INPUT'],
  ['COMMUNITY_DELETED_TERMINAL', 'CONFLICT'],
  ['BOARD_INVALID_INPUT', 'INVALID_INPUT'],
  ['BOARD_FORBIDDEN', 'FORBIDDEN'],
  ['BOARD_NOT_FOUND', 'NOT_FOUND'],
  ['BOARD_TARGET_UNAVAILABLE', 'NOT_FOUND'],
  ['BOARD_REVISION_CONFLICT', 'CONFLICT'],
  ['BOARD_OPERATION_CONFLICT', 'CONFLICT'],
  ['MODERATION_REVISION_CONFLICT', 'CONFLICT'],
  ['MODERATION_OPERATION_CONFLICT', 'CONFLICT'],
  ['MODERATION_REPORT_RESOLVED', 'CONFLICT'],
  ['MODERATION_CONFIRMATION_REQUIRED', 'CONFIRMATION_REQUIRED'],
  ['unknown private SQL text', 'UNAVAILABLE'],
  ['__proto__', 'UNAVAILABLE'],
])('maps exact %s to %s without leaking raw SQL', async (message, code) => {
  const p = fixture(null, { message });
  expect(await p.port.context(f.moderationTarget)).toEqual({ ok: false, code });
});
