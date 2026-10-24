import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import {
  combineChunks,
  createChunks,
  createServerClient,
  type CookieOptions,
} from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import {
  test as base,
  expect,
  type APIRequestContext,
  type BrowserContext,
} from '@playwright/test';
import type { Database, Tables } from '../../../src/types/database';
import { routes } from '../../../src/config/routes';

export const appOrigin = 'http://127.0.0.1:3100';
const authOrigin = 'http://127.0.0.1:54321';
const mailOrigin = 'http://127.0.0.1:54324';
const storageKey = 'sb-127-auth-token';
type Cookie = { name: string; value: string; options?: CookieOptions };
type ProfilePatch = Partial<
  Pick<
    Tables<'profiles'>,
    'role' | 'is_restricted' | 'restricted_until' | 'onboarding_completed_at'
  >
>;

function localCredentials() {
  assert.equal(process.env.AUTH_LOCAL_E2E, 'true');
  assert.equal(process.env.CI, 'true');
  assert.equal(process.env.GITHUB_ACTIONS, 'true');
  assert.equal(process.env.NEXT_PUBLIC_APP_URL, appOrigin);
  assert.equal(process.env.NEXT_PUBLIC_SUPABASE_URL, authOrigin);
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const adminKey = process.env.AUTH_TEST_SERVICE_KEY;
  assert.ok(anonKey && adminKey, 'The disposable stack must be ready.');
  return { anonKey, adminKey };
}

function createCookieClient() {
  const { anonKey } = localCredentials();
  const jar = new Map<string, Cookie>();
  const client = createServerClient<Database>(authOrigin, anonKey, {
    cookieOptions: {
      httpOnly: true,
      sameSite: 'lax',
      secure: false,
      path: '/',
    },
    cookies: {
      getAll: () => Array.from(jar.values()),
      setAll: (cookies) => {
        for (const cookie of cookies) {
          if (cookie.options.maxAge === 0) jar.delete(cookie.name);
          else jar.set(cookie.name, cookie);
        }
      },
    },
  });
  return { client, jar };
}

async function installCookies(context: BrowserContext, cookies: Cookie[]) {
  await context.addCookies(
    cookies.map(({ name, value }) => ({
      name,
      value,
      url: appOrigin,
      httpOnly: true,
      secure: false,
      sameSite: 'Lax',
    })),
  );
}

export type Identity = {
  id: string;
  email: string;
  signIn: (
    context: BrowserContext,
    options?: { refresh?: boolean; forged?: boolean },
  ) => Promise<void>;
  pkce: (context: BrowserContext, request: APIRequestContext) => Promise<URL>;
  update: (patch: ProfilePatch) => Promise<void>;
  ownProfileIds: () => Promise<string[]>;
  revokeAll: () => Promise<void>;
};

type AuthFixtures = {
  identity: (patch?: ProfilePatch) => Promise<Identity>;
};

export const test = base.extend<AuthFixtures>({
  identity: async ({}, provide) => {
    const { adminKey } = localCredentials();
    const admin = createClient<Database>(authOrigin, adminKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const createdIds: string[] = [];
    await provide(async (patch = {}) => {
      const email = `auth-e2e-${randomUUID()}@example.invalid`;
      const password = randomBytes(32).toString('base64url');
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        // Untrusted metadata must never grant an application role.
        user_metadata: { role: 'admin', nickname: '자동 점검 계정' },
      });
      assert.equal(error, null, 'Local fixture creation failed.');
      assert.ok(data.user);
      const id = data.user.id;
      createdIds.push(id);
      async function update(fields: ProfilePatch) {
        const { error: updateError } = await admin
          .from('profiles')
          .update(fields)
          .eq('id', id);
        assert.equal(updateError, null, 'Local profile fixture update failed.');
      }
      const { error: setupError } = await admin
        .from('profiles')
        .update({
          call_name: '자동 점검 계정',
          onboarding_completed_at: new Date().toISOString(),
          ...patch,
        })
        .eq('id', id);
      assert.equal(setupError, null, 'Local profile setup failed.');

      return {
        id,
        email,
        update,
        async signIn(context, options = {}) {
          const { client, jar } = createCookieClient();
          const { error: signInError } = await client.auth.signInWithPassword({
            email,
            password,
          });
          assert.equal(signInError, null, 'Local password sign-in failed.');
          if (options.refresh || options.forged) {
            const encoded = await combineChunks(
              storageKey,
              (name) => jar.get(name)?.value,
            );
            assert.ok(encoded);
            assert.ok(encoded.startsWith('base64-'));
            const session = JSON.parse(
              Buffer.from(
                encoded.slice('base64-'.length),
                'base64url',
              ).toString(),
            );
            if (options.refresh) {
              // Keep the authentic JWT and refresh token unchanged. Expired
              // client storage metadata makes the real SDK exercise GoTrue's
              // refresh endpoint immediately rather than sleeping an hour.
              session.expires_at = 1;
            }
            if (options.forged) {
              const [header, payload, signature] =
                session.access_token.split('.');
              const claims = JSON.parse(
                Buffer.from(payload, 'base64url').toString(),
              );
              claims.sub = randomUUID();
              claims.role = 'service_role';
              session.access_token = `${header}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.${signature}`;
              session.refresh_token = 'not-a-valid-refresh-token';
            }
            jar.clear();
            for (const cookie of createChunks(
              storageKey,
              `base64-${Buffer.from(JSON.stringify(session)).toString('base64url')}`,
            )) {
              jar.set(cookie.name, cookie);
            }
          }
          await installCookies(context, Array.from(jar.values()));
        },
        async pkce(context, request) {
          const { client, jar } = createCookieClient();
          const { error: otpError } = await client.auth.signInWithOtp({
            email,
            options: {
              shouldCreateUser: false,
              emailRedirectTo: `${appOrigin}${routes.authCallback}`,
            },
          });
          assert.equal(otpError, null, 'Local email PKCE initiation failed.');
          let messageId: string | undefined;
          await expect
            .poll(async () => {
              const response = await request.get(
                `${mailOrigin}/api/v1/search`,
                {
                  params: { query: `to:${email}` },
                },
              );
              assert.ok(response.ok(), 'Local Mailpit is unavailable.');
              const body = await response.json();
              messageId = body.messages?.[0]?.ID;
              return Boolean(messageId);
            })
            .toBe(true);
          const response = await request.get(
            `${mailOrigin}/api/v1/message/${messageId}`,
          );
          const message = await response.json();
          const hrefs = String(message.HTML).matchAll(/href="([^"]+)"/g);
          const verification = Array.from(
            hrefs,
            (match) => new URL(match[1]!.replaceAll('&amp;', '&')),
          ).find(
            (url) =>
              url.origin === authOrigin && url.pathname === '/auth/v1/verify',
          );
          assert.ok(verification, 'Expected only the local verification URL.');
          const verified = await request.get(verification.href, {
            maxRedirects: 0,
          });
          const target = new URL(verified.headers().location!);
          assert.equal(target.origin, appOrigin);
          assert.equal(target.pathname, routes.authCallback);
          assert.ok(target.searchParams.get('code'));
          await installCookies(context, Array.from(jar.values()));
          return target;
        },
        async ownProfileIds() {
          const { client } = createCookieClient();
          const { error: signInError } = await client.auth.signInWithPassword({
            email,
            password,
          });
          assert.equal(signInError, null);
          const { data: profiles, error: queryError } = await client
            .from('profiles')
            .select('id');
          assert.equal(queryError, null);
          return profiles!.map((profile) => profile.id);
        },
        async revokeAll() {
          const { client } = createCookieClient();
          const { data: login, error: loginError } =
            await client.auth.signInWithPassword({ email, password });
          assert.equal(loginError, null);
          assert.ok(login.session);
          const { error: revokeError } = await admin.auth.admin.signOut(
            login.session.access_token,
            'global',
          );
          assert.equal(
            revokeError,
            null,
            'Local fixture session revocation failed.',
          );
        },
      };
    });
    for (const id of createdIds.reverse()) {
      const { error } = await admin.auth.admin.deleteUser(id);
      assert.equal(error, null, 'Local test-user cleanup failed.');
    }
  },
});

export { expect };
