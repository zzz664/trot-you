// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { routes } from '@/config/routes';
import { failure, success } from '@/lib/result';
import type { AuthProfile } from '@/server/db/auth-profile';
import {
  authorizedReturnPath,
  isRestricted,
  isSameOriginPost,
  landingPath,
  pageRedirect,
  safeReturnPath,
} from '@/server/services/auth/access';
import {
  completeLogin,
  readSession,
  type AuthPort,
} from '@/server/services/auth/session';

const profile: AuthProfile = {
  id: 'fictional-subject',
  role: 'fan',
  onboarding_completed_at: '2026-10-24T00:00:00Z',
  is_restricted: false,
  restricted_until: null,
};
const now = Date.parse('2026-10-24T12:00:00Z');

function port(): AuthPort {
  return {
    verifySubject: vi.fn().mockResolvedValue(success(profile.id)),
    readProfile: vi.fn().mockResolvedValue(success(profile)),
    beginLogin: vi.fn(),
    exchangeCode: vi.fn().mockResolvedValue(success(null)),
    signOut: vi.fn().mockResolvedValue(success(null)),
  };
}

describe('strict auth return paths and POST origins', () => {
  it.each(['/', '/artist', '/admin', '/onboarding'])(
    'allows only the exact known return path %s',
    (path) => expect(safeReturnPath(path)).toBe(path),
  );
  it.each([
    undefined,
    null,
    1,
    ['/admin'],
    {},
    '',
    'https://evil.example',
    '//evil.example',
    '/\\evil.example',
    '\\evil.example',
    '/%2f%2fevil.example',
    '/admin?next=https://evil.example',
    '/admin#fragment',
    '/admin/',
    '/artist/compose',
    '/start',
    '/restricted',
    '/api/auth/logout',
    '/ADMIN',
    ' /admin',
    '/admin\n',
    '/./admin',
    '/onboarding/../admin',
    'javascript:alert(1)',
  ])('rejects unlisted or ambiguous value %j', (value) => {
    expect(safeReturnPath(value)).toBe(routes.home);
  });
  it('accepts the configured origin exactly, never a host suffix', () => {
    expect(isSameOriginPost('https://app.example', 'https://app.example')).toBe(
      true,
    );
  });
  it.each([
    null,
    '',
    'null',
    'https://app.example.evil.test',
    'https://evil.test',
    'http://app.example',
    'https://app.example:444',
    'https://app.example/',
    'https://app.example https://evil.test',
  ])('rejects unsafe Origin %s', (origin) => {
    expect(isSameOriginPost(origin, 'https://app.example')).toBe(false);
  });
});

describe('database-authoritative auth guards', () => {
  it.each([
    ['fan', routes.home],
    ['artist', routes.artist],
    ['admin', routes.admin],
  ] as const)(
    'routes completed %s to %s without role crossover',
    (role, target) => {
      const actor = { ...profile, role };
      expect(landingPath(actor, now)).toBe(target);
      for (const next of [
        '/',
        '/artist',
        '/admin',
        '/onboarding',
        '//evil.test',
      ]) {
        expect(authorizedReturnPath(actor, next)).toBe(target);
      }
      expect(
        pageRedirect({ status: 'authenticated', profile: actor }, routes.start),
      ).toBe(target);
      expect(
        pageRedirect({ status: 'authenticated', profile: actor }, target),
      ).toBeNull();
    },
  );
  it.each(['fan', 'artist', 'admin'] as const)(
    'onboarding gates %s even for privileged return paths',
    (role) => {
      const actor = { ...profile, role, onboarding_completed_at: null };
      expect(landingPath(actor, now)).toBe(routes.onboarding);
      expect(authorizedReturnPath(actor, routes.admin)).toBe(routes.onboarding);
      expect(
        pageRedirect(
          { status: 'authenticated', profile: actor },
          routes.onboarding,
        ),
      ).toBeNull();
    },
  );
  it.each([null, '2026-10-25T00:00:00Z', 'invalid'])(
    'active/malformed restriction %s takes precedence over onboarding and role',
    (restricted_until) => {
      const actor = {
        ...profile,
        role: 'admin' as const,
        is_restricted: true,
        restricted_until,
        onboarding_completed_at: null,
      };
      expect(isRestricted(actor, now)).toBe(true);
      expect(landingPath(actor, now)).toBe(routes.restricted);
    },
  );
  it.each(['2026-10-23T00:00:00Z', '2026-10-24T12:00:00Z'])(
    'expired restriction %s releases the gate exactly at expiry',
    (restricted_until) => {
      const actor = { ...profile, is_restricted: true, restricted_until };
      expect(isRestricted(actor, now)).toBe(false);
      expect(landingPath(actor, now)).toBe(routes.home);
    },
  );
  it('does not restrict an unrestricted actor on irrelevant timestamps', () => {
    expect(isRestricted({ ...profile, restricted_until: 'invalid' }, now)).toBe(
      false,
    );
  });
  it.each(['anonymous', 'unconfigured', 'unavailable'] as const)(
    '%s state cannot access any protected page and never loops on start',
    (status) => {
      expect(pageRedirect({ status }, routes.start)).toBeNull();
      for (const path of [
        routes.home,
        routes.artist,
        routes.admin,
        routes.onboarding,
        routes.restricted,
      ]) {
        expect(pageRedirect({ status }, path)).toBe(
          `/start?next=${encodeURIComponent(safeReturnPath(path))}`,
        );
      }
    },
  );
});

describe('verified subject and current profile service', () => {
  it('has no fake session when unconfigured', async () => {
    expect(await readSession(null)).toEqual({ status: 'unconfigured' });
  });
  it('returns only a subject-matched database profile', async () => {
    const adapter = port();
    expect(await readSession(adapter)).toEqual({
      status: 'authenticated',
      profile,
    });
    expect(adapter.readProfile).toHaveBeenCalledWith(profile.id);
  });
  it.each([success(null), failure('INTERNAL')])(
    'does not query profiles without a verified subject',
    async (result) => {
      const adapter = port();
      vi.mocked(adapter.verifySubject).mockResolvedValue(result);
      expect(await readSession(adapter)).toEqual({
        status: result.ok ? 'anonymous' : 'unavailable',
      });
      expect(adapter.readProfile).not.toHaveBeenCalled();
    },
  );
  it.each([
    failure('INTERNAL'),
    success({ ...profile, id: 'different-actor' }),
  ])(
    'fails closed on missing/failed/mismatched actor profile',
    async (result) => {
      const adapter = port();
      vi.mocked(adapter.readProfile).mockResolvedValue(result);
      expect(await readSession(adapter)).toEqual({ status: 'unavailable' });
    },
  );
  it('does not treat exchange success alone as authentication', async () => {
    const adapter = port();
    vi.mocked(adapter.readProfile).mockResolvedValue(failure('INTERNAL'));
    expect(await completeLogin(adapter, 'fixture-code')).toEqual(
      failure('UNAUTHENTICATED'),
    );
  });
  it('rejects replay/failed exchange without reading an existing unrelated session', async () => {
    const adapter = port();
    vi.mocked(adapter.exchangeCode).mockResolvedValue(
      failure('UNAUTHENTICATED'),
    );
    expect(await completeLogin(adapter, 'replayed-code')).toEqual(
      failure('UNAUTHENTICATED'),
    );
    expect(adapter.verifySubject).not.toHaveBeenCalled();
  });
  it('verifies subject and profile after a successful code exchange', async () => {
    const adapter = port();
    expect(await completeLogin(adapter, 'fixture-code')).toEqual(
      success({ status: 'authenticated', profile }),
    );
    expect(adapter.exchangeCode).toHaveBeenCalledWith('fixture-code');
    expect(adapter.verifySubject).toHaveBeenCalledOnce();
  });
});
