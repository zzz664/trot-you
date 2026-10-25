// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DISPATCH_WORKER_LIMIT,
  type DispatchMessage,
} from '@/config/message-dispatch';
import {
  readDispatchContext,
  submitDispatch,
  cancelDispatch,
} from '@/server/services/message-dispatch/dispatch';
import { dispatchDueMessages } from '@/server/services/message-dispatch/worker';

const id = 'a4000000-0000-4000-8000-000000000001';
const other = 'a4000000-0000-4000-8000-000000000002';
const slug = 'fictional-dispatch';
const stamp = '2026-10-24T00:00:00.123456+00:00';
const item: DispatchMessage = {
  id,
  kind: 'text',
  body: '안녕하세요 {이름}',
  revision: 1,
  status: 'sent',
  createdAt: stamp,
  scheduledAt: stamp,
  sentAt: stamp,
  canceledAt: null,
  cancelBefore: '2026-10-24T00:05:00.123456+00:00',
  canCancel: true,
  notificationState: 'queued',
  dispatchError: null,
  media: [],
};
const page = {
  artist: { id: other, slug, name: '가상 가수' },
  serverNow: stamp,
  cancelWindowSeconds: 300,
  messages: [item],
  selectedMessage: null,
  hasMore: false,
};
const input = {
  slug,
  messageId: id,
  operationId: other,
  expectedRevision: 1,
  scheduledAt: null,
  confirmed: true,
} as const;
const cancel = {
  slug,
  messageId: id,
  operationId: other,
  confirmed: true,
} as const;
const port = { context: vi.fn(), submit: vi.fn(), cancel: vi.fn() };
beforeEach(() => {
  vi.resetAllMocks();
  port.context.mockResolvedValue({ ok: true, data: page });
  port.submit.mockResolvedValue({ ok: true, data: item });
  port.cancel.mockResolvedValue({
    ok: true,
    data: {
      ...item,
      status: 'canceled',
      canceledAt: stamp,
      canCancel: false,
      notificationState: 'canceled',
    },
  });
});
describe('confirmed dispatch domain', () => {
  it('passes immutable immediate intent without pre-read or generated key', async () => {
    expect(await submitDispatch(port, input)).toEqual({ ok: true, data: item });
    expect(port.submit).toHaveBeenCalledExactlyOnceWith(input);
    expect(port.context).not.toHaveBeenCalled();
  });
  it('passes exact past schedule retry to SQL instead of rejecting by client clock', async () => {
    expect(
      (await submitDispatch(port, { ...input, scheduledAt: stamp })).ok,
    ).toBe(true);
  });
  it('accepts current canceled receipt after a lost submit response', async () => {
    const current = {
      ...item,
      status: 'canceled',
      canceledAt: stamp,
      canCancel: false,
    };
    port.submit.mockResolvedValue({ ok: true, data: current });
    expect(await submitDispatch(port, input)).toEqual({
      ok: true,
      data: current,
    });
  });
  it.each([
    { confirmed: false },
    { confirmed: undefined },
    { actorId: id },
    { operationId: 'bad' },
    { expectedRevision: 0 },
    { expectedRevision: Number.MAX_SAFE_INTEGER + 1 },
    { scheduledAt: 'tomorrow' },
    { scheduledAt: '2026-10-24T09:00' },
    { slug: '../escape' },
  ])('rejects invalid or unconfirmed submit %#', async (change) => {
    expect(await submitDispatch(port, { ...input, ...change })).toEqual({
      ok: false,
      code: 'INVALID_INPUT',
    });
    expect(port.submit).not.toHaveBeenCalled();
  });
  it.each([
    { ...item, id: other },
    { ...item, status: 'sent', sentAt: null },
    { ...item, private: 'leak' },
    {
      ...item,
      media: [{ id: other, kind: 'video', width: 1, height: 1, durationMs: 1 }],
    },
  ])('rejects invalid submit output %#', async (value) => {
    port.submit.mockResolvedValue({ ok: true, data: value });
    expect(await submitDispatch(port, input)).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
    });
  });
  it('requires explicit cancel confirmation and actual canceled response', async () => {
    expect((await cancelDispatch(port, cancel)).ok).toBe(true);
    expect(port.cancel).toHaveBeenCalledExactlyOnceWith(cancel);
    port.cancel.mockResolvedValue({ ok: true, data: item });
    expect(await cancelDispatch(port, cancel)).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
    });
    expect(await cancelDispatch(port, { ...cancel, confirmed: false })).toEqual(
      { ok: false, code: 'INVALID_INPUT' },
    );
  });
  it.each(['submit', 'cancel'] as const)(
    'does not retry %s exceptions or expose their content',
    async (op) => {
      port[op].mockRejectedValue(new Error('private-content'));
      expect(
        await (op === 'submit'
          ? submitDispatch(port, input)
          : cancelDispatch(port, cancel)),
      ).toEqual({ ok: false, code: 'UNAVAILABLE' });
      expect(port[op]).toHaveBeenCalledOnce();
    },
  );
  it.each([
    'CANCEL_WINDOW_PASSED',
    'RATE_LIMITED',
    'BACKPRESSURE',
    'CONFLICT',
    'MEDIA_PENDING',
  ])('preserves bounded known error %s', async (code) => {
    port.submit.mockResolvedValue({ ok: false, code });
    expect(await submitDispatch(port, input)).toEqual({ ok: false, code });
  });
});
describe('private history cursor and selected recovery', () => {
  it('creates a lossless artist-bound keyset cursor', async () => {
    port.context.mockResolvedValue({
      ok: true,
      data: { ...page, hasMore: true },
    });
    const first = await readDispatchContext(port, { slug, messageId: null });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(
      JSON.parse(
        Buffer.from(first.data.nextCursor!, 'base64url').toString('utf8'),
      ),
    ).toEqual({ slug, createdAt: stamp, id });
    port.context.mockResolvedValue({
      ok: true,
      data: { ...page, messages: [], hasMore: false },
    });
    expect(
      (
        await readDispatchContext(port, {
          slug,
          messageId: null,
          cursor: first.data.nextCursor,
        })
      ).ok,
    ).toBe(true);
    expect(port.context).toHaveBeenLastCalledWith(slug, null, {
      slug,
      createdAt: stamp,
      id,
    });
  });
  it('returns exact selected record independent of page', async () => {
    port.context.mockResolvedValue({
      ok: true,
      data: { ...page, messages: [], selectedMessage: item },
    });
    const result = await readDispatchContext(port, { slug, messageId: id });
    expect(result.ok && result.data.selectedMessage?.id).toBe(id);
  });
  it.each([
    '!',
    'abc=',
    Buffer.from(
      JSON.stringify({ slug: 'other-artist', createdAt: stamp, id }),
    ).toString('base64url'),
    Buffer.from('{broken').toString('base64url'),
  ])('rejects invalid or cross-artist cursor %#', async (cursor) => {
    expect(
      await readDispatchContext(port, { slug, messageId: null, cursor }),
    ).toEqual({ ok: false, code: 'INVALID_INPUT' });
    expect(port.context).not.toHaveBeenCalled();
  });
  it.each([
    { artist: { ...page.artist, slug: 'other' } },
    { messages: [item, item] },
    { hasMore: true, messages: [] },
    { selectedMessage: item },
    { secret: 'private' },
  ])('rejects inconsistent history response %#', async (change) => {
    port.context.mockResolvedValue({ ok: true, data: { ...page, ...change } });
    expect(await readDispatchContext(port, { slug, messageId: null })).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
    });
  });
  it('rejects missing exact selected message and nonadvancing cursor', async () => {
    expect(await readDispatchContext(port, { slug, messageId: id })).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
    });
    const cursor = Buffer.from(
      JSON.stringify({ slug, createdAt: stamp, id }),
    ).toString('base64url');
    port.context.mockResolvedValue({
      ok: true,
      data: { ...page, hasMore: true },
    });
    expect(
      await readDispatchContext(port, { slug, messageId: null, cursor }),
    ).toEqual({ ok: false, code: 'UNAVAILABLE' });
  });
  it('contains read failures', async () => {
    port.context.mockRejectedValue(new Error('private'));
    expect(await readDispatchContext(port, { slug, messageId: null })).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
    });
  });
});
describe('bounded database-only due worker', () => {
  it('runs exactly one capped transaction even when backlog remains', async () => {
    const summary = { published: 10, blocked: 0, skipped: 0, hasMore: true };
    const worker = {
      run: vi.fn().mockResolvedValue({ ok: true, data: summary }),
    };
    expect(await dispatchDueMessages(worker)).toEqual({
      ok: true,
      data: summary,
    });
    expect(worker.run).toHaveBeenCalledExactlyOnceWith(DISPATCH_WORKER_LIMIT);
  });
  it.each([
    { published: 11, blocked: 0, skipped: 0, hasMore: false },
    { published: 9, blocked: 2, skipped: 0, hasMore: true },
    {
      published: 0,
      blocked: 0,
      skipped: 0,
      hasMore: false,
      endpoint: 'private',
    },
  ])('fails invalid worker summary %# closed', async (data) => {
    expect(
      await dispatchDueMessages({
        run: vi.fn().mockResolvedValue({ ok: true, data }),
      }),
    ).toEqual({ ok: false, code: 'UNAVAILABLE' });
  });
  it('does not internally retry uncertain commit after database exception', async () => {
    const worker = {
      run: vi.fn().mockRejectedValue(new Error('lost-response')),
    };
    expect(await dispatchDueMessages(worker)).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
    });
    expect(worker.run).toHaveBeenCalledOnce();
  });
});
