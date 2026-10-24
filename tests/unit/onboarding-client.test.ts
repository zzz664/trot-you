// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { submitOnboarding } from '@/client/onboarding';
import { routes } from '@/config/routes';
import { ONBOARDING_REQUEST_TIMEOUT_MS } from '@/config/onboarding';
afterEach(() => vi.unstubAllGlobals());
describe('same-origin onboarding transport', () => {
  it('sends only explicit payload and validates next route', async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, next: routes.onboardingName }),
    });
    vi.stubGlobal('fetch', fetch);
    expect(
      await submitOnboarding({ step: 'font', fontScale: 'normal' }),
    ).toEqual({ ok: true, next: routes.onboardingName });
    expect(fetch).toHaveBeenCalledWith(
      routes.onboardingSubmit,
      expect.objectContaining({
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        redirect: 'error',
        body: JSON.stringify({ step: 'font', fontScale: 'normal' }),
      }),
    );
    expect(ONBOARDING_REQUEST_TIMEOUT_MS).toBeGreaterThan(0);
  });
  it.each([
    'https://evil.example',
    'javascript:alert(1)',
    '//evil.example',
    '/admin',
    '/onboarding/name?x=1',
  ])('rejects unlisted navigation %s', async (next) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ ok: true, next }),
      }),
    );
    expect(
      await submitOnboarding({ step: 'font', fontScale: 'large' }),
    ).toEqual({ ok: false, code: 'UNAVAILABLE' });
  });
  it('surfaces controlled errors without raw server text', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({
          ok: false,
          code: 'NAME_FORBIDDEN',
          message: 'private SQL',
        }),
      }),
    );
    expect(await submitOnboarding({ step: 'name', callName: '별님' })).toEqual({
      ok: false,
      code: 'NAME_FORBIDDEN',
    });
  });
  it('fails safely when response is uncertain or unexpected', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('timeout')));
    expect(
      await submitOnboarding({ step: 'font', fontScale: 'large' }),
    ).toEqual({ ok: false, code: 'UNAVAILABLE' });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ ok: false, code: 'SQL_LEAK' }),
      }),
    );
    expect(
      await submitOnboarding({ step: 'font', fontScale: 'large' }),
    ).toEqual({ ok: false, code: 'UNAVAILABLE' });
  });
});
