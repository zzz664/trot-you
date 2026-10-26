// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { SETTLEMENT_REPORTS } from '@/config/settlement-reports';
import { AUTH_PRIVATE_HEADERS } from '@/config/auth';
import { settlementReportsHttp } from '@/server/settlement-reports/http';
import {
  reportActor,
  reportOther,
  reportQuery,
  reportEnvelope,
  confirmedEnvelope,
} from './settlement-reports-ui-fixtures';
import { settlementInput } from './settlement-calculation-fixtures';
const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  session: vi.fn(),
  port: vi.fn(),
  read: vi.fn(),
  calculate: vi.fn(),
  confirm: vi.fn(),
  export: vi.fn(),
}));
vi.mock('@/server/auth/context', () => ({ createAuthContext: mocks.context }));
vi.mock('@/server/services/auth/session', () => ({
  readSession: mocks.session,
}));
vi.mock('@/server/db/settlement-reports', () => ({
  createSettlementReportsPort: mocks.port,
}));
const confirmation = {
  reportId: reportEnvelope.report!.id,
  expectedRevision: reportEnvelope.report!.revision,
};
function state(extra = {}) {
  return {
    status: 'authenticated',
    profile: {
      id: reportActor,
      role: 'admin',
      is_restricted: false,
      restricted_until: null,
      ...extra,
    },
  };
}
function context() {
  return {
    configuration: { appOrigin: 'https://app.example' },
    client: {},
    port: {},
    apply: (r: Response) => {
      for (const [key, value] of Object.entries(AUTH_PRIVATE_HEADERS))
        r.headers.set(key, value);
      return r;
    },
  };
}
function request(
  options: {
    method?: string;
    query?: string;
    actor?: string | null;
    origin?: string | null;
    body?: unknown;
    type?: string;
  } = {},
) {
  return new NextRequest(
    `https://app.example/api/admin/settlements${options.query ?? `?artist_id=${reportQuery.artistId}&month=${reportQuery.month}`}`,
    {
      method: options.method ?? 'GET',
      headers: {
        ...(options.actor === null
          ? {}
          : { [SETTLEMENT_REPORTS.actorHeader]: options.actor ?? reportActor }),
        ...(options.origin === null
          ? {}
          : { Origin: options.origin ?? 'https://app.example' }),
        ...(options.body === undefined
          ? {}
          : { 'Content-Type': options.type ?? 'application/json' }),
      },
      ...(options.body === undefined
        ? {}
        : { body: JSON.stringify(options.body) }),
    },
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.context.mockReturnValue(context());
  mocks.session.mockResolvedValue(state());
  mocks.port.mockReturnValue({
    read: mocks.read,
    calculate: mocks.calculate,
    confirm: mocks.confirm,
    export: mocks.export,
  });
  mocks.read.mockResolvedValue({ ok: true, data: reportEnvelope });
  mocks.calculate.mockResolvedValue({ ok: true, data: reportEnvelope });
  mocks.confirm.mockResolvedValue({ ok: true, data: confirmedEnvelope() });
  mocks.export.mockResolvedValue({
    ok: true,
    data: { ...reportEnvelope, sources: settlementInput.events },
  });
});
it('private read binds actor and exact query; cookie refresh headers survive', async () => {
  const r = await settlementReportsHttp(request(), 'admin');
  expect(r.status).toBe(200);
  expect(await r.json()).toEqual({ ok: true, data: reportEnvelope });
  expect(mocks.read).toHaveBeenCalledExactlyOnceWith(reportQuery);
  for (const [key, value] of Object.entries(AUTH_PRIVATE_HEADERS))
    expect(r.headers.get(key)).toBe(value);
  expect(r.headers.get('vary')).toBe(
    `Cookie, ${SETTLEMENT_REPORTS.actorHeader}`,
  );
  expect(r.headers.get('x-content-type-options')).toBe('nosniff');
});
it.each([reportOther, 'bad', null])(
  'current actor header required %#',
  async (actor) => {
    expect(
      (await settlementReportsHttp(request({ actor }), 'admin')).status,
    ).toBe(403);
    expect(mocks.port).not.toHaveBeenCalled();
  },
);
it.each([
  { role: 'fan' },
  { role: 'artist' },
  { is_restricted: true, restricted_until: null },
  { is_restricted: true, restricted_until: 'bad' },
])('current role/restriction enforced %#', async (extra) => {
  mocks.session.mockResolvedValue(state(extra));
  expect((await settlementReportsHttp(request(), 'admin')).status).toBe(403);
  expect(mocks.port).not.toHaveBeenCalled();
});
it('artist route permits only current artist mode and does not export', async () => {
  mocks.session.mockResolvedValue(state({ role: 'artist' }));
  mocks.read.mockResolvedValue({ ok: true, data: confirmedEnvelope('artist') });
  expect((await settlementReportsHttp(request(), 'artist')).status).toBe(200);
  expect(
    (
      await settlementReportsHttp(
        request(),
        'artist',
        'export',
        confirmation.reportId,
      )
    ).status,
  ).toBe(400);
});
it.each([
  ['anonymous', 401],
  ['unavailable', 503],
])('authentication status %s fails safely', async (status, http) => {
  mocks.session.mockResolvedValue({ status });
  expect((await settlementReportsHttp(request(), 'admin')).status).toBe(http);
  expect(mocks.port).not.toHaveBeenCalled();
});
it.each([
  '?unknown=1',
  `?artist_id=${reportQuery.artistId}&month=${reportQuery.month}&month=${reportQuery.month}`,
  '?artist_id=bad&month=2026-09-01',
  '',
])('malformed/ambiguous read query %s', async (query) => {
  expect(
    (await settlementReportsHttp(request({ query }), 'admin')).status,
  ).toBe(400);
  expect(mocks.read).not.toHaveBeenCalled();
});
it.each([null, 'https://evil.example'])(
  'write origin mandatory %s',
  async (origin) => {
    const r = await settlementReportsHttp(
      request({
        method: 'POST',
        query: '',
        origin,
        body: { ...reportQuery, expectedRevision: null },
      }),
      'admin',
      'calculate',
    );
    expect(r.status).toBe(403);
    expect(mocks.calculate).not.toHaveBeenCalled();
  },
);
it('explicit JSON revision CAS bodies only; GET never mutates', async () => {
  const input = { ...reportQuery, expectedRevision: null };
  expect(
    (
      await settlementReportsHttp(
        request({ method: 'POST', query: '', body: input }),
        'admin',
        'calculate',
      )
    ).status,
  ).toBe(200);
  expect(mocks.calculate).toHaveBeenCalledExactlyOnceWith(input);
  expect(
    (await settlementReportsHttp(request({ query: '' }), 'admin', 'calculate'))
      .status,
  ).toBe(400);
  expect(
    (
      await settlementReportsHttp(
        request({ method: 'POST', query: '', body: confirmation }),
        'admin',
        'confirm',
      )
    ).status,
  ).toBe(200);
  expect(mocks.confirm).toHaveBeenCalledExactlyOnceWith(confirmation);
});
it.each([
  { body: { ...reportQuery }, type: 'application/json' },
  {
    body: { ...reportQuery, expectedRevision: null, payout: true },
    type: 'application/json',
  },
  { body: { ...reportQuery, expectedRevision: null }, type: 'text/plain' },
])('invalid writes never reach DB %#', async (options) => {
  expect(
    (
      await settlementReportsHttp(
        request({ method: 'POST', query: '', ...options }),
        'admin',
        'calculate',
      )
    ).status,
  ).toBe(400);
  expect(mocks.calculate).not.toHaveBeenCalled();
});
it('admin export uses one authorized frozen revision and returns private XLSX bytes', async () => {
  const r = await settlementReportsHttp(
    request({ query: `?revision=${confirmation.expectedRevision}` }),
    'admin',
    'export',
    confirmation.reportId,
  );
  expect(r.status).toBe(200);
  expect(mocks.export).toHaveBeenCalledExactlyOnceWith(confirmation);
  expect(r.headers.get('content-type')).toBe(
    SETTLEMENT_REPORTS.workbookContentType,
  );
  expect(r.headers.get('content-disposition')).toBe(
    `attachment; filename="settlement-${confirmation.reportId}.xlsx"`,
  );
  expect(r.headers.get('cache-control')).toContain('no-store');
  expect(r.headers.get('content-security-policy')).toContain('sandbox');
  const bytes = new Uint8Array(await r.arrayBuffer());
  expect(Array.from(bytes.slice(0, 4))).toEqual([80, 75, 3, 4]);
  expect(r.headers.get('content-length')).toBe(String(bytes.byteLength));
});
it('stale export returns safe conflict JSON; no old or newer workbook', async () => {
  mocks.export.mockResolvedValue({ ok: false, code: 'REVISION_CONFLICT' });
  const r = await settlementReportsHttp(
    request({ query: `?revision=${confirmation.expectedRevision}` }),
    'admin',
    'export',
    confirmation.reportId,
  );
  expect(r.status).toBe(409);
  expect(await r.json()).toEqual({ ok: false, code: 'REVISION_CONFLICT' });
  expect(r.headers.has('content-disposition')).toBe(false);
});
it('unconfigured/throwing adapter paths are private and details never leak', async () => {
  mocks.context.mockReturnValue({ ...context(), client: null });
  expect((await settlementReportsHttp(request(), 'admin')).status).toBe(503);
  mocks.context.mockReturnValue(context());
  mocks.read.mockRejectedValue(new Error('secret host'));
  const r = await settlementReportsHttp(request(), 'admin');
  expect(await r.json()).toEqual({ ok: false, code: 'UNAVAILABLE' });
  expect(r.headers.get('cache-control')).toContain('no-store');
});
