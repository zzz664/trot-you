import type {
  CommunityInteractions,
  CommunityCommentCreateInput,
  CommunityCommentUpdateInput,
  CommunityCommentDeleteInput,
  CommunityLikeInput,
} from '@/config/community-interactions';
export const interactionsActorId = 'c5000000-0000-4000-8000-000000000001';
export const interactionsPostId = 'c5000000-0000-4000-8000-000000000002';
export const interactionsCommentId = 'c5000000-0000-4000-8000-000000000003';
export const interactionsOperationId = 'c5000000-0000-4000-8000-000000000004';
export const interactionsOtherId = 'c5000000-0000-4000-8000-000000000005';
export const interactionsSlug = 'first-artist';
export const interactionsComment = {
  id: interactionsCommentId,
  post_id: interactionsPostId,
  author: { call_name: '응원팬' },
  is_owner: true,
  body: '따뜻한 노래 고마워요. {이름}',
  created_at: '2026-10-25T10:00:00.000001+00:00',
  updated_at: '2026-10-25T10:00:00.000001+00:00',
  revision: 1,
};
export const interactionsPage: CommunityInteractions = {
  actor_id: interactionsActorId,
  post_id: interactionsPostId,
  policy: { max_comment_length: 1000 },
  like_count: 0,
  comment_count: 1,
  liked: false,
  comments: [interactionsComment],
  next_cursor: null,
};
export const interactionsQuery = {
  slug: interactionsSlug,
  post_id: interactionsPostId,
  cursor: null,
};
export const interactionsCreate: CommunityCommentCreateInput = {
  operation_id: interactionsOperationId,
  post_id: interactionsPostId,
  comment_id: interactionsCommentId,
  body: interactionsComment.body,
};
export const interactionsUpdate: CommunityCommentUpdateInput = {
  ...interactionsCreate,
  expected_revision: 1,
};
export const interactionsDelete: CommunityCommentDeleteInput = {
  operation_id: interactionsOperationId,
  post_id: interactionsPostId,
  comment_id: interactionsCommentId,
  expected_revision: 1,
  confirmed: true,
};
export const interactionsLike: CommunityLikeInput = {
  operation_id: interactionsOperationId,
  post_id: interactionsPostId,
  liked: true,
};
export const interactionsCreated = {
  id: interactionsCommentId,
  post_id: interactionsPostId,
  revision: 1,
};
export const interactionsUpdated = { ...interactionsCreated, revision: 2 };
export const interactionsDeleted = {
  id: interactionsCommentId,
  post_id: interactionsPostId,
  deleted: true as const,
};
export const interactionsLiked = { post_id: interactionsPostId, liked: true };
