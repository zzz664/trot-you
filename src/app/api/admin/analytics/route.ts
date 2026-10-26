import type { NextRequest } from 'next/server';
import { analyticsFunnelHttp } from '@/server/analytics-funnel/http';
export const dynamic = 'force-dynamic';
export function GET(request: NextRequest) {
  return analyticsFunnelHttp(request);
}
