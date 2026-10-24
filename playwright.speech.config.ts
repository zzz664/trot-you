import { defineConfig } from '@playwright/test';

if (
  process.env.CI !== 'true' ||
  process.env.GITHUB_ACTIONS !== 'true' ||
  process.env.AUTH_LOCAL_E2E !== 'true' ||
  process.env.REPLY_LOCAL_E2E !== 'true' ||
  process.env.SPEECH_LOCAL_E2E !== 'true' ||
  process.env.NEXT_PUBLIC_APP_URL !== 'http://127.0.0.1:3100' ||
  process.env.NEXT_PUBLIC_SUPABASE_URL !== 'http://127.0.0.1:54321'
)
  throw new Error('Run speech tests only in the isolated local CI job.');

export default defineConfig({
  testDir: './tests/e2e/speech',
  fullyParallel: false,
  workers: 1,
  forbidOnly: true,
  retries: 0,
  timeout: 90_000,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:3100',
    // Fictional text and sessions must not enter traces. Speech is a controlled
    // API-contract stub, never a real microphone, browser grant or provider.
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
