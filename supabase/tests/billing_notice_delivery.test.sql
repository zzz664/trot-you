begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
-- Fictional disposable-test bootstrap only. Not an operational seed.
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

insert into private.notification_policy values(true,'fictional-notice-push','fictional-notice-consent',true,3,10,30,86400);
insert into auth.sessions(id,user_id,created_at,updated_at) values('c1100000-0000-4000-8000-000000000001',pg_temp.fan(),now(),now());
create temp table notice_push_context(label text primary key,id uuid,token uuid);
grant all on notice_push_context to authenticated,service_role;
set local role service_role;
insert into notice_push_context(label,id) select 'device',public.webpush_register_device(pg_temp.fan(),
 'c1100000-0000-4000-8000-000000000001','https://push.example.invalid/billing',repeat('B',87),repeat('A',22),'fictional-notice-consent');
reset role;
select set_config('request.jwt.claim.sub',pg_temp.fan()::text,true);
set local role authenticated;
select public.billing_notice_set_preference(true);
reset role;
select pg_temp.make_case('push');
set local role service_role;
select is((select push_jobs from public.billing_notice_create(pg_temp.sid('push'))),1,'transaction inserts one session-bound optional push alongside actual inbox');
select is((select push_jobs from public.billing_notice_create(pg_temp.sid('push'))),0,'per-period/device replay enqueues nothing twice');
select is((select count(*) from public.webpush_list_due()),1::bigint,'current worker discovers newly supported billing_notice');
reset role;
insert into notice_push_context(label,id) select 'push',id from private.notification_jobs where source_kind='billing_notice';
select is((select route_kind from private.notification_jobs where id=(select id from notice_push_context where label='push')),'billing','billing notice has typed safe route');
select is((select billing_notice_id=source_id and payment_event_id is null from private.notification_jobs where id=(select id from notice_push_context where label='push')),true,'notice never masquerades as a recognized payment');
set local role service_role;
update notice_push_context set token=c.lease_token from public.notification_claim((select id from notice_push_context where label='push')) c where label='push';
select is((select source_kind from public.webpush_prepare_delivery((select id from notice_push_context where label='push'),(select token from notice_push_context where label='push'))),'billing_notice','final preparation returns only safe source discriminator for generic copy');
select is((select count(*) from public.webpush_prepare_delivery((select id from notice_push_context where label='push'),(select token from notice_push_context where label='push'))),0::bigint,'same lease cannot prepare twice');
select is(public.webpush_complete((select id from notice_push_context where label='push'),(select token from notice_push_context where label='push'),'provider_accepted',gen_random_uuid()),'provider_accepted','HTTP acceptance retained without claiming display');
reset role;
select is((select count(*) from private.renewal_notice_receipts),0::bigint,'push acceptance cannot fulfill verified renewal notice gate');
select is((select read_at from private.billing_notices where subscription_id=pg_temp.sid('push')),null::timestamptz,'push acceptance does not mark in-app read');

select pg_temp.make_case('cancel');
set local role service_role;
select public.billing_notice_create(pg_temp.sid('cancel'));
reset role;
insert into notice_push_context(label,id) select 'cancel',id from private.notification_jobs where source_kind='billing_notice' and source_id=pg_temp.nid('cancel');
set local role service_role;
update notice_push_context set token=c.lease_token from public.notification_claim((select id from notice_push_context where label='cancel')) c where label='cancel';
reset role;
update public.subscriptions set status='canceled',canceled_at=clock_timestamp(),next_billing_at=null where id=pg_temp.sid('cancel');
set local role service_role;
select is((select count(*) from public.webpush_prepare_delivery((select id from notice_push_context where label='cancel'),(select token from notice_push_context where label='cancel'))),0::bigint,'cancellation after claim blocks final preparation');
reset role;
select is((select state from private.notification_jobs where id=(select id from notice_push_context where label='cancel')),'canceled','cancellation keeps obsolete push suppressed');

select pg_temp.make_case('reschedule');
set local role service_role;
select public.billing_notice_create(pg_temp.sid('reschedule'));
reset role;
insert into notice_push_context(label,id) select 'reschedule',id from private.notification_jobs where source_kind='billing_notice' and source_id=pg_temp.nid('reschedule');
set local role service_role;
update notice_push_context set token=c.lease_token from public.notification_claim((select id from notice_push_context where label='reschedule')) c where label='reschedule';
reset role;
update public.subscriptions set next_billing_at=next_billing_at+interval '1 hour' where id=pg_temp.sid('reschedule');
set local role service_role;
select is((select count(*) from public.webpush_prepare_delivery((select id from notice_push_context where label='reschedule'),(select token from notice_push_context where label='reschedule'))),0::bigint,'reschedule after claim blocks final preparation');
reset role;
select is((select state from private.notification_jobs where id=(select id from notice_push_context where label='reschedule')),'canceled','reschedule keeps obsolete push suppressed');

select pg_temp.make_case('policy');
set local role service_role;
select public.billing_notice_create(pg_temp.sid('policy'));
reset role;
insert into notice_push_context(label,id) select 'policy',id from private.notification_jobs where source_kind='billing_notice' and source_id=pg_temp.nid('policy');
set local role service_role;
update notice_push_context set token=c.lease_token from public.notification_claim((select id from notice_push_context where label='policy')) c where label='policy';
reset role;
update private.checkout_policy_current set policy_version='c7000000-0000-4000-8000-000000000002';
set local role service_role;
select is((select count(*) from public.webpush_prepare_delivery((select id from notice_push_context where label='policy'),(select token from notice_push_context where label='policy'))),0::bigint,'current policy change after claim blocks final preparation');
reset role;
select is((select state from private.notification_jobs where id=(select id from notice_push_context where label='policy')),'canceled','current policy change keeps obsolete push suppressed');
update private.checkout_policy_current set policy_version=pg_temp.policy();

select pg_temp.make_case('mandate');
set local role service_role;
select public.billing_notice_create(pg_temp.sid('mandate'));
reset role;
insert into notice_push_context(label,id) select 'mandate',id from private.notification_jobs where source_kind='billing_notice' and source_id=pg_temp.nid('mandate');
set local role service_role;
update notice_push_context set token=c.lease_token from public.notification_claim((select id from notice_push_context where label='mandate')) c where label='mandate';
reset role;
update private.payment_mandates set is_active=false where subscription_id=pg_temp.sid('mandate');
set local role service_role;
select is((select count(*) from public.webpush_prepare_delivery((select id from notice_push_context where label='mandate'),(select token from notice_push_context where label='mandate'))),0::bigint,'mandate revocation after claim blocks final preparation');
reset role;
select is((select state from private.notification_jobs where id=(select id from notice_push_context where label='mandate')),'canceled','mandate revocation keeps obsolete push suppressed');

select pg_temp.make_case('unknown');
set local role service_role;
select public.billing_notice_create(pg_temp.sid('unknown'));
reset role;
insert into notice_push_context(label,id) select 'unknown',id from private.notification_jobs where source_kind='billing_notice' and source_id=pg_temp.nid('unknown');
set local role service_role;
update notice_push_context set token=c.lease_token from public.notification_claim((select id from notice_push_context where label='unknown')) c where label='unknown';
reset role;
insert into private.billing_obligations(subscription_id,mandate_id,period_start,period_end,amount_krw,is_initial,is_intro,price_version,grace_seconds,retry_seconds,max_retries,next_attempt_at) select s.id,m.id,s.current_period_end,s.current_period_end+interval '1 month',7200,false,false,pg_temp.policy()::text,259200,86400,3,now() from public.subscriptions s join private.payment_mandates m on m.subscription_id=s.id where s.id=pg_temp.sid('unknown'); insert into private.payment_attempts(obligation_id,ordinal,state) select id,1,'unknown' from private.billing_obligations where subscription_id=pg_temp.sid('unknown');
set local role service_role;
select is((select count(*) from public.webpush_prepare_delivery((select id from notice_push_context where label='unknown'),(select token from notice_push_context where label='unknown'))),0::bigint,'unresolved payment outcome after claim blocks final preparation');
reset role;
select is((select state from private.notification_jobs where id=(select id from notice_push_context where label='unknown')),'canceled','unresolved payment outcome keeps obsolete push suppressed');

select pg_temp.make_case('optout');
set local role service_role;
select public.billing_notice_create(pg_temp.sid('optout'));
reset role;
insert into notice_push_context(label,id) select 'optout',id from private.notification_jobs where source_kind='billing_notice' and source_id=pg_temp.nid('optout');
set local role service_role;
update notice_push_context set token=c.lease_token from public.notification_claim((select id from notice_push_context where label='optout')) c where label='optout';
select is((select count(*) from public.webpush_prepare_delivery((select id from notice_push_context where label='optout'),(select token from notice_push_context where label='optout'))),1::bigint,'ambiguous in-flight scenario begins with authorized capability');
select is(public.webpush_complete((select id from notice_push_context where label='optout'),(select token from notice_push_context where label='optout'),'unknown',null),'unknown','transport ambiguity remains unknown');
reset role;
set local role authenticated;
select public.billing_notice_set_preference(false);
select ok((select count(*)>0 from public.billing_notice_list()),'push billing opt-out does not hide mandatory inapp');
reset role;
update private.notification_jobs set lease_expires_at=clock_timestamp()-interval '30 seconds',next_attempt_at=clock_timestamp()-interval '1 second' where id=(select id from notice_push_context where label='optout');
set local role service_role;
select is(public.webpush_recover_expired((select id from notice_push_context where label='optout'),(select token from notice_push_context where label='optout')),'canceled','unknown push recovery rechecks current preference');
reset role;
select is((select state from private.notification_attempts where token=(select token from notice_push_context where label='optout')),'unknown','suppressed ambiguous prepared attempt never becomes proven non-send');
select is((select count(*) from private.renewal_notice_receipts),0::bigint,'transport uncertainty never creates billing evidence');
-- Generic payment receipts remain DB-only. Schedule notices are the separate
-- approved next-day kind, never an unconditional broadening to every source.
select ok(pg_get_functiondef('public.webpush_list_due(integer)'::regprocedure) like '%in(''message'',''billing_notice'',''schedule'')%',
 'worker retains its exact three-kind allowlist excluding generic payment receipts');
select ok(pg_get_functiondef('private.webpush_job_eligible(private.notification_jobs,timestamptz)'::regprocedure) like '%schedule_notice_job_current%',
 'schedule delivery additionally requires its current approved next-day snapshot');
select * from finish();
rollback;
