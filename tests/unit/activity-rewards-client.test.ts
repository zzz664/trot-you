// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { fetchActivitySnapshot } from '@/client/activity-rewards';
import { ACTIVITY_REWARDS } from '@/config/activity-rewards';
import { POINTS_ERROR_STATUS } from '@/config/attendance-points';
import { routes, activityRewardsHistoryPath } from '@/config/routes';
import * as f from './activity-rewards-fixtures';
const ok = (data: unknown) => ({ ok: true, data });
const response = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
const read = () => fetchActivitySnapshot(null, undefined, f.activityActor);
afterEach(() => vi.unstubAllGlobals());
it('reads private actor-bound snapshot with no cache, redirect or write body', async () => {
  const fetcher = vi.fn().mockResolvedValue(response(ok(f.activitySnapshot)));
  vi.stubGlobal('fetch', fetcher);
  expect(await read()).toEqual(ok(f.activitySnapshot));
  expect(fetcher).toHaveBeenCalledExactlyOnceWith(
    routes.activityRewardsApi,
    expect.objectContaining({
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      headers: { [ACTIVITY_REWARDS.actorHeader]: f.activityActor },
    }),
  );
  expect(fetcher.mock.calls[0]![1]).not.toHaveProperty('body');
});
it('encodes microsecond cursor without losing ordering precision', async () => {
  const cursor = {
    id: f.activityEntry.id,
    created_at: '2026-10-26T06:00:00.123457Z',
  };
  const fetcher = vi.fn().mockResolvedValue(response(ok(f.activitySnapshot)));
  vi.stubGlobal('fetch', fetcher);
  expect(
    await fetchActivitySnapshot(cursor, undefined, f.activityActor),
  ).toEqual(ok(f.activitySnapshot));
  expect(fetcher.mock.calls[0]![0]).toBe(
    activityRewardsHistoryPath(
      JSON.stringify({ created_at: cursor.created_at, id: cursor.id }),
    ),
  );
});
it('rejects pages at or ahead of requested cursor', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(response(ok(f.activitySnapshot))),
  );
  expect(
    await fetchActivitySnapshot(
      { id: f.activityEntry.id, created_at: f.activityTime },
      undefined,
      f.activityActor,
    ),
  ).toEqual({ ok: false, code: 'UNAVAILABLE' });
});
it('rejects a snapshot belonging to another account', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue(
        response(ok({ ...f.activitySnapshot, actor_id: f.activityOther })),
      ),
  );
  expect(await read()).toEqual({ ok: false, code: 'UNAVAILABLE' });
});
it.each(Object.entries(POINTS_ERROR_STATUS))(
  'accepts only exact %s error/status pair',
  async (code, status) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(response({ ok: false, code }, status)),
    );
    expect(await read()).toEqual({ ok: false, code });
  },
);
it.each([
  () => response(ok(f.activitySnapshot), 201),
  () => response({ ok: false, code: 'FORBIDDEN' }, 200),
  () => response({ ok: false, code: 'private SQL' }, 500),
  () => response({ ok: false, code: '__proto__' }, 500),
  () => response({ ...ok(f.activitySnapshot), private: true }),
  () => response(ok({ ...f.activitySnapshot, private: true })),
  () => response(ok({})),
  () =>
    response(
      ok({ ...f.activitySnapshot, grade: { configured: true, score: 0 } }),
    ),
  () =>
    response(
      ok({
        ...f.activitySnapshot,
        share: { configured: true, verified_by_click: true },
      }),
    ),
  () =>
    new Response('<html>login</html>', {
      headers: { 'content-type': 'text/html' },
    }),
  () => new Response('{', { headers: { 'content-type': 'application/json' } }),
  () =>
    new Response(new Uint8Array([0xff]), {
      headers: { 'content-type': 'application/json' },
    }),
  () => new Response(null, { headers: { 'content-type': 'application/json' } }),
  () =>
    new Response(' '.repeat(ACTIVITY_REWARDS.responseMaxBytes + 1), {
      headers: { 'content-type': 'application/json' },
    }),
])('rejects malformed transport or unsupported completion %#', async (make) => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(make()));
  expect(await read()).toEqual({ ok: false, code: 'UNAVAILABLE' });
});
it.each([undefined, '', 'bad'])(
  'missing/invalid actor %s prevents I/O',
  async (actor) => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    expect(await fetchActivitySnapshot(null, undefined, actor)).toEqual({
      ok: false,
      code: 'FORBIDDEN',
    });
    expect(fetcher).not.toHaveBeenCalled();
  },
);
it('invalid cursor prevents I/O', async () => {
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  expect(
    await fetchActivitySnapshot(
      { id: 'bad', created_at: f.activityTime },
      undefined,
      f.activityActor,
    ),
  ).toEqual({ ok: false, code: 'INVALID_INPUT' });
  expect(fetcher).not.toHaveBeenCalled();
});
it('already aborted read never starts', async () => {
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  const controller = new AbortController();
  controller.abort();
  expect(
    await fetchActivitySnapshot(null, controller.signal, f.activityActor),
  ).toEqual({ ok: false, code: 'UNAVAILABLE' });
  expect(fetcher).not.toHaveBeenCalled();
});
it('a response arriving after cancellation cannot produce success', async () => {
  const controller = new AbortController();
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation(async () => {
      controller.abort();
      return response(ok(f.activitySnapshot));
    }),
  );
  expect(
    await fetchActivitySnapshot(null, controller.signal, f.activityActor),
  ).toEqual({ ok: false, code: 'UNAVAILABLE' });
});
it('normalizes a valid uppercase actor before sending and comparing identity', async () => {
  const actor = 'ABCDEF12-0000-4000-8000-000000000001';
  const data = { ...f.activitySnapshot, actor_id: actor.toLowerCase() };
  const fetcher = vi.fn().mockResolvedValue(response(ok(data)));
  vi.stubGlobal('fetch', fetcher);
  expect(await fetchActivitySnapshot(null, undefined, actor)).toEqual(ok(data));
  expect(fetcher.mock.calls[0]![1].headers).toEqual({
    [ACTIVITY_REWARDS.actorHeader]: actor.toLowerCase(),
  });
});
it('handles streamed UTF-8 split into single byte chunks', async () => {
  const data = {
    ...f.activitySnapshot,
    contribution_policy: {
      ...f.activitySnapshot.contribution_policy!,
      version: '가상 테스트 정책',
    },
  };
  const encoded = new TextEncoder().encode(JSON.stringify(ok(data)));
  const stream = new ReadableStream({
    start(controller) {
      for (const byte of encoded) controller.enqueue(new Uint8Array([byte]));
      controller.close();
    },
  });
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(stream, {
        headers: { 'content-type': 'application/json; charset=utf-8' },
      }),
    ),
  );
  expect(await read()).toEqual(ok(data));
});
it('cancels an oversized response before parsing', async () => {
  const cancel = vi.fn();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(ACTIVITY_REWARDS.responseMaxBytes + 1));
    },
    cancel,
  });
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(stream, {
        headers: { 'content-type': 'application/json' },
      }),
    ),
  );
  expect(await read()).toEqual({ ok: false, code: 'UNAVAILABLE' });
  expect(cancel).toHaveBeenCalledOnce();
});
it('conceals network failure', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('private')));
  expect(await read()).toEqual({ ok: false, code: 'UNAVAILABLE' });
});
it('conceals read stream failure', async () => {
  const stream = new ReadableStream({
    start(controller) {
      controller.error(new Error('private'));
    },
  });
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(stream, {
        headers: { 'content-type': 'application/json' },
      }),
    ),
  );
  expect(await read()).toEqual({ ok: false, code: 'UNAVAILABLE' });
});
it('keeps absence of policy distinct from explicitly unlimited caps', async () => {
  const data = { ...f.activitySnapshot, contribution_policy: null };
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(ok(data))));
  expect(await read()).toEqual(ok(data));
});
