import type { NextRequest } from 'next/server';
import { chatReadPost } from '@/server/chat/http';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string; messageId: string }> },
) {
  const { slug, messageId } = await params;
  return chatReadPost(request, slug, messageId);
}
