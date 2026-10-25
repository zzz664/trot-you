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
import { SCHEDULE_NOTICES_CI_ENV } from '../../../scripts/schedule-notices-local-config.mjs';
import type { Database } from '../../../src/types/database';

export const appOrigin = 'http://127.0.0.1:3100';
const databaseOrigin = 'http://127.0.0.1:54321';
export type Scale = 'normal' | 'large' | 'xlarge';
export type Identity = {
  id: string;
  signIn(context: BrowserContext): Promise<void>;
  actorClient(): Promise<SupabaseClient<Database>>;
};
export type Artist = { id: string; slug: string; name: string };
export type Event = { id: string; title: string };
export type World = {
  fan: Identity;
  other: Identity;
  artist: Artist;
  unrelated: Artist;
  event: Event;
  another: Event;
  today: Event;
  afterTomorrow: Event;
  draft: Event;
  unrelatedEvent: Event;
  month: string;
};
const externalRequests = new WeakMap<BrowserContext, string[]>();

function credentials() {
  assert.equal(process.env.CI, 'true');
  assert.equal(process.env.GITHUB_ACTIONS, 'true');
  assert.equal(process.env.AUTH_LOCAL_E2E, 'true');
  assert.equal(process.env.SCHEDULE_NOTICES_LOCAL_E2E, 'true');
  assert.equal(process.env.NEXT_PUBLIC_APP_URL, appOrigin);
  assert.equal(process.env.NEXT_PUBLIC_SUPABASE_URL, databaseOrigin);
  for (const [key, value] of Object.entries(SCHEDULE_NOTICES_CI_ENV))
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
  assert.ok(
    serviceKey === process.env.SUPABASE_SERVICE_ROLE_KEY,
    'The app and fixture must share the disposable local stack.',
  );
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
export function uuid(value: string) {
  assert.match(
    value,
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );
  return value;
}
async function createIdentity(): Promise<Identity> {
  const { anonKey, serviceKey } = credentials();
  const service = createClient<Database>(databaseOrigin, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const email = `schedule-notices-e2e-${randomUUID()}@example.invalid`;
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
  localSql(`update public.profiles set role='fan',call_name='허구알림팬',onboarding_completed_at=clock_timestamp()
    where id='${uuid(id)}' and exists(select 1 from auth.users where id='${uuid(id)}' and email ~ '^schedule-notices-e2e-[0-9a-f-]{36}@example[.]invalid$');`);
  return {
    id,
    async actorClient() {
      const client = createClient<Database>(databaseOrigin, anonKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      assert.equal(
        (await client.auth.signInWithPassword({ email, password })).error,
        null,
      );
      return client;
    },
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

export const policyVersion = 'b22f7186-aaed-4624-aecd-a7ada285d2a2';
export const consentVersion = 'fictional-schedule-notice-consent-v1';
export function preparePolicies() {
  localSql(`insert into private.notification_policy(singleton,version,consent_version,webpush_enabled,max_attempts,retry_seconds,lease_seconds,schedule_lead_seconds)
    values(true,'fictional-schedule-notices-ci-only','${consentVersion}',true,3,60,30,86400)
    on conflict(singleton) do update set version=excluded.version,consent_version=excluded.consent_version,webpush_enabled=excluded.webpush_enabled,
      max_attempts=excluded.max_attempts,retry_seconds=excluded.retry_seconds,lease_seconds=excluded.lease_seconds,schedule_lead_seconds=excluded.schedule_lead_seconds;
    insert into private.schedule_notice_policies(version,hour_kst,approved_at,published_at)
      values('${policyVersion}',0,clock_timestamp(),clock_timestamp()) on conflict(version) do nothing;
    insert into private.schedule_notice_policy_current(singleton,policy_version) values(true,'${policyVersion}')
      on conflict(singleton) do update set policy_version=excluded.policy_version;`);
}
export const test = base.extend<{ world: World }>({
  world: async ({}, provide) => {
    preparePolicies();
    const fan = await createIdentity();
    const other = await createIdentity();
    const artist = {
      id: randomUUID(),
      slug: `ci-schedule-notices-${randomUUID()}`,
      name: '허구 내 가수',
    };
    const unrelated = {
      id: randomUUID(),
      slug: `ci-schedule-notices-${randomUUID()}`,
      name: '허구 관심만 고른 가수',
    };
    for (const item of [artist, unrelated])
      localSql(`insert into public.artists(id,slug,name,intro,grade,status)
        values('${uuid(item.id)}','${item.slug}','${item.name}','격리 CI의 허구 일정 알림 자료입니다.','B','active');`);
    localSql(`insert into public.subscriptions(user_id,artist_id,provider,status,
      created_at,first_started_at,episode_started_at,current_period_start,current_period_end,next_billing_at)
      values('${uuid(fan.id)}','${uuid(artist.id)}','toss','active',now()-interval '32 days',now()-interval '1 day',now()-interval '1 day',now()-interval '1 day',now()+interval '29 days',now()+interval '29 days');
      insert into private.artist_interests(user_id,artist_id,selected_at) values('${uuid(fan.id)}','${uuid(unrelated.id)}',clock_timestamp());`);
    const event = {
      id: randomUUID(),
      title: '허구 내일 저녁 콘서트 — 함께 노래해요',
    };
    const another = { id: randomUUID(), title: '허구 내일 오전 방송' };
    const today = { id: randomUUID(), title: '허구 오늘 일정' };
    const afterTomorrow = { id: randomUUID(), title: '허구 모레 첫 일정' };
    const draft = { id: randomUUID(), title: '허구 비공개 내일 일정' };
    const unrelatedEvent = {
      id: randomUUID(),
      title: '허구 관심만 고른 가수의 내일 일정',
    };
    const create = (
      item: Event,
      owner: Artist,
      days: number,
      hours: number,
      status = 'published',
    ) =>
      localSql(`insert into public.schedules(id,artist_id,type,status,title,description,starts_at,ends_at,place_name,address,created_by)
      values('${uuid(item.id)}','${uuid(owner.id)}','concert','${status}','${item.title}',
      '실제 행사나 발송이 아닌 격리 CI 자료입니다. 긴 일정 설명 아래에 있는 알림 버튼도 큰 글자 화면에서 찾고 조작할 수 있어야 합니다.\n여러 줄의 공개 행사 안내가 화면 밖으로 넘어가도 알림 설정과 돌아가기 버튼은 정상적으로 동작합니다.',
      (((clock_timestamp() at time zone 'Asia/Seoul')::date+${days})::timestamp+make_interval(hours=>${hours})) at time zone 'Asia/Seoul',
      null,'허구 시민 공연장','허구 공개 행사 주소','${uuid(fan.id)}');`);
    create(event, artist, 1, 18);
    create(another, artist, 1, 8);
    create(today, artist, 0, 0);
    create(afterTomorrow, artist, 2, 0);
    create(draft, artist, 1, 12, 'draft');
    create(unrelatedEvent, unrelated, 1, 19);
    const month = localSql(
      `select to_char(starts_at at time zone 'Asia/Seoul','YYYY-MM') from public.schedules where id='${uuid(event.id)}';`,
    );
    await provide({
      fan,
      other,
      artist,
      unrelated,
      event,
      another,
      today,
      afterTomorrow,
      draft,
      unrelatedEvent,
      month,
    });
    // Hide this test's fictional sources so next-day fixtures share the real
    // current month without duplicate labels or unbounded screenshot growth.
    // Keep all identities, jobs and immutable audit evidence until job teardown.
    localSql(
      `update public.schedules set status='draft' where artist_id in('${uuid(artist.id)}','${uuid(unrelated.id)}');`,
    );
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
    /AUTH_TEST_SERVICE_KEY|SUPABASE_SERVICE_ROLE_KEY|schedule-notices-e2e-.*@example[.]invalid|private-service-value/,
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
    fullPage: true,
  });
}
export function setFont(actor: Identity, scale: Scale) {
  assert.ok(['normal', 'large', 'xlarge'].includes(scale));
  localSql(
    `update public.profiles set font_scale='${scale}' where id='${uuid(actor.id)}' and exists(select 1 from auth.users where id='${uuid(actor.id)}' and email ~ '^schedule-notices-e2e-[0-9a-f-]{36}@example[.]invalid$');`,
  );
}
export function setRestricted(actor: Identity, restricted: boolean) {
  localSql(`update public.profiles set is_restricted=${restricted},restricted_until=null where id='${uuid(actor.id)}'
    and exists(select 1 from auth.users where id='${uuid(actor.id)}' and email ~ '^schedule-notices-e2e-[0-9a-f-]{36}@example[.]invalid$');`);
}
export function preferences(actor: Identity) {
  return JSON.parse(
    localSql(
      `select coalesce((select row_to_json(n) from private.notification_preferences n where user_id='${uuid(actor.id)}'),'null'::json);`,
    ),
  ) as {
    webpush_enabled: boolean;
    new_message: boolean;
    billing: boolean;
    schedule: boolean;
  } | null;
}
export function jobs(world: World) {
  return JSON.parse(
    localSql(`select coalesce(json_agg(json_build_object('id',id,'sourceId',source_id,'state',state,'cancellationRequestedAt',cancellation_requested_at) order by source_id,id),'[]'::json)
    from private.notification_jobs where source_kind='schedule' and user_id='${uuid(world.fan.id)}';`),
  ) as {
    id: string;
    sourceId: string;
    state: string;
    cancellationRequestedAt: string | null;
  }[];
}
export async function registerDevice(actor: Identity) {
  const { serviceKey } = credentials();
  const client = await actor.actorClient();
  const { data } = await client.auth.getClaims();
  const sessionId = data?.claims.session_id;
  assert.equal(typeof sessionId, 'string');
  const service = createClient<Database>(databaseOrigin, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: id, error } = await service.rpc('webpush_register_device', {
    p_actor_id: actor.id,
    p_auth_session_id: sessionId as string,
    p_endpoint: `https://fcm.googleapis.com/wp/synthetic-schedule-ci-${randomUUID()}`,
    p_p256dh:
      'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
    p_auth: 'BTBZMqHH6r4Tts7J_aSIgg',
    p_consent_version: consentVersion,
  });
  assert.equal(error, null);
  assert.equal(typeof id, 'string');
  return { id: id as string, sessionId: sessionId as string };
}

export function setRole(actor: Identity, role: 'artist' | 'admin') {
  assert.ok(['artist', 'admin'].includes(role));
  localSql(`update public.profiles set role='${role}' where id='${uuid(actor.id)}'
    and exists(select 1 from auth.users where id='${uuid(actor.id)}' and email ~ '^schedule-notices-e2e-[0-9a-f-]{36}@example[.]invalid$');`);
}
