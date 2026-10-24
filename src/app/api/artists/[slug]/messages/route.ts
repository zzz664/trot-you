import type { NextRequest } from 'next/server';
import { chatMessagesGet } from '@/server/chat/http';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  return chatMessagesGet(request, (await params).slug);
}
