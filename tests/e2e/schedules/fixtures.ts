import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { captureSettledSchedulePage } from './screenshot-capture';
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
import { SCHEDULES_CI_ENV } from '../../../scripts/schedules-local-config.mjs';
import type { Database } from '../../../src/types/database';

export const appOrigin = 'http://127.0.0.1:3100';
const databaseOrigin = 'http://127.0.0.1:54321';
export type Scale = 'normal' | 'large' | 'xlarge';
export type Identity = {
  id: string;
  signIn(context: BrowserContext): Promise<void>;
};
export type Artist = { id: string; slug: string; name: string };
export type Event = { id: string; title: string };
export type World = {
  admin: Identity;
  other: Identity;
  fan: Identity;
  emptyFan: Identity;
  artist: Artist;
  unrelated: Artist;
  grace: Artist;
  canceled: Artist;
  inactive: Artist;
  month: string;
  nextMonth: string;
  previousMonth: string;
  event: Event;
  overlap: Event;
  noMap: Event;
  draft: Event;
  hidden: Event;
  outside: Event;
  ended: Event;
  graceEvent: Event;
  canceledEvent: Event;
  unrelatedEvent: Event;
};
const externalRequests = new WeakMap<BrowserContext, string[]>();

function credentials() {
  assert.equal(process.env.CI, 'true');
  assert.equal(process.env.GITHUB_ACTIONS, 'true');
  assert.equal(process.env.AUTH_LOCAL_E2E, 'true');
  assert.equal(process.env.SCHEDULES_LOCAL_E2E, 'true');
  assert.equal(process.env.NEXT_PUBLIC_APP_URL, appOrigin);
  assert.equal(process.env.NEXT_PUBLIC_SUPABASE_URL, databaseOrigin);
  for (const [key, value] of Object.entries(SCHEDULES_CI_ENV))
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
export function uuid(value: string) {
  assert.match(
    value,
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );
  return value;
}
async function createIdentity(role: 'admin' | 'fan'): Promise<Identity> {
  const { anonKey, serviceKey } = credentials();
  const service = createClient<Database>(databaseOrigin, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const email = `schedules-e2e-${randomUUID()}@example.invalid`;
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
    where id='${uuid(id)}' and exists(select 1 from auth.users where id='${uuid(id)}' and email ~ '^schedules-e2e-[0-9a-f-]{36}@example[.]invalid$');`);
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

let monthIndex = 0;
function calendarMonth(offset: number) {
  return new Date(Date.UTC(2036, offset, 1)).toISOString().slice(0, 7);
}
export const test = base.extend<{ world: World }>({
  world: async ({}, provide, info) => {
    const admin = await createIdentity('admin');
    const other = await createIdentity('admin');
    const fan = await createIdentity('fan');
    const emptyFan = await createIdentity('fan');
    // Failed Playwright tests restart the worker but retain this disposable DB.
    // workerIndex is unique after every restart; reserve disjoint month blocks
    // so old rows cannot duplicate labels, contaminate lists or hide a picker.
    const localIndex = monthIndex++;
    assert.ok(
      localIndex < 100,
      'Increase the fixture month block before adding 100 tests per worker.',
    );
    const offset = info.workerIndex * 100 + localIndex;
    assert.ok(
      offset < 9000,
      'The isolated suite exceeded its bounded fixture month range.',
    );
    const scope = `${info.workerIndex}-${localIndex}`;
    const month = calendarMonth(offset);
    const nextMonth = calendarMonth(offset + 1);
    const previousMonth = calendarMonth(offset - 1);
    const artist = {
      id: randomUUID(),
      slug: `ci-schedules-${9999 - offset}-${randomUUID()}`,
      name: `허구 내 가수 ${month} · 점검 ${scope}`,
    };
    const unrelated = {
      id: randomUUID(),
      slug: `ci-schedules-${9999 - offset}-${randomUUID()}`,
      name: `허구 다른 가수 ${month} · 점검 ${scope}`,
    };
    const grace = {
      id: randomUUID(),
      slug: `ci-schedules-${9999 - offset}-${randomUUID()}`,
      name: `허구 유예 가수 ${month} · 점검 ${scope}`,
    };
    const canceled = {
      id: randomUUID(),
      slug: `ci-schedules-${9999 - offset}-${randomUUID()}`,
      name: `허구 이용기간 남은 가수 ${month} · 점검 ${scope}`,
    };
    const inactive = {
      id: randomUUID(),
      slug: `ci-schedules-${9999 - offset}-${randomUUID()}`,
      name: `허구 비공개 가수 ${month} · 점검 ${scope}`,
    };
    for (const item of [artist, unrelated, grace, canceled, inactive])
      localSql(`insert into public.artists(id,slug,name,intro,grade,status)
        values('${uuid(item.id)}','${item.slug}','${item.name}','격리 CI의 공개 일정 점검용 허구 자료입니다.','B','${item === inactive ? 'paused' : 'active'}');`);
    // Structural subscription-access snapshots only. No payment method, billing
    // obligation, provider request, monetary event or commercial policy exists.
    localSql(`insert into public.subscriptions(user_id,artist_id,provider,status,
      created_at,first_started_at,episode_started_at,current_period_start,current_period_end,next_billing_at)
      values('${uuid(fan.id)}','${uuid(artist.id)}','toss','active',now()-interval '32 days',now()-interval '1 day',now()-interval '1 day',now()-interval '1 day',now()+interval '29 days',now()+interval '29 days');
      insert into public.subscriptions(user_id,artist_id,provider,status,
      created_at,first_started_at,episode_started_at,current_period_start,current_period_end,grace_started_at,grace_ends_at,next_billing_at)
      values('${uuid(fan.id)}','${uuid(grace.id)}','toss','grace',now()-interval '32 days',now()-interval '31 days',now()-interval '31 days',now()-interval '31 days',now()-interval '1 day',now()-interval '1 day',now()+interval '2 days',now()-interval '1 day');
      insert into public.subscriptions(user_id,artist_id,provider,status,
      created_at,first_started_at,episode_started_at,current_period_start,current_period_end,canceled_at)
      values('${uuid(fan.id)}','${uuid(canceled.id)}','toss','canceled',now()-interval '32 days',now()-interval '2 days',now()-interval '2 days',now()-interval '2 days',now()+interval '28 days',now()-interval '1 day');`);
    localSql(
      `insert into private.artist_interests(user_id,artist_id,selected_at) values('${uuid(fan.id)}','${uuid(unrelated.id)}',clock_timestamp());`,
    );
    const event = {
      id: randomUUID(),
      title: '허구 가을 콘서트 — 함께 노래하는 저녁',
    };
    const overlap = { id: randomUUID(), title: '허구 월 경계 축제' };
    const noMap = { id: randomUUID(), title: '허구 온라인 방송' };
    const draft = { id: randomUUID(), title: '허구 아직 공개하지 않은 일정' };
    const hidden = { id: randomUUID(), title: '허구 비활성 가수의 일정' };
    const outside = { id: randomUUID(), title: '허구 다음 달 일정' };
    const ended = { id: randomUUID(), title: '허구 월 시작 전에 끝난 일정' };
    const graceEvent = {
      id: randomUUID(),
      title: '허구 유예 구독 가수의 일정',
    };
    const canceledEvent = {
      id: randomUUID(),
      title: '허구 남은 이용기간 가수의 일정',
    };
    const unrelatedEvent = { id: randomUUID(), title: '허구 다른 가수의 일정' };
    const create = (
      item: Event,
      owner: Artist,
      starts: string,
      ends: string | null,
      status = 'published',
      coordinates = false,
    ) =>
      localSql(`insert into public.schedules(id,artist_id,type,status,title,description,starts_at,ends_at,place_name,address,lat,lng,created_by)
      values('${uuid(item.id)}','${uuid(owner.id)}','concert','${status}','${item.title}',
      '격리 CI에서만 사용하는 허구 공연 설명입니다. 실제 행사가 아니며 예약이나 외부 전송은 하지 않습니다. 여러 줄의 긴 일정 설명과 상세 항목이 큰 글자 화면에서도 잘 읽히는지 확인합니다.',
      '${starts}',${ends ? `'${ends}'` : 'null'},'허구 시민 공연장','공개 행사 주소 예시',${coordinates ? '37.5665,126.978' : 'null,null'},'${uuid(admin.id)}');`);
    create(
      event,
      artist,
      `${month}-15T18:30:00+09:00`,
      `${month}-15T20:30:00+09:00`,
      'published',
      true,
    );
    create(
      overlap,
      artist,
      `${previousMonth}-28T20:00:00+09:00`,
      `${month}-01T01:00:00+09:00`,
    );
    create(noMap, artist, `${month}-16T20:00:00+09:00`, null);
    create(draft, artist, `${month}-17T20:00:00+09:00`, null, 'draft');
    create(hidden, inactive, `${month}-18T20:00:00+09:00`, null);
    create(outside, artist, `${nextMonth}-01T00:00:00+09:00`, null);
    create(
      ended,
      artist,
      `${previousMonth}-28T20:00:00+09:00`,
      `${month}-01T00:00:00+09:00`,
    );
    create(graceEvent, grace, `${month}-19T20:00:00+09:00`, null);
    create(canceledEvent, canceled, `${month}-20T20:00:00+09:00`, null);
    create(unrelatedEvent, unrelated, `${month}-21T20:00:00+09:00`, null);
    await provide({
      admin,
      other,
      fan,
      emptyFan,
      artist,
      unrelated,
      grace,
      canceled,
      inactive,
      month,
      nextMonth,
      previousMonth,
      event,
      overlap,
      noMap,
      draft,
      hidden,
      outside,
      ended,
      graceEvent,
      canceledEvent,
      unrelatedEvent,
    });
    // Disposable fictional identities/audit rows last only until this dedicated
    // job destroys the local stack. No immutable protection is disabled.
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
    /AUTH_TEST_SERVICE_KEY|SUPABASE_SERVICE_ROLE_KEY|schedules-e2e-.*@example[.]invalid|private-service-value/,
  );
}
export async function screenshot(
  page: Page,
  info: TestInfo,
  name: string,
  scale: Scale,
) {
  await assertRenderedScale(page, scale);
  await captureSettledSchedulePage(page, info.outputPath(`${name}.png`));
}
export function setFont(actor: Identity, scale: Scale) {
  assert.ok(['normal', 'large', 'xlarge'].includes(scale));
  localSql(
    `update public.profiles set font_scale='${scale}' where id='${uuid(actor.id)}' and exists(select 1 from auth.users where id='${uuid(actor.id)}' and email ~ '^schedules-e2e-[0-9a-f-]{36}@example[.]invalid$');`,
  );
}
export function setRole(actor: Identity, role: 'fan' | 'admin') {
  assert.ok(['fan', 'admin'].includes(role));
  localSql(
    `update public.profiles set role='${role}' where id='${uuid(actor.id)}' and exists(select 1 from auth.users where id='${uuid(actor.id)}' and email ~ '^schedules-e2e-[0-9a-f-]{36}@example[.]invalid$');`,
  );
}
export function setRestricted(actor: Identity, restricted: boolean) {
  localSql(
    `update public.profiles set is_restricted=${restricted},restricted_until=null where id='${uuid(actor.id)}' and exists(select 1 from auth.users where id='${uuid(actor.id)}' and email ~ '^schedules-e2e-[0-9a-f-]{36}@example[.]invalid$');`,
  );
}
export function addPaginationEvents(world: World, count = 105) {
  assert.ok(Number.isSafeInteger(count) && count > 0 && count <= 150);
  localSql(`insert into public.schedules(artist_id,type,status,title,starts_at,created_by)
    select '${uuid(world.artist.id)}','event','published','허구 페이지 일정 '||n,
    '${world.month}-22T10:00:00+09:00'::timestamptz+make_interval(secs=>n),'${uuid(world.admin.id)}' from generate_series(1,${count}) n;`);
}
