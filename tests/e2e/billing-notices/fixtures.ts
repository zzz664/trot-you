import assert from 'node:assert/strict';
import { BILLING_NOTICES_CI_ENV } from '../../../scripts/billing-notices-local-fixtures.mjs';
import {
  billingNoticePolicySql,
  billingNoticeSourceSql,
} from './source-fixture';
import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { createServerClient } from '@supabase/ssr';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  test as base,
  expect,
  type APIRequestContext,
  type BrowserContext,
  type Page,
  type TestInfo,
} from '@playwright/test';
import type { Database } from '../../../src/types/database';
import { billingNoticeCaptureScale } from './profile-fixture';
import {
  prepareFictionalDocuments,
  enableFictionalPolicy,
  onboardingFixtures,
} from '../authenticated/onboarding-fixtures';

export const appOrigin = 'http://127.0.0.1:3100';
export const storageOrigin = 'http://127.0.0.1:54321';
export const callName = '허구팬';
const externalRequests = new WeakMap<BrowserContext, string[]>();
export type Identity = {
  id: string;
  signIn(context: BrowserContext): Promise<void>;
  actorClient(): Promise<SupabaseClient<Database>>;
};
export type Artist = { id: string; slug: string; name: string };
export type World = {
  other: Identity;
  fan: Identity;
  artist: Artist;
};
function credentials() {
  assert.equal(process.env.CI, 'true');
  assert.equal(process.env.GITHUB_ACTIONS, 'true');
  assert.equal(process.env.AUTH_LOCAL_E2E, 'true');
  assert.equal(process.env.BILLING_NOTICES_LOCAL_E2E, 'true');
  assert.equal(
    process.env.BILLING_NOTICES_ENABLED,
    BILLING_NOTICES_CI_ENV.BILLING_NOTICES_ENABLED,
  );
  assert.ok(
    process.env.BILLING_NOTICES_CRON_SECRET ===
      BILLING_NOTICES_CI_ENV.BILLING_NOTICES_CRON_SECRET,
  );
  assert.equal(process.env.NEXT_PUBLIC_APP_URL, appOrigin);
  assert.equal(process.env.NEXT_PUBLIC_SUPABASE_URL, storageOrigin);
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
export function uuid(value: string) {
  assert.match(
    value,
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );
  return value;
}
export function preparePolicies() {
  prepareFictionalDocuments();
  enableFictionalPolicy();
}
export async function createIdentity(): Promise<Identity> {
  const { anonKey, serviceKey } = credentials();
  const admin = createClient<Database>(storageOrigin, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const email = `billing-notices-e2e-${randomUUID()}@example.invalid`;
  const password = randomBytes(32).toString('base64url');
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  assert.equal(error, null);
  assert.ok(data.user);
  const id = data.user.id;
  async function actorClient() {
    const client = createClient<Database>(storageOrigin, anonKey, {
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
    actorClient,
    async signIn(context) {
      await context.clearCookies();
      const jar = new Map<string, { name: string; value: string }>();
      const client = createServerClient<Database>(storageOrigin, anonKey, {
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
}
export async function completeProfile(
  actor: Identity,
  artist: Artist,
  scale: 'normal' | 'large' | 'xlarge' = 'large',
  full = true,
  name = callName,
) {
  const client = await actor.actorClient();
  for (const result of [
    await client.rpc('onboarding_save_font', { p_font_scale: scale }),
    await client.rpc('onboarding_save_name', { p_call_name: name }),
    await client.rpc('onboarding_complete_profile', {
      p_age_over_14: true,
      p_terms_accepted: true,
      p_terms_version: onboardingFixtures.terms,
      p_privacy_accepted: true,
      p_privacy_version: onboardingFixtures.privacy,
      p_analytics_granted: false,
    }),
    await client.rpc('discovery_select_artist', { p_artist_slug: artist.slug }),
  ])
    assert.equal(result.error, null);
  if (full) {
    assert.equal(
      (
        await client.rpc('onboarding_acknowledge_install', {
          p_choice: 'skipped',
        })
      ).error,
      null,
    );
    assert.equal((await client.rpc('onboarding_complete')).error, null);
  }
}
export const test = base.extend<{ world: World }>({
  world: async ({}, provide) => {
    const fan = await createIdentity();
    const other = await createIdentity();
    const artist = {
      id: randomUUID(),
      slug: `ci-billing-notices-${randomUUID()}`,
      name: '허구 결제 안내 가수',
    };
    localSql(
      `insert into public.artists(id,slug,name,intro,grade,status) values('${uuid(artist.id)}','${artist.slug}','${artist.name}','격리 CI의 결제 예정 안내용 허구 가수입니다.','B','active');`,
    );
    await provide({ fan, other, artist });
    // Bound immutable policies/source rows remain only until the dedicated CI
    // job destroys this disposable stack. No trigger bypass or provider call.
  },
});
export { expect };
export async function post(
  request: APIRequestContext,
  path: string,
  data: unknown = {},
) {
  return request.post(path, { headers: { Origin: appOrigin }, data });
}
export async function blockExternal(context: BrowserContext) {
  externalRequests.set(context, []);
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if ([appOrigin, storageOrigin].includes(url.origin))
      return route.continue();
    externalRequests.get(context)!.push(url.origin);
    return route.abort('blockedbyclient');
  });
}
export function expectNoExternal(context: BrowserContext) {
  expect(externalRequests.get(context)).toEqual([]);
}
export async function screenshot(
  page: Page,
  info: TestInfo,
  name: string,
  fullPage = true,
) {
  const scale = billingNoticeCaptureScale(info.title);
  if (scale) {
    await expect(page.locator('html')).toHaveAttribute(
      'data-font-scale',
      scale,
    );
    await expect(page.locator('body')).toHaveCSS(
      'font-size',
      { normal: '18px', large: '21px', xlarge: '25px' }[scale],
    );
  }
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(await page.locator('body').innerText()).not.toMatch(
    /service_role|user_id|subscription_id|AUTH_TEST_SERVICE_KEY|billing-notices-e2e-.*@example[.]invalid/,
  );
  await page.screenshot({
    path: info.outputPath(`${name}.png`),
    fullPage,
  });
}
export function setFont(actor: Identity, scale: 'normal' | 'large' | 'xlarge') {
  assert.ok(['normal', 'large', 'xlarge'].includes(scale));
  localSql(
    `update public.profiles set font_scale='${scale}' where id='${uuid(actor.id)}' and exists(select 1 from auth.users where id='${uuid(actor.id)}' and email ~ '^billing-notices-e2e-[0-9a-f-]{36}@example[.]invalid$');`,
  );
}
export function restrict(actor: Identity, restricted = true) {
  assert.equal(typeof restricted, 'boolean');
  localSql(
    `update public.profiles set is_restricted=${restricted},restricted_until=null where id='${uuid(actor.id)}' and exists(select 1 from auth.users where id='${uuid(actor.id)}' and email ~ '^billing-notices-e2e-[0-9a-f-]{36}@example[.]invalid$');`,
  );
}
export function setRole(actor: Identity, role: 'fan' | 'artist' | 'admin') {
  assert.ok(['fan', 'artist', 'admin'].includes(role));
  localSql(
    `update public.profiles set role='${role}' where id='${uuid(actor.id)}' and exists(select 1 from auth.users where id='${uuid(actor.id)}' and email ~ '^billing-notices-e2e-[0-9a-f-]{36}@example[.]invalid$');`,
  );
}

export type NoticeSource = { subscriptionId: string; artist: Artist };
export function seedSources(
  world: World,
  count = 1,
  mandatory = true,
): NoticeSource[] {
  assert.ok(Number.isInteger(count) && count >= 1 && count <= 55);
  localSql(billingNoticePolicySql(mandatory));
  const sources = Array.from({ length: count }, (_, index) => ({
    subscriptionId: randomUUID(),
    artist:
      index === 0
        ? world.artist
        : {
            id: randomUUID(),
            slug: `ci-billing-notices-${randomUUID()}`,
            name: `허구 결제 안내 가수 ${index + 1}`,
          },
  }));
  localSql(
    `begin;${sources
      .map(
        (
          source,
          index,
        ) => `${index === 0 ? '' : `insert into public.artists(id,slug,name,grade,status) values('${uuid(source.artist.id)}','${source.artist.slug}','${source.artist.name}','B','active');`}
    ${billingNoticeSourceSql(world.fan.id, source.artist.id, source.subscriptionId, mandatory)}`,
      )
      .join('\n')}commit;`,
  );
  return sources;
}
export function createNotices(sources: NoticeSource[]) {
  assert.ok(sources.length > 0 && sources.length <= 55);
  localSql(
    `begin; set local role service_role;${sources.map((source) => `select * from public.billing_notice_create('${uuid(source.subscriptionId)}');`).join('\n')}commit;`,
  );
  return noticeSnapshot(sources);
}
export function noticeSnapshot(sources: NoticeSource[]) {
  const ids = sources
    .map((source) => `'${uuid(source.subscriptionId)}'`)
    .join(',');
  return JSON.parse(
    localSql(`select jsonb_build_object(
    'notices',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'subscriptionId',subscription_id,'readAt',read_at,'invalidatedAt',invalidated_at) order by created_at desc,id desc),'[]'::jsonb) from private.billing_notices where subscription_id in(${ids})),
    'receipts',(select count(*) from private.renewal_notice_receipts where subscription_id in(${ids})),
    'payments',(select count(*) from public.payment_events where subscription_id in(${ids})),
    'attempts',(select count(*) from private.payment_attempts a join private.billing_obligations o on o.id=a.obligation_id where o.subscription_id in(${ids})),
    'pushJobs',(select count(*) from private.notification_jobs where billing_notice_id in(select id from private.billing_notices where subscription_id in(${ids}))))`),
  ) as {
    notices: {
      id: string;
      subscriptionId: string;
      readAt: string | null;
      invalidatedAt: string | null;
    }[];
    receipts: number;
    payments: number;
    attempts: number;
    pushJobs: number;
  };
}
export function cancelNoticeSource(source: NoticeSource) {
  localSql(
    `begin;set local role service_role;select public.cancel_subscription('${uuid(source.subscriptionId)}');commit;`,
  );
}
export function rescheduleNoticeSource(source: NoticeSource) {
  localSql(
    `update public.subscriptions set next_billing_at=next_billing_at+interval '1 day' where id='${uuid(source.subscriptionId)}';`,
  );
}
export function rotateNoticePolicy() {
  // A distinct approved checkout price has not been accepted by the old
  // mandate. Never project the new amount as though the fan agreed to it.
  localSql(`insert into private.checkout_policies(version,title,body,regular_price_krw,intro_price_krw,approved_at,published_at,billing_period_calendar,payment_tax_basis)
    values('c7300000-0000-4000-8000-000000000003','허구 변경 가격','격리 CI의 미수락 가격 변경 확인용 자료입니다.',8400,1200,clock_timestamp(),clock_timestamp(),'seoul_monthly_clamped','taxable_krw') on conflict(version) do nothing;
    update private.checkout_policy_current set policy_version='c7300000-0000-4000-8000-000000000003' where singleton;`);
}
export function makeNoticeUnknown(source: NoticeSource) {
  // Construct an unresolved fictional existing operation without asking any
  // provider or invoking a charge. The read model must suppress its preview.
  localSql(`insert into private.billing_obligations(subscription_id,mandate_id,period_start,period_end,amount_krw,currency,is_initial,is_intro,price_version,grace_seconds,retry_seconds,max_retries,next_attempt_at)
    select s.id,m.id,s.current_period_end,private.renewal_period_end(s.episode_started_at,s.current_period_end,'seoul_monthly_clamped'),7200,'KRW',false,false,m.consent_version,259200,86400,3,s.current_period_end
    from public.subscriptions s join private.payment_mandates m on m.subscription_id=s.id and m.is_active where s.id='${uuid(source.subscriptionId)}';
    insert into private.payment_attempts(obligation_id,ordinal,state) select id,1,'unknown' from private.billing_obligations where subscription_id='${uuid(source.subscriptionId)}' and state='open';`);
}
