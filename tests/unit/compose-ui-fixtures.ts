import type { ComposeDraft, ComposePageData } from '@/config/artist-compose';
export const composeUiIds = {
  artist: 'b1100000-0000-4000-8000-000000000001',
  message: 'b1200000-0000-4000-8000-000000000001',
  other: 'b1200000-0000-4000-8000-000000000002',
  media: 'b1300000-0000-4000-8000-000000000001',
  upload: 'b1400000-0000-4000-8000-000000000001',
};
export function composeUiDraft(
  overrides: Partial<ComposeDraft> = {},
): ComposeDraft {
  return {
    id: composeUiIds.message,
    kind: 'text',
    body: '오늘도 {이름} 님을 응원해요.',
    revision: 1,
    updatedAt: '2026-10-24T12:00:00.000Z',
    media: [],
    pendingUploadIds: [],
    ...overrides,
  };
}
export function composeUiPage(
  overrides: Partial<ComposePageData> = {},
): ComposePageData {
  return {
    artist: {
      id: composeUiIds.artist,
      slug: 'fictional-compose',
      name: '가상 가수',
    },
    policy: {
      maxTextLength: 1000,
      maxPhotoCount: 10,
      maxVoiceSeconds: 180,
      maxVideoSeconds: 60,
      photoMaxBytes: 10485760,
      voiceMaxBytes: 20971520,
      videoMaxBytes: 104857600,
      callNameMinLength: 2,
      callNameMaxLength: 10,
    },
    drafts: [],
    selectedDraft: null,
    hasMore: false,
    nextCursor: null,
    ...overrides,
  };
}
export function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
