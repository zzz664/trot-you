// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';
import type { CookieMethodsServer } from '@supabase/ssr';
import { createAuthContext } from '@/server/auth/context';
import { authCookieName, authCookieOptions } from '@/server/db/client';

const { createClient, configuration, createPort } = vi.hoisted(() => ({
  createClient: vi.fn(),
  configuration: vi.fn(),
  createPort: vi.fn(),
}));
vi.mock('@/server/auth/configuration', () => ({
  getAuthConfiguration: configuration,
}));
vi.mock('@/server/db/client', async (original) => ({
  ...(await original<typeof import('@/server/db/client')>()),
  createActorClient: createClient,
}));
vi.mock('@/server/adapters/auth/supabase', () => ({
  createAuthPort: createPort,
}));

const config = {
  appOrigin: 'https://app.example',
  supabaseUrl: 'https://project.supabase.co',
  publicKey: 'sb_publishable_fixture',
};
const base = '__Host-sb-project-auth-token';
let sdkCookies: CookieMethodsServer;

beforeEach(() => {
  configuration.mockReturnValue(config);
  createClient.mockImplementation((_config, cookies: CookieMethodsServer) => {
    sdkCookies = cookies;
    return { fictionalClient: true };
  });
  createPort.mockReturnValue({ fictionalPort: true });
});

describe('server-owned auth cookie transport', () => {
  it('uses HTTPOnly, host-only, Lax, root-path cookies and Secure in HTTPS', () => {
    expect(authCookieName(config)).toBe(base);
    expect(authCookieOptions(config)).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
    });
    expect(authCookieOptions(config)).not.toHaveProperty('domain');
    expect(
      authCookieName({ ...config, appOrigin: 'http://127.0.0.1:3100' }),
    ).toBe('sb-project-auth-token');
    expect(
      authCookieOptions({ ...config, appOrigin: 'http://127.0.0.1:3100' })
        .secure,
    ).toBe(false);
  });
  it('preserves every SDK cookie and first-write cache header across multiple writes and redirect creation', async () => {
    const forwarded = vi.fn();
    const context = createAuthContext(
      [{ name: 'font-scale', value: 'large' }],
      forwarded,
    );
    const options = authCookieOptions(config);
    await sdkCookies.setAll?.(
      [
        { name: `${base}.0`, value: 'first-chunk', options },
        { name: `${base}.1`, value: 'second-chunk', options },
      ],
      {
        'Cache-Control': 'private, no-store',
        Expires: '0',
        Pragma: 'no-cache',
      },
    );
    await sdkCookies.setAll?.(
      [{ name: `${base}.0`, value: 'updated-first', options }],
      {},
    );
    const response = context.apply(
      NextResponse.redirect('https://app.example/onboarding', 303),
    );
    expect(response.cookies.get(`${base}.0`)?.value).toBe('updated-first');
    expect(response.cookies.get(`${base}.1`)?.value).toBe('second-chunk');
    for (const cookie of response.cookies.getAll()) {
      expect(cookie).toMatchObject({
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        path: '/',
      });
      expect(cookie).not.toHaveProperty('domain');
    }
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('pragma')).toBe('no-cache');
    expect(response.headers.get('expires')).toBe('0');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(response.headers.get('location')).toBe(
      'https://app.example/onboarding',
    );
    expect(forwarded).toHaveBeenCalledTimes(3);
    expect(await sdkCookies.getAll()).toEqual(
      expect.arrayContaining([
        { name: `${base}.0`, value: 'updated-first' },
        { name: `${base}.1`, value: 'second-chunk' },
        { name: 'font-scale', value: 'large' },
      ]),
    );
  });
  it('consumes only verifier cookies on failed callback, preserving an unrelated current session', () => {
    const context = createAuthContext([
      { name: `${base}.0`, value: 'current-session' },
      { name: `${base}-code-verifier`, value: 'verifier' },
      { name: `${base}-code-verifier.0`, value: 'chunked-verifier' },
      { name: `${base}-flows-code-verifier`, value: 'flow-index' },
      { name: `${base}-flows-code-verifier.1`, value: 'index-chunk' },
      { name: `${base}-flow-12345678-code-verifier`, value: 'orphan-slot' },
      {
        name: `${base}-flow-${'x'.repeat(64)}-code-verifier.0`,
        value: 'slot-chunk',
      },
      { name: `${base}-flow-short-code-verifier`, value: 'unrelated-short' },
      {
        name: `${base}-flow-${'x'.repeat(65)}-code-verifier`,
        value: 'unrelated-long',
      },
      {
        name: `${base}-flow-12345678-code-verifier.other`,
        value: 'unrelated-suffix',
      },
      {
        name: `sb-other-auth-token-flow-12345678-code-verifier`,
        value: 'other-project',
      },
      { name: `${base}-code-verifier.other`, value: 'unrelated-cookie' },
      { name: 'font-scale', value: 'large' },
    ]);
    context.clearCookies(false);
    const response = context.apply(NextResponse.json({ ok: false }));
    expect(response.cookies.get(`${base}.0`)).toBeUndefined();
    expect(response.cookies.get(`${base}-code-verifier`)?.maxAge).toBe(0);
    expect(response.cookies.get(`${base}-code-verifier.0`)?.maxAge).toBe(0);
    for (const suffix of [
      '-flows-code-verifier',
      '-flows-code-verifier.1',
      '-flow-12345678-code-verifier',
      `-flow-${'x'.repeat(64)}-code-verifier.0`,
    ]) {
      expect(response.cookies.get(`${base}${suffix}`)?.maxAge).toBe(0);
    }
    for (const suffix of [
      '-flow-short-code-verifier',
      `-flow-${'x'.repeat(65)}-code-verifier`,
      '-flow-12345678-code-verifier.other',
    ]) {
      expect(response.cookies.get(`${base}${suffix}`)).toBeUndefined();
    }
    expect(
      response.cookies.get('sb-other-auth-token-flow-12345678-code-verifier'),
    ).toBeUndefined();
    for (const cookie of response.cookies.getAll()) {
      expect(cookie).toMatchObject({
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        path: '/',
      });
      expect(cookie).not.toHaveProperty('domain');
    }
    expect(response.cookies.get(`${base}-code-verifier.other`)).toBeUndefined();
    expect(response.cookies.get('font-scale')).toBeUndefined();
  });
  it('clears the session and all numeric chunks on logout without touching other projects or preferences', () => {
    const context = createAuthContext([
      { name: base, value: 'token' },
      { name: `${base}.0`, value: 'chunk0' },
      { name: `${base}.12`, value: 'chunk12' },
      { name: `${base}-code-verifier.1`, value: 'verifier' },
      { name: `${base}-flow-12345678-code-verifier.1`, value: 'orphaned-slot' },
      { name: `${base}.not-a-chunk`, value: 'unrelated' },
      { name: 'sb-other-auth-token.0', value: 'other-project' },
      { name: 'font-scale', value: 'large' },
    ]);
    context.clearCookies();
    context.clearCookies();
    const response = context.apply(NextResponse.json({ ok: true }));
    for (const name of [
      base,
      `${base}.0`,
      `${base}.12`,
      `${base}-code-verifier`,
      `${base}-code-verifier.1`,
      `${base}-flows-code-verifier`,
      `${base}-flow-12345678-code-verifier.1`,
    ]) {
      expect(response.cookies.get(name)).toMatchObject({
        value: '',
        maxAge: 0,
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        path: '/',
      });
      expect(response.cookies.get(name)).not.toHaveProperty('domain');
    }
    for (const name of [
      `${base}.not-a-chunk`,
      'sb-other-auth-token.0',
      'font-scale',
    ]) {
      expect(response.cookies.get(name)).toBeUndefined();
    }
  });
  it('keeps request clients isolated and never leaks previous actor cookie state', async () => {
    const first = createAuthContext([{ name: base, value: 'actor-one' }]);
    const firstCookies = sdkCookies;
    const second = createAuthContext([{ name: base, value: 'actor-two' }]);
    first.clearCookies();
    expect(await firstCookies.getAll()).toEqual(
      expect.arrayContaining([{ name: base, value: '' }]),
    );
    expect(await sdkCookies.getAll()).toEqual([
      { name: base, value: 'actor-two' },
    ]);
    expect(second.apply(NextResponse.json({})).cookies.getAll()).toEqual([]);
  });
  it('does not construct an SDK client when configuration is missing, and still disables caching', () => {
    configuration.mockReturnValue(null);
    createClient.mockClear();
    const context = createAuthContext([{ name: 'font-scale', value: 'large' }]);
    expect(context.port).toBeNull();
    expect(createClient).not.toHaveBeenCalled();
    context.clearCookies();
    const response = context.apply(NextResponse.json({}));
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(response.cookies.getAll()).toEqual([]);
  });
});
