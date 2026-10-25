import { defineConfig } from '@playwright/test';
import { BILLING_NOTICES_CI_ENV } from './scripts/billing-notices-local-fixtures.mjs';

if (
  process.env.CI !== 'true' ||
  process.env.GITHUB_ACTIONS !== 'true' ||
  process.env.AUTH_LOCAL_E2E !== 'true' ||
  process.env.BILLING_NOTICES_LOCAL_E2E !== 'true' ||
  process.env.BILLING_NOTICES_ENABLED !==
    BILLING_NOTICES_CI_ENV.BILLING_NOTICES_ENABLED ||
  process.env.BILLING_NOTICES_CRON_SECRET !==
    BILLING_NOTICES_CI_ENV.BILLING_NOTICES_CRON_SECRET ||
  process.env.NEXT_PUBLIC_APP_URL !== 'http://127.0.0.1:3100' ||
  process.env.NEXT_PUBLIC_SUPABASE_URL !== 'http://127.0.0.1:54321'
)
  throw new Error(
    'Run billing-notices tests only in the isolated local CI job.',
  );

export default defineConfig({
  testDir: './tests/e2e/billing-notices',
  fullyParallel: false,
  workers: 1,
  forbidOnly: true,
  retries: 0,
  timeout: 90_000,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:3100',
    // Fictional upcoming amounts and session cookies stay out of traces.
    // Screenshots contain only disposable fictional billing fixtures.
    trace: 'off',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm run start -- --hostname 127.0.0.1 --port 3100',
    env: {
      UI_PREVIEW_ENABLED: 'false',
      AUTH_TEST_SERVICE_KEY: '',
      WEBPUSH_ENABLED: 'false',
      WEBPUSH_WORKER_ENABLED: 'false',
      PAYMENTS_MODE: 'disabled',
      PAYMENTS_RENEWALS_ENABLED: 'false',
      PAYMENTS_REFUNDS_ENABLED: 'false',
      PAYMENTS_RECONCILIATION_ENABLED: 'false',
    },
    url: 'http://127.0.0.1:3100/start',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
