import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import {
  test as base,
  expect,
  type APIRequestContext,
  type BrowserContext,
  type Page,
  type TestInfo,
} from '@playwright/test';
import { ANALYTICS_FUNNEL_CI_ENV } from '../../../scripts/analytics-funnel-local-config.mjs';
import type { Database } from '../../../src/types/database';
import { ANALYTICS_FUNNEL } from '../../../src/config/analytics-funnel';
import { analyticsSourceSql } from './source-fixture';
import { captureSettledAnalyticsFunnel } from './screenshot-capture';
import { blockAnalyticsExternalRequests } from './external-guard';

export const appOrigin = 'http://127.0.0.1:3100';
export const databaseOrigin = 'http://127.0.0.1:54321';
export type Scale = 'normal' | 'large' | 'xlarge';
export type Identity = {
  id: string;
  signIn(context: BrowserContext): Promise<void>;
};
export type World = {
  admin: Identity;
  other: Identity;
  fan: Identity;
  policy: string;
  range: { from: string; to: string };
  emptyDate: string;
};
const externalRequests = new WeakMap<BrowserContext, string[]>();
function credentials() {
  assert.equal(process.env.CI, 'true');
  assert.equal(process.env.GITHUB_ACTIONS, 'true');
  assert.equal(process.env.AUTH_LOCAL_E2E, 'true');
  assert.equal(process.env.ANALYTICS_FUNNEL_LOCAL_E2E, 'true');
  assert.equal(process.env.NEXT_PUBLIC_APP_URL, appOrigin);
  assert.equal(process.env.NEXT_PUBLIC_SUPABASE_URL, databaseOrigin);
  for (const [key, value] of Object.entries(ANALYTICS_FUNNEL_CI_ENV))
    assert.ok(
      process.env[key] === value,
      'Only the exact isolated fixture settings are allowed.',
    );
  assert.ok(
    !process.env.SUPABASE_ACCESS_TOKEN && !process.env.SUPABASE_DB_PASSWORD,
  );
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.AUTH_TEST_SERVICE_KEY;
  assert.ok(anonKey && serviceKey);
  return { anonKey, serviceKey };
}
// Only the dedicated opted-in hosted CI job imports this fixture. The local
// stack is disposable; no arbitrary project/container or provider is accepted.
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
export function literal(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}
export async function createIdentity(
  role: 'admin' | 'fan' | 'artist',
): Promise<Identity> {
  const { anonKey, serviceKey } = credentials();
  const service = createClient<Database>(databaseOrigin, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const email = `analytics-funnel-e2e-${randomUUID()}@example.invalid`;
  const password = randomBytes(32).toString('base64url');
  const { data, error } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  assert.equal(error, null);
  assert.ok(data.user);
  const id = data.user.id;
  // Fictional CI identity setup, not a production role or consent workflow.
  localSql(`update public.profiles set role='${role}',call_name='허구팬',onboarding_completed_at=clock_timestamp()
    where id='${uuid(id)}' and exists(select 1 from auth.users where id='${uuid(id)}' and email ~ '^analytics-funnel-e2e-[0-9a-f-]{36}@example[.]invalid$');`);
  return {
    id,
    async signIn(context) {
      await context.clearCookies();
      const jar = new Map<string, { name: string; value: string }>();
      const client = createServerClient<Database>(databaseOrigin, anonKey, {
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

export const test = base.extend<{ world: World }>({
  world: async ({}, provide) => {
    const admin = await createIdentity('admin');
    const other = await createIdentity('admin');
    const fan = await createIdentity('fan');
    const policy = randomUUID();
    const seeded = JSON.parse(
      localSql(analyticsSourceSql(uuid(fan.id), uuid(policy))),
    ) as {
      from: string;
      to: string;
      emptyDate: string;
    };
    await provide({
      admin,
      other,
      fan,
      policy,
      range: { from: seeded.from, to: seeded.to },
      emptyDate: seeded.emptyDate,
    });
    // A fresh fictional consent version isolates the next test. Retained rows
    // stay untouched until this dedicated job destroys its disposable stack.
  },
});
export { expect };
export function get(request: APIRequestContext, path: string, actor: Identity) {
  return request.get(path, {
    headers: { [ANALYTICS_FUNNEL.actorHeader]: actor.id },
  });
}
export async function blockExternal(context: BrowserContext) {
  externalRequests.set(
    context,
    await blockAnalyticsExternalRequests(context, [appOrigin, databaseOrigin]),
  );
}
export function expectNoExternal(context: BrowserContext) {
  expect(externalRequests.get(context)).toEqual([]);
}
export async function assertRenderedScale(page: Page, scale: Scale) {
  await expect(page.locator('html')).toHaveAttribute('data-font-scale', scale);
  await expect(page.locator('body')).toHaveCSS(
    'font-size',
    { normal: '18px', large: '21px', xlarge: '25px' }[scale],
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(await page.locator('body').innerText()).not.toMatch(
    /AUTH_TEST_SERVICE_KEY|SUPABASE_SERVICE_ROLE_KEY|analytics-funnel-e2e-.*@example[.]invalid/,
  );
}
export async function screenshot(
  page: Page,
  info: TestInfo,
  name: string,
  scale: Scale,
) {
  await assertRenderedScale(page, scale);
  await captureSettledAnalyticsFunnel(page, info.outputPath(`${name}.png`));
}
export function setFont(actor: Identity, scale: Scale) {
  assert.ok(['normal', 'large', 'xlarge'].includes(scale));
  localSql(
    `update public.profiles set font_scale='${scale}' where id='${uuid(actor.id)}' and exists(select 1 from auth.users where id='${uuid(actor.id)}' and email ~ '^analytics-funnel-e2e-[0-9a-f-]{36}@example[.]invalid$');`,
  );
}
export function setRole(actor: Identity, role: 'fan' | 'admin') {
  assert.ok(['fan', 'admin'].includes(role));
  localSql(
    `update public.profiles set role='${role}' where id='${uuid(actor.id)}' and exists(select 1 from auth.users where id='${uuid(actor.id)}' and email ~ '^analytics-funnel-e2e-[0-9a-f-]{36}@example[.]invalid$');`,
  );
}
export function setRestricted(actor: Identity, restricted: boolean) {
  assert.equal(typeof restricted, 'boolean');
  localSql(
    `update public.profiles set is_restricted=${restricted},restricted_until=null where id='${uuid(actor.id)}' and exists(select 1 from auth.users where id='${uuid(actor.id)}' and email ~ '^analytics-funnel-e2e-[0-9a-f-]{36}@example[.]invalid$');`,
  );
}
export function setPolicy(enabled: boolean) {
  assert.equal(typeof enabled, 'boolean');
  localSql(`update private.analytics_policy set enabled=${enabled};`);
}
export function removePolicy() {
  localSql('delete from private.analytics_policy;');
}
export function setConsent(actor: Identity, policy: string, granted: boolean) {
  assert.equal(typeof granted, 'boolean');
  localSql(
    `begin; set local role authenticated; set local "request.jwt.claim.sub"='${uuid(actor.id)}'; select public.analytics_set_consent(${granted},'${uuid(policy)}'); commit;`,
  );
}
export function analyticsFingerprint(actor: Identity) {
  return localSql(
    `select md5(coalesce(jsonb_agg(to_jsonb(e) order by e.id),'[]'::jsonb)::text) from private.analytics_events e where user_id='${uuid(actor.id)}';`,
  );
}
export function unrelatedFingerprint() {
  return localSql(
    `select md5(jsonb_build_object('payments',(select count(*) from public.payment_events),'points',(select count(*) from private.point_ledger),'notifications',(select count(*) from private.notification_jobs),'settlements',(select count(*) from public.settlements))::text);`,
  );
}

export async function prepareVisiblePreview(world: World) {
  const author = await createIdentity('artist');
  const replacement = await createIdentity('fan');
  const artist = {
    id: randomUUID(),
    slug: `analytics-preview-${randomUUID()}`,
    name: '허구 분석 맛보기 가수',
  };
  const messageId = randomUUID(),
    terms = randomUUID(),
    privacy = randomUUID();
  // Fictional onboarding/message policy is confined to this opted-in stack.
  // All actor/source protections remain enabled and all consent choices belong
  // only to explicitly synthetic accounts created by this fixture.
  localSql(`insert into private.onboarding_documents(version,kind,title,body,approved_at,published_at) values
    ('${uuid(terms)}','terms','Synthetic preview terms','Fictional CI only.',clock_timestamp(),clock_timestamp()),
    ('${uuid(privacy)}','privacy','Synthetic preview privacy','Fictional CI only.',clock_timestamp(),clock_timestamp());
    insert into private.profile_onboarding_policy(singleton,name_policy_version,name_approved_at,call_name_min,call_name_max,profanity_words,terms_version,privacy_version,analytics_version)
    values(true,gen_random_uuid(),clock_timestamp(),2,10,array['fixture-forbidden'], '${uuid(terms)}','${uuid(privacy)}','${uuid(world.policy)}')
    on conflict(singleton) do update set name_policy_version=excluded.name_policy_version,name_approved_at=excluded.name_approved_at,call_name_min=excluded.call_name_min,call_name_max=excluded.call_name_max,profanity_words=excluded.profanity_words,terms_version=excluded.terms_version,privacy_version=excluded.privacy_version,analytics_version=excluded.analytics_version;
    update public.profiles set font_selected_at=clock_timestamp(),age_self_attested_at=clock_timestamp(),profile_completed_at=clock_timestamp()
      where id in ('${uuid(world.fan.id)}','${uuid(replacement.id)}');
    insert into private.profile_policy_acceptances(user_id,kind,version,accepted_at)
      select actor.id,document.kind,document.version,clock_timestamp() from public.profiles actor cross join private.onboarding_documents document
      where actor.id in ('${uuid(world.fan.id)}','${uuid(replacement.id)}') and document.version in ('${uuid(terms)}','${uuid(privacy)}');
    insert into private.message_policy(version,history_before_seconds,cancel_window_seconds,max_text_length,max_reply_length,max_photos,max_voice_seconds,max_video_seconds,preview_max_count,max_photo_bytes,max_voice_bytes,max_video_bytes)
    values('synthetic-analytics-preview-only',604800,300,1000,100,2,180,60,5,1048576,20971520,104857600)
    on conflict(singleton) do update set version=excluded.version,preview_max_count=excluded.preview_max_count;
    insert into public.artists(id,slug,name,grade,status) values('${uuid(artist.id)}',${literal(artist.slug)},${literal(artist.name)},'B','active');
    insert into public.artist_members(artist_id,user_id) values('${uuid(artist.id)}','${uuid(author.id)}');
    insert into public.messages(id,artist_id,author_id,type,body,status,scheduled_at,sent_at,is_preview,preview_order)
    values('${uuid(messageId)}','${uuid(artist.id)}','${uuid(author.id)}','text','{이름} 님을 위한 격리 CI의 허구 맛보기입니다.','sent',clock_timestamp(),clock_timestamp(),true,1);`);
  setConsent(replacement, world.policy, true);
  return { artist, messageId, replacement };
}
