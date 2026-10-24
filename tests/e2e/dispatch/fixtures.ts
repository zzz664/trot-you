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
import sharp from 'sharp';
import type { Database } from '../../../src/types/database';
import {
  dispatchProfileFixtureSql,
  DISPATCH_FIXTURE_CALL_NAME,
} from './profile-fixture';
import { routes } from '../../../src/config/routes';
import { dispatchWorkerSummarySchema } from '../../../src/config/message-dispatch';
import {
  prepareFictionalDocuments,
  enableFictionalPolicy,
  onboardingFixtures,
} from '../authenticated/onboarding-fixtures';

export const appOrigin = 'http://127.0.0.1:3100';
export const storageOrigin = 'http://127.0.0.1:54321';
export const callName = DISPATCH_FIXTURE_CALL_NAME;
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
  assert.equal(process.env.DISPATCH_LOCAL_E2E, 'true');
  assert.equal(process.env.MESSAGE_DISPATCH_ENABLED, 'true');
  assert.ok(
    /^[A-Za-z0-9_-]{32,256}$/.test(
      process.env.MESSAGE_DISPATCH_CRON_SECRET ?? '',
    ),
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
  localSql(`insert into private.message_policy(
    version,history_before_seconds,cancel_window_seconds,max_text_length,
    max_reply_length,max_photos,max_voice_seconds,max_video_seconds,preview_max_count,
    max_photo_bytes,max_voice_bytes,max_video_bytes)
    values('fictional-dispatch-ci-only',604800,300,1000,100,2,180,60,5,1048576,20971520,104857600)
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
  const email = `dispatch-e2e-${randomUUID()}@example.invalid`;
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
  const profileSetup = dispatchProfileFixtureSql(id, role);
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
      slug: `ci-dispatch-${randomUUID()}`,
      name: '허구 발송 가수',
    };
    localSql(`insert into public.artists(id,slug,name,intro,grade,status) values('${uuid(artist.id)}','${artist.slug}','${artist.name}','격리 CI에서 발송 흐름만 확인하는 허구 가수입니다.','B','active');
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
export async function imageBytes() {
  return sharp({
    create: { width: 160, height: 100, channels: 3, background: '#6c3768' },
  })
    .png()
    .toBuffer();
}
export async function post(
  request: APIRequestContext,
  path: string,
  data: unknown,
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
    /service_role|quarantine_path|object_path|AUTH_TEST_SERVICE_KEY/,
  );
  await page.screenshot({
    path: info.outputPath(`${name}.png`),
    fullPage: true,
  });
}

export function setFont(actor: Identity, scale: 'normal' | 'large' | 'xlarge') {
  assert.ok(['normal', 'large', 'xlarge'].includes(scale));
  localSql(
    `update public.profiles set font_scale='${scale}' where id='${uuid(actor.id)}' and exists(select 1 from auth.users where id='${uuid(actor.id)}' and email ~ '^dispatch-e2e-[0-9a-f-]{36}@example[.]invalid$');`,
  );
}
export function setRole(actor: Identity, role: 'fan' | 'artist' | 'admin') {
  assert.ok(['fan', 'artist', 'admin'].includes(role));
  localSql(
    `update public.profiles set role='${role}' where id='${uuid(actor.id)}' and exists(select 1 from auth.users where id='${uuid(actor.id)}' and email ~ '^dispatch-e2e-[0-9a-f-]{36}@example[.]invalid$');`,
  );
}
export function restrict(actor: Identity) {
  localSql(
    `update public.profiles set is_restricted=true,restricted_until=null where id='${uuid(actor.id)}' and exists(select 1 from auth.users where id='${uuid(actor.id)}' and email ~ '^dispatch-e2e-[0-9a-f-]{36}@example[.]invalid$');`,
  );
}
export function removeMembership(world: World) {
  localSql(
    `delete from public.artist_members where artist_id='${uuid(world.artist.id)}' and user_id='${uuid(world.author.id)}';`,
  );
}
export function addMembership(world: World, actor: Identity) {
  localSql(
    `insert into public.artist_members(artist_id,user_id) values('${uuid(world.artist.id)}','${uuid(actor.id)}');`,
  );
}
export function pauseArtist(world: World) {
  localSql(
    `update public.artists set status='paused' where id='${uuid(world.artist.id)}' and slug like 'ci-dispatch-%';`,
  );
}
export function inspectDrafts(world: World) {
  return JSON.parse(
    localSql(
      `select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'kind',m.type,'body',m.body,'status',m.status,'mediaCount',(select count(*) from public.message_media mm where mm.message_id=m.id)) order by m.created_at,m.id),'[]'::jsonb) from public.messages m where artist_id='${uuid(world.artist.id)}';`,
    ),
  ) as {
    id: string;
    kind: string;
    body: string | null;
    status: string;
    mediaCount: number;
  }[];
}
export function disableMessagePolicy() {
  localSql('delete from private.message_policy;');
}
export function mediaRowCount(messageId: string) {
  return Number(
    localSql(
      `select count(*) from public.message_media where message_id='${uuid(messageId)}';`,
    ),
  );
}

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
export function readRows(world: World) {
  return JSON.parse(
    localSql(
      `select coalesce(jsonb_agg(jsonb_build_object('messageId',r.message_id,'readAt',r.read_at) order by r.message_id),'[]') from public.message_reads r join public.messages m on m.id=r.message_id where r.user_id='${uuid(world.fan.id)}' and m.artist_id='${uuid(world.artist.id)}';`,
    ),
  ) as { messageId: string; readAt: string }[];
}
export function notificationRows(messageId: string) {
  return JSON.parse(
    localSql(
      `select coalesce(jsonb_agg(jsonb_build_object('id',id,'userId',user_id,'state',state,'attemptCount',attempt_count,'acceptedAt',provider_accepted_at) order by id),'[]') from private.notification_jobs where source_kind='message' and source_id='${uuid(messageId)}';`,
    ),
  ) as {
    id: string;
    userId: string;
    state: string;
    attemptCount: number;
    acceptedAt: string | null;
  }[];
}
export async function enableFictionalNotifications(actor: Identity) {
  localSql(`insert into private.notification_policy(singleton,version,consent_version,webpush_enabled,max_attempts,retry_seconds,lease_seconds,schedule_lead_seconds)
    values(true,'fictional-dispatch-notifications','fictional-dispatch-consent',true,3,60,30,86400)
    on conflict(singleton) do update set version=excluded.version,consent_version=excluded.consent_version,webpush_enabled=true,max_attempts=3,retry_seconds=60,lease_seconds=30,schedule_lead_seconds=86400;`);
  const { serviceKey } = credentials();
  const client = createClient<Database>(storageOrigin, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const preferences = await (
    await actor.actorClient()
  ).rpc('notification_set_preferences', {
    p_webpush_enabled: true,
    p_new_message: true,
    p_billing: false,
    p_schedule: false,
  });
  assert.equal(preferences.error, null);
  // Structurally valid fictional data is enqueued only. It is never contacted,
  // passed to a provider adapter, or represented as a real browser consent.
  const device = await client.rpc('notification_register_device', {
    p_actor_id: actor.id,
    p_endpoint: `https://dispatch-fixture.invalid/${randomUUID()}`,
    p_p256dh: 'A'.repeat(87),
    p_auth: 'B'.repeat(22),
    p_consent_version: 'fictional-dispatch-consent',
  });
  assert.equal(device.error, null);
}
export async function invokeDispatch(request: APIRequestContext) {
  credentials();
  const result = await request.post(routes.dispatchMessages, {
    headers: {
      Authorization: `Bearer ${process.env.MESSAGE_DISPATCH_CRON_SECRET}`,
    },
  });
  expect(result.status()).toBe(200);
  expect(result.headers()['cache-control']).toContain('no-store');
  const body = await result.json();
  expect(body.ok).toBe(true);
  return dispatchWorkerSummarySchema.parse(body.data);
}
export function makeScheduledDue(world: World, messageId: string) {
  // Explicit fictional time-travel fixture only; publication still uses the
  // protected worker and normal DB transition, never a direct sent UPDATE.
  localSql(
    `begin;
      update public.messages set scheduled_at=statement_timestamp()-interval '1 minute'
        where id='${uuid(messageId)}' and artist_id='${uuid(world.artist.id)}' and status='scheduled';
      update private.artist_dispatch_submissions set next_attempt_at=statement_timestamp()-interval '1 minute'
        where message_id='${uuid(messageId)}' and exists(select 1 from public.messages m
          where m.id='${uuid(messageId)}' and m.artist_id='${uuid(world.artist.id)}' and m.status='scheduled');
      commit;`,
  );
}
export function closeCancelWindow(world: World, messageId: string) {
  localSql(
    `update public.messages set sent_at=statement_timestamp()-interval '10 minutes',scheduled_at=statement_timestamp()-interval '10 minutes' where id='${uuid(messageId)}' and artist_id='${uuid(world.artist.id)}' and status='sent';`,
  );
}

export function ageDispatchRateWindow(world: World) {
  // Advance only this fictional author's historical request timestamps to
  // exercise pagination without disabling the authoritative rate limiter.
  localSql(
    `update private.artist_dispatch_operations set created_at=clock_timestamp()-interval '2 minutes' where actor_id='${uuid(world.author.id)}' and exists(select 1 from auth.users where id='${uuid(world.author.id)}' and email ~ '^dispatch-e2e-[0-9a-f-]{36}@example[.]invalid$');`,
  );
}
export function disableNotifications() {
  localSql('delete from private.notification_policy;');
}

export function showDispatchError(
  world: World,
  messageId: string,
  code:
    | 'author_unavailable'
    | 'content_invalid'
    | 'policy_unavailable'
    | 'backpressure',
) {
  assert.ok(
    [
      'author_unavailable',
      'content_invalid',
      'policy_unavailable',
      'backpressure',
    ].includes(code),
  );
  // Explicit renderer-state fixture, not evidence that the worker took this
  // path. Actual worker failure and rollback behavior have separate DB tests.
  localSql(
    `update private.artist_dispatch_submissions set dispatch_error='${code}' where message_id='${uuid(messageId)}' and exists(select 1 from public.messages m where m.id=message_id and m.artist_id='${uuid(world.artist.id)}' and m.status='scheduled');`,
  );
}

export function clearRestriction(actor: Identity) {
  localSql(
    `update public.profiles set is_restricted=false,restricted_until=null where id='${uuid(actor.id)}' and exists(select 1 from auth.users where id='${uuid(actor.id)}' and email ~ '^dispatch-e2e-[0-9a-f-]{36}@example[.]invalid$');`,
  );
}
export function resumeArtist(world: World) {
  localSql(
    `update public.artists set status='active' where id='${uuid(world.artist.id)}' and slug like 'ci-dispatch-%';`,
  );
}

export function addHistoryArtists(world: World, count: number): Artist[] {
  assert.ok(Number.isInteger(count) && count >= 1 && count <= 60);
  const artists = Array.from({ length: count }, (_, index) => ({
    id: randomUUID(),
    slug: `ci-dispatch-extra-${randomUUID()}`,
    name: `허구 내역 가수 ${index + 1}`,
  }));
  localSql(`insert into public.artists(id,slug,name,intro,grade,status) values
    ${artists.map((artist) => `('${uuid(artist.id)}','${artist.slug}','${artist.name}','격리 CI의 내역 목록 점검용 허구 가수입니다.','B','active')`).join(',')};
    insert into public.artist_members(artist_id,user_id) values
    ${artists.map((artist) => `('${uuid(artist.id)}','${uuid(world.author.id)}')`).join(',')};`);
  return artists;
}
