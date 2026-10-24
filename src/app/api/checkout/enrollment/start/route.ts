import type { NextRequest } from 'next/server';
import { enrollmentPost } from '@/server/enrollment/http';
// The host execution budget exceeds the provider timeout and persistence margin.
export const maxDuration = 300;
export const runtime = 'nodejs';
export function POST(request: NextRequest) {
  return enrollmentPost(request, 'start');
}
