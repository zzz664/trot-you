import type { NextRequest } from 'next/server';
import { scheduleHttp } from '@/server/schedules/http';
export const dynamic = 'force-dynamic';
export function POST(request: NextRequest) {
  return scheduleHttp(request, 'save');
}
