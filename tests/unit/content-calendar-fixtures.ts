import type {
  ContentCalendarEntry,
  ContentCalendarSaveInput,
  ArtistContentCalendar,
  AdminContentCalendar,
} from '@/config/content-calendar';
export const calendarArtistId = '34000000-0000-4000-8000-000000000001';
export const calendarEntryId = '34000000-0000-4000-8000-000000000002';
export const calendarOperationId = '34000000-0000-4000-8000-000000000003';
export const calendarActorId = '34000000-0000-4000-8000-000000000004';
export const calendarOtherId = '34000000-0000-4000-8000-000000000005';
export const calendarEntry: ContentCalendarEntry = {
  id: calendarEntryId,
  artist_id: calendarArtistId,
  date: '2026-10-29',
  topic: '가을 이야기',
  example_text: '{이름} 님, 가을 산책 이야기를 들려 주세요.',
  revision: 1,
  created_at: '2026-10-25T07:00:00.000001+00:00',
  updated_at: '2026-10-25T07:00:00.000001+00:00',
};
export const calendarSave: ContentCalendarSaveInput = {
  operation_id: calendarOperationId,
  entry_id: null,
  expected_revision: null,
  input: {
    artist_id: calendarArtistId,
    date: calendarEntry.date,
    topic: calendarEntry.topic,
    example_text: calendarEntry.example_text,
  },
};
export const artistCalendar: ArtistContentCalendar = {
  artist: { id: calendarArtistId, slug: 'calendar-fixture', name: '가상 가수' },
  month: '2026-10',
  serverNow: '2026-10-25T07:00:00+00:00',
  entries: [calendarEntry],
  activity: {
    weekStart: '2026-10-19',
    weekEnd: '2026-10-26',
    messageCount: 2,
    photoCount: 1,
    weeklyMessageMin: null,
    weeklyPhotoMin: null,
    requirementsReady: false,
  },
};
export const adminCalendar: AdminContentCalendar = {
  ...artistCalendar,
  artist: { ...artistCalendar.artist, status: 'active' },
};
export function calendarWire(admin = false) {
  const page = admin ? adminCalendar : artistCalendar;
  const activity = page.activity;
  return {
    artist: page.artist,
    month: `${page.month}-01`,
    server_now: page.serverNow,
    entries: page.entries,
    activity: {
      week_start: activity.weekStart,
      week_end: activity.weekEnd,
      message_count: activity.messageCount,
      photo_count: activity.photoCount,
      weekly_message_min: activity.weeklyMessageMin,
      weekly_photo_min: activity.weeklyPhotoMin,
      requirements_ready: activity.requirementsReady,
    },
  };
}
