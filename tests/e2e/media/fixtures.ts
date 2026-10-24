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
  prepareFictionalDocuments,
  enableFictionalPolicy,
  onboardingFixtures,
} from '../authenticated/onboarding-fixtures';

export const appOrigin = 'http://127.0.0.1:3100';
export const storageOrigin = 'http://127.0.0.1:54321';
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
  draft(kind?: 'photo' | 'voice' | 'video'): string;
};
function credentials() {
  assert.equal(process.env.CI, 'true');
  assert.equal(process.env.GITHUB_ACTIONS, 'true');
  assert.equal(process.env.AUTH_LOCAL_E2E, 'true');
  assert.equal(process.env.MEDIA_LOCAL_E2E, 'true');
  assert.equal(process.env.NEXT_PUBLIC_APP_URL, appOrigin);
  assert.equal(process.env.NEXT_PUBLIC_SUPABASE_URL, storageOrigin);
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.AUTH_TEST_SERVICE_KEY;
  assert.ok(anonKey && serviceKey);
  return { anonKey, serviceKey };
}
function localSql(sql: string) {
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
  enableFictionalPolicy();
  localSql(`insert into private.message_policy(
    version,history_before_seconds,cancel_window_seconds,max_text_length,
    max_reply_length,max_photos,max_voice_seconds,max_video_seconds,preview_max_count,
    max_photo_bytes,max_voice_bytes,max_video_bytes)
    values('fictional-media-ci-only',604800,300,1000,100,2,180,60,5,1048576,20971520,104857600)
    on conflict(singleton) do update set version=excluded.version,
      history_before_seconds=excluded.history_before_seconds,cancel_window_seconds=excluded.cancel_window_seconds,
      max_text_length=excluded.max_text_length,max_reply_length=excluded.max_reply_length,
      max_photos=excluded.max_photos,max_voice_seconds=excluded.max_voice_seconds,
      max_video_seconds=excluded.max_video_seconds,preview_max_count=excluded.preview_max_count,
      max_photo_bytes=excluded.max_photo_bytes,max_voice_bytes=excluded.max_voice_bytes,
      max_video_bytes=excluded.max_video_bytes;`);
}
async function createIdentity(role: 'artist' | 'fan'): Promise<Identity> {
  const { anonKey, serviceKey } = credentials();
  const admin = createClient<Database>(storageOrigin, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const email = `media-e2e-${randomUUID()}@example.invalid`;
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
      `update public.profiles set role='artist' where id='${uuid(id)}' and exists(select 1 from auth.users where id='${uuid(id)}' and email ~ '^media-e2e-[0-9a-f-]{36}@example[.]invalid$');`,
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
      slug: `ci-media-${randomUUID()}`,
      name: '허구 미디어 가수',
    };
    localSql(`insert into public.artists(id,slug,name,intro,grade,status) values('${uuid(artist.id)}','${artist.slug}','${artist.name}','격리 CI의 생성 미디어 검증용 허구 가수입니다.','B','active');
      insert into public.artist_members(artist_id,user_id) values('${uuid(artist.id)}','${uuid(author.id)}');`);
    await provide({
      author,
      outsider,
      fan,
      artist,
      draft(kind = 'photo') {
        assert.ok(['photo', 'voice', 'video'].includes(kind));
        const id = randomUUID();
        localSql(
          `insert into public.messages(id,artist_id,author_id,type,body) values('${id}','${uuid(artist.id)}','${uuid(author.id)}','${kind}','허구팬을 위한 생성 미디어입니다.');`,
        );
        return id;
      },
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
export function publish(
  messageId: string,
  preview = false,
  old = false,
  previewOrder = 1,
) {
  assert.ok(
    Number.isInteger(previewOrder) && previewOrder >= 1 && previewOrder <= 5,
  );
  const time = old
    ? "clock_timestamp()-interval '30 days'"
    : "clock_timestamp()-interval '1 minute'";
  localSql(`update public.messages set status='sent',scheduled_at=${time},sent_at=${time},is_preview=${preview},preview_order=${preview ? previewOrder : 'null'}
    where id='${uuid(messageId)}' and artist_id in(select id from public.artists where slug like 'ci-media-%');`);
}
export function subscribe(
  actor: Identity,
  artist: Artist,
  state: 'active' | 'grace' | 'canceled' | 'expired' = 'active',
  seconds = 3600,
) {
  assert.ok(['active', 'grace', 'canceled', 'expired'].includes(state));
  assert.ok(Number.isInteger(seconds) && Math.abs(seconds) <= 86400);
  localSql(`insert into public.subscriptions(user_id,artist_id,provider,status,first_started_at,episode_started_at,current_period_start,current_period_end,grace_started_at,grace_ends_at,canceled_at)
    values('${uuid(actor.id)}','${uuid(artist.id)}','toss','${state}',clock_timestamp()-interval '1 day',clock_timestamp()-interval '1 day',clock_timestamp()-interval '1 day',clock_timestamp()+make_interval(secs=>${seconds}),
      ${state === 'grace' ? "clock_timestamp()-interval '1 minute'" : 'null'},${state === 'grace' ? `clock_timestamp()+make_interval(secs=>${seconds})` : 'null'},${state === 'canceled' ? 'clock_timestamp()' : 'null'})
    on conflict(user_id,artist_id) do update set status=excluded.status,current_period_end=excluded.current_period_end,grace_started_at=excluded.grace_started_at,grace_ends_at=excluded.grace_ends_at,canceled_at=excluded.canceled_at,next_billing_at=null;`);
}
export function restrict(actor: Identity) {
  localSql(
    `update public.profiles set is_restricted=true,restricted_until=null where id='${uuid(actor.id)}' and exists(select 1 from auth.users where id='${uuid(actor.id)}' and email ~ '^media-e2e-[0-9a-f-]{36}@example[.]invalid$');`,
  );
}
export function removeMembership(world: World) {
  localSql(
    `delete from public.artist_members where artist_id='${uuid(world.artist.id)}' and user_id='${uuid(world.author.id)}';`,
  );
}
export function unpreview(messageId: string) {
  localSql(
    `update public.messages set is_preview=false,preview_order=null where id='${uuid(messageId)}' and artist_id in(select id from public.artists where slug like 'ci-media-%');`,
  );
}
export function cancelMessage(messageId: string) {
  localSql(
    `update public.messages set status='canceled',canceled_at=clock_timestamp(),is_preview=false,preview_order=null where id='${uuid(messageId)}' and artist_id in(select id from public.artists where slug like 'ci-media-%');`,
  );
}
export function inspectMedia(mediaId: string) {
  return JSON.parse(
    localSql(
      `select jsonb_build_object('path',object_path,'bucket',bucket_id,'bytes',byte_size,'mime',mime_type,'width',width,'height',height,'duration',duration_ms) from public.message_media where id='${uuid(mediaId)}';`,
    ),
  ) as {
    path: string;
    bucket: string;
    bytes: number;
    mime: string;
    width: number | null;
    height: number | null;
    duration: number | null;
  };
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

export function expireUpload(uploadId: string) {
  localSql(`update private.media_uploads set created_at=clock_timestamp()-interval '11 minutes',expires_at=clock_timestamp()-interval '1 minute'
    where id='${uuid(uploadId)}' and state='pending' and artist_id in(select id from public.artists where slug like 'ci-media-%');`);
}
export function inspectUpload(uploadId: string) {
  return JSON.parse(
    localSql(`select jsonb_build_object('state',state,'quarantinePath',quarantine_path,'path',object_path,'mediaId',media_id)
    from private.media_uploads where id='${uuid(uploadId)}';`),
  ) as { state: string; quarantinePath: string; path: string; mediaId: string };
}
