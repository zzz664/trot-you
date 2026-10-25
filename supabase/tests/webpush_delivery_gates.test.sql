begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
-- Transaction-local fictional users, sessions, opaque endpoints and structural
-- crypto strings. SQL never calls a provider or proves browser permission.
create temporary table webpush_context(key text primary key,id uuid,token uuid,stamp timestamptz);
grant all on webpush_context to authenticated,service_role;
insert into auth.users(id,email,raw_user_meta_data)
select ('fd100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'webpush-gates-'||n||'@example.invalid','{}'::jsonb from generate_series(1,4) n;
update public.profiles set call_name='가상 알림 팬',onboarding_completed_at=now() where id::text like 'fd100000-%';
update public.profiles set role='artist' where id='fd100000-0000-4000-8000-000000000003';
insert into auth.sessions(id,user_id,created_at,updated_at,not_after)
select ('fd110000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 ('fd100000-0000-4000-8000-'||lpad(case when n=4 then '1' else n::text end,12,'0'))::uuid,
 now(),now(),null from generate_series(1,4) n;
insert into public.artists(id,slug,name,grade,status) values
 ('fd200000-0000-4000-8000-000000000001','webpush-gates','가상 알림 가수','B','active');
insert into public.artist_members(artist_id,user_id) values
 ('fd200000-0000-4000-8000-000000000001','fd100000-0000-4000-8000-000000000003');
insert into public.subscriptions(id,user_id,artist_id,provider,status,first_started_at,episode_started_at,current_period_start,current_period_end)
values('fd300000-0000-4000-8000-000000000001','fd100000-0000-4000-8000-000000000001','fd200000-0000-4000-8000-000000000001','toss','active',now()-interval '1 day',now()-interval '1 day',now()-interval '1 day',now()+interval '1 day');
insert into private.message_policy(version,history_before_seconds,cancel_window_seconds,max_text_length,max_reply_length,
 max_photos,max_voice_seconds,max_video_seconds,preview_max_count,max_photo_bytes,max_voice_bytes,max_video_bytes)
values('fictional-webpush-gates',604800,300,1000,100,10,180,60,5,10485760,20971520,104857600);
insert into private.notification_policy(version,consent_version,webpush_enabled,max_attempts,retry_seconds,lease_seconds,schedule_lead_seconds)
values('fictional-webpush','fictional-consent',true,3,10,30,86400);
set local role service_role;
insert into webpush_context values('device',public.webpush_register_device('fd100000-0000-4000-8000-000000000001','fd110000-0000-4000-8000-000000000001','https://push.example.invalid/gates',repeat('B',87),repeat('A',22),'fictional-consent'));
reset role;
-- This rollback-only fixture helper owns no production grant and never sends.
create function pg_temp.claim_webpush(p_key text) returns void language plpgsql security definer set search_path='' as $$
declare message_id uuid:=gen_random_uuid(); j uuid; t uuid;
begin
  insert into public.messages(id,artist_id,author_id,type,body,status,scheduled_at,sent_at)
  values(message_id,'fd200000-0000-4000-8000-000000000001','fd100000-0000-4000-8000-000000000003','text','가상 비공개 알림','sent',now(),now());
  select id into j from private.notification_jobs where source_id=message_id and device_id=(select id from pg_temp.webpush_context where key='device');
  select lease_token into t from public.notification_claim(j);
  insert into pg_temp.webpush_context(key,id,token) values(p_key,j,t);
end;
$$;
grant execute on function pg_temp.claim_webpush(text) to service_role;
set local role service_role;
select pg_temp.claim_webpush('consent');
reset role;
update private.notification_policy set consent_version='changed-consent';
set local role service_role;
select is((select count(*) from public.webpush_prepare_delivery((select id from webpush_context where key='consent'),(select token from webpush_context where key='consent'))),0::bigint,'consent policy change between claim and send blocks delivery');
reset role;
update private.notification_policy set consent_version='fictional-consent';
set local role service_role;
select pg_temp.claim_webpush('preferences');
reset role;
select set_config('request.jwt.claim.sub','fd100000-0000-4000-8000-000000000001',true);
set local role authenticated;
select public.notification_set_preferences(true,false,true,true);
reset role;
set local role service_role;
select is((select count(*) from public.webpush_prepare_delivery((select id from webpush_context where key='preferences'),(select token from webpush_context where key='preferences'))),0::bigint,'new-message opt-out between claim and send is enforced');
reset role;
set local role authenticated;
select public.notification_set_preferences(true,true,true,true);
reset role;
set local role service_role;
select pg_temp.claim_webpush('canceled-source');
reset role;
update public.messages set status='canceled',canceled_at=now() where id=(select source_id from private.notification_jobs where id=(select id from webpush_context where key='canceled-source'));
set local role service_role;
select is((select count(*) from public.webpush_prepare_delivery((select id from webpush_context where key='canceled-source'),(select token from webpush_context where key='canceled-source'))),0::bigint,'source cancellation between claim and send blocks delivery');
select pg_temp.claim_webpush('recipient-access');
reset role;
update public.subscriptions set current_period_end=clock_timestamp()-interval '1 second' where id='fd300000-0000-4000-8000-000000000001';
set local role service_role;
select is((select count(*) from public.webpush_prepare_delivery((select id from webpush_context where key='recipient-access'),(select token from webpush_context where key='recipient-access'))),0::bigint,'expired recipient access between claim and send blocks delivery');
reset role;
update public.subscriptions set current_period_end=clock_timestamp()+interval '1 day' where id='fd300000-0000-4000-8000-000000000001';
set local role service_role;
select pg_temp.claim_webpush('artist-paused');
reset role;
update public.artists set status='paused' where id='fd200000-0000-4000-8000-000000000001';
set local role service_role;
select is((select count(*) from public.webpush_prepare_delivery((select id from webpush_context where key='artist-paused'),(select token from webpush_context where key='artist-paused'))),0::bigint,'paused artist between claim and send blocks delivery');
reset role;
update public.artists set status='active' where id='fd200000-0000-4000-8000-000000000001';
set local role service_role;
select pg_temp.claim_webpush('near-deadline');
reset role;
update private.notification_jobs set lease_expires_at=clock_timestamp()+interval '4 seconds' where id=(select id from webpush_context where key='near-deadline');
set local role service_role;
select is((select count(*) from public.webpush_prepare_delivery((select id from webpush_context where key='near-deadline'),(select token from webpush_context where key='near-deadline'))),0::bigint,'near-expired lease never authorizes a fresh HTTP request');
reset role;
select is((select delivery_prepared_at from private.notification_attempts where token=(select token from webpush_context where key='near-deadline')),null::timestamptz,'deadline refusal consumes no send authorization');
set local role service_role;
select pg_temp.claim_webpush('missing-session');
reset role;
delete from auth.sessions where id='fd110000-0000-4000-8000-000000000001';
set local role service_role;
select is((select count(*) from public.webpush_prepare_delivery((select id from webpush_context where key='missing-session'),(select token from webpush_context where key='missing-session'))),0::bigint,'deleted Auth session blocks delivery despite still-signed access JWT');
reset role;
insert into auth.sessions(id,user_id,created_at,updated_at) values('fd110000-0000-4000-8000-000000000001','fd100000-0000-4000-8000-000000000001',now(),now());
set local role service_role;
select pg_temp.claim_webpush('in-flight');
select is((select count(*) from public.webpush_prepare_delivery((select id from webpush_context where key='in-flight'),(select token from webpush_context where key='in-flight'))),1::bigint,'one-time send gate may already have returned before revocation');
select public.webpush_revoke_device('fd100000-0000-4000-8000-000000000001','fd110000-0000-4000-8000-000000000001','https://push.example.invalid/gates');
select is(public.webpush_complete((select id from webpush_context where key='in-flight'),(select token from webpush_context where key='in-flight'),'provider_accepted',gen_random_uuid()),'provider_accepted','already in-flight acceptance remains truthful after opt-out; no recall claim');
select public.webpush_register_device('fd100000-0000-4000-8000-000000000001','fd110000-0000-4000-8000-000000000001','https://push.example.invalid/gates',repeat('B',87),repeat('A',22),'fictional-consent');
select pg_temp.claim_webpush('unknown-revoked');
select count(*) from public.webpush_prepare_delivery((select id from webpush_context where key='unknown-revoked'),(select token from webpush_context where key='unknown-revoked'));
select public.webpush_complete((select id from webpush_context where key='unknown-revoked'),(select token from webpush_context where key='unknown-revoked'),'unknown',null);
select public.webpush_revoke_device('fd100000-0000-4000-8000-000000000001','fd110000-0000-4000-8000-000000000001','https://push.example.invalid/gates');
reset role;
update private.notification_jobs set lease_expires_at=clock_timestamp()-interval '30 seconds',next_attempt_at=clock_timestamp()-interval '1 second' where id=(select id from webpush_context where key='unknown-revoked');
set local role service_role;
select is(public.webpush_recover_expired((select id from webpush_context where key='unknown-revoked'),(select token from webpush_context where key='unknown-revoked')),'canceled','revoked unknown work is suppressed instead of retried');
reset role;
select is((select state from private.notification_attempts where token=(select token from webpush_context where key='unknown-revoked')),'unknown','cancellation never relabels a potentially accepted send as not-sent');
set local role service_role;
select public.webpush_register_device('fd100000-0000-4000-8000-000000000001','fd110000-0000-4000-8000-000000000001','https://push.example.invalid/gates',repeat('B',87),repeat('A',22),'fictional-consent');
select pg_temp.claim_webpush('dead');
select pg_temp.claim_webpush('dead-sibling');
select is(public.webpush_complete((select id from webpush_context where key='dead'),(select token from webpush_context where key='dead'),'dead_endpoint',gen_random_uuid()),'dead_endpoint','provider 404/410 evidence terminates dead endpoint');
select is((select count(*) from public.webpush_prepare_delivery((select id from webpush_context where key='dead-sibling'),(select token from webpush_context where key='dead-sibling'))),0::bigint,'dead endpoint cleanup blocks already-claimed sibling send');
select throws_ok($$select public.webpush_register_device('fd100000-0000-4000-8000-000000000001','fd110000-0000-4000-8000-000000000001','https://push.example.invalid/gates',repeat('B',87),repeat('A',22),'fictional-consent')$$,
 '55000','NOTIFICATION_DEVICE_INACTIVE','dead endpoint cannot be resurrected by replaying browser material');
reset role;
-- A device-count cap is structural protection, not an invented business plan.
set local role service_role;
select public.webpush_register_device('fd100000-0000-4000-8000-000000000001','fd110000-0000-4000-8000-000000000001','https://push.example.invalid/cap-'||n,repeat('B',87),repeat('A',22),'fictional-consent') from generate_series(1,10) n;
select throws_ok($$select public.webpush_register_device('fd100000-0000-4000-8000-000000000001','fd110000-0000-4000-8000-000000000001','https://push.example.invalid/cap-eleven',repeat('B',87),repeat('A',22),'fictional-consent')$$,
 '54000','WEBPUSH_DEVICE_LIMIT','active device storage is bounded per actor');
select lives_ok($$select public.webpush_register_device('fd100000-0000-4000-8000-000000000001','fd110000-0000-4000-8000-000000000001','https://push.example.invalid/cap-1',repeat('B',87),repeat('A',22),'fictional-consent')$$,'idempotent registration at device cap remains available');
reset role;
update private.notification_policy set lease_seconds=5;
set local role service_role;
select is((select configured from public.webpush_device_status('fd100000-0000-4000-8000-000000000001','fd110000-0000-4000-8000-000000000001')),false,'too-short policy lease cannot be advertised ready for real HTTP');
select throws_ok($$select public.webpush_register_device('fd100000-0000-4000-8000-000000000001','fd110000-0000-4000-8000-000000000001','https://push.example.invalid/cap-1',repeat('B',87),repeat('A',22),'fictional-consent')$$,
 '55000','NOTIFICATION_CONSENT_REQUIRED','legacy five-second lease requires explicit safe operator policy before activation');
reset role;
select * from finish();
rollback;
