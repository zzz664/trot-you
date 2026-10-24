begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

-- SQL-role/JWT fixtures test database authorization, not JWT verification or
-- a real user session. All policy/account/ledger data is rolled back.
create temporary table points_security_context(key text primary key,id uuid);
grant all on points_security_context to authenticated,anon,service_role;
insert into auth.users(id,email,raw_user_meta_data)
select ('c1000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid,
 'points-security-' || n || '@example.invalid','{}'::jsonb from generate_series(1,7) n;
update public.profiles set call_name='가상 권한 사용자',onboarding_completed_at=now()
 where id::text like 'c1000000-%';
update public.profiles set role='admin' where id='c1000000-0000-4000-8000-000000000003';
update public.profiles set role='artist' where id='c1000000-0000-4000-8000-000000000004';
update public.profiles set onboarding_completed_at=null where id='c1000000-0000-4000-8000-000000000005';
update public.profiles set is_restricted=true,restricted_until=now()+interval '1 day'
 where id='c1000000-0000-4000-8000-000000000006';
update public.profiles set is_restricted=true,restricted_until=now()-interval '1 second'
 where id='c1000000-0000-4000-8000-000000000007';
insert into public.artists(id,slug,name,grade,status) values
 ('c2000000-0000-4000-8000-000000000001','points-security-active','가상 권한 가수','B','active');
insert into private.community_policy(version,max_title_length,max_body_length,max_comment_length,max_reason_length,
 max_images,max_image_bytes,max_image_long_edge,auto_hide_report_count,rate_window_seconds,
 max_contributions_per_window,max_reports_per_window,forbidden_terms,forbidden_patterns)
values ('fictional-community-policy',100,1000,100,100,3,10485760,2048,3,60,100,100,array[]::text[],array[]::text[]);

select ok((select bool_and(relrowsecurity) from pg_class where oid in
 ('private.point_policy'::regclass,'private.point_ledger'::regclass)),'private point tables enable row-level security');
select ok((select bool_and(not has_table_privilege(r,'private.point_ledger','SELECT,INSERT,UPDATE,DELETE,TRUNCATE'))
 from unnest(array['anon','authenticated','service_role']) r),
 'no application role can read or forge point ledger rows directly');
select ok((select bool_and(not has_table_privilege(r,'private.point_policy','SELECT,INSERT,UPDATE,DELETE,TRUNCATE'))
 from unnest(array['anon','authenticated']) r),'clients cannot read or activate reward policy');
select ok(has_table_privilege('service_role','private.point_policy','SELECT,INSERT,UPDATE,DELETE'),
 'only trusted settings integration can explicitly activate, revise or deactivate policy');
select ok((select bool_and(not has_function_privilege(r,p.oid,'EXECUTE'))
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 cross join unnest(array['anon','service_role']) r
 where n.nspname='public' and p.proname like 'point\_%' escape '\'),
 'anonymous and service roles cannot impersonate authenticated point RPC callers');
select ok((select bool_and(p.prosecdef and 'search_path=""'=any(p.proconfig))
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname like 'point\_%' escape '\'),
 'all public point privilege boundaries pin an empty search_path');
select ok((select bool_and(not has_function_privilege(r,p.oid,'EXECUTE'))
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 cross join unnest(array['anon','authenticated','service_role']) r
 where n.nspname='private' and (p.proname like 'point\_%' escape '\' or p.proname in ('append_point_entry','reward_community_creation'))),
 'private point helpers cannot be called as arbitrary-actor minting APIs');
select is((select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname in ('point_balance','point_check_attendance','point_capabilities')
 and p.pronargs=0),3::bigint,'caller-only summary, attendance and capability RPCs take no target or clock input');
select is((select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname like 'point\_%' escape '\'
 and (p.proname ilike '%share%' or p.proname ilike '%mission%' or p.proname ilike '%claim%')),0::bigint,
 'unverified shares, missions and arbitrary action references have no award API');

-- Date conversion is the exact helper invoked by production awards, not a
-- reimplementation in the test. No public RPC accepts an arbitrary clock.
select is(private.point_kst_date('2028-02-28 14:59:59.999999Z'),'2028-02-28'::date,
 'KST attendance stays on previous date one microsecond before midnight');
select is(private.point_kst_date('2028-02-28 15:00:00Z'),'2028-02-29'::date,
 'KST attendance changes at exact leap-day midnight');
select is(private.point_kst_date('2028-02-29 15:00:00Z'),'2028-03-01'::date,
 'KST leap-month boundary advances exactly once');
set local timezone='America/Los_Angeles';
select is(private.point_kst_date('2028-03-12 09:59:59Z'),'2028-03-12'::date,
 'KST date is independent of session timezone before US daylight saving change');
select is(private.point_kst_date('2028-03-12 10:00:00Z'),'2028-03-12'::date,
 'US daylight saving change does not alter KST attendance bucket');
set local timezone='UTC';

-- Complete policy, including deliberate NULL (uncapped), must be explicit.
select throws_ok($$insert into private.point_policy(version,attendance_amount,post_amount,comment_amount,
 post_daily_cap,comment_daily_cap,deleted_content_treatment) values ('bad-negative',-1,20,5,null,null,'retain')$$,
 '23514',null,'negative ordinary reward policy is invalid');
select throws_ok($$insert into private.point_policy(version,attendance_amount,post_amount,comment_amount,
 post_daily_cap,comment_daily_cap,deleted_content_treatment) values ('bad-overflow',9007199254740992,20,5,null,null,'retain')$$,
 '23514',null,'ordinary reward policy cannot exceed exact supported integer range');
select throws_ok($$insert into private.point_policy(version,attendance_amount,post_amount,comment_amount,
 post_daily_cap,comment_daily_cap,deleted_content_treatment) values ('',10,20,5,null,null,'retain')$$,
 '23514',null,'empty policy version cannot erase reward provenance');
select throws_ok($$insert into private.point_policy(version,attendance_amount,post_amount,comment_amount,
 post_daily_cap,comment_daily_cap,deleted_content_treatment) values ('bad-cap',10,20,5,-1,null,'retain')$$,
 '23514',null,'negative daily action cap is invalid');
select throws_ok($$insert into private.point_policy(version,attendance_amount,post_amount,comment_amount,
 post_daily_cap,comment_daily_cap,deleted_content_treatment) values ('bad-comment-cap',10,20,5,null,-1,'retain')$$,
 '23514',null,'negative comment cap is invalid');
select throws_ok($$insert into private.point_policy(version,attendance_amount,post_amount,comment_amount,
 post_daily_cap,comment_daily_cap,deleted_content_treatment) values ('unapproved-clawback',10,20,5,null,null,'clawback')$$,
 '23514',null,'unsupported deletion treatment cannot silently activate clawbacks');
select throws_ok($$insert into private.point_policy(version,attendance_amount,post_amount,comment_amount,
 post_daily_cap,comment_daily_cap,deleted_content_treatment) values ('missing-treatment',10,20,5,null,null,null)$$,
 '23502',null,'deletion treatment cannot be implicitly omitted as NULL');
select throws_ok($$insert into private.point_policy(version,attendance_amount,post_amount,comment_amount,
 post_daily_cap,comment_daily_cap,deleted_content_treatment) values ('missing-amount',null,20,5,null,null,'retain')$$,
 '23502',null,'missing attendance amount has no silent draft fallback');
insert into private.point_policy(version,attendance_amount,post_amount,comment_amount,
 post_daily_cap,comment_daily_cap,deleted_content_treatment)
values ('fictional-security-policy',10,20,5,null,null,'retain');
select set_config('request.jwt.claim.sub','c1000000-0000-4000-8000-000000000001',true);
set local role authenticated;
insert into points_security_context values('attendance',public.point_check_attendance());
select is(public.point_balance(),10::bigint,'authorized user can earn actual configured attendance');
select throws_ok($$select * from private.point_ledger$$,'42501',null,'even owner cannot bypass safe history projection');
select throws_ok($$insert into private.point_ledger(user_id,amount,reason,ref_id,earned_on,policy_version,actor_id,policy_snapshot)
 values (auth.uid(),999999,'attendance','forged',current_date,'forged',auth.uid(),'{}')$$,'42501',null,
 'ordinary user cannot mint arbitrary points or claim a client reference');
select throws_ok($$update private.point_ledger set amount=999999$$,'42501',null,'ordinary user cannot overwrite earned amount');
select throws_ok($$delete from private.point_ledger$$,'42501',null,'ordinary user cannot erase point history');
select throws_ok($$truncate private.point_ledger$$,'42501',null,'ordinary user cannot truncate point history');
select throws_ok($$select * from private.point_policy$$,'42501',null,'ordinary user cannot inspect private policy snapshot');
select throws_ok($$update private.point_policy set attendance_amount=999999$$,'42501',null,
 'ordinary user cannot replace reward policy');
select throws_ok($$select private.point_kst_date(now())$$,'42501',null,'internal clock helper is not exposed to clients');
select throws_ok($$select public.point_admin_adjust('c1000000-0000-4000-8000-000000000001',
 gen_random_uuid(),100,'팬 위조 보상')$$,'42501',null,'fan cannot call administrative correction');
select throws_ok($$update public.profiles set role='admin' where id=auth.uid()$$,'42501',null,
 'point feature does not allow direct profile role escalation');
select set_config('request.jwt.claims','{"role":"admin","user_role":"admin"}',true);
select throws_ok($$select public.point_admin_adjust('c1000000-0000-4000-8000-000000000001',
 gen_random_uuid(),100,'JWT 역할 위조')$$,'42501',null,'claimed administrator metadata does not override authoritative profile');
select throws_ok($$insert into public.posts(artist_id,user_id,request_id,title,body)
 values ('c2000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000002',
 gen_random_uuid(),'가짜 실제 행동','다른 사람 위조')$$,'42501',null,
 'client cannot forge a persisted actor-owned source to trigger points');
select is(public.point_balance(),10::bigint,'all forgery attempts leave caller balance unchanged');
select set_config('request.jwt.claim.sub','c1000000-0000-4000-8000-000000000002',true);
select is(public.point_balance(),0::bigint,'another fan cannot read the first fan balance');
select is((select count(*) from public.point_history()),0::bigint,'another fan cannot enumerate first fan history');

-- Bound and type errors are rejected, never silently transformed into an
-- unbounded query or a timestamp-only cursor that drops tied rows.
select throws_ok($$select * from public.point_history(0)$$,null::text,null::text,'zero history limit is rejected');
select throws_ok($$select * from public.point_history(-1)$$,null::text,null::text,'negative history limit is rejected');
select throws_ok($$select * from public.point_history(101)$$,null::text,null::text,'history page cannot exceed structural 100-row bound');
select throws_ok($$select * from public.point_history(null)$$,null::text,null::text,'NULL history page limit cannot request all records');
select throws_ok($$select * from public.point_history(10,now(),null)$$,null::text,null::text,
 'timestamp-only cursor without ID is rejected');
select throws_ok($$select * from public.point_history(10,null,gen_random_uuid())$$,null::text,null::text,
 'ID-only cursor without timestamp is rejected');
select throws_ok($$select * from public.point_history(10,'infinity',gen_random_uuid())$$,null::text,null::text,
 'infinite cursor timestamp is rejected');
select throws_ok($$select * from public.point_history(10,'-infinity',gen_random_uuid())$$,null::text,null::text,
 'negative-infinite cursor timestamp is rejected');

select set_config('request.jwt.claim.sub','c1000000-0000-4000-8000-000000000005',true);
select throws_ok($$select public.point_check_attendance()$$,'42501',null,'unonboarded fan cannot earn attendance');
select throws_ok($$select public.point_balance()$$,'42501',null,'unonboarded fan cannot bypass point-summary eligibility');
select throws_ok($$select * from public.point_history()$$,'42501',null,'unonboarded fan cannot read history');
select throws_ok($$select * from public.point_capabilities()$$,'42501',null,'capability API also enforces onboarding');
select set_config('request.jwt.claim.sub','c1000000-0000-4000-8000-000000000006',true);
select throws_ok($$select public.point_check_attendance()$$,'42501',null,'current restriction blocks attendance');
select throws_ok($$select public.point_balance()$$,'42501',null,'current restriction blocks point summary');
select throws_ok($$select * from public.point_history()$$,'42501',null,'current restriction blocks point history');
select throws_ok($$select * from public.point_capabilities()$$,'42501',null,'current restriction blocks point capabilities');
select throws_ok($$select public.community_create_post('c2000000-0000-4000-8000-000000000001',
 gen_random_uuid(),'제한 중 글','보상 우회')$$,'42501',null,'restriction prevents the persisted action used for post rewards');
select set_config('request.jwt.claim.sub','c1000000-0000-4000-8000-000000000007',true);
select lives_ok($$select public.point_check_attendance()$$,'expired restriction restores attendance automatically');
select is(public.point_balance(),10::bigint,'expired restriction caller receives configured reward normally');
select set_config('request.jwt.claim.sub','c1000000-0000-4000-8000-000000000004',true);
select lives_ok($$select public.point_check_attendance()$$,'artist account follows eligible user attendance contract');
select is(public.point_balance(),10::bigint,'artist may see only their own earned balance');
select throws_ok($$select public.point_admin_adjust('c1000000-0000-4000-8000-000000000001',
 gen_random_uuid(),100,'가수 권한 위조')$$,'42501',null,'artist role alone does not grant arbitrary correction');

select set_config('request.jwt.claim.sub','c1000000-0000-4000-8000-000000000003',true);
select is(public.point_balance(),0::bigint,'administrator summary has no privileged cross-user default');
select is((select count(*) from public.point_history()),0::bigint,'administrator does not inherit visibility of other ledgers');
select throws_ok($$select * from private.point_ledger$$,'42501',null,'administrator client still cannot read base ledger');
select throws_ok($$select public.point_admin_adjust(null,gen_random_uuid(),1,'가상 사유')$$,
 null::text,null::text,'correction requires a concrete target');
select throws_ok($$select public.point_admin_adjust('c1000000-0000-4000-8000-000000000001',null,1,'가상 사유')$$,
 null::text,null::text,'NULL correction reference cannot mint duplicate unkeyed adjustments');
select throws_ok($$select public.point_admin_adjust('c1000000-0000-4000-8000-000000000001',gen_random_uuid(),null,'가상 사유')$$,
 null::text,null::text,'correction amount is required');
select throws_ok($$select public.point_admin_adjust('c1000000-0000-4000-8000-000000000001',gen_random_uuid(),0,'가상 사유')$$,
 null::text,null::text,'zero correction cannot produce a meaningless audit entry');
select throws_ok($$select public.point_admin_adjust('c1000000-0000-4000-8000-000000000001',gen_random_uuid(),9007199254740992,'가상 사유')$$,
 null::text,null::text,'correction amount cannot exceed safe integer range');
select throws_ok($$select public.point_admin_adjust('c1000000-0000-4000-8000-000000000001',gen_random_uuid(),-9007199254740992,'가상 사유')$$,
 null::text,null::text,'negative correction magnitude also respects safe integer range');
select throws_ok($$select public.point_admin_adjust('c1000000-0000-4000-8000-000000000001',gen_random_uuid(),1,null)$$,
 null::text,null::text,'correction requires audit reason');
select throws_ok($$select public.point_admin_adjust('c1000000-0000-4000-8000-000000000001',gen_random_uuid(),1,' ')$$,
 null::text,null::text,'whitespace-only audit reason is rejected');
select throws_ok($$select public.point_admin_adjust('c1000000-0000-4000-8000-000000000001',gen_random_uuid(),1,E'\t\n')$$,
 null::text,null::text,'control whitespace cannot bypass audit reason validation');
select throws_ok($$select public.point_admin_adjust('c1000000-0000-4000-8000-000000000001',gen_random_uuid(),1,repeat('x',1001))$$,
 null::text,null::text,'audit reason respects documented structural length bound');
select throws_ok($$select public.point_admin_adjust('c1000000-0000-4000-8000-000000000099',gen_random_uuid(),1,'가상 사유')$$,
 '42501',null,'correction cannot mint into a nonexistent target');
select throws_ok($$select public.point_admin_adjust('c1000000-0000-4000-8000-000000000005',gen_random_uuid(),1,'가상 사유')$$,
 '42501',null,'correction cannot bypass target onboarding policy');
select throws_ok($$select public.point_admin_adjust('c1000000-0000-4000-8000-000000000006',gen_random_uuid(),1,'가상 사유')$$,
 '42501',null,'correction cannot bypass target active restriction');
reset role;
select is((select count(*) from private.point_ledger where reason='admin_adjust'),0::bigint,
 'all invalid administrative calls leave no misleading audit success');
update public.profiles set is_restricted=true,restricted_until=now()+interval '1 day'
 where id='c1000000-0000-4000-8000-000000000003';
set local role authenticated;
select throws_ok($$select public.point_admin_adjust('c1000000-0000-4000-8000-000000000001',gen_random_uuid(),1,'제한 관리자')$$,
 '42501',null,'restricted administrator cannot apply corrections');
reset role;
update public.profiles set is_restricted=false,restricted_until=null,role='fan'
 where id='c1000000-0000-4000-8000-000000000003';
set local role authenticated;
select throws_ok($$select public.point_admin_adjust('c1000000-0000-4000-8000-000000000001',gen_random_uuid(),1,'박탈 관리자')$$,
 '42501',null,'revoked administrator role is read from current profile, not cached JWT claims');

select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claims','{}',true);
select throws_ok($$select public.point_check_attendance()$$,'42501',null,'authenticated DB role without subject cannot claim attendance');
select throws_ok($$select public.point_balance()$$,'42501',null,'authenticated DB role without subject cannot read summary');
select throws_ok($$select * from public.point_history()$$,'42501',null,'authenticated DB role without subject cannot read history');
select throws_ok($$select * from public.point_capabilities()$$,'42501',null,'authenticated DB role without subject cannot use capabilities');
reset role;
set local role anon;
select throws_ok($$select public.point_check_attendance()$$,'42501',null,'anonymous attendance call is denied');
select throws_ok($$select public.point_balance()$$,'42501',null,'anonymous balance call is denied');
select throws_ok($$select * from public.point_history()$$,'42501',null,'anonymous history call is denied');
select throws_ok($$select * from private.point_ledger$$,'42501',null,'anonymous base ledger read is denied');
reset role;
set local role service_role;
select throws_ok($$select public.point_check_attendance()$$,'42501',null,'service role cannot fabricate user attendance');
select throws_ok($$select public.point_admin_adjust('c1000000-0000-4000-8000-000000000001',gen_random_uuid(),1,'서비스 역할')$$,
 '42501',null,'service role does not equal an authenticated administrator');
select throws_ok($$select * from private.point_ledger$$,'42501',null,'service role has no unrestricted ledger read grant');
select throws_ok($$update private.point_ledger set amount=999999$$,'42501',null,'service role cannot bypass immutable ledger mutation boundary');
select throws_ok($$delete from private.point_ledger$$,'42501',null,'service role cannot erase history');
reset role;

-- Owner-level DML probes verify immutability in addition to application grants.
select throws_ok($$update private.point_ledger set amount=amount+1$$,null::text,null::text,
 'append-only trigger rejects even owner-level historical amount rewrite');
select throws_ok($$delete from private.point_ledger$$,null::text,null::text,
 'append-only trigger rejects owner-level history deletion');
select throws_ok($$truncate private.point_ledger$$,null::text,null::text,
 'append-only trigger rejects owner-level truncate');
select throws_ok($$insert into private.point_ledger(user_id,amount,reason,ref_id,earned_on,policy_version,actor_id,policy_snapshot)
 values ('c1000000-0000-4000-8000-000000000001',10,'attendance',null,
 (clock_timestamp() at time zone 'Asia/Seoul')::date,'fictional-security-policy','c1000000-0000-4000-8000-000000000001','{}')$$,
 '23502',null,'NULL reward reference cannot evade uniqueness via nullable key semantics');
select throws_ok($$insert into private.point_ledger(user_id,amount,reason,ref_id,earned_on,policy_version,actor_id,policy_snapshot)
 select user_id,amount,reason,ref_id,earned_on,policy_version,actor_id,policy_snapshot from private.point_ledger
 where id=(select id from points_security_context where key='attendance')$$,'23505',null,
 'database constraint independently rejects a second canonical attendance reference');
select is((select count(*) from private.point_ledger),3::bigint,'all denied attacks preserve exactly the three authorized attendance entries');
select * from finish();
rollback;
