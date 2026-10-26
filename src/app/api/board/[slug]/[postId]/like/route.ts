import type { NextRequest } from 'next/server';
import { communityInteractionsHttp } from '@/server/community-interactions/http';
export const dynamic = 'force-dynamic';
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ slug: string; postId: string }> },
) {
  const { slug, postId } = await context.params;
  return communityInteractionsHttp(request, 'like', slug, postId);
}
