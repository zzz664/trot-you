import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fetchBillingNotices,
  markBillingNoticeRead,
  setBillingNoticePreference,
} from '@/client/billing-notices';
import {
  BILLING_NOTICE_ERROR_STATUS,
  BILLING_NOTICE_RESPONSE_MAX_BYTES,
} from '@/config/billing-notices';
import { billingNoticePath, routes } from '@/config/routes';
import {
  noticeCursor,
  noticeId,
  noticeList,
} from './billing-notices-ui-fixtures';

const fetchMock = vi.fn();
function respond(
  body: unknown,
  status = 200,
  contentType = 'application/json',
) {
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': contentType },
    }),
  );
}
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  respond({ ok: true, data: noticeList() });
});
afterEach(() => vi.unstubAllGlobals());

describe('billing notice private browser transport', () => {
  it('gets fresh safe data with no actor or financial fields in request', async () => {
    expect(await fetchBillingNotices()).toEqual({
      ok: true,
      data: noticeList(),
    });
    const [path, options] = fetchMock.mock.calls[0]!;
    expect(path).toBe(routes.billingNoticeStatus);
    expect(options).toMatchObject({
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
    });
    expect(options).not.toHaveProperty('body');
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });
  it('encodes an exact cursor without permitting URL injection', async () => {
    await fetchBillingNotices(noticeCursor);
    const url = new URL(fetchMock.mock.calls[0]![0], 'https://example.invalid');
    expect(url.pathname).toBe(routes.billingNoticeStatus);
    expect(url.searchParams.get('cursor')).toBe(noticeCursor);
    expect([...url.searchParams.keys()]).toEqual(['cursor']);
    expect(
      new URL(
        billingNoticePath(noticeCursor),
        'https://example.invalid',
      ).searchParams.get('cursor'),
    ).toBe(noticeCursor);
  });
  it.each([
    '',
    'opaque',
    '2026-10-25|bad',
    `${noticeCursor}|extra`,
    '?redirect=https://evil.invalid',
  ])('rejects malformed cursor %s without fetching', async (cursor) => {
    expect(await fetchBillingNotices(cursor)).toEqual({
      ok: false,
      code: 'INVALID_INPUT',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('does not issue an already aborted read', async () => {
    const controller = new AbortController();
    controller.abort();
    expect(await fetchBillingNotices(undefined, controller.signal)).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each(Object.entries(BILLING_NOTICE_ERROR_STATUS))(
    'binds error %s to its exact status',
    async (code, status) => {
      respond({ ok: false, code }, status);
      expect(await fetchBillingNotices()).toEqual({ ok: false, code });
      respond({ ok: false, code });
      expect(await fetchBillingNotices()).toEqual({
        ok: false,
        code: 'UNAVAILABLE',
      });
    },
  );
  it.each([
    null,
    [],
    { ok: true },
    { ok: false, code: 'INTERNAL_SQL' },
    { ok: true, data: noticeList(), secret: 'not allowed' },
    { ok: true, data: { ...noticeList(), userId: noticeId } },
    {
      ok: true,
      data: noticeList({
        notices: [...noticeList().notices, ...noticeList().notices],
      }),
    },
    {
      ok: true,
      data: noticeList({
        notices: [{ ...noticeList().notices[0]!, currency: 'USD' as 'KRW' }],
      }),
    },
    {
      ok: true,
      data: {
        ...noticeList(),
        notices: [{ ...noticeList().notices[0]!, credential: 'private' }],
      },
    },
    { ok: true, data: noticeList({ hasMore: true, nextCursor: null }) },
    {
      ok: true,
      data: noticeList({
        notices: [],
        hasMore: true,
        nextCursor: noticeCursor,
      }),
    },
  ])(
    'rejects malformed or privacy-contaminated payload %#',
    async (payload) => {
      respond(payload);
      expect(await fetchBillingNotices()).toEqual({
        ok: false,
        code: 'UNAVAILABLE',
      });
    },
  );
  it('rejects a repeated cursor instead of looping pagination', async () => {
    respond({
      ok: true,
      data: noticeList({ hasMore: true, nextCursor: noticeCursor }),
    });
    expect(await fetchBillingNotices(noticeCursor)).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
    });
  });
  it('rejects wrong MIME, non200 success and transport failure', async () => {
    respond({ ok: true, data: noticeList() }, 200, 'text/html');
    expect((await fetchBillingNotices()).ok).toBe(false);
    respond({ ok: true, data: noticeList() }, 503);
    expect((await fetchBillingNotices()).ok).toBe(false);
    fetchMock.mockRejectedValue(new Error('private transport'));
    expect(await fetchBillingNotices()).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
    });
  });
  it('rejects invalid JSON, truncated UTF8 and missing bodies', async () => {
    for (const body of ['{', new Uint8Array([0xc3]), null]) {
      fetchMock.mockResolvedValue(
        new Response(body, { headers: { 'Content-Type': 'application/json' } }),
      );
      expect((await fetchBillingNotices()).ok).toBe(false);
    }
  });
  it('cancels oversized streaming response', async () => {
    const cancel = vi.fn();
    fetchMock.mockResolvedValue(
      new Response(
        new ReadableStream({
          pull(controller) {
            controller.enqueue(
              new Uint8Array(BILLING_NOTICE_RESPONSE_MAX_BYTES + 1),
            );
          },
          cancel,
        }),
        { headers: { 'Content-Type': 'application/json' } },
      ),
    );
    expect((await fetchBillingNotices()).ok).toBe(false);
    expect(cancel).toHaveBeenCalledOnce();
  });
  it('marks only the supplied notice read without claiming delivery or consent', async () => {
    respond({ ok: true, data: null });
    expect(await markBillingNoticeRead(noticeId)).toEqual({
      ok: true,
      data: null,
    });
    expect(fetchMock.mock.calls[0]![0]).toBe(routes.billingNoticeRead);
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toEqual({ noticeId });
    expect(fetchMock.mock.calls[0]![1].method).toBe('POST');
  });
  it('rejects invalid read id and nonnull read success', async () => {
    expect(await markBillingNoticeRead('not-an-id')).toEqual({
      ok: false,
      code: 'INVALID_INPUT',
    });
    expect(fetchMock).not.toHaveBeenCalled();
    respond({ ok: true, data: { delivered: true } });
    expect((await markBillingNoticeRead(noticeId)).ok).toBe(false);
  });
  it.each([true, false])(
    'changes only billing preference to %s',
    async (enabled) => {
      respond({ ok: true, data: { billingEnabled: enabled } });
      expect(await setBillingNoticePreference(enabled)).toEqual({
        ok: true,
        data: { billingEnabled: enabled },
      });
      expect(fetchMock.mock.calls[0]![0]).toBe(routes.billingNoticePreference);
      expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toEqual({ enabled });
    },
  );
  it('rejects a mismatched preference echo and nonboolean input', async () => {
    expect(
      await setBillingNoticePreference('true' as unknown as boolean),
    ).toEqual({ ok: false, code: 'INVALID_INPUT' });
    expect(fetchMock).not.toHaveBeenCalled();
    respond({ ok: true, data: { billingEnabled: false } });
    expect(await setBillingNoticePreference(true)).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
    });
  });
});
