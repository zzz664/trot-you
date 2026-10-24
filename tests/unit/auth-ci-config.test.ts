// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const helperUrl = new URL(
  '../../scripts/auth-local-config.mjs',
  import.meta.url,
);
const { prepareLocalAuthConfig, assertLocalAuthSettings } = (await import(
  helperUrl.href
)) as {
  prepareLocalAuthConfig: (source: string) => string;
  assertLocalAuthSettings: (settings: unknown) => void;
};
const original = readFileSync(
  new URL('../../supabase/config.toml', import.meta.url),
  'utf8',
);

describe('isolated authentication CI configuration', () => {
  it('passes only the verified local key to preview server and keeps fixture access separate', () => {
    const setup = readFileSync(
      new URL('../../scripts/auth-local-ci.mjs', import.meta.url),
      'utf8',
    );
    expect(setup).toContain("'SUPABASE_SERVICE_ROLE_KEY',");
    expect(setup).toContain(
      '`AUTH_TEST_SERVICE_KEY=${status.SERVICE_ROLE_KEY}`',
    );
    expect(setup).toContain(
      '`SUPABASE_SERVICE_ROLE_KEY=${status.SERVICE_ROLE_KEY}`',
    );
    expect(setup).not.toContain('NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY=');
    const browser = readFileSync(
      new URL('../../playwright.auth.config.ts', import.meta.url),
      'utf8',
    );
    expect(browser).toContain("AUTH_TEST_SERVICE_KEY: ''");
  });

  it('uses only fixed unusable offline checkout placeholders inside isolated CI', () => {
    const setup = readFileSync(
      new URL('../../scripts/auth-local-ci.mjs', import.meta.url),
      'utf8',
    );
    for (const key of [
      'NEXT_PUBLIC_TOSS_CLIENT_KEY',
      'TOSS_SECRET_KEY',
      'TOSS_BILLING_MID',
      'KAKAOPAY_SECRET_KEY',
      'KAKAOPAY_RECURRING_CID',
      'KAKAOPAY_CID_SECRET',
    ])
      expect(setup).toContain(`'${key}',`);
    expect(setup).toContain("'PAYMENTS_MODE=test'");
    expect(setup).toContain(
      "'NEXT_PUBLIC_TOSS_CLIENT_KEY=test_ck_checkout_ci_fixture'",
    );
    expect(setup).toContain("'TOSS_SECRET_KEY=test_sk_checkout_ci_fixture'");
    expect(setup).toContain("'KAKAOPAY_SECRET_KEY=checkout_ci_not_a_real_key'");
    expect(setup).toContain("'KAKAOPAY_RECURRING_CID=TCSUBSCRIP'");
    expect(setup).not.toContain('https://api.tosspayments.com');
    expect(setup).not.toContain('https://open-api.kakaopay.com');
    expect(setup).not.toContain('PAYMENTS_MODE=live');
  });

  it('activates the email provider while global public signup stays disabled', () => {
    const generated = prepareLocalAuthConfig(original);
    expect(
      generated.match(/(?:^|\n)\[auth\]\n([\s\S]*?)(?=\n\[|$)/)?.[1],
    ).toContain('enable_signup = false');
    expect(
      generated.match(/(?:^|\n)\[auth.email\]\n([\s\S]*?)(?=\n\[|$)/)?.[1],
    ).toContain('enable_signup = true');
    expect(generated).not.toMatch(/^\[auth.email\]\nenabled =/m);
    expect(generated).toContain('[local_smtp]\nenabled = true\nport = 54324');
    expect(generated).toContain(
      'additional_redirect_urls = ["http://127.0.0.1:3100/api/auth/callback"]',
    );
    expect(original).toContain('[local_smtp]\nenabled = false');
    expect(original).not.toContain('[auth.email]');
    expect(
      readFileSync(
        new URL('../../supabase/config.toml', import.meta.url),
        'utf8',
      ),
    ).toBe(original);
  });

  it.each([
    original.replace('project_id = "trot-you"', 'project_id = "other"'),
    original.replace('enable_signup = false', 'enable_signup = true'),
    original.replace('[auth]', '[other]'),
    original.replace(
      '[local_smtp]\nenabled = false',
      '[local_smtp]\nenabled = true',
    ),
    `${original}\n[auth.email]\n`,
    `${original}\n[auth.rate_limit]\n`,
  ])('rejects unexpected or already overridden input', (source) => {
    expect(() => prepareLocalAuthConfig(source)).toThrow();
  });

  it('accepts only the real email-enabled/signup-disabled setting combination', () => {
    expect(() =>
      assertLocalAuthSettings({
        external: { email: true },
        disable_signup: true,
      }),
    ).not.toThrow();
  });

  it.each([
    undefined,
    null,
    {},
    { external: { email: false }, disable_signup: true },
    { external: { email: true }, disable_signup: false },
    { external: { email: true } },
    { external: { email: 'true' }, disable_signup: true },
  ])(
    'fails closed when runtime settings cannot prove isolation',
    (settings) => {
      expect(() => assertLocalAuthSettings(settings)).toThrow();
    },
  );
});
