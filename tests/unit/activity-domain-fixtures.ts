import type {
  ArtistReplyActivityPage,
  ArtistReplyActivityMessages,
} from '@/config/artist-reply-activity';
export const activityIds = {
  artist: 'a5000000-0000-4000-8000-000000000001',
  reply: 'a5000000-0000-4000-8000-000000000002',
  message: 'a5000000-0000-4000-8000-000000000003',
  other: 'a5000000-0000-4000-8000-000000000004',
};
export const activityStamp = '2026-10-24T00:00:00.123456+00:00';
export const activitySlug = 'fictional-activity';
export function activityPage(
  overrides: Partial<ArtistReplyActivityPage> = {},
): ArtistReplyActivityPage {
  return {
    artist: { id: activityIds.artist, slug: activitySlug, name: '가상 가수' },
    serverNow: activityStamp,
    activity: {
      weekStart: '2026-10-19',
      weekEnd: '2026-10-26',
      messageCount: 4,
      photoCount: 2,
      weeklyMessageMin: 3,
      weeklyPhotoMin: 2,
      requirementsReady: true,
    },
    replies: [
      {
        id: activityIds.reply,
        callName: '가상팬',
        body: '반갑습니다',
        createdAt: activityStamp,
        messageId: activityIds.message,
      },
    ],
    selectedMessage: null,
    hasMore: false,
    nextCursor: null,
    ...overrides,
  };
}
export function activityMessages(
  overrides: Partial<ArtistReplyActivityMessages> = {},
): ArtistReplyActivityMessages {
  return {
    artist: activityPage().artist,
    messages: [
      { id: activityIds.message, kind: 'text', sentAt: activityStamp },
    ],
    hasMore: false,
    nextCursor: null,
    ...overrides,
  };
}
