import { defineConfig } from '@playwright/test';
import { WEBPUSH_CI_ENV } from './scripts/webpush-local-fixtures.mjs';

if (
  process.env.CI !== 'true' ||
  process.env.GITHUB_ACTIONS !== 'true' ||
  process.env.AUTH_LOCAL_E2E !== 'true' ||
  !Object.entries(WEBPUSH_CI_ENV).every(
    ([key, value]) => process.env[key] === value,
  ) ||
  Boolean(process.env.WEBPUSH_CRON_SECRET) ||
  process.env.NEXT_PUBLIC_APP_URL !== 'http://127.0.0.1:3100' ||
  process.env.NEXT_PUBLIC_SUPABASE_URL !== 'http://127.0.0.1:54321'
)
  throw new Error('Run webpush tests only in the isolated local CI job.');

export default defineConfig({
  testDir: './tests/e2e/webpush',
  fullyParallel: false,
  workers: 1,
  forbidOnly: true,
  retries: 0,
  timeout: 90_000,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:3100',
    // Synthetic endpoint identifiers and session cookies stay out
    // of traces. Screenshots contain fictional configuration UI only.
    trace: 'off',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm run start -- --hostname 127.0.0.1 --port 3100',
    env: { UI_PREVIEW_ENABLED: 'false', AUTH_TEST_SERVICE_KEY: '' },
    url: 'http://127.0.0.1:3100/start',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
