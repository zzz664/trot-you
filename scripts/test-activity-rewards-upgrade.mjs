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
    'posts',(select jsonb_agg(to_jsonb(p) order by p.id) from public.posts p),
    'board_operations',(select jsonb_agg(to_jsonb(b) order by b.actor_id,b.operation_id) from private.board_operations b),
    'board_uploads',(select jsonb_agg(to_jsonb(u) order by u.id) from private.board_uploads u),
    'replies',(select jsonb_agg(to_jsonb(r) order by r.id) from public.replies r),
    'subscriptions',(select jsonb_agg(to_jsonb(s) order by s.id) from public.subscriptions s),
    'messages',(select jsonb_agg(to_jsonb(m) order by m.id) from public.messages m),
    'comments',(select jsonb_agg(to_jsonb(c) order by c.id) from public.comments c),
    'images',(select jsonb_agg(to_jsonb(i) order by i.id) from public.post_images i),
    'objects',(select jsonb_agg(to_jsonb(o) order by o.id) from storage.objects o),
    'likes',(select jsonb_agg(to_jsonb(l) order by l.post_id,l.user_id) from public.post_likes l),
    'reports',(select jsonb_agg(to_jsonb(r) order by r.id) from public.reports r),
    'moderation',(select jsonb_agg(to_jsonb(m) order by m.id) from public.community_moderation_log m),
    'moderation_operations',(select jsonb_agg(to_jsonb(m) order by m.actor_id,m.operation_id) from private.moderation_operations m),
    'moderation_notices',(select jsonb_agg(to_jsonb(n) order by n.id) from private.moderation_notices n),
    'rates',(select jsonb_agg(to_jsonb(r) order by r.user_id) from private.community_rate_limits r),
    'attendance_operations',(select jsonb_agg(to_jsonb(a) order by a.actor_id,a.operation_id) from private.point_attendance_operations a),
    'points',(select jsonb_agg(to_jsonb(p) order by p.id) from private.point_ledger p),
    'point_policy',(select jsonb_agg(to_jsonb(p) order by p.singleton) from private.point_policy p),
    'profiles',(select jsonb_agg(to_jsonb(p) order by p.id) from public.profiles p),
    'artists',(select jsonb_agg(to_jsonb(a) order by a.id) from public.artists a),
    'members',(select jsonb_agg(to_jsonb(m) order by m.artist_id,m.user_id) from public.artist_members m),
    'content',(select jsonb_agg(to_jsonb(c) order by c.id) from public.content_calendar c),
    'calendar_audit',(select jsonb_agg(to_jsonb(a) order by a.id) from public.calendar_audit_log a),
    'schedules',(select jsonb_agg(to_jsonb(s) order by s.id) from public.schedules s),
    'settings',jsonb_build_object(
      'state',(select jsonb_agg(to_jsonb(s) order by s.group_key) from private.admin_settings_state s),
      'display',(select jsonb_agg(to_jsonb(s) order by s.singleton) from private.admin_display_settings s),
      'audit',(select jsonb_agg(to_jsonb(s) order by s.created_at,s.id) from private.admin_settings_audit s),
      'operations',(select jsonb_agg(to_jsonb(s) order by s.actor_id,s.operation_id) from private.admin_settings_operations s),
      'message',(select jsonb_agg(to_jsonb(s) order by s.singleton) from private.message_policy s),
      'community',(select jsonb_agg(to_jsonb(s) order by s.singleton) from private.community_policy s)),
    'settlement_policy',(select jsonb_agg(to_jsonb(p) order by p.artist_id,p.month) from private.settlement_policies p),
    'notification_policy',(select jsonb_agg(to_jsonb(p) order by p.singleton) from private.notification_policy p),
    'notification_preferences',(select jsonb_agg(to_jsonb(p) order by p.user_id) from private.notification_preferences p),
    'push',(select jsonb_agg(to_jsonb(p) order by p.id) from private.push_subscriptions p),
    'notifications',(select jsonb_agg(to_jsonb(n) order by n.id) from private.notification_jobs n));`),
  );
const ids = {
  fan: 'd3800000-0000-4000-8000-000000000001',
  admin: 'd3800000-0000-4000-8000-000000000002',
  artistUser: 'd3800000-0000-4000-8000-000000000003',
  reporter: 'd3800000-0000-4000-8000-000000000004',
  artist: 'd3800000-0000-4000-8000-000000000005',
  image: 'd3800000-0000-4000-8000-000000000006',
  object: 'd3800000-0000-4000-8000-000000000007',
  schedule: 'd3800000-0000-4000-8000-000000000008',
  device: 'd3800000-0000-4000-8000-000000000009',
  subscription: 'd3800000-0000-4000-8000-000000000010',
  message: 'd3800000-0000-4000-8000-000000000011',
  reply: 'd3800000-0000-4000-8000-000000000012',
  blockedReply: 'd3800000-0000-4000-8000-000000000013',
};
const userSql = (actor, sql, commit = false) =>
  psql(
    `begin; set local role authenticated; set local "request.jwt.claim.sub"='${actor}'; ${sql} ${commit ? 'commit' : 'rollback'};`,
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
      `select (select count(*) from auth.users)+(select count(*) from public.posts)+(select count(*) from private.community_policy)+(select count(*) from storage.objects);`,
    ),
    '0',
    'Use freshly reset disposable local database only.',
  );
  shouldReset = true;
  execFileSync(
    localCli,
    ['db', 'reset', '--local', '--version', '20261026000036'],
    { stdio: 'inherit' },
  );
  psql(`insert into auth.users(id,email,raw_user_meta_data) values
    ('${ids.fan}','activity-rewards-upgrade-fan@example.invalid','{}'),('${ids.admin}','activity-rewards-upgrade-admin@example.invalid','{}'),
    ('${ids.artistUser}','activity-rewards-upgrade-artist@example.invalid','{}'),('${ids.reporter}','activity-rewards-upgrade-reporter@example.invalid','{}');
    update public.profiles set call_name='가상게시팬',onboarding_completed_at=clock_timestamp() where id::text like 'd3800000-%';
    update public.profiles set role='admin' where id='${ids.admin}';
    update public.profiles set role='artist' where id='${ids.artistUser}';
    insert into public.artists(id,slug,name,grade,status) values('${ids.artist}','activity-rewards-upgrade','Fictional preserved board artist','B','active');
    insert into public.artist_members(artist_id,user_id) values('${ids.artist}','${ids.artistUser}');
    insert into private.community_policy(version,max_title_length,max_body_length,max_comment_length,max_reason_length,max_images,max_image_bytes,max_image_long_edge,
      auto_hide_report_count,rate_window_seconds,max_contributions_per_window,max_reports_per_window,forbidden_terms,forbidden_patterns)
    values('fictional-activity-rewards-upgrade',100,1000,100,100,3,1048576,4096,3,60,1000,1000,'{}','{}');
    insert into private.point_policy(version,attendance_amount,post_amount,comment_amount,post_daily_cap,comment_daily_cap,deleted_content_treatment)
    values('fictional-activity-rewards-upgrade',10,20,5,null,null,'retain');
    insert into private.admin_display_settings(singleton,page_size) values(true,23);
    insert into private.settlement_policies(artist_id,month,contract_from,contract_until,base_rate,performance_rate,vat_rate,pg_fee_rate)
    values('${ids.artist}','2028-02-01','2028-01-01','2029-01-01',0.3,0.4,0.1,0.03);
    insert into private.notification_policy(version,consent_version,webpush_enabled,max_attempts,retry_seconds,lease_seconds,schedule_lead_seconds)
    values('fictional-activity-rewards-upgrade','fictional-activity-rewards-upgrade',true,3,10,30,86400);
    insert into private.notification_preferences(user_id,webpush_enabled,new_message,billing,schedule)
    values('${ids.fan}',true,true,true,true);
    insert into private.push_subscriptions(id,user_id,endpoint,p256dh,auth,consent_version)
    values('${ids.device}','${ids.fan}','https://push.example.invalid/activity-rewards-upgrade',repeat('B',87),repeat('A',22),'fictional-activity-rewards-upgrade');
    insert into public.schedules(id,artist_id,type,status,title,starts_at,created_by)
    values('${ids.schedule}','${ids.artist}','event','draft','Preserved private event','2028-02-29T10:00:00+09:00','${ids.admin}');
    insert into private.notification_jobs(source_kind,source_id,schedule_id,user_id,device_id,route_kind,route_id,next_attempt_at,max_attempts,retry_seconds,lease_seconds,policy_version)
    values('schedule','${ids.schedule}','${ids.schedule}','${ids.fan}','${ids.device}','schedule','${ids.schedule}',clock_timestamp()+interval '1 day',3,10,30,'fictional-activity-rewards-upgrade');`);
  const createLegacy = (title) =>
    userSql(
      ids.fan,
      `select public.community_create_post('${ids.artist}',gen_random_uuid(),'${title}',E'  Preserved legacy\\nbody  ');`,
      true,
    );
  const visible = createLegacy('Preserved public post');
  const pinned = createLegacy('Preserved pinned notice');
  const hidden = createLegacy('Preserved hidden post');
  const deleted = createLegacy('Preserved deleted post');
  userSql(
    ids.admin,
    `select public.community_set_notice('${pinned}',true,true);
    select public.community_moderate('post','${hidden}','hide','Fictional retained decision');
    select public.content_calendar_upsert('${ids.artist}','2028-02-29','Preserved editorial topic','Preserved reference');`,
    true,
  );
  userSql(
    ids.fan,
    `select public.community_delete('post','${deleted}');`,
    true,
  );
  const createLegacyComment = (body) =>
    userSql(
      ids.reporter,
      `select public.community_create_comment('${visible}',gen_random_uuid(),'${body}');`,
      true,
    );
  const visibleComment = createLegacyComment('Preserved visible comment');
  const hiddenComment = createLegacyComment('Preserved hidden comment');
  const deletedComment = createLegacyComment('Preserved deleted comment');
  userSql(
    ids.admin,
    `select public.community_moderate('comment','${hiddenComment}','hide','Preserved comment decision');`,
    true,
  );
  userSql(
    ids.reporter,
    `select public.community_delete('comment','${deletedComment}');
    select public.community_set_like('${visible}',true);
    select public.community_report('post','${visible}','Preserved distinct report');`,
    true,
  );
  const applicationPost = JSON.parse(
    userSql(
      ids.fan,
      `select public.board_ui_create('activity-rewards-upgrade',gen_random_uuid(),gen_random_uuid(),'${ids.artist}','Preserved application post','Preserved application body','{}'::uuid[],false,false);`,
      true,
    ),
  );
  const reservation = JSON.parse(
    psql(`begin; set local role service_role;
    select public.board_media_begin_upload('${ids.fan}','${ids.artist}',gen_random_uuid(),'image/png',100,gen_random_uuid()); commit;`),
  );
  psql(`begin; set local role service_role;
    select public.board_media_revoke_upload('${ids.fan}','${reservation.upload_id}'); commit;`);
  psql(`insert into storage.objects(id,bucket_id,name,metadata) values('${ids.object}','board-media','${ids.artist}/${visible}/${ids.image}.png','{"mimetype":"image/png","size":100}'::jsonb);
    begin; set local role service_role;
    select public.community_register_image('${ids.fan}','${visible}','${ids.image}','${ids.object}',100,80); commit;`);
  userSql(
    ids.reporter,
    `select public.community_update_comment('${visibleComment}','Preserved previously edited comment');
    select public.community_report('post','${pinned}','Preserved resolved report');`,
    true,
  );
  userSql(
    ids.admin,
    `select public.community_moderate('post','${pinned}','restore','Preserved completed review');`,
    true,
  );
  const applicationComment = JSON.parse(
    userSql(
      ids.fan,
      `select public.community_ui_create_comment('activity-rewards-upgrade',gen_random_uuid(),'${applicationPost.id}',gen_random_uuid(),'Preserved application comment');`,
      true,
    ),
  );
  psql(`insert into public.subscriptions(id,user_id,artist_id,provider,status,first_started_at,episode_started_at,current_period_start,current_period_end)
    values('${ids.subscription}','${ids.fan}','${ids.artist}','toss','expired',clock_timestamp()-interval '2 days',clock_timestamp()-interval '2 days',clock_timestamp()-interval '2 days',clock_timestamp()-interval '1 day');
    insert into public.messages(id,artist_id,author_id,type,body,status,scheduled_at,sent_at)
    values('${ids.message}','${ids.artist}','${ids.artistUser}','text','Preserved sent private message','sent',clock_timestamp()-interval '1 second',clock_timestamp()-interval '1 second');
    insert into public.replies(id,user_id,artist_id,subscription_id,body,message_id,is_blocked)
    values('${ids.reply}','${ids.fan}','${ids.artist}','${ids.subscription}','Preserved visible private reply','${ids.message}',false),
      ('${ids.blockedReply}','${ids.fan}','${ids.artist}','${ids.subscription}','Preserved send-policy blocked reply','${ids.message}',true);`);
  // Version 36 data is already real predecessor state: preserve its complete
  // reply moderation fields rather than stripping them as if newly additive.
  const replyReport = JSON.parse(
    userSql(
      ids.artistUser,
      `select public.community_moderation_report(gen_random_uuid(),'reply','${ids.reply}','Fictional preserved reply report');`,
      true,
    ),
  );
  const review = JSON.parse(
    userSql(ids.admin, 'select public.community_moderation_queue();'),
  ).reports.find((report) => report.id === replyReport.id);
  userSql(
    ids.admin,
    `select public.community_moderation_resolve(gen_random_uuid(),'${replyReport.id}',${review.target.revision},'delete','Fictional preserved decision',true);`,
    true,
  );
  const legacyAttendance = userSql(
    ids.fan,
    'select public.point_check_attendance();',
    true,
  );
  userSql(
    ids.admin,
    `select public.point_admin_adjust('${ids.fan}',gen_random_uuid(),-3,'Fictional private adjustment evidence');`,
    true,
  );
  psql(`insert into private.point_ledger(user_id,amount,reason,ref_id,earned_on,policy_version,policy_snapshot,actor_id,created_at)
    values('${ids.reporter}',7,'attendance','2001-01-02','2001-01-02','fictional-legacy-past','{"attendance_amount":7}','${ids.reporter}','2001-01-02T01:00:00Z');`);
  // Two old zero entries came from different predecessor policies. Migration
  // 37 must not pretend it can distinguish their outcomes retroactively.
  psql('update private.point_policy set post_amount=0;');
  const legacyZero = createLegacy('Preserved zero reward post');
  psql('update private.point_policy set post_amount=20,post_daily_cap=0;');
  const legacyCapped = createLegacy('Preserved capped reward post');
  psql('update private.point_policy set post_daily_cap=null;');
  // Attendance operation bindings already exist in migration 36. Populate and
  // compare them as predecessor state, not as newly added fields/storage.
  const attendanceOperation = crypto.randomUUID();
  const priorReceipt = JSON.parse(
    userSql(
      ids.fan,
      `select public.point_ui_check_attendance('${attendanceOperation}');`,
      true,
    ),
  );
  assert.equal(priorReceipt.entry_id, legacyAttendance);
  const before = snapshot();
  assert.equal(before.posts.length, 7);
  assert.equal(before.comments.length, 4);
  assert.equal(before.replies.length, 2);
  assert.equal(before.subscriptions.length, 1);
  assert.equal(before.messages.length, 1);
  assert.equal(before.images.length, 1);
  assert.equal(before.likes.length, 1);
  assert.equal(before.reports.length, 3);
  assert.equal(before.points.length, 14);
  assert.equal(before.notifications.length, 1);
  assert.equal(before.board_operations.length, 2);
  assert.equal(before.board_uploads.length, 1);
  assert.equal(before.moderation_operations.length, 2);
  assert.equal(before.attendance_operations.length, 1);
  assert.ok(before.moderation_notices.length > 0);
  assert.ok(before.settings.audit.length > 0);
  assert.equal(
    before.comments.find((c) => c.id === visibleComment).revision,
    2,
  );
  assert.equal(
    before.comments.find((c) => c.id === applicationComment.id).revision,
    1,
  );
  const deletedReply = before.replies.find((r) => r.id === ids.reply);
  assert.equal(deletedReply.is_hidden, true);
  assert.ok(deletedReply.deleted_at);
  assert.equal(deletedReply.report_count, 1);
  assert.ok(deletedReply.revision > 1);
  assert.equal(
    before.replies.find((r) => r.id === ids.blockedReply).is_blocked,
    true,
  );
  assert.equal(before.points.find((p) => p.post_id === legacyZero).amount, 0);
  assert.equal(before.points.find((p) => p.post_id === legacyCapped).amount, 0);
  execFileSync(localCli, ['migration', 'up', '--local'], { stdio: 'inherit' });
  assert.deepEqual(
    snapshot(),
    before,
    'Upgrade preserves every predecessor field including all ledger snapshots, zero entries, attendance bindings, moderation, source state and outbox.',
  );
  assert.equal(
    psql('select count(*) from private.point_activity_outcomes;'),
    '0',
    'New immutable outcomes start empty; predecessor rewards are never reclassified or backfilled.',
  );
  assert.equal(
    psql(
      "select count(*) from pg_attribute where attrelid='private.point_activity_outcomes'::regclass and attnum>0 and not attisdropped;",
    ),
    '2',
    'Only ledger entry identity and creation-time outcome are added in separate storage.',
  );
  const page = JSON.parse(
    userSql(ids.fan, 'select public.point_ui_activity(3);'),
  );
  assert.equal(page.actor_id, ids.fan);
  assert.equal(
    page.contribution_policy.version,
    before.point_policy[0].version,
  );
  assert.equal(page.contribution_policy.deleted_content_treatment, 'retain');
  assert.equal(page.share.configured, false);
  assert.equal(page.missions.configured, false);
  assert.equal(page.grade.configured, false);
  assert.equal(page.entries.length, 3);
  assert.ok(page.next_cursor);
  assert.deepEqual(Object.keys(page.entries[0]).sort(), [
    'amount',
    'created_at',
    'earned_on',
    'id',
    'outcome',
    'reason',
  ]);
  const seen = [];
  let current = page;
  while (true) {
    seen.push(...current.entries);
    if (!current.next_cursor) break;
    current = JSON.parse(
      userSql(
        ids.fan,
        `select public.point_ui_activity(3,'${current.next_cursor.created_at}','${current.next_cursor.id}');`,
      ),
    );
    assert.deepEqual(current.contribution_policy, page.contribution_policy);
  }
  const expectedIds = JSON.parse(
    psql(`select jsonb_agg(id order by created_at desc,id desc) from private.point_ledger
    where user_id='${ids.fan}' and reason in('post','comment');`),
  );
  assert.deepEqual(
    seen.map((entry) => entry.id),
    expectedIds,
    'Private cursor traversal includes every retained predecessor contribution exactly once.',
  );
  assert.ok(seen.every((entry) => entry.outcome === 'legacy'));
  for (const sourceId of [legacyZero, legacyCapped]) {
    const old = before.points.find((entry) => entry.post_id === sourceId);
    assert.equal(
      seen.find((entry) => entry.id === old.id).outcome,
      'legacy',
      'Missing historical evidence is not inferred from a zero amount or current policy.',
    );
  }
  for (const kind of ['post', 'comment']) {
    const entries = before.points.filter(
      (entry) =>
        entry.user_id === ids.fan &&
        entry.reason === kind &&
        entry.earned_on === page.kst_date,
    );
    assert.deepEqual(page.contribution_policy[kind], {
      amount: before.point_policy[0][`${kind}_amount`],
      daily_cap: null,
      used: entries.length,
      awarded: entries.filter((entry) => entry.amount > 0).length,
      remaining: null,
    });
  }
  const ownAdmin = JSON.parse(
    userSql(ids.admin, 'select public.point_ui_activity();'),
  );
  assert.deepEqual(
    ownAdmin.entries,
    [],
    "Administrator cannot see another actor's contribution history.",
  );
  assert.ok(
    !JSON.stringify(page).includes('Fictional private adjustment evidence'),
  );
  assert.deepEqual(
    snapshot(),
    before,
    'Current private reads preserve every predecessor field.',
  );
  assert.deepEqual(
    JSON.parse(
      userSql(
        ids.fan,
        `select public.point_ui_check_attendance('${attendanceOperation}');`,
        true,
      ),
    ),
    priorReceipt,
    'Existing immutable attendance operation still resolves to the identical predecessor receipt.',
  );
  assert.deepEqual(
    snapshot(),
    before,
    'Replaying predecessor attendance does not mutate or duplicate anything.',
  );
  const newPost = JSON.parse(
    userSql(
      ids.fan,
      `select public.board_ui_create('activity-rewards-upgrade',gen_random_uuid(),gen_random_uuid(),'${ids.artist}','New fictional rewarded post','New fictional body','{}'::uuid[],false,false);`,
      true,
    ),
  );
  psql('update private.point_policy set comment_daily_cap=0;');
  const newComment = JSON.parse(
    userSql(
      ids.fan,
      `select public.community_ui_create_comment('activity-rewards-upgrade',gen_random_uuid(),'${applicationPost.id}',gen_random_uuid(),'New fictional capped comment');`,
      true,
    ),
  );
  psql('update private.point_policy set comment_daily_cap=null,post_amount=0;');
  const newZeroPost = JSON.parse(
    userSql(
      ids.fan,
      `select public.board_ui_create('activity-rewards-upgrade',gen_random_uuid(),gen_random_uuid(),'${ids.artist}','New fictional zero post','New fictional body','{}'::uuid[],false,false);`,
      true,
    ),
  );
  psql('update private.point_policy set post_amount=20;');
  const outcomes = JSON.parse(
    psql(`select jsonb_agg(jsonb_build_object('ref',l.ref_id,'amount',l.amount,'outcome',o.outcome) order by l.ref_id)
    from private.point_activity_outcomes o join private.point_ledger l on l.id=o.entry_id;`),
  );
  assert.deepEqual(
    outcomes,
    [
      { ref: newPost.id, amount: 20, outcome: 'awarded' },
      { ref: newComment.id, amount: 0, outcome: 'daily_cap' },
      { ref: newZeroPost.id, amount: 0, outcome: 'zero_amount' },
    ].sort((left, right) => left.ref.localeCompare(right.ref)),
  );
  const after = snapshot();
  const oldEntryIds = new Set(before.points.map((entry) => entry.id));
  assert.equal(after.points.length, before.points.length + 3);
  assert.deepEqual(
    after.points.filter((entry) => oldEntryIds.has(entry.id)),
    before.points,
    'New source awards append entries but preserve every old ledger field, policy snapshot and adjustment note.',
  );
  assert.deepEqual(
    after.comments.filter((comment) => comment.id !== newComment.id),
    before.comments,
  );
  assert.deepEqual(
    after.posts.filter(
      (post) =>
        ![newPost.id, newZeroPost.id, applicationPost.id].includes(post.id),
    ),
    before.posts.filter((post) => post.id !== applicationPost.id),
  );
  const parentBefore = before.posts.find(
    (post) => post.id === applicationPost.id,
  );
  const parentAfter = after.posts.find(
    (post) => post.id === applicationPost.id,
  );
  assert.equal(parentAfter.comment_count, parentBefore.comment_count + 1);
  assert.equal(parentAfter.revision, parentBefore.revision + 1);
  for (const key of Object.keys(parentBefore).filter(
    (key) => !['comment_count', 'revision', 'updated_at'].includes(key),
  ))
    assert.deepEqual(
      parentAfter[key],
      parentBefore[key],
      `New comment preserves its parent ${key}.`,
    );
  const oldOperationIds = new Set(
    before.board_operations.map((operation) => operation.operation_id),
  );
  assert.deepEqual(
    after.board_operations.filter((operation) =>
      oldOperationIds.has(operation.operation_id),
    ),
    before.board_operations,
  );
  for (const key of Object.keys(before).filter(
    (key) =>
      !['points', 'posts', 'comments', 'board_operations', 'rates'].includes(
        key,
      ),
  ))
    assert.deepEqual(
      after[key],
      before[key],
      `Activity awards preserve unrelated ${key} state.`,
    );
  assert.equal(
    psql('select count(*) from private.point_activity_outcomes;'),
    '3',
  );
  assert.equal(
    psql('select count(*) from private.point_attendance_operations;'),
    '1',
  );
  console.info(
    'PASS: pre-00037 populated activity upgrade preserves 14 complete predecessor ledger rows and attendance receipt, adds empty outcome storage, retains honest legacy outcomes, and atomically appends awarded/capped/zero evidence without changing unrelated state.',
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
