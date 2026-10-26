import { defineConfig } from '@playwright/test';
import { ACTIVITY_REWARDS_CI_ENV } from './scripts/activity-rewards-local-config.mjs';

if (
  process.env.CI !== 'true' ||
  process.env.GITHUB_ACTIONS !== 'true' ||
  process.env.AUTH_LOCAL_E2E !== 'true' ||
  process.env.ACTIVITY_REWARDS_LOCAL_E2E !== 'true' ||
  process.env.NEXT_PUBLIC_APP_URL !== 'http://127.0.0.1:3100' ||
  process.env.NEXT_PUBLIC_SUPABASE_URL !== 'http://127.0.0.1:54321' ||
  Object.entries(ACTIVITY_REWARDS_CI_ENV).some(
    ([key, value]) => process.env[key] !== value,
  )
)
  throw new Error(
    'Run activity-rewards tests only in the isolated local CI job.',
  );

export default defineConfig({
  testDir: './tests/e2e/activity-rewards',
  fullyParallel: false,
  workers: 1,
  forbidOnly: true,
  retries: 0,
  timeout: 90_000,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:3100',
    // Identity cookies and private activity snapshots stay out of traces.
    // Screenshots contain only disposable fictional point records and accounts.
    trace: 'off',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm run start -- --hostname 127.0.0.1 --port 3100',
    env: {
      ...ACTIVITY_REWARDS_CI_ENV,
      UI_PREVIEW_ENABLED: 'false',
      AUTH_TEST_SERVICE_KEY: '',
    },
    url: 'http://127.0.0.1:3100/start',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
