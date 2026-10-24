import { defineConfig } from '@playwright/test';

if (
  process.env.AUTH_LOCAL_E2E !== 'true' ||
  process.env.ENROLLMENT_LOCAL_E2E !== 'true' ||
  process.env.CI !== 'true' ||
  process.env.GITHUB_ACTIONS !== 'true'
)
  throw new Error('Run enrollment tests only in the isolated local CI job.');

export default defineConfig({
  testDir: './tests/e2e/enrollment',
  fullyParallel: false,
  workers: 1,
  forbidOnly: true,
  retries: 0,
  timeout: 60_000,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:3100',
    trace: 'off',
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command: 'node scripts/enrollment-local-ci-provider.mjs',
      env: { NODE_ENV: 'development', AUTH_TEST_SERVICE_KEY: '' },
      url: 'http://127.0.0.1:3200/__fixture/health',
      reuseExistingServer: false,
    },
    {
      // Mock transport is explicitly rejected by NODE_ENV=production. These
      // integration fixtures use the real local app in development mode only.
      command: 'npm run dev -- --hostname 127.0.0.1 --port 3100',
      env: {
        NODE_ENV: 'development',
        UI_PREVIEW_ENABLED: 'false',
        AUTH_TEST_SERVICE_KEY: '',
      },
      url: 'http://127.0.0.1:3100/start',
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
