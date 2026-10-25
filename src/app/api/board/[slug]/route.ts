import type { NextRequest } from 'next/server';
import { communityPostsHttp } from '@/server/community-posts/http';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ slug: string }> };
export async function GET(request: NextRequest, context: Context) {
  return communityPostsHttp(request, 'list', (await context.params).slug);
}
export async function POST(request: NextRequest, context: Context) {
  return communityPostsHttp(request, 'create', (await context.params).slug);
}
