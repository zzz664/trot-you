// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { SettlementReportEnvelope } from '@/config/settlement-reports';
import type { SettlementCalculationPolicy } from '@/config/settlement-calculation';
import { calculateSettlement } from '@/server/services/settlement/calculate';
import { validateSettlementReportEnvelope } from '@/server/services/settlement-reports/manage';
import {
  reportEnvelope,
  confirmedEnvelope,
} from './settlement-reports-ui-fixtures';
import { settlementInput } from './settlement-calculation-fixtures';

function calculated(
  amount: string,
  policy: Partial<SettlementCalculationPolicy> = {},
) {
  const input = structuredClone(settlementInput);
  input.events[0]!.amountKrw = amount;
  Object.assign(input.policy, policy);
  const result = calculateSettlement(input);
  if (!result.ok) throw new Error('Invalid snapshot test fixture');
  const data = result.data;
  const fraction = (value: typeof data.vatKrw): [string, string] => [
    value.exact.numerator,
    value.exact.denominator,
  ];
  const envelope = structuredClone(reportEnvelope);
  const report = envelope.report!;
  Object.assign(report, {
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
    policySnapshot: data.policySnapshot,
    exactComponents: {
      vat: fraction(data.vatKrw),
      pg_fee: fraction(data.pgFeeKrw),
      base: fraction(data.baseAmountKrw),
      share: fraction(data.shareKrw),
      activity_ratio: fraction(data.activityRatio),
      deduction: fraction(data.deductionKrw),
      final: fraction(data.unroundedFinalKrw),
    },
    weeklyStats: data.weeklyStats.map((week) => ({
      ...week,
      messageRequired: week.messageRequired.decimal,
      photoRequired: week.photoRequired.decimal,
    })),
  });
  return envelope;
}
const invalid = { ok: false, code: 'UNAVAILABLE' };
const valid = (envelope: SettlementReportEnvelope) =>
  expect(validateSettlementReportEnvelope(envelope)).toEqual({
    ok: true,
    data: envelope,
  });

describe('saved settlement snapshot precision', () => {
  it('accepts unchanged draft and confirmed snapshots without narrowing exact strings', () => {
    valid(reportEnvelope);
    valid(confirmedEnvelope());
    valid(confirmedEnvelope('artist'));
  });

  // Recorded with an isolated PostgreSQL/PGlite numeric expression matching
  // the actual settlement formula: scale follows significant base-10000
  // groups, not a fixed 16 fractional places. No historical suites ran.
  it.each([
    ['100', '9.0909090909090909'],
    ['10000', '909.0909090909090909'],
    ['1000000', '90909.090909090909'],
    ['100000000000000', '9090909090909.0909'],
  ])('accepts observed PostgreSQL VAT display for gross %s', (gross, vat) => {
    const envelope = calculated(gross, { vatRate: '0.1' });
    envelope.report!.vatKrw = vat;
    valid(envelope);
  });

  it('accepts preserved rate scale and a rounded repeating display', () => {
    const envelope = calculated('100000000000000', { vatRate: '0.100000' });
    envelope.report!.vatKrw = '9090909090909.090909';
    valid(envelope);
  });

  it('keeps integers beyond JavaScript precision exact without requiring decimals', () => {
    const amount = '900719925474099312345678901234567890';
    const envelope = calculated(amount, {
      vatRate: '0',
      pgFeeRate: '0',
      baseRate: '1',
    });
    valid(envelope);
    expect(envelope.report!.finalAmountKrw).toBe(amount);
  });

  it('requires significant precision from the rational rather than the displayed magnitude', () => {
    const envelope = calculated('1', {
      vatRate: '0.000001',
      pgFeeRate: '0',
      baseRate: '0.000001',
    });
    valid(envelope);
    envelope.report!.unroundedFinalKrw = '0.0000000000000000';
    expect(validateSettlementReportEnvelope(envelope)).toEqual(invalid);
  });

  it.each([
    '0',
    '90909',
    '90909.09',
    '90909.090909090907',
    '90909.090909090911',
  ])('rejects inaccurate or underprecise display %s', (value) => {
    const envelope = calculated('1000000', { vatRate: '0.1' });
    envelope.report!.vatKrw = value;
    expect(validateSettlementReportEnvelope(envelope)).toEqual(invalid);
  });

  it('does not permit one-ULP corruption when the rational is exactly representable', () => {
    const envelope = calculated('11000');
    envelope.report!.vatKrw = '1000.0000000000000001';
    expect(validateSettlementReportEnvelope(envelope)).toEqual(invalid);
    const zero = calculated('11000', { vatRate: '0' });
    zero.report!.vatKrw = '0.0000000000000001';
    expect(validateSettlementReportEnvelope(zero)).toEqual(invalid);
  });

  it.each([
    ['vat', ['1', '1']],
    ['base', ['1', '1']],
    ['final', ['1', '1']],
    ['deduction', ['1', '1']],
    ['activity_ratio', ['0', '1']],
  ] as const)(
    'rejects a tampered authoritative %s fraction independently of displayed totals',
    (key, fraction) => {
      const envelope = structuredClone(reportEnvelope);
      envelope.report!.exactComponents[key] = [...fraction];
      expect(validateSettlementReportEnvelope(envelope)).toEqual(invalid);
    },
  );

  it('rejects a changed rounded final amount even when the display and fractions agree', () => {
    const envelope = structuredClone(reportEnvelope);
    envelope.report!.finalAmountKrw = (
      BigInt(envelope.report!.finalAmountKrw) + 1n
    ).toString();
    expect(validateSettlementReportEnvelope(envelope)).toEqual(invalid);
  });
});

describe('saved settlement snapshot boundaries', () => {
  it('rejects shifted Tuesday-to-Tuesday windows even with unique Monday anchors and a complete month', () => {
    const envelope = structuredClone(reportEnvelope);
    const days = [
      '2026-09-01',
      '2026-09-08',
      '2026-09-15',
      '2026-09-22',
      '2026-09-29',
      '2026-10-01',
    ];
    envelope.report!.weeklyStats.forEach((week, index) => {
      week.windowStart = days[index]!;
      week.windowEnd = days[index + 1]!;
    });
    expect(validateSettlementReportEnvelope(envelope)).toEqual(invalid);
  });

  it.each([
    (report: NonNullable<SettlementReportEnvelope['report']>) => {
      report.weeklyStats[0]!.windowStart = '2026-08-31';
    },
    (report: NonNullable<SettlementReportEnvelope['report']>) => {
      report.weeklyStats[0]!.windowEnd = '2026-09-08';
    },
    (report: NonNullable<SettlementReportEnvelope['report']>) => {
      report.weeklyStats[1]!.weekStart = '2026-09-01';
    },
    (report: NonNullable<SettlementReportEnvelope['report']>) => {
      report.weeklyStats.at(-1)!.windowEnd = '2026-10-02';
    },
    (report: NonNullable<SettlementReportEnvelope['report']>) => {
      report.weeklyStats[0]!.photoCount = '1';
    },
    (report: NonNullable<SettlementReportEnvelope['report']>) => {
      report.weeklyStats[0]!.messageRequired = '1';
    },
    (report: NonNullable<SettlementReportEnvelope['report']>) => {
      report.sourceMessageCount = '1';
    },
    (report: NonNullable<SettlementReportEnvelope['report']>) => {
      report.periodStart = '2026-09-01T00:00:01+09:00';
    },
    (report: NonNullable<SettlementReportEnvelope['report']>) => {
      report.periodEnd = '2026-10-01T00:00:01+09:00';
    },
    (report: NonNullable<SettlementReportEnvelope['report']>) => {
      report.policySnapshot.month = '2026-08-01';
    },
    (report: NonNullable<SettlementReportEnvelope['report']>) => {
      report.policySnapshot.contractUntil = '2026-09-30';
    },
  ])('rejects inconsistent frozen boundary or activity field %#', (mutate) => {
    const envelope = structuredClone(reportEnvelope);
    mutate(envelope.report!);
    expect(validateSettlementReportEnvelope(envelope)).toEqual(invalid);
  });

  it('does not expose a draft or source details through an artist envelope', () => {
    const draft = structuredClone(reportEnvelope);
    draft.actorRole = 'artist';
    expect(validateSettlementReportEnvelope(draft)).toEqual(invalid);
    const confirmed = confirmedEnvelope('artist');
    confirmed.sources = [];
    expect(validateSettlementReportEnvelope(confirmed)).toEqual(invalid);
  });

  it('allows an absent report only without source detail', () => {
    const absent = { ...reportEnvelope, report: null };
    valid(absent);
    expect(
      validateSettlementReportEnvelope({ ...absent, sources: [] }),
    ).toEqual(invalid);
  });
});
