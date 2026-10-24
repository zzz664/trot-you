// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

vi.mock('@playwright/test', () => ({ defineConfig: <T>(value: T) => value }));
const environment = {
  CI: 'true',
  GITHUB_ACTIONS: 'true',
  AUTH_LOCAL_E2E: 'true',
  REPLY_LOCAL_E2E: 'true',
  NEXT_PUBLIC_APP_URL: 'http://127.0.0.1:3100',
  NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
};
beforeEach(() => {
  vi.resetModules();
  for (const [key, value] of Object.entries(environment))
    vi.stubEnv(key, value);
});
afterEach(() => vi.unstubAllEnvs());

describe('reply integration suite isolation', () => {
  it('requires the dedicated guarded loopback CI configuration', async () => {
    const { default: config } = await import('../../playwright.replies.config');
    expect(config.testDir).toBe('./tests/e2e/replies');
    expect(config.workers).toBe(1);
    expect(config.retries).toBe(0);
    expect(config.use?.trace).toBe('off');
    expect(config.webServer).toMatchObject({
      reuseExistingServer: false,
      env: { AUTH_TEST_SERVICE_KEY: '' },
    });
  });
  it.each(Object.keys(environment))(
    'rejects missing %s before fixture collection',
    async (key) => {
      vi.stubEnv(key, undefined);
      await expect(import('../../playwright.replies.config')).rejects.toThrow(
        'isolated local CI',
      );
    },
  );
  it.each(['NEXT_PUBLIC_APP_URL', 'NEXT_PUBLIC_SUPABASE_URL'])(
    'rejects nonlocal %s',
    async (key) => {
      vi.stubEnv(key, 'https://hosted.example.invalid');
      await expect(import('../../playwright.replies.config')).rejects.toThrow(
        'isolated local CI',
      );
    },
  );
  it('keeps browser support independent of app runtime JSON/Next imports', () => {
    const fixtures = readFileSync('tests/e2e/replies/fixtures.ts', 'utf8');
    const spec = readFileSync('tests/e2e/replies/replies.spec.ts', 'utf8');
    expect(fixtures).not.toMatch(/from ['"](?:next|.*env\.server|.*server\/)/);
    expect(spec).not.toMatch(/import\s+\w+\s+from ['"].*ko\.json/);
  });
});
