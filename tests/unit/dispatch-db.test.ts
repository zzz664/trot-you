// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  createDispatchPort,
  createDispatchWorkerPort,
} from '@/server/db/message-dispatch';
import type { ActorClient } from '@/server/db/client';
import type { CheckoutServiceClient } from '@/server/db/checkout-client';
const id = 'a4000000-0000-4000-8000-000000000001';
const operationId = 'a4000000-0000-4000-8000-000000000002';
const slug = 'fictional-dispatch';
const stamp = '2026-10-24T00:00:00.123456+00:00';
const row = {
  id,
  kind: 'text',
  body: '안녕 {이름}',
  revision: 2,
  status: 'sent',
  created_at: stamp,
  scheduled_at: stamp,
  sent_at: stamp,
  canceled_at: null,
  cancel_before: stamp,
  can_cancel: true,
  notification_state: 'queued',
  dispatch_error: null,
  media: [],
  author_id: 'private',
  endpoint: 'private',
  user_id: 'private',
};
const item = {
  id,
  kind: 'text',
  body: '안녕 {이름}',
  revision: 2,
  status: 'sent',
  createdAt: stamp,
  scheduledAt: stamp,
  sentAt: stamp,
  canceledAt: null,
  cancelBefore: stamp,
  canCancel: true,
  notificationState: 'queued',
  dispatchError: null,
  media: [],
};
const page = {
  artist: { id, slug, name: '가상' },
  server_now: stamp,
  cancel_window_seconds: 300,
  messages: [row],
  selected_message: row,
  has_more: false,
  recipient_ids: ['private'],
};
function db(data: unknown, error: unknown = null) {
  const rpc = vi.fn().mockResolvedValue({ data, error });
  return { rpc, port: createDispatchPort({ rpc } as unknown as ActorClient) };
}
describe('actor-bound dispatch database adapter', () => {
  it('projects safe receipt, preserving exact cursor precision and no caller actor', async () => {
    const { port, rpc } = db(page);
    expect(
      await port.context(slug, id, { slug, id, createdAt: stamp }),
    ).toEqual({
      ok: true,
      data: {
        artist: page.artist,
        serverNow: stamp,
        cancelWindowSeconds: 300,
        messages: [item],
        selectedMessage: item,
        hasMore: false,
      },
    });
    expect(rpc).toHaveBeenCalledExactlyOnceWith('artist_dispatch_context', {
      p_artist_slug: slug,
      p_message_id: id,
      p_before_created_at: stamp,
      p_before_id: id,
    });
  });
  it('omits nullable optional context arguments', async () => {
    const { port, rpc } = db(page);
    await port.context(slug, null, null);
    expect(rpc).toHaveBeenCalledExactlyOnceWith('artist_dispatch_context', {
      p_artist_slug: slug,
    });
  });
  it.each([null, stamp])(
    'maps submit schedule %s without confirmation/identity fields',
    async (scheduledAt) => {
      const { port, rpc } = db(row);
      expect(
        await port.submit({
          slug,
          messageId: id,
          operationId,
          expectedRevision: 1,
          scheduledAt,
          confirmed: true,
        }),
      ).toEqual({ ok: true, data: item });
      expect(rpc).toHaveBeenCalledExactlyOnceWith('artist_dispatch_submit', {
        p_artist_slug: slug,
        p_message_id: id,
        p_operation_id: operationId,
        p_expected_revision: 1,
        ...(scheduledAt ? { p_scheduled_at: scheduledAt } : {}),
      });
    },
  );
  it('maps cancel only to current actor RPC and stable operation', async () => {
    const { port, rpc } = db(row);
    await port.cancel({ slug, messageId: id, operationId, confirmed: true });
    expect(rpc).toHaveBeenCalledExactlyOnceWith('artist_dispatch_cancel', {
      p_artist_slug: slug,
      p_message_id: id,
      p_operation_id: operationId,
    });
  });
  it.each([
    ['DISPATCH_SCHEDULE_INVALID', 'INVALID_INPUT'],
    ['DISPATCH_INVALID_INPUT', 'INVALID_INPUT'],
    ['DISPATCH_NOT_FOUND', 'NOT_FOUND'],
    ['DISPATCH_REVISION_CONFLICT', 'CONFLICT'],
    ['DISPATCH_NOT_DRAFT', 'CONFLICT'],
    ['DISPATCH_OPERATION_CONFLICT', 'IDEMPOTENCY_CONFLICT'],
    ['DISPATCH_UPLOAD_PENDING', 'MEDIA_PENDING'],
    ['DISPATCH_RATE_LIMITED', 'RATE_LIMITED'],
    ['DISPATCH_BACKPRESSURE', 'BACKPRESSURE'],
    ['DISPATCH_CONTENT_INVALID', 'INVALID_INPUT'],
    ['MESSAGE_MEDIA_REQUIRED', 'INVALID_INPUT'],
    ['MEDIA_OBJECT_CHANGED', 'INVALID_INPUT'],
    ['COMPOSE_FORBIDDEN', 'FORBIDDEN'],
    ['COMPOSE_SETUP_NOT_READY', 'SETUP_NOT_READY'],
    ['MESSAGE_POLICY_REQUIRED', 'SETUP_NOT_READY'],
    ['CANCEL_WINDOW_PASSED', 'CANCEL_WINDOW_PASSED'],
    ['private SQL detail', 'UNAVAILABLE'],
  ])('maps exact %s without leaking database detail', async (message, code) => {
    const { port } = db(null, { message });
    expect(await port.context(slug, null, null)).toEqual({ ok: false, code });
  });
  it.each([
    null,
    {},
    { ...row, notification_state: 'provider_delivered' },
    { ...row, media: [null] },
    { ...row, revision: -1 },
  ])('rejects malformed receipt %#', async (value) => {
    const { port } = db(value);
    expect(
      await port.submit({
        slug,
        messageId: id,
        operationId,
        expectedRevision: 1,
        scheduledAt: null,
        confirmed: true,
      }),
    ).toEqual({ ok: false, code: 'UNAVAILABLE' });
  });
  it('projects media identity without object paths', async () => {
    const media = {
      id,
      kind: 'photo',
      width: 10,
      height: 20,
      duration_ms: null,
      object_path: 'private',
    };
    const { port } = db({ ...row, kind: 'photo', media: [media] });
    const result = await port.submit({
      slug,
      messageId: id,
      operationId,
      expectedRevision: 1,
      scheduledAt: null,
      confirmed: true,
    });
    expect(result.ok && result.data.media).toEqual([
      { id, kind: 'photo', width: 10, height: 20, durationMs: null },
    ]);
    expect(JSON.stringify(result)).not.toContain('private');
  });
});
describe('bounded service-only dispatch worker adapter', () => {
  it('returns aggregate publication only, never provider delivery claims', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        published: 2,
        blocked: 1,
        skipped: 0,
        has_more: true,
        secret: 'private',
      },
      error: null,
    });
    expect(
      await createDispatchWorkerPort({
        rpc,
      } as unknown as CheckoutServiceClient).run(10),
    ).toEqual({
      ok: true,
      data: { published: 2, blocked: 1, skipped: 0, hasMore: true },
    });
    expect(rpc).toHaveBeenCalledExactlyOnceWith('message_dispatch_run', {
      p_limit: 10,
    });
  });
  it.each([
    { data: null, error: { message: 'private' } },
    {
      data: { published: 11, blocked: 0, skipped: 0, has_more: true },
      error: null,
    },
  ])('fails unavailable/invalid %# closed', async (result) => {
    const rpc = vi.fn().mockResolvedValue(result);
    expect(
      await createDispatchWorkerPort({
        rpc,
      } as unknown as CheckoutServiceClient).run(10),
    ).toEqual({ ok: false, code: 'UNAVAILABLE' });
  });
});
