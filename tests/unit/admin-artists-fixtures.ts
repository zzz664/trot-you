import type {
  AdminArtist,
  AdminArtistDetail,
  ArtistInvitation,
} from '@/config/admin-artists';
export const artistId = '00000000-0000-4000-8000-000000000001';
export const operationId = '00000000-0000-4000-8000-000000000002';
export const targetId = '00000000-0000-4000-8000-000000000003';
export const artistInput = {
  slug: 'fictional-artist',
  name: '가상 가수',
  intro: null,
  status: 'active' as const,
  grade: 'B' as const,
  agency_name: null,
  contract_started_at: null,
  contract_ended_at: null,
  display_order: 0,
};
export const artist: AdminArtist = {
  ...artistInput,
  id: artistId,
  revision: 1,
  updated_at: '2026-10-25T00:00:00Z',
};
export const invitation: ArtistInvitation = {
  id: operationId,
  artist_id: artistId,
  artist_name: artist.name,
  target_user_id: targetId,
  is_manager: false,
  state: 'pending',
  revision: 1,
  expires_at: '2026-10-26T00:00:00Z',
};
export const detail: AdminArtistDetail = {
  artist,
  previews: [],
  messages: [],
  members: [],
  invitations: [invitation],
  account_link_ready: true,
  preview_max_count: 5,
  messages_has_more: false,
  members_has_more: false,
  invitations_has_more: false,
};
export const saveInput = {
  artist_id: artistId,
  operation_id: operationId,
  expected_revision: 0,
  input: artistInput,
};
export const previewsInput = {
  artist_id: artistId,
  operation_id: operationId,
  expected_revision: 1,
  message_ids: [],
};
export const inviteInput = {
  artist_id: artistId,
  operation_id: operationId,
  expected_revision: 1,
  target_user_id: targetId,
  is_manager: false,
  confirmed: true as const,
};
export const cancelInput = {
  invitation_id: operationId,
  operation_id: artistId,
  expected_revision: 1,
  confirmed: true as const,
};
export const unlinkInput = {
  artist_id: artistId,
  target_user_id: targetId,
  operation_id: operationId,
  expected_revision: 1,
  confirmed: true as const,
};
export const respondInput = { ...cancelInput, accept: true };
