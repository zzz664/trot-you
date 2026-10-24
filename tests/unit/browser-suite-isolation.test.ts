// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
vi.mock('@playwright/test', () => ({ defineConfig: <T>(config: T) => config }));
import configuration from '../../playwright.config';

describe('keyless browser suite cannot collect isolated integration fixtures', () => {
  it.each([
    'authenticated',
    'enrollment',
    'renewal',
    'cancellation',
    'reconciliation',
    'media',
    'chat',
    'replies',
    'speech',
  ])('excludes %s from the ordinary production-build suite', (name) => {
    expect(configuration.testIgnore).toContain(`**/${name}/**`);
  });
  it('keeps the keyless suite rooted at the shared e2e directory', () => {
    expect(configuration.testDir).toBe('./tests/e2e');
  });
});
