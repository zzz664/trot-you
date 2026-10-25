import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  testIgnore: [
    '**/authenticated/**',
    '**/enrollment/**',
    '**/renewal/**',
    '**/cancellation/**',
    '**/reconciliation/**',
    '**/media/**',
    '**/chat/**',
    '**/replies/**',
    '**/speech/**',
    '**/compose/**',
    '**/dispatch/**',
    '**/activity/**',
    '**/webpush/**',
  ],
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:3100',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
      : {},
  },
  webServer: {
    env: { UI_PREVIEW_ENABLED: 'true' },
    command: 'npm run start -- --hostname 127.0.0.1 --port 3100',
    url: 'http://127.0.0.1:3100',
    reuseExistingServer: false,
  },
});
