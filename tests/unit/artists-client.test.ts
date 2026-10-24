// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { submitArtistSelection } from '@/client/artists';
import { ARTIST_REQUEST_TIMEOUT_MS } from '@/config/artists';
import { routes } from '@/config/routes';

afterEach(() => vi.unstubAllGlobals());

describe('same-origin artist interest transport', () => {
  it('sends only the selected slug and accepts only the install handoff', async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, next: routes.onboardingInstall }),
    });
    vi.stubGlobal('fetch', fetch);
    expect(await submitArtistSelection({ slug: 'fictional-star' })).toEqual({
      ok: true,
      next: routes.onboardingInstall,
    });
    expect(fetch).toHaveBeenCalledWith(
      routes.artistSelectionSubmit,
      expect.objectContaining({
        method: 'POST',
        credentials: 'same-origin',
        redirect: 'error',
        cache: 'no-store',
        body: JSON.stringify({ slug: 'fictional-star' }),
        signal: expect.any(AbortSignal),
      }),
    );
    expect(ARTIST_REQUEST_TIMEOUT_MS).toBeGreaterThan(0);
  });

  it.each([
    '',
    '../admin',
    'https://evil.example',
    'javascript:alert(1)',
    'fictional?actor=other',
  ])('rejects invalid slug %s before transport', async (slug) => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    expect(await submitArtistSelection({ slug })).toEqual({
      ok: false,
      code: 'INVALID_INPUT',
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects unexpected caller identity or payment fields', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const payload = { slug: 'fictional-star', actorId: 'other', paid: true };
    expect(await submitArtistSelection(payload)).toEqual({
      ok: false,
      code: 'INVALID_INPUT',
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    'https://evil.example',
    'javascript:alert(1)',
    '//evil.example',
    routes.home,
    routes.admin,
    routes.onboardingArtists,
    `${routes.onboardingInstall}?complete=true`,
  ])('never follows unexpected successful next path %s', async (next) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ ok: true, next }),
      }),
    );
    expect(await submitArtistSelection({ slug: 'fictional-star' })).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
    });
  });

  it('strips raw backend details from controlled errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({
          ok: false,
          code: 'NOT_FOUND',
          message: 'private SQL path',
        }),
      }),
    );
    expect(await submitArtistSelection({ slug: 'fictional-star' })).toEqual({
      ok: false,
      code: 'NOT_FOUND',
    });
  });

  it.each([
    { ok: false, code: 'PRIVATE_SQL_ERROR' },
    { ok: true, next: routes.onboardingInstall },
    null,
  ])(
    'does not manufacture success from a failed HTTP response',
    async (body) => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({ ok: false, json: async () => body }),
      );
      expect(await submitArtistSelection({ slug: 'fictional-star' })).toEqual({
        ok: false,
        code: 'UNAVAILABLE',
      });
    },
  );

  it('treats timeout and malformed JSON as uncertain results', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('timeout')));
    expect(await submitArtistSelection({ slug: 'fictional-star' })).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => {
          throw new Error('invalid');
        },
      }),
    );
    expect(await submitArtistSelection({ slug: 'fictional-star' })).toEqual({
      ok: false,
      code: 'UNAVAILABLE',
    });
  });
});
