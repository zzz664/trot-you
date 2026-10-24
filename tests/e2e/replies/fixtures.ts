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
export type World = { author: Identity; fan: Identity; artist: Artist };
export type SeededMessage = { id: string; text: string };
function credentials() {
  assert.equal(process.env.CI, 'true');
  assert.equal(process.env.GITHUB_ACTIONS, 'true');
  assert.equal(process.env.AUTH_LOCAL_E2E, 'true');
  assert.equal(process.env.REPLY_LOCAL_E2E, 'true');
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
  enableReplyPolicy();
  prepareFictionalDocuments();
  enableFictionalPolicy();
  localSql(`insert into private.message_policy(version,history_before_seconds,cancel_window_seconds,max_text_length,max_reply_length,max_photos,max_voice_seconds,max_video_seconds,preview_max_count,max_photo_bytes,max_voice_bytes,max_video_bytes)
    values('fictional-reply-ci-only',604800,300,1000,100,2,180,60,5,1048576,20971520,104857600)
    on conflict(singleton) do update set version=excluded.version,history_before_seconds=excluded.history_before_seconds,cancel_window_seconds=excluded.cancel_window_seconds,max_text_length=excluded.max_text_length,max_reply_length=excluded.max_reply_length,max_photos=excluded.max_photos,max_voice_seconds=excluded.max_voice_seconds,max_video_seconds=excluded.max_video_seconds,preview_max_count=excluded.preview_max_count,max_photo_bytes=excluded.max_photo_bytes,max_voice_bytes=excluded.max_voice_bytes,max_video_bytes=excluded.max_video_bytes;`);
}
async function createIdentity(role: 'artist' | 'fan'): Promise<Identity> {
  const { anonKey, serviceKey } = credentials();
  const admin = createClient<Database>(storageOrigin, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const email = `reply-e2e-${randomUUID()}@example.invalid`;
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
  if (role === 'artist')
    localSql(
      `update public.profiles set role='artist' where id='${uuid(id)}' and exists(select 1 from auth.users where id='${uuid(id)}' and email ~ '^reply-e2e-[0-9a-f-]{36}@example[.]invalid$');`,
    );
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
          sameSite: 'Lax' as const,
        })),
      );
    },
  };
}
export async function completeProfile(
  actor: Identity,
  artist: Artist,
  scale: 'normal' | 'large' | 'xlarge' = 'large',
) {
  const client = await actor.actorClient();
  for (const result of [
    await client.rpc('onboarding_save_font', { p_font_scale: scale }),
    await client.rpc('onboarding_save_name', { p_call_name: callName }),
    await client.rpc('onboarding_complete_profile', {
      p_age_over_14: true,
      p_terms_accepted: true,
      p_terms_version: onboardingFixtures.terms,
      p_privacy_accepted: true,
      p_privacy_version: onboardingFixtures.privacy,
      p_analytics_granted: false,
    }),
    await client.rpc('discovery_select_artist', { p_artist_slug: artist.slug }),
    await client.rpc('onboarding_acknowledge_install', { p_choice: 'skipped' }),
    await client.rpc('onboarding_complete'),
  ])
    assert.equal(result.error, null);
}
export const test = base.extend<{ world: World }>({
  world: async ({}, provide) => {
    const author = await createIdentity('artist');
    const fan = await createIdentity('fan');
    const artist = {
      id: randomUUID(),
      slug: `ci-reply-${randomUUID()}`,
      name: '허구 대화 가수',
    };
    localSql(
      `insert into public.artists(id,slug,name,intro,grade,status) values('${uuid(artist.id)}','${artist.slug}','${artist.name}','실제 가수가 아닌 격리 CI의 허구 대화방입니다.','B','active'); insert into public.artist_members(artist_id,user_id) values('${uuid(artist.id)}','${uuid(author.id)}');`,
    );
    await provide({ author, fan, artist });
    // Retained FK-bound fictional records disappear with this dedicated local
    // stack; never disable immutable-evidence triggers just to clean fixtures.
  },
});
export { expect };
export function subscribe(
  world: World,
  state: 'active' | 'grace' | 'canceled' | 'expired' = 'active',
) {
  assert.ok(['active', 'grace', 'canceled', 'expired'].includes(state));
  const paidEnd =
    state === 'expired' || state === 'grace'
      ? "clock_timestamp()-interval '1 minute'"
      : "clock_timestamp()+interval '1 hour'";
  localSql(`insert into public.subscriptions(user_id,artist_id,provider,status,first_started_at,episode_started_at,current_period_start,current_period_end,grace_started_at,grace_ends_at,canceled_at)
    values('${uuid(world.fan.id)}','${uuid(world.artist.id)}','toss','${state}',clock_timestamp()-interval '1 day',clock_timestamp()-interval '1 day',clock_timestamp()-interval '1 day',${paidEnd},${state === 'grace' ? "clock_timestamp()-interval '1 minute'" : 'null'},${state === 'grace' ? "clock_timestamp()+interval '1 hour'" : 'null'},${state === 'canceled' ? 'clock_timestamp()' : 'null'})
    on conflict(user_id,artist_id) do update set status=excluded.status,current_period_end=excluded.current_period_end,grace_started_at=excluded.grace_started_at,grace_ends_at=excluded.grace_ends_at,canceled_at=excluded.canceled_at,next_billing_at=null;`);
}
export function seedMessages(world: World, count = 35): SeededMessage[] {
  assert.ok(Number.isInteger(count) && count > 0 && count <= 110);
  const rows = Array.from({ length: count }, (_, index) => ({
    id: randomUUID(),
    text: `${callName} 님, 허구 대화 ${String(index + 1).padStart(3, '0')}입니다. <strong>문자 그대로</strong> & 안전한 인사예요.`,
  }));
  const values = rows
    .map(
      (row) =>
        `('${uuid(row.id)}','${uuid(world.artist.id)}','${uuid(world.author.id)}','text','${row.text.replace(callName, '{이름}')}','sent',now()-interval '1 minute',now()-interval '1 minute')`,
    )
    .join(',');
  // Identical microsecond timestamps force the UUID tie-breaker in each page.
  localSql(
    `insert into public.messages(id,artist_id,author_id,type,body,status,scheduled_at,sent_at) values ${values};`,
  );
  return rows.sort((left, right) => right.id.localeCompare(left.id));
}
export function seedExcludedMessages(world: World) {
  const values = [
    `('${randomUUID()}','${uuid(world.artist.id)}','${uuid(world.author.id)}','text','너무 오래된 허구 비공개 메시지','sent',now()-interval '30 days',now()-interval '30 days',null)`,
    `('${randomUUID()}','${uuid(world.artist.id)}','${uuid(world.author.id)}','text','예약된 허구 비공개 메시지','scheduled',now()+interval '1 day',null,null)`,
    `('${randomUUID()}','${uuid(world.artist.id)}','${uuid(world.author.id)}','text','취소된 허구 비공개 메시지','canceled',now()-interval '2 minutes',now()-interval '2 minutes',now()-interval '1 minute')`,
    `('${randomUUID()}','${uuid(world.artist.id)}','${uuid(world.author.id)}','text','미래 시각 허구 비공개 메시지','sent',now()+interval '1 day',now()+interval '1 day',null)`,
  ];
  localSql(
    `insert into public.messages(id,artist_id,author_id,type,body,status,scheduled_at,sent_at,canceled_at) values ${values.join(',')};`,
  );
}
export function addPreview(world: World) {
  const id = randomUUID();
  localSql(
    `insert into public.messages(id,artist_id,author_id,type,body,status,scheduled_at,sent_at,is_preview,preview_order) values('${id}','${uuid(world.artist.id)}','${uuid(world.author.id)}','text','{이름} 님, 무료 허구 맛보기입니다.','sent',now()-interval '1 hour',now()-interval '1 hour',true,1);`,
  );
  return id;
}
export function readRows(world: World) {
  return JSON.parse(
    localSql(
      `select coalesce(jsonb_agg(jsonb_build_object('messageId',r.message_id,'readAt',r.read_at) order by r.message_id),'[]') from public.message_reads r join public.messages m on m.id=r.message_id where r.user_id='${uuid(world.fan.id)}' and m.artist_id='${uuid(world.artist.id)}';`,
    ),
  ) as { messageId: string; readAt: string }[];
}
export function restrict(world: World) {
  localSql(
    `update public.profiles set is_restricted=true,restricted_until=null where id='${uuid(world.fan.id)}' and exists(select 1 from auth.users where id='${uuid(world.fan.id)}' and email ~ '^reply-e2e-[0-9a-f-]{36}@example[.]invalid$');`,
  );
}
export function cancelMessage(world: World, messageId: string) {
  localSql(
    `update public.messages set status='canceled',canceled_at=clock_timestamp(),is_preview=false,preview_order=null where id='${uuid(messageId)}' and artist_id='${uuid(world.artist.id)}';`,
  );
}
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
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(await page.locator('body').innerText()).not.toMatch(
    /service_role|body_template|object_path|AUTH_TEST_SERVICE_KEY/,
  );
  await page.screenshot({
    path: info.outputPath(`${name}.png`),
    fullPage: true,
  });
}

export function replyRows(world: World) {
  return JSON.parse(
    localSql(
      `select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'operationId',r.operation_id,'messageId',r.message_id,'body',r.body,'createdAt',r.created_at,'blocked',r.is_blocked) order by r.created_at desc,r.id desc),'[]') from public.replies r where r.user_id='${uuid(world.fan.id)}' and r.artist_id='${uuid(world.artist.id)}';`,
    ),
  ) as {
    id: string;
    operationId: string | null;
    messageId: string | null;
    body: string;
    createdAt: string;
    blocked: boolean;
  }[];
}
export function seedReplies(world: World, count = 35, old = false) {
  assert.ok(Number.isInteger(count) && count > 0 && count <= 110);
  const rows = Array.from({ length: count }, (_, index) => ({
    id: randomUUID(),
    body: `허구 이전 답장 ${String(index + 1).padStart(3, '0')} <strong>문자 그대로</strong>`,
  }));
  const stamp = old ? "now()-interval '60 days'" : "now()-interval '1 minute'";
  localSql(
    `insert into public.replies(id,user_id,artist_id,subscription_id,body,created_at) select x.id,'${uuid(world.fan.id)}','${uuid(world.artist.id)}',s.id,x.body,${stamp} from public.subscriptions s cross join (values ${rows.map((row) => `('${uuid(row.id)}'::uuid,'${row.body}')`).join(',')}) as x(id,body) where s.user_id='${uuid(world.fan.id)}' and s.artist_id='${uuid(world.artist.id)}';`,
  );
  return rows.sort((a, b) => b.id.localeCompare(a.id));
}
export function blockReply(world: World, replyId: string) {
  localSql(
    `update public.replies set is_blocked=true where id='${uuid(replyId)}' and user_id='${uuid(world.fan.id)}' and artist_id='${uuid(world.artist.id)}';`,
  );
}
export async function extraFan(world: World): Promise<World> {
  const fan = await createIdentity('fan');
  await completeProfile(fan, world.artist);
  const other = { ...world, fan };
  subscribe(other);
  return other;
}
export function otherArtist(world: World): World {
  const artist = {
    id: randomUUID(),
    slug: `ci-reply-${randomUUID()}`,
    name: '다른 허구 답장 가수',
  };
  localSql(
    `insert into public.artists(id,slug,name,intro,grade,status) values('${uuid(artist.id)}','${artist.slug}','${artist.name}','격리된 허구 답장 테스트','B','active'); insert into public.artist_members(artist_id,user_id) values('${uuid(artist.id)}','${uuid(world.author.id)}');`,
  );
  const other = { ...world, artist };
  subscribe(other);
  return other;
}
export function replyEvents(world: World) {
  return Number(
    localSql(
      `select count(*) from private.analytics_events where user_id='${uuid(world.fan.id)}' and name='reply_sent';`,
    ),
  );
}

export function enableReplyPolicy(max = 100) {
  assert.ok(Number.isInteger(max) && max >= 1 && max <= 1000);
  localSql(`insert into private.reply_policy(singleton,version,approved_at,rate_window_seconds,rate_max_count,forbidden_terms,forbidden_patterns)
    values(true,'fictional-reply-ci-only',now(),60,${max},array['금칙예시'],array['phone','account','url'])
    on conflict(singleton) do update set version=excluded.version,approved_at=excluded.approved_at,rate_window_seconds=excluded.rate_window_seconds,rate_max_count=excluded.rate_max_count,forbidden_terms=excluded.forbidden_terms,forbidden_patterns=excluded.forbidden_patterns;`);
}
export function disableReplyPolicy() {
  localSql('delete from private.reply_policy;');
}
export function replyQuota(world: World) {
  return Number(
    localSql(
      `select coalesce((select count from private.reply_rate_limits where user_id='${uuid(world.fan.id)}'),0);`,
    ),
  );
}
export function replyPoints(world: World) {
  return Number(
    localSql(
      `select count(*) from private.point_ledger where user_id='${uuid(world.fan.id)}';`,
    ),
  );
}

export function loseProfile(world: World) {
  localSql(
    `update public.profiles set onboarding_completed_at=null where id='${uuid(world.fan.id)}' and exists(select 1 from auth.users where id='${uuid(world.fan.id)}' and email ~ '^reply-e2e-[0-9a-f-]{36}@example[.]invalid$');`,
  );
}
