begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
set local timezone='UTC';
select no_plan();
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
select public.artist_compose_save('dispatch-test','fa400000-0000-4000-8000-000000000010','fa500000-0000-4000-8000-000000000010',0,'photo');
select throws_ok($$select public.artist_dispatch_submit('dispatch-test','fa400000-0000-4000-8000-000000000010',gen_random_uuid(),1)$$,'23514','MESSAGE_MEDIA_REQUIRED','media draft cannot publish without its real association');
select public.artist_compose_save('dispatch-test','fa400000-0000-4000-8000-000000000011','fa500000-0000-4000-8000-000000000011',0,'text','pending upload test');
reset role;
-- Existing accepted media API contract; metadata only, no parser/payload probe.
set local role authenticated;
select public.artist_compose_save('dispatch-test','fa400000-0000-4000-8000-000000000010',gen_random_uuid(),1,'photo','기존 사진');
reset role;
set local role service_role;
insert into dispatch_context values('upload',public.media_begin_upload('fa100000-0000-4000-8000-000000000001','fa400000-0000-4000-8000-000000000010','image/png',100,'fa800000-0000-4000-8000-000000000001'));
reset role;
insert into storage.objects(id,bucket_id,name,metadata) select 'fa850000-0000-4000-8000-000000000001','message-media',data->>'object_path','{"mimetype":"image/png","size":100}'::jsonb from dispatch_context where key='upload';
set local role service_role;
select public.media_finalize_upload('fa100000-0000-4000-8000-000000000001',(select (data->>'upload_id')::uuid from dispatch_context where key='upload'),'fa850000-0000-4000-8000-000000000001',10,10,null);
insert into dispatch_context values('pending',public.media_begin_upload('fa100000-0000-4000-8000-000000000001','fa400000-0000-4000-8000-000000000010','image/png',100,'fa800000-0000-4000-8000-000000000002'));
reset role;
set local role authenticated;
select throws_ok($$select public.artist_dispatch_submit('dispatch-test','fa400000-0000-4000-8000-000000000010',gen_random_uuid(),3)$$,'55000','DISPATCH_UPLOAD_PENDING','pending attachment cannot be silently excluded from confirmation');
reset role;
set local role service_role;
select public.media_revoke_upload('fa100000-0000-4000-8000-000000000001',(select (data->>'upload_id')::uuid from dispatch_context where key='pending'));
reset role;
set local role authenticated;
select is(public.artist_dispatch_submit('dispatch-test','fa400000-0000-4000-8000-000000000010','fa600000-0000-4000-8000-000000000010',3)->>'status','sent','existing verified media publishes without copying bytes');
select is(jsonb_array_length(public.artist_dispatch_context('dispatch-test','fa400000-0000-4000-8000-000000000010')->'selected_message'->'media'),1,'same logical media association appears in sent receipt');
reset role;
set local role service_role;
select lives_ok($$select public.media_resolve_read('fa100000-0000-4000-8000-000000000003',(select (data->>'media_id')::uuid from dispatch_context where key='upload'),false)$$,'subscribed fan reuses accepted protected media API after publication');
reset role;
select is((select count(*) from storage.objects where id='fa850000-0000-4000-8000-000000000001'),1::bigint,'publication never creates a second media object');

-- Rollback simulates a worker/connection crash before commit, not a provider call.
set local role authenticated;
select public.artist_dispatch_submit('dispatch-test','fa400000-0000-4000-8000-000000000011','fa600000-0000-4000-8000-000000000011',1,now()+interval '1 day');
reset role;
update public.messages set scheduled_at=clock_timestamp()-interval '1 second' where id='fa400000-0000-4000-8000-000000000011';
update private.artist_dispatch_submissions set next_attempt_at=clock_timestamp()-interval '1 second' where message_id='fa400000-0000-4000-8000-000000000011';
savepoint dispatch_crash;
set local role service_role;
select is((public.message_dispatch_run(1)->>'published')::integer,1,'worker transaction can finish publication before a connection crash');
rollback to dispatch_crash;
reset role;
select is((select status::text from public.messages where id='fa400000-0000-4000-8000-000000000011'),'scheduled','crash rollback restores scheduled source');
select is((select fanout_completed from private.artist_dispatch_submissions where message_id='fa400000-0000-4000-8000-000000000011'),false,'crash rollback also restores fanout state');
update private.message_policy set max_text_length=1;
set local role service_role;
select is((public.message_dispatch_run(1)->>'blocked')::integer,1,'changed content policy blocks only the affected message');
reset role;
select is((select dispatch_error from private.artist_dispatch_submissions where message_id='fa400000-0000-4000-8000-000000000011'),'content_invalid','worker stores safe failure category rather than sensitive SQL text');
select ok((select next_attempt_at>clock_timestamp() from private.artist_dispatch_submissions where message_id='fa400000-0000-4000-8000-000000000011'),'known failure backs off instead of spinning every request');
update private.message_policy set max_text_length=1000;
update private.artist_dispatch_submissions set next_attempt_at=clock_timestamp()-interval '1 second' where message_id='fa400000-0000-4000-8000-000000000011';
update public.artists set status='paused' where id='fa200000-0000-4000-8000-000000000001';
set local role service_role;
select is((public.message_dispatch_run(1)->>'blocked')::integer,1,'author artist suspension is rechecked at actual publication');
reset role;
select is((select dispatch_error from private.artist_dispatch_submissions where message_id='fa400000-0000-4000-8000-000000000011'),'author_unavailable','suspended source is retained for operator-visible retry rather than falsely sent');
update public.artists set status='active' where id='fa200000-0000-4000-8000-000000000001';
update private.artist_dispatch_submissions set next_attempt_at=clock_timestamp()-interval '1 second' where message_id='fa400000-0000-4000-8000-000000000011';
set local role service_role;
select is((public.message_dispatch_run(1)->>'published')::integer,1,'restored prerequisite recovers one scheduled publication');
reset role;
select is((select dispatch_error from private.artist_dispatch_submissions where message_id='fa400000-0000-4000-8000-000000000011'),null,'successful recovery clears old failure');

-- Bounded notification fanout guard, no network and no live recipients.
insert into private.notification_policy values(true,'fictional-dispatch-notification','fictional-dispatch-consent',true,2,10,30,86400);
insert into private.notification_preferences(user_id,webpush_enabled,new_message,billing,schedule) values('fa100000-0000-4000-8000-000000000003',true,true,false,false);
insert into private.push_subscriptions(user_id,endpoint,p256dh,auth,consent_version)
select 'fa100000-0000-4000-8000-000000000003','https://push.example.invalid/fanout-'||n,repeat('B',87),repeat('A',22),'fictional-dispatch-consent' from generate_series(1,5001) n;
set local role authenticated;
select public.artist_compose_save('dispatch-test','fa400000-0000-4000-8000-000000000012','fa500000-0000-4000-8000-000000000012',0,'text','과도한 알림 장치');
select throws_ok($$select public.artist_dispatch_submit('dispatch-test','fa400000-0000-4000-8000-000000000012','fa600000-0000-4000-8000-000000000012',1)$$,'54000','DISPATCH_BACKPRESSURE','overflow aborts whole immediate publication instead of silently truncating fans');
reset role;
select is((select status::text from public.messages where id='fa400000-0000-4000-8000-000000000012'),'draft','fanout overflow leaves saved draft unchanged');
select is((select count(*) from private.artist_dispatch_submissions where message_id='fa400000-0000-4000-8000-000000000012'),0::bigint,'fanout overflow rolls back submission receipt');
select is((select count(*) from private.notification_jobs where source_id='fa400000-0000-4000-8000-000000000012'),0::bigint,'fanout overflow creates no partial notification set');
set local role authenticated;
select public.artist_dispatch_submit('dispatch-test','fa400000-0000-4000-8000-000000000012','fa600000-0000-4000-8000-000000000012',1,now()+interval '1 day');
reset role;
update public.messages set scheduled_at=clock_timestamp()-interval '1 second' where id='fa400000-0000-4000-8000-000000000012';
update private.artist_dispatch_submissions set next_attempt_at=clock_timestamp()-interval '1 second' where message_id='fa400000-0000-4000-8000-000000000012';
set local role service_role;
select is((public.message_dispatch_run(1)->>'blocked')::integer,1,'scheduled overflow is retained as blocked not dropped');
reset role;
select is((select dispatch_error from private.artist_dispatch_submissions where message_id='fa400000-0000-4000-8000-000000000012'),'backpressure','artist can distinguish capacity blocker');
select is((select status::text from public.messages where id='fa400000-0000-4000-8000-000000000012'),'scheduled','blocked due publication stays unpublished');
update private.push_subscriptions set state='revoked',revoked_at=clock_timestamp();

-- One thousand distinct fictional subscribers, not a provider-throughput claim.
insert into auth.users(id,email,raw_user_meta_data)
select ('fb100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'dispatch-load-'||n||'@example.invalid','{}'::jsonb from generate_series(1,1000) n;
update public.profiles set call_name='허구 팬',onboarding_completed_at=now() where id::text like 'fb100000-%';
insert into public.subscriptions(id,user_id,artist_id,provider,status,first_started_at,episode_started_at,current_period_start,current_period_end)
select ('fb300000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,('fb100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 'fa200000-0000-4000-8000-000000000001','toss','active',now()-interval '1 day',now()-interval '1 day',now()-interval '1 day',now()+interval '1 day' from generate_series(1,1000) n;
insert into private.notification_preferences(user_id,webpush_enabled,new_message,billing,schedule)
select id,true,true,false,false from public.profiles where id::text like 'fb100000-%';
insert into private.push_subscriptions(user_id,endpoint,p256dh,auth,consent_version)
select id,'https://push.example.invalid/thousand-'||id,repeat('B',87),repeat('A',22),'fictional-dispatch-consent' from public.profiles where id::text like 'fb100000-%';
update private.artist_dispatch_submissions set next_attempt_at=clock_timestamp()-interval '1 second' where message_id='fa400000-0000-4000-8000-000000000012';
set local role service_role;
select is((public.message_dispatch_run(1)->>'published')::integer,1,'one transaction publishes to one thousand eligible fictional subscribers');
select is(public.notification_enqueue('message','fa400000-0000-4000-8000-000000000012'),0,'large fanout replay is duplicate-free');
reset role;
select is((select count(*) from private.notification_jobs where source_id='fa400000-0000-4000-8000-000000000012'),1000::bigint,'all one thousand recipients are enqueued atomically');
select is((select count(distinct user_id) from private.notification_jobs where source_id='fa400000-0000-4000-8000-000000000099'),0::bigint,'unrelated source identifier never sees jobs');
select is((select count(distinct user_id) from private.notification_jobs where source_id='fa400000-0000-4000-8000-000000000012'),1000::bigint,'fanout test uses one thousand different subscribers');
select ok((select bool_and(state='queued' and provider_accepted_at is null) from private.notification_jobs),'load fixture never pretends external delivery');

-- Submission rate is serialized per actor and independent of cancellation.
update private.notification_policy set webpush_enabled=false;
update private.artist_dispatch_operations set created_at=now()-interval '2 minutes';
set local role authenticated;
do $$declare n integer; id uuid; begin for n in 1..30 loop
  id:=gen_random_uuid(); perform public.artist_compose_save('dispatch-test',id,gen_random_uuid(),0,'text','허구 분당 제한');
  perform public.artist_dispatch_submit('dispatch-test',id,gen_random_uuid(),1);
end loop; end $$;
select public.artist_compose_save('dispatch-test','fa400000-0000-4000-8000-000000000013','fa500000-0000-4000-8000-000000000013',0,'text','분당 제한 이후');
select throws_ok($$select public.artist_dispatch_submit('dispatch-test','fa400000-0000-4000-8000-000000000013',gen_random_uuid(),1)$$,'54000','DISPATCH_RATE_LIMITED','thirty-first new confirmation is rejected atomically');
select is(jsonb_array_length(public.artist_dispatch_context('dispatch-test')->'messages'),30,'history returns no more than thirty messages');
select is((public.artist_dispatch_context('dispatch-test')->>'has_more')::boolean,true,'history reports a continuation rather than truncating silently');
insert into dispatch_context values('history',public.artist_dispatch_context('dispatch-test'));
select is(jsonb_array_length(public.artist_dispatch_context('dispatch-test',null,
 (select (data->'messages'->29->>'created_at')::timestamptz from dispatch_context where key='history'),
 (select (data->'messages'->29->>'id')::uuid from dispatch_context where key='history'))->'messages'),3,'stable keyset continuation returns the remaining submissions exactly');
reset role;
-- Independent technical pending ceiling, without consuming a fake rate quota.
update private.artist_dispatch_operations set created_at=now()-interval '2 minutes';
insert into public.messages(id,artist_id,author_id,type,body,status,scheduled_at)
select ('fc400000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'fa200000-0000-4000-8000-000000000001',
 'fa100000-0000-4000-8000-000000000001','text','허구 대기열','scheduled',now()+interval '1 day' from generate_series(1,100) n;
insert into private.artist_compose_drafts(message_id,owner_id,artist_id)
select id,author_id,artist_id from public.messages where id::text like 'fc400000-%';
insert into private.artist_dispatch_submissions(message_id,next_attempt_at)
select id,scheduled_at from public.messages where id::text like 'fc400000-%';
set local role authenticated;
select throws_ok($$select public.artist_dispatch_submit('dispatch-test','fa400000-0000-4000-8000-000000000013',gen_random_uuid(),1)$$,'54000','DISPATCH_BACKPRESSURE','one hundred pending submissions reject additional work without loss');
reset role;
update public.artists set status='paused' where id='fa200000-0000-4000-8000-000000000001';
set local role authenticated;
select is(public.artist_dispatch_context('dispatch-test','fc400000-0000-4000-8000-000000000001')->'selected_message'->>'status','scheduled','paused artist owner can still inspect pending history');
select is(public.artist_dispatch_artists()->'artists'->0->>'slug','dispatch-test','dedicated history catalog retains paused artists with own submissions');
select is(jsonb_array_length(public.artist_dispatch_artists('dispatch-test')->'artists'),0,'history artist catalog supports forward pagination');
select throws_ok($$select public.artist_dispatch_artists('../bad')$$,'22023','DISPATCH_INVALID_INPUT','history artist cursor is validated');
select is(public.artist_dispatch_cancel('dispatch-test','fc400000-0000-4000-8000-000000000001',gen_random_uuid())->>'status','canceled','pausing cannot trap an owner into future unwanted publication');
reset role;
select is((select fanout_completed from private.artist_dispatch_submissions where message_id='fc400000-0000-4000-8000-000000000001'),true,'canceled queued source leaves the partial due index permanently');
set local role authenticated;
select set_config('request.jwt.claim.sub','fa100000-0000-4000-8000-000000000002',true);
select is(public.artist_dispatch_artists()->'artists','[]'::jsonb,'teammate without own submissions has no history catalog entry');
reset role;
update public.artists set status='active' where id='fa200000-0000-4000-8000-000000000001';
update private.artist_compose_drafts set revision=9007199254740990 where message_id='fa400000-0000-4000-8000-000000000013';
set local role authenticated;
select set_config('request.jwt.claim.sub','fa100000-0000-4000-8000-000000000001',true);
select is((public.artist_dispatch_submit('dispatch-test','fa400000-0000-4000-8000-000000000013',gen_random_uuid(),9007199254740990)->>'revision')::bigint,9007199254740991::bigint,'last valid confirmation reaches the safe integer boundary');
select is(public.artist_dispatch_cancel('dispatch-test','fa400000-0000-4000-8000-000000000013',gen_random_uuid())->>'status','canceled','cancellation remains possible at revision ceiling without overflow');
reset role;
select * from finish();
rollback;
