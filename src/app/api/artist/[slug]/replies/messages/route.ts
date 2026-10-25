import type { NextRequest } from 'next/server';
import { artistReplyActivityPost } from '@/server/artist-reply-activity/http';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  return artistReplyActivityPost(request, slug, 'messages');
}
