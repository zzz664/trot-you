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
};
function credentials() {
  assert.equal(process.env.CI, 'true');
  assert.equal(process.env.GITHUB_ACTIONS, 'true');
  assert.equal(process.env.AUTH_LOCAL_E2E, 'true');
  assert.equal(process.env.COMPOSE_LOCAL_E2E, 'true');
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
    values('fictional-compose-ci-only',604800,300,1000,100,2,180,60,5,1048576,20971520,104857600)
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
  const email = `compose-e2e-${randomUUID()}@example.invalid`;
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
  localSql(
    `update public.profiles set role='${role}',onboarding_completed_at=clock_timestamp() where id='${uuid(id)}' and exists(select 1 from auth.users where id='${uuid(id)}' and email ~ '^compose-e2e-[0-9a-f-]{36}@example[.]invalid$');`,
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
      slug: `ci-compose-${randomUUID()}`,
      name: '허구 작성 가수',
    };
    localSql(`insert into public.artists(id,slug,name,intro,grade,status) values('${uuid(artist.id)}','${artist.slug}','${artist.name}','격리 CI에서 작성 흐름만 확인하는 허구 가수입니다.','B','active');
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
    `update public.profiles set font_scale='${scale}' where id='${uuid(actor.id)}' and exists(select 1 from auth.users where id='${uuid(actor.id)}' and email ~ '^compose-e2e-[0-9a-f-]{36}@example[.]invalid$');`,
  );
}
export function setRole(actor: Identity, role: 'fan' | 'artist' | 'admin') {
  assert.ok(['fan', 'artist', 'admin'].includes(role));
  localSql(
    `update public.profiles set role='${role}' where id='${uuid(actor.id)}' and exists(select 1 from auth.users where id='${uuid(actor.id)}' and email ~ '^compose-e2e-[0-9a-f-]{36}@example[.]invalid$');`,
  );
}
export function restrict(actor: Identity) {
  localSql(
    `update public.profiles set is_restricted=true,restricted_until=null where id='${uuid(actor.id)}' and exists(select 1 from auth.users where id='${uuid(actor.id)}' and email ~ '^compose-e2e-[0-9a-f-]{36}@example[.]invalid$');`,
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
    `update public.artists set status='paused' where id='${uuid(world.artist.id)}' and slug like 'ci-compose-%';`,
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

export async function largeImageBytes() {
  // Ordinary solid-color image, not malformed input or parser/security probing.
  return sharp({
    create: { width: 3000, height: 2000, channels: 3, background: '#6c3768' },
  })
    .jpeg()
    .toBuffer();
}

export function addAssignedArtists(world: World, count: number) {
  assert.ok(Number.isInteger(count) && count >= 1 && count <= 60);
  const artists = Array.from({ length: count }, (_, index) => ({
    id: randomUUID(),
    slug: `ci-compose-extra-${randomUUID()}`,
    name: `허구 추가 가수 ${index + 1}`,
  }));
  localSql(`insert into public.artists(id,slug,name,intro,grade,status) values
    ${artists.map((artist) => `('${uuid(artist.id)}','${artist.slug}','${artist.name}','격리 CI의 메뉴 페이지 점검용 허구 가수입니다.','B','active')`).join(',')};
    insert into public.artist_members(artist_id,user_id) values
    ${artists.map((artist) => `('${uuid(artist.id)}','${uuid(world.author.id)}')`).join(',')};`);
  return artists;
}
