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
import { ATTENDANCE_POINTS_CI_ENV } from '../../../scripts/attendance-points-local-config.mjs';
import type { Database } from '../../../src/types/database';
import { ATTENDANCE_POINTS } from '../../../src/config/attendance-points';
import { captureSettledAttendancePoints } from './screenshot-capture';

export const appOrigin = 'http://127.0.0.1:3100';
export const databaseOrigin = 'http://127.0.0.1:54321';
export type Scale = 'normal' | 'large' | 'xlarge';
export type Identity = {
  id: string;
  signIn(context: BrowserContext): Promise<void>;
};
export type World = { fan: Identity; other: Identity; admin: Identity };
const externalRequests = new WeakMap<BrowserContext, string[]>();
function credentials() {
  assert.equal(process.env.CI, 'true');
  assert.equal(process.env.GITHUB_ACTIONS, 'true');
  assert.equal(process.env.AUTH_LOCAL_E2E, 'true');
  assert.equal(process.env.ATTENDANCE_POINTS_LOCAL_E2E, 'true');
  assert.equal(process.env.NEXT_PUBLIC_APP_URL, appOrigin);
  assert.equal(process.env.NEXT_PUBLIC_SUPABASE_URL, databaseOrigin);
  for (const [key, value] of Object.entries(ATTENDANCE_POINTS_CI_ENV))
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
  const email = `attendance-points-e2e-${randomUUID()}@example.invalid`;
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
    where id='${uuid(id)}' and exists(select 1 from auth.users where id='${uuid(id)}' and email ~ '^attendance-points-e2e-[0-9a-f-]{36}@example[.]invalid$');`);
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

// Only explicit fictional policy values in this disposable database. No app
// settings, hosted project, operational approval or live points are changed.
export function preparePolicy(amount = 10) {
  assert.ok(Number.isSafeInteger(amount) && amount >= 0);
  localSql(`insert into private.point_policy(singleton,version,attendance_amount,post_amount,comment_amount,post_daily_cap,comment_daily_cap,deleted_content_treatment)
    values(true,'synthetic-attendance-browser-v1',${amount},0,0,0,0,'retain')
    on conflict(singleton) do update set version=excluded.version,attendance_amount=excluded.attendance_amount,post_amount=excluded.post_amount,comment_amount=excluded.comment_amount,post_daily_cap=excluded.post_daily_cap,comment_daily_cap=excluded.comment_daily_cap,deleted_content_treatment=excluded.deleted_content_treatment;`);
}
export function removePolicy() {
  localSql('delete from private.point_policy;');
}
export function seedHistory(actor: Identity, count = 25) {
  assert.ok(Number.isInteger(count) && count > 0 && count <= 100);
  // Stable timestamps deliberately tie, exercising the UUID keyset boundary.
  // All entries belong to synthetic identities and predate this test's KST day.
  const ids = Array.from({ length: count }, () => randomUUID());
  const rows = ids
    .map(
      (id, index) =>
        `('${uuid(id)}','${uuid(actor.id)}',${index % 2 === 0 ? 3 : 2},'attendance','2001-01-${String(index + 1).padStart(2, '0')}',date '2001-01-01'+${index},'synthetic-attendance-history-v1','{"kind":"synthetic"}','${uuid(actor.id)}','2001-02-01T00:00:00.123456Z')`,
    )
    .join(',');
  // count above a calendar month's length uses a canonical ref from the date;
  // this fixture is intentionally limited to the 25-row pagination case.
  assert.ok(count <= 28);
  localSql(
    `insert into private.point_ledger(id,user_id,amount,reason,ref_id,earned_on,policy_version,policy_snapshot,actor_id,created_at) values ${rows};`,
  );
  return ids.sort().reverse();
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
    earned_on: string;
    policy_snapshot: unknown;
    created_at: string;
  }>;
}
export function seedPastOperation(actor: Identity) {
  const operationId = randomUUID(),
    entryId = randomUUID();
  localSql(`insert into private.point_ledger(id,user_id,amount,reason,ref_id,earned_on,policy_version,policy_snapshot,actor_id,created_at)
    values('${uuid(entryId)}','${uuid(actor.id)}',4,'attendance',to_char(private.point_kst_date(clock_timestamp())-1,'YYYY-MM-DD'),private.point_kst_date(clock_timestamp())-1,'synthetic-past-attendance-v1','{"kind":"synthetic"}','${uuid(actor.id)}',clock_timestamp()-interval '1 day');
    insert into private.point_attendance_operations(actor_id,operation_id,entry_id,created_at)
    values('${uuid(actor.id)}','${uuid(operationId)}','${uuid(entryId)}',clock_timestamp()-interval '1 day');`);
  return { operationId, entryId };
}
export function operationCount(actor: Identity) {
  return Number(
    localSql(
      `select count(*) from private.point_attendance_operations where actor_id='${uuid(actor.id)}';`,
    ),
  );
}
export function unrelatedSnapshot() {
  return localSql(
    `select jsonb_build_object('posts',(select count(*) from public.posts),'comments',(select count(*) from public.comments),'payments',(select count(*) from public.payment_events),'notifications',(select count(*) from private.notification_jobs),'settlements',(select count(*) from public.settlements),'analytics',(select count(*) from private.analytics_events));`,
  );
}
export const test = base.extend<{ world: World }>({
  world: async ({}, provide) => {
    preparePolicy();
    localSql('delete from private.analytics_policy;');
    const fan = await createIdentity('fan');
    const other = await createIdentity('fan');
    const admin = await createIdentity('admin');
    await provide({ fan, other, admin });
    // Immutable synthetic histories remain until the isolated job destroys the
    // local stack. No cleanup bypasses ledger or operation-receipt immutability.
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
    headers: { Origin: appOrigin, [ATTENDANCE_POINTS.actorHeader]: actor.id },
    data,
  });
}
export function get(request: APIRequestContext, path: string, actor: Identity) {
  return request.get(path, {
    headers: { [ATTENDANCE_POINTS.actorHeader]: actor.id },
  });
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
    /AUTH_TEST_SERVICE_KEY|SUPABASE_SERVICE_ROLE_KEY|attendance-points-e2e-.*@example[.]invalid/,
  );
}
export async function screenshot(
  page: Page,
  info: TestInfo,
  name: string,
  scale: Scale,
) {
  await assertRenderedScale(page, scale);
  await captureSettledAttendancePoints(page, info.outputPath(`${name}.png`));
}
export function setFont(actor: Identity, scale: Scale) {
  assert.ok(['normal', 'large', 'xlarge'].includes(scale));
  localSql(
    `update public.profiles set font_scale='${scale}' where id='${uuid(actor.id)}' and exists(select 1 from auth.users where id='${uuid(actor.id)}' and email ~ '^attendance-points-e2e-[0-9a-f-]{36}@example[.]invalid$');`,
  );
}
export function setRestricted(actor: Identity, restricted: boolean) {
  assert.equal(typeof restricted, 'boolean');
  localSql(
    `update public.profiles set is_restricted=${restricted},restricted_until=null where id='${uuid(actor.id)}' and exists(select 1 from auth.users where id='${uuid(actor.id)}' and email ~ '^attendance-points-e2e-[0-9a-f-]{36}@example[.]invalid$');`,
  );
}
