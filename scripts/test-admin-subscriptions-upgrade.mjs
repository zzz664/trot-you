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
    psql(`select jsonb_build_object(
 'subscriptions',(select jsonb_agg(to_jsonb(s) order by s.id) from public.subscriptions s),
 'events',(select jsonb_agg(to_jsonb(e) order by e.id) from public.payment_events e),
 'verification',(select jsonb_agg(to_jsonb(v) order by v.event_id) from private.payment_event_verifications v),
 'obligations',(select jsonb_agg(to_jsonb(o) order by o.id) from private.billing_obligations o),
 'attempts',(select jsonb_agg(to_jsonb(a) order by a.id) from private.payment_attempts a),
 'mandates',(select jsonb_agg(to_jsonb(m) order by m.id) from private.payment_mandates m),
 'profiles',(select jsonb_agg(to_jsonb(p) order by p.id) from public.profiles p));`),
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
    +(select count(*) from public.subscriptions)+(select count(*) from public.payment_events)+(select count(*) from private.subscription_cancellation_history);`),
    '0',
    'Use freshly reset disposable local database only.',
  );
  shouldReset = true;
  execFileSync(
    localCli,
    ['db', 'reset', '--local', '--version', '20261025000028'],
    { stdio: 'inherit' },
  );
  psql(
    readFileSync(
      new URL('./admin-subscriptions-upgrade-fixture.sql', import.meta.url),
      'utf8',
    ),
  );
  const before = snapshot();
  execFileSync(localCli, ['migration', 'up', '--local'], { stdio: 'inherit' });
  assert.deepEqual(
    snapshot(),
    before,
    'Upgrade preserves every preexisting billing and identity row exactly.',
  );
  assert.equal(
    psql(
      "select count(*) from private.subscription_cancellation_history where source='retained_marker' and was_paid;",
    ),
    '1',
  );
  assert.equal(
    psql(
      "select count(*) from private.subscription_cancellation_history where subscription_id='af700000-0000-4000-8000-000000000006';",
    ),
    '0',
    'Erased cancellation timestamps must not be invented.',
  );
  assert.equal(
    psql(
      "select count(*) from private.subscription_dashboard_history_coverage where complete_from>='2026-01-01';",
    ),
    '1',
  );
  assert.equal(
    psql(
      "select was_paid from private.subscription_cancellation_history where subscription_id='af700000-0000-4000-8000-000000000010';",
    ),
    'f',
    'Retained marker outside its old paid/grace window is not classified paid from lifetime money alone.',
  );
  const dashboard = JSON.parse(
    psql(`begin; set local role authenticated; set local "request.jwt.claim.sub"='af700000-0000-4000-8000-000000000001';
    select public.admin_subscription_dashboard('2020-01-01','2020-01-31','af700000-0000-4000-8000-000000000003'); rollback;`),
  );
  assert.equal(dashboard.summary.period.cancellations, 1);
  assert.ok(
    new Date(dashboard.cancellation_history_complete_from) >
      new Date(dashboard.window_start),
  );
  assert.deepEqual(
    snapshot(),
    before,
    'Read-only aggregate does not rewrite imported billing state.',
  );
  psql(`update public.subscriptions set status='active',canceled_at=null where id='af700000-0000-4000-8000-000000000005';
    update public.subscriptions set status='canceled',canceled_at=clock_timestamp() where id='af700000-0000-4000-8000-000000000005';`);
  assert.equal(
    psql(
      "select count(*) from private.subscription_cancellation_history where source='observed' and was_paid;",
    ),
    '1',
  );
  assert.equal(
    psql(
      "select count(*) from private.subscription_cancellation_history where source='retained_marker';",
    ),
    '2',
  );
  console.info(
    'PASS: pre-00029 retained marker imports once without changing source rows; erased history stays unknown and later episodes append.',
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
