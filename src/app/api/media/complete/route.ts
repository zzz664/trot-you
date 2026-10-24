import type { NextRequest } from 'next/server';
import { mediaPost } from '@/server/media/http';

export const runtime = 'nodejs';
export async function POST(request: NextRequest) {
  return mediaPost(request, 'complete');
}
