import type { NextRequest } from 'next/server';
import { communityModerationHttp } from '@/server/community-moderation/http';
export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest) {
  return communityModerationHttp(request, 'queue');
}
