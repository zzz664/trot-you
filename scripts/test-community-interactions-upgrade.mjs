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
    'comments',(select jsonb_agg(to_jsonb(c)-'revision' order by c.id) from public.comments c),
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
  fan: 'b3900000-0000-4000-8000-000000000001',
  admin: 'b3900000-0000-4000-8000-000000000002',
  artistUser: 'b3900000-0000-4000-8000-000000000003',
  reporter: 'b3900000-0000-4000-8000-000000000004',
  artist: 'b3900000-0000-4000-8000-000000000005',
  image: 'b3900000-0000-4000-8000-000000000006',
  object: 'b3900000-0000-4000-8000-000000000007',
  schedule: 'b3900000-0000-4000-8000-000000000008',
  device: 'b3900000-0000-4000-8000-000000000009',
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
    ['db', 'reset', '--local', '--version', '20261025000033'],
    { stdio: 'inherit' },
  );
  psql(`insert into auth.users(id,email,raw_user_meta_data) values
    ('${ids.fan}','interactions-upgrade-fan@example.invalid','{}'),('${ids.admin}','interactions-upgrade-admin@example.invalid','{}'),
    ('${ids.artistUser}','interactions-upgrade-artist@example.invalid','{}'),('${ids.reporter}','interactions-upgrade-reporter@example.invalid','{}');
    update public.profiles set call_name='가상게시팬',onboarding_completed_at=clock_timestamp() where id::text like 'b3900000-%';
    update public.profiles set role='admin' where id='${ids.admin}';
    update public.profiles set role='artist' where id='${ids.artistUser}';
    insert into public.artists(id,slug,name,grade,status) values('${ids.artist}','interactions-upgrade','Fictional preserved board artist','B','active');
    insert into public.artist_members(artist_id,user_id) values('${ids.artist}','${ids.artistUser}');
    insert into private.community_policy(version,max_title_length,max_body_length,max_comment_length,max_reason_length,max_images,max_image_bytes,max_image_long_edge,
      auto_hide_report_count,rate_window_seconds,max_contributions_per_window,max_reports_per_window,forbidden_terms,forbidden_patterns)
    values('fictional-interactions-upgrade',100,1000,100,100,3,1048576,4096,3,60,1000,1000,'{}','{}');
    insert into private.point_policy(version,attendance_amount,post_amount,comment_amount,post_daily_cap,comment_daily_cap,deleted_content_treatment)
    values('fictional-interactions-upgrade',10,20,5,null,null,'retain');
    insert into private.admin_display_settings(singleton,page_size) values(true,23);
    insert into private.settlement_policies(artist_id,month,contract_from,contract_until,base_rate,performance_rate,vat_rate,pg_fee_rate)
    values('${ids.artist}','2028-02-01','2028-01-01','2029-01-01',0.3,0.4,0.1,0.03);
    insert into private.notification_policy(version,consent_version,webpush_enabled,max_attempts,retry_seconds,lease_seconds,schedule_lead_seconds)
    values('fictional-interactions-upgrade','fictional-interactions-upgrade',true,3,10,30,86400);
    insert into private.notification_preferences(user_id,webpush_enabled,new_message,billing,schedule)
    values('${ids.fan}',true,true,true,true);
    insert into private.push_subscriptions(id,user_id,endpoint,p256dh,auth,consent_version)
    values('${ids.device}','${ids.fan}','https://push.example.invalid/interactions-upgrade',repeat('B',87),repeat('A',22),'fictional-interactions-upgrade');
    insert into public.schedules(id,artist_id,type,status,title,starts_at,created_by)
    values('${ids.schedule}','${ids.artist}','event','draft','Preserved private event','2028-02-29T10:00:00+09:00','${ids.admin}');
    insert into private.notification_jobs(source_kind,source_id,schedule_id,user_id,device_id,route_kind,route_id,next_attempt_at,max_attempts,retry_seconds,lease_seconds,policy_version)
    values('schedule','${ids.schedule}','${ids.schedule}','${ids.fan}','${ids.device}','schedule','${ids.schedule}',clock_timestamp()+interval '1 day',3,10,30,'fictional-interactions-upgrade');`);
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
      `select public.board_ui_create('interactions-upgrade',gen_random_uuid(),gen_random_uuid(),'${ids.artist}','Preserved application post','Preserved application body','{}'::uuid[],false,false);`,
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
  const before = snapshot();
  assert.equal(before.posts.length, 5);
  assert.equal(before.comments.length, 3);
  assert.equal(before.images.length, 1);
  assert.equal(before.likes.length, 1);
  assert.equal(before.reports.length, 1);
  assert.equal(before.points.length, 8);
  assert.equal(before.notifications.length, 1);
  assert.equal(before.board_operations.length, 1);
  assert.equal(before.board_uploads.length, 1);
  assert.equal(before.board_uploads[0].state, 'revoked');
  assert.equal(before.settings.display[0].page_size, 23);
  assert.ok(before.settings.audit.length > 0);
  execFileSync(localCli, ['migration', 'up', '--local'], { stdio: 'inherit' });
  assert.deepEqual(
    snapshot(),
    before,
    'Upgrade preserves every populated source byte, including prior post revisions, comment timestamps, counters, images, receipts, reservations, rewards, policies and unrelated notifications.',
  );
  assert.equal(
    psql('select count(*) from public.comments where revision=1;'),
    '3',
    'All legacy comments initialize additive CAS tokens without fabricated edits.',
  );
  assert.equal(
    psql('select count(*) from private.board_operations;'),
    '1',
    'Upgrade creates no synthetic interaction success receipts.',
  );
  const listing = JSON.parse(
    userSql(ids.fan, "select public.board_ui_list('interactions-upgrade');"),
  );
  assert.deepEqual(
    listing.posts.map((p) => p.id),
    [pinned, applicationPost.id, visible],
  );
  const interactions = JSON.parse(
    userSql(
      ids.reporter,
      `select public.community_ui_interactions('interactions-upgrade','${visible}');`,
    ),
  );
  assert.equal(interactions.actor_id, ids.reporter);
  assert.equal(interactions.post_id, visible);
  assert.equal(interactions.comment_count, 1);
  assert.equal(interactions.like_count, 1);
  assert.equal(interactions.liked, true);
  assert.equal(interactions.policy.max_comment_length, 100);
  assert.equal(interactions.next_cursor, null);
  assert.deepEqual(
    interactions.comments.map((c) => c.id),
    [visibleComment],
  );
  assert.equal(interactions.comments[0].body, 'Preserved visible comment');
  assert.equal(interactions.comments[0].revision, 1);
  assert.equal(interactions.comments[0].is_owner, true);
  assert.deepEqual(interactions.comments[0].author, {
    call_name: '가상게시팬',
  });
  assert.equal(Object.hasOwn(interactions.comments[0], 'user_id'), false);
  assert.equal(Object.hasOwn(interactions.comments[0], 'request_id'), false);
  const otherView = JSON.parse(
    userSql(
      ids.fan,
      `select public.community_ui_interactions('interactions-upgrade','${visible}');`,
    ),
  );
  assert.equal(otherView.liked, false);
  assert.equal(otherView.comments[0].is_owner, false);
  assert.deepEqual(
    snapshot(),
    before,
    'Current-account interaction reads preserve every pre-migration source and receipt byte.',
  );
  userSql(
    ids.reporter,
    `select public.community_update_comment('${visibleComment}','Preserved legacy edit after upgrade');`,
    true,
  );
  assert.equal(
    psql(`select revision from public.comments where id='${visibleComment}';`),
    '2',
    'Legacy comment edits invalidate newly exposed CAS tokens.',
  );
  const edited = JSON.parse(
    userSql(
      ids.reporter,
      `select public.community_ui_update_comment('interactions-upgrade',gen_random_uuid(),'${visible}','${visibleComment}',2,'Preserved explicit new edit');`,
    ),
  );
  assert.equal(edited.id, visibleComment);
  assert.equal(edited.revision, 3);
  const liked = JSON.parse(
    userSql(
      ids.fan,
      `select public.community_ui_set_like('interactions-upgrade',gen_random_uuid(),'${visible}',true);`,
    ),
  );
  assert.equal(liked.liked, true);
  const deletedResult = JSON.parse(
    userSql(
      ids.reporter,
      `select public.community_ui_delete_comment('interactions-upgrade',gen_random_uuid(),'${visible}','${visibleComment}',2,true);`,
    ),
  );
  assert.equal(deletedResult.deleted, true);
  assert.equal(
    psql(`select comment_count from public.posts where id='${visible}';`),
    '1',
    'Rolled-back verification preserves original visible counts.',
  );
  assert.equal(
    psql('select count(*) from private.board_operations;'),
    '1',
    'Rolled-back new operations preserve the existing receipt population.',
  );
  assert.equal(
    psql('select count(*) from private.point_ledger;'),
    '8',
    'Upgrade and edit/delete validation do not fabricate or rewrite existing rewards.',
  );
  console.info(
    'PASS: pre-00034 populated interaction upgrade preserves all source bytes and existing board receipts, reservations, counters, rewards, audits, policies and unrelated state; safe comment/like reads and legacy CAS invalidation verified.',
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
