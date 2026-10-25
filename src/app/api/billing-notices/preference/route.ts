import { billingNoticeHttp } from '@/server/billing-notices/http';
import type { NextRequest } from 'next/server';
export const runtime = 'nodejs';
export function POST(request: NextRequest) {
  return billingNoticeHttp(request, 'preference');
}
