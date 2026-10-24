// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { AUTH_PRIVATE_HEADERS, AUTH_CODE_MAX_LENGTH } from '@/config/auth';
import { failure, success } from '@/lib/result';
import type { AuthPort } from '@/server/services/auth/session';
import { callbackGet, loginPost, logoutPost } from '@/server/auth/http';

const { createContext } = vi.hoisted(() => ({ createContext: vi.fn() }));
vi.mock('@/server/auth/context', () => ({ createAuthContext: createContext }));

const origin = 'https://app.example';
const profile = {
  id: 'fixture-subject',
  role: 'fan' as const,
  is_restricted: false,
  restricted_until: null,
  onboarding_completed_at: '2026-10-24T00:00:00Z',
};
let port: AuthPort;
let clearCookies: ReturnType<typeof vi.fn>;

function request(
  path: string,
  method = 'GET',
  requestOrigin: string | null = origin,
) {
  const headers = new Headers({
    host: 'evil.example',
    'x-forwarded-host': 'evil.example',
    'x-forwarded-proto': 'http',
  });
  if (requestOrigin !== null) headers.set('origin', requestOrigin);
  return new NextRequest(`https://poisoned.example${path}`, {
    method,
    headers,
  });
}

beforeEach(() => {
  port = {
    verifySubject: vi.fn().mockResolvedValue(success(null)),
    readProfile: vi.fn().mockResolvedValue(success(profile)),
    beginLogin: vi
      .fn()
      .mockResolvedValue(
        success(
          'https://project.supabase.co/auth/v1/authorize?provider=kakao&code_challenge=fixture&code_challenge_method=s256',
        ),
      ),
    exchangeCode: vi.fn().mockResolvedValue(success(null)),
    signOut: vi.fn().mockResolvedValue(success(null)),
  };
  clearCookies = vi.fn();
  createContext.mockReturnValue({
    configuration: {
      appOrigin: origin,
      supabaseUrl: 'https://project.supabase.co',
      publicKey: 'sb_publishable_fixture',
    },
    port,
    clearCookies,
    apply: (response: NextResponse) => {
      for (const [key, value] of Object.entries(AUTH_PRIVATE_HEADERS))
        response.headers.set(key, value);
      return response;
    },
  });
});

function expectPrivate(response: NextResponse) {
  expect(response.headers.get('cache-control')).toContain('no-store');
  expect(response.headers.get('referrer-policy')).toBe('no-referrer');
}

describe('Kakao login POST controller', () => {
  it.each([null, 'null', 'https://evil.example', 'http://app.example'])(
    'rejects missing/foreign Origin %s without initiating OAuth',
    async (requestOrigin) => {
      const response = await loginPost(
        request('/api/auth/login', 'POST', requestOrigin),
      );
      expect(response.status).toBe(403);
      expect(port.beginLogin).not.toHaveBeenCalled();
      expectPrivate(response);
    },
  );
  it('uses fixed application origin and sanitized return path despite hostile headers', async () => {
    const response = await loginPost(
      request('/api/auth/login?next=https%3A%2F%2Fevil.example', 'POST'),
    );
    expect(response.status).toBe(303);
    expect(port.beginLogin).toHaveBeenCalledWith(
      'https://app.example/api/auth/callback',
    );
    expect(new URL(response.headers.get('location')!).origin).toBe(
      'https://project.supabase.co',
    );
    expectPrivate(response);
  });
  it('does not restart OAuth or bypass role when already logged in', async () => {
    vi.mocked(port.verifySubject).mockResolvedValue(success(profile.id));
    const response = await loginPost(
      request('/api/auth/login?next=%2Fadmin', 'POST'),
    );
    expect(response.headers.get('location')).toBe(`${origin}/`);
    expect(port.beginLogin).not.toHaveBeenCalled();
  });
  it.each([
    'https://evil.example/auth/v1/authorize?provider=kakao',
    'https://project.supabase.co.evil.example/auth/v1/authorize?provider=kakao',
    'https://project.supabase.co/auth/v1/logout?provider=kakao',
    'https://project.supabase.co/auth/v1/authorize?provider=google',
    'not-a-url',
  ])(
    'rejects malformed/untrusted authorize destination %s',
    async (destination) => {
      vi.mocked(port.beginLogin).mockResolvedValue(success(destination));
      const response = await loginPost(request('/api/auth/login', 'POST'));
      expect(response.headers.get('location')).toBe(
        `${origin}/start?reason=login_failed`,
      );
      expectPrivate(response);
    },
  );
  it('returns a fixed error route when the SDK fails', async () => {
    vi.mocked(port.beginLogin).mockResolvedValue(failure('INTERNAL'));
    const response = await loginPost(request('/api/auth/login', 'POST'));
    expect(response.headers.get('location')).toBe(
      `${origin}/start?reason=login_failed`,
    );
  });
});

describe('PKCE callback controller', () => {
  it.each([
    '',
    '?code=',
    '?code=a&code=b',
    '?code=a&error=denied&error_description=private-provider-text',
    '?code=%0Asecret',
    '?code=token.secret',
    `?code=${'a'.repeat(AUTH_CODE_MAX_LENGTH + 1)}`,
  ])(
    'rejects malformed/ambiguous callback %s without code exchange or reflected secrets',
    async (query) => {
      const response = await callbackGet(request(`/api/auth/callback${query}`));
      expect(response.headers.get('location')).toBe(
        `${origin}/start?reason=callback_failed`,
      );
      expect(port.exchangeCode).not.toHaveBeenCalled();
      expect(clearCookies).toHaveBeenCalledWith(false);
      expect(await response.text()).toBe('');
      expectPrivate(response);
    },
  );
  it('consumes verifier but preserves existing session on invalid/replayed code', async () => {
    vi.mocked(port.exchangeCode).mockResolvedValue(failure('UNAUTHENTICATED'));
    const response = await callbackGet(
      request('/api/auth/callback?code=replayed-code&next=%2Fadmin'),
    );
    expect(response.headers.get('location')).toBe(
      `${origin}/start?reason=callback_failed`,
    );
    expect(clearCookies).toHaveBeenCalledExactlyOnceWith(false);
    expect(port.verifySubject).not.toHaveBeenCalled();
  });
  it('checks actual profile authority after exchange before using return path', async () => {
    vi.mocked(port.verifySubject).mockResolvedValue(success(profile.id));
    const response = await callbackGet(
      request('/api/auth/callback?code=fixture-code&next=%2Fadmin'),
    );
    expect(response.headers.get('location')).toBe(`${origin}/`);
    expect(clearCookies).toHaveBeenCalledWith(false);
    expect(port.exchangeCode).toHaveBeenCalledWith('fixture-code');
  });
  it('does not accept unverified/missing profile even after SDK exchange succeeds', async () => {
    vi.mocked(port.verifySubject).mockResolvedValue(success(profile.id));
    vi.mocked(port.readProfile).mockResolvedValue(failure('INTERNAL'));
    const response = await callbackGet(
      request('/api/auth/callback?code=fixture-code'),
    );
    expect(response.headers.get('location')).toBe(
      `${origin}/start?reason=callback_failed`,
    );
  });
});

describe('logout POST controller', () => {
  it.each([null, 'null', 'https://evil.example'])(
    'rejects CSRF Origin %s without clearing cookies',
    async (requestOrigin) => {
      const response = await logoutPost(
        request('/api/auth/logout', 'POST', requestOrigin),
      );
      expect(response.status).toBe(403);
      expect(port.signOut).not.toHaveBeenCalled();
      expect(clearCookies).not.toHaveBeenCalled();
    },
  );
  it('supports repeated logout and always clears stale local cookies', async () => {
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await logoutPost(request('/api/auth/logout', 'POST'));
      expect(response.status).toBe(303);
      expect(response.headers.get('location')).toBe(
        `${origin}/start?reason=signed_out`,
      );
      expectPrivate(response);
    }
    expect(port.signOut).toHaveBeenCalledTimes(2);
    expect(clearCookies).toHaveBeenCalledTimes(2);
  });
  it('clears local cookies but does not claim remote revocation on SDK failure', async () => {
    vi.mocked(port.signOut).mockResolvedValue(failure('INTERNAL'));
    const response = await logoutPost(request('/api/auth/logout', 'POST'));
    expect(clearCookies).toHaveBeenCalledOnce();
    expect(response.headers.get('location')).toBe(
      `${origin}/start?reason=logout_incomplete`,
    );
  });
});
