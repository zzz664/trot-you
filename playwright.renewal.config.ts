import { defineConfig } from '@playwright/test';
import { RENEWAL_CI } from './src/config/enrollment-test-runtime';
import enrollment from './playwright.enrollment.config';

if (
  process.env.RENEWAL_LOCAL_E2E !== 'true' ||
  process.env.PAYMENTS_RENEWALS_ENABLED !== 'true' ||
  process.env.RENEWAL_CRON_SECRET !== RENEWAL_CI.cronSecret
)
  throw new Error('Run renewal tests only in the isolated local CI job.');

export default defineConfig({
  ...enrollment,
  testDir: './tests/e2e/renewal',
  timeout: 90_000,
});
