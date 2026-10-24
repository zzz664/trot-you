begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

-- No real users, hosted project, financial provider, blob, reward or notification.
-- Every data/policy fixture is local and rolled back at the end of this suite.
create temporary table community_test_context (key text primary key, id uuid, stamp timestamptz);
grant all on community_test_context to authenticated, service_role;
insert into auth.users(id, email, raw_user_meta_data)
select ('93000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  'community-lifecycle-' || n || '@example.invalid', '{}'::jsonb
from generate_series(1, 9) n;
update public.profiles set call_name = '안전한 가상 이름', onboarding_completed_at = now();
update public.profiles set role = 'artist' where id = '93000000-0000-4000-8000-000000000006';
update public.profiles set role = 'admin' where id = '93000000-0000-4000-8000-000000000007';
update public.profiles set is_restricted = true, restricted_until = now() + interval '1 day'
  where id = '93000000-0000-4000-8000-000000000008';
update public.profiles set is_restricted = true, restricted_until = now() - interval '1 second'
  where id = '93000000-0000-4000-8000-000000000009';
insert into public.artists(id, slug, name, grade, status) values
 ('94000000-0000-4000-8000-000000000001','community-lifecycle-active','가상 게시판 가수','B','active'),
 ('94000000-0000-4000-8000-000000000002','community-lifecycle-paused','가상 중지 가수','B','paused');

select set_config('request.jwt.claim.sub','93000000-0000-4000-8000-000000000001',true);
set local role authenticated;
select throws_ok($$select public.community_create_post('94000000-0000-4000-8000-000000000001',
  '95000000-0000-4000-8000-000000000001','제목','내용')$$,
  '55000','COMMUNITY_POLICY_REQUIRED','creating a post fails closed when policy is absent');
reset role;
insert into private.community_policy(version,max_title_length,max_body_length,max_comment_length,max_reason_length,
  max_images,max_image_bytes,max_image_long_edge,auto_hide_report_count,rate_window_seconds,
  max_contributions_per_window,max_reports_per_window,forbidden_terms,forbidden_patterns)
values ('fictional-test-policy-v1',100,1000,100,100,3,10485760,2048,3,60,100,100,array['blockedword'],array['[0-9]{3}-[0-9]{4}-[0-9]{4}']);
set local role authenticated;
insert into community_test_context(key,id) values ('post', public.community_create_post(
  '94000000-0000-4000-8000-000000000001','95000000-0000-4000-8000-000000000001','첫 제목','첫 내용'));
select is((select count(*) from public.subscriptions),0::bigint,
  'community board access does not accidentally require a paid subscription');
select is((select user_id from public.posts where id=(select id from community_test_context where key='post')),
  '93000000-0000-4000-8000-000000000001'::uuid,'post author is the authenticated caller');
select is(public.community_create_post('94000000-0000-4000-8000-000000000001',
  '95000000-0000-4000-8000-000000000001','첫 제목','첫 내용'),
  (select id from community_test_context where key='post'),'same post request and payload is idempotent');
select throws_ok($$select public.community_create_post('94000000-0000-4000-8000-000000000001',
  '95000000-0000-4000-8000-000000000001','충돌 제목','첫 내용')$$,
  '23514','COMMUNITY_IDEMPOTENCY_CONFLICT','same request key cannot silently change post payload');
select lives_ok($$select public.community_update_post((select id from community_test_context where key='post'),
  '수정 제목','수정 내용')$$,'author may update visible own post');
select is((select title from public.posts where id=(select id from community_test_context where key='post')),
  '수정 제목','post edit persists');
select is((select count(*) from public.posts),1::bigint,'retry did not create a duplicate post');

select set_config('request.jwt.claim.sub','93000000-0000-4000-8000-000000000002',true);
select is((select count(*) from public.posts),1::bigint,'another authenticated fan can read the active board');
select throws_ok($$select public.community_update_post((select id from community_test_context where key='post'),
  '위조 수정','위조 내용')$$,'42501',null,'another fan cannot edit the author post');
select throws_ok($$select public.community_set_notice((select id from community_test_context where key='post'),true,true)$$,
  '42501',null,'a fan cannot create or pin administrator notices');
select is(public.community_set_like((select id from community_test_context where key='post'),true),true,
  'first desired-state like succeeds');
select is(public.community_set_like((select id from community_test_context where key='post'),true),true,
  'repeated desired-state like does not toggle off');
select is((select like_count from public.posts where id=(select id from community_test_context where key='post')),1,
  'duplicate like does not increment the counter');
select is((select count(*) from public.post_likes),1::bigint,'liker can inspect own like only');
select is(public.community_set_like((select id from community_test_context where key='post'),false),false,
  'desired-state unlike removes the like');
select is(public.community_set_like((select id from community_test_context where key='post'),false),false,
  'repeated unlike is idempotent');
select is((select like_count from public.posts where id=(select id from community_test_context where key='post')),0,
  'unlike counter never underflows');

insert into community_test_context(key,id) values ('comment',public.community_create_comment(
  (select id from community_test_context where key='post'),'95000000-0000-4000-8000-000000000002','댓글 내용'));
select is(public.community_create_comment((select id from community_test_context where key='post'),
  '95000000-0000-4000-8000-000000000002','댓글 내용'),
  (select id from community_test_context where key='comment'),'same comment request is idempotent');
select throws_ok($$select public.community_create_comment((select id from community_test_context where key='post'),
  '95000000-0000-4000-8000-000000000002','다른 댓글')$$,
  '23514','COMMUNITY_IDEMPOTENCY_CONFLICT','comment request key rejects conflicting payload');
select is((select comment_count from public.posts where id=(select id from community_test_context where key='post')),1,
  'one distinct visible comment contributes exactly once');
select lives_ok($$select public.community_update_comment((select id from community_test_context where key='comment'),
  '수정 댓글')$$,'comment author can update own comment');
select is((select body from public.comments where id=(select id from community_test_context where key='comment')),
  '수정 댓글','comment edit persists without creating another comment');
select set_config('request.jwt.claim.sub','93000000-0000-4000-8000-000000000001',true);
select throws_ok($$select public.community_update_comment((select id from community_test_context where key='comment'),
  '게시글 소유자 위조')$$,'42501',null,'post ownership does not authorize editing another fan comment');
select throws_ok($$select public.community_delete('comment',(select id from community_test_context where key='comment'))$$,
  '42501',null,'post ownership does not authorize deleting another fan comment');
select is((select count(*) from public.post_likes),0::bigint,'post owner cannot identify unrelated likers');

-- Three distinct reporters cause a single automatic hide, not three calls by one fan.
select set_config('request.jwt.claim.sub','93000000-0000-4000-8000-000000000003',true);
insert into community_test_context(key,id) values ('report',public.community_report('post',
  (select id from community_test_context where key='post'),'가상 신고 사유'));
select is(public.community_report('post',(select id from community_test_context where key='post'),'가상 신고 사유'),
  (select id from community_test_context where key='report'),'duplicate reporter gets the original report identity');
select is((select report_count from public.posts where id=(select id from community_test_context where key='post')),1,
  'report counter counts distinct reporter identities, not attempts');
select is((select is_hidden from public.posts where id=(select id from community_test_context where key='post')),false,
  'below-threshold content remains visible');
select set_config('request.jwt.claim.sub','93000000-0000-4000-8000-000000000004',true);
select lives_ok($$select public.community_report('post',(select id from community_test_context where key='post'),'두 번째 신고')$$,
  'second distinct reporter can report');
select is((select report_count from public.posts where id=(select id from community_test_context where key='post')),2,
  'second distinct report increments exactly once');
select set_config('request.jwt.claim.sub','93000000-0000-4000-8000-000000000005',true);
select lives_ok($$select public.community_report('post',(select id from community_test_context where key='post'),'세 번째 신고')$$,
  'threshold-reaching report succeeds atomically');
select is((select count(*) from public.posts where id=(select id from community_test_context where key='post')),0::bigint,
  'threshold-reaching hidden post is immediately invisible to the reporter');
select is((select count(*) from public.comments where id=(select id from community_test_context where key='comment')),0::bigint,
  'comments under a hidden parent cannot leak through a direct table read');
select is((select status::text from public.reports where reporter_id=auth.uid()),'hidden',
  'reporter status is synchronized with automatic hiding');
select throws_ok($$select public.community_set_like((select id from community_test_context where key='post'),true)$$,
  '42501',null,'hidden parent cannot receive a new like');
select throws_ok($$select public.community_create_comment((select id from community_test_context where key='post'),
  '95000000-0000-4000-8000-000000000003','숨김 우회')$$,'42501',null,
  'hidden parent cannot receive a new comment');
select set_config('request.jwt.claim.sub','93000000-0000-4000-8000-000000000001',true);
select is((select report_count from public.posts where id=(select id from community_test_context where key='post')),3,
  'owner retains limited visibility of own hidden content and its count');
select is((select count(*) from public.reports),0::bigint,'content owner cannot identify confidential reporters');
select set_config('request.jwt.claim.sub','93000000-0000-4000-8000-000000000002',true);
select is((select count(*) from public.comments where id=(select id from community_test_context where key='comment')),1::bigint,
  'comment author retains own comment visibility under a hidden parent');
select throws_ok($$select public.community_moderate('post',(select id from community_test_context where key='post'),
  'restore','관리자 위조')$$,'42501',null,'ordinary member cannot restore hidden content');

select set_config('request.jwt.claim.sub','93000000-0000-4000-8000-000000000007',true);
select lives_ok($$select public.community_moderate('post',(select id from community_test_context where key='post'),
  'restore','검토 완료')$$,'administrator may restore a hidden post');
select is((select is_hidden from public.posts where id=(select id from community_test_context where key='post')),false,
  'restore makes post visible again');
select is((select count(*) from public.reports where target_id=(select id from community_test_context where key='post')
  and status='restored' and resolved_by=auth.uid() and resolved_at is not null),3::bigint,
  'restore updates every report on the target with accountable resolver metadata');
select lives_ok($$select public.community_set_notice((select id from community_test_context where key='post'),true,true)$$,
  'administrator can designate and pin a notice');
select is((select is_notice and is_pinned from public.posts where id=(select id from community_test_context where key='post')),true,
  'notice and pinned state are stored atomically');
select lives_ok($$select public.community_set_notice((select id from community_test_context where key='post'),false,false)$$,
  'administrator can remove notice and pin state');
select throws_ok($$select public.community_set_notice((select id from community_test_context where key='post'),false,true)$$,
  '23514',null,'a non-notice cannot remain pinned');

-- Restoring resolves the pending cycle but preserves lifetime dedupe evidence.
select set_config('request.jwt.claim.sub','93000000-0000-4000-8000-000000000003',true);
select is(public.community_report('post',(select id from community_test_context where key='post'),'중복 재신고'),
  (select id from community_test_context where key='report'),'restoring never permits the same reporter to count again');
select set_config('request.jwt.claim.sub','93000000-0000-4000-8000-000000000002',true);
select lives_ok($$select public.community_report('post',(select id from community_test_context where key='post'),'새 신고자')$$,
  'a new distinct reporter may begin the next review cycle');
select is((select report_count from public.posts where id=(select id from community_test_context where key='post')),4,
  'lifetime report counter is retained after restoration');
select is((select is_hidden from public.posts where id=(select id from community_test_context where key='post')),false,
  'resolved prior reports do not immediately rehide a restored post');
select throws_ok($$select public.community_report('comment',(select id from community_test_context where key='comment'),'자기 신고')$$,
  '42501',null,'content owner cannot manufacture self reports');
select set_config('request.jwt.claim.sub','93000000-0000-4000-8000-000000000003',true);
select lives_ok($$select public.community_report('comment',(select id from community_test_context where key='comment'),'댓글 신고1')$$,
  'first distinct comment reporter succeeds');
select set_config('request.jwt.claim.sub','93000000-0000-4000-8000-000000000004',true);
select lives_ok($$select public.community_report('comment',(select id from community_test_context where key='comment'),'댓글 신고2')$$,
  'second distinct comment reporter succeeds');
select set_config('request.jwt.claim.sub','93000000-0000-4000-8000-000000000005',true);
select lives_ok($$select public.community_report('comment',(select id from community_test_context where key='comment'),'댓글 신고3')$$,
  'threshold-reaching comment report succeeds');
select is((select comment_count from public.posts where id=(select id from community_test_context where key='post')),0,
  'automatic comment hide decrements visible parent counter once');
select is((select count(*) from public.comments where id=(select id from community_test_context where key='comment')),0::bigint,
  'auto-hidden comment disappears from unrelated reporter reads');
select set_config('request.jwt.claim.sub','93000000-0000-4000-8000-000000000007',true);
select lives_ok($$select public.community_moderate('comment',(select id from community_test_context where key='comment'),'restore','댓글 검토 완료')$$,
  'administrator can resolve and restore auto-hidden comment');
select is((select comment_count from public.posts where id=(select id from community_test_context where key='post')),1,
  'auto-hidden comment restoration increments parent count once');

-- Comment visibility counter must follow moderation and idempotent deletion.
select lives_ok($$select public.community_moderate('comment',(select id from community_test_context where key='comment'),
  'hide','댓글 검토')$$,'administrator can hide a comment');
select is((select comment_count from public.posts where id=(select id from community_test_context where key='post')),0,
  'hidden comment no longer contributes to visible comment_count');
select lives_ok($$select public.community_moderate('comment',(select id from community_test_context where key='comment'),
  'hide','댓글 검토')$$,'repeated hide is idempotent');
select is((select comment_count from public.posts where id=(select id from community_test_context where key='post')),0,
  'repeated hide does not decrement twice');
select lives_ok($$select public.community_moderate('comment',(select id from community_test_context where key='comment'),
  'restore','댓글 복구')$$,'administrator can restore a hidden comment');
select is((select comment_count from public.posts where id=(select id from community_test_context where key='post')),1,
  'restored comment contributes exactly once');
select set_config('request.jwt.claim.sub','93000000-0000-4000-8000-000000000002',true);
select lives_ok($$select public.community_delete('comment',(select id from community_test_context where key='comment'))$$,
  'comment author can soft-delete own comment');
select lives_ok($$select public.community_delete('comment',(select id from community_test_context where key='comment'))$$,
  'repeated owner deletion is idempotent');
select is((select deleted_at is not null from public.comments where id=(select id from community_test_context where key='comment')),true,
  'soft-delete preserves comment evidence for its owner');
select is((select comment_count from public.posts where id=(select id from community_test_context where key='post')),0,
  'deleted comment count never underflows');
select set_config('request.jwt.claim.sub','93000000-0000-4000-8000-000000000007',true);
select throws_ok($$select public.community_moderate('comment',(select id from community_test_context where key='comment'),
  'restore','삭제 복구 시도')$$,'55000',null,'deleted content cannot be resurrected by restore');

select set_config('request.jwt.claim.sub','93000000-0000-4000-8000-000000000001',true);
select lives_ok($$select public.community_delete('post',(select id from community_test_context where key='post'))$$,
  'post author can soft-delete own post');
select lives_ok($$select public.community_delete('post',(select id from community_test_context where key='post'))$$,
  'repeated post deletion is idempotent');
select is((select deleted_at is not null from public.posts where id=(select id from community_test_context where key='post')),true,
  'post soft-delete retains author history');
select set_config('request.jwt.claim.sub','93000000-0000-4000-8000-000000000003',true);
select is((select count(*) from public.posts),0::bigint,'deleted post is unavailable to another fan');
select is((select status::text from public.reports where target_id=(select id from community_test_context where key='post')),
  'deleted','owner deletion synchronizes prior report status without deleting report evidence');
select throws_ok($$select public.community_report('reply','96000000-0000-4000-8000-000000000001','미구현 답장 신고')$$,
  '0A000','COMMUNITY_REPLY_REPORT_UNSUPPORTED','reply enum does not falsely advertise implemented reply moderation');
select throws_ok($$select public.community_report('post','96000000-0000-4000-8000-000000000001','없는 글')$$,
  '42501',null,'report rejects a nonexistent target without creating orphan evidence');

reset role;
select is((select count(*) from public.reports),7::bigint,'deletion preserves distinct post and comment report evidence');
select is((select count(*) from public.posts),1::bigint,'soft-delete never physically deletes content rows');
select is((select count(*) from public.comments),1::bigint,'soft-delete never physically deletes comment rows');
select * from finish();
rollback;
