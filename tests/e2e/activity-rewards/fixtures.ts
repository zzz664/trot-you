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
import { ACTIVITY_REWARDS_CI_ENV } from '../../../scripts/activity-rewards-local-config.mjs';
import type { Database } from '../../../src/types/database';
import { ACTIVITY_REWARDS } from '../../../src/config/activity-rewards';
import { captureSettledActivityRewards } from './screenshot-capture';
import { blockActivityExternalRequests } from './external-guard';

export const appOrigin = 'http://127.0.0.1:3100';
export const databaseOrigin = 'http://127.0.0.1:54321';
export type Scale = 'normal' | 'large' | 'xlarge';
export type Identity = {
  id: string;
  signIn(context: BrowserContext): Promise<void>;
};
export type Artist = { id: string; slug: string };
export type World = { fan: Identity; other: Identity; artist: Artist };
const externalRequests = new WeakMap<BrowserContext, string[]>();
function credentials() {
  assert.equal(process.env.CI, 'true');
  assert.equal(process.env.GITHUB_ACTIONS, 'true');
  assert.equal(process.env.AUTH_LOCAL_E2E, 'true');
  assert.equal(process.env.ACTIVITY_REWARDS_LOCAL_E2E, 'true');
  assert.equal(process.env.NEXT_PUBLIC_APP_URL, appOrigin);
  assert.equal(process.env.NEXT_PUBLIC_SUPABASE_URL, databaseOrigin);
  for (const [key, value] of Object.entries(ACTIVITY_REWARDS_CI_ENV))
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
  const email = `activity-rewards-e2e-${randomUUID()}@example.invalid`;
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
    where id='${uuid(id)}' and exists(select 1 from auth.users where id='${uuid(id)}' and email ~ '^activity-rewards-e2e-[0-9a-f-]{36}@example[.]invalid$');`);
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

// These are explicit fictional fixture choices, not approved operating values.
export function preparePolicy(
  postAmount = 7,
  commentAmount = 3,
  postCap: number | null = 2,
  commentCap: number | null = 1,
) {
  for (const value of [postAmount, commentAmount, postCap, commentCap])
    assert.ok(value === null || (Number.isSafeInteger(value) && value >= 0));
  localSql(`insert into private.point_policy(singleton,version,attendance_amount,post_amount,comment_amount,post_daily_cap,comment_daily_cap,deleted_content_treatment)
    values(true,'synthetic-activity-browser-v1',0,${postAmount},${commentAmount},${postCap ?? 'null'},${commentCap ?? 'null'},'retain')
    on conflict(singleton) do update set version=excluded.version,attendance_amount=excluded.attendance_amount,post_amount=excluded.post_amount,comment_amount=excluded.comment_amount,post_daily_cap=excluded.post_daily_cap,comment_daily_cap=excluded.comment_daily_cap,deleted_content_treatment=excluded.deleted_content_treatment;`);
}
export function removePolicy() {
  localSql('delete from private.point_policy;');
}
function asActor(actor: Identity, expression: string) {
  return localSql(
    `begin; set local role authenticated; set local "request.jwt.claim.sub"='${uuid(actor.id)}'; select ${expression}; commit;`,
  );
}
export function createPost(
  actor: Identity,
  artist: Artist,
  id = randomUUID(),
  operation = randomUUID(),
) {
  asActor(
    actor,
    `public.board_ui_create(${literal(artist.slug)},'${uuid(operation)}','${uuid(id)}','${uuid(artist.id)}','허구 활동 확인 글','격리 CI의 허구 활동 확인용 내용입니다.',array[]::uuid[],false,false)`,
  );
  return id;
}
export function createComment(
  actor: Identity,
  artist: Artist,
  postId: string,
  id = randomUUID(),
  operation = randomUUID(),
) {
  asActor(
    actor,
    `public.community_ui_create_comment(${literal(artist.slug)},'${uuid(operation)}','${uuid(postId)}','${uuid(id)}','격리 CI의 허구 댓글입니다.')`,
  );
  return id;
}
export function seedHistory(actor: Identity, artist: Artist, count = 25) {
  assert.ok(Number.isInteger(count) && count > 0 && count <= 30);
  const rows = Array.from({ length: count }, () => ({
    id: randomUUID(),
    request: randomUUID(),
  }));
  asActor(
    actor,
    rows
      .map(
        (row) =>
          `public.board_ui_create(${literal(artist.slug)},'${uuid(row.request)}','${uuid(row.id)}','${uuid(artist.id)}','허구 활동 기록','격리 CI의 허구 활동 이력입니다.',array[]::uuid[],false,false)`,
      )
      .join('; select '),
  );
  return ledger(actor).map((row) => row.id);
}
export function seedLegacy(actor: Identity, artist: Artist, amount = 9) {
  assert.ok(Number.isSafeInteger(amount) && amount >= 0);
  const sourceId = randomUUID(),
    entryId = randomUUID();
  // This proves that pre-migration-style entries without evidence are labelled
  // legacy, not guessed from their amount. No immutable rows are modified.
  removePolicy();
  createPost(actor, artist, sourceId);
  localSql(`insert into private.point_ledger(id,user_id,amount,reason,ref_id,earned_on,policy_version,policy_snapshot,actor_id,post_id,created_at)
    values('${uuid(entryId)}','${uuid(actor.id)}',${amount},'post','${uuid(sourceId)}',date '2001-01-01','synthetic-legacy-activity-v1','{"kind":"synthetic"}','${uuid(actor.id)}','${uuid(sourceId)}','2001-01-01T00:00:00.123456Z');`);
  preparePolicy();
  return entryId;
}
export function ledger(actor: Identity) {
  return JSON.parse(
    localSql(
      `select coalesce(jsonb_agg(to_jsonb(l) order by l.created_at desc,l.id desc),'[]'::jsonb) from private.point_ledger l where user_id='${uuid(actor.id)}';`,
    ),
  ) as Array<{
    id: string;
    amount: number;
    reason: string;
    post_id: string | null;
    comment_id: string | null;
    earned_on: string;
    created_at: string;
  }>;
}
export function unrelatedSnapshot() {
  return localSql(
    `select jsonb_build_object('posts',(select count(*) from public.posts),'comments',(select count(*) from public.comments),'ledger',(select count(*) from private.point_ledger),'evidence',(select count(*) from private.point_activity_outcomes),'payments',(select count(*) from public.payment_events),'notifications',(select count(*) from private.notification_jobs),'settlements',(select count(*) from public.settlements),'analytics',(select count(*) from private.analytics_events));`,
  );
}
export const test = base.extend<{ world: World }>({
  world: async ({}, provide) => {
    preparePolicy();
    localSql(`delete from private.analytics_policy;
      insert into private.community_policy(singleton,version,max_title_length,max_body_length,max_comment_length,max_reason_length,max_images,max_image_bytes,max_image_long_edge,auto_hide_report_count,rate_window_seconds,max_contributions_per_window,max_reports_per_window,forbidden_terms,forbidden_patterns)
      values(true,'synthetic-activity-browser-v1',120,4000,100,1000,3,1048576,2048,3,60,1000,1000,array[]::text[],array[]::text[])
      on conflict(singleton) do update set version=excluded.version,max_title_length=excluded.max_title_length,max_body_length=excluded.max_body_length,max_comment_length=excluded.max_comment_length,max_contributions_per_window=excluded.max_contributions_per_window,forbidden_terms=excluded.forbidden_terms,forbidden_patterns=excluded.forbidden_patterns;`);
    const fan = await createIdentity('fan'),
      other = await createIdentity('fan');
    const artist = { id: randomUUID(), slug: `ci-activity-${randomUUID()}` };
    localSql(
      `insert into public.artists(id,slug,name,intro,grade,status) values('${uuid(artist.id)}',${literal(artist.slug)},'허구 활동 가수','격리 CI의 허구 가수입니다.','B','active');`,
    );
    await provide({ fan, other, artist });
    // Immutable fixture history remains until the dedicated local CI stack is
    // destroyed. No cleanup disables triggers or edits ledger/outcome evidence.
  },
});
export { expect };
export function get(request: APIRequestContext, path: string, actor: Identity) {
  return request.get(path, {
    headers: { [ACTIVITY_REWARDS.actorHeader]: actor.id },
  });
}
export async function blockExternal(context: BrowserContext) {
  externalRequests.set(
    context,
    await blockActivityExternalRequests(context, [appOrigin, databaseOrigin]),
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
    /AUTH_TEST_SERVICE_KEY|SUPABASE_SERVICE_ROLE_KEY|activity-rewards-e2e-.*@example[.]invalid/,
  );
}
export async function screenshot(
  page: Page,
  info: TestInfo,
  name: string,
  scale: Scale,
) {
  await assertRenderedScale(page, scale);
  await captureSettledActivityRewards(page, info.outputPath(`${name}.png`));
}
export function setFont(actor: Identity, scale: Scale) {
  assert.ok(['normal', 'large', 'xlarge'].includes(scale));
  localSql(
    `update public.profiles set font_scale='${scale}' where id='${uuid(actor.id)}' and exists(select 1 from auth.users where id='${uuid(actor.id)}' and email ~ '^activity-rewards-e2e-[0-9a-f-]{36}@example[.]invalid$');`,
  );
}
export function setRestricted(actor: Identity, restricted: boolean) {
  assert.equal(typeof restricted, 'boolean');
  localSql(
    `update public.profiles set is_restricted=${restricted},restricted_until=null where id='${uuid(actor.id)}' and exists(select 1 from auth.users where id='${uuid(actor.id)}' and email ~ '^activity-rewards-e2e-[0-9a-f-]{36}@example[.]invalid$');`,
  );
}
