import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  calculateSettlementReport,
  confirmSettlementReport,
  exportSettlementReport,
  fetchSettlementReport,
} from '@/client/settlement-reports';
import {
  SETTLEMENT_REPORTS,
  SETTLEMENT_REPORT_ERROR_STATUS,
} from '@/config/settlement-reports';
import {
  settlementReportActionPath,
  settlementReportExportPath,
  settlementReportsPath,
} from '@/config/routes';
import {
  confirmedEnvelope,
  reportActor,
  reportEnvelope,
  reportOther,
  reportQuery,
} from './settlement-reports-ui-fixtures';
const fetchMock = vi.fn();
const ok = <T>(data: T) => ({ ok: true as const, data });
const input = {
  reportId: reportEnvelope.report!.id,
  expectedRevision: reportEnvelope.report!.revision,
};
const unavailable = { ok: false, code: 'UNAVAILABLE' };
const response = (
  body: unknown = ok(reportEnvelope),
  status = 200,
  headers: HeadersInit = {},
) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  });
const read = (signal?: AbortSignal) =>
  fetchSettlementReport(reportQuery, 'admin', signal, reportActor);
const headers = {
  'content-type': SETTLEMENT_REPORTS.workbookContentType,
  'content-disposition': `attachment; filename="settlement-${input.reportId}.xlsx"`,
  'cache-control': 'private, no-store, max-age=0',
  'x-content-type-options': 'nosniff',
};
const workbook = (changed: Record<string, string> = {}, status = 200) =>
  new Response(new Uint8Array([80, 75, 3, 4]), {
    status,
    headers: { ...headers, ...changed },
  });
beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(response());
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());
it('GET is exact mode path, actor-bound, private, bounded and never follows redirects', async () => {
  const abort = new AbortController();
  expect(await read(abort.signal)).toEqual(ok(reportEnvelope));
  expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
    settlementReportsPath(reportQuery, false, true),
    expect.objectContaining({
      method: 'GET',
      headers: { [SETTLEMENT_REPORTS.actorHeader]: reportActor },
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      signal: expect.any(AbortSignal),
    }),
  );
});
it('artist read uses artist API and confirmed projection only', async () => {
  const data = confirmedEnvelope('artist');
  fetchMock.mockResolvedValue(response(ok(data)));
  expect(
    await fetchSettlementReport(reportQuery, 'artist', undefined, reportActor),
  ).toEqual(ok(data));
  expect(fetchMock.mock.calls[0]![0]).toBe(
    settlementReportsPath(reportQuery, true, true),
  );
  fetchMock.mockResolvedValue(
    response(ok({ ...reportEnvelope, actorRole: 'artist' })),
  );
  expect(
    await fetchSettlementReport(reportQuery, 'artist', undefined, reportActor),
  ).toEqual(unavailable);
});
it('invalid query, actor and already aborted read make no request', async () => {
  expect(
    await fetchSettlementReport(
      { ...reportQuery, month: '2026-09-02' },
      'admin',
      undefined,
      reportActor,
    ),
  ).toEqual({ ok: false, code: 'INVALID_INPUT' });
  expect(
    await fetchSettlementReport(reportQuery, 'admin', undefined, 'bad'),
  ).toEqual({ ok: false, code: 'FORBIDDEN' });
  expect(await fetchSettlementReport(reportQuery, 'admin')).toEqual({
    ok: false,
    code: 'FORBIDDEN',
  });
  const abort = new AbortController();
  abort.abort();
  expect(await read(abort.signal)).toEqual(unavailable);
  expect(fetchMock).not.toHaveBeenCalled();
});
it.each([
  { actorId: reportOther },
  { actorRole: 'artist' },
  { month: '2026-08-01' },
  { artist: { ...reportEnvelope.artist, id: reportOther } },
  { sources: [] },
  { report: { ...reportEnvelope.report!, grossKrw: 6500 } },
  { report: { ...reportEnvelope.report!, status: 'paid' } },
  { privateMetadata: 'do not leak' },
])(
  'rejects mismatched, numeric, unknown or source-inclusive read result %j',
  async (patch) => {
    fetchMock.mockResolvedValue(response(ok({ ...reportEnvelope, ...patch })));
    expect(await read()).toEqual(unavailable);
  },
);
it.each(Object.entries(SETTLEMENT_REPORT_ERROR_STATUS))(
  'preserves only valid %s safe code with matching HTTP status',
  async (code, status) => {
    fetchMock.mockResolvedValue(response({ ok: false, code }, status));
    expect(await read()).toEqual({ ok: false, code });
  },
);
it.each([
  response({ ok: false, code: 'FORBIDDEN' }, 200),
  response({ ok: false, code: 'PRIVATE_SQL_DETAIL' }, 503),
  response({ ok: false, code: 'FORBIDDEN', detail: 'private' }, 403),
  response(ok(reportEnvelope), 201),
  response(ok(reportEnvelope), 200, { 'content-type': 'text/html' }),
])('fails closed on contradictory transport envelopes', async (value) => {
  fetchMock.mockResolvedValue(value);
  expect(await read()).toEqual(unavailable);
});
it('does not trust malformed JSON, invalid UTF-8, missing body or thrown fetch details', async () => {
  fetchMock.mockResolvedValueOnce(
    new Response('{', { headers: { 'content-type': 'application/json' } }),
  );
  expect(await read()).toEqual(unavailable);
  fetchMock.mockResolvedValueOnce(
    new Response(new Uint8Array([0xff]), {
      headers: { 'content-type': 'application/json' },
    }),
  );
  expect(await read()).toEqual(unavailable);
  fetchMock.mockResolvedValueOnce(
    new Response(null, { headers: { 'content-type': 'application/json' } }),
  );
  expect(await read()).toEqual(unavailable);
  fetchMock.mockRejectedValueOnce(new Error('private source'));
  expect(await read()).toEqual(unavailable);
});
it('over-limit response cancels reader and releases ownership without parsing or retrying', async () => {
  const cancel = vi.fn(),
    releaseLock = vi.fn();
  fetchMock.mockResolvedValue({
    headers: new Headers({ 'content-type': 'application/json' }),
    status: 200,
    body: {
      getReader: () => ({
        read: vi.fn().mockResolvedValue({
          done: false,
          value: { byteLength: SETTLEMENT_REPORTS.responseMaxBytes + 1 },
        }),
        cancel,
        releaseLock,
      }),
    },
  });
  expect(await read()).toEqual(unavailable);
  expect(cancel).toHaveBeenCalledOnce();
  expect(releaseLock).toHaveBeenCalledOnce();
  expect(fetchMock).toHaveBeenCalledOnce();
});
it('abort after network response rejects even an otherwise valid body', async () => {
  const abort = new AbortController();
  fetchMock.mockImplementationOnce(async () => {
    abort.abort();
    return response();
  });
  expect(await read(abort.signal)).toEqual(unavailable);
});
it('calculate POST binds initial null or displayed revision without sending amounts or auto retry', async () => {
  for (const expectedRevision of [null, input.expectedRevision]) {
    fetchMock.mockResolvedValueOnce(response());
    const body = { ...reportQuery, expectedRevision };
    expect(
      await calculateSettlementReport(body, undefined, reportActor),
    ).toEqual(ok(reportEnvelope));
    expect(fetchMock.mock.calls.at(-1)).toEqual([
      settlementReportActionPath('calculate'),
      expect.objectContaining({
        method: 'POST',
        headers: {
          [SETTLEMENT_REPORTS.actorHeader]: reportActor,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        cache: 'no-store',
        redirect: 'error',
      }),
    ]);
  }
  fetchMock.mockResolvedValueOnce(response(ok(confirmedEnvelope())));
  expect(
    await calculateSettlementReport(
      { ...reportQuery, expectedRevision: null },
      undefined,
      reportActor,
    ),
  ).toEqual(unavailable);
});
it('confirm POST sends current reviewed id/revision and requires matching locked response', async () => {
  fetchMock.mockResolvedValueOnce(response(ok(confirmedEnvelope())));
  expect(await confirmSettlementReport(input, undefined, reportActor)).toEqual(
    ok(confirmedEnvelope()),
  );
  expect(fetchMock).toHaveBeenCalledWith(
    settlementReportActionPath('confirm'),
    expect.objectContaining({
      method: 'POST',
      body: JSON.stringify(input),
      headers: {
        [SETTLEMENT_REPORTS.actorHeader]: reportActor,
        'Content-Type': 'application/json',
      },
    }),
  );
  for (const patch of [
    { id: reportOther },
    { revision: reportOther },
    { status: 'draft', confirmedAt: null },
  ]) {
    fetchMock.mockResolvedValueOnce(
      response(
        ok({
          ...confirmedEnvelope(),
          report: { ...confirmedEnvelope().report!, ...patch },
        }),
      ),
    );
    expect(
      await confirmSettlementReport(input, undefined, reportActor),
    ).toEqual(unavailable);
  }
});
it('invalid or extra mutation fields never make a request', async () => {
  expect(
    await calculateSettlementReport(
      { ...reportQuery, expectedRevision: 'bad' },
      undefined,
      reportActor,
    ),
  ).toEqual({ ok: false, code: 'INVALID_INPUT' });
  expect(
    await confirmSettlementReport(
      { ...input, expectedRevision: '' },
      undefined,
      reportActor,
    ),
  ).toEqual({ ok: false, code: 'INVALID_INPUT' });
  expect(
    await calculateSettlementReport(
      {
        ...reportQuery,
        expectedRevision: null,
        finalAmountKrw: '1',
      } as Parameters<typeof calculateSettlementReport>[0],
      undefined,
      reportActor,
    ),
  ).toEqual({ ok: false, code: 'INVALID_INPUT' });
  expect(fetchMock).not.toHaveBeenCalled();
});
it('export GET binds revision/actor and accepts only fixed attachment identity', async () => {
  fetchMock.mockResolvedValueOnce(workbook());
  const result = await exportSettlementReport(input, undefined, reportActor);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error('workbook missing');
  expect(result.data.filename).toBe(`settlement-${input.reportId}.xlsx`);
  expect(result.data.blob.type).toBe(SETTLEMENT_REPORTS.workbookContentType);
  expect(result.data.blob.size).toBe(4);
  expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
    settlementReportExportPath(input.reportId, input.expectedRevision),
    expect.objectContaining({
      method: 'GET',
      headers: { [SETTLEMENT_REPORTS.actorHeader]: reportActor },
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
    }),
  );
});
it.each([
  { 'content-type': 'text/html' },
  { 'content-disposition': 'attachment; filename="../../private.xlsx"' },
  { 'content-disposition': 'inline' },
  { 'x-content-type-options': '' },
  { 'cache-control': 'public, max-age=3600' },
])('rejects unsafe export headers %j', async (patch) => {
  fetchMock.mockResolvedValue(workbook(patch));
  expect(await exportSettlementReport(input, undefined, reportActor)).toEqual(
    unavailable,
  );
});
it('export safe JSON errors, wrong status, empty body and network failure remain failures', async () => {
  fetchMock.mockResolvedValueOnce(
    response({ ok: false, code: 'REVISION_CONFLICT' }, 409),
  );
  expect(await exportSettlementReport(input, undefined, reportActor)).toEqual({
    ok: false,
    code: 'REVISION_CONFLICT',
  });
  fetchMock.mockResolvedValueOnce(workbook({}, 201));
  expect(await exportSettlementReport(input, undefined, reportActor)).toEqual(
    unavailable,
  );
  fetchMock.mockResolvedValueOnce(new Response(new Uint8Array(), { headers }));
  expect(await exportSettlementReport(input, undefined, reportActor)).toEqual(
    unavailable,
  );
  fetchMock.mockRejectedValueOnce(new Error('secret'));
  expect(await exportSettlementReport(input, undefined, reportActor)).toEqual(
    unavailable,
  );
});
it('invalid export identity and abort never fetch or produce a public link', async () => {
  expect(
    await exportSettlementReport(
      { ...input, reportId: 'bad' },
      undefined,
      reportActor,
    ),
  ).toEqual({ ok: false, code: 'INVALID_INPUT' });
  expect(await exportSettlementReport(input)).toEqual({
    ok: false,
    code: 'FORBIDDEN',
  });
  const abort = new AbortController();
  abort.abort();
  expect(
    await exportSettlementReport(input, abort.signal, reportActor),
  ).toEqual(unavailable);
  expect(fetchMock).not.toHaveBeenCalled();
});
