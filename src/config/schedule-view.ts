// Fixed calendar arithmetic and formatting bounds, not event/business policy.
export const SCHEDULE_VIEW = {
  dayMs: 86_400_000,
  microsecondsPerMillisecond: 1000,
  millisecondFractionDigits: 3,
  postgresFractionDigits: 6,
  monthLength: 7,
  dateLength: 10,
  yearLength: 4,
  monthDigits: 2,
  weekdays: 7,
  yearMax: 9999,
  // Proleptic Gregorian with an explicit era avoids ICU iso8601 omitting BC.
  locale: 'en-US-u-ca-gregory-nu-latn',
  beforeCommonEra: 'BC',
  offsetProbeDays: [-2, -1, 0, 1, 2],
} as const;
