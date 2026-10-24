import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import { getPublicEnv, publicEnvSchema } from '@/config/env';
import { parseServerEnv } from '@/config/env.server';
import type { IntegrationId } from '@/config/integrations';
import {
  inspectConfiguration,
  requireIntegrationConfiguration,
} from '@/server/configuration';

const testToss = {
  PAYMENTS_MODE: 'test',
  TOSS_BILLING_ENABLED: 'true',
  NEXT_PUBLIC_TOSS_CLIENT_KEY: 'test_ck_fixture',
  TOSS_SECRET_KEY: 'test_sk_fixture',
  TOSS_BILLING_MID: 'fixture_mid',
};
const jwt = (role: string) =>
  `header.${btoa(JSON.stringify({ role }))}.signature`;

describe('public environment allowlist', () => {
  it('strips unknown fields and server credentials', () => {
    expect(
      publicEnvSchema.parse({
        TOSS_SECRET_KEY: 'never-public',
        NEXT_PUBLIC_UNKNOWN_SECRET: 'never-public',
      }),
    ).toEqual({ NEXT_PUBLIC_APP_URL: 'http://localhost:3000' });
  });
  it.each([
    'https://user:secret@example.com',
    'https://example.com/?token=secret',
    'https://example.com/#secret',
    'https://example.com/callback',
    'http://example.com',
    'javascript:alert(1)',
    'https://',
    'not-a-url',
  ])('rejects unsafe origin %s without throwing', (value) => {
    expect(
      publicEnvSchema.safeParse({ NEXT_PUBLIC_APP_URL: value }).success,
    ).toBe(false);
  });
  it.each([
    'https://example.com',
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://[::1]:3000',
  ])('allows canonical HTTPS/loopback origins %s', (value) => {
    expect(
      publicEnvSchema.safeParse({ NEXT_PUBLIC_APP_URL: value }).success,
    ).toBe(true);
  });
  it.each([
    'sb_secret_private',
    jwt('service_role'),
    'live_sk_private',
    'test_gck_checkout',
    'a private key',
  ])(
    'rejects secrets/non-billing keys in browser configuration (%s)',
    (value) => {
      expect(
        publicEnvSchema.safeParse({ NEXT_PUBLIC_SUPABASE_ANON_KEY: value })
          .success,
      ).toBe(false);
      expect(
        publicEnvSchema.safeParse({ NEXT_PUBLIC_TOSS_CLIENT_KEY: value })
          .success,
      ).toBe(false);
    },
  );
  it.each(['sb_publishable_fixture', jwt('anon')])(
    'accepts supported public Supabase key shapes',
    (value) => {
      expect(
        publicEnvSchema.safeParse({ NEXT_PUBLIC_SUPABASE_ANON_KEY: value })
          .success,
      ).toBe(true);
    },
  );
  it('throws only a fixed message from the public runtime reader', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://user:secret@example.com');
    try {
      expect(() => getPublicEnv()).toThrow(
        'Invalid public environment configuration',
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe('server configuration and fail-closed credential readiness', () => {
  it('allows a keyless build without pretending integrations work', () => {
    const result = inspectConfiguration({ NODE_ENV: 'production' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.paymentsMode).toBe('disabled');
    expect(result.data.integrations.toss_card_billing.state).toBe('disabled');
    expect(result.data.integrations.kakaopay_subscription.state).toBe(
      'disabled',
    );
    expect(result.data.integrations.supabase.state).toBe('missing');
    expect(
      Object.values(result.data.integrations).every(
        (value) => !value.operational,
      ),
    ).toBe(true);
    expect(
      requireIntegrationConfiguration('toss_card_billing', parseServerEnv({})),
    ).toMatchObject({ ok: false, error: { code: 'INTEGRATION_UNAVAILABLE' } });
  });
  it('lists missing field names only, never values', () => {
    const result = inspectConfiguration({
      PAYMENTS_MODE: 'test',
      TOSS_BILLING_ENABLED: 'true',
      TOSS_SECRET_KEY: 'test_sk_fixture',
    });
    expect(result).toMatchObject({
      ok: true,
      data: {
        integrations: {
          toss_card_billing: {
            state: 'missing',
            missing: ['NEXT_PUBLIC_TOSS_CLIENT_KEY', 'TOSS_BILLING_MID'],
          },
        },
      },
    });
    expect(JSON.stringify(result)).not.toContain('test_sk_fixture');
  });
  it('recognizes provider-specific configuration without activating adapters', () => {
    const input = {
      ...testToss,
      KAKAOPAY_SUBSCRIPTION_ENABLED: 'true',
      KAKAOPAY_SECRET_KEY: 'opaque_fixture',
      KAKAOPAY_RECURRING_CID: 'TCSUBSCRIP',
    };
    const result = inspectConfiguration(input);
    expect(result).toMatchObject({
      ok: true,
      data: {
        integrations: {
          toss_card_billing: { state: 'configured', operational: false },
          kakaopay_subscription: { state: 'configured', operational: false },
        },
      },
    });
    expect(
      requireIntegrationConfiguration(
        'toss_card_billing',
        parseServerEnv(input),
      ).ok,
    ).toBe(true);
    expect(JSON.stringify(result)).not.toContain('opaque_fixture');
    expect(JSON.stringify(result)).not.toContain('test_sk_fixture');
  });
  it.each([
    { PAYMENTS_MODE: 'mock' },
    { PAYMENT_PROVIDER: 'mock' },
    { TOSS_WEBHOOK_SECRET: 'invented' },
    { NEXT_PUBLIC_CRON_SECRET: 'private' },
    { TOSS_BILLING_ENABLED: 'yes' },
    { CRON_SECRET: 'short' },
    { CRON_SECRET: 'long-enough-but\nunsafe' },
    { SUPABASE_SERVICE_ROLE_KEY: 'sb_publishable_fixture' },
    { ...testToss, TOSS_SECRET_KEY: 'live_sk_fixture' },
    {
      ...testToss,
      PAYMENTS_MODE: 'live',
      NEXT_PUBLIC_APP_URL: 'https://example.com',
    },
    { PAYMENTS_MODE: 'live', NEXT_PUBLIC_APP_URL: 'http://localhost:3000' },
    {
      PAYMENTS_MODE: 'live',
      NEXT_PUBLIC_APP_URL: 'https://example.com',
      KAKAOPAY_RECURRING_CID: 'TCSUBSCRIP',
    },
    { PAYMENTS_MODE: 'test', KAKAOPAY_RECURRING_CID: 'production_cid' },
    { PAYMENTS_MODE: 'test', KAKAOPAY_RECURRING_CID: 'TC0ONETIME' },
    { PAYMENTS_MODE: 'test', KAKAOPAY_RECURRING_CID: 'TCSEQUENCE' },
    { TOSS_SECRET_KEY: 'test_sk_secret with whitespace' },
  ])('fails closed on invalid/mixed/deprecated input %#', (input) => {
    const result = parseServerEnv(input);
    expect(result).toMatchObject({
      ok: false,
      error: { code: 'CONFIGURATION_INVALID' },
    });
    expect(Object.keys(result)).toEqual(['ok', 'error']);
    if (!result.ok)
      expect(Object.keys(result.error)).toEqual(['code', 'message']);
    expect(
      requireIntegrationConfiguration('toss_card_billing', result).ok,
    ).toBe(false);
  });
  it.each([undefined, null, [], 'private', 1])(
    'rejects non-environment input %#',
    (input) => {
      expect(parseServerEnv(input).ok).toBe(false);
    },
  );
  it('ignores unknown host variables and inherited secrets without exporting either', () => {
    const input = Object.assign(
      Object.create({ TOSS_SECRET_KEY: 'live_sk_inherited' }),
      { PATH: '/host', INTERNAL_SECRET: 'private' },
    );
    const result = parseServerEnv(input);
    expect(result).toMatchObject({
      ok: true,
      data: { PAYMENTS_MODE: 'disabled' },
    });
    expect(JSON.stringify(result)).not.toMatch(/private|\/host|inherited/);
  });
  it('does not invoke accessors or leak proxy exceptions', () => {
    const getter = vi.fn(() => {
      throw new Error('private');
    });
    expect(
      parseServerEnv(
        Object.defineProperty({}, 'TOSS_SECRET_KEY', { get: getter }),
      ).ok,
    ).toBe(false);
    expect(getter).not.toHaveBeenCalled();
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();
    expect(parseServerEnv(proxy)).toMatchObject({ ok: false });
  });
  it('accepts disabled blank credentials but rejects whitespace credentials', () => {
    expect(parseServerEnv({ CRON_SECRET: '', TOSS_SECRET_KEY: '' }).ok).toBe(
      true,
    );
    expect(parseServerEnv({ TOSS_SECRET_KEY: ' ' }).ok).toBe(false);
  });
  it('accepts explicit live shapes, not proof of valid merchant keys', () => {
    const input = {
      ...testToss,
      PAYMENTS_MODE: 'live',
      NEXT_PUBLIC_APP_URL: 'https://example.com',
      NEXT_PUBLIC_TOSS_CLIENT_KEY: 'live_ck_fixture',
      TOSS_SECRET_KEY: 'live_sk_fixture',
    };
    expect(inspectConfiguration(input)).toMatchObject({
      ok: true,
      data: {
        integrations: {
          toss_card_billing: { state: 'configured', operational: false },
        },
      },
    });
  });
});

describe('provider-isolated credential projection', () => {
  it('does not return another integration secret or optional Kakao credentials to Toss', () => {
    const parsed = parseServerEnv({
      ...testToss,
      KAKAOPAY_SECRET_KEY: 'kakao_private',
      KAKAOPAY_CID_SECRET: 'cid_private',
      CRON_SECRET: 'cron_private_long_enough',
    });
    const result = requireIntegrationConfiguration('toss_card_billing', parsed);
    expect(result).toMatchObject({
      ok: true,
      data: {
        integration: 'toss_card_billing',
        operational: false,
        credentials: { TOSS_SECRET_KEY: 'test_sk_fixture' },
      },
    });
    expect(JSON.stringify(result)).not.toMatch(
      /kakao_private|cid_private|cron_private/,
    );
    if (result.ok)
      expect(Object.keys(result.data.credentials).sort()).toEqual([
        'NEXT_PUBLIC_TOSS_CLIENT_KEY',
        'TOSS_BILLING_MID',
        'TOSS_SECRET_KEY',
      ]);
  });
  it('includes issued optional cid_secret only for KakaoPay', () => {
    const parsed = parseServerEnv({
      PAYMENTS_MODE: 'test',
      KAKAOPAY_SUBSCRIPTION_ENABLED: 'true',
      KAKAOPAY_SECRET_KEY: 'kakao_fixture',
      KAKAOPAY_RECURRING_CID: 'TCSUBSCRIP',
      KAKAOPAY_CID_SECRET: 'cid_fixture',
    });
    expect(
      requireIntegrationConfiguration('kakaopay_subscription', parsed),
    ).toMatchObject({
      ok: true,
      data: { credentials: { KAKAOPAY_CID_SECRET: 'cid_fixture' } },
    });
  });
  it('does not infer a reserved live CID prefix from example sandbox CIDs', () => {
    expect(
      parseServerEnv({
        PAYMENTS_MODE: 'live',
        NEXT_PUBLIC_APP_URL: 'https://example.com',
        KAKAOPAY_RECURRING_CID: 'TC_unverified_merchant_identifier',
      }).ok,
    ).toBe(true);
  });
});

describe('required fields for every integration', () => {
  const full = {
    ...testToss,
    NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'sb_publishable_fixture',
    SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_fixture',
    KAKAOPAY_SUBSCRIPTION_ENABLED: 'true',
    KAKAOPAY_SECRET_KEY: 'kakao_fixture',
    KAKAOPAY_RECURRING_CID: 'TCSUBSCRIP',
    VAPID_PUBLIC_KEY: 'public_fixture',
    VAPID_PRIVATE_KEY: 'private_fixture',
    ALIMTALK_API_KEY: 'alimtalk_fixture',
    CRON_SECRET: 'cron_fixture_long_enough',
  };
  it.each([
    ['supabase', 'SUPABASE_SERVICE_ROLE_KEY'],
    ['toss_card_billing', 'TOSS_SECRET_KEY'],
    ['kakaopay_subscription', 'KAKAOPAY_SECRET_KEY'],
    ['webpush', 'VAPID_PRIVATE_KEY'],
    ['alimtalk', 'ALIMTALK_API_KEY'],
    ['cron', 'CRON_SECRET'],
  ] as const)(
    '%s refuses missing %s without a successful fallback',
    (id, key) => {
      expect(requireIntegrationConfiguration(id, parseServerEnv(full)).ok).toBe(
        true,
      );
      const missing = { ...full, [key]: '' };
      expect(
        requireIntegrationConfiguration(id, parseServerEnv(missing)),
      ).toMatchObject({
        ok: false,
        error: { code: 'INTEGRATION_UNAVAILABLE' },
      });
      expect(inspectConfiguration(missing)).toMatchObject({
        ok: true,
        data: {
          integrations: {
            [id]: { state: 'missing', missing: [key], operational: false },
          },
        },
      });
    },
  );
  it('does not export a prototype-named environment field', () => {
    const result = parseServerEnv(
      JSON.parse(
        '{"__proto__":{"injected":"private"},"constructor":"private"}',
      ),
    );
    expect(result.ok).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(
      /injected|private|__proto__|constructor/,
    );
    expect(Object.prototype).not.toHaveProperty('injected');
  });
});

describe('dynamic provider type safety', () => {
  it('requires discriminant narrowing before credential access', () => {
    function inspectDynamicProvider(id: IntegrationId) {
      const result = requireIntegrationConfiguration(
        id,
        parseServerEnv({ CRON_SECRET: 'cron_fixture_long_enough' }),
      );
      if (!result.ok) return;
      // @ts-expect-error A dynamic provider has no guaranteed Cron credential.
      expectTypeOf(result.data.credentials.CRON_SECRET);
      if (result.data.integration === 'cron') {
        expectTypeOf(
          result.data.credentials.CRON_SECRET,
        ).toEqualTypeOf<string>();
        // @ts-expect-error A Cron configuration never contains a Toss secret.
        expectTypeOf(result.data.credentials.TOSS_SECRET_KEY);
      }
      if (result.data.integration === 'toss_card_billing') {
        expectTypeOf(
          result.data.credentials.TOSS_SECRET_KEY,
        ).toEqualTypeOf<string>();
        // @ts-expect-error A Toss configuration never contains a Cron secret.
        expectTypeOf(result.data.credentials.CRON_SECRET);
      }
    }
    inspectDynamicProvider('cron');
  });
});
