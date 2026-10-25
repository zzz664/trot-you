import type { NextRequest } from 'next/server';
import { adminArtistHttp } from '@/server/admin-artists/http';
export function POST(request: NextRequest) {
  return adminArtistHttp(request, 'save');
}
