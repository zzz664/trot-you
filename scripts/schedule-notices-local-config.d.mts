export const SCHEDULE_NOTICES_CI_ENV: Readonly<{
  SCHEDULE_NOTICES_ENABLED: 'true';
  SCHEDULE_NOTICES_CRON_SECRET: 'schedule-notices-isolated-ci-secret-not-production';
  BILLING_NOTICES_ENABLED: 'false';
  BILLING_NOTICES_CRON_SECRET: '';
  PAYMENTS_MODE: 'disabled';
  TOSS_BILLING_ENABLED: 'false';
  KAKAOPAY_SUBSCRIPTION_ENABLED: 'false';
  PAYMENTS_RENEWALS_ENABLED: 'false';
  PAYMENTS_REFUNDS_ENABLED: 'false';
  PAYMENTS_RECONCILIATION_ENABLED: 'false';
  WEBPUSH_ENABLED: 'false';
  WEBPUSH_WORKER_ENABLED: 'false';
  NEXT_PUBLIC_TOSS_CLIENT_KEY: '';
  TOSS_SECRET_KEY: '';
  TOSS_BILLING_MID: '';
  KAKAOPAY_SECRET_KEY: '';
  KAKAOPAY_RECURRING_CID: '';
  KAKAOPAY_CID_SECRET: '';
}>;

export function scheduleNoticesLocalEnvironment(
  environment: Record<string, string | undefined>,
): string;
