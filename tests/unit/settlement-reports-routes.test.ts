// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import {
  GET as adminRead,
  dynamic as readDynamic,
} from '@/app/api/admin/settlements/route';
import { GET as artistRead } from '@/app/api/artist/settlements/route';
import { POST as calculate } from '@/app/api/admin/settlements/calculate/route';
import { POST as confirm } from '@/app/api/admin/settlements/confirm/route';
import {
  GET as exportReport,
  dynamic as exportDynamic,
} from '@/app/api/admin/settlements/[reportId]/export/route';
import {
  settlementReportsPath,
  settlementReportActionPath,
  settlementReportExportPath,
} from '@/config/routes';
const mocks = vi.hoisted(() => ({ http: vi.fn() }));
vi.mock('@/server/settlement-reports/http', () => ({
  settlementReportsHttp: mocks.http,
}));
beforeEach(() => {
  vi.resetAllMocks();
  mocks.http.mockResolvedValue(new Response('{}'));
});
it('all reads/export are explicitly dynamic', () => {
  expect(readDynamic).toBe('force-dynamic');
  expect(exportDynamic).toBe('force-dynamic');
});
it.each([
  [adminRead, ['admin']],
  [artistRead, ['artist']],
  [calculate, ['admin', 'calculate']],
  [confirm, ['admin', 'confirm']],
] as const)(
  'thin route delegates without financial logic %#',
  async (handler, args) => {
    const request = new NextRequest('https://app.example');
    await handler(request);
    expect(mocks.http).toHaveBeenCalledExactlyOnceWith(request, ...args);
  },
);
it('export awaits Next16 params before passing exact id', async () => {
  const request = new NextRequest('https://app.example');
  await exportReport(request, {
    params: Promise.resolve({ reportId: 'review-id' }),
  });
  expect(mocks.http).toHaveBeenCalledExactlyOnceWith(
    request,
    'admin',
    'export',
    'review-id',
  );
});
it('centralized paths escape path/query data', () => {
  expect(settlementReportsPath()).toBe('/admin/settlements');
  expect(
    settlementReportsPath({ artistId: 'a+b', month: 'c d' }, true, true),
  ).toBe('/api/artist/settlements?artist_id=a%2Bb&month=c+d');
  expect(settlementReportActionPath('calculate')).toBe(
    '/api/admin/settlements/calculate',
  );
  expect(settlementReportExportPath('a/b', 'c+d')).toBe(
    '/api/admin/settlements/a%2Fb/export?revision=c%2Bd',
  );
});
