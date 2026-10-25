import type { NextRequest } from 'next/server';
import { contentCalendarHttp } from '@/server/content-calendar/http';
export const dynamic = 'force-dynamic';
export function GET(request: NextRequest) {
  return contentCalendarHttp(request, 'admin');
}
