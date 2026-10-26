import 'server-only';
import { createMediaServiceClient } from '@/server/db/media-client';
import { createAttendanceAnalyticsPort } from '@/server/db/attendance-points-analytics';
import type { AttendanceAnalyticsPort } from '@/server/services/attendance-points/analytics';

export function getAttendanceAnalyticsPort(): AttendanceAnalyticsPort | null {
  try {
    const client = createMediaServiceClient();
    return client ? createAttendanceAnalyticsPort(client) : null;
  } catch {
    // Optional analytics configuration cannot undo an already committed attendance entry.
    return null;
  }
}
