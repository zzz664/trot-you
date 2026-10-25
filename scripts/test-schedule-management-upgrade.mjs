import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
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
  'schedules',(select jsonb_agg(to_jsonb(s)-'revision' order by s.id) from public.schedules s),
  'catalog',(select jsonb_agg(to_jsonb(s) order by s.id) from public.schedule_catalog s),
  'optouts',(select jsonb_agg(to_jsonb(o) order by o.user_id,o.schedule_id) from public.schedule_notification_optouts o),
  'content',(select jsonb_agg(to_jsonb(c) order by c.id) from public.content_calendar c),
  'audit',(select jsonb_agg(to_jsonb(a) order by a.id) from public.calendar_audit_log a),
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
    ['db', 'reset', '--local', '--version', '20261025000029'],
    { stdio: 'inherit' },
  );
  psql(`insert into auth.users(id,email,raw_user_meta_data) values
    ('af800000-0000-4000-8000-000000000001','schedule-upgrade-admin@example.invalid','{}'),
    ('af800000-0000-4000-8000-000000000002','schedule-upgrade-fan@example.invalid','{}');
    update public.profiles set call_name='가상일정팬',onboarding_completed_at=clock_timestamp() where id::text like 'af800000-%';
    update public.profiles set role='admin' where id='af800000-0000-4000-8000-000000000001';
    insert into public.artists(id,slug,name,grade,status) values
    ('af800000-0000-4000-8000-000000000003','schedule-upgrade-artist','Fictional upgrade artist','B','active');
    insert into public.schedules(id,artist_id,type,status,title,description,starts_at,ends_at,place_name,address,lat,lng,created_by) values
    ('af800000-0000-4000-8000-000000000004','af800000-0000-4000-8000-000000000003','concert','published','Preserved event','Preserved description','2028-02-29T23:00:00+09:00','2028-03-01T01:00:00+09:00','Public venue','Public address',37.5665,126.978,'af800000-0000-4000-8000-000000000001'),
    ('af800000-0000-4000-8000-000000000005','af800000-0000-4000-8000-000000000003','event','draft','Preserved draft',null,'2028-02-10T10:00:00+09:00',null,null,null,null,null,'af800000-0000-4000-8000-000000000001');
    insert into public.schedule_notification_optouts(user_id,schedule_id) values('af800000-0000-4000-8000-000000000002','af800000-0000-4000-8000-000000000004');
    insert into public.content_calendar(artist_id,date,topic,created_by) values('af800000-0000-4000-8000-000000000003','2028-02-29','Unchanged editorial topic','af800000-0000-4000-8000-000000000001');
    insert into public.calendar_audit_log(actor_id,target_type,target_id,action,after_data)
    select created_by,'schedule',id,'create',to_jsonb(s) from public.schedules s;`);
  const before = snapshot();
  execFileSync(localCli, ['migration', 'up', '--local'], { stdio: 'inherit' });
  assert.deepEqual(
    snapshot(),
    before,
    'Upgrade preserves every source event, public projection, optout, editorial entry, audit and identity row.',
  );
  assert.equal(
    psql('select count(*) from public.schedules where revision=1;'),
    '2',
  );
  assert.equal(
    psql('select count(*) from private.schedule_admin_operations;'),
    '0',
    'Upgrade does not fabricate accepted operations.',
  );
  const event = JSON.parse(
    psql(`begin; set local role authenticated; set local "request.jwt.claim.sub"='af800000-0000-4000-8000-000000000001';
    select public.schedule_admin_get('af800000-0000-4000-8000-000000000004'); rollback;`),
  );
  assert.equal(event.revision, 1);
  assert.equal(event.title, 'Preserved event');
  assert.equal(Object.hasOwn(event, 'created_by'), false);
  assert.deepEqual(
    snapshot(),
    before,
    'New administrative read is non-mutating.',
  );
  psql(`begin; set local role authenticated; set local "request.jwt.claim.sub"='af800000-0000-4000-8000-000000000001';
    select public.schedule_update('af800000-0000-4000-8000-000000000005','event','Legacy post-upgrade edit','2028-02-10T10:00:00+09:00'); commit;`);
  assert.equal(
    psql(
      "select revision from public.schedules where id='af800000-0000-4000-8000-000000000005';",
    ),
    '2',
    'Legacy writers invalidate new CAS after upgrade.',
  );
  assert.equal(
    psql('select count(*) from public.schedule_notification_optouts;'),
    '1',
    'Unrelated private preference is preserved.',
  );
  console.info(
    'PASS: pre-00030 populated schedules upgrade preserves all source/public/editorial/preference/audit rows and initializes CAS without fabricated operations.',
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
