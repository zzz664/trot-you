import { describe, expect, it, vi } from 'vitest';
import { BILLING_NOTICE, type BillingNotice } from '@/config/billing-notices';
import {
  listBillingNotices,
  markBillingNoticeRead,
  parseBillingNoticeCursor,
  setBillingNoticePreference,
  type BillingNoticePort,
} from '@/server/services/billing-notices/notices';
import {
  createDueBillingNotices,
  type BillingNoticeQueueDependencies,
} from '@/server/services/billing-notices/create-due';
const id = '00000000-0000-4000-8000-000000000001';
const notice: BillingNotice = {
  id,
  subscriptionId: id,
  artistName: '가상 가수',
  amountKrw: 9900,
  currency: 'KRW',
  billingAt: '2026-11-01T00:00:00Z',
  createdAt: '2026-10-25T00:00:00Z',
  readAt: null,
  mandatory: true,
};
function port(): BillingNoticePort {
  return {
    list: vi.fn(async () => ({ ok: true as const, data: [notice] })),
    preferences: vi.fn(async () => ({
      ok: true as const,
      data: { billingEnabled: false },
    })),
    markRead: vi.fn(async () => ({ ok: true as const, data: null })),
    setPreference: vi.fn(async (enabled: boolean) => ({
      ok: true as const,
      data: { billingEnabled: enabled },
    })),
  };
}
describe('current owner billing notice services', () => {
  it.each([
    {},
    [],
    '',
    '2026-10-25|bad',
    `${notice.createdAt}|${id}|extra`,
    ['cursor'],
    true,
  ])('rejects cursor %# before DB', async (cursor) => {
    const db = port();
    expect(await listBillingNotices(db, cursor)).toEqual({
      ok: false,
      code: 'INVALID_INPUT',
    });
    expect(db.list).not.toHaveBeenCalled();
  });
  it('uses bounded current owner projection and safe cursor pair', async () => {
    const db = port();
    const cursor = `${notice.createdAt}|${id}`;
    expect(parseBillingNoticeCursor(cursor)).toEqual({
      ok: true as const,
      data: { beforeCreatedAt: notice.createdAt, beforeId: id },
    });
    expect(await listBillingNotices(db, cursor)).toEqual({
      ok: true as const,
      data: {
        notices: [notice],
        hasMore: false,
        nextCursor: null,
        billingEnabled: false,
      },
    });
    expect(db.list).toHaveBeenCalledWith(51, {
      beforeCreatedAt: notice.createdAt,
      beforeId: id,
    });
  });
  it('returns stable cursor with one-row lookahead', async () => {
    const db = port();
    const notices = Array.from({ length: 51 }, (_, index) => ({
      ...notice,
      id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    }));
    vi.mocked(db.list).mockResolvedValue({ ok: true as const, data: notices });
    const result = await listBillingNotices(db);
    expect(result).toMatchObject({
      ok: true as const,
      data: {
        hasMore: true,
        nextCursor: `${notice.createdAt}|${notices[49]!.id}`,
      },
    });
    if (result.ok) expect(result.data.notices).toHaveLength(50);
  });
  it('fails closed for duplicate/overlimit DB rows', async () => {
    const db = port();
    vi.mocked(db.list).mockResolvedValue({
      ok: true as const,
      data: [notice, notice],
    });
    expect(await listBillingNotices(db)).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
    });
  });
  it('keeps preference failure distinct and never reads prices afterward', async () => {
    const db = port();
    vi.mocked(db.preferences).mockResolvedValue({
      ok: false,
      code: 'FORBIDDEN',
    });
    expect(await listBillingNotices(db)).toEqual({
      ok: false,
      code: 'FORBIDDEN',
    });
    expect(db.list).not.toHaveBeenCalled();
  });
  it.each([
    null,
    {},
    { noticeId: 'bad' },
    { noticeId: id, deliveredAt: notice.createdAt },
  ])('rejects authority-bearing read input %#', async (input) => {
    const db = port();
    expect(await markBillingNoticeRead(db, input)).toEqual({
      ok: false,
      code: 'INVALID_INPUT',
    });
    expect(db.markRead).not.toHaveBeenCalled();
  });
  it('records only an explicit owner read marker, never delivery evidence', async () => {
    const db = port();
    expect(await markBillingNoticeRead(db, { noticeId: id })).toEqual({
      ok: true as const,
      data: null,
    });
    expect(db.markRead).toHaveBeenCalledExactlyOnceWith(id);
  });
  it.each([
    null,
    {},
    { enabled: 'true' },
    { enabled: true, webpushEnabled: true },
  ])('does not let preference mutate other consent %#', async (input) => {
    const db = port();
    expect(await setBillingNoticePreference(db, input)).toEqual({
      ok: false,
      code: 'INVALID_INPUT',
    });
    expect(db.setPreference).not.toHaveBeenCalled();
  });
  it('changes just the requested boolean', async () => {
    const db = port();
    expect(await setBillingNoticePreference(db, { enabled: true })).toEqual({
      ok: true as const,
      data: { billingEnabled: true },
    });
    expect(db.setPreference).toHaveBeenCalledExactlyOnceWith(true);
  });
  it('redacts unexpected DB exceptions', async () => {
    const db = port();
    vi.mocked(db.markRead).mockRejectedValue(new Error('secret'));
    expect(await markBillingNoticeRead(db, { noticeId: id })).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
    });
  });
});
function queue(): BillingNoticeQueueDependencies {
  return {
    now: () => 0,
    port: {
      candidates: vi.fn(async () => ({ ok: true as const, data: [id] })),
      create: vi.fn(async () => ({
        ok: true as const,
        data: { noticeId: id, created: true, pushJobs: 2 },
      })),
    },
  };
}
describe('bounded pre-billing publication, never receipt/charge', () => {
  it('counts inbox creation and queued jobs separately', async () => {
    const deps = queue();
    expect(await createDueBillingNotices(deps)).toEqual({
      ok: true as const,
      data: {
        examined: 1,
        created: 1,
        skipped: 0,
        failed: 0,
        pushJobsQueued: 2,
        hasMore: false,
      },
    });
    expect(deps.port.create).toHaveBeenCalledExactlyOnceWith(id);
  });
  it('handles cancellation between selection and creation as skipped', async () => {
    const deps = queue();
    vi.mocked(deps.port.create).mockResolvedValue({
      ok: true as const,
      data: { noticeId: null, created: false, pushJobs: 0 },
    });
    expect(await createDueBillingNotices(deps)).toMatchObject({
      ok: true as const,
      data: { created: 0, skipped: 1, pushJobsQueued: 0 },
    });
  });
  it('does not silently retry an ambiguous commit response', async () => {
    const deps = queue();
    vi.mocked(deps.port.create).mockRejectedValue(new Error('connection'));
    expect(await createDueBillingNotices(deps)).toMatchObject({
      ok: true as const,
      data: { created: 0, failed: 1 },
    });
    expect(deps.port.create).toHaveBeenCalledOnce();
  });
  it('stops at execution budget before starting a mutation', async () => {
    const deps = queue();
    let time = 0;
    deps.now = () => time;
    vi.mocked(deps.port.candidates).mockImplementation(async () => {
      time = BILLING_NOTICE.workerBudgetMs;
      return { ok: true as const, data: [id] };
    });
    expect(await createDueBillingNotices(deps)).toMatchObject({
      ok: true as const,
      data: { examined: 0, hasMore: true },
    });
    expect(deps.port.create).not.toHaveBeenCalled();
  });
  it('rejects malformed duplicate candidate batch', async () => {
    const deps = queue();
    vi.mocked(deps.port.candidates).mockResolvedValue({
      ok: true as const,
      data: [id, id],
    });
    expect(await createDueBillingNotices(deps)).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
    });
    expect(deps.port.create).not.toHaveBeenCalled();
  });
  it('caps work and stops repeated fair scan pages without another create', async () => {
    const deps = queue();
    const ids = Array.from(
      { length: 20 },
      (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    );
    vi.mocked(deps.port.candidates).mockResolvedValue({
      ok: true as const,
      data: ids,
    });
    expect(await createDueBillingNotices(deps)).toMatchObject({
      ok: true as const,
      data: { examined: 20, created: 20, hasMore: true },
    });
    expect(deps.port.create).toHaveBeenCalledTimes(20);
  });
});
