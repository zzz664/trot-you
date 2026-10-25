begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
-- Disposable fictional SQL-only fixtures; no provider request or actual consent.
create temporary table schedule_notice_context(key text primary key,id uuid,token uuid,stamp timestamptz);
grant all on schedule_notice_context to authenticated,service_role;
select is((select count(*) from private.schedule_notice_policies),0::bigint,'migration approves no notice policy');
select is((select count(*) from private.schedule_notice_policy_current),0::bigint,'migration activates no notice policy');
select is((select count(*) from private.schedule_notice_scan_cursor),0::bigint,'migration fabricates no completed scan');
select ok(pg_get_functiondef('private.notification_enqueue_source(text,uuid)'::regprocedure) like '%private.artist_dispatch_submissions%'
 and pg_get_functiondef('private.notification_enqueue_source(text,uuid)'::regprocedure) like '%fanout_completed=true,notification_queued=cardinality(devices)>0%'
 and pg_get_functiondef('private.notification_enqueue_source(text,uuid)'::regprocedure) like '%DISPATCH_BACKPRESSURE%'
 and pg_get_functiondef('private.notification_enqueue_source(text,uuid)'::regprocedure) like '%notification_enqueue_source_legacy%',
 'schedule migration preserves managed-message frozen fanout wrapper, backpressure and completion state');
select ok((select bool_and(not has_table_privilege(r,t,'SELECT,INSERT,UPDATE,DELETE'))
 from unnest(array['anon','authenticated','service_role']) r cross join unnest(array[
 'private.schedule_notice_policies','private.schedule_notice_policy_current','private.schedule_notice_scan_cursor'])t),'no raw notice policy/cursor access');
select ok((select bool_and(not has_function_privilege(r,p.oid,'EXECUTE')) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 cross join unnest(array['anon','authenticated','service_role'])r where n.nspname='private' and p.proname like 'schedule_notice\_%' escape '\'),'all new private helpers deny application execution');
select ok((select bool_and(p.prosecdef and 'search_path=""'=any(p.proconfig)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname like 'schedule_notice\_%' escape '\'),'public notice RPCs pin owner search path');
select ok(has_function_privilege('service_role','public.schedule_notice_create(uuid)','EXECUTE')
 and not has_function_privilege('authenticated','public.schedule_notice_create(uuid)','EXECUTE')
 and not has_function_privilege('anon','public.schedule_notice_candidates(integer)','EXECUTE'),'queue only accepts service role');
select ok(has_function_privilege('authenticated','public.schedule_notice_preferences(uuid)','EXECUTE')
 and not has_function_privilege('service_role','public.schedule_notice_preferences(uuid)','EXECUTE')
 and not has_function_privilege('anon','public.schedule_notice_set_event(uuid,boolean)','EXECUTE'),'actor preference boundaries cannot impersonate another user');

select ok(private.schedule_notice_window('2028-02-29T00:00:00+09:00','2028-02-28T10:00:00+09:00',10),'next-day midnight lower boundary included');
select ok(private.schedule_notice_window('2028-02-29T23:59:59.999999+09:00','2028-02-28T23:59:59.999999+09:00',10),'next-day final microsecond included');
select ok(not private.schedule_notice_window('2028-03-01T00:00:00+09:00','2028-02-28T10:00:00+09:00',10),'day-after upper boundary excluded');
select ok(not private.schedule_notice_window('2028-02-29T12:00:00+09:00','2028-02-28T09:59:59.999999+09:00',10),'one microsecond before approved hour excluded');
select ok(not private.schedule_notice_window('2028-02-28T23:59:59+09:00','2028-02-28T10:00:00+09:00',10),'same-day late catchup excluded');
select ok(private.schedule_notice_window('2029-01-01T01:00:00+09:00','2028-12-31T10:00:00+09:00',10),'year rollover uses Seoul calendar day');
select ok(private.schedule_notice_window('2028-02-29T00:00:00+09:00','2028-02-28T01:00:00Z',10),'UTC instant equivalent to KST boundary');
select ok(not private.schedule_notice_window('infinity',now(),10),'infinite event rejected');
select ok(not private.schedule_notice_window(now(),'infinity',10),'infinite scan time rejected');
select ok(not private.schedule_notice_window(null,now(),10),'null event fails closed');
select ok(not private.schedule_notice_window(now(),now(),null),'null notice hour fails closed');
select ok(not private.schedule_notice_window(now(),now(),24),'invalid notice hour fails closed');
set local timezone='America/Los_Angeles';
select ok(private.schedule_notice_window('2028-03-12T03:00:00+09:00','2028-03-11T10:00:00+09:00',10),'database timezone and foreign DST never change KST day');
set local timezone='UTC';

insert into auth.users(id,email,raw_user_meta_data)
select ('ba100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'schedule-notice-'||n||'@example.invalid','{}'::jsonb from generate_series(1,15)n;
update public.profiles set call_name='가상 일정 팬',onboarding_completed_at=clock_timestamp() where id::text like 'ba100000-%';
update public.profiles set role='admin' where id='ba100000-0000-4000-8000-000000000015';
update public.profiles set is_restricted=true where id='ba100000-0000-4000-8000-000000000006';
insert into auth.sessions(id,user_id,created_at,updated_at,not_after)
select ('ba110000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,('ba100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 clock_timestamp(),clock_timestamp(),case when n=12 then clock_timestamp()-interval '1 second' end from generate_series(1,14)n;
insert into public.artists(id,slug,name,grade,status) values
 ('ba200000-0000-4000-8000-000000000001','schedule-notice-fixture','가상 일정 가수','B','active');
insert into public.subscriptions(id,user_id,artist_id,provider,status,current_period_start,current_period_end,grace_started_at,grace_ends_at,canceled_at,created_at)
select ('ba300000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,('ba100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 'ba200000-0000-4000-8000-000000000001','toss',case n when 2 then 'canceled'::public.subscription_status when 3 then 'grace'::public.subscription_status when 4 then 'expired'::public.subscription_status else 'active'::public.subscription_status end,
 now()-interval '2 days',case when n in(3,4) then now()-interval '1 day' else now()+interval '5 days' end,
 case when n=3 then now()-interval '1 day' end,case when n=3 then now()+interval '1 day' end,
 case when n=2 then now()-interval '1 hour' end,now()-interval '3 days' from generate_series(1,13)n;
insert into private.notification_policy(version,consent_version,webpush_enabled,max_attempts,retry_seconds,lease_seconds,schedule_lead_seconds)
values('fictional-schedule-notice','fictional-schedule-consent',true,3,10,30,86400);
insert into private.notification_preferences(user_id,webpush_enabled,new_message,billing,schedule)
select ('ba100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,true,true,true,n<>5 from generate_series(1,14)n where n<>9;
insert into private.push_subscriptions(id,user_id,endpoint,p256dh,auth,consent_version,state,revoked_at,auth_session_id)
select ('ba400000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,('ba100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 'https://push.example.invalid/schedule-'||n,repeat('B',87),repeat('A',22),case when n=10 then 'obsolete' else 'fictional-schedule-consent' end,
 case when n=11 then 'revoked' else 'active' end,case when n=11 then now() end,
 case when n=8 then null else ('ba110000-0000-4000-8000-'||lpad(case when n=13 then 14 else n end::text,12,'0'))::uuid end from generate_series(1,14)n;
insert into public.schedules(id,artist_id,type,status,title,starts_at,created_by)
select ('ba500000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'ba200000-0000-4000-8000-000000000001','event',
 case when n=5 then 'draft'::public.schedule_status else 'published'::public.schedule_status end,'가상 일정 '||n,
 (((clock_timestamp() at time zone 'Asia/Seoul')::date+case n when 3 then 0 when 4 then 2 else 1 end)::timestamp+interval '12 hours') at time zone 'Asia/Seoul',
 'ba100000-0000-4000-8000-000000000015' from generate_series(1,40)n;
insert into public.schedule_notification_optouts(user_id,schedule_id)
select 'ba100000-0000-4000-8000-000000000007',id from public.schedules where id::text like 'ba500000-%';
select is((select count(*) from private.notification_jobs),0::bigint,'publishing never implicitly creates unapproved rolling-hour reminders');
set local role service_role;
select is(public.notification_enqueue('schedule','ba500000-0000-4000-8000-000000000001'),0,'legacy generic enqueue cannot bypass schedule approval');
select throws_ok($$select * from public.schedule_notice_create('ba500000-0000-4000-8000-000000000001')$$,'55000','SCHEDULE_NOTICE_POLICY_NOT_APPROVED','unapproved next-day policy creates no work and reports setup missing');
select throws_ok($$select * from public.schedule_notice_candidates()$$,'55000','SCHEDULE_NOTICE_POLICY_NOT_APPROVED','unapproved next-day policy reports setup missing');
select throws_ok($$select * from public.schedule_notice_candidates(0)$$,'22023','SCHEDULE_NOTICE_LIMIT_INVALID','zero batch limit rejected');
select throws_ok($$select * from public.schedule_notice_candidates(21)$$,'22023','SCHEDULE_NOTICE_LIMIT_INVALID','unbounded batch rejected');
select throws_ok($$select * from public.schedule_notice_candidates(null)$$,'22023','SCHEDULE_NOTICE_LIMIT_INVALID','null batch limit rejected');
select throws_ok($$select * from public.schedule_notice_create(null)$$,'22004','SCHEDULE_NOTICE_INVALID_INPUT','null event rejected');
select is((select push_jobs from public.schedule_notice_create(gen_random_uuid())),0,'missing event is opaque no-op');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','ba100000-0000-4000-8000-000000000001',true);
select is((select configured from public.schedule_notice_preferences()),false,'UI reports no approved policy');
select is((select hour_kst from public.schedule_notice_preferences()),null::integer,'UI does not invent approved hour');
select is((select event_enabled from public.schedule_notice_preferences()),null::boolean,'global projection does not invent event preference');
select ok((select schedule_enabled and webpush_enabled from public.schedule_notice_preferences()),'global projection belongs to current fan');
select ok((select event_enabled and eligible from public.schedule_notice_preferences('ba500000-0000-4000-8000-000000000001')),'my artist is current access not following assumption');
select throws_ok($$select * from public.schedule_notice_preferences('ba500000-0000-4000-8000-000000000005')$$,'42501','SCHEDULE_UNAVAILABLE','draft event cannot leak private preference projection');
select throws_ok($$select * from public.schedule_notice_set_preference(null)$$,'22004','SCHEDULE_NOTICE_INVALID_INPUT','null global preference rejected');
select throws_ok($$select * from public.schedule_notice_set_event(null,true)$$,'22004','SCHEDULE_NOTICE_INVALID_INPUT','null event preference target rejected');
select is((select schedule_enabled from public.schedule_notice_set_preference(false)),false,'explicit disable returns fresh global state');
select is((select schedule_enabled from public.schedule_notice_set_preference(false)),false,'repeated global disable is idempotent');
select is((select schedule_enabled from public.schedule_notice_set_preference(true)),true,'explicit enable saved without policy activation');
select set_config('request.jwt.claim.sub','ba100000-0000-4000-8000-000000000014',true);
select is((select eligible from public.schedule_notice_preferences('ba500000-0000-4000-8000-000000000001')),false,'non-subscriber is not eligible');
select is((select event_enabled from public.schedule_notice_set_event('ba500000-0000-4000-8000-000000000001',false)),false,'non-subscriber can preserve event opt-out for later access');
select is((select event_enabled from public.schedule_notice_set_event('ba500000-0000-4000-8000-000000000001',true)),true,'explicit repeat-safe event enable');
select set_config('request.jwt.claim.sub','ba100000-0000-4000-8000-000000000006',true);
select throws_ok($$select * from public.schedule_notice_preferences()$$,'42501','CALENDAR_FORBIDDEN','restricted fan cannot read preference state');
select set_config('request.jwt.claim.sub','ba100000-0000-4000-8000-000000000015',true);
select throws_ok($$select * from public.schedule_notice_preferences()$$,'42501','NOTIFICATION_ACTOR_FORBIDDEN','admin is not implicitly a fan recipient');
reset role;
select ok((select new_message and billing and webpush_enabled from private.notification_preferences where user_id='ba100000-0000-4000-8000-000000000001'),'global schedule setting preserved other consent choices');
insert into private.schedule_notice_policies(version,hour_kst,approved_at,published_at)
values('ba600000-0000-4000-8000-000000000001',0,now()-interval '1 day',now()-interval '1 day');
insert into private.schedule_notice_policy_current(policy_version) values('ba600000-0000-4000-8000-000000000001');
select throws_ok($$update private.schedule_notice_policies set hour_kst=10$$,'23514','SCHEDULE_NOTICE_POLICY_IMMUTABLE','approved policy cannot be rewritten');
select throws_ok($$delete from private.schedule_notice_policies$$,'23514','SCHEDULE_NOTICE_POLICY_IMMUTABLE','approved policy cannot be deleted');
select throws_ok($$truncate private.schedule_notice_policies cascade$$,'23514','SCHEDULE_NOTICE_POLICY_IMMUTABLE','truncate cannot erase approved policy');
select throws_ok($$insert into private.schedule_notice_policies values(gen_random_uuid(),24,null,null)$$,'23514',null,'invalid hour prohibited at storage boundary');
set local role authenticated;
select set_config('request.jwt.claim.sub','ba100000-0000-4000-8000-000000000001',true);
select ok((select configured and hour_kst=0 from public.schedule_notice_preferences()),'only explicitly published fixture policy is reported');
reset role;
set local role service_role;
select is((select count(*) from public.schedule_notice_candidates(20)),20::bigint,'candidate scan bounded to requested event count');
insert into schedule_notice_context(key,id) select 'cursor-first',schedule_id from public.schedule_notice_candidates(1);
select is((select count(*) from public.schedule_notice_candidates(20)),20::bigint,'rotating cursor wraps with bounded backlog instead of starving');
select is((select push_jobs from public.schedule_notice_create('ba500000-0000-4000-8000-000000000001')),3,'only active canceled-paid-through and grace eligible fans enqueue');
select is((select created from public.schedule_notice_create('ba500000-0000-4000-8000-000000000001')),false,'replay never reports duplicate creation');
select is((select push_jobs from public.schedule_notice_create('ba500000-0000-4000-8000-000000000001')),0,'replay cannot duplicate queue identities');
select is((select push_jobs from public.schedule_notice_create('ba500000-0000-4000-8000-000000000003')),0,'same-day schedule excluded');
select is((select push_jobs from public.schedule_notice_create('ba500000-0000-4000-8000-000000000004')),0,'day-after schedule excluded');
select is((select push_jobs from public.schedule_notice_create('ba500000-0000-4000-8000-000000000005')),0,'draft schedule excluded');
reset role;
select is((select count(*) from private.notification_jobs where source_id='ba500000-0000-4000-8000-000000000001'),3::bigint,'one queue row per source and consented device');
select ok((select bool_and(schedule_notice_policy_version='ba600000-0000-4000-8000-000000000001' and schedule_notice_starts_at=s.starts_at)
 from private.notification_jobs j join public.schedules s on s.id=j.source_id),'queue records approved policy and exact event instant');
select ok(not exists(select 1 from private.notification_jobs where user_id in(select id from public.profiles where id::text like 'ba100000-%' and right(id::text,12)::bigint between 4 and 14)),'expired restricted opted-out unsupported devices never enqueue');
insert into schedule_notice_context(key,id) select 'deliver',id from private.notification_jobs where source_id='ba500000-0000-4000-8000-000000000001' and user_id='ba100000-0000-4000-8000-000000000001';
set local role service_role;
select is((select count(*) from public.webpush_list_due()),3::bigint,'real worker discovers authorized schedule source');
update schedule_notice_context set token=c.lease_token from public.notification_claim((select id from schedule_notice_context where key='deliver'))c where key='deliver';
select is((select source_kind from public.webpush_prepare_delivery((select id from schedule_notice_context where key='deliver'),(select token from schedule_notice_context where key='deliver'))),'schedule','existing delivery adapter receives only safe source discriminator');
select is((select count(*) from public.webpush_prepare_delivery((select id from schedule_notice_context where key='deliver'),(select token from schedule_notice_context where key='deliver'))),0::bigint,'one token cannot prepare delivery twice');
select is(public.webpush_complete((select id from schedule_notice_context where key='deliver'),(select token from schedule_notice_context where key='deliver'),'provider_accepted','ba700000-0000-4000-8000-000000000001'),'provider_accepted','provider acceptance remains explicit not device receipt');
reset role;
select ok(not exists(select 1 from information_schema.columns where table_schema='private' and table_name='notification_jobs' and column_name in('delivered_at','read_at','phone','payload')),'schedule feature stores no invented delivery receipt or personalized payload');

savepoint scenario_2;
set local role service_role;
select is((select push_jobs from public.schedule_notice_create('ba500000-0000-4000-8000-000000000002')),3,'event-optout fixture created eligible jobs');
reset role;
insert into schedule_notice_context(key,id) select 'event-optout',id from private.notification_jobs where source_id='ba500000-0000-4000-8000-000000000002' and user_id='ba100000-0000-4000-8000-000000000001';
set local role service_role;
update schedule_notice_context set token=c.lease_token from public.notification_claim((select id from schedule_notice_context where key='event-optout'))c where key='event-optout';
reset role;
set local role authenticated; select set_config('request.jwt.claim.sub','ba100000-0000-4000-8000-000000000001',true); select event_enabled from public.schedule_notice_set_event('ba500000-0000-4000-8000-000000000002',false); reset role;
set local role service_role;
select is((select count(*) from public.webpush_prepare_delivery((select id from schedule_notice_context where key='event-optout'),(select token from schedule_notice_context where key='event-optout'))),0::bigint,'event-optout after lease cannot cross final send fence');
reset role;
select is((select state from private.notification_jobs where id=(select id from schedule_notice_context where key='event-optout')),'canceled','event-optout suppresses unsent job durably');
select is((select state from private.notification_attempts where token=(select token from schedule_notice_context where key='event-optout')),'not_sent','event-optout unprepared attempt never fabricates unknown delivery');
rollback to scenario_2;

savepoint scenario_6;
set local role service_role;
select is((select push_jobs from public.schedule_notice_create('ba500000-0000-4000-8000-000000000006')),3,'global-optout fixture created eligible jobs');
reset role;
insert into schedule_notice_context(key,id) select 'global-optout',id from private.notification_jobs where source_id='ba500000-0000-4000-8000-000000000006' and user_id='ba100000-0000-4000-8000-000000000001';
set local role service_role;
update schedule_notice_context set token=c.lease_token from public.notification_claim((select id from schedule_notice_context where key='global-optout'))c where key='global-optout';
reset role;
set local role authenticated; select set_config('request.jwt.claim.sub','ba100000-0000-4000-8000-000000000001',true); select schedule_enabled from public.schedule_notice_set_preference(false); reset role;
set local role service_role;
select is((select count(*) from public.webpush_prepare_delivery((select id from schedule_notice_context where key='global-optout'),(select token from schedule_notice_context where key='global-optout'))),0::bigint,'global-optout after lease cannot cross final send fence');
reset role;
select is((select state from private.notification_jobs where id=(select id from schedule_notice_context where key='global-optout')),'canceled','global-optout suppresses unsent job durably');
select is((select state from private.notification_attempts where token=(select token from schedule_notice_context where key='global-optout')),'not_sent','global-optout unprepared attempt never fabricates unknown delivery');
rollback to scenario_6;

savepoint scenario_7;
set local role service_role;
select is((select push_jobs from public.schedule_notice_create('ba500000-0000-4000-8000-000000000007')),3,'reschedule fixture created eligible jobs');
reset role;
insert into schedule_notice_context(key,id) select 'reschedule',id from private.notification_jobs where source_id='ba500000-0000-4000-8000-000000000007' and user_id='ba100000-0000-4000-8000-000000000001';
set local role service_role;
update schedule_notice_context set token=c.lease_token from public.notification_claim((select id from schedule_notice_context where key='reschedule'))c where key='reschedule';
reset role;
update public.schedules set starts_at=starts_at+interval '1 day' where id='ba500000-0000-4000-8000-000000000007';
set local role service_role;
select is((select count(*) from public.webpush_prepare_delivery((select id from schedule_notice_context where key='reschedule'),(select token from schedule_notice_context where key='reschedule'))),0::bigint,'reschedule after lease cannot cross final send fence');
reset role;
select is((select state from private.notification_jobs where id=(select id from schedule_notice_context where key='reschedule')),'canceled','reschedule suppresses unsent job durably');
select is((select state from private.notification_attempts where token=(select token from schedule_notice_context where key='reschedule')),'not_sent','reschedule unprepared attempt never fabricates unknown delivery');
rollback to scenario_7;

savepoint scenario_8;
set local role service_role;
select is((select push_jobs from public.schedule_notice_create('ba500000-0000-4000-8000-000000000008')),3,'unpublish fixture created eligible jobs');
reset role;
insert into schedule_notice_context(key,id) select 'unpublish',id from private.notification_jobs where source_id='ba500000-0000-4000-8000-000000000008' and user_id='ba100000-0000-4000-8000-000000000001';
set local role service_role;
update schedule_notice_context set token=c.lease_token from public.notification_claim((select id from schedule_notice_context where key='unpublish'))c where key='unpublish';
reset role;
update public.schedules set status='draft' where id='ba500000-0000-4000-8000-000000000008';
set local role service_role;
select is((select count(*) from public.webpush_prepare_delivery((select id from schedule_notice_context where key='unpublish'),(select token from schedule_notice_context where key='unpublish'))),0::bigint,'unpublish after lease cannot cross final send fence');
reset role;
select is((select state from private.notification_jobs where id=(select id from schedule_notice_context where key='unpublish')),'canceled','unpublish suppresses unsent job durably');
select is((select state from private.notification_attempts where token=(select token from schedule_notice_context where key='unpublish')),'not_sent','unpublish unprepared attempt never fabricates unknown delivery');
rollback to scenario_8;

savepoint scenario_9;
set local role service_role;
select is((select push_jobs from public.schedule_notice_create('ba500000-0000-4000-8000-000000000009')),3,'delete fixture created eligible jobs');
reset role;
insert into schedule_notice_context(key,id) select 'delete',id from private.notification_jobs where source_id='ba500000-0000-4000-8000-000000000009' and user_id='ba100000-0000-4000-8000-000000000001';
set local role service_role;
update schedule_notice_context set token=c.lease_token from public.notification_claim((select id from schedule_notice_context where key='delete'))c where key='delete';
reset role;
delete from public.schedules where id='ba500000-0000-4000-8000-000000000009';
set local role service_role;
select is((select count(*) from public.webpush_prepare_delivery((select id from schedule_notice_context where key='delete'),(select token from schedule_notice_context where key='delete'))),0::bigint,'delete after lease cannot cross final send fence');
reset role;
select is((select state from private.notification_jobs where id=(select id from schedule_notice_context where key='delete')),'canceled','delete suppresses unsent job durably');
select is((select state from private.notification_attempts where token=(select token from schedule_notice_context where key='delete')),'not_sent','delete unprepared attempt never fabricates unknown delivery');
rollback to scenario_9;

savepoint scenario_10;
set local role service_role;
select is((select push_jobs from public.schedule_notice_create('ba500000-0000-4000-8000-000000000010')),3,'restriction fixture created eligible jobs');
reset role;
insert into schedule_notice_context(key,id) select 'restriction',id from private.notification_jobs where source_id='ba500000-0000-4000-8000-000000000010' and user_id='ba100000-0000-4000-8000-000000000001';
set local role service_role;
update schedule_notice_context set token=c.lease_token from public.notification_claim((select id from schedule_notice_context where key='restriction'))c where key='restriction';
reset role;
update public.profiles set is_restricted=true where id='ba100000-0000-4000-8000-000000000001';
set local role service_role;
select is((select count(*) from public.webpush_prepare_delivery((select id from schedule_notice_context where key='restriction'),(select token from schedule_notice_context where key='restriction'))),0::bigint,'restriction after lease cannot cross final send fence');
reset role;
select is((select state from private.notification_jobs where id=(select id from schedule_notice_context where key='restriction')),'canceled','restriction suppresses unsent job durably');
select is((select state from private.notification_attempts where token=(select token from schedule_notice_context where key='restriction')),'not_sent','restriction unprepared attempt never fabricates unknown delivery');
rollback to scenario_10;

savepoint scenario_11;
set local role service_role;
select is((select push_jobs from public.schedule_notice_create('ba500000-0000-4000-8000-000000000011')),3,'artist-pause fixture created eligible jobs');
reset role;
insert into schedule_notice_context(key,id) select 'artist-pause',id from private.notification_jobs where source_id='ba500000-0000-4000-8000-000000000011' and user_id='ba100000-0000-4000-8000-000000000001';
set local role service_role;
update schedule_notice_context set token=c.lease_token from public.notification_claim((select id from schedule_notice_context where key='artist-pause'))c where key='artist-pause';
reset role;
update public.artists set status='paused' where id='ba200000-0000-4000-8000-000000000001';
set local role service_role;
select is((select count(*) from public.webpush_prepare_delivery((select id from schedule_notice_context where key='artist-pause'),(select token from schedule_notice_context where key='artist-pause'))),0::bigint,'artist-pause after lease cannot cross final send fence');
reset role;
select is((select state from private.notification_jobs where id=(select id from schedule_notice_context where key='artist-pause')),'canceled','artist-pause suppresses unsent job durably');
select is((select state from private.notification_attempts where token=(select token from schedule_notice_context where key='artist-pause')),'not_sent','artist-pause unprepared attempt never fabricates unknown delivery');
rollback to scenario_11;

savepoint scenario_12;
set local role service_role;
select is((select push_jobs from public.schedule_notice_create('ba500000-0000-4000-8000-000000000012')),3,'access-expiry fixture created eligible jobs');
reset role;
insert into schedule_notice_context(key,id) select 'access-expiry',id from private.notification_jobs where source_id='ba500000-0000-4000-8000-000000000012' and user_id='ba100000-0000-4000-8000-000000000001';
set local role service_role;
update schedule_notice_context set token=c.lease_token from public.notification_claim((select id from schedule_notice_context where key='access-expiry'))c where key='access-expiry';
reset role;
update public.subscriptions set current_period_end=clock_timestamp()-interval '1 second' where id='ba300000-0000-4000-8000-000000000001';
set local role service_role;
select is((select count(*) from public.webpush_prepare_delivery((select id from schedule_notice_context where key='access-expiry'),(select token from schedule_notice_context where key='access-expiry'))),0::bigint,'access-expiry after lease cannot cross final send fence');
reset role;
select is((select state from private.notification_jobs where id=(select id from schedule_notice_context where key='access-expiry')),'canceled','access-expiry suppresses unsent job durably');
select is((select state from private.notification_attempts where token=(select token from schedule_notice_context where key='access-expiry')),'not_sent','access-expiry unprepared attempt never fabricates unknown delivery');
rollback to scenario_12;

savepoint scenario_13;
set local role service_role;
select is((select push_jobs from public.schedule_notice_create('ba500000-0000-4000-8000-000000000013')),3,'logout fixture created eligible jobs');
reset role;
insert into schedule_notice_context(key,id) select 'logout',id from private.notification_jobs where source_id='ba500000-0000-4000-8000-000000000013' and user_id='ba100000-0000-4000-8000-000000000001';
set local role service_role;
update schedule_notice_context set token=c.lease_token from public.notification_claim((select id from schedule_notice_context where key='logout'))c where key='logout';
reset role;
delete from auth.sessions where id='ba110000-0000-4000-8000-000000000001';
set local role service_role;
select is((select count(*) from public.webpush_prepare_delivery((select id from schedule_notice_context where key='logout'),(select token from schedule_notice_context where key='logout'))),0::bigint,'logout after lease cannot cross final send fence');
reset role;
select is((select state from private.notification_jobs where id=(select id from schedule_notice_context where key='logout')),'canceled','logout suppresses unsent job durably');
select is((select state from private.notification_attempts where token=(select token from schedule_notice_context where key='logout')),'not_sent','logout unprepared attempt never fabricates unknown delivery');
rollback to scenario_13;

savepoint scenario_14;
set local role service_role;
select is((select push_jobs from public.schedule_notice_create('ba500000-0000-4000-8000-000000000014')),3,'policy-removal fixture created eligible jobs');
reset role;
insert into schedule_notice_context(key,id) select 'policy-removal',id from private.notification_jobs where source_id='ba500000-0000-4000-8000-000000000014' and user_id='ba100000-0000-4000-8000-000000000001';
set local role service_role;
update schedule_notice_context set token=c.lease_token from public.notification_claim((select id from schedule_notice_context where key='policy-removal'))c where key='policy-removal';
reset role;
delete from private.schedule_notice_policy_current;
set local role service_role;
select is((select count(*) from public.webpush_prepare_delivery((select id from schedule_notice_context where key='policy-removal'),(select token from schedule_notice_context where key='policy-removal'))),0::bigint,'policy-removal after lease cannot cross final send fence');
reset role;
select is((select state from private.notification_jobs where id=(select id from schedule_notice_context where key='policy-removal')),'canceled','policy-removal suppresses unsent job durably');
select is((select state from private.notification_attempts where token=(select token from schedule_notice_context where key='policy-removal')),'not_sent','policy-removal unprepared attempt never fabricates unknown delivery');
rollback to scenario_14;

-- A stale session cannot receive even the legacy claim endpoint projection.
savepoint before_session_claim;
set local role service_role;
select * from public.schedule_notice_create('ba500000-0000-4000-8000-000000000022');
reset role;
insert into schedule_notice_context(key,id) select 'session-claim',id from private.notification_jobs
 where source_id='ba500000-0000-4000-8000-000000000022' and user_id='ba100000-0000-4000-8000-000000000001';
update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id='ba110000-0000-4000-8000-000000000001';
set local role service_role;
select is((select count(*) from public.notification_claim((select id from schedule_notice_context where key='session-claim'))),0::bigint,'expired session blocks claim endpoint projection');
reset role;
select is((select attempt_count from private.notification_jobs where id=(select id from schedule_notice_context where key='session-claim')),0,'expired session consumes no delivery lease');
rollback to before_session_claim;

-- Lifetime source/device dedupe cannot resurrect canceled work after opt-in.
set local role service_role;
select * from public.schedule_notice_create('ba500000-0000-4000-8000-000000000020');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','ba100000-0000-4000-8000-000000000001',true);
select * from public.schedule_notice_set_event('ba500000-0000-4000-8000-000000000020',false);
select * from public.schedule_notice_set_event('ba500000-0000-4000-8000-000000000020',true);
reset role;
set local role service_role;
select is((select push_jobs from public.schedule_notice_create('ba500000-0000-4000-8000-000000000020')),0,'re-opt-in never resurrects prior source/device job');
reset role;
select is((select state from private.notification_jobs where source_id='ba500000-0000-4000-8000-000000000020' and user_id='ba100000-0000-4000-8000-000000000001'),'canceled','optout history remains durable');
-- Approved policy pointer replacement cannot authorize an old queued snapshot.
set local role service_role;
select * from public.schedule_notice_create('ba500000-0000-4000-8000-000000000021');
reset role;
insert into private.schedule_notice_policies values('ba600000-0000-4000-8000-000000000002',0,now()-interval '1 day',now()-interval '1 day');
update private.schedule_notice_policy_current set policy_version='ba600000-0000-4000-8000-000000000002';
insert into schedule_notice_context(key,id) select 'stale-policy',id from private.notification_jobs where source_id='ba500000-0000-4000-8000-000000000021' and user_id='ba100000-0000-4000-8000-000000000001';
set local role service_role;
select is((select count(*) from public.notification_claim((select id from schedule_notice_context where key='stale-policy'))),0::bigint,'new approved policy does not relabel old snapshot');
reset role;
select is((select state from private.notification_jobs where id=(select id from schedule_notice_context where key='stale-policy')),'canceled','stale policy job cannot be leased');
select * from finish();
rollback;
