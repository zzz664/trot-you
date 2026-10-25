begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
-- Transaction-local fictional users, sessions, opaque endpoints and structural
-- crypto strings. SQL never calls a provider or proves browser permission.
create temporary table webpush_context(key text primary key,id uuid,token uuid,stamp timestamptz);
grant all on webpush_context to authenticated,service_role;
insert into auth.users(id,email,raw_user_meta_data)
select ('fe100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'webpush-retry-after-'||n||'@example.invalid','{}'::jsonb from generate_series(1,4) n;
update public.profiles set call_name='가상 알림 팬',onboarding_completed_at=now() where id::text like 'fe100000-%';
update public.profiles set role='artist' where id='fe100000-0000-4000-8000-000000000003';
insert into auth.sessions(id,user_id,created_at,updated_at,not_after)
select ('fe110000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 ('fe100000-0000-4000-8000-'||lpad(case when n=4 then '1' else n::text end,12,'0'))::uuid,
 now(),now(),null from generate_series(1,4) n;
insert into public.artists(id,slug,name,grade,status) values
 ('fe200000-0000-4000-8000-000000000001','webpush-retry-after','가상 알림 가수','B','active');
insert into public.artist_members(artist_id,user_id) values
 ('fe200000-0000-4000-8000-000000000001','fe100000-0000-4000-8000-000000000003');
insert into public.subscriptions(id,user_id,artist_id,provider,status,first_started_at,episode_started_at,current_period_start,current_period_end)
values('fe300000-0000-4000-8000-000000000001','fe100000-0000-4000-8000-000000000001','fe200000-0000-4000-8000-000000000001','toss','active',now()-interval '1 day',now()-interval '1 day',now()-interval '1 day',now()+interval '1 day');
insert into private.message_policy(version,history_before_seconds,cancel_window_seconds,max_text_length,max_reply_length,
 max_photos,max_voice_seconds,max_video_seconds,preview_max_count,max_photo_bytes,max_voice_bytes,max_video_bytes)
values('fictional-webpush-retry-after',604800,300,1000,100,10,180,60,5,10485760,20971520,104857600);
insert into private.notification_policy(version,consent_version,webpush_enabled,max_attempts,retry_seconds,lease_seconds,schedule_lead_seconds)
values('fictional-webpush','fictional-consent',true,3,10,30,86400);
set local role service_role;
insert into webpush_context values('device',public.webpush_register_device('fe100000-0000-4000-8000-000000000001','fe110000-0000-4000-8000-000000000001','https://push.example.invalid/gates',repeat('B',87),repeat('A',22),'fictional-consent'));
reset role;
-- This rollback-only fixture helper owns no production grant and never sends.
create function pg_temp.claim_webpush(p_key text) returns void language plpgsql security definer set search_path='' as $$
declare v_message_id uuid:=gen_random_uuid(); j uuid; t uuid;
begin
  insert into public.messages(id,artist_id,author_id,type,body,status,scheduled_at,sent_at)
  values(v_message_id,'fe200000-0000-4000-8000-000000000001','fe100000-0000-4000-8000-000000000003','text','가상 비공개 알림','sent',now(),now());
  select jobs.id into j from private.notification_jobs jobs where jobs.source_id=v_message_id and jobs.device_id=(select id from pg_temp.webpush_context where key='device');
  select lease_token into t from public.notification_claim(j);
  insert into pg_temp.webpush_context(key,id,token) values(p_key,j,t);
end;
$$;
grant execute on function pg_temp.claim_webpush(text) to service_role;
set local role service_role;
select pg_temp.claim_webpush('retry-after');
select throws_ok($$select public.webpush_complete((select id from webpush_context where key='retry-after'),(select token from webpush_context where key='retry-after'),'not_sent',gen_random_uuid(),-1)$$,
 '22023','WEBPUSH_RETRY_AFTER_INVALID','negative provider Retry-After is rejected');
select throws_ok($$select public.webpush_complete((select id from webpush_context where key='retry-after'),(select token from webpush_context where key='retry-after'),'not_sent',gen_random_uuid(),86401)$$,
 '22023','WEBPUSH_RETRY_AFTER_INVALID','unbounded provider Retry-After is rejected');
select is(public.webpush_complete((select id from webpush_context where key='retry-after'),(select token from webpush_context where key='retry-after'),'not_sent','fe500000-0000-4000-8000-000000000001',120),'retry_wait','provider refusal can supply a bounded Retry-After minimum');
reset role;
select is((select extract(epoch from j.next_attempt_at-a.finished_at)::integer from private.notification_jobs j join private.notification_attempts a on a.token=j.lease_token where j.id=(select id from webpush_context where key='retry-after')),120,'Retry-After larger than exponential delay is honored');
select is((select retry_after_seconds from private.notification_attempts where token=(select token from webpush_context where key='retry-after')),120,'bounded provider minimum is retained with attempt evidence');
update webpush_context set stamp=(select next_attempt_at from private.notification_jobs where id=(select id from webpush_context where key='retry-after')) where key='retry-after';
set local role service_role;
select is(public.webpush_complete((select id from webpush_context where key='retry-after'),(select token from webpush_context where key='retry-after'),'not_sent','fe500000-0000-4000-8000-000000000001',86400),'retry_wait','same evidence replay remains idempotent even with changed header input');
reset role;
select is((select next_attempt_at from private.notification_jobs where id=(select id from webpush_context where key='retry-after')),(select stamp from webpush_context where key='retry-after'),'replay does not extend the recorded provider minimum');
set local role service_role;
select pg_temp.claim_webpush('zero');
select public.webpush_complete((select id from webpush_context where key='zero'),(select token from webpush_context where key='zero'),'not_sent',gen_random_uuid(),0);
reset role;
select is((select extract(epoch from j.next_attempt_at-a.finished_at)::integer from private.notification_jobs j join private.notification_attempts a on a.token=j.lease_token where j.id=(select id from webpush_context where key='zero')),10,'zero Retry-After cannot shorten the exponential floor');
set local role service_role;
select pg_temp.claim_webpush('null');
select public.webpush_complete((select id from webpush_context where key='null'),(select token from webpush_context where key='null'),'not_sent',gen_random_uuid(),null);
reset role;
select is((select extract(epoch from j.next_attempt_at-a.finished_at)::integer from private.notification_jobs j join private.notification_attempts a on a.token=j.lease_token where j.id=(select id from webpush_context where key='null')),10,'missing provider minimum retains exponential default');
set local role service_role;
select pg_temp.claim_webpush('unknown');
select public.webpush_complete((select id from webpush_context where key='unknown'),(select token from webpush_context where key='unknown'),'unknown',null,120);
reset role;
select is((select extract(epoch from next_attempt_at-lease_expires_at)::integer from private.notification_jobs where id=(select id from webpush_context where key='unknown')),120,'ambiguous retry minimum starts no earlier than lease end');
update webpush_context set stamp=(select next_attempt_at from private.notification_jobs where id=(select id from webpush_context where key='unknown')) where key='unknown';
set local role service_role;
select public.webpush_complete((select id from webpush_context where key='unknown'),(select token from webpush_context where key='unknown'),'unknown',null,0);
reset role;
select is((select next_attempt_at from private.notification_jobs where id=(select id from webpush_context where key='unknown')),(select stamp from webpush_context where key='unknown'),'ambiguous replay cannot shorten its prior provider minimum');
set local role service_role;
select public.webpush_complete((select id from webpush_context where key='unknown'),(select token from webpush_context where key='unknown'),'not_sent','fe500000-0000-4000-8000-000000000002',0);
reset role;
select ok((select next_attempt_at>=(select stamp from webpush_context where key='unknown') from private.notification_jobs where id=(select id from webpush_context where key='unknown')),'later definitive non-send preserves the earlier retry minimum');
set local role service_role;
select pg_temp.claim_webpush('boundary');
select public.webpush_complete((select id from webpush_context where key='boundary'),(select token from webpush_context where key='boundary'),'not_sent',gen_random_uuid(),86400);
reset role;
select is((select extract(epoch from j.next_attempt_at-a.finished_at)::integer from private.notification_jobs j join private.notification_attempts a on a.token=j.lease_token where j.id=(select id from webpush_context where key='boundary')),86400,'maximum accepted provider delay is bounded to one day');
select * from finish();
rollback;
