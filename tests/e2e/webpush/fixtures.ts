import assert from 'node:assert/strict';
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
import { WEBPUSH_CI_ENV } from '../../../scripts/webpush-local-fixtures.mjs';
import {
  webpushProfileFixtureSql,
  webpushCaptureScale,
  WEBPUSH_FIXTURE_CALL_NAME,
} from './profile-fixture';
import {
  prepareFictionalDocuments,
  enableFictionalPolicy,
  onboardingFixtures,
} from '../authenticated/onboarding-fixtures';

export const appOrigin = 'http://127.0.0.1:3100';
export const storageOrigin = 'http://127.0.0.1:54321';
export const callName = WEBPUSH_FIXTURE_CALL_NAME;
const externalRequests = new WeakMap<BrowserContext, string[]>();
export type Identity = {
  id: string;
  signIn(context: BrowserContext): Promise<void>;
  actorClient(): Promise<SupabaseClient<Database>>;
};
export type Artist = { id: string; slug: string; name: string };
export type World = {
  other: Identity;
  artistAccount: Identity;
  fan: Identity;
  artist: Artist;
};
function credentials() {
  assert.equal(process.env.CI, 'true');
  assert.equal(process.env.GITHUB_ACTIONS, 'true');
  assert.equal(process.env.AUTH_LOCAL_E2E, 'true');
  assert.ok(
    Object.entries(WEBPUSH_CI_ENV).every(
      ([key, value]) => process.env[key] === value,
    ),
    'Only the explicit synthetic Web Push fixture configuration is allowed.',
  );
  assert.ok(!process.env.WEBPUSH_CRON_SECRET);
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
  localSql(`insert into private.notification_policy(singleton,version,consent_version,webpush_enabled,max_attempts,retry_seconds,lease_seconds,schedule_lead_seconds)
    values(true,'fictional-webpush-ci-only','fictional-webpush-consent-v1',true,3,60,30,86400)
    on conflict(singleton) do update set version=excluded.version,consent_version=excluded.consent_version,webpush_enabled=excluded.webpush_enabled,max_attempts=excluded.max_attempts,retry_seconds=excluded.retry_seconds,lease_seconds=excluded.lease_seconds,schedule_lead_seconds=excluded.schedule_lead_seconds;`);
}
export async function createIdentity(
  role: 'artist' | 'fan',
): Promise<Identity> {
  const { anonKey, serviceKey } = credentials();
  const admin = createClient<Database>(storageOrigin, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const email = `webpush-e2e-${randomUUID()}@example.invalid`;
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
  const profileSetup = webpushProfileFixtureSql(id, role);
  if (profileSetup !== null) localSql(profileSetup);
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
    const other = await createIdentity('fan');
    const artistAccount = await createIdentity('artist');
    const fan = await createIdentity('fan');
    const artist = {
      id: randomUUID(),
      slug: `ci-webpush-${randomUUID()}`,
      name: '허구 알림 가수',
    };
    localSql(`insert into public.artists(id,slug,name,intro,grade,status) values('${uuid(artist.id)}','${artist.slug}','${artist.name}','격리 CI에서 알림 설정만 확인하는 허구 가수입니다.','B','active');
      insert into public.artist_members(artist_id,user_id) values('${uuid(artist.id)}','${uuid(artistAccount.id)}');`);
    await provide({
      other,
      artistAccount,
      fan,
      artist,
    });
    // FK-bound content and auth identities intentionally remain until this
    // dedicated CI job destroys the whole disposable stack; no trigger bypass.
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
export async function screenshot(page: Page, info: TestInfo, name: string) {
  const scale = webpushCaptureScale(info.title);
  if (scale)
    await expect(page.locator('html')).toHaveAttribute(
      'data-font-scale',
      scale,
    );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(await page.locator('body').innerText()).not.toMatch(
    /service_role|user_id|subscription_id|AUTH_TEST_SERVICE_KEY|webpush-e2e-.*@example[.]invalid/,
  );
  await page.screenshot({
    path: info.outputPath(`${name}.png`),
    fullPage: true,
  });
}
export function setFont(actor: Identity, scale: 'normal' | 'large' | 'xlarge') {
  assert.ok(['normal', 'large', 'xlarge'].includes(scale));
  localSql(
    `update public.profiles set font_scale='${scale}' where id='${uuid(actor.id)}' and exists(select 1 from auth.users where id='${uuid(actor.id)}' and email ~ '^webpush-e2e-[0-9a-f-]{36}@example[.]invalid$');`,
  );
}
export function restrict(actor: Identity, restricted = true) {
  assert.equal(typeof restricted, 'boolean');
  localSql(
    `update public.profiles set is_restricted=${restricted},restricted_until=null where id='${uuid(actor.id)}' and exists(select 1 from auth.users where id='${uuid(actor.id)}' and email ~ '^webpush-e2e-[0-9a-f-]{36}@example[.]invalid$');`,
  );
}
export function setRole(actor: Identity, role: 'fan' | 'artist' | 'admin') {
  assert.ok(['fan', 'artist', 'admin'].includes(role));
  localSql(
    `update public.profiles set role='${role}' where id='${uuid(actor.id)}' and exists(select 1 from auth.users where id='${uuid(actor.id)}' and email ~ '^webpush-e2e-[0-9a-f-]{36}@example[.]invalid$');`,
  );
}
export function deviceSummary(actor: Identity) {
  return JSON.parse(
    localSql(`select jsonb_build_object(
    'active',(select count(*) from private.push_subscriptions where user_id='${uuid(actor.id)}' and state='active'),
    'revoked',(select count(*) from private.push_subscriptions where user_id='${uuid(actor.id)}' and state='revoked'),
    'jobs',(select count(*) from private.notification_jobs where user_id='${uuid(actor.id)}'),
    'webpushEnabled',coalesce((select webpush_enabled from private.notification_preferences where user_id='${uuid(actor.id)}'),false),
    'newMessage',coalesce((select new_message from private.notification_preferences where user_id='${uuid(actor.id)}'),false)
  ) where exists(select 1 from auth.users where id='${uuid(actor.id)}' and email ~ '^webpush-e2e-[0-9a-f-]{36}@example[.]invalid$');`),
  ) as {
    active: number;
    revoked: number;
    jobs: number;
    webpushEnabled: boolean;
    newMessage: boolean;
  };
}
export function notificationPolicy(enabled: boolean) {
  assert.equal(typeof enabled, 'boolean');
  localSql(
    `update private.notification_policy set webpush_enabled=${enabled} where version='fictional-webpush-ci-only';`,
  );
}
export function rotateNotificationConsent() {
  localSql(
    "update private.notification_policy set consent_version='fictional-webpush-consent-v2' where version='fictional-webpush-ci-only';",
  );
}
