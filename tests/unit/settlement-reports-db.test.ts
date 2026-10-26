import { expect, it, vi } from 'vitest';
import { createSettlementReportsPort } from '@/server/db/settlement-reports';
import type { ActorClient } from '@/server/db/client';
import { reportEnvelope, reportQuery } from './settlement-reports-ui-fixtures';
function setup(data: unknown = reportEnvelope, error: unknown = null) {
  const rpc = vi.fn().mockResolvedValue({ data, error });
  return {
    rpc,
    port: createSettlementReportsPort({ rpc } as unknown as ActorClient),
  };
}
it('uses actor RPC only, explicit read without source rows', async () => {
  const { rpc, port } = setup();
  expect((await port.read(reportQuery)).ok).toBe(true);
  expect(rpc).toHaveBeenCalledExactlyOnceWith('settlement_report_read', {
    p_artist_id: reportQuery.artistId,
    p_month: reportQuery.month,
    p_include_sources: false,
  });
});
it('calculate omits null default rather than inventing revision; stale CAS value remains exact', async () => {
  const { rpc, port } = setup();
  await port.calculate({ ...reportQuery, expectedRevision: null });
  expect(rpc).toHaveBeenLastCalledWith('settlement_report_calculate', {
    p_artist_id: reportQuery.artistId,
    p_month: reportQuery.month,
  });
  await port.calculate({
    ...reportQuery,
    expectedRevision: reportEnvelope.report!.revision,
  });
  expect(rpc).toHaveBeenLastCalledWith('settlement_report_calculate', {
    p_artist_id: reportQuery.artistId,
    p_month: reportQuery.month,
    p_expected_revision: reportEnvelope.report!.revision,
  });
});
it.each(['confirm', 'export'] as const)(
  'passes immutable id/revision to %s',
  async (operation) => {
    const { rpc, port } = setup();
    const input = {
      reportId: reportEnvelope.report!.id,
      expectedRevision: reportEnvelope.report!.revision,
    };
    await port[operation](input);
    expect(rpc).toHaveBeenCalledExactlyOnceWith(
      `settlement_report_${operation}`,
      {
        p_report_id: input.reportId,
        p_expected_revision: input.expectedRevision,
      },
    );
  },
);
it.each([
  ['SETTLEMENT_FORBIDDEN', 'FORBIDDEN'],
  ['SETTLEMENT_CONSENT_REQUIRED', 'FORBIDDEN'],
  ['SETTLEMENT_ADMIN_REQUIRED', 'FORBIDDEN'],
  ['SETTLEMENT_REVISION_CONFLICT', 'REVISION_CONFLICT'],
  ['SETTLEMENT_DRAFT_STALE', 'DRAFT_STALE'],
  ['SETTLEMENT_SOURCE_BUSY', 'SOURCE_BUSY'],
  ['private SQL host/secret', 'UNAVAILABLE'],
])('allowlists DB failure %s', async (message, code) => {
  const { port } = setup(null, { message });
  expect(await port.read(reportQuery)).toEqual({ ok: false, code });
});
it.each([
  null,
  {},
  { ...reportEnvelope, privateEvidence: 'hidden' },
  {
    ...reportEnvelope,
    report: { ...reportEnvelope.report, finalAmountKrw: 1 },
  },
])('fails closed malformed/inexact payload %#', async (data) =>
  expect(await setup(data).port.read(reportQuery)).toEqual({
    ok: false,
    code: 'UNAVAILABLE',
  }),
);
