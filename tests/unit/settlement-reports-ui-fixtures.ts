import type { SettlementReportEnvelope } from '@/config/settlement-reports';
import { calculateSettlement } from '@/server/services/settlement/calculate';
import {
  settlementInput,
  settlementActor,
  settlementOther,
  settlementQuery,
} from './settlement-calculation-fixtures';
export const reportActor = settlementActor;
export const reportOther = settlementOther;
export const reportQuery = settlementQuery;
const calculated = calculateSettlement(settlementInput);
if (!calculated.ok) throw new Error('Invalid settlement UI fixture');
const data = calculated.data;
const fraction = (value: typeof data.vatKrw): [string, string] => [
  value.exact.numerator,
  value.exact.denominator,
];
export const reportEnvelope: SettlementReportEnvelope = {
  actorId: reportActor,
  actorRole: 'admin',
  artist: {
    id: reportQuery.artistId,
    slug: 'fictional-artist',
    name: '=허구 <가수> & 검토',
  },
  month: reportQuery.month,
  sources: null,
  report: {
    id: 'd4000000-0000-4000-8000-000000000010',
    revision: 'd4000000-0000-4000-8000-000000000011',
    status: 'draft',
    periodStart: data.periodStart,
    periodEnd: data.periodEnd,
    currency: data.currency,
    sourceVersion: data.sourceVersion,
    sourceEventCount: data.sourceEventCount,
    sourceMessageCount: data.sourceMessageCount,
    grossKrw: data.grossKrw,
    currentGrossKrw: data.currentGrossKrw,
    adjustmentGrossKrw: data.adjustmentGrossKrw,
    vatKrw: data.vatKrw.decimal,
    pgFeeKrw: data.pgFeeKrw.decimal,
    baseAmountKrw: data.baseAmountKrw.decimal,
    rate: data.rate.decimal,
    activityRatio: data.activityRatio.decimal,
    deductionKrw: data.deductionKrw.decimal,
    unroundedFinalKrw: data.unroundedFinalKrw.decimal,
    finalAmountKrw: data.finalAmountKrw,
    exactComponents: {
      vat: fraction(data.vatKrw),
      pg_fee: fraction(data.pgFeeKrw),
      base: fraction(data.baseAmountKrw),
      share: fraction(data.shareKrw),
      activity_ratio: fraction(data.activityRatio),
      deduction: fraction(data.deductionKrw),
      final: fraction(data.unroundedFinalKrw),
    },
    policySnapshot: data.policySnapshot,
    calculatedAt: data.asOf,
    confirmedAt: null,
    weeklyStats: data.weeklyStats.map((week) => ({
      ...week,
      messageRequired: week.messageRequired.decimal,
      photoRequired: week.photoRequired.decimal,
    })),
  },
};
export function confirmedEnvelope(
  actorRole: 'admin' | 'artist' = 'admin',
): SettlementReportEnvelope {
  return {
    ...reportEnvelope,
    actorRole,
    report: {
      ...reportEnvelope.report!,
      status: 'confirmed',
      confirmedAt: '2026-10-02T00:00:00Z',
    },
  };
}
