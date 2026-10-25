import type {
  ScheduleEvent,
  AdminSchedule,
  AdminScheduleInput,
} from '@/config/schedules';
export const scheduleEvent: ScheduleEvent = {
  id: '3b0d4317-b739-4670-a0ce-02173f1e8101',
  artist_id: '3b0d4317-b739-4670-a0ce-02173f1e8102',
  artist_slug: 'test-artist',
  artist_name: '테스트 가수',
  type: 'concert',
  title: '가을 공연',
  description: '공식 행사 안내',
  starts_at: '2026-10-25T09:00:00Z',
  ends_at: '2026-10-25T11:00:00Z',
  place_name: '시민 공연장',
  address: '공개 행사 주소',
  lat: 37.5665,
  lng: 126.978,
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-01T00:00:00Z',
};
export const adminSchedule: AdminSchedule = {
  ...scheduleEvent,
  status: 'draft',
  artist_status: 'active',
  revision: 1,
};
export const scheduleInput: AdminScheduleInput = {
  artist_id: adminSchedule.artist_id,
  type: adminSchedule.type,
  status: adminSchedule.status,
  title: adminSchedule.title,
  description: adminSchedule.description,
  starts_at: adminSchedule.starts_at,
  ends_at: adminSchedule.ends_at,
  place_name: adminSchedule.place_name,
  address: adminSchedule.address,
  lat: adminSchedule.lat,
  lng: adminSchedule.lng,
};
export const scheduleOperation = {
  operation_id: '3b0d4317-b739-4670-a0ce-02173f1e8103',
  schedule_id: adminSchedule.id,
  expected_revision: 1,
  input: scheduleInput,
  confirmed: true,
};
