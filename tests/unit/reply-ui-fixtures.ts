import type { OwnReply, ReplyPage, ReplyReceipt } from '@/config/replies';
export const replyUiIds = {
  first: 'd3000000-0000-4000-8000-000000000001',
  second: 'd3000000-0000-4000-8000-000000000002',
  older: 'd3000000-0000-4000-8000-000000000003',
  operation: 'd4000000-0000-4000-8000-000000000001',
  operation2: 'd4000000-0000-4000-8000-000000000002',
  message: 'd5000000-0000-4000-8000-000000000001',
};
export const replyUiSlug = 'fictional-singer';
export function ownReply(overrides: Partial<OwnReply> = {}): OwnReply {
  return {
    id: replyUiIds.first,
    operationId: replyUiIds.operation,
    messageId: null,
    body: '항상 응원해요.',
    blocked: false,
    createdAt: '2026-10-24T02:03:04.123456+00:00',
    ...overrides,
  };
}
export function replyUiPage(overrides: Partial<ReplyPage> = {}): ReplyPage {
  return {
    slug: replyUiSlug,
    maxLength: 100,
    sendReady: true,
    replies: [],
    nextCursor: null,
    ...overrides,
  };
}
export function replyUiReceipt(
  overrides: Partial<OwnReply> = {},
): ReplyReceipt {
  return { slug: replyUiSlug, reply: ownReply(overrides) };
}
