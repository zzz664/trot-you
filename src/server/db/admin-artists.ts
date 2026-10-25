import 'server-only';
import { z } from 'zod';
import {
  adminArtistSchema,
  adminArtistListSchema,
  adminArtistDetailSchema,
  artistInvitationSchema,
  artistAccountInvitationsSchema,
  type AdminArtistError,
  type AdminArtistResult,
} from '@/config/admin-artists';
import type { AdminArtistPort } from '@/server/services/admin-artists/manage';
import type { ActorClient } from './client';
const errors: Record<string, AdminArtistError> = {
  ADMIN_ARTIST_FORBIDDEN: 'FORBIDDEN',
  ADMIN_ARTIST_INVALID_INPUT: 'INVALID_INPUT',
  ADMIN_ARTIST_NOT_FOUND: 'NOT_FOUND',
  ADMIN_ARTIST_REVISION_CONFLICT: 'CONFLICT',
  ADMIN_ARTIST_OPERATION_CONFLICT: 'CONFLICT',
  ADMIN_ARTIST_SETUP_NOT_READY: 'SETUP_NOT_READY',
  ADMIN_ARTIST_INVITATION_EXPIRED: 'INVITATION_EXPIRED',
  ADMIN_ARTIST_INVITATION_CLOSED: 'INVITATION_CLOSED',
  ADMIN_ARTIST_ACCOUNT_UNAVAILABLE: 'ACCOUNT_UNAVAILABLE',
  ADMIN_ARTIST_PREVIEWS_INVALID: 'PREVIEWS_INVALID',
  ADMIN_ARTIST_SLUG_CONFLICT: 'SLUG_CONFLICT',
};
function parsed<T>(
  schema: z.ZodType<T>,
  data: unknown,
  error: { message: string } | null,
): AdminArtistResult<T> {
  if (error)
    return {
      ok: false,
      code: Object.hasOwn(errors, error.message)
        ? errors[error.message]!
        : 'UNAVAILABLE',
    };
  const result = schema.safeParse(data);
  return result.success
    ? { ok: true, data: result.data }
    : { ok: false, code: 'UNAVAILABLE' };
}
export function createAdminArtistPort(client: ActorClient): AdminArtistPort {
  return {
    async list(page) {
      const { data, error } = await client.rpc('admin_artist_list', {
        p_page: page,
      });
      return parsed(adminArtistListSchema, data, error);
    },
    async detail(id, page) {
      const { data, error } = await client.rpc('admin_artist_detail_page', {
        p_artist_id: id,
        p_page: page,
      });
      return parsed(adminArtistDetailSchema, data, error);
    },
    async save(input) {
      const { data, error } = await client.rpc('admin_artist_save', {
        p_artist_id: input.artist_id,
        p_operation_id: input.operation_id,
        p_expected_revision: input.expected_revision,
        p_input: input.input,
      });
      return parsed(adminArtistSchema, data, error);
    },
    async previews(input) {
      const { data, error } = await client.rpc('admin_artist_previews', {
        p_artist_id: input.artist_id,
        p_operation_id: input.operation_id,
        p_expected_revision: input.expected_revision,
        p_message_ids: input.message_ids,
      });
      return parsed(adminArtistSchema, data, error);
    },
    async invite(input) {
      const { data, error } = await client.rpc('admin_artist_invite', {
        p_artist_id: input.artist_id,
        p_target_user_id: input.target_user_id,
        p_is_manager: input.is_manager,
        p_operation_id: input.operation_id,
        p_expected_revision: input.expected_revision,
        p_confirmed: input.confirmed,
      });
      return parsed(artistInvitationSchema, data, error);
    },
    async cancelInvite(input) {
      const { data, error } = await client.rpc('admin_artist_cancel_invite', {
        p_invitation_id: input.invitation_id,
        p_operation_id: input.operation_id,
        p_expected_revision: input.expected_revision,
        p_confirmed: input.confirmed,
      });
      return parsed(artistInvitationSchema, data, error);
    },
    async unlink(input) {
      const { data, error } = await client.rpc('admin_artist_unlink', {
        p_artist_id: input.artist_id,
        p_target_user_id: input.target_user_id,
        p_operation_id: input.operation_id,
        p_expected_revision: input.expected_revision,
        p_confirmed: input.confirmed,
      });
      return parsed(adminArtistSchema, data, error);
    },
    async invitations(page) {
      const { data, error } = await client.rpc(
        'artist_account_invitations_page',
        { p_page: page },
      );
      return parsed(artistAccountInvitationsSchema, data, error);
    },
    async respond(input) {
      const { data, error } = await client.rpc('artist_account_respond', {
        p_invitation_id: input.invitation_id,
        p_operation_id: input.operation_id,
        p_expected_revision: input.expected_revision,
        p_accept: input.accept,
        p_confirmed: input.confirmed,
      });
      return parsed(artistInvitationSchema, data, error);
    },
  };
}
