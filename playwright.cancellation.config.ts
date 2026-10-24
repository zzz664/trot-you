import { defineConfig } from '@playwright/test';
import { parseCancellationTestRuntime } from './src/config/cancellation-test-runtime';
import enrollment from './playwright.enrollment.config';

if (
  parseCancellationTestRuntime({ ...process.env, NODE_ENV: 'development' })
    .mode !== 'ci'
)
  throw new Error('Run cancellation tests only in the isolated local CI job.');

export default defineConfig({
  ...enrollment,
  testDir: './tests/e2e/cancellation',
  timeout: 90_000,
  webServer: [
    {
      command: 'node scripts/cancellation-local-ci-provider.mjs',
      env: { NODE_ENV: 'development', AUTH_TEST_SERVICE_KEY: '' },
      url: 'http://127.0.0.1:3200/__fixture/health',
      reuseExistingServer: false,
    },
    {
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
