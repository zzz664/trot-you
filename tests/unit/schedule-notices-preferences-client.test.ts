// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import {
  fetchScheduleNoticePreferences,
  saveScheduleNoticePreference,
  saveScheduleNoticeEvent,
} from '@/client/schedule-notices';
import { SCHEDULES, SCHEDULE_ERROR_STATUS } from '@/config/schedules';
import { SCHEDULE_NOTICE } from '@/config/schedule-notices';
import { routes } from '@/config/routes';
import {
  scheduleNoticeState,
  scheduleNoticeEventState,
  scheduleNoticeActor,
  scheduleNoticeEvent,
} from './schedule-notices-preferences-fixtures';
afterEach(() => vi.unstubAllGlobals());
const reply = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
it('uses bounded no-store same-origin requests with current mounted actor header', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValue(reply({ ok: true, data: scheduleNoticeState }));
  vi.stubGlobal('fetch', fetcher);
  expect(
    await fetchScheduleNoticePreferences(null, undefined, scheduleNoticeActor),
  ).toEqual({ ok: true, data: scheduleNoticeState });
  expect(fetcher).toHaveBeenCalledExactlyOnceWith(
    routes.scheduleNoticeStatus,
    expect.objectContaining({
      method: 'GET',
      cache: 'no-store',
      credentials: 'same-origin',
      redirect: 'error',
      headers: { [SCHEDULES.actorHeader]: scheduleNoticeActor },
    }),
  );
});
it('binds event/global projection and exact request with no automatic retry', async () => {
  const f = vi
    .fn()
    .mockResolvedValueOnce(reply({ ok: true, data: scheduleNoticeEventState }))
    .mockResolvedValueOnce(
      reply({
        ok: true,
        data: { ...scheduleNoticeState, scheduleEnabled: true },
      }),
    )
    .mockResolvedValueOnce(
      reply({
        ok: true,
        data: { ...scheduleNoticeEventState, eventEnabled: false },
      }),
    )
    .mockRejectedValue(new Error('private'));
  vi.stubGlobal('fetch', f);
  expect((await fetchScheduleNoticePreferences(scheduleNoticeEvent)).ok).toBe(
    true,
  );
  expect(f.mock.calls[0]?.[0]).toBe(
    `${routes.scheduleNoticeStatus}?id=${scheduleNoticeEvent}`,
  );
  expect((await saveScheduleNoticePreference(true)).ok).toBe(true);
  expect(f.mock.calls[1]).toEqual([
    routes.scheduleNoticePreference,
    expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ enabled: true }),
    }),
  ]);
  expect((await saveScheduleNoticeEvent(scheduleNoticeEvent, false)).ok).toBe(
    true,
  );
  expect(f.mock.calls[2]).toEqual([
    routes.scheduleNoticeEvent,
    expect.objectContaining({
      body: JSON.stringify({ scheduleId: scheduleNoticeEvent, enabled: false }),
    }),
  ]);
  expect(await saveScheduleNoticePreference(true)).toEqual({
    ok: false,
    code: 'UNAVAILABLE',
  });
  expect(f).toHaveBeenCalledTimes(4);
});
it('does not request malformed ids, actor keys, values or already canceled requests', async () => {
  const f = vi.fn();
  vi.stubGlobal('fetch', f);
  for (const result of [
    await fetchScheduleNoticePreferences('bad'),
    await fetchScheduleNoticePreferences(null, undefined, 'bad'),
    await fetchScheduleNoticePreferences(null, AbortSignal.abort()),
    await saveScheduleNoticePreference(null as unknown as boolean),
    await saveScheduleNoticeEvent('bad', true),
  ])
    expect(result.ok).toBe(false);
  expect(f).not.toHaveBeenCalled();
});
it.each(Object.entries(SCHEDULE_ERROR_STATUS))(
  'accepts matching safe %s response',
  async (code, status) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(reply({ ok: false, code }, status)),
    );
    expect(await fetchScheduleNoticePreferences(null)).toEqual({
      ok: false,
      code,
    });
  },
);
it.each([
  () => reply({ ok: true, data: scheduleNoticeState }, 503),
  () => reply({ ok: false, code: 'FORBIDDEN' }, 200),
  () => reply({ ok: false, code: 'PRIVATE_SQL' }, 400),
  () => reply({ ok: true, data: scheduleNoticeEventState }),
  () => reply({ ok: true, data: { ...scheduleNoticeState, configured: true } }),
  () => new Response('{}', { headers: { 'content-type': 'text/html' } }),
  () => new Response('{', { headers: { 'content-type': 'application/json' } }),
  () =>
    new Response(' '.repeat(SCHEDULE_NOTICE.responseMaxBytes + 1), {
      headers: { 'content-type': 'application/json' },
    }),
])('rejects malformed/ambiguous envelope %#', async (make) => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(make()));
  expect(await fetchScheduleNoticePreferences(null)).toEqual({
    ok: false,
    code: 'UNAVAILABLE',
  });
});
it('rejects a global projection in an event response', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(reply({ ok: true, data: scheduleNoticeState })),
  );
  expect(await fetchScheduleNoticePreferences(scheduleNoticeEvent)).toEqual({
    ok: false,
    code: 'UNAVAILABLE',
  });
});

it('rejects mutation acknowledgments that do not match the requested desired value', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValueOnce(reply({ ok: true, data: scheduleNoticeState }))
      .mockResolvedValueOnce(
        reply({ ok: true, data: scheduleNoticeEventState }),
      ),
  );
  expect(await saveScheduleNoticePreference(true)).toEqual({
    ok: false,
    code: 'UNAVAILABLE',
  });
  expect(await saveScheduleNoticeEvent(scheduleNoticeEvent, false)).toEqual({
    ok: false,
    code: 'UNAVAILABLE',
  });
});
