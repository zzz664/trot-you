// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
import type { ActorClient } from '@/server/db/client';
import { createAdminArtistPort } from '@/server/db/admin-artists';
import {
  artist,
  artistId,
  targetId,
  detail,
  invitation,
  saveInput,
  previewsInput,
  inviteInput,
  cancelInput,
  unlinkInput,
  respondInput,
} from './admin-artists-fixtures';
const rpc = vi.fn();
const port = createAdminArtistPort({ rpc } as unknown as ActorClient);
beforeEach(() => {
  rpc.mockReset();
  rpc.mockResolvedValue({ data: artist, error: null });
});
it('reads bounded authenticated list projection', async () => {
  rpc.mockResolvedValue({
    data: { artists: [artist], has_more: false },
    error: null,
  });
  expect((await port.list(2)).ok).toBe(true);
  expect(rpc).toHaveBeenCalledWith('admin_artist_list', { p_page: 2 });
});
it('reads admin detail without service actor or provider credentials', async () => {
  rpc.mockResolvedValue({ data: detail, error: null });
  expect(await port.detail(artistId, 1)).toEqual({ ok: true, data: detail });
  expect(rpc).toHaveBeenCalledWith('admin_artist_detail_page', {
    p_artist_id: artistId,
    p_page: 1,
  });
});
it('saves exact revision, stable operation ID and strict fields', async () => {
  expect(await port.save(saveInput)).toEqual({ ok: true, data: artist });
  expect(rpc).toHaveBeenCalledWith('admin_artist_save', {
    p_artist_id: saveInput.artist_id,
    p_operation_id: saveInput.operation_id,
    p_expected_revision: 0,
    p_input: saveInput.input,
  });
});
it('replaces preview order atomically through sole audited CAS RPC', async () => {
  await port.previews(previewsInput);
  expect(rpc).toHaveBeenCalledWith('admin_artist_previews', {
    p_artist_id: artistId,
    p_operation_id: previewsInput.operation_id,
    p_expected_revision: 1,
    p_message_ids: [],
  });
});
it('issues exact-user request with explicit admin confirmation', async () => {
  rpc.mockResolvedValue({ data: invitation, error: null });
  expect(await port.invite(inviteInput)).toEqual({
    ok: true,
    data: invitation,
  });
  expect(rpc).toHaveBeenCalledWith('admin_artist_invite', {
    p_artist_id: artistId,
    p_target_user_id: inviteInput.target_user_id,
    p_is_manager: false,
    p_operation_id: inviteInput.operation_id,
    p_expected_revision: 1,
    p_confirmed: true,
  });
});
it('cancels invite using invitation revision', async () => {
  rpc.mockResolvedValue({ data: invitation, error: null });
  await port.cancelInvite(cancelInput);
  expect(rpc).toHaveBeenCalledWith('admin_artist_cancel_invite', {
    p_invitation_id: cancelInput.invitation_id,
    p_operation_id: cancelInput.operation_id,
    p_expected_revision: 1,
    p_confirmed: true,
  });
});
it('unlinks only named membership with artist CAS', async () => {
  await port.unlink(unlinkInput);
  expect(rpc).toHaveBeenCalledWith('admin_artist_unlink', {
    p_artist_id: artistId,
    p_target_user_id: unlinkInput.target_user_id,
    p_operation_id: unlinkInput.operation_id,
    p_expected_revision: 1,
    p_confirmed: true,
  });
});
it('reads current recipient-only invitations without any actor argument', async () => {
  const result = {
    user_id: targetId,
    invitations: [invitation],
    account_link_ready: false,
    has_more: false,
  };
  rpc.mockResolvedValue({ data: result, error: null });
  expect(await port.invitations(1)).toEqual({ ok: true, data: result });
  expect(rpc).toHaveBeenCalledWith('artist_account_invitations_page', {
    p_page: 1,
  });
});
it('responds without choosing identity/role from client payload', async () => {
  rpc.mockResolvedValue({ data: invitation, error: null });
  await port.respond(respondInput);
  expect(rpc).toHaveBeenCalledWith('artist_account_respond', {
    p_invitation_id: respondInput.invitation_id,
    p_operation_id: respondInput.operation_id,
    p_expected_revision: 1,
    p_accept: true,
    p_confirmed: true,
  });
});
it.each([
  ['FORBIDDEN', 'FORBIDDEN'],
  ['INVALID_INPUT', 'INVALID_INPUT'],
  ['NOT_FOUND', 'NOT_FOUND'],
  ['REVISION_CONFLICT', 'CONFLICT'],
  ['OPERATION_CONFLICT', 'CONFLICT'],
  ['SETUP_NOT_READY', 'SETUP_NOT_READY'],
  ['INVITATION_EXPIRED', 'INVITATION_EXPIRED'],
  ['INVITATION_CLOSED', 'INVITATION_CLOSED'],
  ['ACCOUNT_UNAVAILABLE', 'ACCOUNT_UNAVAILABLE'],
  ['PREVIEWS_INVALID', 'PREVIEWS_INVALID'],
  ['SLUG_CONFLICT', 'SLUG_CONFLICT'],
  ['PRIVATE_FAILURE', 'UNAVAILABLE'],
])('maps database %s without exposing raw text', async (error, code) => {
  rpc.mockResolvedValue({
    data: null,
    error: { message: `ADMIN_ARTIST_${error}` },
  });
  expect(await port.save(saveInput)).toEqual({ ok: false, code });
});
it.each([
  null,
  { ...artist, revision: -1 },
  { ...artist, unknown: 'credential' },
  { ...artist, role: 'admin' },
  { ...artist, updated_at: 'never' },
])('fails malformed projection closed %#', async (data) => {
  rpc.mockResolvedValue({ data, error: null });
  expect(await port.save(saveInput)).toEqual({
    ok: false,
    code: 'UNAVAILABLE',
  });
});
it('bounds detail arrays and refuses raw media paths', async () => {
  rpc.mockResolvedValue({
    data: {
      ...detail,
      messages: [
        {
          id: artistId,
          kind: 'photo',
          body: null,
          sent_at: artist.updated_at,
          is_preview: false,
          preview_order: null,
          media: [
            {
              id: artistId,
              kind: 'photo',
              width: 1,
              height: 1,
              duration_ms: null,
              path: 'private',
            },
          ],
        },
      ],
    },
    error: null,
  });
  expect(await port.detail(artistId, 1)).toEqual({
    ok: false,
    code: 'UNAVAILABLE',
  });
});
it('rejects a recipient projection whose rows do not belong to its current subject', async () => {
  rpc.mockResolvedValue({
    data: {
      user_id: artistId,
      invitations: [invitation],
      account_link_ready: true,
      has_more: false,
    },
    error: null,
  });
  expect(await port.invitations(1)).toEqual({ ok: false, code: 'UNAVAILABLE' });
});
