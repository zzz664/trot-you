import type { NextRequest } from 'next/server';
import { scheduleNoticeHttp } from '@/server/schedule-notices/http';
export const dynamic = 'force-dynamic';
export function GET(request: NextRequest) {
  return scheduleNoticeHttp(request, 'read');
}
