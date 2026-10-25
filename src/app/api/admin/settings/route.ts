import type { NextRequest } from 'next/server';
import { adminSettingsHttp } from '@/server/admin-settings/http';
export const dynamic = 'force-dynamic';
export function GET(request: NextRequest) {
  return adminSettingsHttp(request);
}
export function POST(request: NextRequest) {
  return adminSettingsHttp(request);
}
