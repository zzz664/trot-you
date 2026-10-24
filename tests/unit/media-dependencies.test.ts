// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMediaDependencies } from '@/server/media/dependencies';
import { createMediaServiceClient } from '@/server/db/media-client';
import { parseServerEnv } from '@/config/env.server';
import { AUTH_REQUEST_TIMEOUT_MS } from '@/config/auth';

const mocks = vi.hoisted(() => ({
  env: vi.fn(),
  sdk: vi.fn(),
  db: vi.fn(),
  storage: vi.fn(),
  verify: vi.fn(),
}));
vi.mock('@/config/env.server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/config/env.server')>()),
  getServerEnv: mocks.env,
}));
vi.mock('@supabase/supabase-js', () => ({ createClient: mocks.sdk }));
vi.mock('@/server/db/media', () => ({ createMediaDbPort: mocks.db }));
vi.mock('@/server/adapters/storage/supabase', () => ({
  createSupabaseStorageAdapter: mocks.storage,
}));
vi.mock('@/server/adapters/storage/verify', () => ({
  verifyMedia: mocks.verify,
}));
const configuration = {
  NEXT_PUBLIC_SUPABASE_URL: 'https://media-fixture.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_fictionalserverkey',
};
const sdkClient = { fixture: 'server-client' };
const db = { fixture: 'rpc-port' };
const storage = { fixture: 'storage-port' };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.env.mockReturnValue({ ok: true, data: configuration });
  mocks.sdk.mockReturnValue(sdkClient);
  mocks.db.mockReturnValue(db);
  mocks.storage.mockReturnValue(storage);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('real media dependency composition with server-only configuration', () => {
  it.each([
    { ok: false, code: 'CONFIGURATION_INVALID' },
    { ok: true, data: {} },
    {
      ok: true,
      data: {
        NEXT_PUBLIC_SUPABASE_URL: configuration.NEXT_PUBLIC_SUPABASE_URL,
      },
    },
    {
      ok: true,
      data: {
        SUPABASE_SERVICE_ROLE_KEY: configuration.SUPABASE_SERVICE_ROLE_KEY,
      },
    },
    { ok: true, data: { ...configuration, SUPABASE_SERVICE_ROLE_KEY: '' } },
  ])(
    'does not fabricate missing media capabilities for configuration %#',
    (parsed) => {
      mocks.env.mockReturnValue(parsed);
      expect(createMediaDependencies()).toBeNull();
      expect(createMediaServiceClient()).toBeNull();
      expect(mocks.sdk).not.toHaveBeenCalled();
      expect(mocks.db).not.toHaveBeenCalled();
      expect(mocks.storage).not.toHaveBeenCalled();
      expect(mocks.verify).not.toHaveBeenCalled();
    },
  );
  it.each([
    'sb_publishable_publicfixture',
    'not-a-role-key',
    'service role key with spaces',
  ])(
    'rejects non-server secret %s through central real environment validation',
    (key) => {
      const parsed = parseServerEnv({
        ...configuration,
        SUPABASE_SERVICE_ROLE_KEY: key,
      });
      expect(parsed.ok).toBe(false);
      mocks.env.mockReturnValue(parsed);
      expect(createMediaDependencies()).toBeNull();
      expect(mocks.sdk).not.toHaveBeenCalled();
    },
  );
  it('fails closed if the service SDK capability cannot be constructed', () => {
    mocks.sdk.mockReturnValue(null);
    expect(createMediaDependencies()).toBeNull();
    expect(mocks.storage).not.toHaveBeenCalled();
    expect(mocks.db).not.toHaveBeenCalled();
  });
  it('wires real factory inputs, the verifier and clock without upload, signing or verification', () => {
    const deps = createMediaDependencies();
    expect(deps).not.toBeNull();
    expect(deps?.db).toBe(db);
    expect(deps?.storage).toBe(storage);
    expect(deps?.verify).toBe(mocks.verify);
    expect(mocks.db).toHaveBeenCalledExactlyOnceWith(sdkClient);
    expect(mocks.storage).toHaveBeenCalledExactlyOnceWith({
      url: configuration.NEXT_PUBLIC_SUPABASE_URL,
      serviceRoleKey: configuration.SUPABASE_SERVICE_ROLE_KEY,
    });
    expect(mocks.verify).not.toHaveBeenCalled();
    expect(deps?.now()).toBeGreaterThan(0);
    expect(Object.keys(deps!)).toEqual(['db', 'storage', 'verify', 'now']);
  });
  it('disables persistence, refresh and URL session detection for the privileged SDK', () => {
    expect(createMediaServiceClient()).toBe(sdkClient);
    expect(mocks.sdk).toHaveBeenCalledExactlyOnceWith(
      configuration.NEXT_PUBLIC_SUPABASE_URL,
      configuration.SUPABASE_SERVICE_ROLE_KEY,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
        global: { fetch: expect.any(Function) },
      },
    );
  });
  it('forces no-store and a bounded signal for every private RPC request', async () => {
    createMediaServiceClient();
    const options = mocks.sdk.mock.calls[0]![2] as {
      global: { fetch: typeof fetch };
    };
    const fetch = vi.fn().mockResolvedValue(new Response('{}'));
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    vi.stubGlobal('fetch', fetch);
    const target = `${configuration.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/media_resolve_read`;
    await options.global.fetch(target, {
      cache: 'force-cache',
      headers: { 'Content-Type': 'application/json' },
    });
    expect(timeout).toHaveBeenCalledWith(AUTH_REQUEST_TIMEOUT_MS);
    expect(fetch).toHaveBeenCalledWith(
      target,
      expect.objectContaining({
        cache: 'no-store',
        signal: expect.any(AbortSignal),
      }),
    );
    const abort = new AbortController();
    await options.global.fetch(target, { signal: abort.signal });
    abort.abort();
    expect((fetch.mock.calls[1]![1] as RequestInit).signal?.aborted).toBe(true);
  });
});
