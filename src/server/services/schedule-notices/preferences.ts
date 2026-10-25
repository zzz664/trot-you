import 'server-only';
import {
  scheduleNoticeQuerySchema,
  scheduleNoticePreferenceInputSchema,
  scheduleNoticeEventInputSchema,
  scheduleNoticeStateSchema,
  type ScheduleNoticeState,
  type ScheduleNoticeResult,
} from '@/config/schedule-notices';

export type ScheduleNoticePreferencePort = {
  preferences(
    scheduleId: string | null,
  ): Promise<ScheduleNoticeResult<ScheduleNoticeState>>;
  setPreference(
    enabled: boolean,
  ): Promise<ScheduleNoticeResult<ScheduleNoticeState>>;
  setEvent(
    scheduleId: string,
    enabled: boolean,
  ): Promise<ScheduleNoticeResult<ScheduleNoticeState>>;
};
async function stateResult(
  operation: () => Promise<ScheduleNoticeResult<ScheduleNoticeState>>,
  event: boolean,
  matches: (state: ScheduleNoticeState) => boolean = () => true,
): Promise<ScheduleNoticeResult<ScheduleNoticeState>> {
  try {
    const result = await operation();
    if (!result.ok) return result;
    const parsed = scheduleNoticeStateSchema.safeParse(result.data);
    return parsed.success &&
      (parsed.data.eventEnabled !== null) === event &&
      matches(parsed.data)
      ? { ok: true, data: parsed.data }
      : { ok: false, code: 'UNAVAILABLE' };
  } catch {
    return { ok: false, code: 'UNAVAILABLE' };
  }
}
export async function readScheduleNoticePreferences(
  port: ScheduleNoticePreferencePort,
  input: unknown,
): Promise<ScheduleNoticeResult<ScheduleNoticeState>> {
  const parsed = scheduleNoticeQuerySchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'INVALID_INPUT' };
  return stateResult(
    () => port.preferences(parsed.data.scheduleId),
    parsed.data.scheduleId !== null,
  );
}
export async function setScheduleNoticePreference(
  port: ScheduleNoticePreferencePort,
  input: unknown,
): Promise<ScheduleNoticeResult<ScheduleNoticeState>> {
  const parsed = scheduleNoticePreferenceInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'INVALID_INPUT' };
  return stateResult(
    () => port.setPreference(parsed.data.enabled),
    false,
    (state) => state.scheduleEnabled === parsed.data.enabled,
  );
}
export async function setScheduleNoticeEvent(
  port: ScheduleNoticePreferencePort,
  input: unknown,
): Promise<ScheduleNoticeResult<ScheduleNoticeState>> {
  const parsed = scheduleNoticeEventInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'INVALID_INPUT' };
  return stateResult(
    () => port.setEvent(parsed.data.scheduleId, parsed.data.enabled),
    true,
    (state) => state.eventEnabled === parsed.data.enabled,
  );
}
