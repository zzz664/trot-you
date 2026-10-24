import type { NextRequest } from 'next/server';
import { composePost } from '@/server/artist-compose/http';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  return composePost(request, slug, 'remove');
}
