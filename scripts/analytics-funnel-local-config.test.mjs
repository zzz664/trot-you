import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ANALYTICS_FUNNEL_CI_ENV,
  analyticsFunnelLocalEnvironment,
} from './analytics-funnel-local-config.mjs';

const fixture = {
  CI: 'true',
  GITHUB_ACTIONS: 'true',
  AUTH_LOCAL_E2E: 'true',
  NEXT_PUBLIC_APP_URL: 'http://127.0.0.1:3100',
  NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
  AUTH_TEST_SERVICE_KEY: 'fictional-local-fixture-key',
  SUPABASE_SERVICE_ROLE_KEY: 'fictional-local-fixture-key',
};
test('local analytics-funnel opt-in writes only disabled delivery and payment settings, never fixture credentials', () => {
  assert.equal(
    analyticsFunnelLocalEnvironment(fixture),
    'ANALYTICS_FUNNEL_LOCAL_E2E=true\n' +
      Object.entries(ANALYTICS_FUNNEL_CI_ENV)
        .map(([key, value]) => `${key}=${value}\n`)
        .join(''),
  );
});
test('exact Auth-only placeholders are cleared before the activity browser build', () => {
  const output = analyticsFunnelLocalEnvironment({
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
  assert.match(output, /TOSS_BILLING_ENABLED=false\n/);
  assert.match(output, /KAKAOPAY_SUBSCRIPTION_ENABLED=false\n/);
  assert.match(output, /TOSS_SECRET_KEY=\n/);
  assert.match(output, /KAKAOPAY_SECRET_KEY=\n/);
  assert.doesNotMatch(
    output,
    /test_sk_checkout_ci_fixture|checkout_ci_not_a_real_key/,
  );
});
for (const key of [
  'CI',
  'GITHUB_ACTIONS',
  'AUTH_LOCAL_E2E',
  'AUTH_TEST_SERVICE_KEY',
])
  test(`missing ${key} rejects analytics-funnel fixture activation`, () => {
    assert.throws(() =>
      analyticsFunnelLocalEnvironment({ ...fixture, [key]: undefined }),
    );
  });
for (const [key, value] of [
  ['NEXT_PUBLIC_APP_URL', 'https://example.invalid'],
  ['NEXT_PUBLIC_SUPABASE_URL', 'https://project.supabase.co'],
  ['NEXT_PUBLIC_SUPABASE_URL', 'http://127.0.0.1:54321/evil'],
  ['DOCKER_HOST', 'tcp://remote.invalid'],
  ['DOCKER_CONTEXT', 'remote'],
  ['SUPABASE_ACCESS_TOKEN', 'secret-hosted-token'],
  ['SUPABASE_DB_PASSWORD', 'secret-hosted-password'],
  ['ANALYTICS_FUNNEL_LOCAL_E2E', 'true'],
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
  test(`${key} override rejects before any file write or network call`, () => {
    assert.throws(() =>
      analyticsFunnelLocalEnvironment({ ...fixture, [key]: value }),
    );
  });
test('a credential mismatch error does not expose either key', () => {
  const first = 'private-service-value';
  const second = 'private-fixture-value';
  assert.throws(
    () =>
      analyticsFunnelLocalEnvironment({
        ...fixture,
        SUPABASE_SERVICE_ROLE_KEY: first,
        AUTH_TEST_SERVICE_KEY: second,
      }),
    (error) =>
      !String(error).includes(first) && !String(error).includes(second),
  );
});

test('default discovery excludes the isolated analytics-funnel suite', async () => {
  const { execFileSync } = await import('node:child_process');
  const listing = execFileSync(
    process.execPath,
    [
      'node_modules/@playwright/test/cli.js',
      'test',
      '--list',
      '--reporter=line',
    ],
    { encoding: 'utf8', timeout: 30_000 },
  );
  assert.match(listing, /Total: [1-9][0-9]* tests/);
  assert.doesNotMatch(listing, /analytics-funnel\/analytics-funnel\.spec/);
});
test('dedicated analytics-funnel discovery fails closed without its local opt-in', async () => {
  const { execFileSync } = await import('node:child_process');
  assert.throws(
    () =>
      execFileSync(
        process.execPath,
        [
          'node_modules/@playwright/test/cli.js',
          'test',
          '--config',
          'playwright.analytics-funnel.config.ts',
          '--list',
        ],
        {
          encoding: 'utf8',
          timeout: 30_000,
          env: {
            ...process.env,
            ANALYTICS_FUNNEL_LOCAL_E2E: '',
            AUTH_LOCAL_E2E: '',
          },
          stdio: 'pipe',
        },
      ),
    (error) => /Run analytics-funnel tests only/.test(String(error.stderr)),
  );
});
test('opted-in discovery lists analytics-funnel tests without launching a browser, server or database', async () => {
  const { execFileSync } = await import('node:child_process');
  const listing = execFileSync(
    process.execPath,
    [
      'node_modules/@playwright/test/cli.js',
      'test',
      '--config',
      'playwright.analytics-funnel.config.ts',
      '--list',
      '--reporter=line',
    ],
    {
      encoding: 'utf8',
      timeout: 30_000,
      env: {
        ...process.env,
        ...fixture,
        ...ANALYTICS_FUNNEL_CI_ENV,
        ANALYTICS_FUNNEL_LOCAL_E2E: 'true',
      },
    },
  );
  assert.match(listing, /analytics-funnel\.spec\.ts/);
  assert.match(listing, /Total: [1-9][0-9]* tests in 1 file/);
  assert.doesNotMatch(
    listing,
    /(?:auth-unconfigured|analytics-funnel-unconfigured|speech|media|replies)\.spec\.ts:/,
  );
});

test('real aggregate response is verified before the single terminal route action', async () => {
  const { readFileSync } = await import('node:fs');
  const source = readFileSync(
    new URL(
      '../tests/e2e/analytics-funnel/analytics-funnel.spec.ts',
      import.meta.url,
    ),
    'utf8',
  );
  const observer = source
    .split('async function captureArrival(')[1]
    ?.split('async function open(')[0];
  assert.ok(observer);
  let previous = -1;
  for (const check of [
    "expect(request.method()).toBe('GET')",
    'ANALYTICS_FUNNEL.actorHeader.toLowerCase()',
    'const response = await route.fetch()',
    'analyticsFunnelDashboardSchema.parse(',
    'await success(response)',
    'expect(data.actor_id).toBe(actor.id)',
    'terminalActionStarted = true',
    'await route.fulfill({ response })',
    'accept()',
  ]) {
    const index = observer
      .replace(/\s+/g, '')
      .indexOf(check.replace(/\s+/g, ''));
    assert.ok(
      index > previous,
      `Missing or reordered response verification: ${check}`,
    );
    previous = index;
  }
  assert.match(observer, /if \(!terminalActionStarted\)/);
  assert.match(observer, /new AggregateError/);
  assert.match(observer, /times: 1/);
  assert.ok(!observer.includes('.catch('));
});

test('screenshots wait for actual content, async completion and fonts before full-page capture', async () => {
  const { readFileSync } = await import('node:fs');
  const source = readFileSync(
    new URL(
      '../tests/e2e/analytics-funnel/screenshot-capture.ts',
      import.meta.url,
    ),
    'utf8',
  );
  for (const check of [
    'analytics-funnel-content',
    '[role="alert"]',
    "not.toHaveAttribute('aria-busy', 'true')",
    'document.fonts.ready',
    'requestAnimationFrame',
    'fullPage: true',
  ])
    assert.ok(source.includes(check));
  assert.ok(!source.includes('waitForTimeout'));
});

test('responsive suite covers every scale and width plus settled offscreen metric and daily sections', async () => {
  const { readFileSync } = await import('node:fs');
  const source = readFileSync(
    new URL(
      '../tests/e2e/analytics-funnel/analytics-funnel.spec.ts',
      import.meta.url,
    ),
    'utf8',
  );
  assert.match(source, /\['normal', 'large', 'xlarge'\]/);
  assert.match(source, /\[360, 1280\]/);
  assert.ok(source.includes("page.getByTestId('analytics-funnel-metrics')"));
  assert.ok(source.includes("page.getByTestId('analytics-funnel-daily')"));
  assert.ok(source.includes('await target.scrollIntoViewIfNeeded()'));
  assert.ok(source.includes('await target.screenshot('));
  assert.ok(!source.includes("page.getByRole('alert')"));
});

test('Back begins only after destination history and heading have settled, then verifies the return read', async () => {
  const { readFileSync } = await import('node:fs');
  const source = readFileSync(
    new URL(
      '../tests/e2e/analytics-funnel/analytics-funnel.spec.ts',
      import.meta.url,
    ),
    'utf8',
  )
    .split("'HTML, RSC, worker caches")[1]
    ?.split("test('current source")[0];
  assert.ok(source);
  let previous = -1;
  for (const check of [
    'expect((await navigation).status()).toBe(200)',
    'await expect(page).toHaveURL(routes.admin)',
    "await expect(main(page).getByRole('heading').first()).toBeVisible()",
    'const arrival = await captureArrival(page, world.admin, world.range)',
    'await page.goBack()',
    'await arrival.result',
  ]) {
    const index = source.indexOf(check, previous + 1);
    assert.ok(index > previous, `Missing or reordered Back guard: ${check}`);
    previous = index;
  }
});

test('late responses are joined after one terminal handler instead of hidden route retries', async () => {
  const { readFileSync } = await import('node:fs');
  const source = readFileSync(
    new URL(
      '../tests/e2e/analytics-funnel/analytics-funnel.spec.ts',
      import.meta.url,
    ),
    'utf8',
  )
    .split("'a late verified response")[1]
    ?.split("test('pagehide")[0];
  assert.ok(source);
  assert.match(
    source,
    /await route\.fulfill\(\{ response \}\);\s*settled\(\{\}\)/,
  );
  assert.match(source, /if \(!terminalActionStarted\)/);
  assert.ok(!source.includes('.catch('));
  assert.ok(
    source.indexOf('const completion = await completed') >
      source.indexOf('release()'),
  );
  assert.ok(
    source.includes("if ('error' in completion) throw completion.error"),
  );
});

test('old-render preview actor test swaps cookies before the first visible intersection, not after the request', async () => {
  const { readFileSync } = await import('node:fs');
  const source = readFileSync(
    new URL(
      '../tests/e2e/analytics-funnel/analytics-funnel.spec.ts',
      import.meta.url,
    ),
    'utf8',
  ).split("'a rendered old-actor preview")[1];
  assert.ok(source);
  let previous = -1;
  for (const check of [
    'await page.setViewportSize({ width: 360, height: 100 })',
    'getBoundingClientRect().top >= innerHeight',
    'await preview.replacement.signIn(context)',
    'ANALYTICS_PREVIEW_ACTOR_HEADER.toLowerCase()',
    "await failure(response, 403, 'FORBIDDEN')",
    'await target.scrollIntoViewIfNeeded()',
    'await rejected',
    'expect(analyticsFingerprint(world.fan)).toBe(oldBefore)',
    'expect(analyticsFingerprint(preview.replacement)).toBe(newBefore)',
  ]) {
    const index = source.indexOf(check, previous + 1);
    assert.ok(
      index > previous,
      `Missing or reordered actor-race check: ${check}`,
    );
    previous = index;
  }
  assert.ok(!source.includes('waitForTimeout'));
});
