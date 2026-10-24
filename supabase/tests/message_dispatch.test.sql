begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
set local timezone='UTC';
select no_plan();
select is((select count(*) from private.artist_dispatch_submissions),0::bigint,'migration has no fictional published content');
select is((select count(*) from private.artist_dispatch_operations),0::bigint,'migration does not create operation receipts');
select ok((select bool_and(relrowsecurity) from pg_class where oid in('private.artist_dispatch_submissions'::regclass,'private.artist_dispatch_operations'::regclass)),'private dispatch tables enable RLS');
select ok((select bool_and(not has_table_privilege(role,relation,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'))
 from unnest(array['anon','authenticated','service_role']) role cross join unnest(array['private.artist_dispatch_submissions','private.artist_dispatch_operations']) relation),'API roles cannot read or forge private dispatch state');
select ok((select bool_and(prosecdef and 'search_path=""'=any(proconfig)) from pg_proc where oid in(
 'public.artist_dispatch_context(text,uuid,timestamptz,uuid)'::regprocedure,'public.artist_dispatch_submit(text,uuid,uuid,bigint,timestamptz)'::regprocedure,
 'public.artist_dispatch_cancel(text,uuid,uuid)'::regprocedure,'public.message_dispatch_run(integer)'::regprocedure)),'public dispatch functions pin security definer paths');
select ok((select bool_and(has_function_privilege('authenticated',fn,'EXECUTE') and not has_function_privilege('anon',fn,'EXECUTE')
 and not has_function_privilege('service_role',fn,'EXECUTE')) from unnest(array['public.artist_dispatch_context(text,uuid,timestamptz,uuid)',
 'public.artist_dispatch_submit(text,uuid,uuid,bigint,timestamptz)','public.artist_dispatch_cancel(text,uuid,uuid)']) fn),'artist APIs derive authenticated subject instead of accepting actor input');
select ok(has_function_privilege('service_role','public.message_dispatch_run(integer)','EXECUTE') and not has_function_privilege('authenticated','public.message_dispatch_run(integer)','EXECUTE'),'only the server can run due work');
select ok((select bool_and(not has_function_privilege('service_role',fn,'EXECUTE')) from unnest(array[
 'private.messaging_schedule_legacy(uuid,uuid,timestamptz)','private.messaging_cancel_legacy(uuid,uuid)','private.messaging_dispatch_legacy(uuid)',
 'private.notification_enqueue_source_legacy(text,uuid)','private.artist_dispatch_projection(uuid,timestamptz)']) fn),'internal compatibility and projection routines are not RPC bypasses');

insert into auth.users(id,email,raw_user_meta_data)
select ('fa100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'dispatch-fixture-'||n||'@example.invalid','{}'::jsonb from generate_series(1,9) n;
update public.profiles set call_name='가상 구독자',onboarding_completed_at=now() where id::text like 'fa100000-%';
update public.profiles set role='artist' where id in('fa100000-0000-4000-8000-000000000001','fa100000-0000-4000-8000-000000000002','fa100000-0000-4000-8000-000000000008');
update public.profiles set onboarding_completed_at=null where id='fa100000-0000-4000-8000-000000000006';
update public.profiles set is_restricted=true where id='fa100000-0000-4000-8000-000000000007';
insert into public.artists(id,slug,name,grade,status) values('fa200000-0000-4000-8000-000000000001','dispatch-test','가상 발행 가수','B','active');
insert into public.artist_members(artist_id,user_id) values('fa200000-0000-4000-8000-000000000001','fa100000-0000-4000-8000-000000000001'),('fa200000-0000-4000-8000-000000000001','fa100000-0000-4000-8000-000000000002');
insert into private.message_policy values(true,'fictional-dispatch-policy',604800,300,1000,100,2,180,60,5,1000,2000,3000);
insert into private.profile_onboarding_policy values(true,'fa900000-0000-4000-8000-000000000001',now(),2,10,array['금지단어'],null,null,null);
insert into public.subscriptions(id,user_id,artist_id,provider,status,first_started_at,episode_started_at,current_period_start,current_period_end,canceled_at,
 grace_started_at,grace_ends_at)
select ('fa300000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,('fa100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 'fa200000-0000-4000-8000-000000000001','toss',case when n=4 then 'canceled' when n=5 then 'expired' when n=9 then 'grace' else 'active' end::public.subscription_status,
 now()-interval '1 day',now()-interval '1 day',now()-interval '1 day',case when n=5 or n=9 then now()-interval '1 hour' else now()+interval '1 day' end,
 case when n=4 then now() end,case when n=9 then now()-interval '1 hour' end,case when n=9 then now()+interval '1 day' end from generate_series(3,9) n;
create temporary table dispatch_context(key text primary key,data jsonb);
grant all on dispatch_context to authenticated,service_role;
set local role authenticated;
select set_config('request.jwt.claim.sub','fa100000-0000-4000-8000-000000000001',true);
select is(public.artist_dispatch_context('dispatch-test')->'messages','[]'::jsonb,'artist history starts empty');
select is((public.artist_dispatch_context('dispatch-test')->>'cancel_window_seconds')::integer,300,'cancellation window comes from actual policy');
select throws_ok($$select public.artist_dispatch_context('dispatch-test',null,now(),null)$$,'22023','DISPATCH_INVALID_INPUT','history cursor requires timestamp and ID together');
select throws_ok($$select public.artist_dispatch_context('dispatch-test',null,'infinity',gen_random_uuid())$$,'22023','DISPATCH_INVALID_INPUT','infinite cursor rejected');
select public.artist_compose_save('dispatch-test','fa400000-0000-4000-8000-000000000001','fa500000-0000-4000-8000-000000000001',0,'text','안녕 {이름}');
select throws_ok($$select public.artist_dispatch_submit('dispatch-test','fa400000-0000-4000-8000-000000000001',gen_random_uuid(),2)$$,'40001','DISPATCH_REVISION_CONFLICT','stale confirmation cannot dispatch changed content');
select throws_ok($$select public.artist_dispatch_submit('dispatch-test','fa400000-0000-4000-8000-000000000001',gen_random_uuid(),1,now()-interval '1 minute')$$,'22023','DISPATCH_SCHEDULE_INVALID','past schedule never silently becomes immediate');
select throws_ok($$select public.artist_dispatch_submit('dispatch-test','fa400000-0000-4000-8000-000000000001',gen_random_uuid(),1,'infinity')$$,'22023','DISPATCH_INVALID_INPUT','infinite schedule rejected');
insert into dispatch_context values('first',public.artist_dispatch_submit('dispatch-test','fa400000-0000-4000-8000-000000000001','fa600000-0000-4000-8000-000000000001',1));
select is((select data->>'status' from dispatch_context where key='first'),'sent','immediate confirmation really publishes in-app');
select is((select data->>'notification_state' from dispatch_context where key='first'),'not_queued','missing notification setup does not pretend provider delivery');
select is((select (data->>'revision')::bigint from dispatch_context where key='first'),2::bigint,'dispatch advances draft revision');
select is((select data->>'body' from dispatch_context where key='first'),'안녕 {이름}','artist-owned history retains the raw template only for its owner');
select is((select string_agg(k,',' order by k) from jsonb_object_keys((select data from dispatch_context where key='first')) k),
 'body,can_cancel,cancel_before,canceled_at,created_at,dispatch_error,id,kind,media,notification_state,revision,scheduled_at,sent_at,status','receipt contains only deliberate artist-facing fields');
select is(public.artist_dispatch_submit('dispatch-test','fa400000-0000-4000-8000-000000000001','fa600000-0000-4000-8000-000000000001',1),
 (select data from dispatch_context where key='first'),'lost immediate response replays without duplicate effect');
select throws_ok($$select public.artist_dispatch_submit('dispatch-test','fa400000-0000-4000-8000-000000000001','fa600000-0000-4000-8000-000000000001',2)$$,'23505','DISPATCH_OPERATION_CONFLICT','same operation cannot acquire changed revision');
select throws_ok($$select public.artist_dispatch_submit('dispatch-test','fa400000-0000-4000-8000-000000000001',gen_random_uuid(),2)$$,'55000','DISPATCH_NOT_DRAFT','second operation cannot publish a sent message again');
select throws_ok($$select public.artist_compose_save('dispatch-test','fa400000-0000-4000-8000-000000000001',gen_random_uuid(),2,'text','changed')$$,'55000','COMPOSE_NOT_DRAFT','published content is immutable through composer');
select is(jsonb_array_length(public.artist_compose_context('dispatch-test')->'drafts'),0,'published draft disappears from drafts');
select is(public.artist_dispatch_context('dispatch-test','fa400000-0000-4000-8000-000000000001')->'selected_message'->>'status','sent','exact selected receipt restores after draft disappears');
select set_config('request.jwt.claim.sub','fa100000-0000-4000-8000-000000000002',true);
select is(public.artist_dispatch_context('dispatch-test')->'messages','[]'::jsonb,'teammate history does not disclose another owner content');
select throws_ok($$select public.artist_dispatch_cancel('dispatch-test','fa400000-0000-4000-8000-000000000001',gen_random_uuid())$$,'P0002','DISPATCH_NOT_FOUND','teammate cannot cancel another owner publication');
select set_config('request.jwt.claim.sub','fa100000-0000-4000-8000-000000000003',true);
select throws_ok($$select public.artist_dispatch_context('dispatch-test')$$,'42501','COMPOSE_FORBIDDEN','fan cannot use artist dispatch APIs');
reset role;
set local role service_role;
select throws_ok($$select public.messaging_schedule('fa100000-0000-4000-8000-000000000002','fa400000-0000-4000-8000-000000000001',now())$$,'42501','COMPOSE_MANAGED_DRAFT','legacy scheduling cannot bypass owned confirmation');
select throws_ok($$select public.messaging_cancel('fa100000-0000-4000-8000-000000000002','fa400000-0000-4000-8000-000000000001')$$,'42501','COMPOSE_MANAGED_DRAFT','legacy cancellation cannot bypass owner authorization');
select throws_ok($$select public.messaging_dispatch('fa400000-0000-4000-8000-000000000001')$$,'42501','COMPOSE_MANAGED_DRAFT','legacy dispatcher cannot bypass managed worker');
select throws_ok($$select public.message_dispatch_run(0)$$,'22023','DISPATCH_INVALID_INPUT','worker rejects zero batch');
select throws_ok($$select public.message_dispatch_run(21)$$,'22023','DISPATCH_INVALID_INPUT','worker rejects oversized batch');
select is((public.message_dispatch_run()->>'published')::integer,0,'worker does not republish existing sent message');
reset role;
select is((select count(*) from private.artist_dispatch_operations),1::bigint,'replays consume no extra operation/rate allowance');
select ok(private.message_is_visible('fa100000-0000-4000-8000-000000000003','fa400000-0000-4000-8000-000000000001',false,clock_timestamp()),'active fan sees the actual in-app publication');
select ok(private.message_is_visible('fa100000-0000-4000-8000-000000000004','fa400000-0000-4000-8000-000000000001',false,clock_timestamp()),'paid canceled subscription still sees in-app message');
select ok(private.message_is_visible('fa100000-0000-4000-8000-000000000009','fa400000-0000-4000-8000-000000000001',false,clock_timestamp()),'grace access remains valid');
select ok(not private.message_is_visible('fa100000-0000-4000-8000-000000000005','fa400000-0000-4000-8000-000000000001',false,clock_timestamp()),'expired fan never obtains publication');

insert into private.notification_policy values(true,'fictional-dispatch-notification','fictional-dispatch-consent',true,2,10,30,86400);
insert into private.notification_preferences(user_id,webpush_enabled,new_message,billing,schedule)
select id,true,true,false,false from public.profiles where id::text like 'fa100000-%';
insert into private.push_subscriptions(user_id,endpoint,p256dh,auth,consent_version)
select id,'https://push.example.invalid/'||id,repeat('B',87),repeat('A',22),'fictional-dispatch-consent' from public.profiles where id::text like 'fa100000-%';
set local role service_role;
select is(public.notification_enqueue('message','fa400000-0000-4000-8000-000000000001'),0,'later notification setup does not notify an old managed publication');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','fa100000-0000-4000-8000-000000000001',true);
select public.artist_compose_save('dispatch-test','fa400000-0000-4000-8000-000000000002','fa500000-0000-4000-8000-000000000002',0,'text','예약 {이름}');
insert into dispatch_context values('schedule',public.artist_dispatch_submit('dispatch-test','fa400000-0000-4000-8000-000000000002','fa600000-0000-4000-8000-000000000002',1,now()+interval '1 day'));
select is((select data->>'status' from dispatch_context where key='schedule'),'scheduled','future confirmation remains scheduled');
set local timezone='Asia/Seoul';
select is(public.artist_dispatch_submit('dispatch-test','fa400000-0000-4000-8000-000000000002','fa600000-0000-4000-8000-000000000002',1,now()+interval '1 day')->>'status','scheduled','same instant replay is independent of database session timezone');
set local timezone='UTC';

select is((select data->>'notification_state' from dispatch_context where key='schedule'),'not_queued','future content has no premature outbox');
reset role;
select ok(not private.message_is_visible('fa100000-0000-4000-8000-000000000003','fa400000-0000-4000-8000-000000000002',false,clock_timestamp()),'scheduled content is not a fan inbox item');
set local role service_role;
select is((public.message_dispatch_run()->>'published')::integer,0,'future date is not published early');
reset role;
-- Isolated fixture time travel only; real transition always executes the worker.
update public.messages set scheduled_at=clock_timestamp()-interval '1 second' where id='fa400000-0000-4000-8000-000000000002';
update private.artist_dispatch_submissions set next_attempt_at=clock_timestamp()-interval '1 second' where message_id='fa400000-0000-4000-8000-000000000002';
set local role service_role;
select is((public.message_dispatch_run(1)->>'published')::integer,1,'due worker publishes actual scheduled source');
select is((public.message_dispatch_run(1)->>'published')::integer,0,'replayed worker never republishes sent source');
reset role;
select is((select count(*) from private.notification_jobs where source_id='fa400000-0000-4000-8000-000000000002'),3::bigint,'publish-time selection includes active/paid canceled/grace only');
select ok((select bool_and(state='queued' and provider_accepted_at is null and attempt_count=0) from private.notification_jobs),'outbox is pending work, not an invented provider acceptance');
select is((select count(*) from private.notification_jobs where user_id in('fa100000-0000-4000-8000-000000000005','fa100000-0000-4000-8000-000000000006','fa100000-0000-4000-8000-000000000007','fa100000-0000-4000-8000-000000000008')),0::bigint,'expired/unonboarded/restricted/artist identities are excluded');
insert into private.push_subscriptions(user_id,endpoint,p256dh,auth,consent_version)
values('fa100000-0000-4000-8000-000000000003','https://push.example.invalid/later-device',repeat('B',87),repeat('A',22),'fictional-dispatch-consent');
set local role service_role;
select is(public.notification_enqueue('message','fa400000-0000-4000-8000-000000000002'),0,'new device after publication never expands frozen recipient snapshot');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','fa100000-0000-4000-8000-000000000001',true);
select is(public.artist_dispatch_context('dispatch-test','fa400000-0000-4000-8000-000000000002')->'selected_message'->>'notification_state','queued','artist sees queued distinction without recipient identities');
insert into dispatch_context values('cancel',public.artist_dispatch_cancel('dispatch-test','fa400000-0000-4000-8000-000000000002','fa700000-0000-4000-8000-000000000001'));
select is((select data->>'status' from dispatch_context where key='cancel'),'canceled','within-window cancellation is committed');
select is((select data->>'notification_state' from dispatch_context where key='cancel'),'canceled','queued notifications expose cancellation not fake recall');
select is(public.artist_dispatch_cancel('dispatch-test','fa400000-0000-4000-8000-000000000002','fa700000-0000-4000-8000-000000000001'),(select data from dispatch_context where key='cancel'),'lost cancellation response safely replays');
select is(public.artist_dispatch_submit('dispatch-test','fa400000-0000-4000-8000-000000000002','fa600000-0000-4000-8000-000000000002',1,now()+interval '1 day')->>'status','canceled','late original submit retry returns current canceled truth');
select throws_ok($$select public.artist_dispatch_cancel('dispatch-test','fa400000-0000-4000-8000-000000000002','fa600000-0000-4000-8000-000000000002')$$,'23505','DISPATCH_OPERATION_CONFLICT','operation identity cannot switch from submit to cancel');
reset role;
select ok((select bool_and(state='canceled') from private.notification_jobs where source_id='fa400000-0000-4000-8000-000000000002'),'cancellation atomically suppresses all not-yet-claimed jobs');
select ok(not private.message_is_visible('fa100000-0000-4000-8000-000000000003','fa400000-0000-4000-8000-000000000002',false,clock_timestamp()),'canceled in-app content disappears from new fan reads');
update public.messages set scheduled_at=clock_timestamp()-interval '5 minutes',sent_at=clock_timestamp()-interval '5 minutes' where id='fa400000-0000-4000-8000-000000000001';
set local role authenticated;
select throws_ok($$select public.artist_dispatch_cancel('dispatch-test','fa400000-0000-4000-8000-000000000001',gen_random_uuid())$$,'55000','CANCEL_WINDOW_PASSED','cancellation upper boundary is exclusive and server authoritative');
select is((public.artist_dispatch_context('dispatch-test','fa400000-0000-4000-8000-000000000001')->'selected_message'->>'can_cancel')::boolean,false,'history does not offer cancellation after server deadline');
reset role;
select * from finish();
rollback;
