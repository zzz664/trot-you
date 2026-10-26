import 'server-only';
import {
  settlementReportEnvelopeSchema,
  type SettlementReportEnvelope,
  type SettlementReportError,
  type SettlementReportResult,
} from '@/config/settlement-reports';
import type { SettlementReportsPort } from '@/server/services/settlement-reports/manage';
import type { ActorClient } from './client';
const errors: Record<string, SettlementReportError> = {
  SETTLEMENT_ADMIN_REQUIRED: 'FORBIDDEN',
  SETTLEMENT_FORBIDDEN: 'FORBIDDEN',
  SETTLEMENT_CONSENT_REQUIRED: 'FORBIDDEN',
  SETTLEMENT_REPORT_FORBIDDEN: 'FORBIDDEN',
  SETTLEMENT_REPORT_INVALID_INPUT: 'INVALID_INPUT',
  SETTLEMENT_MONTH_INVALID: 'INVALID_INPUT',
  SETTLEMENT_MONTH_OPEN: 'MONTH_OPEN',
  SETTLEMENT_NOT_FOUND: 'NOT_FOUND',
  SETTLEMENT_REVISION_CONFLICT: 'REVISION_CONFLICT',
  SETTLEMENT_DRAFT_STALE: 'DRAFT_STALE',
  SETTLEMENT_CONFIRMED: 'CONFIRMED',
  SETTLEMENT_POLICY_REQUIRED: 'POLICY_REQUIRED',
  SETTLEMENT_FULL_MONTH_CONTRACT_REQUIRED: 'FULL_MONTH_CONTRACT_REQUIRED',
  SETTLEMENT_PARTIAL_WEEK_POLICY_REQUIRED: 'PARTIAL_WEEK_POLICY_REQUIRED',
  SETTLEMENT_ADJUSTMENT_POLICY_REQUIRED: 'ADJUSTMENT_POLICY_REQUIRED',
  SETTLEMENT_NEGATIVE_NET_REQUIRES_POLICY: 'NEGATIVE_NET_REQUIRES_POLICY',
  SETTLEMENT_SOURCE_MISMATCH: 'SOURCE_MISMATCH',
  SETTLEMENT_FORMULA_MISMATCH: 'SOURCE_MISMATCH',
  SETTLEMENT_SOURCE_LIMIT_EXCEEDED: 'SOURCE_LIMIT_EXCEEDED',
  SETTLEMENT_SOURCE_BUSY: 'SOURCE_BUSY',
};
function result(response: {
  data: unknown;
  error: { message: string } | null;
}): SettlementReportResult<SettlementReportEnvelope> {
  if (response.error)
    return {
      ok: false,
      code: Object.hasOwn(errors, response.error.message)
        ? errors[response.error.message]!
        : 'UNAVAILABLE',
    };
  const parsed = settlementReportEnvelopeSchema.safeParse(response.data);
  return parsed.success
    ? { ok: true, data: parsed.data }
    : { ok: false, code: 'UNAVAILABLE' };
}
export function createSettlementReportsPort(
  client: ActorClient,
): SettlementReportsPort {
  return {
    async read(query) {
      return result(
        await client.rpc('settlement_report_read', {
          p_artist_id: query.artistId,
          p_month: query.month,
          p_include_sources: false,
        }),
      );
    },
    async calculate(query) {
      return result(
        await client.rpc('settlement_report_calculate', {
          p_artist_id: query.artistId,
          p_month: query.month,
          ...(query.expectedRevision === null
            ? {}
            : { p_expected_revision: query.expectedRevision }),
        }),
      );
    },
    async confirm(query) {
      return result(
        await client.rpc('settlement_report_confirm', {
          p_report_id: query.reportId,
          p_expected_revision: query.expectedRevision,
        }),
      );
    },
    async export(query) {
      return result(
        await client.rpc('settlement_report_export', {
          p_report_id: query.reportId,
          p_expected_revision: query.expectedRevision,
        }),
      );
    },
  };
}
