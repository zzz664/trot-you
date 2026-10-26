import type { NextRequest } from 'next/server';
import { attendancePointsHttp } from '@/server/attendance-points/http';
export const dynamic = 'force-dynamic';
export function POST(request: NextRequest) {
  return attendancePointsHttp(request, 'attend');
}
