import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';

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
  let config = readFileSync(path, 'utf8');
  assert.match(config, /^project_id = "trot-you"$/m);
  assert.match(config, /^enable_signup = false$/m);
  assert.match(config, /^\[local_smtp\]\nenabled = false$/m);
  config = config
    .replace(/^site_url = .*$/m, 'site_url = "http://127.0.0.1:3100"')
    .replace(
      /^additional_redirect_urls = .*$/m,
      'additional_redirect_urls = ["http://127.0.0.1:3100/api/auth/callback**"]',
    )
    .replace(
      '[local_smtp]\nenabled = false',
      '[local_smtp]\nenabled = true\nport = 54324',
    );
  config += `
# Disposable authentication test overrides; never committed or pushed.
[auth.email]
enable_signup = false
enable_confirmations = true
max_frequency = "1s"

[auth.rate_limit]
email_sent = 1000
sign_in_sign_ups = 1000
token_verifications = 1000
token_refresh = 1000
`;
  writeFileSync(path, config);
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
  appendFileSync(
    process.env.GITHUB_ENV,
    [
      'AUTH_LOCAL_E2E=true',
      'NEXT_PUBLIC_APP_URL=http://127.0.0.1:3100',
      'NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321',
      `NEXT_PUBLIC_SUPABASE_ANON_KEY=${status.ANON_KEY}`,
      // Not SUPABASE_SERVICE_ROLE_KEY: the application must not receive or need
      // an admin credential for authentication/actor-scoped profile reads.
      `AUTH_TEST_SERVICE_KEY=${status.SERVICE_ROLE_KEY}`,
      '',
    ].join('\n'),
  );
} else {
  throw new Error('Expected configure or environment.');
}
