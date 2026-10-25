// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import {
  fetchSchedules,
  fetchScheduleArtists,
  fetchSchedule,
  fetchAdminSchedules,
  fetchAdminSchedule,
  saveAdminSchedule,
  deleteAdminSchedule,
} from '@/client/schedules';
import { SCHEDULES, SCHEDULE_ERROR_STATUS } from '@/config/schedules';
import {
  scheduleListPath,
  adminScheduleListPath,
  adminScheduleApiPath,
} from '@/config/routes';
import {
  scheduleEvent,
  adminSchedule,
  scheduleOperation,
} from './schedules-ui-fixtures';
afterEach(() => vi.unstubAllGlobals());
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
const list = {
  month: '2026-10',
  items: [scheduleEvent],
  nextCursor: null,
  myArtistIds: [scheduleEvent.artist_id],
};
it('requests no-store same-origin bounded authenticated fan data without redirects', async () => {
  const fetcher = vi.fn().mockResolvedValue(reply({ ok: true, data: list }));
  vi.stubGlobal('fetch', fetcher);
  expect(await fetchSchedules({ month: '2026-10', cursor: null })).toEqual({
    ok: true,
    data: list,
  });
  expect(fetcher).toHaveBeenCalledWith(
    scheduleListPath('2026-10', null, true),
    expect.objectContaining({
      method: 'GET',
      cache: 'no-store',
      credentials: 'same-origin',
      redirect: 'error',
    }),
  );
});
it('uses distinct exact detail/admin schemas', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(reply({ ok: true, data: scheduleEvent }))
    .mockResolvedValueOnce(reply({ ok: true, data: adminSchedule }))
    .mockResolvedValueOnce(
      reply({
        ok: true,
        data: {
          month: '2026-10',
          page: 1,
          page_size: 30,
          has_more: false,
          items: [adminSchedule],
        },
      }),
    );
  vi.stubGlobal('fetch', fetcher);
  expect((await fetchSchedule(scheduleEvent.id)).ok).toBe(true);
  expect((await fetchAdminSchedule(scheduleEvent.id)).ok).toBe(true);
  expect((await fetchAdminSchedules({ month: '2026-10', page: 1 })).ok).toBe(
    true,
  );
  expect(fetcher.mock.calls[2]?.[0]).toBe(
    adminScheduleListPath('2026-10', 1, true),
  );
});
it('submits exact save/delete operation with no automatic uncertain retry', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(reply({ ok: true, data: adminSchedule }))
    .mockResolvedValueOnce(
      reply({ ok: true, data: { id: adminSchedule.id, deleted: true } }),
    )
    .mockRejectedValue(new Error('private details'));
  vi.stubGlobal('fetch', fetcher);
  expect((await saveAdminSchedule(scheduleOperation)).ok).toBe(true);
  const deletion = {
    operation_id: scheduleOperation.operation_id,
    schedule_id: adminSchedule.id,
    expected_revision: 1,
    confirmed: true as const,
  };
  expect((await deleteAdminSchedule(deletion)).ok).toBe(true);
  expect(fetcher).toHaveBeenNthCalledWith(
    1,
    adminScheduleApiPath('save'),
    expect.objectContaining({
      body: JSON.stringify(scheduleOperation),
      method: 'POST',
    }),
  );
  expect(fetcher).toHaveBeenNthCalledWith(
    2,
    adminScheduleApiPath('delete'),
    expect.objectContaining({ body: JSON.stringify(deletion) }),
  );
  expect(await saveAdminSchedule(scheduleOperation)).toEqual({
    ok: false,
    code: 'UNAVAILABLE',
  });
  expect(fetcher).toHaveBeenCalledTimes(3);
});
it('rejects malformed arguments and already canceled request without network', async () => {
  const f = vi.fn();
  vi.stubGlobal('fetch', f);
  expect((await fetchSchedules({ month: '0000-01', cursor: null })).ok).toBe(
    false,
  );
  expect((await fetchAdminSchedules({ month: '2026-01', page: 0 })).ok).toBe(
    false,
  );
  expect((await fetchSchedule('bad')).ok).toBe(false);
  expect((await fetchAdminSchedule('bad')).ok).toBe(false);
  expect(
    (await saveAdminSchedule({ ...scheduleOperation, expected_revision: null }))
      .ok,
  ).toBe(false);
  expect(
    (
      await deleteAdminSchedule({
        operation_id: 'bad',
        schedule_id: adminSchedule.id,
        expected_revision: 1,
        confirmed: true,
      })
    ).ok,
  ).toBe(false);
  expect((await fetchSchedule(scheduleEvent.id, AbortSignal.abort())).ok).toBe(
    false,
  );
  expect(f).not.toHaveBeenCalled();
});
it.each(Object.entries(SCHEDULE_ERROR_STATUS))(
  'accepts only matching safe %s envelope',
  async (code, status) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(reply({ ok: false, code }, status)),
    );
    expect(await fetchSchedule(scheduleEvent.id)).toEqual({ ok: false, code });
  },
);
it.each([
  () => reply({ ok: true, data: adminSchedule }),
  () => reply({ ok: true, data: scheduleEvent }, 503),
  () => reply({ ok: false, code: 'FORBIDDEN' }, 200),
  () => reply({ ok: false, code: 'PRIVATE_SQL' }, 400),
  () => new Response('bad', { headers: { 'content-type': 'text/html' } }),
  () => new Response('{', { headers: { 'content-type': 'application/json' } }),
  () =>
    new Response(' '.repeat(SCHEDULES.responseMaxBytes + 1), {
      headers: { 'content-type': 'application/json' },
    }),
])('rejects malformed private responses', async (response) => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response()));
  expect(await fetchSchedule(scheduleEvent.id)).toEqual({
    ok: false,
    code: 'UNAVAILABLE',
  });
});
it('rejects valid envelopes bound to a different requested month, page or event', async () => {
  const another = '3b0d4317-b739-4670-a0ce-02173f1e8109';
  const f = vi
    .fn()
    .mockResolvedValueOnce(
      reply({ ok: true, data: { ...list, month: '2026-11' } }),
    )
    .mockResolvedValueOnce(
      reply({
        ok: true,
        data: {
          month: '2026-11',
          page: 1,
          page_size: 30,
          has_more: false,
          items: [],
        },
      }),
    )
    .mockResolvedValueOnce(
      reply({
        ok: true,
        data: {
          month: '2026-10',
          page: 2,
          page_size: 30,
          has_more: false,
          items: [],
        },
      }),
    )
    .mockResolvedValueOnce(
      reply({ ok: true, data: { ...scheduleEvent, id: another } }),
    )
    .mockResolvedValueOnce(
      reply({ ok: true, data: { ...adminSchedule, id: another } }),
    )
    .mockResolvedValueOnce(
      reply({ ok: true, data: { ...adminSchedule, id: another } }),
    )
    .mockResolvedValueOnce(
      reply({ ok: true, data: { id: another, deleted: true } }),
    );
  vi.stubGlobal('fetch', f);
  const unavailable = { ok: false, code: 'UNAVAILABLE' };
  expect(await fetchSchedules({ month: '2026-10', cursor: null })).toEqual(
    unavailable,
  );
  expect(await fetchAdminSchedules({ month: '2026-10', page: 1 })).toEqual(
    unavailable,
  );
  expect(await fetchAdminSchedules({ month: '2026-10', page: 1 })).toEqual(
    unavailable,
  );
  expect(await fetchSchedule(scheduleEvent.id)).toEqual(unavailable);
  expect(await fetchAdminSchedule(scheduleEvent.id)).toEqual(unavailable);
  expect(await saveAdminSchedule(scheduleOperation)).toEqual(unavailable);
  expect(
    await deleteAdminSchedule({
      operation_id: scheduleOperation.operation_id,
      schedule_id: scheduleEvent.id,
      expected_revision: 1,
      confirmed: true,
    }),
  ).toEqual(unavailable);
});

it('binds all screen data reads and mutations to the mounted actor in a same-origin header', async () => {
  const actor = '3b0d4317-b739-4670-a0ce-02173f1e8110';
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(reply({ ok: true, data: list }))
    .mockResolvedValueOnce(reply({ ok: true, data: scheduleEvent }))
    .mockResolvedValueOnce(
      reply({
        ok: true,
        data: {
          month: '2026-10',
          page: 1,
          page_size: 30,
          has_more: false,
          items: [adminSchedule],
        },
      }),
    )
    .mockResolvedValueOnce(reply({ ok: true, data: adminSchedule }))
    .mockResolvedValueOnce(
      reply({ ok: true, data: { artists: [], has_more: false } }),
    )
    .mockResolvedValueOnce(reply({ ok: true, data: adminSchedule }))
    .mockResolvedValueOnce(
      reply({ ok: true, data: { id: adminSchedule.id, deleted: true } }),
    );
  vi.stubGlobal('fetch', fetcher);
  expect(
    (await fetchSchedules({ month: '2026-10', cursor: null }, undefined, actor))
      .ok,
  ).toBe(true);
  expect((await fetchSchedule(scheduleEvent.id, undefined, actor)).ok).toBe(
    true,
  );
  expect(
    (await fetchAdminSchedules({ month: '2026-10', page: 1 }, undefined, actor))
      .ok,
  ).toBe(true);
  expect(
    (await fetchAdminSchedule(adminSchedule.id, undefined, actor)).ok,
  ).toBe(true);
  expect((await fetchScheduleArtists(1, undefined, actor)).ok).toBe(true);
  expect(
    (await saveAdminSchedule(scheduleOperation, undefined, actor)).ok,
  ).toBe(true);
  expect(
    (
      await deleteAdminSchedule(
        {
          operation_id: scheduleOperation.operation_id,
          schedule_id: adminSchedule.id,
          expected_revision: 1,
          confirmed: true,
        },
        undefined,
        actor,
      )
    ).ok,
  ).toBe(true);
  expect(fetcher).toHaveBeenCalledTimes(7);
  for (const [, options] of fetcher.mock.calls)
    expect(options).toMatchObject({
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { [SCHEDULES.actorHeader]: actor },
    });
  expect(fetcher.mock.calls[4]?.[0]).toBe(
    `${adminScheduleApiPath()}?artists=1&page=1`,
  );
});
it('fails closed for malformed actor binding or artist pagination without sending a request', async () => {
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  expect(
    await fetchSchedule(scheduleEvent.id, undefined, 'not-an-actor'),
  ).toEqual({ ok: false, code: 'FORBIDDEN' });
  expect(await fetchScheduleArtists(0)).toEqual({
    ok: false,
    code: 'INVALID_INPUT',
  });
  expect(await fetchScheduleArtists(1, undefined, 'not-an-actor')).toEqual({
    ok: false,
    code: 'FORBIDDEN',
  });
  expect(fetcher).not.toHaveBeenCalled();
});
