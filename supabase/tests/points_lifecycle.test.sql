begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

-- Fictional rollback-only data. Points are nonmonetary application records;
-- these tests never contact a payment provider, real account or notification.
create temporary table points_context(key text primary key,id uuid,stamp timestamptz);
grant all on points_context to authenticated;
insert into auth.users(id,email,raw_user_meta_data)
select ('b1000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid,
 'points-lifecycle-' || n || '@example.invalid','{}'::jsonb from generate_series(1,8) n;
update public.profiles set call_name='가상 포인트 사용자',onboarding_completed_at=now()
 where id::text like 'b1000000-%';
update public.profiles set role='admin' where id='b1000000-0000-4000-8000-000000000003';
update public.profiles set role='artist' where id='b1000000-0000-4000-8000-000000000004';
insert into public.artists(id,slug,name,grade,status) values
 ('b2000000-0000-4000-8000-000000000001','points-lifecycle-active','가상 포인트 가수','B','active');
insert into private.community_policy(version,max_title_length,max_body_length,max_comment_length,max_reason_length,
 max_images,max_image_bytes,max_image_long_edge,auto_hide_report_count,rate_window_seconds,
 max_contributions_per_window,max_reports_per_window,forbidden_terms,forbidden_patterns)
values ('fictional-community-policy',100,1000,100,100,3,10485760,2048,3,60,100,100,array['blockedword'],array[]::text[]);
select is((select count(*) from private.point_policy),0::bigint,'point policy is not activated by migration or seed');
select is((select count(*) from private.point_ledger),0::bigint,'migration and seed do not invent point awards');
select set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000001',true);
set local role authenticated;
select is(public.point_balance(),0::bigint,'new caller has a real zero balance without a cached balance row');
select is((select count(*) from public.point_history()),0::bigint,'new caller has empty private history');
select is((select rewards_configured from public.point_capabilities()),false,'absent policy is explicit unavailable capability');
select is((select share_configured or missions_configured or grades_configured from public.point_capabilities()),false,
 'share verification, missions and grades remain explicitly unconfigured');
select throws_ok($$select public.point_check_attendance()$$,'55000',null,'attendance fails closed without approved policy');
insert into points_context(key,id) values ('legacy',public.community_create_post(
 'b2000000-0000-4000-8000-000000000001','b3000000-0000-4000-8000-000000000001','기존 글','정책 이전 내용'));
select is(public.point_balance(),0::bigint,'community still works without silently assigning draft reward amounts');
reset role;
select is((select count(*) from private.point_ledger),0::bigint,'policy-absent content produces no hidden reward or claim');
insert into private.point_policy(version,attendance_amount,post_amount,comment_amount,
 post_daily_cap,comment_daily_cap,deleted_content_treatment)
values ('fictional-points-v1',10,20,5,2,2,'retain');
set local role authenticated;
select is((select rewards_configured from public.point_capabilities()),true,'explicit policy activates supported reward capability');
select is((select share_configured or missions_configured or grades_configured from public.point_capabilities()),false,
 'reward policy never silently activates unresolved share, mission or grade formulas');
select is(public.community_create_post('b2000000-0000-4000-8000-000000000001',
 'b3000000-0000-4000-8000-000000000001','기존 글','정책 이전 내용'),
 (select id from points_context where key='legacy'),'old content retry keeps its original identity after policy activation');
select is(public.point_balance(),0::bigint,'activation does not retroactively award a policy-absent action');
insert into points_context(key,id) values('attendance',public.point_check_attendance());
select is(public.point_check_attendance(),(select id from points_context where key='attendance'),
 'duplicate attendance returns the same immutable identity');
select is(public.point_balance(),10::bigint,'attendance credits exactly the configured amount once');
select is((select count(*) from public.point_history()),1::bigint,'duplicate attendance produces only one history row');
select is((select reason::text from public.point_history()),'attendance','attendance history states the actual reason');
select is((select ref_id from public.point_history()),(clock_timestamp() at time zone 'Asia/Seoul')::date::text,
 'attendance canonical reference uses the server KST date');
select is((select earned_on from public.point_history()),(clock_timestamp() at time zone 'Asia/Seoul')::date,
 'attendance earned day does not use the caller timezone');
select is((select policy_version from public.point_history()),'fictional-points-v1','award keeps the policy version actually applied');
set local timezone='America/Los_Angeles';
select is(public.point_check_attendance(),(select id from points_context where key='attendance'),
 'changing session timezone cannot claim a second KST attendance');
set local timezone='UTC';

insert into points_context(key,id) values('post1',public.community_create_post(
 'b2000000-0000-4000-8000-000000000001','b3000000-0000-4000-8000-000000000002','첫 보상 글','내용'));
select is(public.point_balance(),30::bigint,'persisted eligible post and configured reward commit together');
select is(public.community_create_post('b2000000-0000-4000-8000-000000000001',
 'b3000000-0000-4000-8000-000000000002','첫 보상 글','내용'),(select id from points_context where key='post1'),
 'same post request returns canonical content identity');
select is(public.point_balance(),30::bigint,'post replay cannot double credit');
select throws_ok($$select public.community_create_post('b2000000-0000-4000-8000-000000000001',
 'b3000000-0000-4000-8000-000000000002','위조 재시도','내용')$$,'23514',null,
 'conflicting payload cannot reuse a rewarded request');
select is(public.point_balance(),30::bigint,'conflicting retry has no reward side effect');
select lives_ok($$select public.community_update_post((select id from points_context where key='post1'),'수정 글','수정 내용')$$,
 'eligible content can still be edited');
select is(public.point_balance(),30::bigint,'editing content is not a new rewarded action');
insert into points_context(key,id) values('post2',public.community_create_post(
 'b2000000-0000-4000-8000-000000000001','b3000000-0000-4000-8000-000000000003','둘째 보상 글','내용'));
insert into points_context(key,id) values('post3',public.community_create_post(
 'b2000000-0000-4000-8000-000000000001','b3000000-0000-4000-8000-000000000004','상한 뒤 글','내용'));
select is(public.point_balance(),50::bigint,'only the first two post actions earn under explicit daily count cap');
select is((select amount from public.point_history() where ref_id=(select id::text from points_context where key='post3')),0::bigint,
 'over-cap successful action gets a canonical zero-point ledger entry');
select is((select count(*) from public.point_history() where reason='post'),3::bigint,
 'cap does not hide the completed third action or leave it available for a later claim');
insert into points_context(key,id) values('comment1',public.community_create_comment(
 (select id from points_context where key='post2'),'b3000000-0000-4000-8000-000000000005','첫 댓글'));
select is(public.point_balance(),55::bigint,'persisted eligible comment and reward commit atomically');
select is(public.community_create_comment((select id from points_context where key='post2'),
 'b3000000-0000-4000-8000-000000000005','첫 댓글'),(select id from points_context where key='comment1'),
 'comment creation retry returns its canonical identity');
select is(public.point_balance(),55::bigint,'comment retry never duplicates the reward');
select lives_ok($$select public.community_update_comment((select id from points_context where key='comment1'),'수정 댓글')$$,
 'comment edit remains possible');
select is(public.point_balance(),55::bigint,'comment edit does not mint another reward');
insert into points_context(key,id) values('comment2',public.community_create_comment(
 (select id from points_context where key='post2'),'b3000000-0000-4000-8000-000000000006','둘째 댓글'));
insert into points_context(key,id) values('comment3',public.community_create_comment(
 (select id from points_context where key='post2'),'b3000000-0000-4000-8000-000000000007','상한 뒤 댓글'));
select is(public.point_balance(),60::bigint,'comment cap is separate from post cap and attendance');
select is((select amount from public.point_history() where ref_id=(select id::text from points_context where key='comment3')),0::bigint,
 'over-cap comment is recorded once with zero points');
reset role;
select is((select count(*) from private.point_ledger where reason='post' and post_id is not null and comment_id is null),3::bigint,
 'post reward ledger has retained concrete source foreign keys');
select is((select count(*) from private.point_ledger where reason='comment' and comment_id is not null),3::bigint,
 'comment reward ledger has retained concrete source foreign keys');
select is((select count(*) from private.point_ledger where user_id<>actor_id),0::bigint,
 'ordinary rewards derive the actor from the persisted authenticated action');
select is((select policy_snapshot->>'post_amount' from private.point_ledger where ref_id=(select id::text from points_context where key='post1')),'20',
 'ledger snapshots actual policy amount, not only a mutable version label');
select is((select policy_snapshot->>'post_daily_cap' from private.point_ledger where ref_id=(select id::text from points_context where key='post1')),'2',
 'ledger snapshots explicit daily cap used for its decision');
update private.point_policy set version='fictional-points-v2',attendance_amount=7,post_amount=11,comment_amount=3,
 post_daily_cap=null,comment_daily_cap=null;
select is((select policy_snapshot->>'post_amount' from private.point_ledger where ref_id=(select id::text from points_context where key='post1')),'20',
 'changing live policy leaves historical numeric snapshot intact');
set local role authenticated;
select is(public.point_check_attendance(),(select id from points_context where key='attendance'),
 'policy changes do not replace an already completed attendance');
select is((select amount from public.point_history() where reason='attendance'),10::bigint,
 'attendance historical amount is never recomputed from new policy');
select is((select policy_version from public.point_history() where reason='attendance'),'fictional-points-v1',
 'attendance keeps original policy snapshot after update');
select is(public.community_create_post('b2000000-0000-4000-8000-000000000001',
 'b3000000-0000-4000-8000-000000000004','상한 뒤 글','내용'),(select id from points_context where key='post3'),
 'an over-cap post is still the same action after cap removal');
select is((select amount from public.point_history() where ref_id=(select id::text from points_context where key='post3')),0::bigint,
 'cap removal cannot retroactively upgrade an old zero award');
insert into points_context(key,id) values('post4',public.community_create_post(
 'b2000000-0000-4000-8000-000000000001','b3000000-0000-4000-8000-000000000008','새 정책 글','내용'));
select is(public.point_balance(),71::bigint,'explicit NULL cap means uncapped only in an approved complete policy');
select is((select policy_version from public.point_history() where ref_id=(select id::text from points_context where key='post4')),
 'fictional-points-v2','new action snapshots the new policy version');
select lives_ok($$select public.community_delete('post',(select id from points_context where key='post1'))$$,
 'owner may soft-delete previously rewarded content');
select is(public.point_balance(),71::bigint,'explicit retain treatment does not invent deletion clawbacks');
select lives_ok($$select public.community_delete('comment',(select id from points_context where key='comment1'))$$,
 'owner may soft-delete rewarded comment');
select is(public.point_balance(),71::bigint,'comment deletion retains its immutable reward');
select set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000003',true);
select lives_ok($$select public.community_moderate('post',(select id from points_context where key='post2'),'hide','가상 검토')$$,
 'administrator may hide rewarded content independently of the ledger');
select set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000001',true);
select is(public.point_balance(),71::bigint,'moderation hiding does not mutate earned points');
select throws_ok($$select public.community_create_comment((select id from points_context where key='post2'),
 'b3000000-0000-4000-8000-000000000009','숨김 부모 우회')$$,'42501',null,
 'ineligible hidden-parent action cannot mint points');
select is(public.point_balance(),71::bigint,'failed content creation never credits points');
select set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000003',true);
select lives_ok($$select public.community_moderate('post',(select id from points_context where key='post2'),'restore','가상 복구')$$,
 'restoration can restore visibility without recreating content');
select set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000001',true);
select is(public.point_balance(),71::bigint,'restoring content is not another reward action');

-- Corrections are signed ledger entries with actor, request identity and note,
-- not UPDATE balance, payout, redemption or a financial-provider operation.
select set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000003',true);
insert into points_context(key,id) values('adjust',public.point_admin_adjust(
 'b1000000-0000-4000-8000-000000000001','b4000000-0000-4000-8000-000000000001',9,'가상 관리자 정정'));
select is(public.point_admin_adjust('b1000000-0000-4000-8000-000000000001',
 'b4000000-0000-4000-8000-000000000001',9,'가상 관리자 정정'),(select id from points_context where key='adjust'),
 'same administrator correction request is idempotent');
select throws_ok($$select public.point_admin_adjust('b1000000-0000-4000-8000-000000000001',
 'b4000000-0000-4000-8000-000000000001',10,'가상 관리자 정정')$$,'23514',null,
 'correction request cannot be replayed with another amount');
select throws_ok($$select public.point_admin_adjust('b1000000-0000-4000-8000-000000000002',
 'b4000000-0000-4000-8000-000000000001',9,'가상 관리자 정정')$$,'23514',null,
 'correction request cannot be moved to another target');
select throws_ok($$select public.point_admin_adjust('b1000000-0000-4000-8000-000000000001',
 'b4000000-0000-4000-8000-000000000001',9,'변경된 정정 이유')$$,'23514',null,
 'correction request cannot silently replace its audit reason');
select is(public.point_balance(),0::bigint,'administrator balance query still means own balance, not target balance');
select is((select count(*) from public.point_history()),0::bigint,'correction operator cannot list another user ledger');
reset role;
select is((select actor_id from private.point_ledger where id=(select id from points_context where key='adjust')),
 'b1000000-0000-4000-8000-000000000003'::uuid,'correction audit actor is the authoritative administrator');
select is((select adjustment_note from private.point_ledger where id=(select id from points_context where key='adjust')),
 '가상 관리자 정정','correction audit reason is retained with the immutable entry');
select is((select count(*) from private.point_ledger where reason='admin_adjust'),1::bigint,
 'failed or replayed corrections do not create extra audit entries');
set local role authenticated;
select set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000001',true);
select is(public.point_balance(),80::bigint,'target sees exactly one successful correction');
select ok((select ref_id not like '%b1000000-0000-4000-8000-000000000003%' from public.point_history() where reason='admin_adjust'),
 'safe correction history never reveals the private administrator identity in its reference');
select ok((select to_jsonb(h) ? 'adjustment_note' = false and to_jsonb(h) ? 'actor_id' = false from public.point_history() h where reason='admin_adjust'),
 'safe history projection omits private correction note and administrator identity');
select set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000003',true);
select lives_ok($$select public.point_admin_adjust('b1000000-0000-4000-8000-000000000001',
 'b4000000-0000-4000-8000-000000000002',-80,'가상 차감 정정')$$,'correction can reduce balance exactly to zero');
select throws_ok($$select public.point_admin_adjust('b1000000-0000-4000-8000-000000000001',
 'b4000000-0000-4000-8000-000000000003',-1,'음수 잔액 시도')$$,'22003',null,'correction cannot create a negative balance');
select set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000001',true);
select is(public.point_balance(),0::bigint,'rejected underflow leaves the exact prior balance');
select is((select count(*) from public.point_history() where reason='admin_adjust'),2::bigint,
 'both successful credit and debit remain in the append-only history');

-- Pagination uses (created_at,id), not a timestamp-only cursor or another user.
reset role;
create temporary table expected_point_history as select id,created_at from private.point_ledger
 where user_id='b1000000-0000-4000-8000-000000000001';
grant select on expected_point_history to authenticated;
set local role authenticated;
select results_eq($$select id from public.point_history(100)$$,
 $$select id from expected_point_history order by created_at desc,id desc$$,
 'own history returns complete deterministic newest-first ordering');
select is((select count(*) from public.point_history(1)),1::bigint,'history obeys requested page size');
insert into points_context(key,id,stamp) select 'cursor',id,created_at from public.point_history(1);
select results_eq($$select id from public.point_history(100,
 (select stamp from points_context where key='cursor'),(select id from points_context where key='cursor'))$$,
 $$select id from expected_point_history where (created_at,id)<
 ((select stamp from points_context where key='cursor'),(select id from points_context where key='cursor'))
 order by created_at desc,id desc$$,'history cursor is exclusive and tie-breaks by immutable ID');
select set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000002',true);
select is(public.point_balance(),0::bigint,'another identity does not inherit a previous caller balance');
select is((select count(*) from public.point_history(100,
 (select stamp from points_context where key='cursor'),(select id from points_context where key='cursor'))),0::bigint,
 'another user cursor cannot leak the cursor owner history');

-- Explicit zero amounts and zero caps still consume the canonical action.
reset role;
update private.point_policy set version='fictional-zero-policy',attendance_amount=0,post_daily_cap=0,comment_daily_cap=0;
set local role authenticated;
insert into points_context(key,id) values('zero-attendance',public.point_check_attendance());
select is(public.point_check_attendance(),(select id from points_context where key='zero-attendance'),
 'zero-point attendance is completed once, not left available to replay');
select is(public.point_balance(),0::bigint,'zero configured attendance never falls back to draft amount');
insert into points_context(key,id) values('zero-post',public.community_create_post(
 'b2000000-0000-4000-8000-000000000001','b3000000-0000-4000-8000-000000000010','영점 글','내용'));
select is(public.point_balance(),0::bigint,'explicit zero post cap awards no points');
select is((select count(*) from public.point_history()),2::bigint,'zero awards retain both attendance and content evidence');
select lives_ok($$select public.community_create_comment((select id from points_context where key='zero-post'),
 'b3000000-0000-4000-8000-000000000011','영점 댓글')$$,'zero comment cap does not prevent valid content creation');
select is(public.point_balance(),0::bigint,'explicit zero comment cap awards no points');
select is((select count(*) from public.point_history()),3::bigint,'zero comment award is still recorded');
reset role;
update private.point_policy set version='fictional-points-unlimited',attendance_amount=10,post_amount=20,
 comment_amount=5,post_daily_cap=null,comment_daily_cap=null;
set local role authenticated;
select is(public.point_check_attendance(),(select id from points_context where key='zero-attendance'),
 'later positive policy cannot claim an already zero-completed day');
select is(public.point_balance(),0::bigint,'policy upgrade never mutates the original zero award');

-- JavaScript-safe integer ceiling is structural, not a spending or reward cap.
select set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000003',true);
select lives_ok($$select public.point_admin_adjust('b1000000-0000-4000-8000-000000000008',
 'b4000000-0000-4000-8000-000000000004',9007199254740991,'구조 상한 정정')$$,
 'largest supported nonnegative balance is represented exactly');
select throws_ok($$select public.point_admin_adjust('b1000000-0000-4000-8000-000000000008',
 'b4000000-0000-4000-8000-000000000005',1,'상한 초과 시도')$$,'22003',null,
 'one point above structural maximum fails atomically');
select set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000008',true);
select is(public.point_balance(),9007199254740991::bigint,'overflow refusal leaves exact maximum balance');
select throws_ok($$select public.point_check_attendance()$$,'22003',null,'attendance cannot overflow maximum balance');
select throws_ok($$select public.community_create_post('b2000000-0000-4000-8000-000000000001',
 'b3000000-0000-4000-8000-000000000012','상한 실패 글','내용')$$,'22003',null,
 'reward overflow rolls back the entire content creation transaction');
select is((select count(*) from public.posts where request_id='b3000000-0000-4000-8000-000000000012'),0::bigint,
 'failed atomic reward leaves no persisted unrewarded post');
select is((select count(*) from public.point_history()),1::bigint,'failed attendance and post leave no phantom entries');
reset role;
select is((select count(*) from private.community_rate_limits where user_id='b1000000-0000-4000-8000-000000000008'),0::bigint,
 'failed content reward also rolls back contribution-rate consumption');
select throws_like($$delete from auth.users where id='b1000000-0000-4000-8000-000000000008'$$,'%violates%foreign key constraint%',
 'account deletion cannot cascade away immutable point evidence');
select throws_like($$delete from public.posts where id=(select id from points_context where key='post4')$$,'%violates%foreign key constraint%',
 'physical source deletion cannot orphan its concrete reward evidence');

-- Deactivation blocks new awards, never removes existing history or prevents
-- an authenticated administrator from recording a necessary audited correction.
set local role service_role;
delete from private.point_policy;
reset role;
select set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000001',true);
set local role authenticated;
select is((select rewards_configured from public.point_capabilities()),false,'trusted deactivation immediately reports unavailable rewards');
select is(public.point_check_attendance(),(select id from points_context where key='attendance'),
 'deactivation still permits a safe same-day completed attendance replay');
select is((select count(*) from public.point_history()),10::bigint,'deactivation does not delete or conceal already earned history');
select set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000008',true);
select throws_ok($$select public.point_check_attendance()$$,'55000',null,'deactivation blocks a not-yet-completed attendance');
select set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000002',true);
select lives_ok($$select public.community_create_post('b2000000-0000-4000-8000-000000000001',
 'b3000000-0000-4000-8000-000000000013','비활성 정책 글','내용')$$,
 'deactivation preserves community operation without silent rewards');
select is(public.point_balance(),0::bigint,'deactivated policy does not reuse previous positive amounts');
select is((select count(*) from public.point_history()),3::bigint,'deactivated creation does not invent an award claim for backfill');
select set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000003',true);
select lives_ok($$select public.point_admin_adjust('b1000000-0000-4000-8000-000000000001',
 'b4000000-0000-4000-8000-000000000006',1,'비활성 정책 관리자 정정')$$,
 'audited correction remains available without an active earning policy');
-- Enough real correction calls to prove the default and explicit page bounds.
do $$begin
 for n in 1..35 loop
  perform public.point_admin_adjust('b1000000-0000-4000-8000-000000000001',gen_random_uuid(),1,'가상 페이지 검사 정정');
 end loop;
end$$;
select set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000001',true);
select is((select count(*) from public.point_history()),30::bigint,'omitted history limit defaults to thirty rather than unbounded data');
select is((select count(*) from public.point_history(100)),46::bigint,'explicit bounded larger page returns all caller rows');
select is(public.point_balance(),36::bigint,'paging never changes the actual append-only balance');
reset role;

-- Explicit historical zero-value fixtures isolate equal timestamps. This is
-- owner-only fixture data, not an application insertion or arbitrary claim API.
insert into private.point_ledger(id,user_id,amount,reason,ref_id,earned_on,policy_version,policy_snapshot,actor_id,created_at)
select ('b5000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 'b1000000-0000-4000-8000-000000000007',0,'attendance',('2025-01-01'::date+n)::text,
 '2025-01-01'::date+n,'fictional-pagination-fixture','{"fixture":"pagination-only"}',
 'b1000000-0000-4000-8000-000000000007','2025-01-10 00:00:00Z'
from generate_series(1,3) n;
select set_config('request.jwt.claim.sub','b1000000-0000-4000-8000-000000000007',true);
set local role authenticated;
select is((select id from public.point_history(1)), 'b5000000-0000-4000-8000-000000000003'::uuid,
 'same-timestamp history orders newest ID first deterministically');
select results_eq($$select id from public.point_history(10,'2025-01-10 00:00:00Z','b5000000-0000-4000-8000-000000000003')$$,
 $$values ('b5000000-0000-4000-8000-000000000002'::uuid),('b5000000-0000-4000-8000-000000000001'::uuid)$$,
 'exclusive compound cursor retains every tied row exactly once');
reset role;
select * from finish();
rollback;
