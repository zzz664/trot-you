import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  SETTLEMENT_REPORTS_CI_ENV,
  settlementReportsLocalEnvironment,
} from './settlement-reports-local-config.mjs';

const fixture = {
  CI: 'true',
  GITHUB_ACTIONS: 'true',
  AUTH_LOCAL_E2E: 'true',
  NEXT_PUBLIC_APP_URL: 'http://127.0.0.1:3100',
  NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
  AUTH_TEST_SERVICE_KEY: 'fictional-local-fixture-key',
  SUPABASE_SERVICE_ROLE_KEY: 'fictional-local-fixture-key',
};
test('local report opt-in disables payment and delivery and never emits fixture credentials', () => {
  const output = settlementReportsLocalEnvironment(fixture);
  assert.equal(
    output,
    'SETTLEMENT_REPORTS_LOCAL_E2E=true\n' +
      Object.entries(SETTLEMENT_REPORTS_CI_ENV)
        .map(([key, value]) => `${key}=${value}\n`)
        .join(''),
  );
  assert.doesNotMatch(
    output,
    /fictional-local-fixture-key|AUTH_TEST_SERVICE_KEY|SUPABASE_SERVICE_ROLE_KEY/,
  );
});
for (const key of [
  'CI',
  'GITHUB_ACTIONS',
  'AUTH_LOCAL_E2E',
  'AUTH_TEST_SERVICE_KEY',
])
  test(`missing ${key} rejects report fixture activation`, () =>
    assert.throws(() =>
      settlementReportsLocalEnvironment({ ...fixture, [key]: undefined }),
    ));
for (const [key, value] of [
  ['NEXT_PUBLIC_APP_URL', 'https://example.invalid'],
  ['NEXT_PUBLIC_SUPABASE_URL', 'https://project.supabase.co'],
  ['NEXT_PUBLIC_SUPABASE_URL', 'http://127.0.0.1:54321/evil'],
  ['DOCKER_HOST', 'tcp://remote.invalid'],
  ['DOCKER_CONTEXT', 'remote'],
  ['SUPABASE_ACCESS_TOKEN', 'hosted-token'],
  ['SUPABASE_DB_PASSWORD', 'hosted-password'],
  ['SETTLEMENT_REPORTS_LOCAL_E2E', 'true'],
  ['SCHEDULE_NOTICES_ENABLED', 'true'],
  ['SCHEDULE_NOTICES_CRON_SECRET', 'unknown'],
  ['MESSAGE_DISPATCH_ENABLED', 'true'],
  ['MESSAGE_DISPATCH_CRON_SECRET', 'unknown'],
  ['BILLING_NOTICES_ENABLED', 'true'],
  ['BILLING_NOTICES_CRON_SECRET', 'unknown'],
  ['WEBPUSH_WORKER_ENABLED', 'true'],
  ['PAYMENTS_MODE', 'live'],
  ['TOSS_SECRET_KEY', 'live_sk_not_allowed'],
  ['KAKAOPAY_SECRET_KEY', 'unapproved-key'],
  ['VAPID_PRIVATE_KEY', 'unapproved-key'],
  ['PAYMENTS_RENEWALS_ENABLED', 'true'],
  ['PAYMENTS_REFUNDS_ENABLED', 'true'],
  ['PAYMENTS_RECONCILIATION_ENABLED', 'true'],
])
  test(`${key} override rejects before any file write or network call`, () =>
    assert.throws(() =>
      settlementReportsLocalEnvironment({ ...fixture, [key]: value }),
    ));
test('exact Auth placeholders are cleared while arbitrary credentials remain rejected', () => {
  const output = settlementReportsLocalEnvironment({
    ...fixture,
    PAYMENTS_MODE: 'test',
    TOSS_BILLING_ENABLED: 'true',
    KAKAOPAY_SUBSCRIPTION_ENABLED: 'true',
    NEXT_PUBLIC_TOSS_CLIENT_KEY: 'test_ck_checkout_ci_fixture',
    TOSS_SECRET_KEY: 'test_sk_checkout_ci_fixture',
    TOSS_BILLING_MID: 'checkout_ci_fictional_mid',
    KAKAOPAY_SECRET_KEY: 'checkout_ci_not_a_real_key',
    KAKAOPAY_RECURRING_CID: 'TCSUBSCRIP',
    KAKAOPAY_CID_SECRET: '',
  });
  assert.match(output, /PAYMENTS_MODE=disabled\n/);
  assert.doesNotMatch(
    output,
    /test_sk_checkout_ci_fixture|checkout_ci_not_a_real_key/,
  );
});
test('credential mismatch messages reveal neither credential', () =>
  assert.throws(
    () =>
      settlementReportsLocalEnvironment({
        ...fixture,
        SUPABASE_SERVICE_ROLE_KEY: 'private-service-value',
        AUTH_TEST_SERVICE_KEY: 'private-fixture-value',
      }),
    (error) =>
      !String(error).includes('private-service-value') &&
      !String(error).includes('private-fixture-value'),
  ));
test('default browser config statically excludes the isolated report suite without listing unrelated tests', () => {
  const source = readFileSync(
    new URL('../playwright.config.ts', import.meta.url),
    'utf8',
  );
  assert.ok(source.includes("'**/settlement-reports/**'"));
});
test('dedicated report discovery fails closed without exact local opt-in', () => {
  assert.throws(
    () =>
      execFileSync(
        process.execPath,
        [
          'node_modules/@playwright/test/cli.js',
          'test',
          '--config',
          'playwright.settlement-reports.config.ts',
          '--list',
        ],
        {
          encoding: 'utf8',
          timeout: 30_000,
          env: {
            ...process.env,
            SETTLEMENT_REPORTS_LOCAL_E2E: '',
            AUTH_LOCAL_E2E: '',
          },
          stdio: 'pipe',
        },
      ),
    (error) => /Run settlement-reports tests only/.test(String(error.stderr)),
  );
});
test('exact opted-in report discovery lists only the 24 changed-capture cases without launching browser/server/database', () => {
  const scope = JSON.parse(
    readFileSync(
      new URL('../ci/scopes/settlement-reports.json', import.meta.url),
      'utf8',
    ),
  );
  const selected = scope.selection.browser['settlement-reports-browser'];
  assert.equal(selected.length, 1);
  assert.equal(
    selected[0].file,
    'tests/e2e/settlement-reports/settlement-reports.spec.ts',
  );
  assert.ok(
    selected[0].grep.startsWith('(?:^| )') && selected[0].grep.endsWith('$'),
  );
  const listing = execFileSync(
    process.execPath,
    [
      'node_modules/@playwright/test/cli.js',
      'test',
      '--config',
      'playwright.settlement-reports.config.ts',
      '--list',
      '--reporter=line',
      '--grep',
      selected[0].grep,
    ],
    {
      encoding: 'utf8',
      timeout: 30_000,
      env: {
        ...process.env,
        ...fixture,
        ...SETTLEMENT_REPORTS_CI_ENV,
        SETTLEMENT_REPORTS_LOCAL_E2E: 'true',
      },
    },
  );
  assert.match(listing, /settlement-reports\.spec\.ts/);
  assert.match(listing, /Total: 24 tests in 1 file/);
  assert.equal((listing.match(/report is readable at/g) ?? []).length, 12);
  assert.doesNotMatch(
    listing,
    /new and existing draft CAS|new committed sources make a draft stale|artist draft isolation, fan\/foreign-member denial/,
  );
  assert.deepEqual(scope.selection.unit, [
    'tests/unit/settlement-reports-response-capture.test.ts',
  ]);
  assert.deepEqual(scope.selection.sql, []);
  assert.deepEqual(scope.selection.races, []);
  assert.deepEqual(scope.selection.upgrades, []);
  assert.doesNotMatch(
    listing,
    /(?:analytics-funnel|media|speech|auth-unconfigured)\.spec\.ts:/,
  );
});
test('report fixtures retain synthetic source proof, immutable ledger and deny-only network protections', () => {
  const fixtureSource = readFileSync(
    new URL('../tests/e2e/settlement-reports/fixtures.ts', import.meta.url),
    'utf8',
  );
  const source = readFileSync(
    new URL(
      '../tests/e2e/settlement-reports/source-fixture.ts',
      import.meta.url,
    ),
    'utf8',
  );
  assert.match(fixtureSource, /settlement-reports-e2e-/);
  assert.match(
    fixtureSource,
    /!\[appOrigin, databaseOrigin\]\.includes\(url.origin\)/,
  );
  assert.match(fixtureSource, /await route.abort\('blockedbyclient'\)/);
  assert.doesNotMatch(fixtureSource, /route\.(?:continue|fulfill)\(/);
  assert.match(source, /private.payment_event_verifications/);
  assert.match(source, /'charge',11000/);
  assert.match(source, /'refund',-1000/);
  assert.match(source, /'charge',999999/);
  assert.doesNotMatch(
    source,
    /disable trigger|session_replication_role|truncate|delete from public.payment_events|update public.payment_events/i,
  );
});
test('visual artifacts cover every scale and viewport after settled content and fonts', () => {
  const source = readFileSync(
    new URL(
      '../tests/e2e/settlement-reports/settlement-reports.spec.ts',
      import.meta.url,
    ),
    'utf8',
  );
  const capture = readFileSync(
    new URL('../tests/e2e/settlement-reports/fixtures.ts', import.meta.url),
    'utf8',
  );
  assert.match(source, /\['normal', 'large', 'xlarge'\]/);
  assert.match(source, /\[360, 1280\]/);
  assert.ok(source.includes("['admin', 'artist']"));
  for (const check of [
    'settlement-report-content',
    'document.fonts.ready',
    'requestAnimationFrame',
    'fullPage: true',
  ])
    assert.ok(capture.includes(check));
  assert.doesNotMatch(source + capture, /waitForTimeout\(/);
});

test('TypeScript declaration preserves every exact public fixture literal and typed environment boundary', () => {
  const declaration = readFileSync(
    new URL('./settlement-reports-local-config.d.mts', import.meta.url),
    'utf8',
  );
  for (const [key, value] of Object.entries(SETTLEMENT_REPORTS_CI_ENV))
    assert.ok(
      declaration.includes(`${key}: '${value}';`),
      `Missing exact public fixture type: ${key}`,
    );
  assert.match(
    declaration,
    /export const SETTLEMENT_REPORTS_CI_ENV: Readonly<\{/,
  );
  assert.match(
    declaration,
    /export function settlementReportsLocalEnvironment\(\s*environment: Record<string, string \| undefined>,\s*\): string;/,
  );
  assert.doesNotMatch(declaration, /\bany\b|@ts-ignore|@ts-nocheck/);
});
