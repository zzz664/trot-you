// Credential readiness only. An enabled flag never implements an integration.
export const INTEGRATION_REQUIREMENTS = {
  supabase: [
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
  ],
  toss_card_billing: [
    'NEXT_PUBLIC_TOSS_CLIENT_KEY',
    'TOSS_SECRET_KEY',
    'TOSS_BILLING_MID',
  ],
  kakaopay_subscription: ['KAKAOPAY_SECRET_KEY', 'KAKAOPAY_RECURRING_CID'],
  webpush: ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT'],
  alimtalk: ['ALIMTALK_API_KEY'],
  cron: ['CRON_SECRET'],
} as const;

export type IntegrationId = keyof typeof INTEGRATION_REQUIREMENTS;
export type RequiredEnvironmentKey =
  (typeof INTEGRATION_REQUIREMENTS)[IntegrationId][number];

// These are implementation/approval gates, not environment switches to bypass.
export const PAYMENT_LAUNCH_GATES = [
  'provider_specific_adapter',
  'database_and_immutable_ledger',
  'encrypted_mandate_storage',
  'merchant_billing_approval',
  'approved_business_policy',
  'sandbox_and_live_verification',
  'uncertain_outcome_reconciliation',
] as const;

// Known sandbox CIDs; do not infer an undocumented live CID format.
export const KAKAOPAY_TEST_CIDS = [
  'TCSUBSCRIP',
  'TCSEQUENCE',
  'TC0ONETIME',
] as const;
