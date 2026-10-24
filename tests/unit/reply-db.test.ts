// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createReplyPort } from '@/server/db/replies';
import type { ActorClient } from '@/server/db/client';
const slug = 'fictional-star';
const id = 'a2000000-0000-4000-8000-000000000001';
const operationId = 'a2000000-0000-4000-8000-000000000002';
const messageId = 'a2000000-0000-4000-8000-000000000003';
const createdAt = '2026-10-24T01:02:03.123456+00:00';
const row = {
  id,
  operation_id: operationId,
  message_id: null,
  body: '고맙습니다',
  is_blocked: false,
  created_at: createdAt,
  user_id: id,
  subscription_id: messageId,
};
const mapped = {
  id,
  operationId,
  messageId: null,
  body: row.body,
  blocked: false,
  createdAt,
};
const page = {
  artist_slug: slug,
  max_length: 100,
  send_ready: true,
  replies: [row],
  has_more: false,
};
function client(result: unknown) {
  const rpc = vi
    .fn()
    .mockReturnValue({ single: vi.fn().mockResolvedValue(result) });
  return { port: createReplyPort({ rpc } as unknown as ActorClient), rpc };
}
describe('reply actor-bound RPC adapter', () => {
  it('has no caller actor field and strips internal identities from own feed', async () => {
    const { port, rpc } = client({ data: page, error: null });
    expect(await port.page(slug, 30, null)).toEqual({
      ok: true,
      data: {
        slug,
        maxLength: 100,
        sendReady: true,
        replies: [mapped],
        hasMore: false,
      },
    });
    expect(rpc).toHaveBeenCalledExactlyOnceWith('fan_reply_page', {
      p_artist_slug: slug,
      p_limit: 30,
    });
  });
  it('preserves the full cursor tuple precision', async () => {
    const { port, rpc } = client({ data: page, error: null });
    await port.page(slug, 5, { slug, id, createdAt });
    expect(rpc).toHaveBeenCalledWith('fan_reply_page', {
      p_artist_slug: slug,
      p_limit: 5,
      p_before_created_at: createdAt,
      p_before_id: id,
    });
  });
  it('writes only immutable payload and optional message, omitting absent nullable defaults', async () => {
    const { port, rpc } = client({ data: row, error: null });
    expect(await port.send(slug, operationId, row.body, null)).toEqual({
      ok: true,
      data: mapped,
    });
    expect(rpc).toHaveBeenCalledExactlyOnceWith('fan_reply_send', {
      p_artist_slug: slug,
      p_operation_id: operationId,
      p_body: row.body,
    });
    await port.send(slug, operationId, row.body, messageId);
    expect(rpc).toHaveBeenLastCalledWith('fan_reply_send', {
      p_artist_slug: slug,
      p_operation_id: operationId,
      p_body: row.body,
      p_message_id: messageId,
    });
  });
  it('keeps nullable legacy IDs and blocked redaction for existing history', async () => {
    const { port } = client({
      data: {
        ...page,
        replies: [{ ...row, operation_id: null, body: null, is_blocked: true }],
      },
      error: null,
    });
    expect(await port.page(slug, 30, null)).toMatchObject({
      ok: true,
      data: { replies: [{ operationId: null, body: null, blocked: true }] },
    });
  });
  it('keeps an explicit policy-unavailable state without fake send readiness', async () => {
    const { port } = client({
      data: { ...page, send_ready: false },
      error: null,
    });
    expect(await port.page(slug, 30, null)).toMatchObject({
      ok: true,
      data: { sendReady: false },
    });
  });
  it.each([
    null,
    {},
    { ...page, artist_slug: 'Bad' },
    { ...page, max_length: '100' },
    { ...page, max_length: 0 },
    { ...page, send_ready: null },
    { ...page, has_more: null },
    { ...page, replies: Array.from({ length: 101 }, () => row) },
    { ...page, replies: [{ ...row, body: null }] },
    { ...page, replies: [{ ...row, is_blocked: true }] },
    { ...page, replies: [{ ...row, created_at: 'bad' }] },
    { ...page, replies: [{ ...row, operation_id: 'bad' }] },
  ])('fails malformed page closed %j', async (data) => {
    expect(
      await client({ data, error: null }).port.page(slug, 30, null),
    ).toEqual({ ok: false, code: 'UNAVAILABLE' });
  });
  it.each([
    null,
    {},
    { ...row, id: 'bad' },
    { ...row, operation_id: 'bad' },
    { ...row, message_id: 'bad' },
    { ...row, body: null },
    { ...row, is_blocked: true },
    { ...row, created_at: 'bad' },
  ])('fails malformed receipt closed %j', async (data) => {
    expect(
      await client({ data, error: null }).port.send(
        slug,
        operationId,
        row.body,
        null,
      ),
    ).toEqual({ ok: false, code: 'UNAVAILABLE' });
  });
  it.each([
    ['REPLY_INVALID_INPUT', 'INVALID_INPUT'],
    ['REPLY_CONTENT_INVALID', 'INVALID_INPUT'],
    ['REPLY_TOO_LONG', 'TOO_LONG'],
    ['REPLY_FORBIDDEN_CONTENT', 'FORBIDDEN_CONTENT'],
    ['REPLY_OPERATION_CONFLICT', 'IDEMPOTENCY_CONFLICT'],
    ['REPLY_RATE_LIMITED', 'RATE_LIMITED'],
    ['REPLY_FORBIDDEN', 'FORBIDDEN'],
    ['REPLY_MESSAGE_NOT_VISIBLE', 'FORBIDDEN'],
    ['REPLY_SUBSCRIPTION_REQUIRED', 'SUBSCRIPTION_REQUIRED'],
    ['REPLY_PROFILE_REQUIRED', 'PROFILE_REQUIRED'],
    ['REPLY_NOT_FOUND', 'NOT_FOUND'],
    ['REPLY_SETUP_NOT_READY', 'SETUP_NOT_READY'],
    ['DISCOVERY_FORBIDDEN', 'FORBIDDEN'],
    ['DISCOVERY_PROFILE_REQUIRED', 'PROFILE_REQUIRED'],
    ['DISCOVERY_SETUP_NOT_READY', 'SETUP_NOT_READY'],
    ['MESSAGE_POLICY_REQUIRED', 'SETUP_NOT_READY'],
    ['private details', 'UNAVAILABLE'],
    ['toString', 'UNAVAILABLE'],
    ['constructor', 'UNAVAILABLE'],
  ])(
    'maps database code %s to %s and never exposes raw details',
    async (message, code) => {
      const { port, rpc } = client({ data: null, error: { message } });
      expect(await port.page(slug, 30, null)).toEqual({ ok: false, code });
      expect(await port.send(slug, operationId, row.body, null)).toEqual({
        ok: false,
        code,
      });
      expect(rpc).toHaveBeenCalledTimes(2);
    },
  );
});
