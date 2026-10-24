// Explicit values of an owner-approved immutable policy, never operational defaults.
export const BILLING_PERIOD_CALENDARS = [
  'utc_monthly_clamped',
  'seoul_monthly_clamped',
] as const;
export type BillingPeriodCalendar = (typeof BILLING_PERIOD_CALENDARS)[number];
export const BILLING_CALENDAR_OFFSETS_MS: Record<
  BillingPeriodCalendar,
  number
> = {
  utc_monthly_clamped: 0,
  seoul_monthly_clamped: 9 * 60 * 60 * 1000,
};
export const SUPPORTED_PAYMENT_TAX_BASIS = 'taxable_krw';
