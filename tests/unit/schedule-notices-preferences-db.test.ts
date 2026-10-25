// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { createScheduleNoticePreferencePort } from '@/server/db/schedule-notice-preferences';
import type { ActorClient } from '@/server/db/client';
import {
  scheduleNoticeState,
  scheduleNoticeEventState,
  scheduleNoticeEvent,
  scheduleNoticeRow,
} from './schedule-notices-preferences-fixtures';
function fixture(
  data: unknown = [scheduleNoticeRow()],
  error: { message: string } | null = null,
) {
  const rpc = vi.fn().mockResolvedValue({ data, error });
  return {
    rpc,
    port: createScheduleNoticePreferencePort({ rpc } as unknown as ActorClient),
  };
}
it('gets JWT-owned global state without a spoofable actor and exact event state', async () => {
  const f = fixture();
  expect(await f.port.preferences(null)).toEqual({
    ok: true,
    data: scheduleNoticeState,
  });
  expect(f.rpc).toHaveBeenLastCalledWith('schedule_notice_preferences', {});
  f.rpc.mockResolvedValue({
    data: [scheduleNoticeRow(scheduleNoticeEventState)],
    error: null,
  });
  expect(await f.port.preferences(scheduleNoticeEvent)).toEqual({
    ok: true,
    data: scheduleNoticeEventState,
  });
  expect(f.rpc).toHaveBeenLastCalledWith('schedule_notice_preferences', {
    p_schedule_id: scheduleNoticeEvent,
  });
});
it.each([true, false])(
  'sets explicit preference %s through transactional RPC',
  async (enabled) => {
    const f = fixture();
    expect((await f.port.setPreference(enabled)).ok).toBe(true);
    expect(f.rpc).toHaveBeenCalledExactlyOnceWith(
      'schedule_notice_set_preference',
      { p_enabled: enabled },
    );
  },
);
it.each([true, false])(
  'sets explicit event preference %s through transactional RPC',
  async (enabled) => {
    const f = fixture([scheduleNoticeRow(scheduleNoticeEventState)]);
    expect((await f.port.setEvent(scheduleNoticeEvent, enabled)).ok).toBe(true);
    expect(f.rpc).toHaveBeenCalledExactlyOnceWith('schedule_notice_set_event', {
      p_schedule_id: scheduleNoticeEvent,
      p_enabled: enabled,
    });
  },
);
it.each([
  [],
  null,
  [scheduleNoticeRow(), scheduleNoticeRow()],
  [{ ...scheduleNoticeRow(), schedule_enabled: null }],
  [{ ...scheduleNoticeRow(), configured: true, hour_kst: null }],
  [{ ...scheduleNoticeRow(), hour_kst: 10 }],
])('fails malformed/ambiguous state closed %#', async (data) => {
  expect(await fixture(data).port.preferences(null)).toEqual({
    ok: false,
    code: 'UNAVAILABLE',
  });
});
it.each([
  ['CALENDAR_FORBIDDEN', 'FORBIDDEN'],
  ['CALENDAR_ARTIST_UNAVAILABLE', 'ARTIST_UNAVAILABLE'],
  ['SCHEDULE_NOTIFICATION_REQUIRED', 'INVALID_INPUT'],
  ['NOTIFICATION_ACTOR_FORBIDDEN', 'FORBIDDEN'],
  ['NOTIFICATION_PREFERENCES_REQUIRED', 'INVALID_INPUT'],
  ['SCHEDULE_NOTICE_INVALID_INPUT', 'INVALID_INPUT'],
  ['SCHEDULE_NOTICE_UNAVAILABLE', 'NOT_FOUND'],
  ['SCHEDULE_UNAVAILABLE', 'NOT_FOUND'],
  ['PRIVATE_DATABASE_DETAIL', 'UNAVAILABLE'],
  ['constructor', 'UNAVAILABLE'],
])('maps only recognized %s error', async (message, code) => {
  expect(await fixture(null, { message }).port.preferences(null)).toEqual({
    ok: false,
    code,
  });
});
