import type { NextRequest } from 'next/server';
import { managementStatus } from '@/server/subscription-management/http';
export function GET(request: NextRequest) {
  return managementStatus(request, false);
}
