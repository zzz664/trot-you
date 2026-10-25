import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Disposable default Unix-socket Docker only. No URL, hosted project, token or
// application credential argument. A fresh reset is required before invocation;
// success or failure restores the entire latest local migration chain.
const docker = ['--context', 'default'];
const localCli = fileURLToPath(
  new URL('../node_modules/.bin/supabase', import.meta.url),
);
const psql = (sql) =>
  execFileSync(
    'docker',
    [
      ...docker,
      'exec',
      '-i',
      'supabase_db_trot-you',
      'psql',
      '-X',
      '-A',
      '-t',
      '-q',
      '-v',
      'ON_ERROR_STOP=1',
      '-U',
      'postgres',
      '-d',
      'postgres',
    ],
    { input: sql, encoding: 'utf8' },
  ).trim();
const snapshot = () =>
  JSON.parse(
    psql(`select jsonb_build_object('message',(select to_jsonb(p) from private.message_policy p),
 'community',(select to_jsonb(p) from private.community_policy p),'checkout',(select to_jsonb(p) from private.checkout_policies p),
 'current',(select to_jsonb(p) from private.checkout_policy_current p),'renewal',(select to_jsonb(p) from private.renewal_policies p),
 'notice',(select to_jsonb(p) from private.billing_notice_policies p));`),
  );
let shouldReset = false;
try {
  assert.ok(
    !process.env.DOCKER_HOST && !process.env.DOCKER_CONTEXT,
    'Unset Docker overrides before disposable upgrade verification.',
  );
  assert.equal(
    execFileSync('docker', ['context', 'show'], { encoding: 'utf8' }).trim(),
    'default',
  );
  assert.ok(
    execFileSync(
      'docker',
      [
        ...docker,
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
  assert.equal(
    psql(`select (select count(*) from auth.users)+(select count(*) from private.message_policy)+(select count(*) from private.community_policy)
    +(select count(*) from private.checkout_policies)+(select count(*) from private.admin_settings_audit)+(select count(*) from private.admin_display_settings);`),
    '0',
    'Use freshly reset disposable local database only.',
  );
  shouldReset = true;
  execFileSync(
    localCli,
    ['db', 'reset', '--local', '--version', '20261025000027'],
    { stdio: 'inherit' },
  );
  psql(
    readFileSync(
      new URL('./admin-settings-upgrade-fixture.sql', import.meta.url),
      'utf8',
    ),
  );
  const before = snapshot();
  execFileSync(localCli, ['migration', 'up', '--local'], { stdio: 'inherit' });
  assert.deepEqual(
    snapshot(),
    before,
    'Upgrade must preserve exact existing source policies, versions, moderation arrays and commercial approval timestamps.',
  );
  assert.equal(
    psql(
      "select count(*) from private.admin_settings_state where group_key in('message','community') and revision=1 and snapshot is not null;",
    ),
    '2',
  );
  assert.equal(
    psql(
      "select count(*) from private.admin_settings_audit where source='operator' and actor_id is null and before_value is null;",
    ),
    '2',
  );
  assert.equal(
    psql(
      "select count(*) from private.admin_settings_audit where after_value::text like '%fictional%';",
    ),
    '0',
    'Imported metadata must omit labels, patterns and terms.',
  );
  assert.equal(
    psql('select count(*) from private.admin_display_settings;'),
    '0',
  );
  assert.equal(psql('select count(*) from public.payment_events;'), '0');
  console.info(
    'PASS: populated pre-00028 policies upgrade unchanged; only sanitized immutable metadata is initialized.',
  );
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  if (shouldReset) {
    try {
      execFileSync(localCli, ['db', 'reset', '--local'], { stdio: 'inherit' });
    } catch (error) {
      console.error(
        'Upgrade fixture cleanup failed; reset the disposable local database before further use.',
        error,
      );
      process.exitCode = 1;
    }
  }
}
