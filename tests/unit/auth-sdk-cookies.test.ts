// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';
import { createAuthContext } from '@/server/auth/context';
import { authCookieName } from '@/server/db/client';

const configuration = {
  appOrigin: 'https://app.example',
  supabaseUrl: 'https://project.supabase.co',
  publicKey: 'sb_publishable_fixture',
};
vi.mock('@/server/auth/configuration', () => ({
  getAuthConfiguration: () => configuration,
}));
afterEach(() => vi.restoreAllMocks());

describe('installed SSR/Auth SDK PKCE cookie lifecycle (no external I/O)', () => {
  it('clears actual fixed, per-flow and index cookies across repeated login attempts', async () => {
    const network = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('Network is forbidden in this unit test'));
    const base = authCookieName(configuration);
    let previous: { name: string; value: string }[] = [];
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const context = createAuthContext(previous);
      context.clearCookies(false);
      const result = await context.client!.auth.signInWithOAuth({
        provider: 'kakao',
        options: {
          redirectTo: 'https://app.example/api/auth/callback',
          skipBrowserRedirect: true,
        },
      });
      expect(result.error).toBeNull();
      const active = context
        .apply(NextResponse.json({}))
        .cookies.getAll()
        .filter((cookie) => cookie.maxAge !== 0);
      const names = active.map((cookie) => cookie.name);
      expect(names).toContain(`${base}-code-verifier`);
      expect(names).toContain(`${base}-flows-code-verifier`);
      expect(
        names.filter((name) => name.startsWith(`${base}-flow-`)),
      ).toHaveLength(1);
      expect(
        active.every(
          (cookie) =>
            cookie.httpOnly &&
            cookie.secure &&
            cookie.path === '/' &&
            cookie.sameSite === 'lax' &&
            !cookie.domain,
        ),
      ).toBe(true);
      previous = active.map(({ name, value }) => ({ name, value }));
      // The callback context reads exactly what the real SDK gave the browser.
      const callback = createAuthContext([
        ...previous,
        { name: `${base}.0`, value: 'existing-session-not-read' },
      ]);
      callback.clearCookies(false);
      const cleared = callback.apply(NextResponse.json({})).cookies;
      for (const name of names) expect(cleared.get(name)?.maxAge).toBe(0);
      expect(cleared.get(`${base}.0`)).toBeUndefined();
    }
    expect(network).not.toHaveBeenCalled();
  });
});
