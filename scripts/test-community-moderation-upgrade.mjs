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
    'replies',(select jsonb_agg(to_jsonb(r)-'revision'-'report_count'-'is_hidden'-'deleted_at' order by r.id) from public.replies r),
    'subscriptions',(select jsonb_agg(to_jsonb(s) order by s.id) from public.subscriptions s),
    'messages',(select jsonb_agg(to_jsonb(m) order by m.id) from public.messages m),
    'comments',(select jsonb_agg(to_jsonb(c) order by c.id) from public.comments c),
    'images',(select jsonb_agg(to_jsonb(i) order by i.id) from public.post_images i),
    'objects',(select jsonb_agg(to_jsonb(o) order by o.id) from storage.objects o),
    'likes',(select jsonb_agg(to_jsonb(l) order by l.post_id,l.user_id) from public.post_likes l),
    'reports',(select jsonb_agg(to_jsonb(r) order by r.id) from public.reports r),
    'moderation',(select jsonb_agg(to_jsonb(m) order by m.id) from public.community_moderation_log m),
    'rates',(select jsonb_agg(to_jsonb(r) order by r.user_id) from private.community_rate_limits r),
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
  fan: 'b4000000-0000-4000-8000-000000000001',
  admin: 'b4000000-0000-4000-8000-000000000002',
  artistUser: 'b4000000-0000-4000-8000-000000000003',
  reporter: 'b4000000-0000-4000-8000-000000000004',
  artist: 'b4000000-0000-4000-8000-000000000005',
  image: 'b4000000-0000-4000-8000-000000000006',
  object: 'b4000000-0000-4000-8000-000000000007',
  schedule: 'b4000000-0000-4000-8000-000000000008',
  device: 'b4000000-0000-4000-8000-000000000009',
  subscription: 'b4000000-0000-4000-8000-000000000010',
  message: 'b4000000-0000-4000-8000-000000000011',
  reply: 'b4000000-0000-4000-8000-000000000012',
  blockedReply: 'b4000000-0000-4000-8000-000000000013',
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
    ['db', 'reset', '--local', '--version', '20261025000034'],
    { stdio: 'inherit' },
  );
  psql(`insert into auth.users(id,email,raw_user_meta_data) values
    ('${ids.fan}','moderation-upgrade-fan@example.invalid','{}'),('${ids.admin}','moderation-upgrade-admin@example.invalid','{}'),
    ('${ids.artistUser}','moderation-upgrade-artist@example.invalid','{}'),('${ids.reporter}','moderation-upgrade-reporter@example.invalid','{}');
    update public.profiles set call_name='가상게시팬',onboarding_completed_at=clock_timestamp() where id::text like 'b4000000-%';
    update public.profiles set role='admin' where id='${ids.admin}';
    update public.profiles set role='artist' where id='${ids.artistUser}';
    insert into public.artists(id,slug,name,grade,status) values('${ids.artist}','moderation-upgrade','Fictional preserved board artist','B','active');
    insert into public.artist_members(artist_id,user_id) values('${ids.artist}','${ids.artistUser}');
    insert into private.community_policy(version,max_title_length,max_body_length,max_comment_length,max_reason_length,max_images,max_image_bytes,max_image_long_edge,
      auto_hide_report_count,rate_window_seconds,max_contributions_per_window,max_reports_per_window,forbidden_terms,forbidden_patterns)
    values('fictional-moderation-upgrade',100,1000,100,100,3,1048576,4096,3,60,1000,1000,'{}','{}');
    insert into private.point_policy(version,attendance_amount,post_amount,comment_amount,post_daily_cap,comment_daily_cap,deleted_content_treatment)
    values('fictional-moderation-upgrade',10,20,5,null,null,'retain');
    insert into private.admin_display_settings(singleton,page_size) values(true,23);
    insert into private.settlement_policies(artist_id,month,contract_from,contract_until,base_rate,performance_rate,vat_rate,pg_fee_rate)
    values('${ids.artist}','2028-02-01','2028-01-01','2029-01-01',0.3,0.4,0.1,0.03);
    insert into private.notification_policy(version,consent_version,webpush_enabled,max_attempts,retry_seconds,lease_seconds,schedule_lead_seconds)
    values('fictional-moderation-upgrade','fictional-moderation-upgrade',true,3,10,30,86400);
    insert into private.notification_preferences(user_id,webpush_enabled,new_message,billing,schedule)
    values('${ids.fan}',true,true,true,true);
    insert into private.push_subscriptions(id,user_id,endpoint,p256dh,auth,consent_version)
    values('${ids.device}','${ids.fan}','https://push.example.invalid/moderation-upgrade',repeat('B',87),repeat('A',22),'fictional-moderation-upgrade');
    insert into public.schedules(id,artist_id,type,status,title,starts_at,created_by)
    values('${ids.schedule}','${ids.artist}','event','draft','Preserved private event','2028-02-29T10:00:00+09:00','${ids.admin}');
    insert into private.notification_jobs(source_kind,source_id,schedule_id,user_id,device_id,route_kind,route_id,next_attempt_at,max_attempts,retry_seconds,lease_seconds,policy_version)
    values('schedule','${ids.schedule}','${ids.schedule}','${ids.fan}','${ids.device}','schedule','${ids.schedule}',clock_timestamp()+interval '1 day',3,10,30,'fictional-moderation-upgrade');`);
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
      `select public.board_ui_create('moderation-upgrade',gen_random_uuid(),gen_random_uuid(),'${ids.artist}','Preserved application post','Preserved application body','{}'::uuid[],false,false);`,
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
      `select public.community_ui_create_comment('moderation-upgrade',gen_random_uuid(),'${applicationPost.id}',gen_random_uuid(),'Preserved application comment');`,
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
  const before = snapshot();
  assert.equal(before.posts.length, 5);
  assert.equal(before.comments.length, 4);
  assert.equal(before.replies.length, 2);
  assert.equal(before.subscriptions.length, 1);
  assert.equal(before.messages.length, 1);
  assert.equal(before.images.length, 1);
  assert.equal(before.likes.length, 1);
  assert.equal(before.reports.length, 2);
  assert.equal(before.points.length, 9);
  assert.equal(before.notifications.length, 1);
  assert.equal(before.board_operations.length, 2);
  assert.equal(before.board_uploads.length, 1);
  assert.equal(before.board_uploads[0].state, 'revoked');
  assert.equal(before.settings.display[0].page_size, 23);
  assert.ok(before.settings.audit.length > 0);
  assert.equal(
    before.comments.find((c) => c.id === visibleComment).revision,
    2,
  );
  assert.equal(
    before.comments.find((c) => c.id === applicationComment.id).revision,
    1,
  );
  execFileSync(localCli, ['migration', 'up', '--local'], { stdio: 'inherit' });
  assert.deepEqual(
    snapshot(),
    before,
    'Upgrade preserves every populated source byte including existing report decisions, send-policy blocks, comment revisions, private replies, profiles, policies, outbox and operation receipts.',
  );
  assert.equal(
    psql(
      'select count(*) from public.replies where revision=1 and report_count=0 and not is_hidden and deleted_at is null;',
    ),
    '2',
    'Legacy replies initialize only additive moderation fields without fabricating edits.',
  );
  assert.equal(
    psql('select count(*) from private.moderation_operations;'),
    '0',
    'Upgrade invents no moderation success receipts.',
  );
  assert.equal(
    psql('select count(*) from private.moderation_notices;'),
    '0',
    'Prior terminal reports are not backfilled into new recipient notifications.',
  );
  const queue = JSON.parse(
    userSql(ids.admin, 'select public.community_moderation_queue();'),
  );
  assert.equal(queue.actor_id, ids.admin);
  assert.equal(queue.reports.length, 2);
  assert.deepEqual(
    new Set(queue.reports.map((r) => r.status)),
    new Set(['open', 'restored']),
  );
  const pending = queue.reports.find((r) => r.status === 'open');
  assert.equal(pending.target_id, visible);
  assert.equal(pending.target.body, '  Preserved legacy\nbody  ');
  assert.equal(pending.target.owner.id, ids.fan);
  assert.equal(pending.target.owner.is_restricted, false);
  assert.equal(
    pending.target.revision,
    before.posts.find((p) => p.id === visible).revision,
  );
  const context = JSON.parse(
    userSql(
      ids.reporter,
      `select public.community_moderation_context('post','${visible}');`,
    ),
  );
  assert.equal(context.actor_id, ids.reporter);
  assert.equal(context.existing_report.id, pending.id);
  assert.equal(context.existing_report.status, 'open');
  const artistView = JSON.parse(
    userSql(
      ids.artistUser,
      "select public.artist_reply_activity_context('moderation-upgrade');",
    ),
  );
  assert.deepEqual(
    artistView.replies.map((r) => r.id),
    [ids.reply],
  );
  assert.equal(artistView.replies[0].body, 'Preserved visible private reply');
  assert.deepEqual(
    snapshot(),
    before,
    'Read-only moderation and artist projections preserve pre-migration source bytes.',
  );
  const operation = crypto.randomUUID();
  const sql = `select public.community_moderation_resolve('${operation}','${pending.id}',${pending.target.revision},'restore','Fictional upgraded review',true);`;
  const receipt = JSON.parse(userSql(ids.admin, sql, true));
  assert.equal(receipt.report_id, pending.id);
  assert.equal(receipt.decision, 'restore');
  assert.deepEqual(
    JSON.parse(userSql(ids.admin, sql, true)),
    receipt,
    'Exact operation replay returns the immutable receipt.',
  );
  assert.equal(
    psql(
      `select count(*) from private.moderation_notices where report_id='${pending.id}';`,
    ),
    '1',
  );
  const ownNotices = JSON.parse(
    userSql(ids.reporter, 'select public.community_moderation_notices();'),
  );
  assert.equal(ownNotices.actor_id, ids.reporter);
  assert.equal(ownNotices.notices.length, 1);
  assert.deepEqual(Object.keys(ownNotices.notices[0]).sort(), [
    'created_at',
    'decision',
    'id',
    'report_id',
  ]);
  assert.equal(ownNotices.notices[0].decision, 'restored');
  assert.equal(
    JSON.parse(
      userSql(ids.fan, 'select public.community_moderation_notices();'),
    ).notices.length,
    0,
    'Content owner cannot read confidential reporter notices.',
  );
  const replyReport = JSON.parse(
    userSql(
      ids.artistUser,
      `select public.community_moderation_report(gen_random_uuid(),'reply','${ids.reply}','Fictional reply report');`,
      true,
    ),
  );
  assert.equal(replyReport.target_id, ids.reply);
  assert.equal(
    psql(`select report_count from public.replies where id='${ids.reply}';`),
    '1',
  );
  const currentQueue = JSON.parse(
    userSql(ids.admin, 'select public.community_moderation_queue();'),
  );
  const replyCase = currentQueue.reports.find((r) => r.id === replyReport.id);
  assert.equal(replyCase.target.body, 'Preserved visible private reply');
  const deleteReply = JSON.parse(
    userSql(
      ids.admin,
      `select public.community_moderation_resolve(gen_random_uuid(),'${replyReport.id}',${replyCase.target.revision},'delete','Fictional reply removal',true);`,
      true,
    ),
  );
  assert.equal(deleteReply.decision, 'delete');
  assert.equal(
    psql(
      `select is_hidden and deleted_at is not null and not is_blocked from public.replies where id='${ids.reply}';`,
    ),
    't',
    'Moderation hides/deletes reply without rewriting original send-policy block evidence.',
  );
  assert.equal(
    JSON.parse(
      userSql(
        ids.artistUser,
        "select public.artist_reply_activity_context('moderation-upgrade');",
      ),
    ).replies.length,
    0,
  );
  assert.equal(
    psql(
      `select is_blocked and not is_hidden and deleted_at is null from public.replies where id='${ids.blockedReply}';`,
    ),
    't',
    'Preexisting send-policy blocked reply remains unchanged.',
  );
  const after = snapshot();
  for (const key of [
    'comments',
    'images',
    'objects',
    'likes',
    'points',
    'point_policy',
    'profiles',
    'artists',
    'members',
    'content',
    'calendar_audit',
    'schedules',
    'settings',
    'settlement_policy',
    'notification_policy',
    'notification_preferences',
    'push',
    'notifications',
    'board_operations',
    'board_uploads',
    'subscriptions',
    'messages',
  ])
    assert.deepEqual(
      after[key],
      before[key],
      `Moderation validation preserves unrelated ${key} source state.`,
    );
  assert.equal(
    psql('select count(*) from private.point_ledger;'),
    '9',
    'Moderation creates no additional points or reward reversals.',
  );
  console.info(
    'PASS: pre-00035 populated moderation upgrade preserves original fields, initializes only additive reply state, retains legacy moderation decisions and private blocks, verifies real report/resolve/replay and recipient-only notices without changing outbox, policy, rewards or unrelated source state.',
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
