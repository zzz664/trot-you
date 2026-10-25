import type { ScheduleNoticeState } from '@/config/schedule-notices';
export const scheduleNoticeActor = '47ff7692-24f9-4d29-b476-3401a55f7f00';
export const scheduleNoticeEvent = '47ff7692-24f9-4d29-b476-3401a55f7f01';
export const scheduleNoticeState: ScheduleNoticeState = {
  scheduleEnabled: false,
  eventEnabled: null,
  eligible: null,
  webpushEnabled: false,
  configured: false,
  hourKst: null,
};
export const scheduleNoticeEventState: ScheduleNoticeState = {
  ...scheduleNoticeState,
  eventEnabled: true,
  eligible: true,
};
export function scheduleNoticeRow(state = scheduleNoticeState) {
  return {
    schedule_enabled: state.scheduleEnabled,
    event_enabled: state.eventEnabled,
    eligible: state.eligible,
    webpush_enabled: state.webpushEnabled,
    configured: state.configured,
    hour_kst: state.hourKst,
  };
}
