// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CookieMethodsServer } from '@supabase/ssr';
import { getAuthConfiguration } from '@/server/auth/configuration';
import { createActorClient, type ActorClient } from '@/server/db/client';
import { readAuthProfile } from '@/server/db/auth-profile';

const { sdkClient } = vi.hoisted(() => ({ sdkClient: vi.fn() }));
vi.mock('@supabase/ssr', () => ({ createServerClient: sdkClient }));

const configuration = {
  appOrigin: 'https://app.example',
  supabaseUrl: 'https://project.supabase.co',
  publicKey: 'sb_publishable_fixture',
};
const cookieStore: CookieMethodsServer = {
  getAll: () => [],
  setAll: () => undefined,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('NEXT_PUBLIC_APP_URL', configuration.appOrigin);
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', configuration.supabaseUrl);
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', configuration.publicKey);
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('actor-scoped authentication configuration', () => {
  it('requires only public project configuration, not a service-role credential', () => {
    expect(getAuthConfiguration()).toEqual(configuration);
  });
  it('never projects private service credentials even if configured', () => {
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'sb_secret_never_export');
    expect(getAuthConfiguration()).toEqual(configuration);
    expect(JSON.stringify(getAuthConfiguration())).not.toContain(
      'never_export',
    );
  });
  it.each(['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY'])(
    'disables auth when %s is missing without pretending success',
    (key) => {
      vi.stubEnv(key, '');
      expect(getAuthConfiguration()).toBeNull();
    },
  );
  it.each([
    ['NEXT_PUBLIC_SUPABASE_ANON_KEY', 'sb_secret_private'],
    ['NEXT_PUBLIC_APP_URL', 'https://user:password@app.example'],
    ['NEXT_PUBLIC_APP_URL', 'https://app.example/path'],
    ['NEXT_PUBLIC_SUPABASE_URL', 'http://remote-insecure.example'],
    ['NEXT_PUBLIC_NOT_ALLOWED_KEY', 'secret'],
  ])('fails closed on invalid configuration %s', (key, value) => {
    vi.stubEnv(key, value);
    expect(getAuthConfiguration()).toBeNull();
  });
  it('canonicalizes configured origin rather than using a request host', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://app.example:443/');
    expect(getAuthConfiguration()?.appOrigin).toBe('https://app.example');
  });
});

describe('request-scoped SDK and profile query', () => {
  it('constructs a fresh server SSR client with actor public key and supplied cookie bridge', () => {
    createActorClient(configuration, cookieStore);
    createActorClient(configuration, cookieStore);
    expect(sdkClient).toHaveBeenCalledTimes(2);
    expect(sdkClient).toHaveBeenCalledWith(
      configuration.supabaseUrl,
      configuration.publicKey,
      expect.objectContaining({
        cookies: cookieStore,
        cookieOptions: expect.objectContaining({
          name: '__Host-sb-project-auth-token',
          httpOnly: true,
          secure: true,
          sameSite: 'lax',
        }),
      }),
    );
  });
  it('forces no-store for external I/O and respects caller cancellation with a bounded timeout signal', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}'));
    vi.stubGlobal('fetch', fetchMock);
    createActorClient(configuration, cookieStore);
    const options = sdkClient.mock.calls[0]![2] as {
      global: { fetch: typeof fetch };
    };
    const cancellation = new AbortController();
    await options.global.fetch('https://project.supabase.co/auth/v1/user', {
      cache: 'force-cache',
      signal: cancellation.signal,
    });
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(init.cache).toBe('no-store');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    cancellation.abort();
    expect(init.signal?.aborted).toBe(true);
  });
  it('projects only authorization fields and explicitly filters even an admin actor to its own ID', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    const eq = vi.fn().mockReturnValue({ maybeSingle });
    const select = vi.fn().mockReturnValue({ eq });
    const from = vi.fn().mockReturnValue({ select });
    await readAuthProfile(
      { from } as unknown as ActorClient,
      'verified-admin-subject',
    );
    expect(from).toHaveBeenCalledExactlyOnceWith('profiles');
    expect(select).toHaveBeenCalledExactlyOnceWith(
      'id, role, onboarding_completed_at, is_restricted, restricted_until',
    );
    expect(eq).toHaveBeenCalledExactlyOnceWith('id', 'verified-admin-subject');
    expect(maybeSingle).toHaveBeenCalledOnce();
  });
});

describe('cancellation-safe auth configuration isolation', () => {
  it.each([
    ['TOSS_SECRET_KEY', 'not_a_payment_key'],
    ['PAYMENTS_MODE', 'unsupported'],
    ['PAYMENTS_VAULT_KEY', 'broken-key'],
    ['PAYMENTS_REFUNDS_ENABLED', 'invalid-flag'],
    ['KAKAOPAY_RECURRING_CID', 'unexpected cid'],
  ])(
    'keeps verified owner login available when unrelated %s is misconfigured',
    (key, value) => {
      vi.stubEnv(key, value);
      expect(getAuthConfiguration()).toEqual(configuration);
    },
  );
});
