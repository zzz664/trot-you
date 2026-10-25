import type { NextRequest } from 'next/server';
import { communityMediaHttp } from '@/server/community-posts/media';

export const POST = (request: NextRequest) =>
  communityMediaHttp(request, 'revoke');
