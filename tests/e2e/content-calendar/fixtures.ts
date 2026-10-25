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
import { CONTENT_CALENDAR_CI_ENV } from '../../../scripts/content-calendar-local-config.mjs';
import type { Database } from '../../../src/types/database';
import { captureSettledContentCalendar } from './screenshot-capture';

export const appOrigin = 'http://127.0.0.1:3100';
const databaseOrigin = 'http://127.0.0.1:54321';
export type Scale = 'normal' | 'large' | 'xlarge';
export type Identity = {
  id: string;
  signIn(context: BrowserContext): Promise<void>;
};
export type Artist = { id: string; slug: string; name: string };
export type Entry = {
  id: string;
  date: string;
  topic: string;
  exampleText: string | null;
};
export type World = {
  admin: Identity;
  other: Identity;
  member: Identity;
  outsider: Identity;
  fan: Identity;
  artist: Artist;
  unrelated: Artist;
  paused: Artist;
  month: string;
  nextMonth: string;
  previousMonth: string;
  entry: Entry;
  second: Entry;
  outside: Entry;
};
const externalRequests = new WeakMap<BrowserContext, string[]>();
function credentials() {
  assert.equal(process.env.CI, 'true');
  assert.equal(process.env.GITHUB_ACTIONS, 'true');
  assert.equal(process.env.AUTH_LOCAL_E2E, 'true');
  assert.equal(process.env.CONTENT_CALENDAR_LOCAL_E2E, 'true');
  assert.equal(process.env.NEXT_PUBLIC_APP_URL, appOrigin);
  assert.equal(process.env.NEXT_PUBLIC_SUPABASE_URL, databaseOrigin);
  for (const [key, value] of Object.entries(CONTENT_CALENDAR_CI_ENV))
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
async function createIdentity(
  role: 'admin' | 'fan' | 'artist',
): Promise<Identity> {
  const { anonKey, serviceKey } = credentials();
  const service = createClient<Database>(databaseOrigin, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const email = `content-calendar-e2e-${randomUUID()}@example.invalid`;
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
    where id='${uuid(id)}' and exists(select 1 from auth.users where id='${uuid(id)}' and email ~ '^content-calendar-e2e-[0-9a-f-]{36}@example[.]invalid$');`);
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
    const member = await createIdentity('artist');
    const outsider = await createIdentity('artist');
    const fan = await createIdentity('fan');
    const localIndex = monthIndex++;
    assert.ok(
      localIndex < 100,
      'Reserve another fixture block before adding 100 cases.',
    );
    const offset = info.workerIndex * 100 + localIndex;
    assert.ok(
      offset < 9000,
      'The isolated suite exceeded its fixture month range.',
    );
    const month = calendarMonth(offset);
    const nextMonth = calendarMonth(offset + 1);
    const previousMonth = calendarMonth(offset - 1);
    const artist = {
      id: randomUUID(),
      slug: `ci-calendar-${9999 - offset}-${randomUUID()}`,
      name: `허구 달력 가수 ${month}`,
    };
    const unrelated = {
      id: randomUUID(),
      slug: `ci-calendar-${9999 - offset}-${randomUUID()}`,
      name: `허구 다른 달력 가수 ${month}`,
    };
    const paused = {
      id: randomUUID(),
      slug: `ci-calendar-${9999 - offset}-${randomUUID()}`,
      name: `허구 비공개 달력 가수 ${month}`,
    };
    for (const item of [artist, unrelated, paused])
      localSql(`insert into public.artists(id,slug,name,intro,grade,status)
        values('${uuid(item.id)}','${item.slug}','${item.name}','격리 CI의 비공개 편집 달력 점검용 허구 자료입니다.','B','${item === paused ? 'paused' : 'active'}');`);
    localSql(`insert into public.artist_members(artist_id,user_id) values
      ('${uuid(artist.id)}','${uuid(member.id)}'),
      ('${uuid(paused.id)}','${uuid(member.id)}'),
      ('${uuid(unrelated.id)}','${uuid(outsider.id)}');`);
    const entry = {
      id: randomUUID(),
      date: `${month}-05`,
      topic: '허구 봄날의 안부 <strong>문자 그대로</strong>',
      exampleText:
        '안녕하세요 {이름} 님. 예문은 자동 발송되지 않습니다. 여러 줄의 긴 내용을 큰 글자에서도 끝까지 읽을 수 있는지 확인하는 허구 편집 예시입니다.\n오늘 떠오른 노래를 함께 이야기해요.',
    };
    const second = {
      id: randomUUID(),
      date: `${month}-17`,
      topic: '허구 무대 뒤 이야기',
      exampleText: null,
    };
    const outside = {
      id: randomUUID(),
      date: `${nextMonth}-01`,
      topic: '허구 다음 달 첫인사',
      exampleText: '다음 달에 참고할 편집 예시입니다.',
    };
    for (const item of [entry, second, outside])
      localSql(`insert into public.content_calendar(id,artist_id,date,topic,example_text,created_by)
        values('${uuid(item.id)}','${uuid(artist.id)}','${item.date}',${literal(item.topic)},${item.exampleText === null ? 'null' : literal(item.exampleText)},'${uuid(admin.id)}');`);
    localSql(`insert into public.content_calendar(artist_id,date,topic,created_by) values
      ('${uuid(unrelated.id)}','${month}-05','허구 다른 가수 비공개 주제','${uuid(admin.id)}'),
      ('${uuid(paused.id)}','${month}-05','허구 비활성 가수 비공개 주제','${uuid(admin.id)}');
      insert into public.messages(artist_id,author_id,type,body,status,scheduled_at,sent_at) values
      ('${uuid(artist.id)}','${uuid(member.id)}','text','허구 이번 주 활동 기록','sent',statement_timestamp(),statement_timestamp()),
      ('${uuid(artist.id)}','${uuid(member.id)}','photo','허구 이번 주 사진 기록','sent',statement_timestamp(),statement_timestamp());`);
    await provide({
      admin,
      other,
      member,
      outsider,
      fan,
      artist,
      unrelated,
      paused,
      month,
      nextMonth,
      previousMonth,
      entry,
      second,
      outside,
    });
    // Disposable Auth identities and immutable audit rows remain until this
    // dedicated CI job destroys its local stack; no trigger bypass or provider I/O.
  },
});
export { expect };
function literal(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}
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
    /AUTH_TEST_SERVICE_KEY|SUPABASE_SERVICE_ROLE_KEY|content-calendar-e2e-.*@example[.]invalid/,
  );
}
export async function screenshot(
  page: Page,
  info: TestInfo,
  name: string,
  scale: Scale,
) {
  await assertRenderedScale(page, scale);
  await captureSettledContentCalendar(page, info.outputPath(`${name}.png`));
}
export function setFont(actor: Identity, scale: Scale) {
  assert.ok(['normal', 'large', 'xlarge'].includes(scale));
  localSql(
    `update public.profiles set font_scale='${scale}' where id='${uuid(actor.id)}' and exists(select 1 from auth.users where id='${uuid(actor.id)}' and email ~ '^content-calendar-e2e-[0-9a-f-]{36}@example[.]invalid$');`,
  );
}
export function setRestricted(actor: Identity, restricted: boolean) {
  assert.equal(typeof restricted, 'boolean');
  localSql(
    `update public.profiles set is_restricted=${restricted},restricted_until=null where id='${uuid(actor.id)}' and exists(select 1 from auth.users where id='${uuid(actor.id)}' and email ~ '^content-calendar-e2e-[0-9a-f-]{36}@example[.]invalid$');`,
  );
}
export function setRole(actor: Identity, role: 'fan' | 'admin' | 'artist') {
  assert.ok(['fan', 'admin', 'artist'].includes(role));
  localSql(
    `update public.profiles set role='${role}' where id='${uuid(actor.id)}' and exists(select 1 from auth.users where id='${uuid(actor.id)}' and email ~ '^content-calendar-e2e-[0-9a-f-]{36}@example[.]invalid$');`,
  );
}
export function removeMembership(world: World) {
  localSql(
    `delete from public.artist_members where artist_id='${uuid(world.artist.id)}' and user_id='${uuid(world.member.id)}';`,
  );
}
export function sourceSnapshot(world: World) {
  return localSql(`select jsonb_build_object(
    'messages',(select count(*) from public.messages where artist_id='${uuid(world.artist.id)}'),
    'payments',(select count(*) from public.payment_events),
    'notifications',(select count(*) from private.notification_jobs),
    'settlements',(select count(*) from public.settlements));`);
}

export function enableActivityRequirements(world: World) {
  // Disposable, explicitly synthetic approved-contract fixture. Reuses the
  // established activity comparison schema; it does not choose a real policy.
  localSql(`insert into private.settlement_policies(artist_id,month,enabled,contract_from,contract_until,base_rate,performance_rate,vat_rate,pg_fee_rate,activity_enabled,weekly_message_min,weekly_photo_min,partial_week_policy)
    select '${uuid(world.artist.id)}',month::date,true,w::date,(w+interval '7 days')::date,0.3,0.4,0.1,0.03,true,3,2,'prorate_days'
    from (select date_trunc('week',now() at time zone 'Asia/Seoul') w) week
    cross join lateral generate_series(date_trunc('month',w),date_trunc('month',w+interval '6 days'),interval '1 month') month
    on conflict(artist_id,month) do update set enabled=true,contract_from=excluded.contract_from,contract_until=excluded.contract_until,activity_enabled=true,weekly_message_min=3,weekly_photo_min=2;`);
}
