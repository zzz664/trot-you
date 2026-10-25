import type { NextRequest } from 'next/server';
import { contentCalendarHttp } from '@/server/content-calendar/http';
export const dynamic = 'force-dynamic';
export function POST(request: NextRequest) {
  return contentCalendarHttp(request, 'delete');
}
