begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
select is((select count(*) from private.billing_notice_policies),0::bigint,'migration activates no notice policy');
select is((select count(*) from private.billing_notices),0::bigint,'migration manufactures no inbox entries');
select is((select count(*) from private.renewal_notice_receipts),0::bigint,'migration manufactures no renewal evidence');
select ok((select bool_and(relrowsecurity) from pg_class where oid in('private.billing_notice_policies'::regclass,
 'private.billing_notices'::regclass,'private.billing_notice_scan_cursor'::regclass)),'notice tables all have RLS');
select ok((select bool_and(not has_table_privilege(r,t,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')) from
 unnest(array['anon','authenticated','service_role']) r,unnest(array['private.billing_notice_policies','private.billing_notices','private.billing_notice_scan_cursor']) t),'no application role has raw notice access');
select ok((select bool_and('search_path=""'=any(proconfig)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname in('public','private') and p.proname like 'billing_notice\_%' escape '\'),'every notice boundary pins search path');
select ok((select bool_and(not has_function_privilege(r,p.oid,'EXECUTE')) from pg_proc p join pg_namespace n on n.oid=p.pronamespace,
 unnest(array['anon','authenticated','service_role']) r where n.nspname='private' and p.proname like 'billing_notice\_%' escape '\'),'private notice helpers have no application grants');
select ok(not has_function_privilege('authenticated','public.billing_notice_create(uuid)','EXECUTE'),'fan cannot generate notices');
select ok(not has_function_privilege('anon','public.billing_notice_list(integer,timestamptz,uuid)','EXECUTE'),'anonymous cannot read notice prices');
select ok(not has_function_privilege('service_role','public.billing_notice_mark_read(uuid)','EXECUTE'),'service cannot forge a user read through owner RPC');
select is(private.billing_notice_due_at('2026-11-01T00:00:00Z',1,10),'2026-10-31T01:00:00Z'::timestamptz,'KST previous-day ten handles month boundary');
select is(private.billing_notice_due_at('2027-01-01T00:00:00Z',1,0),'2026-12-30T15:00:00Z'::timestamptz,'KST year boundary is not UTC date subtraction');
select is(private.billing_notice_due_at('2028-03-01T00:00:00Z',1,10),'2028-02-29T01:00:00Z'::timestamptz,'KST leap day handled');
select is(private.billing_notice_due_at('2026-11-01T00:00:00Z',0,10),null::timestamptz,'zero-day schedule is invalid');
select is(private.billing_notice_due_at('infinity',1,10),null::timestamptz,'infinite billing clock invalid');
set local timezone='America/Los_Angeles';
select is(private.billing_notice_due_at('2026-11-01T00:00:00Z',1,10),'2026-10-31T01:00:00Z'::timestamptz,'host timezone cannot move Seoul schedule');
set local timezone='UTC';
insert into auth.users(id,email,raw_user_meta_data) values('c1000000-0000-4000-8000-000000000001','notice-only@example.invalid','{}');
insert into private.onboarding_documents(version,kind,title,body,approved_at,published_at) values
 ('c9000000-0000-4000-8000-000000000001','terms','Fictional terms','Rollback-only terms.',now(),now()),
 ('c9000000-0000-4000-8000-000000000002','privacy','Fictional privacy','Rollback-only privacy.',now(),now());
insert into private.profile_onboarding_policy values(true,'c8000000-0000-4000-8000-000000000001',now(),2,10,
 array['금지단어'],'c9000000-0000-4000-8000-000000000001','c9000000-0000-4000-8000-000000000002',null);
update public.profiles set font_selected_at=now(),call_name='허구안내팬',age_self_attested_at=now(),profile_completed_at=now(),onboarding_completed_at=now()
 where id='c1000000-0000-4000-8000-000000000001';
insert into private.profile_policy_acceptances(user_id,kind,version,accepted_at)
 select 'c1000000-0000-4000-8000-000000000001',kind,version,now() from private.onboarding_documents;
insert into private.checkout_policies values
 ('c7000000-0000-4000-8000-000000000001','허구 갱신 정책','운영에 사용할 수 없는 테스트 전용 명시 승인 정책입니다.',7200,1200,now(),now(),'seoul_monthly_clamped','taxable_krw'),
 ('c7000000-0000-4000-8000-000000000002','허구 통지 정책','운영에 사용할 수 없는 테스트 전용 통지 필수 정책입니다.',7200,1200,now(),now(),'seoul_monthly_clamped','taxable_krw');
insert into private.checkout_policy_current values(true,'c7000000-0000-4000-8000-000000000001');
create temp table notice_cases(label text primary key,sid uuid,descriptor jsonb,approved_at timestamptz,evidence uuid);
grant all on notice_cases to service_role,authenticated;
create function pg_temp.fan() returns uuid language sql as $$select 'c1000000-0000-4000-8000-000000000001'::uuid$$;
create function pg_temp.policy() returns uuid language sql as $$select 'c7000000-0000-4000-8000-000000000001'::uuid$$;
create function pg_temp.sid(label text) returns uuid language sql as $$select sid from notice_cases c where c.label=$1$$;
create function pg_temp.aid(label text) returns uuid language sql as $$select (descriptor->>'attempt_id')::uuid from notice_cases c where c.label=$1$$;
create function pg_temp.lease(label text) returns uuid language sql as $$select (descriptor->>'lease_token')::uuid from notice_cases c where c.label=$1$$;
create function pg_temp.make_case(label text,provider public.payment_provider default 'toss',policy uuid default pg_temp.policy()) returns uuid
language plpgsql as $$declare artist uuid:=gen_random_uuid(); sid uuid:=gen_random_uuid(); mid uuid:=gen_random_uuid(); cid uuid:=gen_random_uuid();
 session uuid:=gen_random_uuid(); event uuid:=gen_random_uuid(); anchor timestamptz:=date_trunc('hour',clock_timestamp())-interval '25 days'; due timestamptz;
begin
 due:=private.enrollment_period_end(anchor,'seoul_monthly_clamped');
 insert into public.artists(id,slug,name,grade,status) values(artist,'notice-'||artist,'허구 갱신 가수','B','active');
 insert into public.subscriptions(id,user_id,artist_id,provider,status,intro_redeemed_at,first_started_at,episode_started_at,current_period_start,current_period_end,next_billing_at)
 values(sid,pg_temp.fan(),artist,provider,'active',anchor,anchor,anchor,anchor,due,due);
 insert into private.payment_mandates(id,subscription_id,provider,environment,merchant_account,provider_customer_ref,secure_credential_ref,consent_version)
 values(mid,sid,provider,'test','fixture-merchant',gen_random_uuid(),cid,policy::text);
 insert into public.payment_events(id,subscription_id,kind,amount_krw,currency,provider,period_start,period_end,occurred_at)
 values(event,sid,'charge',1200,'KRW',provider,anchor,due,anchor);
 insert into private.checkout_sessions(id,user_id,artist_id,provider,environment,idempotency_key,nonce_hash,policy_version,initial_price_krw,
 regular_price_krw,intro_eligible,created_at,expires_at)
 values(session,pg_temp.fan(),artist,provider,'test',gen_random_uuid(),repeat('a',64),policy,1200,7200,true,anchor,anchor+interval '30 minutes');
 insert into private.subscription_enrollments(session_id,user_id,artist_id,subscription_id,mandate_id,credential_ref,auth_session_hash,callback_state_hash,state,stage,payment_event_id)
 values(session,pg_temp.fan(),artist,sid,mid,cid,repeat('b',64),repeat('c',64),'succeeded',case provider when 'toss' then 'charge' else 'approve' end,event);
 insert into private.enrollment_credentials(id,mandate_id,ciphertext)
 values(cid,mid,'{"version":"fixture-v1","iv":"AAAAAAAAAAAAAAAA","tag":"AAAAAAAAAAAAAAAAAAAAAA","ciphertext":"AA"}');
 insert into notice_cases(label,sid,evidence) values(label,sid,gen_random_uuid()); return sid;
end$$;

insert into private.renewal_policies values
 (pg_temp.policy(),259200,86400,3,true,86400,now(),now()),
 ('c7000000-0000-4000-8000-000000000002',259200,86400,3,true,86400,now(),now());
insert into private.billing_notice_policies values
 (pg_temp.policy(),7,0,true,now(),now()),
 ('c7000000-0000-4000-8000-000000000002',7,0,false,now(),now());
create function pg_temp.nid(label text) returns uuid language sql as $$
 select id from private.billing_notices where subscription_id=pg_temp.sid(label)$$;

select throws_ok($$update private.billing_notice_policies set days_before=1 where checkout_policy_version=pg_temp.policy()$$,
 '23514','BILLING_NOTICE_POLICY_IMMUTABLE','approved notice policy immutable');
select throws_ok($$delete from private.billing_notice_policies where checkout_policy_version=pg_temp.policy()$$,
 '23514','BILLING_NOTICE_POLICY_IMMUTABLE','approved policy cannot be removed');
select throws_ok($$truncate private.billing_notice_policies cascade$$,'23514','BILLING_NOTICE_POLICY_IMMUTABLE','truncate cannot bypass immutable policy');
select pg_temp.make_case('first');
set local role service_role;
select throws_ok($$select public.billing_notice_candidates(0)$$,'22023','BILLING_NOTICE_LIMIT_INVALID','candidate zero rejected');
select throws_ok($$select public.billing_notice_candidates(21)$$,'22023','BILLING_NOTICE_LIMIT_INVALID','candidate limit bounded');
select is((select count(*) from public.billing_notice_candidates()),1::bigint,'approved due upcoming renewal selected');
select is((select created from public.billing_notice_create(pg_temp.sid('first'))),true,'real in-app notice inserted');
select is((select created from public.billing_notice_create(pg_temp.sid('first'))),false,'ordinary worker replay deduplicated');
select is((select count(*) from public.billing_notice_candidates()),0::bigint,'completed period no longer selected');
select is((select count(*) from public.billing_notice_create(gen_random_uuid())),0::bigint,'missing subscription safely skipped');
reset role;
select is((select count(*) from private.billing_notices),1::bigint,'one inbox row per subscription period');
select is((select amount_krw from private.billing_notices),7200,'notice uses approved regular price not intro');
select is((select currency from private.billing_notices),'KRW','currency explicit');
select is((select count(*) from private.notification_jobs where source_kind='billing_notice'),0::bigint,'mandatory inapp never invents push consent');
select is((select count(*) from private.renewal_notice_receipts),0::bigint,'creation is not verified delivery evidence');
select throws_ok($$update private.billing_notices set amount_krw=1$$,'23514','BILLING_NOTICE_IMMUTABLE','amount snapshot immutable');
select throws_ok($$delete from private.billing_notices$$,'23514','BILLING_NOTICE_IMMUTABLE','inbox audit identity cannot be deleted');
select set_config('request.jwt.claim.sub',pg_temp.fan()::text,true);
set local role authenticated;
select is((select count(*) from public.billing_notice_list()),1::bigint,'owner sees mandatory notice despite optional preference off');
select is((select amount_krw from public.billing_notice_list()),7200,'authenticated projection exposes exact approved amount');
select is((select read_at from public.billing_notice_list()),null::timestamptz,'listing never invents a read');
select lives_ok($$select public.billing_notice_mark_read((select id from public.billing_notice_list()))$$,'explicit own read marker recorded');
select lives_ok($$select public.billing_notice_mark_read((select id from public.billing_notice_list()))$$,'read replay idempotent');
select ok((select read_at is not null from public.billing_notice_list()),'explicit read visible to owner');
select is((select billing_enabled from public.billing_notice_preferences()),false,'missing optional preference defaults off');
select throws_ok($$select public.billing_notice_list(52)$$,'22023','BILLING_NOTICE_LIMIT_INVALID','inbox bounded to one lookahead page');
select throws_ok($$select public.billing_notice_list(1,now(),null)$$,'22023','BILLING_NOTICE_CURSOR_INVALID','partial cursor rejected');
select throws_ok($$select public.billing_notice_list(1,'infinity',gen_random_uuid())$$,'22023','BILLING_NOTICE_CURSOR_INVALID','nonfinite cursor rejected');
reset role;
select is((select count(*) from private.renewal_notice_receipts),0::bigint,'read marker cannot authorize a charge');
insert into auth.users(id,email,raw_user_meta_data) values('c1000000-0000-4000-8000-000000000002','notice-other@example.invalid','{}');
update public.profiles set call_name='다른가상팬',onboarding_completed_at=now() where id='c1000000-0000-4000-8000-000000000002';
select set_config('request.jwt.claim.sub','c1000000-0000-4000-8000-000000000002',true);
set local role authenticated;
select is((select count(*) from public.billing_notice_list()),0::bigint,'other actor sees no amount/date');
select throws_ok($$select public.billing_notice_mark_read((select id from private.billing_notices limit 1))$$,'42501',null,'raw private reads denied');
reset role;
-- Snapshot currentness excludes reschedules and will not revive an old notice
-- when an operator later restores the former time.
update notice_cases set descriptor=jsonb_build_object('due',(select next_billing_at from public.subscriptions where id=pg_temp.sid('first'))) where label='first';
update public.subscriptions set next_billing_at=next_billing_at+interval '1 hour' where id=pg_temp.sid('first');
select ok((select invalidated_at is not null from private.billing_notices where subscription_id=pg_temp.sid('first')),'reschedule invalidates original immutable period notice');
update public.subscriptions set next_billing_at=(select (descriptor->>'due')::timestamptz from notice_cases where label='first') where id=pg_temp.sid('first');
select is(private.billing_notice_current(pg_temp.nid('first'),clock_timestamp()),false,'returning to original date cannot revive canceled work');
set local role service_role;
select is((select count(*) from public.billing_notice_create(pg_temp.sid('first'))),0::bigint,'invalidated period requires review not silent replacement');
reset role;
-- Optional in-app follows only billing preference; unrelated choices retained.
update private.checkout_policy_current set policy_version='c7000000-0000-4000-8000-000000000002';
select pg_temp.make_case('optional','toss','c7000000-0000-4000-8000-000000000002');
set local role service_role;
select is((select count(*) from public.billing_notice_create(pg_temp.sid('optional'))),0::bigint,'optional inapp disabled until user opts in');
reset role;
select set_config('request.jwt.claim.sub',pg_temp.fan()::text,true);
set local role authenticated;
select is((select billing_enabled from public.billing_notice_set_preference(true)),true,'narrow billing opt-in stored');
select is((select webpush_enabled from public.notification_get_preferences()),false,'billing opt-in does not enable browser push');
select is((select new_message from public.notification_get_preferences()),false,'billing opt-in preserves new-message choice');
select is((select schedule from public.notification_get_preferences()),false,'billing opt-in preserves schedule choice');
select throws_ok($$select public.billing_notice_set_preference(null)$$,'22004','NOTIFICATION_PREFERENCES_REQUIRED','ambiguous null preference rejected');
reset role;
set local role service_role;
select is((select created from public.billing_notice_create(pg_temp.sid('optional'))),true,'opted-in due optional inbox created');
reset role;
set local role authenticated;
select is((select count(*) from public.billing_notice_list()),1::bigint,'optional owner notice shown');
select is((select billing_enabled from public.billing_notice_set_preference(false)),false,'optional billing opt-out persisted');
select is((select count(*) from public.billing_notice_list()),0::bigint,'optional inbox hidden immediately after optout');
reset role;
-- A current policy/price replacement never reinterprets an accepted price.
update private.checkout_policy_current set policy_version=pg_temp.policy();
select pg_temp.make_case('policy-change');
set local role service_role;
select is((select created from public.billing_notice_create(pg_temp.sid('policy-change'))),true,'current immutable price fixture created');
reset role;
update private.checkout_policy_current set policy_version='c7000000-0000-4000-8000-000000000002';
select is(private.billing_notice_current(pg_temp.nid('policy-change'),clock_timestamp()),false,'new current policy suppresses old unaccepted price notice');
update private.checkout_policy_current set policy_version=pg_temp.policy();
select pg_temp.make_case('cancel');
set local role service_role;
select is((select created from public.billing_notice_create(pg_temp.sid('cancel'))),true,'cancel fixture created');
reset role;
update public.subscriptions set status='canceled',canceled_at=clock_timestamp(),next_billing_at=null where id=pg_temp.sid('cancel');
select is(private.billing_notice_current(pg_temp.nid('cancel'),clock_timestamp()),false,'cancellation suppresses notice');
select pg_temp.make_case('not-due');
-- Technical fixture uses an unapproved draft to test absent approval, without
-- mutating an approved policy.
insert into private.checkout_policies values('c7000000-0000-4000-8000-000000000003','허구 초안','테스트 전용.',7200,1200,now(),now(),'seoul_monthly_clamped','taxable_krw');
insert into private.renewal_policies values('c7000000-0000-4000-8000-000000000003',259200,86400,3,true,86400,now(),now());
insert into private.billing_notice_policies values('c7000000-0000-4000-8000-000000000003',7,0,true,null,null);
update private.checkout_policy_current set policy_version='c7000000-0000-4000-8000-000000000003';
select pg_temp.make_case('draft','toss','c7000000-0000-4000-8000-000000000003');
set local role service_role;
select is((select count(*) from public.billing_notice_create(pg_temp.sid('draft'))),0::bigint,'draft notice policy cannot dispatch');
reset role;
select is((select count(*) from private.renewal_notice_receipts),0::bigint,'all inbox/read operations leave required renewal delivery gate untouched');
-- Precise currentness and future-dispatch boundaries use actual stored
-- approved snapshots, never supplied provider or user clocks.
update private.checkout_policy_current set policy_version=pg_temp.policy();
select pg_temp.make_case('clock-boundary');
select ok(private.billing_notice_snapshot(pg_temp.sid('clock-boundary'),(select next_billing_at-interval '1 microsecond' from public.subscriptions where id=pg_temp.sid('clock-boundary'))) is not null,'upcoming snapshot exists immediately before billing boundary');
select is(private.billing_notice_snapshot(pg_temp.sid('clock-boundary'),(select next_billing_at from public.subscriptions where id=pg_temp.sid('clock-boundary'))),null::jsonb,'at billing boundary notice is no longer upcoming');
insert into private.checkout_policies values('c7000000-0000-4000-8000-000000000004','허구 미래 일정','테스트 전용.',7200,1200,now(),now(),'seoul_monthly_clamped','taxable_krw');
insert into private.renewal_policies values('c7000000-0000-4000-8000-000000000004',259200,86400,3,true,1,now(),now());
insert into private.billing_notice_policies values('c7000000-0000-4000-8000-000000000004',1,0,true,now(),now());
update private.checkout_policy_current set policy_version='c7000000-0000-4000-8000-000000000004';
select pg_temp.make_case('future-schedule','toss','c7000000-0000-4000-8000-000000000004');
select ok((private.billing_notice_snapshot(pg_temp.sid('future-schedule'),clock_timestamp())->>'due_at')::timestamptz>clock_timestamp(),'explicit KST dispatch remains future');
set local role service_role;
select is((select count(*) from public.billing_notice_create(pg_temp.sid('future-schedule'))),0::bigint,'future dispatch cannot create early notice');
reset role;
insert into private.checkout_policies values('c7000000-0000-4000-8000-000000000005','허구 부족한 여유','테스트 전용.',7200,1200,now(),now(),'seoul_monthly_clamped','taxable_krw');
insert into private.renewal_policies values('c7000000-0000-4000-8000-000000000005',259200,86400,3,true,2678400,now(),now());
insert into private.billing_notice_policies values('c7000000-0000-4000-8000-000000000005',1,10,true,now(),now());
update private.checkout_policy_current set policy_version='c7000000-0000-4000-8000-000000000005';
select pg_temp.make_case('insufficient-lead','toss','c7000000-0000-4000-8000-000000000005');
select is(private.billing_notice_snapshot(pg_temp.sid('insufficient-lead'),clock_timestamp()),null::jsonb,'daily KST schedule shorter than approved renewal minimum fails closed');
-- Pagination is stable under identical transaction clocks and has an explicit
-- UUID tie-break, not an unbounded inaccessible tail.
update private.checkout_policy_current set policy_version=pg_temp.policy();
select pg_temp.make_case('page-one'); select pg_temp.make_case('page-two');
set local role service_role;
select public.billing_notice_create(pg_temp.sid('page-one')); select public.billing_notice_create(pg_temp.sid('page-two'));
reset role;
select set_config('request.jwt.claim.sub',pg_temp.fan()::text,true);
create temp table notice_page as select id,created_at from private.billing_notices where invalidated_at is null and private.billing_notice_current(id,clock_timestamp()) order by created_at desc,id desc limit 1;
grant select on notice_page to authenticated;
set local role authenticated;
select is((select count(*) from public.billing_notice_list(1)),1::bigint,'bounded first page returns one');
select ok(not exists(select 1 from public.billing_notice_list(51,(select created_at from notice_page),(select id from notice_page)) l where l.id=(select id from notice_page)),'exclusive compound cursor never repeats last item');
select ok((select count(*) from public.billing_notice_list(51,(select created_at from notice_page),(select id from notice_page)))>0,'older current notices remain reachable');
reset role;
-- Post-creation current actor gates must match producer and renewal readiness.
select is(private.billing_notice_current(pg_temp.nid('page-one'),clock_timestamp()),true,'baseline current actor eligible');
delete from private.profile_policy_acceptances where user_id=pg_temp.fan() and kind='terms';
select is(private.billing_notice_current(pg_temp.nid('page-one'),clock_timestamp()),false,'removed current terms acceptance suppresses existing notice');
insert into private.profile_policy_acceptances(user_id,kind,version,accepted_at) values(pg_temp.fan(),'terms','c9000000-0000-4000-8000-000000000001',now());
update private.profile_onboarding_policy set profanity_words=array['허구'];
select is(private.billing_notice_current(pg_temp.nid('page-one'),clock_timestamp()),false,'changed current name policy suppresses existing notice');
update private.profile_onboarding_policy set profanity_words=array['금지단어'];
delete from private.enrollment_credentials where mandate_id=(select id from private.payment_mandates where subscription_id=pg_temp.sid('page-one'));
select is(private.billing_notice_current(pg_temp.nid('page-one'),clock_timestamp()),false,'missing encrypted credential suppresses impossible upcoming charge notice');
update public.profiles set is_restricted=true where id=pg_temp.fan();
set local role authenticated;
select throws_ok($$select public.billing_notice_list()$$,'42501','NOTIFICATION_ACTOR_FORBIDDEN','restriction blocks private notice amounts');
select throws_ok($$select public.billing_notice_set_preference(true)$$,'42501','NOTIFICATION_ACTOR_FORBIDDEN','restricted user cannot enable billing notifications');
reset role;
select * from finish();
rollback;
