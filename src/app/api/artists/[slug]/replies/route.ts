import type { NextRequest } from 'next/server';
import { repliesGet, repliesPost } from '@/server/replies/http';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ slug: string }> },
) {
  return repliesGet(request, (await context.params).slug);
}
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ slug: string }> },
) {
  return repliesPost(request, (await context.params).slug);
}
