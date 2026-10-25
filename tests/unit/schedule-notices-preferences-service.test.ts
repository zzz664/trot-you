import { expect, it, vi } from 'vitest';
import {
  readScheduleNoticePreferences,
  setScheduleNoticePreference,
  setScheduleNoticeEvent,
} from '@/server/services/schedule-notices/preferences';
import { scheduleNoticeStateSchema } from '@/config/schedule-notices';
import {
  scheduleNoticeState,
  scheduleNoticeEventState,
  scheduleNoticeEvent,
} from './schedule-notices-preferences-fixtures';
function fixture() {
  return {
    preferences: vi
      .fn()
      .mockResolvedValue({ ok: true, data: scheduleNoticeState }),
    setPreference: vi
      .fn()
      .mockResolvedValue({ ok: true, data: scheduleNoticeState }),
    setEvent: vi
      .fn()
      .mockResolvedValue({ ok: true, data: scheduleNoticeEventState }),
  };
}
it('reads global and exact event preferences without actor arguments', async () => {
  const port = fixture();
  expect(
    await readScheduleNoticePreferences(port, { scheduleId: null }),
  ).toEqual({ ok: true, data: scheduleNoticeState });
  expect(port.preferences).toHaveBeenLastCalledWith(null);
  port.preferences.mockResolvedValue({
    ok: true,
    data: scheduleNoticeEventState,
  });
  expect(
    await readScheduleNoticePreferences(port, {
      scheduleId: scheduleNoticeEvent,
    }),
  ).toEqual({ ok: true, data: scheduleNoticeEventState });
  expect(port.preferences).toHaveBeenLastCalledWith(scheduleNoticeEvent);
});
it.each([true, false])(
  'writes desired global and event boolean %s explicitly and once',
  async (enabled) => {
    const port = fixture();
    await setScheduleNoticePreference(port, { enabled });
    await setScheduleNoticeEvent(port, {
      scheduleId: scheduleNoticeEvent,
      enabled,
    });
    expect(port.setPreference).toHaveBeenCalledExactlyOnceWith(enabled);
    expect(port.setEvent).toHaveBeenCalledExactlyOnceWith(
      scheduleNoticeEvent,
      enabled,
    );
  },
);
it.each([
  null,
  {},
  [],
  { scheduleId: 'bad' },
  { scheduleId: null, actorId: 'other' },
])('rejects malformed query %# before data access', async (input) => {
  const port = fixture();
  expect(await readScheduleNoticePreferences(port, input)).toEqual({
    ok: false,
    code: 'INVALID_INPUT',
  });
  expect(port.preferences).not.toHaveBeenCalled();
});
it.each([
  null,
  {},
  [],
  { enabled: 1 },
  { enabled: 'true' },
  { enabled: true, userId: 'other' },
])('rejects malformed global desired state %#', async (input) => {
  const port = fixture();
  expect(await setScheduleNoticePreference(port, input)).toEqual({
    ok: false,
    code: 'INVALID_INPUT',
  });
  expect(port.setPreference).not.toHaveBeenCalled();
});
it.each([
  null,
  {},
  [],
  { scheduleId: 'bad', enabled: true },
  { scheduleId: scheduleNoticeEvent, enabled: null },
  { scheduleId: scheduleNoticeEvent, enabled: true, actorId: 'other' },
])('rejects malformed event desired state %#', async (input) => {
  const port = fixture();
  expect(await setScheduleNoticeEvent(port, input)).toEqual({
    ok: false,
    code: 'INVALID_INPUT',
  });
  expect(port.setEvent).not.toHaveBeenCalled();
});
it.each(['preferences', 'setPreference', 'setEvent'] as const)(
  'never retries uncertain %s nor leaks exceptions',
  async (action) => {
    const port = fixture();
    port[action].mockRejectedValue(new Error('private'));
    const result =
      action === 'preferences'
        ? await readScheduleNoticePreferences(port, { scheduleId: null })
        : action === 'setPreference'
          ? await setScheduleNoticePreference(port, { enabled: true })
          : await setScheduleNoticeEvent(port, {
              scheduleId: scheduleNoticeEvent,
              enabled: false,
            });
    expect(result).toEqual({ ok: false, code: 'UNAVAILABLE' });
    expect(port[action]).toHaveBeenCalledOnce();
  },
);
it.each(['FORBIDDEN', 'UNAUTHENTICATED', 'NOT_FOUND', 'UNAVAILABLE'])(
  'preserves safe RPC error %s',
  async (code) => {
    const port = fixture();
    port.preferences.mockResolvedValue({ ok: false, code });
    expect(
      await readScheduleNoticePreferences(port, { scheduleId: null }),
    ).toEqual({ ok: false, code });
  },
);
it('rejects event/global projection substitution and malformed policy promises', async () => {
  const port = fixture();
  port.preferences.mockResolvedValue({
    ok: true,
    data: scheduleNoticeEventState,
  });
  expect(
    await readScheduleNoticePreferences(port, { scheduleId: null }),
  ).toEqual({ ok: false, code: 'UNAVAILABLE' });
  port.setEvent.mockResolvedValue({ ok: true, data: scheduleNoticeState });
  expect(
    await setScheduleNoticeEvent(port, {
      scheduleId: scheduleNoticeEvent,
      enabled: true,
    }),
  ).toEqual({ ok: false, code: 'UNAVAILABLE' });
  for (const data of [
    { ...scheduleNoticeState, configured: true },
    { ...scheduleNoticeState, hourKst: 10 },
    { ...scheduleNoticeState, eventEnabled: true },
    { ...scheduleNoticeState, configured: true, hourKst: 24 },
    { ...scheduleNoticeState, extra: true },
  ])
    expect(scheduleNoticeStateSchema.safeParse(data).success).toBe(false);
  expect(
    scheduleNoticeStateSchema.safeParse({
      ...scheduleNoticeEventState,
      configured: true,
      hourKst: 10,
    }).success,
  ).toBe(true);
});

it('rejects write results that do not match explicit desired state', async () => {
  const port = fixture();
  expect(await setScheduleNoticePreference(port, { enabled: true })).toEqual({
    ok: false,
    code: 'UNAVAILABLE',
  });
  expect(
    await setScheduleNoticeEvent(port, {
      scheduleId: scheduleNoticeEvent,
      enabled: false,
    }),
  ).toEqual({ ok: false, code: 'UNAVAILABLE' });
});
