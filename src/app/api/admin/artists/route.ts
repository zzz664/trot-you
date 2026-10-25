import type { NextRequest } from 'next/server';
import { adminArtistHttp } from '@/server/admin-artists/http';
export function GET(request: NextRequest) {
  return adminArtistHttp(request, 'list');
}
