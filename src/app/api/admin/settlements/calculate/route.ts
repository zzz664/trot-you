import type { NextRequest } from 'next/server';
import { settlementReportsHttp } from '@/server/settlement-reports/http';
export const dynamic = 'force-dynamic';
export function POST(request: NextRequest) {
  return settlementReportsHttp(request, 'admin', 'calculate');
}
