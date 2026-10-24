import type { ChatPage, ChatMessage } from '@/config/chat';
export const chatUiIds = {
  first: 'd1000000-0000-4000-8000-000000000001',
  second: 'd1000000-0000-4000-8000-000000000002',
  older: 'd1000000-0000-4000-8000-000000000003',
  media: 'd2000000-0000-4000-8000-000000000001',
};
export function chatUiMessage(
  overrides: Partial<ChatMessage> = {},
): ChatMessage {
  return {
    id: chatUiIds.first,
    kind: 'text',
    text: '순자 님, 반가워요.',
    sentAt: '2026-10-24T01:02:03.123456+00:00',
    readAt: null,
    media: [],
    ...overrides,
  };
}
export function chatUiPage(overrides: Partial<ChatPage> = {}): ChatPage {
  return {
    artist: { slug: 'fictional-singer', name: '가상 가수', description: null },
    hasAccess: true,
    messages: [chatUiMessage()],
    nextCursor: 'Y3Vyc29y',
    readCount: 0,
    ...overrides,
  };
}
