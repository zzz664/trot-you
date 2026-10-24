import type { NextRequest } from 'next/server';
import { managementPost } from '@/server/subscription-management/http';
export const runtime = 'nodejs';
export const maxDuration = 60;
export function POST(request: NextRequest) {
  return managementPost(request, 'reject');
}
