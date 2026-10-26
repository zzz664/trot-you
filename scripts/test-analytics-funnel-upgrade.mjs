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
  'events',(select jsonb_agg(to_jsonb(e) order by e.id) from private.analytics_events e),
  'consents',(select jsonb_agg(to_jsonb(c) order by c.user_id) from private.analytics_consents c),
  'analytics_policy',(select jsonb_agg(to_jsonb(p) order by p.singleton) from private.analytics_policy p),
  'documents',(select jsonb_agg(to_jsonb(d) order by d.version) from private.onboarding_documents d),
  'profiles',(select jsonb_agg(to_jsonb(p) order by p.id) from public.profiles p),
  'artists',(select jsonb_agg(to_jsonb(a) order by a.id) from public.artists a),
  'members',(select jsonb_agg(to_jsonb(m) order by m.artist_id,m.user_id) from public.artist_members m),
  'subscriptions',(select jsonb_agg(to_jsonb(s) order by s.id) from public.subscriptions s),
  'payments',(select jsonb_agg(to_jsonb(e) order by e.id) from public.payment_events e),
  'mandates',(select jsonb_agg(to_jsonb(m) order by m.id) from private.payment_mandates m),
  'obligations',(select jsonb_agg(to_jsonb(o) order by o.id) from private.billing_obligations o),
  'attempts',(select jsonb_agg(to_jsonb(a) order by a.id) from private.payment_attempts a),
  'verifications',(select jsonb_agg(to_jsonb(v) order by v.event_id) from private.payment_event_verifications v),
  'settlement_versions',(select jsonb_agg(to_jsonb(v) order by v.version) from private.settlement_source_versions v),
  'messages',(select jsonb_agg(to_jsonb(m) order by m.id) from public.messages m),
  'reads',(select jsonb_agg(to_jsonb(r) order by r.user_id,r.message_id) from public.message_reads r),
  'replies',(select jsonb_agg(to_jsonb(r) order by r.id) from public.replies r),
  'posts',(select jsonb_agg(to_jsonb(p) order by p.id) from public.posts p),
  'comments',(select jsonb_agg(to_jsonb(c) order by c.id) from public.comments c),
  'board_operations',(select jsonb_agg(to_jsonb(b) order by b.actor_id,b.operation_id) from private.board_operations b),
  'rates',(select jsonb_agg(to_jsonb(r) order by r.user_id) from private.community_rate_limits r),
  'community_policy',(select jsonb_agg(to_jsonb(p) order by p.singleton) from private.community_policy p),
  'point_policy',(select jsonb_agg(to_jsonb(p) order by p.singleton) from private.point_policy p),
  'points',(select jsonb_agg(to_jsonb(p) order by p.id) from private.point_ledger p),
  'attendance_operations',(select jsonb_agg(to_jsonb(a) order by a.actor_id,a.operation_id) from private.point_attendance_operations a),
  'activity_outcomes',(select jsonb_agg(to_jsonb(o) order by o.entry_id) from private.point_activity_outcomes o));`),
  );
const ids = {
  fan: 'd3910000-0000-4000-8000-000000000001',
  withdrawn: 'd3910000-0000-4000-8000-000000000002',
  stale: 'd3910000-0000-4000-8000-000000000003',
  admin: 'd3910000-0000-4000-8000-000000000004',
  artistUser: 'd3910000-0000-4000-8000-000000000005',
  artist: 'd3910000-0000-4000-8000-000000000006',
  message: 'd3910000-0000-4000-8000-000000000007',
  reply: 'd3910000-0000-4000-8000-000000000008',
  version: 'd3910000-0000-4000-8000-000000000009',
  oldVersion: 'd3910000-0000-4000-8000-000000000010',
  operation: 'd3910000-0000-4000-8000-000000000011',
  freshKey: 'd3910000-0000-4000-8000-000000000012',
  expired: 'd3910000-0000-4000-8000-000000000013',
};
const userSql = (actor, sql, commit = false) =>
  psql(
    `begin; set local role authenticated; set local "request.jwt.claim.sub"='${actor}'; ${sql} ${commit ? 'commit' : 'rollback'};`,
  );
const serviceSql = (sql) =>
  psql(`begin; set local role service_role; ${sql} commit;`);
const dashboardSql = `select public.admin_analytics_dashboard(((clock_timestamp() at time zone 'Asia/Seoul')::date-40),(clock_timestamp() at time zone 'Asia/Seoul')::date);`;
const count = (page, name) =>
  page.events.find((entry) => entry.name === name).event_count;
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
      `select (select count(*) from auth.users)+(select count(*) from private.analytics_events)+(select count(*) from private.analytics_consents)+(select count(*) from private.analytics_policy)+(select count(*) from public.payment_events)+(select count(*) from private.point_ledger)+(select count(*) from storage.objects);`,
    ),
    '0',
    'Use freshly reset disposable local database only.',
  );
  shouldReset = true;
  execFileSync(
    localCli,
    ['db', 'reset', '--local', '--version', '20261026000037'],
    { stdio: 'inherit' },
  );
  psql(`insert into auth.users(id,email,raw_user_meta_data) values
    ('${ids.fan}','analytics-upgrade-fan@example.invalid','{}'),('${ids.withdrawn}','analytics-upgrade-withdrawn@example.invalid','{}'),
    ('${ids.stale}','analytics-upgrade-stale@example.invalid','{}'),('${ids.admin}','analytics-upgrade-admin@example.invalid','{}'),
    ('${ids.artistUser}','analytics-upgrade-artist@example.invalid','{}'),('${ids.expired}','analytics-upgrade-expired@example.invalid','{}');
    update public.profiles set call_name='Preserved private analytics name',onboarding_completed_at=clock_timestamp() where id::text like 'd3910000-%';
    update public.profiles set role='admin' where id='${ids.admin}';
    update public.profiles set role='artist' where id='${ids.artistUser}';
    insert into public.artists(id,slug,name,grade,status) values('${ids.artist}','analytics-funnel-upgrade','Fictional preserved analytics artist','B','active');
    insert into public.artist_members(artist_id,user_id) values('${ids.artist}','${ids.artistUser}');
    insert into private.onboarding_documents(version,kind,title,body,approved_at,published_at) values
    ('${ids.version}','analytics','Preserved fictional current document','Fictional disposable CI policy only; not legal approval.',clock_timestamp(),clock_timestamp()),
    ('${ids.oldVersion}','analytics','Preserved fictional old document','Fictional disposable old CI policy only; not legal approval.',clock_timestamp(),clock_timestamp());
    insert into private.analytics_policy(consent_version,enabled,retention_days) values('${ids.version}',true,30);
    insert into private.analytics_consents(user_id,consent_version,granted,granted_at,updated_at) values
    ('${ids.fan}','${ids.version}',true,clock_timestamp()-interval '1 day',clock_timestamp()),
    ('${ids.withdrawn}','${ids.version}',false,clock_timestamp()-interval '1 day',clock_timestamp()),
    ('${ids.stale}','${ids.oldVersion}',true,clock_timestamp()-interval '1 day',clock_timestamp()),
    ('${ids.expired}','${ids.version}',true,clock_timestamp()-interval '40 days',clock_timestamp());
    insert into private.community_policy(version,max_title_length,max_body_length,max_comment_length,max_reason_length,max_images,max_image_bytes,max_image_long_edge,
      auto_hide_report_count,rate_window_seconds,max_contributions_per_window,max_reports_per_window,forbidden_terms,forbidden_patterns)
    values('fictional-analytics-upgrade',100,1000,100,100,3,1048576,4096,3,60,1000,1000,'{}','{}');
    insert into private.point_policy(version,attendance_amount,post_amount,comment_amount,post_daily_cap,comment_daily_cap,deleted_content_treatment)
    values('fictional-analytics-upgrade',10,20,5,null,null,'retain');`);
  const subscription = serviceSql(
    `select public.billing_open_subscription('${ids.fan}','${ids.artist}','toss');`,
  );
  serviceSql(
    `select public.billing_register_mandate('${subscription}','test','fictional-analytics-upgrade-merchant',gen_random_uuid(),gen_random_uuid(),'fictional-analytics-billing-consent');`,
  );
  const obligation = serviceSql(
    `select public.billing_prepare_obligation('${subscription}',statement_timestamp(),statement_timestamp()+interval '30 days',6500,false,'fictional-analytics-upgrade-price',259200,3600,2);`,
  );
  const attempt = serviceSql(
    `select public.billing_prepare_attempt('${obligation}');`,
  );
  const claim = JSON.parse(
    serviceSql(`select public.billing_claim_attempt('${attempt}',30);`),
  );
  assert.equal(claim.attempt_id, attempt);
  const charge = serviceSql(
    `select public.billing_finalize_charge('${attempt}','fictional-analytics-upgrade-charge',6500,'KRW',statement_timestamp(),gen_random_uuid());`,
  );
  psql(`insert into public.messages(id,artist_id,author_id,type,body,status,scheduled_at,sent_at,is_preview,preview_order)
    values('${ids.message}','${ids.artist}','${ids.artistUser}','text','Preserved private message body','sent',clock_timestamp(),clock_timestamp(),true,1);
    insert into public.message_reads(user_id,message_id) values('${ids.fan}','${ids.message}');
    insert into public.replies(id,user_id,artist_id,subscription_id,body) values('${ids.reply}','${ids.fan}','${ids.artist}','${subscription}','Preserved private reply body');`);
  const post = JSON.parse(
    userSql(
      ids.fan,
      `select public.board_ui_create('analytics-funnel-upgrade',gen_random_uuid(),gen_random_uuid(),'${ids.artist}','Preserved private post title','Preserved private post body','{}'::uuid[],false,false);`,
      true,
    ),
  ).id;
  userSql(
    ids.fan,
    `select public.community_create_comment('${post}',gen_random_uuid(),'Preserved private comment body');`,
    true,
  );
  const attendance = JSON.parse(
    userSql(
      ids.fan,
      `select public.point_ui_check_attendance('${ids.operation}');`,
      true,
    ),
  );
  // These are historical STORAGE fixtures spanning all 13 allowed schemas, not
  // claims that each underlying operation passed a live ingestion boundary. The
  // real preexisting billing/point/content evidence above is preserved separately.
  // Excluded rows model withdrawal, old consent, a later consent epoch and expiry.
  psql(`insert into private.analytics_events(user_id,event_key,name,origin,source_id,font_scale,voice_context,consent_version,occurred_at,recorded_at)
    select '${ids.fan}',gen_random_uuid(),name,
      case when name in('message_open','voice_input_used') then 'client' when name in('subscribe_complete','renew') then 'verified_charge' else 'server' end,
      case when name in('signup_complete','font_size_selected','voice_input_used') then null
        when name in('preview_view','message_open') then '${ids.message}'::uuid
        when name='reply_sent' then '${ids.reply}'::uuid when name='post_create' then '${post}'::uuid
        when name='attendance' then '${attendance.entry_id}'::uuid
        when name in('subscribe_complete','renew') then '${charge}'::uuid
        when name='subscribe_fail' then '${attempt}'::uuid else '${subscription}'::uuid end,
      case when name='font_size_selected' then 'large'::public.font_scale end,
      case when name='voice_input_used' then 'reply'::public.analytics_voice_context end,
      '${ids.version}',clock_timestamp(),clock_timestamp()
    from unnest(enum_range(null::public.analytics_event_name)) name;
    insert into private.analytics_events(user_id,event_key,name,origin,voice_context,consent_version,occurred_at,recorded_at) values
    ('${ids.withdrawn}',gen_random_uuid(),'voice_input_used','client','post','${ids.version}',clock_timestamp(),clock_timestamp()),
    ('${ids.stale}',gen_random_uuid(),'voice_input_used','client','comment','${ids.oldVersion}',clock_timestamp(),clock_timestamp()),
    ('${ids.fan}',gen_random_uuid(),'voice_input_used','client','post','${ids.version}',clock_timestamp()-interval '2 days',clock_timestamp()-interval '2 days'),
    ('${ids.expired}',gen_random_uuid(),'voice_input_used','client','comment','${ids.version}',clock_timestamp()-interval '31 days',clock_timestamp()-interval '31 days');`);
  const before = snapshot();
  assert.equal(before.events.length, 17);
  assert.equal(new Set(before.events.map((entry) => entry.name)).size, 13);
  assert.equal(before.consents.length, 4);
  assert.equal(before.analytics_policy.length, 1);
  assert.equal(before.documents.length, 2);
  assert.equal(before.subscriptions.length, 1);
  assert.equal(before.payments.length, 1);
  assert.equal(before.mandates.length, 1);
  assert.equal(before.obligations.length, 1);
  assert.equal(before.attempts.length, 1);
  assert.equal(before.verifications.length, 1);
  assert.ok(before.settlement_versions.length > 0);
  assert.equal(before.messages.length, 1);
  assert.equal(before.reads.length, 1);
  assert.equal(before.replies.length, 1);
  assert.equal(before.posts.length, 1);
  assert.equal(before.comments.length, 1);
  assert.equal(before.board_operations.length, 1);
  assert.equal(before.points.length, 3);
  assert.equal(before.attendance_operations.length, 1);
  assert.equal(before.activity_outcomes.length, 2);
  const startedAt = psql('select clock_timestamp();');
  execFileSync(localCli, ['migration', 'up', '--local'], { stdio: 'inherit' });
  const finishedAt = psql('select clock_timestamp();');
  assert.deepEqual(
    snapshot(),
    before,
    'Migration 37-to-38 preserves every predecessor analytics, consent, policy, source, financial, point and receipt field without backfill.',
  );
  const coverage = JSON.parse(
    psql('select to_jsonb(c) from private.analytics_dashboard_coverage c;'),
  );
  assert.equal(coverage.singleton, true);
  assert.ok(Date.parse(coverage.instrumentation_from) >= Date.parse(startedAt));
  assert.ok(
    Date.parse(coverage.instrumentation_from) <= Date.parse(finishedAt),
  );
  assert.equal(
    psql('select count(*) from private.analytics_dashboard_coverage;'),
    '1',
  );
  assert.throws(
    () =>
      serviceSql(
        `select public.analytics_capture_server('${ids.fan}',gen_random_uuid(),'post_create','${post}');`,
      ),
    /ANALYTICS_CAPTURE_SOURCE_BEFORE_START/,
    'Application capture cannot backfill a pre-migration content operation on replay.',
  );
  assert.throws(
    () => serviceSql(`select public.analytics_capture_charge('${charge}');`),
    /ANALYTICS_CAPTURE_SOURCE_BEFORE_START/,
    'Application capture cannot backfill a pre-migration verified charge on replay.',
  );
  const page = JSON.parse(userSql(ids.admin, dashboardSql));
  assert.equal(page.actor_id, ids.admin);
  assert.equal(page.collection.status, 'enabled');
  assert.equal(page.collection.retention_days, 30);
  assert.equal(
    page.coverage.instrumentation_from,
    coverage.instrumentation_from,
  );
  assert.equal(page.coverage.history_complete, false);
  assert.equal(page.coverage.mode, 'current_consent_observations');
  assert.deepEqual(page.business_metrics, {
    configured: false,
    reason: 'definitions_unapproved',
    expected_count: 4,
  });
  assert.equal(page.events.length, 13);
  assert.ok(page.events.every((entry) => entry.event_count === 1));
  assert.equal(
    page.daily.reduce((total, entry) => total + entry.event_count, 0),
    13,
  );
  for (const entry of page.events)
    assert.deepEqual(Object.keys(entry).sort(), ['event_count', 'name']);
  for (const entry of page.daily)
    assert.deepEqual(Object.keys(entry).sort(), [
      'day_kst',
      'event_count',
      'name',
    ]);
  const response = JSON.stringify(page);
  for (const secret of [
    ids.fan,
    ids.withdrawn,
    ids.stale,
    ids.expired,
    ids.message,
    ids.reply,
    subscription,
    charge,
    post,
    '@example.invalid',
    'Preserved private',
    'consent_version',
    'source_id',
    'event_key',
  ])
    assert.ok(
      !response.includes(secret),
      `Aggregate response must not disclose ${secret}.`,
    );
  assert.deepEqual(
    snapshot(),
    before,
    'Reading the new current-consent aggregates is completely nonmutating.',
  );
  const disabled = JSON.parse(
    psql(
      `begin; update private.analytics_policy set enabled=false; set local role authenticated; set local "request.jwt.claim.sub"='${ids.admin}'; ${dashboardSql} rollback;`,
    ),
  );
  assert.equal(disabled.collection.status, 'disabled');
  assert.ok(disabled.events.every((entry) => entry.event_count === null));
  assert.deepEqual(disabled.daily, []);
  const withdrawn = JSON.parse(
    psql(
      `begin; set local role authenticated; set local "request.jwt.claim.sub"='${ids.fan}'; select public.analytics_set_consent(false,'${ids.version}'); set local "request.jwt.claim.sub"='${ids.admin}'; ${dashboardSql} rollback;`,
    ),
  );
  assert.ok(withdrawn.events.every((entry) => entry.event_count === 0));
  assert.deepEqual(withdrawn.daily, []);
  assert.deepEqual(
    snapshot(),
    before,
    'Rolled-back disable and withdrawal probes leave all stored predecessor fields intact.',
  );
  const recordSql = `select public.analytics_record_client('${ids.freshKey}','voice_input_used',p_voice_context=>'reply');`;
  const freshId = userSql(ids.fan, recordSql, true);
  assert.equal(
    userSql(ids.fan, recordSql, true),
    freshId,
    'New intake replays one exact event identity.',
  );
  const after = snapshot();
  assert.equal(after.events.length, before.events.length + 1);
  assert.deepEqual(
    after.events.filter((entry) => entry.id !== freshId),
    before.events,
    'A new explicit observation never reclassifies or replaces historical rows.',
  );
  for (const key of Object.keys(before).filter((key) => key !== 'events'))
    assert.deepEqual(
      after[key],
      before[key],
      `New observation does not mutate ${key}.`,
    );
  const finalPage = JSON.parse(userSql(ids.admin, dashboardSql));
  assert.equal(count(finalPage, 'voice_input_used'), 2);
  assert.equal(
    finalPage.events.reduce((total, entry) => total + entry.event_count, 0),
    14,
  );
  assert.deepEqual(
    JSON.parse(
      psql('select to_jsonb(c) from private.analytics_dashboard_coverage c;'),
    ),
    coverage,
    'Dashboard coverage marker is immutable after repeated reads and collection.',
  );
  console.info(
    'PASS: populated 37-to-38 analytics upgrade preserves 17 complete historical observations, 4 consent rows, current policy, verified financial evidence, content, 3 ledger rows and existing receipts; no backfill, private current-consent counts, unavailable metrics and one explicit deduplicated new observation.',
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
        'Analytics upgrade fixture cleanup failed; reset the disposable database before reuse.',
        error,
      );
      process.exitCode = 1;
    }
  }
}
