import type { NextRequest } from 'next/server';
import { checkoutPost } from '@/server/checkout/http';
export function POST(request: NextRequest) {
  return checkoutPost(request);
}
