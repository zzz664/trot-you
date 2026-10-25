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
import { ADMIN_ARTISTS_CI_ENV } from '../../../scripts/admin-artists-local-fixtures.mjs';
import type { Database } from '../../../src/types/database';
import type { ComposeDraft } from '../../../src/config/artist-compose';
import {
  artistComposeApiPath,
  artistDispatchApiPath,
  routes,
} from '../../../src/config/routes';
import {
  prepareFictionalDocuments,
  enableFictionalPolicy,
  onboardingFixtures,
} from '../authenticated/onboarding-fixtures';

export const appOrigin = 'http://127.0.0.1:3100';
export const storageOrigin = 'http://127.0.0.1:54321';
export type Scale = 'normal' | 'large' | 'xlarge';
export type Identity = {
  id: string;
  signIn(context: BrowserContext): Promise<void>;
  actorClient(): Promise<SupabaseClient<Database>>;
};
export type Artist = { id: string; slug: string; name: string };
export type World = {
  admin: Identity;
  author: Identity;
  recipient: Identity;
  other: Identity;
  artist: Artist;
};
const externalRequests = new WeakMap<BrowserContext, string[]>();
function credentials() {
  assert.equal(process.env.CI, 'true');
  assert.equal(process.env.GITHUB_ACTIONS, 'true');
  assert.equal(process.env.AUTH_LOCAL_E2E, 'true');
  assert.equal(process.env.ADMIN_ARTISTS_LOCAL_E2E, 'true');
  assert.equal(process.env.NEXT_PUBLIC_APP_URL, appOrigin);
  assert.equal(process.env.NEXT_PUBLIC_SUPABASE_URL, storageOrigin);
  for (const [key, value] of Object.entries(ADMIN_ARTISTS_CI_ENV))
    assert.ok(
      process.env[key] === value,
      'Only the exact isolated fixture settings are allowed.',
    );
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
    {
      input: sql,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    },
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
    values('fictional-admin-artists-ci-only',604800,300,1000,100,2,180,60,5,1048576,20971520,104857600)
    on conflict(singleton) do update set version=excluded.version,
      history_before_seconds=excluded.history_before_seconds,cancel_window_seconds=excluded.cancel_window_seconds,
      max_text_length=excluded.max_text_length,max_reply_length=excluded.max_reply_length,
      max_photos=excluded.max_photos,max_voice_seconds=excluded.max_voice_seconds,
      max_video_seconds=excluded.max_video_seconds,preview_max_count=excluded.preview_max_count,
      max_photo_bytes=excluded.max_photo_bytes,max_voice_bytes=excluded.max_voice_bytes,
      max_video_bytes=excluded.max_video_bytes;
    insert into private.artist_account_link_policy(singleton,enabled,approved_at,decision_reference,invitation_ttl_hours)
      values(true,true,clock_timestamp(),'fictional-ci-existing-user-consent',48)
      on conflict(singleton) do update set enabled=true,approved_at=excluded.approved_at,
      decision_reference=excluded.decision_reference,invitation_ttl_hours=excluded.invitation_ttl_hours;`);
}
async function createIdentity(
  role: 'admin' | 'artist' | 'fan',
): Promise<Identity> {
  const { anonKey, serviceKey } = credentials();
  const admin = createClient<Database>(storageOrigin, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const email = `admin-artists-e2e-${randomUUID()}@example.invalid`;
  const password = randomBytes(32).toString('base64url');
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  assert.equal(error, null);
  assert.ok(data.user);
  const id = data.user.id;
  // Owner-only fictional session setup, not an actual consent or role grant.
  if (role !== 'fan')
    localSql(`update public.profiles set role='${role}',call_name='허구사용자',onboarding_completed_at=clock_timestamp()
    where id='${uuid(id)}' and exists(select 1 from auth.users where id='${uuid(id)}' and email ~ '^admin-artists-e2e-[0-9a-f-]{36}@example[.]invalid$');`);
  return {
    id,
    async actorClient() {
      const client = createClient<Database>(storageOrigin, anonKey, {
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
async function completeFan(actor: Identity, artist: Artist) {
  const client = await actor.actorClient();
  for (const result of [
    await client.rpc('onboarding_save_font', { p_font_scale: 'large' }),
    await client.rpc('onboarding_save_name', { p_call_name: '허구사용자' }),
    await client.rpc('onboarding_complete_profile', {
      p_age_over_14: true,
      p_terms_accepted: true,
      p_terms_version: onboardingFixtures.terms,
      p_privacy_accepted: true,
      p_privacy_version: onboardingFixtures.privacy,
      p_analytics_granted: false,
    }),
    await client.rpc('discovery_select_artist', { p_artist_slug: artist.slug }),
    await client.rpc('onboarding_acknowledge_install', { p_choice: 'skipped' }),
    await client.rpc('onboarding_complete'),
  ])
    assert.equal(result.error, null);
}
export const test = base.extend<{ world: World }>({
  world: async ({}, provide) => {
    const admin = await createIdentity('admin');
    const author = await createIdentity('artist');
    const recipient = await createIdentity('fan');
    const other = await createIdentity('fan');
    const artist = {
      id: randomUUID(),
      slug: `ci-admin-artists-${randomUUID()}`,
      name: '허구 운영 가수',
    };
    localSql(`insert into public.artists(id,slug,name,intro,grade,status) values('${uuid(artist.id)}','${artist.slug}','${artist.name}','격리 CI의 가수 관리 점검용 허구 자료입니다.','B','active');
      insert into public.artist_members(artist_id,user_id) values('${uuid(artist.id)}','${uuid(author.id)}');`);
    await completeFan(recipient, artist);
    await completeFan(other, artist);
    await provide({ admin, author, recipient, other, artist });
    // Immutable audit/history and fictional identities persist only until this
    // dedicated job destroys its disposable stack. No protection is disabled.
  },
});
export { expect };
export async function post(
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
    if ([appOrigin, storageOrigin].includes(url.origin))
      return route.continue();
    externalRequests.get(context)!.push(url.origin);
    return route.abort('blockedbyclient');
  });
}
export function expectNoExternal(context: BrowserContext) {
  expect(externalRequests.get(context)).toEqual([]);
}
export async function screenshot(
  page: Page,
  info: TestInfo,
  name: string,
  scale: Scale,
  fullPage = true,
) {
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
    /service_role|quarantine_path|object_path|AUTH_TEST_SERVICE_KEY|admin-artists-e2e-.*@example[.]invalid/,
  );
  await page.screenshot({
    path: info.outputPath(`${name}.png`),
    fullPage,
  });
}
export function setFont(actor: Identity, scale: Scale) {
  assert.ok(['normal', 'large', 'xlarge'].includes(scale));
  localSql(
    `update public.profiles set font_scale='${scale}' where id='${uuid(actor.id)}' and exists(select 1 from auth.users where id='${uuid(actor.id)}' and email ~ '^admin-artists-e2e-[0-9a-f-]{36}@example[.]invalid$');`,
  );
}
export function setRole(actor: Identity, role: 'fan' | 'artist' | 'admin') {
  assert.ok(['fan', 'artist', 'admin'].includes(role));
  localSql(
    `update public.profiles set role='${role}' where id='${uuid(actor.id)}' and exists(select 1 from auth.users where id='${uuid(actor.id)}' and email ~ '^admin-artists-e2e-[0-9a-f-]{36}@example[.]invalid$');`,
  );
}
export function disableLinkPolicy() {
  localSql(
    `update private.artist_account_link_policy set enabled=false where decision_reference='fictional-ci-existing-user-consent';`,
  );
}
export function expireInvitation(id: string) {
  localSql(`update private.artist_account_invitations i set created_at=clock_timestamp()-interval '2 days',expires_at=clock_timestamp()-interval '1 second' where i.id='${uuid(id)}'
    and exists(select 1 from auth.users where id=i.target_user_id and email ~ '^admin-artists-e2e-[0-9a-f-]{36}@example[.]invalid$');`);
}
export function membership(world: World, actor = world.recipient) {
  return JSON.parse(
    localSql(
      `select jsonb_build_object('role',p.role,'member',exists(select 1 from public.artist_members m where m.artist_id='${uuid(world.artist.id)}' and m.user_id=p.id)) from public.profiles p where p.id='${uuid(actor.id)}';`,
    ),
  ) as { role: string; member: boolean };
}
export function seedHistory(world: World) {
  const subscriptionId = randomUUID();
  const eventId = randomUUID();
  localSql(`insert into public.subscriptions(id,user_id,artist_id,provider,status,current_period_start,current_period_end,canceled_at)
    values('${uuid(subscriptionId)}','${uuid(world.recipient.id)}','${uuid(world.artist.id)}','toss','canceled',clock_timestamp()-interval '2 days',clock_timestamp()+interval '28 days',clock_timestamp());
    insert into public.payment_events(id,subscription_id,kind,amount_krw,currency,provider,period_start,period_end,occurred_at)
    values('${uuid(eventId)}','${uuid(subscriptionId)}','charge',1200,'KRW','toss',clock_timestamp()-interval '2 days',clock_timestamp()+interval '28 days',clock_timestamp()-interval '2 days');`);
  return { subscriptionId, eventId };
}
export function retainedHistory(ids: {
  subscriptionId: string;
  eventId: string;
}) {
  return localSql(
    `select jsonb_build_object('subscription',to_jsonb(s),'event',to_jsonb(e)) from public.subscriptions s join public.payment_events e on e.subscription_id=s.id where s.id='${uuid(ids.subscriptionId)}' and e.id='${uuid(ids.eventId)}';`,
  );
}
export async function createSentMessages(
  context: BrowserContext,
  world: World,
  withPhoto = false,
) {
  await world.author.signIn(context);
  const result: { id: string; kind: 'text' | 'photo'; mediaId?: string }[] = [];
  for (const kind of withPhoto
    ? (['text', 'photo'] as const)
    : (['text'] as const)) {
    const body =
      kind === 'text' ? '허구 맛보기 인사입니다.' : '허구 사진 맛보기입니다.';
    const saved = await post(
      context.request,
      artistComposeApiPath(world.artist.slug, 'save'),
      {
        messageId: randomUUID(),
        operationId: randomUUID(),
        expectedRevision: 0,
        kind,
        body,
        mediaIds: [],
      },
    );
    expect(saved.status()).toBe(200);
    let draft = (await saved.json()).data as ComposeDraft;
    let mediaId: string | undefined;
    if (kind === 'photo') {
      // Ordinary synthetic solid-color PNG; no malformed content/parser probes.
      const bytes = await sharp({
        create: { width: 160, height: 100, channels: 3, background: '#6c3768' },
      })
        .png()
        .toBuffer();
      const begun = await post(context.request, routes.mediaUpload, {
        requestId: randomUUID(),
        messageId: draft.id,
        mimeType: 'image/png',
        byteSize: bytes.length,
      });
      expect(begun.status()).toBe(200);
      const ticket = (await begun.json()).data as {
        uploadId: string;
        uploadUrl: string;
      };
      expect(new URL(ticket.uploadUrl).origin).toBe(storageOrigin);
      const upload = await context.request.put(ticket.uploadUrl, {
        headers: { 'Content-Type': 'image/png', 'x-upsert': 'false' },
        data: bytes,
        maxRedirects: 0,
      });
      expect(upload.ok()).toBe(true);
      const completed = await post(context.request, routes.mediaComplete, {
        uploadId: ticket.uploadId,
      });
      expect(completed.status()).toBe(200);
      mediaId = (await completed.json()).data.mediaId as string;
      const attached = await post(
        context.request,
        artistComposeApiPath(world.artist.slug, 'save'),
        {
          messageId: draft.id,
          operationId: randomUUID(),
          expectedRevision: draft.revision,
          kind,
          body,
          mediaIds: [mediaId],
        },
      );
      expect(attached.status()).toBe(200);
      draft = (await attached.json()).data as ComposeDraft;
    }
    const sent = await post(
      context.request,
      artistDispatchApiPath(world.artist.slug, 'submit'),
      {
        messageId: draft.id,
        operationId: randomUUID(),
        expectedRevision: draft.revision,
        scheduledAt: null,
        confirmed: true,
      },
    );
    expect(sent.status()).toBe(200);
    result.push({ id: draft.id, kind, ...(mediaId ? { mediaId } : {}) });
  }
  await world.admin.signIn(context);
  return result;
}

export function addArtists(count: number) {
  assert.ok(Number.isInteger(count) && count > 0 && count <= 25);
  const artists = Array.from({ length: count }, (_, index) => ({
    id: randomUUID(),
    slug: `ci-admin-page-${randomUUID()}`,
    name: `허구 목록 가수 ${index + 1}`,
  }));
  localSql(
    `insert into public.artists(id,slug,name,intro,grade,status) values ${artists.map((artist) => `('${uuid(artist.id)}','${artist.slug}','${artist.name}','격리 CI의 목록 이동 점검용 허구 가수입니다.','B','draft')`).join(',')};`,
  );
}

export function seedOlderManagementRows(world: World) {
  const rows = Array.from({ length: 51 }, (_, index) => ({
    index,
    messageId: randomUUID(),
    invitationId: randomUUID(),
  }));
  // Historical text/canceled-invitation fixtures only. No account grant or
  // provider action is implied, and no immutable audit trigger is disabled.
  localSql(`do $fixture$ begin
    if not exists(select 1 from public.artists where id='${uuid(world.artist.id)}' and slug like 'ci-admin-artists-%')
      or (select count(*) from auth.users where id=any(array['${uuid(world.admin.id)}'::uuid,'${uuid(world.author.id)}'::uuid,'${uuid(world.recipient.id)}'::uuid])
      and email ~ '^admin-artists-e2e-[0-9a-f-]{36}@example[.]invalid$')<>3
      then raise exception 'FICTIONAL_MANAGEMENT_HISTORY_REQUIRED'; end if;
    insert into public.messages(id,artist_id,author_id,type,body,status,scheduled_at,sent_at)
    values ${rows.map((row) => `('${uuid(row.messageId)}','${uuid(world.artist.id)}','${uuid(world.author.id)}','text','허구 과거 운영 메시지 ${row.index + 1}','sent',clock_timestamp()-interval '${row.index + 1} minutes',clock_timestamp()-interval '${row.index + 1} minutes')`).join(',')};
    insert into private.artist_account_invitations(id,artist_id,target_user_id,invited_by,is_manager,state,created_at,expires_at,responded_at)
    values ${rows.map((row) => `('${uuid(row.invitationId)}','${uuid(world.artist.id)}','${uuid(world.recipient.id)}','${uuid(world.admin.id)}',false,'canceled',clock_timestamp()-interval '${row.index + 1} minutes',clock_timestamp()+interval '48 hours',clock_timestamp()-interval '${row.index} minutes')`).join(',')};
  end $fixture$;`);
  return rows.at(-1)!;
}
