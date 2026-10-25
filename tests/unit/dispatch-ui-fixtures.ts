import type {
  DispatchMessage,
  DispatchPageData,
} from '@/config/message-dispatch';
import { composeUiIds, composeUiPage } from './compose-ui-fixtures';
export const dispatchUiIds = {
  ...composeUiIds,
  operation: 'b1500000-0000-4000-8000-000000000001',
};
export function dispatchUiMessage(
  overrides: Partial<DispatchMessage> = {},
): DispatchMessage {
  return {
    id: composeUiIds.message,
    kind: 'text',
    body: '오늘도 {이름} 님을 응원해요.',
    revision: 1,
    status: 'sent',
    createdAt: '2026-10-24T12:00:00.000Z',
    scheduledAt: '2026-10-24T12:00:00.000Z',
    sentAt: '2026-10-24T12:00:00.000Z',
    canceledAt: null,
    cancelBefore: '2026-10-24T12:05:00.000Z',
    canCancel: true,
    notificationState: 'queued',
    dispatchError: null,
    media: [],
    ...overrides,
  };
}
export function dispatchUiPage(
  overrides: Partial<DispatchPageData> = {},
): DispatchPageData {
  return {
    artist: composeUiPage().artist,
    serverNow: '2026-10-24T12:00:00.000Z',
    cancelWindowSeconds: 300,
    messages: [],
    selectedMessage: null,
    hasMore: false,
    nextCursor: null,
    ...overrides,
  };
}
