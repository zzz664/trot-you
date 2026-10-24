import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import {
  assertLocalAuthSettings,
  prepareLocalAuthConfig,
} from './auth-local-config.mjs';

// This helper is deliberately CI-only. It never accepts a URL, user, password,
// project ref or key argument. It prepares a disposable CLI-managed stack, not
// a hosted Supabase project, and must never be used with config push/link.
assert.equal(process.env.CI, 'true', 'Authentication fixtures require CI.');
assert.equal(process.env.GITHUB_ACTIONS, 'true', 'Use the isolated CI job.');
assert.ok(!process.env.DOCKER_HOST && !process.env.DOCKER_CONTEXT);
assert.equal(
  execFileSync('docker', ['context', 'show'], { encoding: 'utf8' }).trim(),
  'default',
);
assert.ok(
  execFileSync(
    'docker',
    ['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}'],
    { encoding: 'utf8' },
  )
    .trim()
    .startsWith('unix://'),
  'Only a local Unix-socket Docker daemon is allowed.',
);

const action = process.argv[2];
if (action === 'configure') {
  for (const key of [
    'SUPABASE_ACCESS_TOKEN',
    'SUPABASE_DB_PASSWORD',
    'SUPABASE_SERVICE_ROLE_KEY',
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  ]) {
    assert.ok(!process.env[key], 'Do not pass hosted credentials to this job.');
  }
  const path = 'supabase/config.toml';
  writeFileSync(path, prepareLocalAuthConfig(readFileSync(path, 'utf8')));
} else if (action === 'environment') {
  assert.ok(process.env.GITHUB_ENV, 'GitHub environment output is required.');
  const status = JSON.parse(
    execFileSync('node_modules/.bin/supabase', ['status', '--output', 'json'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }),
  );
  assert.ok(
    ['http://127.0.0.1:54321', 'http://localhost:54321'].includes(
      status.API_URL,
    ),
  );
  assert.equal(typeof status.ANON_KEY, 'string');
  assert.equal(typeof status.SERVICE_ROLE_KEY, 'string');
  for (const key of [status.ANON_KEY, status.SERVICE_ROLE_KEY]) {
    assert.ok(key.length > 0 && !/[\r\n]/.test(key));
    process.stdout.write(`::add-mask::${key}\n`);
  }
  // Verify actual GoTrue settings, not just the config text. Fail before any
  // fixture creation if provider activation accidentally enabled public signup.
  const settingsResponse = await fetch(
    'http://127.0.0.1:54321/auth/v1/settings',
    {
      headers: { apikey: status.ANON_KEY },
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    },
  );
  assert.ok(settingsResponse.ok, 'Local Auth settings are unavailable.');
  assertLocalAuthSettings(await settingsResponse.json());
  appendFileSync(
    process.env.GITHUB_ENV,
    [
      'AUTH_LOCAL_E2E=true',
      'NEXT_PUBLIC_APP_URL=http://127.0.0.1:3100',
      'NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321',
      `NEXT_PUBLIC_SUPABASE_ANON_KEY=${status.ANON_KEY}`,
      // Fixture-only admin access. The application process explicitly clears
      // AUTH_TEST_SERVICE_KEY; this is never a hosted project credential.
      `AUTH_TEST_SERVICE_KEY=${status.SERVICE_ROLE_KEY}`,
      // Preview templates require a server-only service RPC after verified
      // actor authentication. Authentication/interest still use the public key.
      // Only the disposable local stack key reaches the application server.
      `SUPABASE_SERVICE_ROLE_KEY=${status.SERVICE_ROLE_KEY}`,
      '',
    ].join('\n'),
  );
} else {
  throw new Error('Expected configure or environment.');
}
