import type { NextRequest } from 'next/server';
import { settlementReportsHttp } from '@/server/settlement-reports/http';
export const dynamic = 'force-dynamic';
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ reportId: string }> },
) {
  return settlementReportsHttp(
    request,
    'admin',
    'export',
    (await params).reportId,
  );
}
