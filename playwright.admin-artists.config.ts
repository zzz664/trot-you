import { defineConfig } from '@playwright/test';
import { ADMIN_ARTISTS_CI_ENV } from './scripts/admin-artists-local-fixtures.mjs';

if (
  process.env.CI !== 'true' ||
  process.env.GITHUB_ACTIONS !== 'true' ||
  process.env.AUTH_LOCAL_E2E !== 'true' ||
  process.env.ADMIN_ARTISTS_LOCAL_E2E !== 'true' ||
  process.env.NEXT_PUBLIC_APP_URL !== 'http://127.0.0.1:3100' ||
  process.env.NEXT_PUBLIC_SUPABASE_URL !== 'http://127.0.0.1:54321' ||
  Object.entries(ADMIN_ARTISTS_CI_ENV).some(
    ([key, value]) => process.env[key] !== value,
  )
)
  throw new Error('Run admin-artists tests only in the isolated local CI job.');

export default defineConfig({
  testDir: './tests/e2e/admin-artists',
  fullyParallel: false,
  workers: 1,
  forbidOnly: true,
  retries: 0,
  timeout: 90_000,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:3100',
    // Identity cookies and private admin snapshots stay out of traces.
    // Screenshots contain only disposable fictional artists and accounts.
    trace: 'off',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm run start -- --hostname 127.0.0.1 --port 3100',
    env: {
      ...ADMIN_ARTISTS_CI_ENV,
      UI_PREVIEW_ENABLED: 'false',
      AUTH_TEST_SERVICE_KEY: '',
    },
    url: 'http://127.0.0.1:3100/start',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
