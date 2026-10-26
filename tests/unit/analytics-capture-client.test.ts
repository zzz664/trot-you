// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { recordMessageOpen, recordPreviewRender } from '@/client/analytics';
import { ANALYTICS_PREVIEW_ACTOR_HEADER } from '@/config/analytics';
import { routes } from '@/config/routes';
const source = 'a3900000-0000-4000-8000-000000000001';
const key = 'a3900000-0000-4000-8000-000000000002';
const fetcher = vi.fn();
beforeEach(() => {
  fetcher.mockReset();
  vi.stubGlobal('fetch', fetcher);
  fetcher.mockResolvedValue(new Response(null, { status: 204 }));
});
afterEach(() => vi.unstubAllGlobals());
describe.each([
  {
    name: 'message',
    send: recordMessageOpen,
    path: routes.analytics,
    body: {
      event_key: key,
      name: 'message_open',
      properties: { source_id: source },
    },
  },
  {
    name: 'preview',
    send: (sourceId: string, eventKey: string, signal?: AbortSignal) =>
      recordPreviewRender(sourceId, eventKey, source, signal),
    path: routes.analyticsPreview,
    body: { event_key: key, source_id: source },
  },
])('optional $name lifecycle observation', ({ send, path, body }) => {
  it('sends minimal identifiers only with private bounded transport', async () => {
    const controller = new AbortController();
    await send(source, key, controller.signal);
    expect(fetcher).toHaveBeenCalledExactlyOnceWith(path, {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      headers: {
        'Content-Type': 'application/json',
        ...(path === routes.analyticsPreview
          ? { [ANALYTICS_PREVIEW_ACTOR_HEADER]: source }
          : {}),
      },
      body: JSON.stringify(body),
      signal: expect.any(AbortSignal),
    });
    controller.abort();
    expect(fetcher.mock.calls[0]![1].signal.aborted).toBe(true);
    expect(fetcher.mock.calls[0]![1]).not.toHaveProperty('keepalive');
  });
  it.each([
    ['invalid', key],
    [source, 'invalid'],
    ['', key],
    [source, ''],
  ])(
    'rejects malformed source/key %s %s without I/O',
    async (sourceId, eventKey) => {
      await send(sourceId, eventKey);
      expect(fetcher).not.toHaveBeenCalled();
    },
  );
  it('does not send after an aborted lifecycle', async () => {
    const controller = new AbortController();
    controller.abort();
    await send(source, key, controller.signal);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([400, 401, 403, 409, 429, 500, 503])(
    'does not retry or surface status %i',
    async (status) => {
      fetcher.mockResolvedValue(new Response('ignored', { status }));
      await expect(send(source, key)).resolves.toBeUndefined();
      expect(fetcher).toHaveBeenCalledOnce();
    },
  );
  it('does not retry unknown outcome, decode a response or leak its contents', async () => {
    fetcher.mockRejectedValueOnce(new Error('unknown'));
    await expect(send(source, key)).resolves.toBeUndefined();
    expect(fetcher).toHaveBeenCalledOnce();
    const cancel = vi.fn().mockRejectedValue(new Error('cancel'));
    fetcher.mockResolvedValueOnce({ body: { cancel }, json: vi.fn() });
    await expect(send(source, key)).resolves.toBeUndefined();
    expect(cancel).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});

it.each(['', 'invalid'])(
  'never sends a preview without a valid rendered actor %s',
  async (actor) => {
    await recordPreviewRender(source, key, actor);
    expect(fetcher).not.toHaveBeenCalled();
  },
);
