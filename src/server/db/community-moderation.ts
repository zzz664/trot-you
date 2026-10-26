import 'server-only';
import { z } from 'zod';
import {
  COMMUNITY_MODERATION,
  moderationContextSchema,
  moderationQueueSchema,
  moderationNoticesSchema,
  moderationReportReceiptSchema,
  moderationResolveReceiptSchema,
  moderationRestrictReceiptSchema,
  type ModerationCursor,
} from '@/config/community-moderation';
import type { CommunityError, CommunityResult } from '@/config/community-posts';
import type { CommunityModerationPort } from '@/server/services/community-moderation/manage';
import type { ActorClient } from './client';
const errors: Record<string, CommunityError> = {
  COMMUNITY_FORBIDDEN: 'FORBIDDEN',
  COMMUNITY_RESTRICTION_TARGET_FORBIDDEN: 'FORBIDDEN',
  COMMUNITY_BOARD_UNAVAILABLE: 'NOT_FOUND',
  COMMUNITY_TARGET_UNAVAILABLE: 'NOT_FOUND',
  COMMUNITY_POLICY_REQUIRED: 'SETUP_NOT_READY',
  COMMUNITY_POLICY_INVALID: 'SETUP_NOT_READY',
  COMMUNITY_CONTENT_INVALID: 'INVALID_INPUT',
  COMMUNITY_CONTENT_BLOCKED: 'CONTENT_BLOCKED',
  COMMUNITY_RATE_LIMITED: 'RATE_LIMITED',
  COMMUNITY_TARGET_REQUIRED: 'INVALID_INPUT',
  COMMUNITY_REQUEST_REQUIRED: 'INVALID_INPUT',
  COMMUNITY_RESTRICTION_INVALID: 'INVALID_INPUT',
  COMMUNITY_DECISION_INVALID: 'INVALID_INPUT',
  COMMUNITY_DELETED_TERMINAL: 'CONFLICT',
  BOARD_INVALID_INPUT: 'INVALID_INPUT',
  BOARD_FORBIDDEN: 'FORBIDDEN',
  BOARD_NOT_FOUND: 'NOT_FOUND',
  BOARD_TARGET_UNAVAILABLE: 'NOT_FOUND',
  BOARD_REVISION_CONFLICT: 'CONFLICT',
  BOARD_OPERATION_CONFLICT: 'CONFLICT',
  MODERATION_REVISION_CONFLICT: 'CONFLICT',
  MODERATION_REPORT_RESOLVED: 'CONFLICT',
  MODERATION_OPERATION_CONFLICT: 'CONFLICT',
  MODERATION_CONFIRMATION_REQUIRED: 'CONFIRMATION_REQUIRED',
};
function parsed<T>(
  schema: z.ZodType<T>,
  data: unknown,
  error: { message: string } | null,
): CommunityResult<T> {
  if (error)
    return {
      ok: false,
      code: Object.hasOwn(errors, error.message)
        ? errors[error.message]!
        : 'UNAVAILABLE',
    };
  const value = schema.safeParse(data);
  return value.success
    ? { ok: true, data: value.data }
    : { ok: false, code: 'UNAVAILABLE' };
}
function pagination(cursor: ModerationCursor | null) {
  return {
    p_limit: COMMUNITY_MODERATION.pageSize,
    ...(cursor === null
      ? {}
      : { p_before_created_at: cursor.created_at, p_before_id: cursor.id }),
  };
}
export function createCommunityModerationPort(
  client: ActorClient,
): CommunityModerationPort {
  return {
    async context(target) {
      const { data, error } = await client.rpc('community_moderation_context', {
        p_target_type: target.target_type,
        p_target_id: target.target_id,
      });
      return parsed(moderationContextSchema, data, error);
    },
    async queue(cursor) {
      const { data, error } = await client.rpc(
        'community_moderation_queue',
        pagination(cursor),
      );
      return parsed(moderationQueueSchema, data, error);
    },
    async notices(cursor) {
      const { data, error } = await client.rpc(
        'community_moderation_notices',
        pagination(cursor),
      );
      return parsed(moderationNoticesSchema, data, error);
    },
    async report(input) {
      const { data, error } = await client.rpc('community_moderation_report', {
        p_operation_id: input.operation_id,
        p_target_type: input.target_type,
        p_target_id: input.target_id,
        p_reason: input.reason,
      });
      return parsed(moderationReportReceiptSchema, data, error);
    },
    async resolve(input) {
      const { data, error } = await client.rpc('community_moderation_resolve', {
        p_operation_id: input.operation_id,
        p_report_id: input.report_id,
        p_expected_revision: input.expected_revision,
        p_decision: input.decision,
        p_reason: input.reason,
        p_confirmed: input.confirmed,
      });
      return parsed(moderationResolveReceiptSchema, data, error);
    },
    async restrict(input) {
      const { data, error } = await client.rpc(
        'community_moderation_restrict',
        {
          p_operation_id: input.operation_id,
          p_user_id: input.user_id,
          p_expected_updated_at: input.expected_updated_at,
          p_restricted: input.restricted,
          ...(input.until === null ? {} : { p_until: input.until }),
          p_reason: input.reason,
          p_confirmed: input.confirmed,
        },
      );
      return parsed(moderationRestrictReceiptSchema, data, error);
    },
  };
}
