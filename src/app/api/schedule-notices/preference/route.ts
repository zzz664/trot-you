import type { NextRequest } from 'next/server';
import { scheduleNoticeHttp } from '@/server/schedule-notices/http';
export function POST(request: NextRequest) {
  return scheduleNoticeHttp(request, 'preference');
}
