import type { SettlementCalculationInput } from '@/config/settlement-calculation';
export const settlementActor = 'd4000000-0000-4000-8000-000000000001';
export const settlementOther = 'd4000000-0000-4000-8000-000000000002';
export const settlementArtist = 'd4000000-0000-4000-8000-000000000003';
export const settlementQuery = {
  artistId: settlementArtist,
  month: '2026-09-01',
};
export const settlementInput: SettlementCalculationInput = {
  ...settlementQuery,
  asOf: '2026-10-01T00:00:00Z',
  sourceVersion: '9007199254740993',
  policy: {
    id: 'd4000000-0000-4000-8000-000000000004',
    ...settlementQuery,
    enabled: true,
    contractFrom: '2026-01-01',
    contractUntil: '2027-01-01',
    baseRate: '0.300000',
    performanceRate: '0.400000',
    vatRate: '0.100000',
    pgFeeRate: '0.030000',
    performanceConditions: null,
    activityEnabled: false,
    weeklyMessageMin: null,
    weeklyPhotoMin: null,
    partialWeekPolicy: 'block',
    negativeNetPolicy: 'block',
    lateEventPolicy: 'block',
  },
  events: [
    {
      id: 'd4000000-0000-4000-8000-000000000005',
      kind: 'charge',
      amountKrw: '6500',
      occurredAt: '2026-09-01T00:00:00.123456+09:00',
      origin: 'current',
      currency: 'KRW',
      verified: true,
    },
  ],
  messages: [],
};
export const settlementEnvelope = {
  actorId: settlementActor,
  input: settlementInput,
};
