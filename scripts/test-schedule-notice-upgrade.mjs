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
 'schedules',(select jsonb_agg(to_jsonb(s) order by s.id) from public.schedules s),
 'catalog',(select jsonb_agg(to_jsonb(s) order by s.id) from public.schedule_catalog s),
 'optouts',(select jsonb_agg(to_jsonb(o) order by o.user_id,o.schedule_id) from public.schedule_notification_optouts o),
 'profiles',(select jsonb_agg(to_jsonb(p) order by p.id) from public.profiles p),
 'devices',(select jsonb_agg(to_jsonb(d) order by d.id) from private.push_subscriptions d),
 'preferences',(select jsonb_agg(to_jsonb(p) order by p.user_id) from private.notification_preferences p),
 'attempts',(select jsonb_agg(to_jsonb(a) order by a.job_id,a.ordinal) from private.notification_attempts a),
 'jobs',(select jsonb_agg(to_jsonb(j)-'state'-'cancellation_requested_at'-'schedule_notice_policy_version'-'schedule_notice_starts_at' order by j.id) from private.notification_jobs j));`),
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
    psql(
      `select (select count(*) from auth.users)+(select count(*) from public.schedules)+(select count(*) from private.notification_jobs);`,
    ),
    '0',
    'Use freshly reset disposable local database only.',
  );
  shouldReset = true;
  execFileSync(
    localCli,
    ['db', 'reset', '--local', '--version', '20261025000030'],
    { stdio: 'inherit' },
  );
  psql(`insert into auth.users(id,email,raw_user_meta_data) values
  ('bc100000-0000-4000-8000-000000000001','schedule-notice-upgrade-fan@example.invalid','{}'),
  ('bc100000-0000-4000-8000-000000000002','schedule-notice-upgrade-admin@example.invalid','{}');
  update public.profiles set call_name='가상 일정 팬',onboarding_completed_at=clock_timestamp() where id::text like 'bc100000-%';
  update public.profiles set role='admin' where id='bc100000-0000-4000-8000-000000000002';
  insert into public.artists(id,slug,name,grade,status) values('bc200000-0000-4000-8000-000000000001','notice-upgrade','Fictional upgrade artist','B','active');
  insert into public.subscriptions(user_id,artist_id,provider,status,current_period_start,current_period_end,created_at)
   values('bc100000-0000-4000-8000-000000000001','bc200000-0000-4000-8000-000000000001','toss','active',now()-interval '1 day',now()+interval '5 days',now()-interval '2 days');
  insert into private.notification_policy(version,consent_version,webpush_enabled,max_attempts,retry_seconds,lease_seconds,schedule_lead_seconds)
   values('fictional-notice-upgrade','fictional-notice-upgrade-consent',true,3,10,30,86400);
  insert into private.notification_preferences(user_id,webpush_enabled,new_message,billing,schedule)
   values('bc100000-0000-4000-8000-000000000001',true,true,true,true);
  insert into private.push_subscriptions(id,user_id,endpoint,p256dh,auth,consent_version)
   values('bc400000-0000-4000-8000-000000000001','bc100000-0000-4000-8000-000000000001','https://push.example.invalid/notice-upgrade',repeat('B',87),repeat('A',22),'fictional-notice-upgrade-consent');
  insert into public.schedules(id,artist_id,type,status,title,starts_at,created_by)
   select ('bc500000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'bc200000-0000-4000-8000-000000000001','event','published','Preserved legacy event '||n,
   now()+interval '12 hours','bc100000-0000-4000-8000-000000000002' from generate_series(1,5)n;
  insert into public.schedule_notification_optouts(user_id,schedule_id) values('bc100000-0000-4000-8000-000000000002','bc500000-0000-4000-8000-000000000001');
  update private.notification_jobs set state='retry_wait' where source_id='bc500000-0000-4000-8000-000000000002';
  update private.notification_jobs set state=case when source_id='bc500000-0000-4000-8000-000000000003' then 'leased' else 'unknown' end,
   attempt_count=1,lease_token=gen_random_uuid(),lease_expires_at=clock_timestamp()+interval '30 seconds'
   where source_id in('bc500000-0000-4000-8000-000000000003','bc500000-0000-4000-8000-000000000004');
  insert into private.notification_attempts(job_id,ordinal,token,state,lease_expires_at)
   select id,1,lease_token,state,lease_expires_at from private.notification_jobs where state in('leased','unknown');
  update private.notification_jobs set state='provider_accepted',provider_accepted_at=clock_timestamp() where source_id='bc500000-0000-4000-8000-000000000005';`);
  assert.equal(
    psql('select count(*) from private.notification_jobs;'),
    '5',
    'Pre-upgrade publication hook created five historical jobs.',
  );
  const before = snapshot();
  execFileSync(localCli, ['migration', 'up', '--local'], { stdio: 'inherit' });
  assert.deepEqual(
    snapshot(),
    before,
    'Upgrade preserves source/public/private/attempt evidence and all immutable job fields.',
  );
  assert.equal(
    psql(
      `select count(*) from private.notification_jobs where source_id in('bc500000-0000-4000-8000-000000000001','bc500000-0000-4000-8000-000000000002') and state='canceled' and cancellation_requested_at is not null;`,
    ),
    '2',
    'Old queued/retry work cannot bypass approval gate.',
  );
  assert.equal(
    psql(
      `select count(*) from private.notification_jobs where source_id in('bc500000-0000-4000-8000-000000000003','bc500000-0000-4000-8000-000000000004') and state in('leased','unknown') and cancellation_requested_at is not null;`,
    ),
    '2',
    'In-flight ambiguity is retained, not mislabeled recalled or not-sent.',
  );
  assert.equal(
    psql(
      `select state='provider_accepted' and cancellation_requested_at is null from private.notification_jobs where source_id='bc500000-0000-4000-8000-000000000005';`,
    ),
    't',
    'Actual acceptance history is unchanged.',
  );
  assert.equal(
    psql(
      `select count(*) from private.notification_jobs where schedule_notice_policy_version is null and schedule_notice_starts_at is null;`,
    ),
    '5',
    'Upgrade never fabricates approved snapshots for legacy jobs.',
  );
  assert.equal(
    psql(
      'select (select count(*) from private.schedule_notice_policies)+(select count(*) from private.schedule_notice_policy_current)+(select count(*) from private.schedule_notice_scan_cursor);',
    ),
    '0',
    'Upgrade seeds neither approval nor scheduler cursor.',
  );
  assert.equal(
    psql(
      `begin;set local role service_role;select public.notification_enqueue('schedule','bc500000-0000-4000-8000-000000000001');rollback;`,
    ),
    '0',
    'Legacy enqueue cannot bypass new explicit gate after upgrade.',
  );
  console.info(
    'PASS: pre-00031 populated upgrade preserves events/preferences/devices/attempts/acceptance while suppressing legacy unsent work without fabricated approval or delivery.',
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
        'Upgrade fixture cleanup failed; reset disposable database before further use.',
        error,
      );
      process.exitCode = 1;
    }
  }
}
