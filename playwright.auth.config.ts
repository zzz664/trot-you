import { defineConfig } from '@playwright/test';

if (process.env.AUTH_LOCAL_E2E !== 'true' || process.env.CI !== 'true') {
  throw new Error(
    'Run authentication tests only in the isolated local CI job.',
  );
}

export default defineConfig({
  testDir: './tests/e2e/authenticated',
  fullyParallel: false,
  workers: 1,
  forbidOnly: true,
  retries: 0,
  timeout: 45_000,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:3100',
    // Even disposable session cookies should not be copied into trace files.
    trace: 'off',
    screenshot: 'only-on-failure',
  },
  webServer: {
    env: { UI_PREVIEW_ENABLED: 'false', AUTH_TEST_SERVICE_KEY: '' },
    command: 'npm run start -- --hostname 127.0.0.1 --port 3100',
    url: 'http://127.0.0.1:3100/start',
    reuseExistingServer: false,
  },
});
