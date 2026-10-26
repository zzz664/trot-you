import { beforeEach, expect, it, vi } from 'vitest';
import {
  readSettlementReport,
  calculateSettlementReport,
  confirmSettlementReport,
  readSettlementExport,
  resolveSettlementReportQuery,
  type SettlementReportsPort,
} from '@/server/services/settlement-reports/manage';
import { settlementWorkbookModel } from '@/server/services/settlement-reports/workbook';
import {
  reportActor,
  reportOther,
  reportQuery,
  reportEnvelope,
  confirmedEnvelope,
} from './settlement-reports-ui-fixtures';
import { settlementInput } from './settlement-calculation-fixtures';
const port = {
  read: vi.fn(),
  calculate: vi.fn(),
  confirm: vi.fn(),
  export: vi.fn(),
} satisfies SettlementReportsPort;
const confirmation = {
  reportId: reportEnvelope.report!.id,
  expectedRevision: reportEnvelope.report!.revision,
};
const exportData = () => ({
  ...reportEnvelope,
  sources: structuredClone(settlementInput.events),
});
beforeEach(() => {
  vi.resetAllMocks();
  port.read.mockResolvedValue({
    ok: true,
    data: structuredClone(reportEnvelope),
  });
  port.calculate.mockResolvedValue({
    ok: true,
    data: structuredClone(reportEnvelope),
  });
  port.confirm.mockResolvedValue({ ok: true, data: confirmedEnvelope() });
  port.export.mockResolvedValue({ ok: true, data: exportData() });
});
it('reads exact actor/role/artist/month without sources', async () => {
  expect(
    await readSettlementReport(port, reportQuery, reportActor, 'admin'),
  ).toEqual({ ok: true, data: reportEnvelope });
  expect(port.read).toHaveBeenCalledExactlyOnceWith(reportQuery);
  port.read.mockResolvedValue({ ok: true, data: confirmedEnvelope('artist') });
  expect(
    (await readSettlementReport(port, reportQuery, reportActor, 'artist')).ok,
  ).toBe(true);
});
it.each([
  { artistId: 'invalid', month: reportQuery.month },
  { ...reportQuery, extra: true },
  { ...reportQuery, month: '2026-09-02' },
])('invalid read never calls DB %#', async (query) => {
  expect(await readSettlementReport(port, query, reportActor, 'admin')).toEqual(
    { ok: false, code: 'INVALID_INPUT' },
  );
  expect(port.read).not.toHaveBeenCalled();
});
it.each(['actorId', 'actorRole', 'artist', 'month', 'sources'])(
  'rejects read binding mismatch %s',
  async (field) => {
    const data = {
      ...reportEnvelope,
      [field]: {
        actorId: reportOther,
        actorRole: 'artist',
        artist: { ...reportEnvelope.artist, id: reportOther },
        month: '2026-08-01',
        sources: [],
      }[field],
    };
    port.read.mockResolvedValue({ ok: true, data });
    expect(
      await readSettlementReport(port, reportQuery, reportActor, 'admin'),
    ).toEqual({ ok: false, code: 'UNAVAILABLE' });
  },
);
it('null report is valid only without leaked sources', async () => {
  port.read.mockResolvedValue({
    ok: true,
    data: { ...reportEnvelope, report: null },
  });
  expect(
    (await readSettlementReport(port, reportQuery, reportActor, 'admin')).ok,
  ).toBe(true);
  port.read.mockResolvedValue({
    ok: true,
    data: { ...reportEnvelope, report: null, sources: [] },
  });
  expect(
    (await readSettlementReport(port, reportQuery, reportActor, 'admin')).ok,
  ).toBe(false);
});
it('creates new report only with explicit null and validates new revision', async () => {
  const query = { ...reportQuery, expectedRevision: null };
  expect((await calculateSettlementReport(port, query, reportActor)).ok).toBe(
    true,
  );
  expect(port.calculate).toHaveBeenCalledExactlyOnceWith(query);
  expect(
    await calculateSettlementReport(port, reportQuery, reportActor),
  ).toEqual({ ok: false, code: 'INVALID_INPUT' });
  expect(
    await calculateSettlementReport(
      port,
      { ...query, expectedRevision: confirmation.expectedRevision },
      reportActor,
    ),
  ).toEqual({ ok: false, code: 'UNAVAILABLE' });
});
it('confirm is exact revision/id bound and confirmed-only', async () => {
  expect(
    (await confirmSettlementReport(port, confirmation, reportActor)).ok,
  ).toBe(true);
  expect(port.confirm).toHaveBeenCalledExactlyOnceWith(confirmation);
  port.confirm.mockResolvedValue({ ok: true, data: reportEnvelope });
  expect(
    (await confirmSettlementReport(port, confirmation, reportActor)).ok,
  ).toBe(false);
  port.confirm.mockResolvedValue({ ok: true, data: confirmedEnvelope() });
  expect(
    (
      await confirmSettlementReport(
        port,
        { ...confirmation, expectedRevision: reportOther },
        reportActor,
      )
    ).ok,
  ).toBe(false);
});
it('export authorizes exact saved report revision and full source set', async () => {
  expect((await readSettlementExport(port, confirmation, reportActor)).ok).toBe(
    true,
  );
  expect(port.export).toHaveBeenCalledExactlyOnceWith(confirmation);
  port.export.mockResolvedValue({ ok: true, data: reportEnvelope });
  expect((await readSettlementExport(port, confirmation, reportActor)).ok).toBe(
    false,
  );
  port.export.mockResolvedValue({ ok: true, data: exportData() });
  expect(
    (
      await readSettlementExport(
        port,
        { ...confirmation, reportId: reportOther },
        reportActor,
      )
    ).ok,
  ).toBe(false);
});
it.each(['read', 'calculate', 'confirm', 'export'] as const)(
  'safe transport failures and no retries %s',
  async (operation) => {
    const calls = {
      read: () => readSettlementReport(port, reportQuery, reportActor, 'admin'),
      calculate: () =>
        calculateSettlementReport(
          port,
          { ...reportQuery, expectedRevision: null },
          reportActor,
        ),
      confirm: () => confirmSettlementReport(port, confirmation, reportActor),
      export: () => readSettlementExport(port, confirmation, reportActor),
    };
    port[operation].mockRejectedValue(new Error('private SQL evidence'));
    expect(await calls[operation]()).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
    });
    expect(port[operation]).toHaveBeenCalledOnce();
    port[operation].mockResolvedValue({ ok: false, code: 'FORBIDDEN' });
    expect(await calls[operation]()).toEqual({ ok: false, code: 'FORBIDDEN' });
  },
);
it('bad actor is rejected before I/O', async () => {
  expect(await readSettlementReport(port, reportQuery, 'bad', 'admin')).toEqual(
    { ok: false, code: 'INVALID_INPUT' },
  );
  expect(port.read).not.toHaveBeenCalled();
});
it('resolves KST previous month including year boundary; no default artist', () => {
  expect(
    resolveSettlementReportQuery({}, new Date('2025-12-31T15:00:00Z')),
  ).toEqual({
    ok: true,
    data: { query: null, artistId: '', month: '2025-12-01' },
  });
  expect(
    resolveSettlementReportQuery(
      { artist_id: reportQuery.artistId },
      new Date('2026-10-01T00:00:00Z'),
    ),
  ).toEqual({
    ok: true,
    data: {
      query: reportQuery,
      artistId: reportQuery.artistId,
      month: reportQuery.month,
    },
  });
});
it.each([
  { artist_id: ['wrong'] },
  { month: '2026-09-02' },
  { month: ['2026-09-01'] },
  { unknown: 'x' },
])('rejects ambiguous selector %#', (query) =>
  expect(resolveSettlementReportQuery(query)).toEqual({
    ok: false,
    code: 'INVALID_INPUT',
  }),
);
it('workbook model includes every frozen report field and no actor/source evidence beyond allowlist', () => {
  const model = settlementWorkbookModel(exportData());
  expect(model.summary).toContainEqual([
    'report.sourceVersion',
    '9007199254740993',
  ]);
  expect(model.summary).toContainEqual([
    'report.policySnapshot.baseRate',
    '0.300000',
  ]);
  expect(model.summary).toContainEqual([
    'report.exactComponents.final.0',
    reportEnvelope.report!.exactComponents.final[0],
  ]);
  expect(model.events[0]).toEqual({
    id: settlementInput.events[0]!.id,
    kind: 'charge',
    amountKrw: '6500',
    occurredAt: settlementInput.events[0]!.occurredAt,
    origin: 'current',
  });
  expect(JSON.stringify(model)).not.toContain(reportActor);
  expect(JSON.stringify(model)).not.toContain('verified');
  expect(() => settlementWorkbookModel(reportEnvelope)).toThrow(
    'SETTLEMENT_EXPORT_INVALID',
  );
});
