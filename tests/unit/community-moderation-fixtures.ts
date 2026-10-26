import type {
  ModerationContext,
  ModerationReport,
  ModerationQueue,
  ModerationNotices,
  ModerationReportInput,
  ModerationResolveInput,
  ModerationRestrictInput,
  ModerationRestrictReceipt,
  ModerationResolveReceipt,
} from '@/config/community-moderation';
export const moderationActor = '10000000-0000-4000-8000-000000000001';
export const moderationOther = '10000000-0000-4000-8000-000000000002';
export const moderationTarget = {
  target_type: 'post' as const,
  target_id: '10000000-0000-4000-8000-000000000003',
};
export const moderationTime = '2026-10-26T06:00:00.123456+00:00';
export const moderationContext: ModerationContext = {
  actor_id: moderationActor,
  ...moderationTarget,
  max_reason_length: 1000,
  existing_report: null,
};
export const moderationReport: ModerationReport = {
  id: '10000000-0000-4000-8000-000000000004',
  ...moderationTarget,
  reason: '개인 연락처가 포함되어 있어요.',
  status: 'hidden',
  created_at: moderationTime,
  resolved_at: null,
  target: {
    artist: {
      id: '10000000-0000-4000-8000-000000000005',
      slug: 'first-artist',
      name: '가수',
    },
    post_id: moderationTarget.target_id,
    title: '검토할 게시글',
    body: '본문',
    is_hidden: true,
    deleted_at: null,
    revision: 1,
    report_count: 2,
    owner: {
      id: moderationOther,
      call_name: '다정한 팬',
      is_restricted: false,
      restricted_until: null,
      updated_at: moderationTime,
      can_restrict: true,
    },
  },
};
export const moderationQueue: ModerationQueue = {
  actor_id: moderationActor,
  reports: [moderationReport],
  next_cursor: null,
};
export const moderationNotices: ModerationNotices = {
  actor_id: moderationActor,
  notices: [
    {
      id: '10000000-0000-4000-8000-000000000006',
      report_id: moderationReport.id,
      decision: 'restored',
      created_at: moderationTime,
    },
  ],
  next_cursor: null,
};
export const moderationReportInput: ModerationReportInput = {
  operation_id: '10000000-0000-4000-8000-000000000007',
  ...moderationTarget,
  reason: '신고할 이유입니다.',
};
export const moderationReported = {
  id: moderationReport.id,
  ...moderationTarget,
};
export const moderationResolveInput: ModerationResolveInput = {
  operation_id: '10000000-0000-4000-8000-000000000008',
  report_id: moderationReport.id,
  expected_revision: 1,
  decision: 'restore',
  reason: '문제가 없어 복원합니다.',
  confirmed: true,
};
export const moderationResolved: ModerationResolveReceipt = {
  report_id: moderationReport.id,
  ...moderationTarget,
  decision: 'restore',
  revision: 2,
};
export const moderationRestrictInput: ModerationRestrictInput = {
  operation_id: '10000000-0000-4000-8000-000000000009',
  user_id: moderationOther,
  expected_updated_at: moderationTime,
  restricted: true,
  until: '2099-11-01T00:00:00+09:00',
  reason: '반복 위반으로 이용을 제한합니다.',
  confirmed: true,
};
export const moderationRestricted: ModerationRestrictReceipt = {
  user_id: moderationOther,
  is_restricted: true,
  restricted_until: '2099-10-31T15:00:00+00:00',
  updated_at: '2026-10-26T06:01:00+00:00',
};
