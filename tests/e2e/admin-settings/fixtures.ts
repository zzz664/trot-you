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
import { ADMIN_SETTINGS_CI_ENV } from '../../../scripts/admin-settings-local-config.mjs';
import type { Database } from '../../../src/types/database';

export const appOrigin = 'http://127.0.0.1:3100';
const databaseOrigin = 'http://127.0.0.1:54321';
export type Scale = 'normal' | 'large' | 'xlarge';
export type Identity = {
  id: string;
  signIn(context: BrowserContext): Promise<void>;
};
export type World = { admin: Identity; other: Identity; fan: Identity };
const externalRequests = new WeakMap<BrowserContext, string[]>();

function credentials() {
  assert.equal(process.env.CI, 'true');
  assert.equal(process.env.GITHUB_ACTIONS, 'true');
  assert.equal(process.env.AUTH_LOCAL_E2E, 'true');
  assert.equal(process.env.ADMIN_SETTINGS_LOCAL_E2E, 'true');
  assert.equal(process.env.NEXT_PUBLIC_APP_URL, appOrigin);
  assert.equal(process.env.NEXT_PUBLIC_SUPABASE_URL, databaseOrigin);
  for (const [key, value] of Object.entries(ADMIN_SETTINGS_CI_ENV))
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
// This file is only imported by the dedicated opted-in CI configuration. The
// fixed loopback stack is disposable; no arbitrary project/container is accepted.
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
export const initialMessage = {
  history_before_seconds: 604800,
  cancel_window_seconds: 300,
  max_text_length: 1000,
  max_reply_length: 100,
  max_photos: 2,
  max_voice_seconds: 180,
  max_video_seconds: 60,
  preview_max_count: 5,
  max_photo_bytes: 1048576,
  max_voice_bytes: 20971520,
  max_video_bytes: 104857600,
} as const;
export const initialCommunity = {
  max_title_length: 100,
  max_body_length: 2000,
  max_comment_length: 500,
  max_reason_length: 500,
  max_images: 3,
  max_image_bytes: 1048576,
  max_image_long_edge: 1600,
  auto_hide_report_count: 3,
  rate_window_seconds: 60,
  max_contributions_per_window: 10,
  max_reports_per_window: 5,
} as const;
export function preparePolicies() {
  // Numeric operational configuration only. No checkout, renewal, notice,
  // refund, settlement, consent, provider, scheduler or artist-link approval.
  localSql(`insert into private.message_policy(version,${Object.keys(initialMessage).join(',')})
    values('fictional-settings-ci-only',${Object.values(initialMessage).join(',')})
    on conflict(singleton) do update set version=excluded.version,
      ${Object.keys(initialMessage)
        .map((key) => `${key}=excluded.${key}`)
        .join(',')};
    insert into private.community_policy(version,${Object.keys(initialCommunity).join(',')},forbidden_terms,forbidden_patterns)
    values('fictional-settings-ci-only',${Object.values(initialCommunity).join(',')},array['fictional-sentinel-moderation'],array['fictional-sentinel-pattern'])
    on conflict(singleton) do update set version=excluded.version,
      ${Object.keys(initialCommunity)
        .map((key) => `${key}=excluded.${key}`)
        .join(',')},
      forbidden_terms=excluded.forbidden_terms,forbidden_patterns=excluded.forbidden_patterns;
    delete from private.admin_display_settings;`);
}
async function createIdentity(role: 'admin' | 'fan'): Promise<Identity> {
  const { anonKey, serviceKey } = credentials();
  const service = createClient<Database>(databaseOrigin, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const email = `admin-settings-e2e-${randomUUID()}@example.invalid`;
  const password = randomBytes(32).toString('base64url');
  const { data, error } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  assert.equal(error, null);
  assert.ok(data.user);
  const id = data.user.id;
  // Fictional CI identity setup, not a production role/consent workflow.
  localSql(`update public.profiles set role='${role}',call_name='허구운영자',onboarding_completed_at=clock_timestamp()
    where id='${uuid(id)}' and exists(select 1 from auth.users where id='${uuid(id)}' and email ~ '^admin-settings-e2e-[0-9a-f-]{36}@example[.]invalid$');`);
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
    preparePolicies();
    const admin = await createIdentity('admin');
    const other = await createIdentity('admin');
    const fan = await createIdentity('fan');
    await provide({ admin, other, fan });
    // Immutable audit and fictional identities are retained until the dedicated
    // CI job destroys its disposable stack; no audit protection is disabled.
  },
});
export { expect };
export function post(
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
    /AUTH_TEST_SERVICE_KEY|SUPABASE_SERVICE_ROLE_KEY|fictional-sentinel-moderation|fictional-sentinel-pattern|admin-settings-e2e-.*@example[.]invalid/,
  );
}
export async function screenshot(
  page: Page,
  info: TestInfo,
  name: string,
  scale: Scale,
) {
  await assertRenderedScale(page, scale);
  await page.screenshot({
    path: info.outputPath(`${name}.png`),
    fullPage: false,
  });
}
export function setFont(actor: Identity, scale: Scale) {
  assert.ok(['normal', 'large', 'xlarge'].includes(scale));
  localSql(
    `update public.profiles set font_scale='${scale}' where id='${uuid(actor.id)}' and exists(select 1 from auth.users where id='${uuid(actor.id)}' and email ~ '^admin-settings-e2e-[0-9a-f-]{36}@example[.]invalid$');`,
  );
}
export function setRole(actor: Identity, role: 'fan' | 'admin') {
  assert.ok(['fan', 'admin'].includes(role));
  localSql(
    `update public.profiles set role='${role}' where id='${uuid(actor.id)}' and exists(select 1 from auth.users where id='${uuid(actor.id)}' and email ~ '^admin-settings-e2e-[0-9a-f-]{36}@example[.]invalid$');`,
  );
}
export function removeMessagePolicy() {
  localSql(
    "delete from private.message_policy where version='fictional-settings-ci-only';",
  );
}
export function storedMessageLimit() {
  return Number(
    localSql(
      'select max_text_length from private.message_policy where singleton;',
    ),
  );
}
export function moderationUnchanged() {
  return (
    localSql(
      "select forbidden_terms=array['fictional-sentinel-moderation'] and forbidden_patterns=array['fictional-sentinel-pattern'] from private.community_policy where singleton;",
    ) === 't'
  );
}

export function createSentPreview(world: World) {
  const artistId = randomUUID();
  const messageId = randomUUID();
  localSql(`insert into public.artists(id,slug,name,grade,status) values('${uuid(artistId)}','ci-settings-${artistId}','허구 설정 점검 가수','B','active');
    insert into public.messages(id,artist_id,author_id,type,body,status,is_preview,preview_order,scheduled_at,sent_at)
    values('${uuid(messageId)}','${uuid(artistId)}','${uuid(world.admin.id)}','text','격리 점검용 맛보기','sent',true,1,clock_timestamp()-interval '1 second',clock_timestamp());`);
  return messageId;
}
