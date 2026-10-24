import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { submitInstall } from '@/client/install';
import {
  INSTALL_CHOICES,
  INSTALL_ERROR_STATUS,
  installInputSchema,
  type InstallInput,
} from '@/config/install';
import { routes } from '@/config/routes';

const fetchMock = vi.fn();
beforeEach(() => vi.stubGlobal('fetch', fetchMock));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

describe('install choice transport', () => {
  it.each(INSTALL_CHOICES)(
    'sends the explicit %s choice only',
    async (choice) => {
      fetchMock.mockResolvedValue(
        Response.json({ ok: true, next: routes.onboardingInstall }),
      );
      expect(await submitInstall({ action: 'acknowledge', choice })).toEqual({
        ok: true,
        next: routes.onboardingInstall,
      });
      expect(fetchMock).toHaveBeenCalledWith(
        routes.installSubmit,
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          cache: 'no-store',
          redirect: 'error',
          body: JSON.stringify({ action: 'acknowledge', choice }),
          signal: expect.any(AbortSignal),
        }),
      );
    },
  );

  it('accepts completion only from a successful response to complete', async () => {
    fetchMock.mockResolvedValue(Response.json({ ok: true, next: routes.home }));
    expect(await submitInstall({ action: 'complete' })).toEqual({
      ok: true,
      next: routes.home,
    });
    expect(
      await submitInstall({ action: 'acknowledge', choice: 'acknowledged' }),
    ).toEqual({ ok: false, code: 'UNAVAILABLE' });
  });

  it.each([
    { action: 'complete', userId: 'other' },
    { action: 'complete', role: 'admin' },
    { action: 'complete', completedAt: 'today' },
    { action: 'acknowledge', choice: 'installed' },
    { action: 'acknowledge', choice: 'acknowledged', permission: 'granted' },
    { action: 'acknowledge', choice: 'skipped', installed: true },
    { action: 'acknowledge' },
    {},
  ])('rejects untrusted extra or invalid fields %j', async (input) => {
    expect(installInputSchema.safeParse(input).success).toBe(false);
    expect(await submitInstall(input as InstallInput)).toEqual({
      ok: false,
      code: 'INVALID_INPUT',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(Object.keys(INSTALL_ERROR_STATUS))(
    'returns allowlisted error %s without response details',
    async (code) => {
      fetchMock.mockResolvedValue(
        Response.json(
          { ok: false, code, privateDetail: 'not exposed' },
          { status: 409 },
        ),
      );
      expect(await submitInstall({ action: 'complete' })).toEqual({
        ok: false,
        code,
      });
    },
  );

  it.each([
    { ok: true, next: 'https://other.test' },
    { ok: true, next: '//other.test' },
    { ok: true, next: routes.onboardingInstall },
    { ok: true },
    { ok: false, code: 'PRIVATE_DATABASE_ERROR' },
    null,
    'complete',
  ])(
    'does not navigate based on invalid complete response %j',
    async (body) => {
      fetchMock.mockResolvedValue(Response.json(body));
      expect(await submitInstall({ action: 'complete' })).toEqual({
        ok: false,
        code: 'UNAVAILABLE',
      });
    },
  );

  it('rejects a success body on a failed HTTP status', async () => {
    fetchMock.mockResolvedValue(
      Response.json({ ok: true, next: routes.home }, { status: 503 }),
    );
    expect(await submitInstall({ action: 'complete' })).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
    });
  });
  it.each(['network', 'json'] as const)(
    'keeps %s failure uncertain',
    async (kind) => {
      if (kind === 'network')
        fetchMock.mockRejectedValue(new Error('private error'));
      else
        fetchMock.mockResolvedValue(new Response('<html>private error</html>'));
      expect(await submitInstall({ action: 'complete' })).toEqual({
        ok: false,
        code: 'UNAVAILABLE',
      });
    },
  );
});
