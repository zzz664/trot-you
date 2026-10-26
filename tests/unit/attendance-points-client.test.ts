// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import {
  fetchPointSnapshot,
  checkAttendance,
} from '@/client/attendance-points';
import {
  ATTENDANCE_POINTS,
  POINTS_ERROR_STATUS,
} from '@/config/attendance-points';
import { routes, pointsHistoryPath } from '@/config/routes';
import * as f from './attendance-points-fixtures';
const ok = (data: unknown) => ({ ok: true, data });
const response = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
afterEach(() => vi.unstubAllGlobals());
const read = () => fetchPointSnapshot(null, undefined, f.pointsActor);
const attend = () =>
  checkAttendance(f.attendanceInput, undefined, f.pointsActor);
it('reads current actor with no cache, redirect or external credentials', async () => {
  const fetcher = vi.fn().mockResolvedValue(response(ok(f.pointSnapshot)));
  vi.stubGlobal('fetch', fetcher);
  expect(await read()).toEqual(ok(f.pointSnapshot));
  expect(fetcher).toHaveBeenCalledExactlyOnceWith(
    routes.pointsApi,
    expect.objectContaining({
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      headers: { [ATTENDANCE_POINTS.actorHeader]: f.pointsActor },
    }),
  );
});
it('lost response retry preserves the same immutable operation', async () => {
  const fetcher = vi
    .fn()
    .mockRejectedValueOnce(new Error('lost'))
    .mockResolvedValueOnce(response(ok(f.attendanceReceipt)));
  vi.stubGlobal('fetch', fetcher);
  expect(await attend()).toEqual({ ok: false, code: 'UNAVAILABLE' });
  expect(await attend()).toEqual(ok(f.attendanceReceipt));
  expect(fetcher.mock.calls.map(([url, init]) => [url, init.body])).toEqual([
    [routes.pointsAttendanceApi, JSON.stringify(f.attendanceInput)],
    [routes.pointsAttendanceApi, JSON.stringify(f.attendanceInput)],
  ]);
  expect(fetcher.mock.calls[0]![1]).toMatchObject({
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    redirect: 'error',
    headers: {
      'Content-Type': 'application/json',
      [ATTENDANCE_POINTS.actorHeader]: f.pointsActor,
    },
  });
});
it('encodes the cursor without reducing submillisecond precision', async () => {
  const cursor = {
    id: f.pointEntry.id,
    created_at: '2026-10-26T06:00:00.123457Z',
  };
  const fetcher = vi.fn().mockResolvedValue(response(ok(f.pointSnapshot)));
  vi.stubGlobal('fetch', fetcher);
  expect(await fetchPointSnapshot(cursor, undefined, f.pointsActor)).toEqual(
    ok(f.pointSnapshot),
  );
  expect(fetcher.mock.calls[0]![0]).toBe(
    pointsHistoryPath(
      JSON.stringify({ created_at: cursor.created_at, id: cursor.id }),
    ),
  );
});
it('rejects a page at or ahead of its cursor', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(response(ok(f.pointSnapshot))),
  );
  expect(
    await fetchPointSnapshot(
      { id: f.pointEntry.id, created_at: f.pointsTime },
      undefined,
      f.pointsActor,
    ),
  ).toEqual({ ok: false, code: 'UNAVAILABLE' });
});
it.each([
  [read, { ...f.pointSnapshot, actor_id: f.pointsOther }],
  [attend, { ...f.attendanceReceipt, actor_id: f.pointsOther }],
  [attend, { ...f.attendanceReceipt, operation_id: f.pointsOther }],
] as const)('rejects mismatched identity or intent %#', async (call, data) => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(ok(data))));
  expect(await call()).toEqual({ ok: false, code: 'UNAVAILABLE' });
});
it.each(Object.entries(POINTS_ERROR_STATUS))(
  'accepts only the exact %s error/status pair',
  async (code, status) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(response({ ok: false, code }, status)),
    );
    expect(await read()).toEqual({ ok: false, code });
  },
);
for (const [call, output] of [
  [read, f.pointSnapshot],
  [attend, f.attendanceReceipt],
] as const) {
  it.each([
    () => response(ok(output), 201),
    () => response({ ok: false, code: 'FORBIDDEN' }, 200),
    () => response({ ok: false, code: 'internal SQL' }, 500),
    () => response({ ok: false, code: '__proto__' }, 500),
    () => response({ ...ok(output), private: true }),
    () => response(ok({ ...output, private: true })),
    () => response(ok({})),
    () =>
      new Response('<html>login</html>', {
        headers: { 'content-type': 'text/html' },
      }),
    () =>
      new Response('{', { headers: { 'content-type': 'application/json' } }),
    () =>
      new Response(new Uint8Array([0xff]), {
        headers: { 'content-type': 'application/json' },
      }),
    () =>
      new Response(null, { headers: { 'content-type': 'application/json' } }),
    () =>
      new Response(' '.repeat(ATTENDANCE_POINTS.responseMaxBytes + 1), {
        headers: { 'content-type': 'application/json' },
      }),
  ])(
    'malformed transport %# is uncertain, never fake success',
    async (make) => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(make()));
      expect(await call()).toEqual({ ok: false, code: 'UNAVAILABLE' });
    },
  );
}
it.each([undefined, '', 'bad'])(
  'absent/invalid actor %s stops before I/O',
  async (actor) => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    expect(await fetchPointSnapshot(null, undefined, actor)).toEqual({
      ok: false,
      code: 'FORBIDDEN',
    });
    expect(await checkAttendance(f.attendanceInput, undefined, actor)).toEqual({
      ok: false,
      code: 'FORBIDDEN',
    });
    expect(fetcher).not.toHaveBeenCalled();
  },
);
it('already-aborted read/write does not start a request', async () => {
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  const controller = new AbortController();
  controller.abort();
  expect(
    await fetchPointSnapshot(null, controller.signal, f.pointsActor),
  ).toEqual({ ok: false, code: 'UNAVAILABLE' });
  expect(
    await checkAttendance(f.attendanceInput, controller.signal, f.pointsActor),
  ).toEqual({ ok: false, code: 'UNAVAILABLE' });
  expect(fetcher).not.toHaveBeenCalled();
});
it('validates client input before network I/O', async () => {
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  expect(
    await fetchPointSnapshot(
      { id: 'bad', created_at: f.pointsTime },
      undefined,
      f.pointsActor,
    ),
  ).toEqual({ ok: false, code: 'INVALID_INPUT' });
  expect(
    await checkAttendance({ operation_id: 'bad' }, undefined, f.pointsActor),
  ).toEqual({ ok: false, code: 'INVALID_INPUT' });
  expect(fetcher).not.toHaveBeenCalled();
});
it('handles multi-byte JSON split across stream chunks', async () => {
  const encoded = new TextEncoder().encode(JSON.stringify(ok(f.pointSnapshot)));
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
  expect(await read()).toEqual(ok(f.pointSnapshot));
});
it('cancels an oversized body before parsing', async () => {
  const cancel = vi.fn();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(
        new Uint8Array(ATTENDANCE_POINTS.responseMaxBytes + 1),
      );
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
it('a read stream failure is uncertain and does not expose its details', async () => {
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
  expect(await attend()).toEqual({ ok: false, code: 'UNAVAILABLE' });
});
