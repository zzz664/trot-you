begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
-- Transaction-local fictional users, sessions, opaque endpoints and structural
-- crypto strings. SQL never calls a provider or proves browser permission.
create temporary table webpush_context(key text primary key,id uuid,token uuid,stamp timestamptz);
grant all on webpush_context to authenticated,service_role;
insert into auth.users(id,email,raw_user_meta_data)
select ('fc100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'webpush-fixture-'||n||'@example.invalid','{}'::jsonb from generate_series(1,4) n;
update public.profiles set call_name='가상 알림 팬',onboarding_completed_at=now() where id::text like 'fc100000-%';
update public.profiles set role='artist' where id='fc100000-0000-4000-8000-000000000003';
insert into auth.sessions(id,user_id,created_at,updated_at,not_after)
select ('fc110000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 ('fc100000-0000-4000-8000-'||lpad(case when n=4 then '1' else n::text end,12,'0'))::uuid,
 now(),now(),null from generate_series(1,4) n;
insert into public.artists(id,slug,name,grade,status) values
 ('fc200000-0000-4000-8000-000000000001','webpush-fixture','가상 알림 가수','B','active');
insert into public.artist_members(artist_id,user_id) values
 ('fc200000-0000-4000-8000-000000000001','fc100000-0000-4000-8000-000000000003');
insert into public.subscriptions(id,user_id,artist_id,provider,status,first_started_at,episode_started_at,current_period_start,current_period_end)
values('fc300000-0000-4000-8000-000000000001','fc100000-0000-4000-8000-000000000001','fc200000-0000-4000-8000-000000000001','toss','active',now()-interval '1 day',now()-interval '1 day',now()-interval '1 day',now()+interval '1 day');
insert into private.message_policy(version,history_before_seconds,cancel_window_seconds,max_text_length,max_reply_length,
 max_photos,max_voice_seconds,max_video_seconds,preview_max_count,max_photo_bytes,max_voice_bytes,max_video_bytes)
values('fictional-webpush-message',604800,300,1000,100,10,180,60,5,10485760,20971520,104857600);
select is((select count(*) from private.notification_policy),0::bigint,'migration activates no live notification policy');
select is((select count(*) from private.push_subscriptions),0::bigint,'migration fabricates no browser opt-in');
select ok((select bool_and(not has_table_privilege(r,t,'SELECT,INSERT,UPDATE,DELETE'))
 from unnest(array['anon','authenticated','service_role']) r cross join unnest(array[
 'private.push_subscriptions','private.notification_jobs','private.notification_attempts']) t),'new session binding gives no raw table access');
select ok((select bool_and(not has_function_privilege(r,p.oid,'EXECUTE')) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 cross join unnest(array['anon','authenticated','service_role']) r where n.nspname='private' and p.proname like 'webpush\_%' escape '\'),
 'all private Web Push helpers deny application execution');
select ok((select bool_and(p.prosecdef and 'search_path=""'=any(p.proconfig)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname like 'webpush\_%' escape '\'),'all public Web Push boundaries pin search_path');
select ok((select bool_and(not has_function_privilege(r,p.oid,'EXECUTE')) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 cross join unnest(array['anon','authenticated']) r where n.nspname='public' and p.proname like 'webpush\_%' escape '\'
 and p.proname not in('webpush_revoke_session','webpush_revoke_current_device','webpush_current_status')),'browser roles cannot impersonate the Web Push service');
select ok(has_function_privilege('authenticated','public.webpush_revoke_session()','EXECUTE')
 and not has_function_privilege('anon','public.webpush_revoke_session()','EXECUTE')
 and not has_function_privilege('service_role','public.webpush_revoke_session()','EXECUTE'),'native logout revocation requires authenticated JWT identity');
set local role service_role;
select is((select configured from public.webpush_device_status('fc100000-0000-4000-8000-000000000001','fc110000-0000-4000-8000-000000000001')),false,'unconfigured status is honest');
select is((select device_active from public.webpush_device_status('fc100000-0000-4000-8000-000000000001','fc110000-0000-4000-8000-000000000001')),false,'missing device never silently opts in');
select throws_ok($$select public.webpush_register_device('fc100000-0000-4000-8000-000000000001','fc110000-0000-4000-8000-000000000001','https://push.example.invalid/one',repeat('B',87),repeat('A',22),'fictional-consent')$$,
 '55000','NOTIFICATION_CONSENT_REQUIRED','registration needs explicit configured policy');
select throws_ok($$select * from public.webpush_device_status('fc100000-0000-4000-8000-000000000001','fc110000-0000-4000-8000-000000000002')$$,
 '42501','WEBPUSH_SESSION_REQUIRED','another fan session cannot be bound to this actor');
select throws_ok($$select * from public.webpush_device_status('fc100000-0000-4000-8000-000000000001',null)$$,
 '42501','WEBPUSH_SESSION_REQUIRED','missing session fails closed');
reset role;
insert into private.notification_policy(version,consent_version,webpush_enabled,max_attempts,retry_seconds,lease_seconds,schedule_lead_seconds)
values('fictional-webpush','fictional-consent',true,3,10,30,86400);
insert into private.notification_preferences(user_id,webpush_enabled,new_message,billing,schedule)
values('fc100000-0000-4000-8000-000000000001',false,false,true,false);
set local role service_role;
insert into webpush_context values('device',public.webpush_register_device('fc100000-0000-4000-8000-000000000001','fc110000-0000-4000-8000-000000000001','https://push.example.invalid/one',repeat('B',87),repeat('A',22),'fictional-consent'));
select is(public.webpush_register_device('fc100000-0000-4000-8000-000000000001','fc110000-0000-4000-8000-000000000001','https://push.example.invalid/one',repeat('B',87),repeat('A',22),'fictional-consent'),
 (select id from webpush_context where key='device'),'same session/device registration is idempotent');
select is((select device_active from public.webpush_device_status('fc100000-0000-4000-8000-000000000001','fc110000-0000-4000-8000-000000000001','https://push.example.invalid/one')),true,'explicit registered session reports enabled');
select is((select device_active from public.webpush_device_status('fc100000-0000-4000-8000-000000000001','fc110000-0000-4000-8000-000000000004','https://push.example.invalid/one')),false,'same user different session must explicitly opt in again');
select is((select device_id from public.webpush_device_status('fc100000-0000-4000-8000-000000000002','fc110000-0000-4000-8000-000000000002','https://push.example.invalid/one')),null::uuid,'foreign endpoint identity is not projected');
select throws_ok($$select public.webpush_register_device('fc100000-0000-4000-8000-000000000002','fc110000-0000-4000-8000-000000000002','https://push.example.invalid/one',repeat('B',87),repeat('A',22),'fictional-consent')$$,
 '23514','NOTIFICATION_DEVICE_CONFLICT','endpoint ownership never transfers to another account');
select throws_ok($$select public.webpush_register_device('fc100000-0000-4000-8000-000000000001','fc110000-0000-4000-8000-000000000001','https://push.example.invalid/one',repeat('C',87),repeat('A',22),'fictional-consent')$$,
 '23514','NOTIFICATION_DEVICE_CONFLICT','known endpoint cannot replace cryptographic material');
select throws_ok($$select public.webpush_register_device('fc100000-0000-4000-8000-000000000003','fc110000-0000-4000-8000-000000000003','https://push.example.invalid/artist',repeat('B',87),repeat('A',22),'fictional-consent')$$,
 '42501','NOTIFICATION_ACTOR_FORBIDDEN','artist role is not fan notification consent');
select lives_ok($$select public.webpush_revoke_device('fc100000-0000-4000-8000-000000000002','fc110000-0000-4000-8000-000000000002','https://push.example.invalid/one')$$,'foreign opt-out is an opaque no-op');
reset role;
select ok((select webpush_enabled and new_message and billing and not schedule from private.notification_preferences where user_id='fc100000-0000-4000-8000-000000000001'),
 'opt-in atomically enables only global/new-message and preserves other preferences');
select is((select state from private.push_subscriptions where id=(select id from webpush_context where key='device')),'active','foreign opt-out cannot revoke endpoint');
select is((select auth_session_id from private.push_subscriptions where id=(select id from webpush_context where key='device')),
 'fc110000-0000-4000-8000-000000000001'::uuid,'database retains verified session binding');
-- Legacy ABI fixtures retain DB-only behavior, but cannot enter the new worker.
set local role service_role;
insert into webpush_context values('legacy',public.notification_register_device('fc100000-0000-4000-8000-000000000001','https://push.example.invalid/legacy',repeat('B',87),repeat('A',22),'fictional-consent'));
reset role;
insert into public.messages(id,artist_id,author_id,type,body,status,scheduled_at,sent_at)
select ('fc400000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'fc200000-0000-4000-8000-000000000001','fc100000-0000-4000-8000-000000000003','text','비공개 원문 {이름}','sent',now(),now() from generate_series(1,12) n;
insert into webpush_context(key,id) select 'job',id from private.notification_jobs where source_id='fc400000-0000-4000-8000-000000000001' and device_id=(select id from webpush_context where key='device');
set local role service_role;
select is((select count(*) from public.webpush_list_due(100)),12::bigint,'new worker enumerates only session-bound message jobs');
select is((select count(*) from public.webpush_list_due(1)),1::bigint,'due list enforces its caller limit');
select throws_ok($$select * from public.webpush_list_due(0)$$,'22023','NOTIFICATION_LIMIT_INVALID','zero due limit is rejected');
select throws_ok($$select * from public.webpush_list_due(101)$$,'22023','NOTIFICATION_LIMIT_INVALID','unbounded due scan is rejected');
select throws_ok($$select * from public.webpush_list_uncertain(null)$$,'22023','NOTIFICATION_LIMIT_INVALID','null recovery limit is rejected');
update webpush_context set token=c.lease_token,stamp=c.lease_expires_at from public.notification_claim((select id from webpush_context where key='job')) c where key='job';
select is((select count(*) from public.webpush_prepare_delivery((select id from webpush_context where key='job'),gen_random_uuid())),0::bigint,'wrong attempt token reveals no endpoint');
select is((select count(*) from public.webpush_prepare_delivery((select id from webpush_context where key='job'),(select token from webpush_context where key='job'))),1::bigint,'fresh eligible attempt passes final send fence');
select is((select count(*) from public.webpush_prepare_delivery((select id from webpush_context where key='job'),(select token from webpush_context where key='job'))),0::bigint,'same lease can authorize network preparation only once');
select is(public.webpush_complete((select id from webpush_context where key='job'),(select token from webpush_context where key='job'),'provider_accepted','fc500000-0000-4000-8000-000000000001'),
 'provider_accepted','HTTP acceptance is recorded explicitly, not displayed/read');
select is(public.webpush_complete((select id from webpush_context where key='job'),(select token from webpush_context where key='job'),'provider_accepted','fc500000-0000-4000-8000-000000000001'),
 'provider_accepted','same acceptance evidence replay is idempotent');
reset role;
select ok((select delivery_prepared_at is not null from private.notification_attempts where token=(select token from webpush_context where key='job')),'attempt has one-time preparation evidence');
select ok(not exists(select 1 from information_schema.columns where table_schema='private' and table_name='notification_jobs' and column_name in('displayed_at','read_at','body','payload')),
 'delivery does not invent receipt/read evidence or store personalized push payloads');
insert into webpush_context(key,id) select 'legacy-job',id from private.notification_jobs where source_id='fc400000-0000-4000-8000-000000000001' and device_id=(select id from webpush_context where key='legacy');
set local role service_role;
update webpush_context set token=c.lease_token from public.notification_claim((select id from webpush_context where key='legacy-job')) c where key='legacy-job';
select is((select count(*) from public.webpush_prepare_delivery((select id from webpush_context where key='legacy-job'),(select token from webpush_context where key='legacy-job'))),0::bigint,'legacy unbound endpoint can never pass real delivery authorization');
reset role;
-- A revocation between claim and final preparation prevents network capability.
insert into webpush_context(key,id) select 'revoked-job',id from private.notification_jobs where source_id='fc400000-0000-4000-8000-000000000002' and device_id=(select id from webpush_context where key='device');
set local role service_role;
update webpush_context set token=c.lease_token from public.notification_claim((select id from webpush_context where key='revoked-job')) c where key='revoked-job';
select lives_ok($$select public.webpush_revoke_device('fc100000-0000-4000-8000-000000000001','fc110000-0000-4000-8000-000000000001','https://push.example.invalid/one')$$,'owner explicit opt-out is available');
select is((select count(*) from public.webpush_prepare_delivery((select id from webpush_context where key='revoked-job'),(select token from webpush_context where key='revoked-job'))),0::bigint,'revocation after claim blocks final send gate');
select lives_ok($$select public.webpush_revoke_device('fc100000-0000-4000-8000-000000000001','fc110000-0000-4000-8000-000000000001','https://push.example.invalid/one')$$,'repeated opt-out is idempotent');
select is(public.webpush_register_device('fc100000-0000-4000-8000-000000000001','fc110000-0000-4000-8000-000000000001','https://push.example.invalid/one',repeat('B',87),repeat('A',22),'fictional-consent'),
 (select id from webpush_context where key='device'),'explicit same-owner opt-in may reactivate a revoked endpoint');
reset role;
select is((select state from private.notification_jobs where id=(select id from webpush_context where key='revoked-job')),'canceled','re-opt-in does not revive old canceled work');
select is((select state from private.notification_attempts where token=(select token from webpush_context where key='revoked-job')),'not_sent','unprepared suppressed attempt has truthful not-sent evidence');
-- Fresh messages after re-opt-in, unlike historical canceled work, enqueue.
insert into public.messages(id,artist_id,author_id,type,body,status,scheduled_at,sent_at)
select ('fc410000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'fc200000-0000-4000-8000-000000000001','fc100000-0000-4000-8000-000000000003','text','새 비공개 원문','sent',now(),now() from generate_series(1,12) n;
insert into webpush_context(key,id) select 'retry-job',id from private.notification_jobs where source_id='fc410000-0000-4000-8000-000000000001' and device_id=(select id from webpush_context where key='device');
set local role service_role;
update webpush_context set token=c.lease_token from public.notification_claim((select id from webpush_context where key='retry-job')) c where key='retry-job';
select is(public.webpush_complete((select id from webpush_context where key='retry-job'),(select token from webpush_context where key='retry-job'),'not_sent','fc500000-0000-4000-8000-000000000002'),'retry_wait','proven non-acceptance has bounded retry');
reset role;
select is((select extract(epoch from j.next_attempt_at-a.finished_at)::integer from private.notification_jobs j join private.notification_attempts a on a.token=j.lease_token where j.id=(select id from webpush_context where key='retry-job')),10,'first retry uses base policy delay');
update webpush_context set stamp=(select next_attempt_at from private.notification_jobs where id=(select id from webpush_context where key='retry-job')) where key='retry-job';
set local role service_role;
select is(public.webpush_complete((select id from webpush_context where key='retry-job'),(select token from webpush_context where key='retry-job'),'not_sent','fc500000-0000-4000-8000-000000000002'),'retry_wait','retry evidence replay is idempotent');
reset role;
select is((select next_attempt_at from private.notification_jobs where id=(select id from webpush_context where key='retry-job')),(select stamp from webpush_context where key='retry-job'),'replay never postpones retry deadline');
update private.notification_jobs set next_attempt_at=clock_timestamp()-interval '1 second' where id=(select id from webpush_context where key='retry-job');
set local role service_role;
update webpush_context set token=c.lease_token from public.notification_claim((select id from webpush_context where key='retry-job')) c where key='retry-job';
select is(public.webpush_complete((select id from webpush_context where key='retry-job'),(select token from webpush_context where key='retry-job'),'not_sent','fc500000-0000-4000-8000-000000000003'),'retry_wait','second proven refusal still respects attempt budget');
reset role;
select is((select extract(epoch from j.next_attempt_at-a.finished_at)::integer from private.notification_jobs j join private.notification_attempts a on a.token=j.lease_token where j.id=(select id from webpush_context where key='retry-job')),20,'second retry doubles the policy delay');
update private.notification_jobs set next_attempt_at=clock_timestamp()-interval '1 second' where id=(select id from webpush_context where key='retry-job');
set local role service_role;
update webpush_context set token=c.lease_token from public.notification_claim((select id from webpush_context where key='retry-job')) c where key='retry-job';
select is(public.webpush_complete((select id from webpush_context where key='retry-job'),(select token from webpush_context where key='retry-job'),'not_sent','fc500000-0000-4000-8000-000000000004'),'failed','attempt budget terminates repeated refusals');
reset role;
-- Timeout/crash recovery intentionally allows at-least-once delivery, never an
-- invented guarantee of exactly-once external acceptance.
insert into webpush_context(key,id) select 'unknown-job',id from private.notification_jobs where source_id='fc410000-0000-4000-8000-000000000002' and device_id=(select id from webpush_context where key='device');
set local role service_role;
update webpush_context set token=c.lease_token from public.notification_claim((select id from webpush_context where key='unknown-job')) c where key='unknown-job';
select is((select count(*) from public.webpush_prepare_delivery((select id from webpush_context where key='unknown-job'),(select token from webpush_context where key='unknown-job'))),1::bigint,'unknown test starts from one authorized preparation');
select is(public.webpush_complete((select id from webpush_context where key='unknown-job'),(select token from webpush_context where key='unknown-job'),'unknown',null),'unknown','ambiguous timeout is not mislabeled not-sent');
select is(public.webpush_recover_expired((select id from webpush_context where key='unknown-job'),(select token from webpush_context where key='unknown-job')),'unknown','active lease cannot be recovered');
select is((select count(*) from public.webpush_list_uncertain()),0::bigint,'recovery discovery excludes leases still in safety/backoff window');
reset role;
update private.notification_jobs set lease_expires_at=clock_timestamp()-interval '30 seconds',next_attempt_at=clock_timestamp()-interval '1 second' where id=(select id from webpush_context where key='unknown-job');
set local role service_role;
select is((select count(*) from public.webpush_list_uncertain()),1::bigint,'expired eligible unknown work becomes discoverable');
select is(public.webpush_recover_expired((select id from webpush_context where key='unknown-job'),(select token from webpush_context where key='unknown-job')),'retry_wait','expired ambiguous attempt can retry with duplicate risk retained');
select is(public.webpush_recover_expired((select id from webpush_context where key='unknown-job'),(select token from webpush_context where key='unknown-job')),'retry_wait','recovery replay does not create another attempt');
insert into webpush_context(key,id,token) select 'new-unknown-lease',job_id,lease_token from public.notification_claim((select id from webpush_context where key='unknown-job'));
select throws_ok($$select public.webpush_complete((select id from webpush_context where key='unknown-job'),(select token from webpush_context where key='unknown-job'),'provider_accepted','fc500000-0000-4000-8000-000000000005')$$,
 '42501','NOTIFICATION_LEASE_INVALID','late old worker cannot finalize a newer lease');
select is((select count(*) from public.webpush_prepare_delivery((select id from webpush_context where key='unknown-job'),(select token from webpush_context where key='unknown-job'))),0::bigint,'old recovered token has no send capability');
reset role;
select is((select state from private.notification_attempts where token=(select token from webpush_context where key='unknown-job')),'unknown','ambiguous prior acceptance remains auditable after recovery');
-- Session deletion is checked independently of the normal logout route.
insert into webpush_context(key,id) select 'session-job',id from private.notification_jobs where source_id='fc410000-0000-4000-8000-000000000003' and device_id=(select id from webpush_context where key='device');
set local role service_role;
update webpush_context set token=c.lease_token from public.notification_claim((select id from webpush_context where key='session-job')) c where key='session-job';
reset role;
update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id='fc110000-0000-4000-8000-000000000001';
set local role service_role;
select is((select count(*) from public.webpush_prepare_delivery((select id from webpush_context where key='session-job'),(select token from webpush_context where key='session-job'))),0::bigint,'time-boxed expired Auth session blocks delivery before row cleanup');
select throws_ok($$select * from public.webpush_device_status('fc100000-0000-4000-8000-000000000001','fc110000-0000-4000-8000-000000000001')$$,'42501','WEBPUSH_SESSION_REQUIRED','expired session cannot inspect status');
reset role;
update auth.sessions set not_after=null where id='fc110000-0000-4000-8000-000000000001';
-- Restricted/role-changed actors retain opt-out and minimal off status.
update public.profiles set is_restricted=true where id='fc100000-0000-4000-8000-000000000001';
set local role service_role;
select is((select device_active from public.webpush_device_status('fc100000-0000-4000-8000-000000000001','fc110000-0000-4000-8000-000000000001','https://push.example.invalid/one')),false,'restricted session can see safe off status');
select throws_ok($$select public.webpush_register_device('fc100000-0000-4000-8000-000000000001','fc110000-0000-4000-8000-000000000001','https://push.example.invalid/one',repeat('B',87),repeat('A',22),'fictional-consent')$$,
 '42501','NOTIFICATION_ACTOR_FORBIDDEN','restricted user cannot reenable delivery');
reset role;
select set_config('request.jwt.claim.sub','fc100000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"fc100000-0000-4000-8000-000000000001","session_id":"fc110000-0000-4000-8000-000000000001"}',true);
set local role authenticated;
select is(public.webpush_revoke_session(),1,'native logout revokes current session even when actor is restricted');
select is(public.webpush_revoke_session(),0,'native logout revocation is idempotent');
reset role;
select is((select state from private.push_subscriptions where id=(select id from webpush_context where key='legacy')),'active','logout does not guess ownership of legacy/unbound device');
select is((select state from private.push_subscriptions where id=(select id from webpush_context where key='device')),'revoked','logout leaves the old endpoint unusable');
update public.profiles set is_restricted=false where id='fc100000-0000-4000-8000-000000000001';
set local role service_role;
select is(public.webpush_register_device('fc100000-0000-4000-8000-000000000001','fc110000-0000-4000-8000-000000000004','https://push.example.invalid/one',repeat('B',87),repeat('A',22),'fictional-consent'),
 (select id from webpush_context where key='device'),'same account may explicitly bind a new verified session');
reset role;
select is((select auth_session_id from private.push_subscriptions where id=(select id from webpush_context where key='device')),'fc110000-0000-4000-8000-000000000004'::uuid,'explicit new-session consent replaces only same-owner session binding');
set local role authenticated;
select is(public.webpush_revoke_session(),0,'old session logout cannot revoke a newly consented session');
reset role;
set local role authenticated;
select is((select device_active from public.webpush_current_status('https://push.example.invalid/one')),false,'old-session native status reports only its own session is not enabled');
select lives_ok($$select public.webpush_revoke_current_device('https://push.example.invalid/one')$$,'native endpoint opt-out needs no service key or provider policy');
select is((select device_active from public.webpush_current_status('https://push.example.invalid/one')),false,'native post-revocation status is read from actual database state');
select lives_ok($$select public.webpush_revoke_current_device('https://push.example.invalid/one')$$,'native endpoint opt-out is idempotent');
reset role;
select is((select state from private.push_subscriptions where id=(select id from webpush_context where key='device')),'revoked','native endpoint opt-out affects only its JWT owner');
select set_config('request.jwt.claims','{"sub":"fc100000-0000-4000-8000-000000000001","session_id":"invalid"}',true);
set local role authenticated;
select throws_ok($$select public.webpush_revoke_session()$$,'42501','WEBPUSH_SESSION_REQUIRED','malformed native session claim is rejected safely');
reset role;
select * from finish();
rollback;
