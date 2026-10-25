import type { NextRequest } from 'next/server';
import { scheduleHttp } from '@/server/schedules/http';
export const dynamic = 'force-dynamic';
export function GET(request: NextRequest) {
  return scheduleHttp(request, 'fan');
}
