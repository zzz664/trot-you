import type {
  AdminSchedule,
  AdminScheduleSaveInput,
  ScheduleEvent,
} from '@/config/schedules';
export const scheduleId = '00000000-0000-4000-8000-000000000031';
export const scheduleArtist = '00000000-0000-4000-8000-000000000032';
export const scheduleOperation = '00000000-0000-4000-8000-000000000033';
export const scheduleEvent: ScheduleEvent = {
  id: scheduleId,
  artist_id: scheduleArtist,
  artist_slug: 'fictional-schedule-artist',
  artist_name: '가상 일정 가수',
  type: 'concert',
  title: '가상 공연',
  description: '공개 행사 안내',
  starts_at: '2026-10-25T03:00:00Z',
  ends_at: '2026-10-25T05:00:00Z',
  place_name: '가상 공연장',
  address: '가상 행사 주소',
  lat: 37.5,
  lng: 127.1,
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-01T00:00:00Z',
};
export const adminSchedule: AdminSchedule = {
  ...scheduleEvent,
  status: 'draft',
  artist_status: 'active',
  revision: 1,
};
export const scheduleSave: AdminScheduleSaveInput = {
  operation_id: scheduleOperation,
  schedule_id: null,
  expected_revision: null,
  confirmed: false,
  input: {
    artist_id: scheduleArtist,
    type: 'concert',
    status: 'draft',
    title: '가상 공연',
    description: '공개 행사 안내',
    starts_at: scheduleEvent.starts_at,
    ends_at: scheduleEvent.ends_at,
    place_name: scheduleEvent.place_name,
    address: scheduleEvent.address,
    lat: scheduleEvent.lat,
    lng: scheduleEvent.lng,
  },
};
