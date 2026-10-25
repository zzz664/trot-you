import type {
  CommunityList,
  CommunityDetail,
  CommunityCreateInput,
  CommunityDeleteInput,
  CommunityNoticeInput,
} from '@/config/community-posts';
export const boardActorId = 'b4000000-0000-4000-8000-000000000001';
export const boardArtistId = 'b4000000-0000-4000-8000-000000000002';
export const boardPostId = 'b4000000-0000-4000-8000-000000000003';
export const boardOtherId = 'b4000000-0000-4000-8000-000000000004';
export const boardOperationId = 'b4000000-0000-4000-8000-000000000005';
export const boardImageId = 'b4000000-0000-4000-8000-000000000006';
export const boardArtist = {
  id: boardArtistId,
  slug: 'first-artist',
  name: '첫 가수',
};
export const boardPolicy = {
  max_title_length: 100,
  max_body_length: 1000,
  max_images: 3,
  max_image_bytes: 1048576,
  max_image_long_edge: 4096,
};
export const boardSummary = {
  id: boardPostId,
  artist_id: boardArtistId,
  author: { call_name: '팬님' },
  is_owner: true,
  title: '함께 응원해요',
  is_notice: false,
  is_pinned: false,
  created_at: '2026-10-25T10:00:00.000001+00:00',
  updated_at: '2026-10-25T10:00:00.000001+00:00',
  revision: 1,
  image_count: 0,
};
export const boardList: CommunityList = {
  actor_id: boardActorId,
  artist: boardArtist,
  policy: boardPolicy,
  can_create_notice: false,
  posts: [boardSummary],
  next_cursor: null,
};
export const boardDetail: CommunityDetail = {
  actor_id: boardActorId,
  artist: boardArtist,
  policy: boardPolicy,
  can_create_notice: false,
  post: {
    ...boardSummary,
    body: '오늘도 좋은 노래 고맙습니다. {이름}',
    images: [],
  },
};
export const boardCreate: CommunityCreateInput = {
  operation_id: boardOperationId,
  post_id: boardPostId,
  artist_id: boardArtistId,
  title: boardSummary.title,
  body: boardDetail.post.body,
  upload_ids: [],
  is_notice: false,
  is_pinned: false,
};
export const boardDelete: CommunityDeleteInput = {
  operation_id: boardOperationId,
  post_id: boardPostId,
  expected_revision: 1,
  confirmed: true,
};
export const boardNotice: CommunityNoticeInput = {
  operation_id: boardOperationId,
  post_id: boardPostId,
  expected_revision: 1,
  is_notice: true,
  is_pinned: true,
};
export const boardCreated = {
  id: boardPostId,
  artist_id: boardArtistId,
  revision: 1,
};
export const boardDeleted = { id: boardPostId, deleted: true as const };
export const boardNoticeReceipt = {
  id: boardPostId,
  artist_id: boardArtistId,
  revision: 2,
  is_notice: true,
  is_pinned: true,
};
export const boardImage = {
  id: boardImageId,
  mime_type: 'image/png' as const,
  byte_size: 300,
  width: 32,
  height: 32,
};
