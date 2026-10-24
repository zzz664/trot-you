import type { NextRequest } from 'next/server';
import { analyticsPost } from '@/server/analytics/http';

export async function POST(request: NextRequest) {
  return analyticsPost(request);
}
