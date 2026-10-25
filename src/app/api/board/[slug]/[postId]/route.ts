import type { NextRequest } from 'next/server';
import { communityPostsHttp } from '@/server/community-posts/http';
export const dynamic = 'force-dynamic';
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ slug: string; postId: string }> },
) {
  const { slug, postId } = await context.params;
  return communityPostsHttp(request, 'detail', slug, postId);
}
