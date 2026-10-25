import type { NextRequest } from 'next/server';
import { adminSubscriptionHttp } from '@/server/admin-subscriptions/http';
export const dynamic = 'force-dynamic';
export function GET(request: NextRequest) {
  return adminSubscriptionHttp(request);
}
