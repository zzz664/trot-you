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
 'content',(select jsonb_agg(to_jsonb(c)-'revision' order by c.id) from public.content_calendar c),
 'audit',(select jsonb_agg(to_jsonb(a) order by a.id) from public.calendar_audit_log a),
 'profiles',(select jsonb_agg(to_jsonb(p) order by p.id) from public.profiles p),
 'artists',(select jsonb_agg(to_jsonb(a) order by a.id) from public.artists a),
 'members',(select jsonb_agg(to_jsonb(m) order by m.artist_id,m.user_id) from public.artist_members m),
 'schedules',(select jsonb_agg(to_jsonb(s) order by s.id) from public.schedules s),
 'settings',jsonb_build_object(
   'state',(select jsonb_agg(to_jsonb(s) order by s.group_key) from private.admin_settings_state s),
   'display',(select jsonb_agg(to_jsonb(s) order by s.singleton) from private.admin_display_settings s),
   'audit',(select jsonb_agg(to_jsonb(s) order by s.created_at,s.id) from private.admin_settings_audit s),
   'operations',(select jsonb_agg(to_jsonb(s) order by s.actor_id,s.operation_id) from private.admin_settings_operations s),
   'message',(select jsonb_agg(to_jsonb(s) order by s.singleton) from private.message_policy s),
   'community',(select jsonb_agg(to_jsonb(s) order by s.singleton) from private.community_policy s)),
 'policies',(select jsonb_agg(to_jsonb(p) order by p.artist_id,p.month) from private.settlement_policies p),
 'notifications',(select jsonb_agg(to_jsonb(n) order by n.id) from private.notification_jobs n));`),
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
    psql(`select (select count(*) from auth.users)+(select count(*) from public.content_calendar)
    +(select count(*) from private.message_policy)+(select count(*) from public.subscriptions)+(select count(*) from public.payment_events);`),
    '0',
    'Use freshly reset disposable local database only.',
  );
  shouldReset = true;
  execFileSync(
    localCli,
    ['db', 'reset', '--local', '--version', '20261025000031'],
    { stdio: 'inherit' },
  );
  psql(`insert into auth.users(id,email,raw_user_meta_data) values
    ('b1800000-0000-4000-8000-000000000001','content-upgrade-admin@example.invalid','{}'),
    ('b1800000-0000-4000-8000-000000000002','content-upgrade-artist@example.invalid','{}');
    update public.profiles set call_name='가상계획팬',onboarding_completed_at=clock_timestamp() where id::text like 'b1800000-%';
    update public.profiles set role='admin' where id='b1800000-0000-4000-8000-000000000001';
    update public.profiles set role='artist' where id='b1800000-0000-4000-8000-000000000002';
    insert into public.artists(id,slug,name,grade,status) values
    ('b1800000-0000-4000-8000-000000000003','content-upgrade-active','Fictional upgrade artist','B','active'),
    ('b1800000-0000-4000-8000-000000000004','content-upgrade-paused','Fictional paused upgrade artist','B','paused');
    insert into public.artist_members(artist_id,user_id) values
    ('b1800000-0000-4000-8000-000000000003','b1800000-0000-4000-8000-000000000002');
    insert into private.admin_display_settings(singleton,page_size) values(true,23);
    begin; set local role authenticated; set local "request.jwt.claim.sub"='b1800000-0000-4000-8000-000000000001';
    select public.content_calendar_upsert('b1800000-0000-4000-8000-000000000003','2028-02-29','Before legacy edit','Original example');
    select public.content_calendar_upsert('b1800000-0000-4000-8000-000000000003','2028-02-29',E'  Preserved\\nlegacy topic  ',E'Legacy\\001example');
    select public.content_calendar_upsert('b1800000-0000-4000-8000-000000000003','0001-01-01','Earliest topic');
    select public.content_calendar_upsert('b1800000-0000-4000-8000-000000000004','9999-12-31','Paused future topic');
    select public.schedule_create('b1800000-0000-4000-8000-000000000003','event','Unchanged public schedule','2028-02-29T10:00:00+09:00');
    commit;`);
  const before = snapshot();
  assert.equal(before.settings.display[0].page_size, 23);
  assert.ok(
    before.settings.audit.length > 0,
    'Populated settings audit must be included in upgrade preservation.',
  );
  execFileSync(localCli, ['migration', 'up', '--local'], { stdio: 'inherit' });
  assert.deepEqual(
    snapshot(),
    before,
    'Upgrade preserves complete editorial sources and historical audit, identity, schedule, settings, policy and notification rows.',
  );
  assert.equal(
    psql('select count(*) from public.content_calendar where revision=1;'),
    '3',
    'Every legacy entry receives initial CAS revision without a fabricated edit.',
  );
  assert.equal(
    psql('select count(*) from private.content_calendar_operations;'),
    '0',
    'Upgrade does not fabricate accepted operations.',
  );
  const read = (sql) =>
    JSON.parse(
      psql(
        `begin; set local role authenticated; set local "request.jwt.claim.sub"='b1800000-0000-4000-8000-000000000001'; ${sql} rollback;`,
      ),
    );
  const month = read(
    "select public.content_calendar_admin_list('b1800000-0000-4000-8000-000000000003','2028-02-01');",
  );
  assert.equal(month.entries.length, 1);
  assert.equal(month.entries[0].revision, 1);
  assert.equal(month.entries[0].topic, '  Preserved\nlegacy topic  ');
  assert.equal(month.entries[0].example_text, 'Legacy\u0001example');
  assert.equal(Object.hasOwn(month.entries[0], 'created_by'), false);
  assert.equal(month.activity.requirements_ready, false);
  const artistMonth = JSON.parse(
    psql(`begin; set local role authenticated; set local "request.jwt.claim.sub"='b1800000-0000-4000-8000-000000000002';
    select public.content_calendar_artist_context('content-upgrade-active','2028-02-01'); rollback;`),
  );
  assert.deepEqual(artistMonth.entries, month.entries);
  assert.equal(Object.hasOwn(artistMonth.artist, 'status'), false);
  const paused = read(
    "select public.content_calendar_admin_list('b1800000-0000-4000-8000-000000000004','9999-12-01');",
  );
  assert.equal(paused.entries[0].date, '9999-12-31');
  assert.equal(paused.artist.status, 'paused');
  assert.deepEqual(
    snapshot(),
    before,
    'All new reads preserve legacy source bytes and audit history.',
  );
  psql(`begin; set local role authenticated; set local "request.jwt.claim.sub"='b1800000-0000-4000-8000-000000000001';
    select public.content_calendar_upsert('b1800000-0000-4000-8000-000000000003','2028-02-29','Legacy post-upgrade edit'); commit;`);
  assert.equal(
    psql(
      `select revision from public.content_calendar where id='${month.entries[0].id}';`,
    ),
    '2',
    'Legacy writes invalidate new CAS after upgrade.',
  );
  const updated =
    read(`select public.content_calendar_admin_save('b1800000-0000-4000-8000-000000000005','${month.entries[0].id}',2,
    '{"artist_id":"b1800000-0000-4000-8000-000000000003","date":"2028-02-29","topic":"New CAS update","example_text":null}'::jsonb);`);
  assert.equal(updated.revision, 3);
  assert.equal(updated.topic, 'New CAS update');
  assert.equal(
    psql(
      `select created_by from public.content_calendar where id='${month.entries[0].id}';`,
    ),
    'b1800000-0000-4000-8000-000000000001',
    'Original author is preserved, never copied to public projection.',
  );
  assert.equal(
    psql('select count(*) from private.content_calendar_operations;'),
    '0',
    'Rolled-back validation leaves no receipt behind.',
  );
  console.info(
    'PASS: pre-00032 populated editorial upgrade preserves source/audit bytes, initializes CAS, retains legacy edits and reads private planning without inventing targets or side effects.',
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
