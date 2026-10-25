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
import {
  activityProfileFixtureSql,
  activityCaptureScale,
  ACTIVITY_FIXTURE_CALL_NAME,
} from './profile-fixture';
import {
  prepareFictionalDocuments,
  enableFictionalPolicy,
  onboardingFixtures,
} from '../authenticated/onboarding-fixtures';

export const appOrigin = 'http://127.0.0.1:3100';
export const storageOrigin = 'http://127.0.0.1:54321';
export const callName = ACTIVITY_FIXTURE_CALL_NAME;
const externalRequests = new WeakMap<BrowserContext, string[]>();
export type Identity = {
  id: string;
  signIn(context: BrowserContext): Promise<void>;
  actorClient(): Promise<SupabaseClient<Database>>;
};
export type Artist = { id: string; slug: string; name: string };
export type World = {
  author: Identity;
  outsider: Identity;
  fan: Identity;
  artist: Artist;
};
function credentials() {
  assert.equal(process.env.CI, 'true');
  assert.equal(process.env.GITHUB_ACTIONS, 'true');
  assert.equal(process.env.AUTH_LOCAL_E2E, 'true');
  assert.equal(process.env.ACTIVITY_LOCAL_E2E, 'true');
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
  localSql(`insert into private.message_policy(
    version,history_before_seconds,cancel_window_seconds,max_text_length,
    max_reply_length,max_photos,max_voice_seconds,max_video_seconds,preview_max_count,
    max_photo_bytes,max_voice_bytes,max_video_bytes)
    values('fictional-activity-ci-only',604800,300,1000,100,2,180,60,5,1048576,20971520,104857600)
    on conflict(singleton) do update set version=excluded.version,
      history_before_seconds=excluded.history_before_seconds,cancel_window_seconds=excluded.cancel_window_seconds,
      max_text_length=excluded.max_text_length,max_reply_length=excluded.max_reply_length,
      max_photos=excluded.max_photos,max_voice_seconds=excluded.max_voice_seconds,
      max_video_seconds=excluded.max_video_seconds,preview_max_count=excluded.preview_max_count,
      max_photo_bytes=excluded.max_photo_bytes,max_voice_bytes=excluded.max_voice_bytes,
      max_video_bytes=excluded.max_video_bytes;`);
}
export async function createIdentity(
  role: 'artist' | 'fan',
): Promise<Identity> {
  const { anonKey, serviceKey } = credentials();
  const admin = createClient<Database>(storageOrigin, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const email = `activity-e2e-${randomUUID()}@example.invalid`;
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
  const profileSetup = activityProfileFixtureSql(id, role);
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
    const author = await createIdentity('artist');
    const outsider = await createIdentity('artist');
    const fan = await createIdentity('fan');
    const artist = {
      id: randomUUID(),
      slug: `ci-activity-${randomUUID()}`,
      name: '허구 답장 가수',
    };
    localSql(`insert into public.artists(id,slug,name,intro,grade,status) values('${uuid(artist.id)}','${artist.slug}','${artist.name}','격리 CI에서 받은 답장과 활동량만 확인하는 허구 가수입니다.','B','active');
      insert into public.artist_members(artist_id,user_id) values('${uuid(artist.id)}','${uuid(author.id)}');`);
    await provide({
      author,
      outsider,
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
  const scale = activityCaptureScale(info.title);
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
    /service_role|user_id|subscription_id|AUTH_TEST_SERVICE_KEY|activity-e2e-.*@example[.]invalid/,
  );
  await page.screenshot({
    path: info.outputPath(`${name}.png`),
    fullPage: true,
  });
}
export function setFont(actor: Identity, scale: 'normal' | 'large' | 'xlarge') {
  assert.ok(['normal', 'large', 'xlarge'].includes(scale));
  localSql(
    `update public.profiles set font_scale='${scale}' where id='${uuid(actor.id)}' and exists(select 1 from auth.users where id='${uuid(actor.id)}' and email ~ '^activity-e2e-[0-9a-f-]{36}@example[.]invalid$');`,
  );
}
export function restrict(actor: Identity, restricted = true) {
  assert.equal(typeof restricted, 'boolean');
  localSql(
    `update public.profiles set is_restricted=${restricted},restricted_until=null where id='${uuid(actor.id)}' and exists(select 1 from auth.users where id='${uuid(actor.id)}' and email ~ '^activity-e2e-[0-9a-f-]{36}@example[.]invalid$');`,
  );
}
export function setRole(actor: Identity, role: 'fan' | 'artist' | 'admin') {
  assert.ok(['fan', 'artist', 'admin'].includes(role));
  localSql(
    `update public.profiles set role='${role}' where id='${uuid(actor.id)}' and exists(select 1 from auth.users where id='${uuid(actor.id)}' and email ~ '^activity-e2e-[0-9a-f-]{36}@example[.]invalid$');`,
  );
}
export function removeMembership(world: World) {
  localSql(
    `delete from public.artist_members where artist_id='${uuid(world.artist.id)}' and user_id='${uuid(world.author.id)}';`,
  );
}
export function addMembership(world: World, actor = world.author) {
  localSql(
    `insert into public.artist_members(artist_id,user_id) values('${uuid(world.artist.id)}','${uuid(actor.id)}') on conflict do nothing;`,
  );
}
export function setArtistActive(world: World, active: boolean) {
  assert.equal(typeof active, 'boolean');
  localSql(
    `update public.artists set status='${active ? 'active' : 'paused'}' where id='${uuid(world.artist.id)}' and slug like 'ci-activity-%';`,
  );
}
export function subscribe(world: World) {
  localSql(`insert into public.subscriptions(user_id,artist_id,provider,status,first_started_at,episode_started_at,current_period_start,current_period_end)
    values('${uuid(world.fan.id)}','${uuid(world.artist.id)}','toss','active',now()-interval '1 day',now()-interval '1 day',now()-interval '1 day',now()+interval '1 day')
    on conflict(user_id,artist_id) do nothing;`);
}
export function seedMessages(world: World, count = 2) {
  assert.ok(Number.isInteger(count) && count > 0 && count <= 110);
  const rows = Array.from({ length: count }, (_, index) => ({
    id: randomUUID(),
    kind: index === 0 ? 'photo' : 'text',
  }));
  // Read-only source fixtures, not publication/upload evidence. Identical time
  // stamps exercise the UUID pagination tie-breaker. No actual media is read.
  localSql(`insert into public.messages(id,artist_id,author_id,type,body,status,scheduled_at,sent_at)
    values ${rows.map((row) => `('${uuid(row.id)}','${uuid(world.artist.id)}','${uuid(world.author.id)}','${row.kind}','허구 활동 메시지','sent',statement_timestamp(),statement_timestamp())`).join(',')};`);
  return rows.sort((a, b) => b.id.localeCompare(a.id));
}
export function seedExcludedMessages(world: World) {
  localSql(`insert into public.messages(artist_id,author_id,type,body,status,scheduled_at,sent_at,canceled_at) values
    ('${uuid(world.artist.id)}','${uuid(world.author.id)}','text','허구 이전 주','sent',(date_trunc('week',now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul')-interval '1 microsecond',(date_trunc('week',now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul')-interval '1 microsecond',null),
    ('${uuid(world.artist.id)}','${uuid(world.author.id)}','text','허구 예약','scheduled',now()+interval '1 day',null,null),
    ('${uuid(world.artist.id)}','${uuid(world.author.id)}','text','허구 취소','canceled',now()-interval '2 minutes',now()-interval '2 minutes',now()-interval '1 minute'),
    ('${uuid(world.artist.id)}','${uuid(world.author.id)}','text','허구 미래 발송','sent',now()+interval '1 day',now()+interval '1 day',null),
    ('${uuid(world.artist.id)}','${uuid(world.author.id)}','text','허구 초안','draft',null,null,null);`);
}
export function seedReplies(
  world: World,
  count = 35,
  messageId: string | null = null,
) {
  assert.ok(Number.isInteger(count) && count > 0 && count <= 110);
  const rows = Array.from({ length: count }, (_, index) => ({
    id: randomUUID(),
    body: `허구 받은 답장 ${String(index + 1).padStart(3, '0')} <strong>문자 그대로</strong>`,
  }));
  localSql(`insert into public.replies(id,user_id,artist_id,subscription_id,message_id,body,created_at)
    select x.id,'${uuid(world.fan.id)}','${uuid(world.artist.id)}',s.id,${messageId === null ? 'null' : `'${uuid(messageId)}'::uuid`},x.body,statement_timestamp()-interval '1 minute'
    from public.subscriptions s cross join (values ${rows.map((row) => `('${uuid(row.id)}'::uuid,'${row.body}')`).join(',')}) x(id,body)
    where s.user_id='${uuid(world.fan.id)}' and s.artist_id='${uuid(world.artist.id)}';`);
  return rows.sort((a, b) => b.id.localeCompare(a.id));
}
export function blockReply(world: World, replyId: string, blocked = true) {
  assert.equal(typeof blocked, 'boolean');
  localSql(
    `update public.replies set is_blocked=${blocked} where id='${uuid(replyId)}' and user_id='${uuid(world.fan.id)}' and artist_id='${uuid(world.artist.id)}';`,
  );
}
export function addArtists(world: World, count: number): Artist[] {
  assert.ok(Number.isInteger(count) && count >= 1 && count <= 60);
  const artists = Array.from({ length: count }, (_, index) => ({
    id: randomUUID(),
    slug: `ci-activity-extra-${randomUUID()}`,
    name: `허구 답장 가수 ${index + 1}`,
  }));
  localSql(`insert into public.artists(id,slug,name,intro,grade,status) values
    ${artists.map((artist) => `('${uuid(artist.id)}','${artist.slug}','${artist.name}','격리 CI의 가수 선택 점검용 허구 가수입니다.','B','active')`).join(',')};
    insert into public.artist_members(artist_id,user_id) values
    ${artists.map((artist) => `('${uuid(artist.id)}','${uuid(world.author.id)}')`).join(',')};`);
  return artists;
}
export function sourceSnapshot(world: World) {
  return localSql(`select jsonb_build_object(
    'messages',(select count(*) from public.messages where artist_id='${uuid(world.artist.id)}'),
    'replies',(select count(*) from public.replies where artist_id='${uuid(world.artist.id)}'),
    'payments',(select count(*) from public.payment_events),
    'notifications',(select count(*) from private.notification_jobs),
    'reports',(select count(*) from public.settlements));`);
}
export function enableActivityRequirements(world: World) {
  // Whole KST-week coverage across month boundaries; financial fields exist
  // only to satisfy the established reporting-policy schema, never a payout.
  localSql(`insert into private.settlement_policies(artist_id,month,enabled,contract_from,contract_until,base_rate,performance_rate,vat_rate,pg_fee_rate,activity_enabled,weekly_message_min,weekly_photo_min,partial_week_policy)
    select '${uuid(world.artist.id)}',month::date,true,w::date,(w+interval '7 days')::date,0.3,0.4,0.1,0.03,true,3,2,'prorate_days'
    from (select date_trunc('week',now() at time zone 'Asia/Seoul') w) week
    cross join lateral generate_series(date_trunc('month',w),date_trunc('month',w+interval '6 days'),interval '1 month') month
    on conflict(artist_id,month) do update set enabled=true,contract_from=excluded.contract_from,contract_until=excluded.contract_until,activity_enabled=true,weekly_message_min=3,weekly_photo_min=2;`);
}
export function disableActivityRequirements(world: World) {
  localSql(
    `update private.settlement_policies set enabled=false where artist_id='${uuid(world.artist.id)}';`,
  );
}
export function cancelLinkedMessage(world: World, messageId: string) {
  localSql(
    `update public.messages set status='canceled',canceled_at=clock_timestamp() where id='${uuid(messageId)}' and artist_id='${uuid(world.artist.id)}' and status='sent';`,
  );
}
export function deleteReply(world: World, replyId: string) {
  // Physical fictional source deletion, not a new user-facing moderation flow.
  localSql(
    `delete from public.replies where id='${uuid(replyId)}' and user_id='${uuid(world.fan.id)}' and artist_id='${uuid(world.artist.id)}';`,
  );
}
