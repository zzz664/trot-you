import type { NextRequest } from 'next/server';
import { contentCalendarHttp } from '@/server/content-calendar/http';
export const dynamic = 'force-dynamic';
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ slug: string }> },
) {
  return contentCalendarHttp(request, 'artist', (await context.params).slug);
}
