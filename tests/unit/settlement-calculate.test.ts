// @vitest-environment node
import { expect, it } from 'vitest';
import {
  settlementCalculationEnvelopeSchema,
  settlementCalculationInputSchema,
  settlementCalculationQuerySchema,
  type SettlementCalculationInput,
  type SettlementBreakdown,
} from '@/config/settlement-calculation';
import { calculateSettlement } from '@/server/services/settlement/calculate';

function fixture(): SettlementCalculationInput {
  const artistId = '20400000-0000-4000-8000-000000000001';
  return {
    artistId,
    month: '2026-09-01',
    asOf: '2026-09-30T15:00:00Z',
    sourceVersion: '9007199254740993',
    policy: {
      id: '20400000-0000-4000-8000-000000000002',
      artistId,
      month: '2026-09-01',
      enabled: true,
      contractFrom: '2020-01-01',
      contractUntil: '2030-01-01',
      baseRate: '0.3',
      performanceRate: '0.4',
      performanceConditions: null,
      vatRate: '0.1',
      pgFeeRate: '0.03',
      activityEnabled: false,
      weeklyMessageMin: null,
      weeklyPhotoMin: null,
      partialWeekPolicy: 'block',
      negativeNetPolicy: 'block',
      lateEventPolicy: 'block',
    },
    events: [
      {
        id: '20400000-0000-4000-8000-000000000003',
        kind: 'charge',
        amountKrw: '6500',
        occurredAt: '2026-08-31T15:00:00Z',
        origin: 'current',
        currency: 'KRW',
        verified: true,
      },
    ],
    messages: [],
  };
}
function calculated(input: unknown): SettlementBreakdown {
  const result = calculateSettlement(input);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.code);
  return result.data;
}
function active(input = fixture()) {
  input.policy.activityEnabled = true;
  input.policy.weeklyMessageMin = 3;
  input.policy.weeklyPhotoMin = 2;
  input.policy.partialWeekPolicy = 'prorate_days';
  return input;
}
function messages(count: number, photos: number, month = '2026-09-01') {
  return Array.from({ length: count }, (_, index) => ({
    id: `20400000-0000-4000-8000-${String(100 + index).padStart(12, '0')}`,
    type: index < photos ? ('photo' as const) : ('text' as const),
    sentAt: `${month}T09:00:00+09:00`,
  }));
}
it('computes from verified ledger only with exact VAT, fee, base, base-rate share and final-only rounding', () => {
  const result = calculated(fixture());
  expect(result).toMatchObject({
    grossKrw: '6500',
    currentGrossKrw: '6500',
    adjustmentGrossKrw: '0',
    sourceVersion: '9007199254740993',
    sourceEventCount: '1',
    sourceMessageCount: '0',
    vatKrw: { exact: { numerator: '6500', denominator: '11' } },
    pgFeeKrw: { exact: { numerator: '1950', denominator: '11' } },
    baseAmountKrw: { exact: { numerator: '63050', denominator: '11' } },
    rate: { decimal: '0.3', decimalIsExact: true },
    shareKrw: { exact: { numerator: '18915', denominator: '11' } },
    activityRatio: { decimal: '1' },
    deductionKrw: { decimal: '0' },
    unroundedFinalKrw: { exact: { numerator: '18915', denominator: '11' } },
    finalAmountKrw: '1720',
    periodStart: '2026-08-31T15:00:00.000Z',
    periodEnd: '2026-09-30T15:00:00.000Z',
    currency: 'KRW',
  });
  expect(result.vatKrw.decimalIsExact).toBe(false);
});
it('uses aggregate exact fractional requirements, not rounded per-week values', () => {
  const input = active();
  input.messages = messages(6, 2);
  const result = calculated(input);
  expect(result.activityRatio.exact).toEqual({
    numerator: '7',
    denominator: '20',
  });
  expect(result.unroundedFinalKrw.exact).toEqual({
    numerator: '26481',
    denominator: '44',
  });
  expect(result.finalAmountKrw).toBe('602');
  expect(result.sourceMessageCount).toBe('6');
});
it('caps activity only after adding message/photo ratios, not each contribution', () => {
  const input = active();
  input.messages = messages(30, 0);
  expect(calculated(input).activityRatio.decimal).toBe('1');
  input.messages = messages(18, 0);
  expect(calculated(input).activityRatio.decimal).toBe('0.7');
  input.messages = [];
  expect(calculated(input).finalAmountKrw).toBe('0');
});
it('current-month refunds reduce the same approved VAT/fee basis, without inspecting mutable attempts', () => {
  const input = fixture();
  input.events.push({
    ...input.events[0]!,
    id: '20400000-0000-4000-8000-000000000004',
    kind: 'refund',
    amountKrw: '-1000',
    occurredAt: '2026-09-30T14:59:59.999999Z',
  });
  expect(calculated(input)).toMatchObject({
    grossKrw: '5500',
    vatKrw: { decimal: '500' },
    pgFeeKrw: { decimal: '150' },
    baseAmountKrw: { decimal: '4850' },
    finalAmountKrw: '1455',
  });
});
it('prior-month events need explicit current-formula adjustment policy and remain separate in the breakdown', () => {
  const input = fixture();
  input.events.push({
    ...input.events[0]!,
    id: '20400000-0000-4000-8000-000000000004',
    kind: 'refund',
    amountKrw: '-1000',
    occurredAt: '2026-08-31T14:59:59.999999Z',
    origin: 'adjustment',
  });
  expect(calculateSettlement(input)).toEqual({
    ok: false,
    code: 'ADJUSTMENT_POLICY_REQUIRED',
  });
  input.policy.lateEventPolicy = 'explicit_current_formula';
  expect(calculated(input)).toMatchObject({
    grossKrw: '5500',
    currentGrossKrw: '6500',
    adjustmentGrossKrw: '-1000',
    finalAmountKrw: '1455',
  });
  input.events[1]!.occurredAt = '2026-08-31T15:00:00Z';
  expect(calculateSettlement(input)).toEqual({
    ok: false,
    code: 'SOURCE_MISMATCH',
  });
});
it('does not invent negative-revenue treatment or clamp it to zero', () => {
  const input = fixture();
  input.events[0]!.kind = 'refund';
  input.events[0]!.amountKrw = '-1';
  expect(calculateSettlement(input)).toEqual({
    ok: false,
    code: 'NEGATIVE_NET_REQUIRES_POLICY',
  });
});
it('valid empty ledger produces a zero calculation but still requires an enabled approved policy', () => {
  const input = fixture();
  input.events = [];
  expect(calculated(input)).toMatchObject({
    grossKrw: '0',
    sourceEventCount: '0',
    finalAmountKrw: '0',
  });
  expect(calculateSettlement({ ...input, policy: null })).toEqual({
    ok: false,
    code: 'INVALID_INPUT',
  });
  expect(
    calculateSettlement({
      ...input,
      policy: { ...input.policy, enabled: false },
    }),
  ).toEqual({ ok: false, code: 'INVALID_INPUT' });
});
it('snapshots settings instead of retaining mutable input references or reading runtime defaults', () => {
  const input = fixture();
  const before = structuredClone(input);
  const result = calculated(input);
  expect(input).toEqual(before);
  input.policy.baseRate = '1';
  input.events[0]!.amountKrw = '999999';
  expect(result.policySnapshot.baseRate).toBe('0.3');
  expect(result.grossKrw).toBe('6500');
  expect(result.finalAmountKrw).toBe('1720');
});
it('compares close-of-month at exact microsecond precision', () => {
  const input = fixture();
  input.asOf = '2026-09-30T14:59:59.999999Z';
  expect(calculateSettlement(input)).toEqual({ ok: false, code: 'MONTH_OPEN' });
  input.asOf = '2026-10-01T00:00:00+09:00';
  expect(calculated(input).finalAmountKrw).toBe('1720');
});
it.each([
  '2026-08-31T14:59:59.999999Z',
  '2026-09-30T15:00:00Z',
  '2026-10-01T00:00:00.000001+09:00',
])('rejects current event outside exact half-open window %s', (occurredAt) => {
  const input = fixture();
  input.events[0]!.occurredAt = occurredAt;
  expect(calculateSettlement(input)).toEqual({
    ok: false,
    code: 'SOURCE_MISMATCH',
  });
});
it.each([
  ['charge', '0'],
  ['charge', '-1'],
  ['refund', '0'],
  ['refund', '1'],
] as const)('rejects %s with non-ledger sign %s', (kind, amountKrw) => {
  const input = fixture();
  input.events[0] = { ...input.events[0]!, kind, amountKrw };
  expect(calculateSettlement(input)).toEqual({
    ok: false,
    code: 'SOURCE_MISMATCH',
  });
});
it.each(['failed', 'unknown', 'initial', 'renewal', 'retry'])(
  'never treats %s attempts as revenue',
  (kind) => {
    const input = fixture();
    const event = { ...input.events[0], kind };
    expect(calculateSettlement({ ...input, events: [event] })).toEqual({
      ok: false,
      code: 'INVALID_INPUT',
    });
  },
);
it('rejects duplicated money sources and mismatched policy artist/month', () => {
  const input = fixture();
  input.events.push({ ...input.events[0]! });
  expect(calculateSettlement(input)).toEqual({
    ok: false,
    code: 'SOURCE_MISMATCH',
  });
  input.events.pop();
  input.policy.artistId = '20400000-0000-4000-8000-000000000009';
  expect(calculateSettlement(input)).toEqual({
    ok: false,
    code: 'SOURCE_MISMATCH',
  });
  input.policy.artistId = input.artistId;
  input.policy.month = '2026-08-01';
  expect(calculateSettlement(input)).toEqual({
    ok: false,
    code: 'SOURCE_MISMATCH',
  });
});
it.each([
  '0.0000001',
  '1.000001',
  '-0.1',
  '0.3e0',
  '.3',
  '00.3',
  'NaN',
  'Infinity',
  0.3,
])('rejects noncanonical or unapproved rate %s', (baseRate) => {
  const input = fixture();
  expect(
    calculateSettlement({ ...input, policy: { ...input.policy, baseRate } }),
  ).toEqual({ ok: false, code: 'INVALID_INPUT' });
});
it.each([
  '2026-09-01T00:00:00+24:00',
  '2026-09-01T00:00:00+00:60',
  '2026-09-31T00:00:00Z',
  '2026-09-01T25:00:00Z',
  '2026-09-01T00:00:00.1234567Z',
  '2026-09-01',
  'bad',
])(
  'fails closed without throwing for invalid or unsupported timestamp %s',
  (value) => {
    const input = fixture();
    expect(calculateSettlement({ ...input, asOf: value })).toEqual({
      ok: false,
      code: 'INVALID_INPUT',
    });
    expect(
      calculateSettlement({
        ...input,
        messages: [{ id: input.artistId, type: 'photo', sentAt: value }],
      }),
    ).toEqual({ ok: false, code: 'INVALID_INPUT' });
    expect(
      calculateSettlement({
        ...input,
        events: [{ ...input.events[0], occurredAt: value }],
      }),
    ).toEqual({ ok: false, code: 'INVALID_INPUT' });
  },
);
it.each([{}, null, [], { events: [{ kind: 'charge', amountKrw: 6500 }] }])(
  'rejects missing source objects without defaults %#',
  (input) => {
    expect(calculateSettlement(input)).toEqual({
      ok: false,
      code: 'INVALID_INPUT',
    });
  },
);
it('rejects fabricated verification, unsupported performance rules and unknown policy/source fields', () => {
  const input = fixture();
  for (const malformed of [
    { ...input, events: [{ ...input.events[0], verified: false }] },
    { ...input, events: [{ ...input.events[0], currency: 'USD' }] },
    { ...input, events: [{ ...input.events[0], amountKrw: '1.0' }] },
    { ...input, events: [{ ...input.events[0], amountKrw: '-0' }] },
    { ...input, policy: { ...input.policy, performanceConditions: {} } },
    { ...input, policy: { ...input.policy, partialWeekPolicy: 'invented' } },
    { ...input, policy: { ...input.policy, negativeNetPolicy: 'clamp' } },
    { ...input, policy: { ...input.policy, approved: true } },
    { ...input, attempts: [] },
  ])
    expect(calculateSettlement(malformed)).toEqual({
      ok: false,
      code: 'INVALID_INPUT',
    });
});
it('supports six-place rates and exact final half-up while performance remains null/base', () => {
  const input = fixture();
  input.events[0]!.amountKrw = '1';
  input.policy.vatRate = '0';
  input.policy.pgFeeRate = '0';
  input.policy.baseRate = '0.500000';
  input.policy.performanceRate = '1';
  expect(calculated(input)).toMatchObject({
    finalAmountKrw: '1',
    rate: { decimal: '0.5' },
  });
  input.policy.baseRate = '0.499999';
  expect(calculated(input).finalAmountKrw).toBe('0');
  input.policy.baseRate = '0.500001';
  expect(calculated(input).finalAmountKrw).toBe('1');
});
it('supports 100-digit gross without Number coercion or intermediate rounding', () => {
  const input = fixture();
  const gross = 10n ** 99n + 7n;
  input.events[0]!.amountKrw = gross.toString();
  input.policy.baseRate = '0.5';
  input.policy.vatRate = '0';
  input.policy.pgFeeRate = '0';
  expect(calculated(input)).toMatchObject({
    grossKrw: gross.toString(),
    finalAmountKrw: ((gross + 1n) / 2n).toString(),
  });
  input.events[0]!.amountKrw = (10n ** 100n).toString();
  expect(calculateSettlement(input)).toEqual({
    ok: false,
    code: 'INVALID_INPUT',
  });
});
it('matches an independent integer formula across month lengths, six-place fees, rates and activity', () => {
  const months = [
    ['2021-02-01', 28],
    ['2024-02-01', 29],
    ['2026-09-01', 30],
    ['2026-10-01', 31],
  ] as const;
  const unit = 1_000_000n;
  for (const [month, days] of months)
    for (let index = 0; index < 16; index += 1) {
      const input = active();
      input.month = month;
      input.policy.month = month;
      input.asOf = '2026-12-01T00:00:00Z';
      const gross = 10n ** BigInt(index + 1) + BigInt(index + 1);
      const vat = BigInt(index * 62500);
      const fee = BigInt(index * 31251);
      const rate = BigInt(index * 63157);
      const format = (value: bigint) =>
        `0.${value.toString().padStart(6, '0')}`;
      input.policy.vatRate = format(vat);
      input.policy.pgFeeRate = format(fee);
      input.policy.baseRate = format(rate);
      input.events[0]!.occurredAt = `${month}T00:00:00+09:00`;
      input.events[0]!.amountKrw = gross.toString();
      input.messages = messages(index, Math.floor(index / 2), month);
      const result = calculated(input);
      const anRaw =
        7n * (BigInt(index) * 2n + BigInt(Math.floor(index / 2)) * 3n);
      const ad = 2n * BigInt(days) * 3n * 2n;
      const an = anRaw < ad ? anRaw : ad;
      const numerator = gross * (unit - fee) * rate * an;
      const denominator = (unit + vat) * unit * ad;
      const actual = result.unroundedFinalKrw.exact;
      expect(BigInt(actual.numerator) * denominator).toBe(
        numerator * BigInt(actual.denominator),
      );
      expect(result.finalAmountKrw).toBe(
        ((2n * numerator + denominator) / (2n * denominator)).toString(),
      );
    }
});
it('validates bounded query, actor envelope and source-array transport without silently truncating', () => {
  const input = fixture();
  expect(
    settlementCalculationQuerySchema.safeParse({
      artistId: input.artistId,
      month: input.month,
    }).success,
  ).toBe(true);
  for (const month of ['1999-12-01', '9999-01-01', '2026-09-02', '2026-02-30'])
    expect(
      settlementCalculationQuerySchema.safeParse({
        artistId: input.artistId,
        month,
      }).success,
    ).toBe(false);
  expect(
    settlementCalculationEnvelopeSchema.safeParse({
      actorId: input.artistId,
      input,
    }).success,
  ).toBe(true);
  expect(
    settlementCalculationEnvelopeSchema.safeParse({
      actorId: input.artistId,
      input,
      secret: 'not allowed',
    }).success,
  ).toBe(false);
  expect(
    settlementCalculationInputSchema.safeParse({
      ...input,
      events: Array.from({ length: 50_001 }, () => input.events[0]),
    }).success,
  ).toBe(false);
});

it.each([
  ['2625340252468594398930681121654399', '102014961851805350', -1n],
  ['2433889152438170186684174224592130', '94575592174779636', 0n],
  ['2242438052407745974437667327529861', '87136222497753921', 1n],
] as const)(
  'keeps final rounding exact with sub-display half-boundary residual %s',
  (gross, rounded, residual) => {
    const input = active();
    input.events[0]!.amountKrw = gross;
    input.policy.weeklyMessageMin = 9007199254740991;
    input.policy.weeklyPhotoMin = 9007199254740881;
    input.policy.vatRate = '0';
    input.policy.pgFeeRate = '0';
    input.policy.baseRate = '1';
    input.messages = messages(2, 1);
    const result = calculated(input);
    const numerator = BigInt(result.unroundedFinalKrw.exact.numerator);
    const denominator = BigInt(result.unroundedFinalKrw.exact.denominator);
    const compare = 2n * (numerator % denominator) - denominator;
    expect(compare < 0n ? -1n : compare > 0n ? 1n : 0n).toBe(residual);
    expect(result.finalAmountKrw).toBe(rounded);
  },
);
