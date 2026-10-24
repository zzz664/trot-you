// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

vi.mock('@playwright/test', () => ({ defineConfig: <T>(value: T) => value }));
const environment = {
  CI: 'true',
  GITHUB_ACTIONS: 'true',
  AUTH_LOCAL_E2E: 'true',
  REPLY_LOCAL_E2E: 'true',
  SPEECH_LOCAL_E2E: 'true',
  NEXT_PUBLIC_APP_URL: 'http://127.0.0.1:3100',
  NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
};
beforeEach(() => {
  vi.resetModules();
  for (const [key, value] of Object.entries(environment))
    vi.stubEnv(key, value);
});
afterEach(() => vi.unstubAllEnvs());

describe('simulated speech browser suite isolation', () => {
  it('requires the dedicated loopback configuration without trace audio or microphone permissions', async () => {
    const { default: config } = await import('../../playwright.speech.config');
    expect(config.testDir).toBe('./tests/e2e/speech');
    expect(config.workers).toBe(1);
    expect(config.retries).toBe(0);
    expect(config.use?.trace).toBe('off');
    expect(config.use?.permissions).toBeUndefined();
    expect(config.webServer).toMatchObject({
      reuseExistingServer: false,
      env: { AUTH_TEST_SERVICE_KEY: '' },
    });
  });
  it.each(Object.keys(environment))(
    'rejects missing %s before collection',
    async (key) => {
      vi.stubEnv(key, undefined);
      await expect(import('../../playwright.speech.config')).rejects.toThrow(
        'isolated local CI',
      );
    },
  );
  it.each(['NEXT_PUBLIC_APP_URL', 'NEXT_PUBLIC_SUPABASE_URL'])(
    'rejects hosted %s',
    async (key) => {
      vi.stubEnv(key, 'https://hosted.example.invalid');
      await expect(import('../../playwright.speech.config')).rejects.toThrow(
        'isolated local CI',
      );
    },
  );
  it('keeps browser fixtures free from app server and runtime JSON imports', () => {
    const fixtures = readFileSync('tests/e2e/speech/recognition.ts', 'utf8');
    const spec = readFileSync('tests/e2e/speech/speech.spec.ts', 'utf8');
    expect(fixtures).not.toMatch(/from ['"](?:next|.*env\.server|.*server\/)/);
    expect(spec).not.toMatch(/import\s+\w+\s+from ['"].*ko\.json/);
    expect(fixtures).not.toMatch(
      /grantPermissions\(|getUserMedia\(|MediaRecorder\(/,
    );
  });
});
