import type { NextRequest } from 'next/server';
import { dispatchPost } from '@/server/message-dispatch/http';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  return dispatchPost(request, slug, 'submit');
}
