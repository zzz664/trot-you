// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
import type { CheckoutServiceClient } from '@/server/db/checkout-client';
import { createScheduleNoticeQueuePort } from '@/server/db/schedule-notice-queue';
import { SCHEDULE_NOTICE } from '@/config/schedule-notices';
const id = '00000000-0000-4000-8000-000000000001';
const rpc = vi.fn();
const service = { rpc } as unknown as CheckoutServiceClient;
beforeEach(() => {
  rpc.mockReset();
  rpc.mockResolvedValue({ data: [], error: null });
});
it('uses bounded service-only scan and returns only aggregate queue result', async () => {
  rpc
    .mockResolvedValueOnce({
      data: [{ schedule_id: id, private: 'redacted' }],
      error: null,
    })
    .mockResolvedValueOnce({
      data: [{ created: true, push_jobs: 12, private: 'redacted' }],
      error: null,
    });
  const port = createScheduleNoticeQueuePort(service);
  expect(await port.candidates(20)).toEqual({ ok: true, data: [id] });
  expect(await port.create(id)).toEqual({
    ok: true,
    data: { created: true, pushJobs: 12 },
  });
  expect(rpc.mock.calls).toEqual([
    ['schedule_notice_candidates', { p_limit: 20 }],
    ['schedule_notice_create', { p_schedule_id: id }],
  ]);
});
it('empty concurrent-eligibility result is a skip rather than delivery', async () => {
  expect(await createScheduleNoticeQueuePort(service).create(id)).toEqual({
    ok: true,
    data: { created: false, pushJobs: 0 },
  });
});
it.each([
  [{ created: true, push_jobs: -1 }],
  [{ created: 'yes', push_jobs: 1 }],
  [
    { created: true, push_jobs: 1 },
    { created: true, push_jobs: 1 },
  ],
  [{ created: true, push_jobs: 1.5 }],
])('rejects malformed creation result %#', async (...value) => {
  rpc.mockResolvedValue({ data: value, error: null });
  expect(await createScheduleNoticeQueuePort(service).create(id)).toEqual({
    ok: false,
    code: 'UNAVAILABLE',
  });
});
it('rejects candidate overflow and malformed identity without create', async () => {
  rpc.mockResolvedValue({
    data: Array.from({ length: SCHEDULE_NOTICE.scanLimit + 1 }, () => ({
      schedule_id: id,
    })),
    error: null,
  });
  expect(await createScheduleNoticeQueuePort(service).candidates(20)).toEqual({
    ok: false,
    code: 'UNAVAILABLE',
  });
  rpc.mockResolvedValue({ data: [{ schedule_id: 'bad' }], error: null });
  expect(await createScheduleNoticeQueuePort(service).candidates(20)).toEqual({
    ok: false,
    code: 'UNAVAILABLE',
  });
});
it.each(['SCHEDULE_NOTICE_POLICY_NOT_APPROVED', 'internal credential error'])(
  'redacts failure %s',
  async (message) => {
    rpc.mockResolvedValue({ data: null, error: { message } });
    expect(await createScheduleNoticeQueuePort(service).create(id)).toEqual({
      ok: false,
      code:
        message === 'SCHEDULE_NOTICE_POLICY_NOT_APPROVED'
          ? 'SETUP_NOT_READY'
          : 'UNAVAILABLE',
    });
  },
);

it.each([
  { created: true, push_jobs: 0 },
  { created: false, push_jobs: 1 },
])('rejects contradictory queue count %#', async (row) => {
  rpc.mockResolvedValue({ data: [row], error: null });
  expect(await createScheduleNoticeQueuePort(service).create(id)).toEqual({
    ok: false,
    code: 'UNAVAILABLE',
  });
});
