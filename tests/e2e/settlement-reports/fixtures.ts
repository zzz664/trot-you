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
import { SETTLEMENT_REPORTS_CI_ENV } from '../../../scripts/settlement-reports-local-config.mjs';
import type { Database } from '../../../src/types/database';
import { SETTLEMENT_REPORTS } from '../../../src/config/settlement-reports';
import { settlementReportSourceSql } from './source-fixture';

export const appOrigin = 'http://127.0.0.1:3100';
export const databaseOrigin = 'http://127.0.0.1:54321';
export type Scale = 'normal' | 'large' | 'xlarge';
export type Identity = {
  id: string;
  signIn(context: BrowserContext): Promise<void>;
};
export type World = {
  admin: Identity;
  other: Identity;
  fan: Identity;
  member: Identity;
  outsider: Identity;
  artist: { id: string; slug: string; name: string };
  otherArtist: string;
  month: string;
  terms: string;
  privacy: string;
  events: { charge: string; refund: string; unverified: string };
};
const externalRequests = new WeakMap<BrowserContext, string[]>();
function credentials() {
  assert.equal(process.env.CI, 'true');
  assert.equal(process.env.GITHUB_ACTIONS, 'true');
  assert.equal(process.env.AUTH_LOCAL_E2E, 'true');
  assert.equal(process.env.SETTLEMENT_REPORTS_LOCAL_E2E, 'true');
  assert.equal(process.env.NEXT_PUBLIC_APP_URL, appOrigin);
  assert.equal(process.env.NEXT_PUBLIC_SUPABASE_URL, databaseOrigin);
  for (const [key, value] of Object.entries(SETTLEMENT_REPORTS_CI_ENV))
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
  const email = `settlement-reports-e2e-${randomUUID()}@example.invalid`;
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
    where id='${uuid(id)}' and exists(select 1 from auth.users where id='${uuid(id)}' and email ~ '^settlement-reports-e2e-[0-9a-f-]{36}@example[.]invalid$');`);
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
    const member = await createIdentity('artist');
    const outsider = await createIdentity('artist');
    const artist = { id: randomUUID(), slug: '', name: '=허구 <가수> & 검토' };
    artist.slug = `settlement-${artist.id}`;
    const otherArtist = randomUUID();
    const terms = randomUUID(),
      privacy = randomUUID();
    const events = {
      charge: randomUUID(),
      refund: randomUUID(),
      unverified: randomUUID(),
    };
    localSql(
      settlementReportSourceSql({
        admin: admin.id,
        other: other.id,
        fan: fan.id,
        member: member.id,
        outsider: outsider.id,
        artist: artist.id,
        otherArtist,
        terms,
        privacy,
        ...events,
      }),
    );
    await provide({
      admin,
      other,
      fan,
      member,
      outsider,
      artist,
      otherArtist,
      month: '2026-01-01',
      terms,
      privacy,
      events,
    });
    // Retained immutable fictional financial evidence remains until this
    // dedicated job destroys its disposable local database. No cleanup bypass.
  },
});
export { expect };
export function get(request: APIRequestContext, path: string, actor: Identity) {
  return request.get(path, {
    headers: { [SETTLEMENT_REPORTS.actorHeader]: actor.id },
  });
}
export function post(
  request: APIRequestContext,
  path: string,
  actor: Identity,
  data: unknown,
) {
  return request.post(path, {
    headers: { [SETTLEMENT_REPORTS.actorHeader]: actor.id, Origin: appOrigin },
    data,
  });
}
export async function blockExternal(context: BrowserContext) {
  const blocked: string[] = [];
  externalRequests.set(context, blocked);
  // Denial-only matcher leaves allowed requests to page handlers/the browser.
  await context.route(
    (url) => ![appOrigin, databaseOrigin].includes(url.origin),
    async (route) => {
      blocked.push(new URL(route.request().url()).origin);
      await route.abort('blockedbyclient');
    },
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
    /AUTH_TEST_SERVICE_KEY|SUPABASE_SERVICE_ROLE_KEY|settlement-reports-e2e-.*@example[.]invalid|Never export this private/,
  );
}
export async function screenshot(
  page: Page,
  info: TestInfo,
  name: string,
  scale: Scale,
) {
  await assertRenderedScale(page, scale);
  const main = page.locator('main');
  await main
    .locator('[data-testid="settlement-report-content"], [role="alert"]')
    .first()
    .waitFor({ state: 'attached' });
  await expect(main.locator('.ui-loading')).toHaveCount(0);
  await expect(main).not.toHaveAttribute('aria-busy', 'true');
  await expect(main.locator('[aria-busy="true"]')).toHaveCount(0);
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
  });
  await page.screenshot({
    path: info.outputPath(`${name}.png`),
    fullPage: true,
  });
}
export function setFont(actor: Identity, scale: Scale) {
  assert.ok(['normal', 'large', 'xlarge'].includes(scale));
  localSql(
    `update public.profiles set font_scale='${scale}' where id='${uuid(actor.id)}' and exists(select 1 from auth.users where id='${uuid(actor.id)}' and email ~ '^settlement-reports-e2e-[0-9a-f-]{36}@example[.]invalid$');`,
  );
}
export function setRole(actor: Identity, role: 'fan' | 'admin' | 'artist') {
  assert.ok(['fan', 'admin', 'artist'].includes(role));
  localSql(
    `update public.profiles set role='${role}' where id='${uuid(actor.id)}' and exists(select 1 from auth.users where id='${uuid(actor.id)}' and email ~ '^settlement-reports-e2e-[0-9a-f-]{36}@example[.]invalid$');`,
  );
}
export function setRestricted(actor: Identity, restricted: boolean) {
  assert.equal(typeof restricted, 'boolean');
  localSql(
    `update public.profiles set is_restricted=${restricted},restricted_until=null where id='${uuid(actor.id)}' and exists(select 1 from auth.users where id='${uuid(actor.id)}' and email ~ '^settlement-reports-e2e-[0-9a-f-]{36}@example[.]invalid$');`,
  );
}
export function removeMembership(world: World) {
  localSql(
    `delete from public.artist_members where artist_id='${uuid(world.artist.id)}' and user_id='${uuid(world.member.id)}';`,
  );
}
export function withdrawTerms(actor: Identity, world: World) {
  localSql(
    `delete from private.profile_policy_acceptances where user_id='${uuid(actor.id)}' and kind='terms' and version='${uuid(world.terms)}';`,
  );
}
export function financialFingerprint(world: World) {
  return localSql(
    `select md5(jsonb_build_object('payments',(select jsonb_agg(to_jsonb(e) order by id) from public.payment_events e where subscription_id='${uuid(world.artist.id)}'),'verifications',(select jsonb_agg(to_jsonb(v) order by event_id) from private.payment_event_verifications v where event_id in ('${uuid(world.events.charge)}','${uuid(world.events.refund)}')),'subscriptions',(select to_jsonb(s) from public.subscriptions s where id='${uuid(world.artist.id)}'),'jobs',(select count(*) from private.notification_jobs))::text);`,
  );
}
export function reportFingerprint(world: World) {
  return localSql(
    `select md5(coalesce((select to_jsonb(r)::text from public.settlements r where artist_id='${uuid(world.artist.id)}' and month='2026-01-01'),''));`,
  );
}
