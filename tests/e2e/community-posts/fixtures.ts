import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import sharp from 'sharp';
import {
  test as base,
  expect,
  type APIRequestContext,
  type BrowserContext,
  type Page,
  type TestInfo,
} from '@playwright/test';
import { COMMUNITY_POSTS_CI_ENV } from '../../../scripts/community-posts-local-config.mjs';
import type { Database } from '../../../src/types/database';
import { captureSettledCommunityPosts } from './screenshot-capture';

export const appOrigin = 'http://127.0.0.1:3100';
export const databaseOrigin = 'http://127.0.0.1:54321';
export type Scale = 'normal' | 'large' | 'xlarge';
export type Identity = {
  id: string;
  signIn(context: BrowserContext): Promise<void>;
};
export type Artist = { id: string; slug: string; name: string };
export type FixturePost = { id: string; title: string; body: string };
export type World = {
  admin: Identity;
  author: Identity;
  other: Identity;
  artistAccount: Identity;
  artist: Artist;
  unrelated: Artist;
  paused: Artist;
  notice: FixturePost;
  post: FixturePost;
  hidden: FixturePost;
  deleted: FixturePost;
};
const externalRequests = new WeakMap<BrowserContext, string[]>();
function credentials() {
  assert.equal(process.env.CI, 'true');
  assert.equal(process.env.GITHUB_ACTIONS, 'true');
  assert.equal(process.env.AUTH_LOCAL_E2E, 'true');
  assert.equal(process.env.COMMUNITY_POSTS_LOCAL_E2E, 'true');
  assert.equal(process.env.NEXT_PUBLIC_APP_URL, appOrigin);
  assert.equal(process.env.NEXT_PUBLIC_SUPABASE_URL, databaseOrigin);
  for (const [key, value] of Object.entries(COMMUNITY_POSTS_CI_ENV))
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
async function createIdentity(
  role: 'admin' | 'fan' | 'artist',
): Promise<Identity> {
  const { anonKey, serviceKey } = credentials();
  const service = createClient<Database>(databaseOrigin, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const email = `community-posts-e2e-${randomUUID()}@example.invalid`;
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
    where id='${uuid(id)}' and exists(select 1 from auth.users where id='${uuid(id)}' and email ~ '^community-posts-e2e-[0-9a-f-]{36}@example[.]invalid$');`);
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
export function preparePolicy() {
  // Explicit synthetic policy for this disposable fixture, never operational approval.
  localSql(`insert into private.community_policy(singleton,version,max_title_length,max_body_length,max_comment_length,max_reason_length,max_images,max_image_bytes,max_image_long_edge,auto_hide_report_count,rate_window_seconds,max_contributions_per_window,max_reports_per_window,forbidden_terms,forbidden_patterns)
    values(true,'synthetic-community-posts-browser-v1',120,4000,100,1000,3,1048576,2048,3,60,1000,1000,array['금지허구표현'],array[]::text[])
    on conflict(singleton) do update set version=excluded.version,max_title_length=excluded.max_title_length,max_body_length=excluded.max_body_length,max_images=excluded.max_images,max_image_bytes=excluded.max_image_bytes,max_image_long_edge=excluded.max_image_long_edge,forbidden_terms=excluded.forbidden_terms,forbidden_patterns=excluded.forbidden_patterns;`);
}
export function insertPost(
  artist: Artist,
  actor: Identity,
  input: Partial<FixturePost> & {
    pinned?: boolean;
    hidden?: boolean;
    deleted?: boolean;
    createdAt?: string;
  } = {},
): FixturePost {
  const post = {
    id: input.id ?? randomUUID(),
    title: input.title ?? '허구 팬의 오늘 노래 이야기',
    body:
      input.body ??
      '실제 이용자의 글이 아닌 격리 CI 전용 허구 게시물입니다.\n큰 글자에서도 긴 내용을 끝까지 읽고 안전하게 이동할 수 있는지 확인합니다. <strong>이 부분은 문자 그대로입니다.</strong>',
  };
  const timestamp = input.createdAt ?? '2035-05-03T09:00:00Z';
  assert.match(timestamp, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  localSql(`insert into public.posts(id,artist_id,user_id,request_id,title,body,is_notice,is_pinned,is_hidden,deleted_at,created_at)
    values('${uuid(post.id)}','${uuid(artist.id)}','${uuid(actor.id)}','${randomUUID()}',${literal(post.title)},${literal(post.body)},${!!input.pinned},${!!input.pinned},${!!input.hidden},${input.deleted ? 'clock_timestamp()' : 'null'},'${timestamp}');`);
  return post;
}
export const test = base.extend<{ world: World }>({
  world: async ({}, provide) => {
    preparePolicy();
    const admin = await createIdentity('admin');
    const author = await createIdentity('fan');
    const other = await createIdentity('fan');
    const artistAccount = await createIdentity('artist');
    const artists = ['팬 마당', '다른 팬 마당', '비공개 팬 마당'].map(
      (name) => ({
        id: randomUUID(),
        slug: `ci-board-${randomUUID()}`,
        name: `허구 ${name} 가수`,
      }),
    );
    const [artist, unrelated, paused] = artists as [Artist, Artist, Artist];
    for (const item of artists)
      localSql(
        `insert into public.artists(id,slug,name,intro,grade,status) values('${uuid(item.id)}','${item.slug}',${literal(item.name)},'격리 CI의 허구 커뮤니티 확인용 가수입니다.','B','${item === paused ? 'paused' : 'active'}');`,
      );
    localSql(
      `insert into public.artist_members(artist_id,user_id) values('${uuid(artist.id)}','${uuid(artistAccount.id)}');`,
    );
    const notice = insertPost(artist, admin, {
      pinned: true,
      title: '허구 안내: 서로 반갑게 인사해요',
      createdAt: '2035-05-01T09:00:00Z',
    });
    const post = insertPost(artist, author);
    const hidden = insertPost(artist, author, {
      hidden: true,
      title: '허구 숨겨진 글',
    });
    const deleted = insertPost(artist, author, {
      deleted: true,
      title: '허구 삭제된 글',
    });
    insertPost(unrelated, other, { title: '다른 마당의 허구 글' });
    insertPost(paused, other, { title: '비공개 가수의 허구 글' });
    await provide({
      admin,
      author,
      other,
      artistAccount,
      artist,
      unrelated,
      paused,
      notice,
      post,
      hidden,
      deleted,
    });
    // Disposable identities and immutable receipts remain until this job destroys
    // its stack; no trigger bypass, live post, private asset or provider I/O.
  },
});
export { expect };
export function post(
  request: APIRequestContext,
  path: string,
  actor: Identity,
  data: unknown = {},
) {
  return request.post(path, {
    headers: { Origin: appOrigin, 'X-Community-Actor': actor.id },
    data,
  });
}
export function get(request: APIRequestContext, path: string, actor: Identity) {
  return request.get(path, { headers: { 'X-Community-Actor': actor.id } });
}
export async function blockExternal(context: BrowserContext) {
  externalRequests.set(context, []);
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if ([appOrigin, databaseOrigin].includes(url.origin))
      return route.continue();
    externalRequests.get(context)!.push(url.origin);
    return route.abort('blockedbyclient');
  });
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
    /AUTH_TEST_SERVICE_KEY|SUPABASE_SERVICE_ROLE_KEY|community-posts-e2e-.*@example[.]invalid/,
  );
}
export async function screenshot(
  page: Page,
  info: TestInfo,
  name: string,
  scale: Scale,
) {
  await assertRenderedScale(page, scale);
  await captureSettledCommunityPosts(page, info.outputPath(`${name}.png`));
}
export function setFont(actor: Identity, scale: Scale) {
  assert.ok(['normal', 'large', 'xlarge'].includes(scale));
  localSql(
    `update public.profiles set font_scale='${scale}' where id='${uuid(actor.id)}' and exists(select 1 from auth.users where id='${uuid(actor.id)}' and email ~ '^community-posts-e2e-[0-9a-f-]{36}@example[.]invalid$');`,
  );
}
export function setRestricted(actor: Identity, restricted: boolean) {
  assert.equal(typeof restricted, 'boolean');
  localSql(
    `update public.profiles set is_restricted=${restricted},restricted_until=null where id='${uuid(actor.id)}' and exists(select 1 from auth.users where id='${uuid(actor.id)}' and email ~ '^community-posts-e2e-[0-9a-f-]{36}@example[.]invalid$');`,
  );
}
export function sourceSnapshot(world: World) {
  return localSql(
    `select jsonb_build_object('messages',(select count(*) from public.messages where artist_id='${uuid(world.artist.id)}'),'payments',(select count(*) from public.payment_events),'notifications',(select count(*) from private.notification_jobs),'points',(select count(*) from private.point_ledger),'settlements',(select count(*) from public.settlements));`,
  );
}
export async function imageBytes() {
  return sharp({
    create: {
      width: 160,
      height: 100,
      channels: 3,
      background: { r: 236, g: 194, b: 212 },
    },
  })
    .png()
    .toBuffer();
}
