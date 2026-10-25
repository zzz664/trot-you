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
import { ADMIN_SUBSCRIPTIONS_CI_ENV } from '../../../scripts/admin-subscriptions-local-config.mjs';
import type { Database } from '../../../src/types/database';
import { subscriptionSourceSql } from './source-fixture';

export const appOrigin = 'http://127.0.0.1:3100';
const databaseOrigin = 'http://127.0.0.1:54321';
export type Scale = 'normal' | 'large' | 'xlarge';
export type Identity = {
  id: string;
  signIn(context: BrowserContext): Promise<void>;
};
export type World = {
  admin: Identity;
  other: Identity;
  fan: Identity;
  artist: { id: string; name: string };
  empty: { id: string; name: string };
  range: { from: string; to: string };
};
const externalRequests = new WeakMap<BrowserContext, string[]>();

function credentials() {
  assert.equal(process.env.CI, 'true');
  assert.equal(process.env.GITHUB_ACTIONS, 'true');
  assert.equal(process.env.AUTH_LOCAL_E2E, 'true');
  assert.equal(process.env.ADMIN_SUBSCRIPTIONS_LOCAL_E2E, 'true');
  assert.equal(process.env.NEXT_PUBLIC_APP_URL, appOrigin);
  assert.equal(process.env.NEXT_PUBLIC_SUPABASE_URL, databaseOrigin);
  for (const [key, value] of Object.entries(ADMIN_SUBSCRIPTIONS_CI_ENV))
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
async function createIdentity(role: 'admin' | 'fan'): Promise<Identity> {
  const { anonKey, serviceKey } = credentials();
  const service = createClient<Database>(databaseOrigin, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const email = `admin-subscriptions-e2e-${randomUUID()}@example.invalid`;
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
    where id='${uuid(id)}' and exists(select 1 from auth.users where id='${uuid(id)}' and email ~ '^admin-subscriptions-e2e-[0-9a-f-]{36}@example[.]invalid$');`);
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
    const admin = await createIdentity('admin');
    const other = await createIdentity('admin');
    const fan = await createIdentity('fan');
    const artist = { id: randomUUID(), name: '허구 구독 집계 가수' };
    const empty = { id: randomUUID(), name: '허구 구독 없는 가수' };
    const range = JSON.parse(
      localSql(subscriptionSourceSql(uuid(artist.id), uuid(empty.id))),
    ) as { from: string; to: string };
    await provide({ admin, other, fan, artist, empty, range });
    // Fictional accounts and immutable billing fixtures are retained until the
    // dedicated CI job destroys its stack; no protections are disabled.
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
    /AUTH_TEST_SERVICE_KEY|SUPABASE_SERVICE_ROLE_KEY|fictional-private-fan|fictional-private-payment|admin-subscriptions-e2e-.*@example[.]invalid/,
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
    `update public.profiles set font_scale='${scale}' where id='${uuid(actor.id)}' and exists(select 1 from auth.users where id='${uuid(actor.id)}' and email ~ '^admin-subscriptions-e2e-[0-9a-f-]{36}@example[.]invalid$');`,
  );
}
export function setRole(actor: Identity, role: 'fan' | 'admin') {
  assert.ok(['fan', 'admin'].includes(role));
  localSql(
    `update public.profiles set role='${role}' where id='${uuid(actor.id)}' and exists(select 1 from auth.users where id='${uuid(actor.id)}' and email ~ '^admin-subscriptions-e2e-[0-9a-f-]{36}@example[.]invalid$');`,
  );
}

export function setRestricted(actor: Identity, restricted: boolean) {
  localSql(
    `update public.profiles set is_restricted=${restricted},restricted_until=null where id='${uuid(actor.id)}' and exists(select 1 from auth.users where id='${uuid(actor.id)}' and email ~ '^admin-subscriptions-e2e-[0-9a-f-]{36}@example[.]invalid$');`,
  );
}
export function billingFingerprint(artistId: string) {
  return localSql(`select md5(jsonb_build_object(
    'subscriptions',(select jsonb_agg(to_jsonb(s) order by s.id) from public.subscriptions s where s.artist_id='${uuid(artistId)}'),
    'events',(select jsonb_agg(to_jsonb(e) order by e.id) from public.payment_events e join public.subscriptions s on s.id=e.subscription_id where s.artist_id='${uuid(artistId)}'),
    'obligations',(select jsonb_agg(to_jsonb(o) order by o.id) from private.billing_obligations o join public.subscriptions s on s.id=o.subscription_id where s.artist_id='${uuid(artistId)}'),
    'attempts',(select jsonb_agg(to_jsonb(a) order by a.id) from private.payment_attempts a join private.billing_obligations o on o.id=a.obligation_id join public.subscriptions s on s.id=o.subscription_id where s.artist_id='${uuid(artistId)}')
  )::text);`);
}
