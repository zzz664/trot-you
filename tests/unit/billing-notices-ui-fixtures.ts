import type { BillingNoticeList } from '@/config/billing-notices';

export const noticeId = 'c6300000-0000-4000-8000-000000000001';
export const subscriptionId = 'c6300000-0000-4000-8000-000000000002';
export const noticeCursor = `2026-10-25T00:00:00+09:00|${noticeId}`;
export function noticeList(
  overrides: Partial<BillingNoticeList> = {},
): BillingNoticeList {
  return {
    notices: [
      {
        id: noticeId,
        subscriptionId,
        artistName: '허구 안내 가수',
        amountKrw: 6500,
        currency: 'KRW',
        billingAt: '2026-10-26T15:00:00Z',
        createdAt: '2026-10-24T15:00:00Z',
        readAt: null,
        mandatory: true,
      },
    ],
    hasMore: false,
    nextCursor: null,
    billingEnabled: false,
    ...overrides,
  };
}
