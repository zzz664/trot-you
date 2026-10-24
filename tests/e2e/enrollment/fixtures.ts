import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { createServerClient } from '@supabase/ssr';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  test as base,
  expect,
  type BrowserContext,
  type Page,
  type TestInfo,
} from '@playwright/test';
import type { Database } from '../../../src/types/database';
import { checkoutPath, routes } from '../../../src/config/routes';
import type { CheckoutProvider } from '../../../src/config/checkout';
import {
  prepareFictionalDocuments,
  enableFictionalPolicy,
  onboardingFixtures,
} from '../authenticated/onboarding-fixtures';
import {
  prepareFictionalCheckoutPolicies,
  checkoutFixtures,
} from '../authenticated/checkout-fixtures';
import messages from '../../../src/messages/ko.json' with { type: 'json' };

export const appOrigin = 'http://127.0.0.1:3100';
export const providerOrigin = 'http://127.0.0.1:3200';
const supabaseOrigin = 'http://127.0.0.1:54321';
const tossSdkUrl = 'https://js.tosspayments.com/v2/standard';
const externalRequests = new WeakMap<BrowserContext, number>();
export type Identity = {
  id: string;
  artist: { id: string; slug: string; name: string };
  signIn(context: BrowserContext): Promise<void>;
  actorClient(): Promise<SupabaseClient<Database>>;
};
function credentials() {
  assert.equal(process.env.CI, 'true');
  assert.equal(process.env.GITHUB_ACTIONS, 'true');
  assert.equal(process.env.AUTH_LOCAL_E2E, 'true');
  assert.equal(process.env.ENROLLMENT_LOCAL_E2E, 'true');
  assert.equal(process.env.NEXT_PUBLIC_APP_URL, appOrigin);
  assert.equal(process.env.NEXT_PUBLIC_SUPABASE_URL, supabaseOrigin);
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.AUTH_TEST_SERVICE_KEY;
  assert.ok(anonKey && serviceKey);
  return { anonKey, serviceKey };
}
export function localSql(sql: string) {
  credentials();
  assert.ok(!process.env.DOCKER_HOST && !process.env.DOCKER_CONTEXT);
  assert.equal(
    execFileSync('docker', ['context', 'show'], { encoding: 'utf8' }).trim(),
    'default',
  );
  assert.ok(
    execFileSync(
      'docker',
      [
        '--context',
        'default',
        'context',
        'inspect',
        '--format',
        '{{.Endpoints.docker.Host}}',
      ],
      { encoding: 'utf8' },
    )
      .trim()
      .startsWith('unix://'),
  );
  return execFileSync(
    'docker',
    [
      '--context',
      'default',
      'exec',
      '-i',
      'supabase_db_trot-you',
      'psql',
      '-X',
      '-q',
      '-t',
      '-A',
      '-v',
      'ON_ERROR_STOP=1',
      '-U',
      'postgres',
      '-d',
      'postgres',
    ],
    { input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
  ).trim();
}
function uuid(value: string) {
  assert.match(
    value,
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );
  return value;
}
export function preparePolicies() {
  prepareFictionalDocuments();
  prepareFictionalCheckoutPolicies();
}
export function activatePolicies() {
  enableFictionalPolicy();
  localSql(
    `insert into private.checkout_policy_current(singleton,policy_version) values(true,'${checkoutFixtures.policy}') on conflict(singleton) do update set policy_version=excluded.policy_version;`,
  );
}
export function rotatePolicy() {
  localSql(
    `update private.checkout_policy_current set policy_version='${checkoutFixtures.nextPolicy}' where singleton;`,
  );
}
export function expireCheckout(actor: Identity) {
  localSql(
    `update private.checkout_sessions s set created_at=clock_timestamp()-interval '16 minutes',expires_at=clock_timestamp()-interval '1 minute' where user_id='${uuid(actor.id)}' and artist_id='${uuid(actor.artist.id)}' and exists(select 1 from auth.users u where u.id=s.user_id and u.email ~ '^enrollment-e2e-[0-9a-f-]{36}@example[.]invalid$');`,
  );
}
export function snapshot(actor: Identity) {
  return JSON.parse(
    localSql(`select jsonb_build_object(
    'subscriptions',(select coalesce(jsonb_agg(jsonb_build_object('status',s.status,'introUsed',s.intro_redeemed_at is not null)), '[]'::jsonb) from public.subscriptions s where s.user_id=u.id),
    'payments',(select count(*) from public.payment_events p join public.subscriptions s on s.id=p.subscription_id where s.user_id=u.id),
    'paidAmount',(select coalesce(sum(p.amount_krw),0) from public.payment_events p join public.subscriptions s on s.id=p.subscription_id where s.user_id=u.id),
    'credentials',(select count(*) from private.enrollment_credentials v join private.subscription_enrollments e on e.credential_ref=v.id where e.user_id=u.id),
    'reconciliations',(select count(*) from private.enrollment_reconciliations r join private.subscription_enrollments e on e.session_id=r.session_id where e.user_id=u.id),
    'enrollments',(select coalesce(jsonb_agg(jsonb_build_object('state',e.state,'stage',e.stage)), '[]'::jsonb) from private.subscription_enrollments e where e.user_id=u.id))
    from auth.users u where u.id='${uuid(actor.id)}' and u.email ~ '^enrollment-e2e-[0-9a-f-]{36}@example[.]invalid$';`),
  ) as {
    subscriptions: { status: string; introUsed: boolean }[];
    payments: number;
    paidAmount: number;
    credentials: number;
    reconciliations: number;
    enrollments: { state: string; stage: string | null }[];
  };
}
export const test = base.extend<{ identity: () => Promise<Identity> }>({
  identity: async ({}, provide) => {
    const { anonKey, serviceKey } = credentials();
    const admin = createClient<Database>(supabaseOrigin, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    await provide(async () => {
      const email = `enrollment-e2e-${randomUUID()}@example.invalid`;
      const password = randomBytes(32).toString('base64url');
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { role: 'admin' },
      });
      assert.equal(error, null);
      assert.ok(data.user);
      const id = data.user.id;
      const artist = {
        id: randomUUID(),
        slug: `ci-enrollment-${randomUUID()}`,
        name: '허구 구독 가수',
      };
      assert.equal(
        (
          await admin.from('artists').insert({
            ...artist,
            intro: '격리 CI용 허구 가수입니다.',
            grade: 'B',
            status: 'active',
          })
        ).error,
        null,
      );
      async function actorClient() {
        const client = createClient<Database>(supabaseOrigin, anonKey, {
          auth: { persistSession: false, autoRefreshToken: false },
        });
        assert.equal(
          (await client.auth.signInWithPassword({ email, password })).error,
          null,
        );
        return client;
      }
      return {
        id,
        artist,
        actorClient,
        async signIn(context) {
          const jar = new Map<string, { name: string; value: string }>();
          const client = createServerClient<Database>(supabaseOrigin, anonKey, {
            cookieOptions: {
              httpOnly: true,
              sameSite: 'lax',
              secure: false,
              path: '/',
            },
            cookies: {
              getAll: () => Array.from(jar.values()),
              setAll: (values) => {
                for (const value of values) jar.set(value.name, value);
              },
            },
          });
          assert.equal(
            (await client.auth.signInWithPassword({ email, password })).error,
            null,
          );
          await context.addCookies(
            Array.from(jar.values()).map(({ name, value }) => ({
              name,
              value,
              url: appOrigin,
              httpOnly: true,
              secure: false,
              sameSite: 'Lax',
            })),
          );
        },
      };
    });
    // Launched enrollment creates intentionally retained financial identity/FKs.
    // Do not disable immutable triggers or delete retained ledgers for cleanup.
    // This dedicated CI job destroys its whole disposable Supabase stack instead.
  },
});
export { expect };
export async function completeOnboarding(
  actor: Identity,
  scale: 'normal' | 'large' | 'xlarge' = 'large',
) {
  const client = await actor.actorClient();
  for (const result of [
    await client.rpc('onboarding_save_font', { p_font_scale: scale }),
    await client.rpc('onboarding_save_name', { p_call_name: '허구팬' }),
    await client.rpc('onboarding_complete_profile', {
      p_age_over_14: true,
      p_terms_accepted: true,
      p_terms_version: onboardingFixtures.terms,
      p_privacy_accepted: true,
      p_privacy_version: onboardingFixtures.privacy,
      p_analytics_granted: false,
    }),
    await client.rpc('discovery_select_artist', {
      p_artist_slug: actor.artist.slug,
    }),
    await client.rpc('onboarding_acknowledge_install', { p_choice: 'skipped' }),
    await client.rpc('onboarding_complete'),
  ])
    expect(result.error).toBeNull();
}
export async function installFakeBrowser(context: BrowserContext) {
  externalRequests.set(context, 0);
  await context.route(/^https?:\/\//, async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === appOrigin) return route.continue();
    if (url.href === tossSdkUrl)
      return route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: `window.TossPayments=function(){return {payment:function(identity){return {requestBillingAuth:async function(input){var target=new URL(input.successUrl);target.searchParams.set('authKey','ci_auth_'+identity.customerKey);target.searchParams.set('customerKey',identity.customerKey);window.location.assign(target.href);}}}}};`,
      });
    if (
      url.origin === 'https://online-pay.kakao.com' &&
      url.pathname === '/ci-enrollment'
    ) {
      const result = await context.request.get(
        `${providerOrigin}/__fixture/handoff`,
        { params: { tid: url.searchParams.get('tid') ?? '' } },
      );
      expect(result.ok()).toBe(true);
      const handoff = await result.json();
      const target = new URL(handoff.approvalUrl);
      expect(target.origin).toBe(appOrigin);
      target.searchParams.set('pg_token', handoff.pgToken);
      return route.fulfill({
        status: 302,
        headers: { location: target.href, 'cache-control': 'no-store' },
      });
    }
    externalRequests.set(context, (externalRequests.get(context) ?? 0) + 1);
    return route.abort('blockedbyclient');
  });
}
export function expectNoExternal(context: BrowserContext) {
  expect(externalRequests.get(context)).toBe(0);
}
export async function prepare(
  page: Page,
  actor: Identity,
  provider: CheckoutProvider = 'toss_card_billing',
) {
  await page.goto(checkoutPath(actor.artist.slug));
  await page
    .getByRole('radio', {
      name: new RegExp(messages.checkout.providers[provider]),
    })
    .check();
  await page
    .getByRole('checkbox', { name: messages.checkout.consent, exact: true })
    .check();
  const response = page.waitForResponse(
    (value) =>
      new URL(value.url()).pathname === routes.checkoutSubmit &&
      value.request().method() === 'POST',
  );
  await page
    .getByRole('button', { name: messages.checkout.prepare, exact: true })
    .click();
  const result = await response;
  expect(result.ok()).toBe(true);
  return (await result.json()).data.id as string;
}
export async function authorize(
  page: Page,
  provider: CheckoutProvider = 'toss_card_billing',
) {
  await page
    .getByRole('button', { name: messages.enrollment.start, exact: true })
    .click();
  await page
    .getByRole('button', {
      name:
        provider === 'toss_card_billing'
          ? messages.enrollment.openToss
          : messages.enrollment.openKakao,
      exact: true,
    })
    .click();
  await expect(
    page.getByText(messages.enrollment.statuses.awaiting_confirmation, {
      exact: true,
    }),
  ).toBeVisible();
}
export async function approve(page: Page) {
  await page
    .getByRole('checkbox', {
      name: messages.enrollment.chargeConsent.replace('{price}', '1,000'),
      exact: true,
    })
    .check();
  await page
    .getByRole('button', {
      name: messages.enrollment.confirm.replace('{price}', '1,000'),
      exact: true,
    })
    .click();
}
export async function screenshot(page: Page, info: TestInfo, name: string) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(await page.content()).not.toMatch(
    /ci_auth_|ci_billing_|ci_sid_|ci_pg_|authKey|pg_token/,
  );
  await page.screenshot({
    path: info.outputPath(`${name}.png`),
    fullPage: true,
  });
}
