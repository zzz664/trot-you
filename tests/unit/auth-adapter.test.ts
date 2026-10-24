// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthSessionMissingError } from '@supabase/supabase-js';
import { failure, success } from '@/lib/result';
import { createAuthPort } from '@/server/adapters/auth/supabase';
import type { ActorClient } from '@/server/db/client';
import { readAuthProfile, type AuthProfile } from '@/server/db/auth-profile';

vi.mock('@/server/db/auth-profile', () => ({ readAuthProfile: vi.fn() }));

const profile: AuthProfile = {
  id: 'verified-subject',
  role: 'fan',
  is_restricted: false,
  restricted_until: null,
  onboarding_completed_at: null,
};
const providerFailure = new Error(
  'private token and provider payload must not leak',
);
const auth = {
  getClaims: vi.fn(),
  getUser: vi.fn(),
  getSession: vi.fn(),
  signInWithOAuth: vi.fn(),
  exchangeCodeForSession: vi.fn(),
  signOut: vi.fn(),
};
const client = { auth } as unknown as ActorClient;

beforeEach(() => {
  vi.clearAllMocks();
  auth.getClaims.mockResolvedValue({
    data: { claims: { sub: profile.id, user_metadata: { role: 'admin' } } },
    error: null,
  });
  auth.getUser.mockResolvedValue({
    data: { user: { id: profile.id } },
    error: null,
  });
  auth.signInWithOAuth.mockResolvedValue({
    data: {
      url: 'https://project.supabase.co/auth/v1/authorize?provider=kakao',
    },
    error: null,
  });
  auth.exchangeCodeForSession.mockResolvedValue({ data: {}, error: null });
  auth.signOut.mockResolvedValue({ error: null });
  vi.mocked(readAuthProfile).mockResolvedValue({
    success: true,
    data: profile,
    error: null,
    count: null,
    status: 200,
    statusText: 'OK',
  });
});

describe('Supabase authentication adapter trust boundary', () => {
  it('checks verified claims and current Auth user, never cookie getSession or editable role metadata', async () => {
    expect(await createAuthPort(client).verifySubject()).toEqual(
      success(profile.id),
    );
    expect(auth.getClaims).toHaveBeenCalledOnce();
    expect(auth.getUser).toHaveBeenCalledOnce();
    expect(auth.getSession).not.toHaveBeenCalled();
  });
  it('treats missing session as anonymous without reading user', async () => {
    auth.getClaims.mockResolvedValue({
      data: null,
      error: new AuthSessionMissingError(),
    });
    expect(await createAuthPort(client).verifySubject()).toEqual(success(null));
    expect(auth.getUser).not.toHaveBeenCalled();
  });
  it('treats absent claims as anonymous without reading user', async () => {
    auth.getClaims.mockResolvedValue({ data: null, error: null });
    expect(await createAuthPort(client).verifySubject()).toEqual(success(null));
    expect(auth.getUser).not.toHaveBeenCalled();
  });
  it.each([
    'claims-error',
    'claims-throw',
    'user-error',
    'user-throw',
    'subject-mismatch',
    'missing-user',
  ])(
    'fails closed for %s with no private error disclosure',
    async (scenario) => {
      if (scenario === 'claims-error')
        auth.getClaims.mockResolvedValue({
          data: null,
          error: providerFailure,
        });
      if (scenario === 'claims-throw')
        auth.getClaims.mockRejectedValue(providerFailure);
      if (scenario === 'user-error')
        auth.getUser.mockResolvedValue({
          data: { user: null },
          error: providerFailure,
        });
      if (scenario === 'user-throw')
        auth.getUser.mockRejectedValue(providerFailure);
      if (scenario === 'subject-mismatch')
        auth.getUser.mockResolvedValue({
          data: { user: { id: 'someone-else' } },
          error: null,
        });
      if (scenario === 'missing-user')
        auth.getUser.mockResolvedValue({ data: { user: null }, error: null });
      const result = await createAuthPort(client).verifySubject();
      expect(result).toEqual(failure('INTERNAL'));
      expect(JSON.stringify(result)).not.toContain('private token');
    },
  );
  it('queries profile with the verified actor subject', async () => {
    expect(await createAuthPort(client).readProfile(profile.id)).toEqual(
      success(profile),
    );
    expect(readAuthProfile).toHaveBeenCalledWith(client, profile.id);
  });
  it('normalizes failed profile reads to a fixed error', async () => {
    vi.mocked(readAuthProfile).mockRejectedValue(providerFailure);
    expect(await createAuthPort(client).readProfile(profile.id)).toEqual(
      failure('INTERNAL'),
    );
  });
  it('uses actual Kakao OAuth with PKCE callback and no browser auto-redirect', async () => {
    const callback = 'https://app.example/api/auth/callback?next=%2F';
    const result = await createAuthPort(client).beginLogin(callback);
    expect(result.ok).toBe(true);
    expect(auth.signInWithOAuth).toHaveBeenCalledExactlyOnceWith({
      provider: 'kakao',
      options: { redirectTo: callback, skipBrowserRedirect: true },
    });
  });
  it('exchanges code through SDK and requests local-session signout only', async () => {
    const port = createAuthPort(client);
    expect(await port.exchangeCode('fixture-code')).toEqual(success(null));
    expect(auth.exchangeCodeForSession).toHaveBeenCalledWith('fixture-code');
    expect(await port.signOut()).toEqual(success(null));
    expect(auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
  });
  it.each(['returned', 'thrown'])(
    'normalizes SDK failures (%s) without reflecting provider response',
    async (mode) => {
      for (const mock of [
        auth.signInWithOAuth,
        auth.exchangeCodeForSession,
        auth.signOut,
      ]) {
        if (mode === 'thrown') mock.mockRejectedValue(providerFailure);
        else mock.mockResolvedValue({ data: {}, error: providerFailure });
      }
      const port = createAuthPort(client);
      expect(
        await port.beginLogin('https://app.example/api/auth/callback'),
      ).toEqual(failure('INTERNAL'));
      expect(await port.exchangeCode('fixture-code')).toEqual(
        failure('UNAUTHENTICATED'),
      );
      expect(await port.signOut()).toEqual(failure('INTERNAL'));
    },
  );
});
