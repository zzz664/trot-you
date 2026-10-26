import type { NextRequest } from 'next/server';
import { activityRewardsHttp } from '@/server/activity-rewards/http';
export const dynamic = 'force-dynamic';
export function GET(request: NextRequest) {
  return activityRewardsHttp(request);
}
