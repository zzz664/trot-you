// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getPublicAppOrigin } from '@/config/env';
import { parseAuthEnv, parseServerEnv } from '@/config/env.server';
const auth = {
  NEXT_PUBLIC_APP_URL: 'https://app.example',
  NEXT_PUBLIC_SUPABASE_URL: 'https://db.example',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'sb_publishable_fixture',
};
afterEach(() => vi.unstubAllEnvs());
describe('owner cancellation auth configuration separation', () => {
  it.each([
    { PAYMENTS_MODE: 'broken' },
    { PAYMENTS_REFUNDS_ENABLED: 'broken' },
    { TOSS_SECRET_KEY: 'broken' },
    { NEXT_PUBLIC_TOSS_CLIENT_KEY: 'broken' },
    { PAYMENTS_VAULT_KEY: 'broken' },
  ])(
    'allows only auth capability while payment config %# fails closed',
    (change) => {
      expect(parseServerEnv({ ...auth, ...change }).ok).toBe(false);
      expect(parseAuthEnv({ ...auth, ...change })).toEqual({
        ok: true,
        data: auth,
      });
    },
  );
  it.each([
    null,
    [],
    new Proxy(
      {},
      {
        ownKeys() {
          throw new Error('private');
        },
      },
    ),
    Object.defineProperty({}, 'secret', {
      get() {
        throw new Error('private');
      },
    }),
    { ...auth, NEXT_PUBLIC_UNKNOWN: 'private' },
    { ...auth, NEXT_PUBLIC_SUPABASE_ANON_KEY: 'sb_secret_private' },
  ])('rejects malformed/sensitive auth configuration %#', (input) => {
    expect(parseAuthEnv(input).ok).toBe(false);
  });
  it('does not project other private configuration', () => {
    expect(
      parseAuthEnv({
        ...auth,
        TOSS_SECRET_KEY: 'secret',
        SUPABASE_SERVICE_ROLE_KEY: 'secret',
      }),
    ).toEqual({ ok: true, data: auth });
  });
  it('isolates metadata from malformed unrelated public payment config', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', auth.NEXT_PUBLIC_APP_URL);
    vi.stubEnv('NEXT_PUBLIC_TOSS_CLIENT_KEY', 'malformed');
    expect(getPublicAppOrigin()).toBe(auth.NEXT_PUBLIC_APP_URL);
  });
  it('still rejects unsafe metadata origins', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://person:secret@app.example');
    expect(() => getPublicAppOrigin()).toThrow(
      'Invalid public application origin',
    );
  });
});
