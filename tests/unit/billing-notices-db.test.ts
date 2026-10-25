// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
import type { ActorClient } from '@/server/db/client';
import type { CheckoutServiceClient } from '@/server/db/checkout-client';
import {
  createBillingNoticePort,
  createBillingNoticeQueuePort,
} from '@/server/db/billing-notices';
const id = '00000000-0000-4000-8000-000000000001';
const rpc = vi.fn();
const client = { rpc } as unknown as ActorClient;
const service = { rpc } as unknown as CheckoutServiceClient;
const row = {
  id,
  subscription_id: id,
  artist_name: '가상 가수',
  amount_krw: 9900,
  currency: 'KRW',
  billing_at: '2026-11-01T00:00:00Z',
  created_at: '2026-10-25T00:00:00Z',
  read_at: null,
  mandatory: true,
};
beforeEach(() => {
  rpc.mockReset();
  rpc.mockResolvedValue({ data: null, error: null });
});
it('uses authenticated RPC with no caller actor id and safe projection', async () => {
  rpc.mockResolvedValue({
    data: [{ ...row, credential: 'secret' }],
    error: null,
  });
  const result = await createBillingNoticePort(client).list(51, null);
  expect(result).toMatchObject({
    ok: true,
    data: [{ id, subscriptionId: id, amountKrw: 9900, currency: 'KRW' }],
  });
  expect(JSON.stringify(result)).not.toContain('secret');
  expect(rpc).toHaveBeenCalledWith('billing_notice_list', { p_limit: 51 });
});
it('translates cursor exactly without SQL/string interpolation', async () => {
  rpc.mockResolvedValue({ data: [], error: null });
  await createBillingNoticePort(client).list(51, {
    beforeCreatedAt: row.created_at,
    beforeId: id,
  });
  expect(rpc).toHaveBeenCalledWith('billing_notice_list', {
    p_limit: 51,
    p_before_created_at: row.created_at,
    p_before_id: id,
  });
});
it.each([
  { ...row, amount_krw: -1 },
  { ...row, currency: 'USD' },
  { ...row, id: 'bad' },
  { ...row, billing_at: 'yesterday' },
])('fails malformed financial projection closed %#', async (value) => {
  rpc.mockResolvedValue({ data: [value], error: null });
  expect(await createBillingNoticePort(client).list(51, null)).toEqual({
    ok: false,
    code: 'UNAVAILABLE',
  });
});
it('preference returns only billing boolean', async () => {
  rpc.mockResolvedValue({
    data: [{ billing_enabled: true, webpush_enabled: true }],
    error: null,
  });
  expect(await createBillingNoticePort(client).setPreference(true)).toEqual({
    ok: true,
    data: { billingEnabled: true },
  });
  expect(rpc).toHaveBeenCalledWith('billing_notice_set_preference', {
    p_enabled: true,
  });
});
it('reads existing preference without mutation', async () => {
  rpc.mockResolvedValue({ data: [{ billing_enabled: false }], error: null });
  expect(await createBillingNoticePort(client).preferences()).toEqual({
    ok: true,
    data: { billingEnabled: false },
  });
  expect(rpc).toHaveBeenCalledExactlyOnceWith('billing_notice_preferences');
});
it('marks read without forwarding timestamp/evidence authority', async () => {
  expect(await createBillingNoticePort(client).markRead(id)).toEqual({
    ok: true,
    data: null,
  });
  expect(rpc).toHaveBeenCalledWith('billing_notice_mark_read', {
    p_notice_id: id,
  });
});
it.each([
  'BILLING_NOTICE_NOT_FOUND',
  'NOTIFICATION_ACTOR_FORBIDDEN',
  'secret error',
])('redacts DB error %s', async (message) => {
  rpc.mockResolvedValue({ data: null, error: { message } });
  const result = await createBillingNoticePort(client).markRead(id);
  expect(result).toEqual({
    ok: false,
    code:
      message === 'BILLING_NOTICE_NOT_FOUND'
        ? 'NOT_FOUND'
        : message === 'NOTIFICATION_ACTOR_FORBIDDEN'
          ? 'FORBIDDEN'
          : 'UNAVAILABLE',
  });
});
it('returns bounded service candidates and only aggregate creation fields', async () => {
  rpc
    .mockResolvedValueOnce({ data: [{ subscription_id: id }], error: null })
    .mockResolvedValueOnce({
      data: [{ notice_id: id, created: true, push_jobs: 1 }],
      error: null,
    });
  const db = createBillingNoticeQueuePort(service);
  expect(await db.candidates(20)).toEqual({ ok: true, data: [id] });
  expect(await db.create(id)).toEqual({
    ok: true,
    data: { noticeId: id, created: true, pushJobs: 1 },
  });
});
it('empty creation after concurrent eligibility loss is skip not creation', async () => {
  rpc.mockResolvedValue({ data: [], error: null });
  expect(await createBillingNoticeQueuePort(service).create(id)).toEqual({
    ok: true,
    data: { noticeId: null, created: false, pushJobs: 0 },
  });
});
it('rejects unexpected duplicate creation rows', async () => {
  rpc.mockResolvedValue({
    data: [
      { notice_id: id, created: true, push_jobs: 0 },
      { notice_id: id, created: true, push_jobs: 0 },
    ],
    error: null,
  });
  expect(await createBillingNoticeQueuePort(service).create(id)).toEqual({
    ok: false,
    code: 'UNAVAILABLE',
  });
});
it('accepts historical accounts above the newer registration-device ceiling without misreporting committed creation', async () => {
  rpc.mockResolvedValue({
    data: [{ notice_id: id, created: true, push_jobs: 12 }],
    error: null,
  });
  expect(await createBillingNoticeQueuePort(service).create(id)).toEqual({
    ok: true,
    data: { noticeId: id, created: true, pushJobs: 12 },
  });
});
