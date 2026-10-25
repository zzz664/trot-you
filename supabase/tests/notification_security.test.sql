begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

-- Fictional local metadata only. Endpoint shape checks are not an SSRF
-- provider allowlist or proof of possession; no URL is ever fetched by SQL.
create temporary table notification_security_context(key text primary key,id uuid,token uuid);
grant all on notification_security_context to authenticated,service_role;
insert into auth.users(id,email,raw_user_meta_data)
select ('d1000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 'notification-security-'||n||'@example.invalid',
 '{"role":"admin","webpush_enabled":true,"consent_version":"forged","endpoint":"https://push.example.invalid/forged"}'::jsonb
 from generate_series(1,7) n;
update public.profiles set call_name='가상 보안 사용자',onboarding_completed_at=clock_timestamp()
 where id::text like 'd1000000-%' and id<>'d1000000-0000-4000-8000-000000000005';
update public.profiles set role='artist' where id='d1000000-0000-4000-8000-000000000003';
update public.profiles set role='admin' where id='d1000000-0000-4000-8000-000000000004';
update public.profiles set is_restricted=true where id='d1000000-0000-4000-8000-000000000006';
update public.profiles set is_restricted=true,restricted_until=now()-interval '1 second'
 where id='d1000000-0000-4000-8000-000000000007';
insert into public.artists(id,slug,name,grade,status) values
 ('d2000000-0000-4000-8000-000000000001','notification-security-main','가상 보안 가수','B','active');
insert into public.artist_members(artist_id,user_id) values
 ('d2000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000003');
insert into private.message_policy(version,history_before_seconds,cancel_window_seconds,max_text_length,max_reply_length,
 max_photos,max_voice_seconds,max_video_seconds,preview_max_count,max_photo_bytes,max_voice_bytes,max_video_bytes)
 values('fictional-message-security',604800,300,1000,100,10,180,60,5,10485760,20971520,104857600);
select is((select count(*) from private.notification_preferences),0::bigint,'untrusted signup metadata cannot manufacture opt-in preferences');
select is((select count(*) from private.push_subscriptions),0::bigint,'untrusted signup metadata cannot register endpoint or consent');
select ok((select bool_and(c.relrowsecurity) from pg_class c where c.oid in
 ('private.notification_policy'::regclass,'private.notification_preferences'::regclass,'private.push_subscriptions'::regclass,
  'private.notification_jobs'::regclass,'private.notification_attempts'::regclass)), 'all notification base tables enable RLS');
select ok((select bool_and(not has_table_privilege(r,t,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'))
 from unnest(array['anon','authenticated','service_role']) r cross join unnest(array[
 'private.notification_policy','private.notification_preferences','private.push_subscriptions',
 'private.notification_jobs','private.notification_attempts']) t),'all application roles lack raw sensitive-table reads and mutations');
select ok((select bool_and(not has_function_privilege(r,p.oid,'EXECUTE')) from pg_proc p
 join pg_namespace n on n.oid=p.pronamespace cross join unnest(array['anon','authenticated','service_role']) r
 where n.nspname='private' and (p.proname like 'notification\_%' escape '\' or p.proname='require_notification_service')),
 'private predicates and hooks cannot become arbitrary-recipient or source oracles');
select ok((select bool_and(p.prosecdef and 'search_path=""'=any(p.proconfig)) from pg_proc p
 join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'notification\_%' escape '\'),
 'every notification privilege crossing pins empty search path');
select ok((select bool_and(not has_function_privilege(r,p.oid,'EXECUTE')) from pg_proc p
 join pg_namespace n on n.oid=p.pronamespace cross join unnest(array['anon','authenticated']) r
 where n.nspname='public' and p.proname in ('notification_register_device','notification_revoke_device',
 'notification_enqueue','notification_claim','notification_list_due','notification_list_uncertain','notification_complete')),
 'no browser role may register trusted material, enumerate due work, enqueue or impersonate a worker');
select ok((select bool_and(has_function_privilege('service_role',p.oid,'EXECUTE')) from pg_proc p
 join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in (
 'notification_register_device','notification_revoke_device','notification_enqueue','notification_claim','notification_list_due','notification_list_uncertain','notification_complete')),
 'only narrow service entry points are explicitly granted');
select ok((select not (proargnames && array['endpoint','p256dh','auth']) from pg_proc
 where oid='public.notification_list_uncertain(integer,timestamp with time zone,uuid)'::regprocedure),
 'uncertain recovery projection contains no endpoint or encryption material');
select ok(not has_function_privilege('service_role','public.notification_get_preferences()','EXECUTE') and
 not has_function_privilege('service_role','public.notification_set_preferences(boolean,boolean,boolean,boolean)','EXECUTE'),
 'preference RPC requires the actual authenticated actor instead of an arbitrary service actor');
select ok((select bool_and(has_function_privilege(r,'public.notification_capabilities()','EXECUTE'))
 from unnest(array['anon','authenticated','service_role']) r),'safe capability booleans reveal no sensitive device records');
select ok(not exists(select 1 from information_schema.columns where table_schema='public'
 and (table_name like 'notification%' or table_name='push_subscriptions') and column_name in ('endpoint','p256dh','auth','phone')),
 'sensitive endpoint material has no public table or view projection');
select ok(not exists(select 1 from information_schema.columns where table_schema='private' and table_name='notification_jobs'
 and column_name in ('payload','url','redirect_url','phone','body','title','device_received_at')),
 'outbox stores neither arbitrary redirect/content payloads nor fictional device-receipt evidence');
set local role anon;
select is((select webpush_configured or alimtalk_configured or device_receipt_supported from public.notification_capabilities()),false,
 'anonymous capability result is truthful and safe');
select throws_ok($$select * from private.push_subscriptions$$,'42501',null,'anonymous clients cannot enumerate endpoints');
select throws_ok($$select * from public.notification_get_preferences()$$,'42501',null,'anonymous caller cannot inspect recipient preferences');
select throws_ok($$select * from public.notification_list_uncertain(100)$$,'42501',null,'anonymous caller cannot discover crashed worker tokens');
reset role;
select set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000001',true);
set local role authenticated;
select set_config('request.jwt.claims','{"role":"service_role","app_metadata":{"role":"admin"}}',true);
select throws_ok($$select public.notification_register_device('d1000000-0000-4000-8000-000000000001',
 'https://push.example.invalid/forged',repeat('B',87),repeat('A',22),'fictional-consent-v1')$$,
 '42501',null,'forged JWT role cannot bypass actual-role service grants');
select throws_ok($$select * from private.push_subscriptions$$,'42501',null,'fan cannot bulk read own or another endpoint');
select throws_ok($$select * from private.notification_jobs$$,'42501',null,'fan cannot inspect raw recipient jobs or lease tokens');
select throws_ok($$select * from public.notification_list_uncertain(100)$$,'42501',null,'forged-role fan cannot access reconciliation handles');
select throws_ok($$select private.notification_actor_eligible('d1000000-0000-4000-8000-000000000002',now())$$,
 '42501',null,'private predicate is not a cross-user eligibility oracle');
select throws_ok($$select public.notification_set_preferences(null,true,true,true)$$,'22004',null,'NULL global preference is rejected');
select throws_ok($$select public.notification_set_preferences(true,null,true,true)$$,'22004',null,'NULL message preference is rejected');
select throws_ok($$select public.notification_set_preferences(true,true,null,true)$$,'22004',null,'NULL billing preference is rejected');
select throws_ok($$select public.notification_set_preferences(true,true,true,null)$$,'22004',null,'NULL schedule preference is rejected');
select lives_ok($$select public.notification_set_preferences(true,true,true,true)$$,'eligible actor may set only own preferences');
reset role;
select is((select count(*) from private.notification_preferences where user_id<>'d1000000-0000-4000-8000-000000000001'),0::bigint,
 'own preference update cannot touch another profile');
set local role service_role;
select throws_ok($$select * from private.push_subscriptions$$,'42501',null,'service also cannot bulk enumerate raw endpoints');
select throws_ok($$update private.notification_jobs set state='provider_accepted'$$,'42501',null,'service cannot bypass transition/evidence checks by raw update');
select throws_ok($$delete from private.notification_attempts$$,'42501',null,'service cannot erase attempt evidence');
select throws_ok($$select public.notification_register_device('d1000000-0000-4000-8000-000000000001',
 'https://push.example.invalid/one',repeat('B',87),repeat('A',22),'fictional-consent-v1')$$,
 '55000',null,'registration fails closed without approved consent policy');
reset role;
insert into private.notification_policy(version,consent_version,webpush_enabled,max_attempts,retry_seconds,lease_seconds,schedule_lead_seconds)
 values('fictional-notification-v1','fictional-consent-v1',true,2,10,30,86400);
select throws_ok($$update private.notification_policy set max_attempts=0$$,'23514',null,'attempt policy has a nonzero lower bound');
select throws_ok($$update private.notification_policy set max_attempts=11$$,'23514',null,'attempt policy cannot create unlimited retries');
select throws_ok($$update private.notification_policy set retry_seconds=0$$,'23514',null,'retry delay must be positive');
select throws_ok($$update private.notification_policy set retry_seconds=86401$$,'23514',null,'retry delay has a structural ceiling');
select throws_ok($$update private.notification_policy set lease_seconds=4$$,'23514',null,'lease duration has a structural minimum');
select throws_ok($$update private.notification_policy set lease_seconds=301$$,'23514',null,'lease duration has a structural maximum');
select throws_ok($$update private.notification_policy set schedule_lead_seconds=-1$$,'23514',null,'negative schedule lead is rejected');
select throws_ok($$update private.notification_policy set schedule_lead_seconds=0$$,'23514',null,'zero lead cannot schedule a notice only after its source eligibility ends');
select throws_ok($$update private.notification_policy set consent_version='   '$$,'23514',null,'blank consent version is rejected');
set local role service_role;
select throws_ok($$select public.notification_register_device('d1000000-0000-4000-8000-000000000001',
 'https://push.example.invalid/one',repeat('B',87),repeat('A',22),'unapproved-consent')$$,
 '55000',null,'caller cannot choose an unapproved consent contract');
select throws_ok($$select public.notification_register_device('d1000000-0000-4000-8000-000000000001',
 'https://push.example.invalid/one',repeat('B',87),repeat('A',22),null)$$,
 '55000',null,'missing consent never falls back to policy defaults');
select throws_ok($$select public.notification_register_device('d1000000-0000-4000-8000-000000000003',
 'https://push.example.invalid/artist',repeat('B',87),repeat('A',22),'fictional-consent-v1')$$,
 '42501',null,'artist account is not an eligible fan recipient');
select throws_ok($$select public.notification_register_device('d1000000-0000-4000-8000-000000000004',
 'https://push.example.invalid/admin',repeat('B',87),repeat('A',22),'fictional-consent-v1')$$,
 '42501',null,'admin privilege does not imply fan recipient consent');
select throws_ok($$select public.notification_register_device('d1000000-0000-4000-8000-000000000005',
 'https://push.example.invalid/onboarding',repeat('B',87),repeat('A',22),'fictional-consent-v1')$$,
 '42501',null,'incomplete onboarding cannot register an eligible recipient');
select throws_ok($$select public.notification_register_device('d1000000-0000-4000-8000-000000000006',
 'https://push.example.invalid/restricted',repeat('B',87),repeat('A',22),'fictional-consent-v1')$$,
 '42501',null,'currently restricted profile cannot register a device');
select throws_ok($$select public.notification_register_device(null,
 'https://push.example.invalid/missing',repeat('B',87),repeat('A',22),'fictional-consent-v1')$$,
 '42501',null,'missing actor cannot be inferred from untrusted endpoint payload');
select throws_ok($$select public.notification_register_device('d1000000-0000-4000-8000-000000000001',
 'http://push.example.invalid/no-tls',repeat('B',87),repeat('A',22),'fictional-consent-v1')$$,
 '23514',null,'non-HTTPS endpoint is structurally rejected');
select throws_ok($$select public.notification_register_device('d1000000-0000-4000-8000-000000000001',
 'https://user@push.example.invalid/credentials',repeat('B',87),repeat('A',22),'fictional-consent-v1')$$,
 '23514',null,'URI userinfo is not accepted as opaque endpoint material');
select throws_ok($$select public.notification_register_device('d1000000-0000-4000-8000-000000000001',
 'https://push.example.invalid/path#fragment',repeat('B',87),repeat('A',22),'fictional-consent-v1')$$,
 '23514',null,'endpoint fragments are rejected');
select throws_ok($$select public.notification_register_device('d1000000-0000-4000-8000-000000000001',
 'https://push.example.invalid/has space',repeat('B',87),repeat('A',22),'fictional-consent-v1')$$,
 '23514',null,'endpoint whitespace is rejected');
select throws_ok($$select public.notification_register_device('d1000000-0000-4000-8000-000000000001',
 'https://push.example.invalid/'||repeat('a',2048),repeat('B',87),repeat('A',22),'fictional-consent-v1')$$,
 '23514',null,'endpoint size is structurally bounded');
select throws_ok($$select public.notification_register_device('d1000000-0000-4000-8000-000000000001',
 'https://push.example.invalid/one',repeat('B',86),repeat('A',22),'fictional-consent-v1')$$,
 '23514',null,'P-256 material length is checked before storage');
select throws_ok($$select public.notification_register_device('d1000000-0000-4000-8000-000000000001',
 'https://push.example.invalid/one',repeat('B',86)||'=',repeat('A',22),'fictional-consent-v1')$$,
 '23514',null,'key material must use the allowed unpadded base64url alphabet');
select throws_ok($$select public.notification_register_device('d1000000-0000-4000-8000-000000000001',
 'https://push.example.invalid/one',repeat('B',87),repeat('A',23),'fictional-consent-v1')$$,
 '23514',null,'authentication secret material has an exact structural length');
insert into notification_security_context(key,id) values('device',public.notification_register_device(
 'd1000000-0000-4000-8000-000000000001','https://push.example.invalid/security-one',repeat('B',87),repeat('A',22),'fictional-consent-v1'));
select throws_ok($$select public.notification_register_device('d1000000-0000-4000-8000-000000000002',
 'https://push.example.invalid/security-one',repeat('B',87),repeat('A',22),'fictional-consent-v1')$$,
 '23514',null,'endpoint uniqueness cannot silently transfer ownership to another actor');
select throws_ok($$select public.notification_register_device('d1000000-0000-4000-8000-000000000001',
 'https://push.example.invalid/security-one',repeat('C',87),repeat('A',22),'fictional-consent-v1')$$,
 '23514',null,'same endpoint cannot silently replace cryptographic material');
select throws_ok($$select public.notification_revoke_device('d1000000-0000-4000-8000-000000000002',
 (select id from notification_security_context where key='device'))$$,'42501',null,'actor cannot revoke another user device');
select throws_ok($$select public.notification_revoke_device(null,(select id from notification_security_context where key='device'))$$,
 '42501',null,'missing actor is not a wildcard revocation');
select throws_ok($$select public.notification_enqueue('alimtalk',gen_random_uuid())$$,'22023',null,'unconfigured channel is not a source kind or hidden provider protocol');
select throws_ok($$select public.notification_enqueue(null,gen_random_uuid())$$,'22023',null,'NULL source kind is rejected');
select throws_ok($$select public.notification_enqueue('message',null)$$,'22023',null,'NULL source identity is rejected');
select is(public.notification_enqueue('message','d3000000-0000-4000-8000-000000000099'),0,'nonexistent source cannot manufacture work');
select throws_ok($$select * from public.notification_list_due(0)$$,'22023',null,'due list cannot request zero rows');
select throws_ok($$select * from public.notification_list_due(101)$$,'22023',null,'due list has an explicit maximum, not bulk secret access');
select throws_ok($$select * from public.notification_list_due(null)$$,'22023',null,'NULL page size does not disable bound');
select throws_ok($$select * from public.notification_list_uncertain(0)$$,'22023',null,'uncertain recovery page requires positive bound');
select throws_ok($$select * from public.notification_list_uncertain(101)$$,'22023',null,'uncertain recovery cannot request an unbounded token directory');
select throws_ok($$select * from public.notification_list_uncertain(null)$$,'22023',null,'NULL uncertain page does not remove its bound');
select throws_ok($$select * from public.notification_list_uncertain(100,now(),null)$$,'22023',null,'uncertain cursor requires its UUID tie-breaker');
select throws_ok($$select * from public.notification_list_uncertain(100,null,gen_random_uuid())$$,'22023',null,'uncertain cursor UUID requires its expiry timestamp');
select throws_ok($$select * from public.notification_list_uncertain(100,'infinity',gen_random_uuid())$$,'22023',null,'uncertain cursor timestamp must be finite');
select is((select count(*) from public.notification_claim(null)),0::bigint,'missing job returns no delivery credential');
select throws_ok($$select public.notification_complete(null,null,'unknown',null)$$,'22023',null,'completion requires a fencing token');
select throws_ok($$select public.notification_complete(null,gen_random_uuid(),'sent',gen_random_uuid())$$,'22023',null,'ambiguous sent state cannot imply receipt');
select throws_ok($$select public.notification_complete(null,gen_random_uuid(),'device_received',gen_random_uuid())$$,
 '22023',null,'worker cannot invent device receipt proof');
select throws_ok($$select public.notification_complete(null,gen_random_uuid(),'retry',gen_random_uuid())$$,
 '22023',null,'worker cannot request an evidence-free blind retry');
reset role;

-- Current authoritative eligibility, not enqueue-time snapshots, controls the
-- lease. Each test uses a fresh identity because canceled jobs never resurrect.
insert into public.subscriptions(id,user_id,artist_id,provider,status,first_started_at,episode_started_at,current_period_start,current_period_end)
 values('d4000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000001',
 'd2000000-0000-4000-8000-000000000001','toss','active',now()-interval '1 day',now()-interval '1 day',now()-interval '1 day',now()+interval '1 day');
select set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000002',true);
set local role authenticated;
select lives_ok($$select public.notification_set_preferences(true,true,true,true)$$,'other fan may opt in without gaining subscription rights');
reset role;
set local role service_role;
insert into notification_security_context(key,id) values('unsubscribed-device',public.notification_register_device(
 'd1000000-0000-4000-8000-000000000002','https://push.example.invalid/unsubscribed',repeat('C',87),repeat('A',22),'fictional-consent-v1'));
reset role;
insert into public.messages(id,artist_id,author_id,type,body,status,scheduled_at,sent_at)
select ('d3000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 'd2000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000003','text','비공개 원문',
 'sent',now(),now() from generate_series(1,8) n;
select is((select count(*) from private.notification_jobs),8::bigint,'only the eligible subscribed fan receives one job per source');
select is((select count(*) from private.notification_jobs where user_id='d1000000-0000-4000-8000-000000000002'),0::bigint,
 'preferences and endpoint consent never replace paid-message entitlement');
insert into notification_security_context(key,id) select 'gate-'||right(source_id::text,1),id from private.notification_jobs;
update public.profiles set is_restricted=true where id='d1000000-0000-4000-8000-000000000001';
set local role service_role;
select is((select count(*) from public.notification_claim((select id from notification_security_context where key='gate-1'))),0::bigint,
 'recipient restriction added after enqueue blocks lease');
reset role;
select is((select state from private.notification_jobs where id=(select id from notification_security_context where key='gate-1')),'canceled',
 'restriction denial is a terminal suppressed notification, not a temporary entitlement bypass');
update public.profiles set is_restricted=false where id='d1000000-0000-4000-8000-000000000001';
update public.profiles set role='admin' where id='d1000000-0000-4000-8000-000000000001';
set local role service_role;
select is((select count(*) from public.notification_claim((select id from notification_security_context where key='gate-2'))),0::bigint,
 'recipient role change after enqueue blocks fan-only delivery');
reset role;
update public.profiles set role='fan' where id='d1000000-0000-4000-8000-000000000001';
update public.artists set status='paused' where id='d2000000-0000-4000-8000-000000000001';
set local role service_role;
select is((select count(*) from public.notification_claim((select id from notification_security_context where key='gate-3'))),0::bigint,
 'artist deactivation after enqueue is authoritative at lease');
reset role;
update public.artists set status='active' where id='d2000000-0000-4000-8000-000000000001';
update public.subscriptions set status='expired',current_period_end=now()-interval '1 hour'
 where id='d4000000-0000-4000-8000-000000000001';
set local role service_role;
select is((select count(*) from public.notification_claim((select id from notification_security_context where key='gate-4'))),0::bigint,
 'expired entitlement cannot receive a paid message queued while active');
reset role;
update public.subscriptions set status='active',current_period_end=now()+interval '1 day'
 where id='d4000000-0000-4000-8000-000000000001';
update private.notification_policy set consent_version='fictional-consent-v2';
set local role service_role;
select is((select count(*) from public.notification_claim((select id from notification_security_context where key='gate-5'))),0::bigint,
 'old device consent is not silently upgraded when the approved contract changes');
reset role;
update private.notification_policy set consent_version='fictional-consent-v1';
update private.notification_policy set webpush_enabled=false;
set local role service_role;
select is((select count(*) from public.notification_claim((select id from notification_security_context where key='gate-6'))),0::bigint,
 'global channel deactivation blocks preexisting queued work');
reset role;
update private.notification_policy set webpush_enabled=true;
update public.messages set sent_at=now()+interval '1 day' where id='d3000000-0000-4000-8000-000000000007';
set local role service_role;
select is((select count(*) from public.notification_claim((select id from notification_security_context where key='gate-7'))),0::bigint,
 'future source timestamp cannot be delivered early even if its queue row exists');
reset role;
update public.messages set sent_at=now() where id='d3000000-0000-4000-8000-000000000007';
update public.profiles set onboarding_completed_at=null where id='d1000000-0000-4000-8000-000000000001';
set local role service_role;
select is((select count(*) from public.notification_claim((select id from notification_security_context where key='gate-8'))),0::bigint,
 'onboarding revocation is rechecked before releasing sensitive endpoint credentials');
reset role;
update public.profiles set onboarding_completed_at=clock_timestamp() where id='d1000000-0000-4000-8000-000000000001';
select is((select count(*) from private.notification_attempts),0::bigint,'failed eligibility gates create no provider-attempt authorization');
select is((select count(*) from private.notification_jobs where state='canceled'),8::bigint,'all invalidated source jobs retain terminal dedupe identities');
set local role service_role;
select is(public.notification_enqueue('message','d3000000-0000-4000-8000-000000000001'),0,
 'restored eligibility cannot replay a previously suppressed source/device identity');
reset role;

insert into public.messages(id,artist_id,author_id,type,body) values
 ('d3000000-0000-4000-8000-000000000009','d2000000-0000-4000-8000-000000000001',
 'd1000000-0000-4000-8000-000000000003','text','미발송 원문');
set local role service_role;
select is(public.notification_enqueue('message','d3000000-0000-4000-8000-000000000009'),0,'draft source cannot be enqueued through recovery RPC');
reset role;
-- Explicit rollback-only next-day policy and session-bound recipient. Legacy
-- rolling-hour enqueue is no longer an authorization path for schedule pushes.
insert into private.schedule_notice_policies(version,hour_kst,approved_at,published_at)
 values('d7000000-0000-4000-8000-000000000001',0,now(),now());
insert into private.schedule_notice_policy_current(policy_version)
 values('d7000000-0000-4000-8000-000000000001');
insert into auth.sessions(id,user_id,created_at,updated_at)
 values('d1100000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000001',now(),now());
set local role service_role;
select is(public.webpush_register_device('d1000000-0000-4000-8000-000000000001',
 'd1100000-0000-4000-8000-000000000001','https://push.example.invalid/security-one',repeat('B',87),repeat('A',22),'fictional-consent-v1'),
 (select id from notification_security_context where key='device'),'explicit session-bound opt-in retains canonical owned endpoint');
reset role;
insert into public.schedules(id,artist_id,type,status,title,starts_at,created_by) values
 ('d5000000-0000-4000-8000-000000000001','d2000000-0000-4000-8000-000000000001','event','published','가상 알림 끄기',
 (((clock_timestamp() at time zone 'Asia/Seoul')::date+1)::timestamp+interval '12 hours') at time zone 'Asia/Seoul',
 'd1000000-0000-4000-8000-000000000004');
set local role service_role;
select is((select push_jobs from public.schedule_notice_create('d5000000-0000-4000-8000-000000000001')),1,
 'approved next-day worker creates the opt-out race subject');
reset role;
insert into notification_security_context(key,id) select 'schedule-job',id from private.notification_jobs
 where source_id='d5000000-0000-4000-8000-000000000001';
select set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000001',true);
set local role authenticated;
select is(public.schedule_set_notification('d5000000-0000-4000-8000-000000000001',false),false,'existing per-event opt-out remains available');
reset role;
set local role service_role;
select is((select count(*) from public.notification_claim((select id from notification_security_context where key='schedule-job'))),0::bigint,
 'event-specific opt-out is rechecked before claiming a queued reminder');
reset role;
select is((select state from private.notification_jobs where id=(select id from notification_security_context where key='schedule-job')),'canceled',
 'event-specific suppression is retained without deleting its source association');

-- Privileged account types cannot inspect fan-only preferences or endpoints.
select set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000003',true);
set local role authenticated;
select throws_ok($$select * from public.notification_get_preferences()$$,'42501',null,'artist is not automatically a notification recipient');
select throws_ok($$select * from private.push_subscriptions$$,'42501',null,'artist cannot inspect fan endpoint material');
reset role;
select set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000004',true);
set local role authenticated;
select throws_ok($$select public.notification_set_preferences(true,true,true,true)$$,'42501',null,'admin role does not bypass fan-only preference gate');
select throws_ok($$select * from private.notification_attempts$$,'42501',null,'authenticated admin cannot inspect worker tokens or evidence ledger');
reset role;
select set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000005',true);
set local role authenticated;
select throws_ok($$select * from public.notification_get_preferences()$$,'42501',null,'incomplete onboarding cannot inspect recipient capability as an eligible fan');
reset role;
select set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000006',true);
set local role authenticated;
select throws_ok($$select public.notification_set_preferences(true,true,true,true)$$,'42501',null,'currently restricted actor cannot opt in through client RPC');
reset role;
select set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000007',true);
set local role authenticated;
select lives_ok($$select public.notification_set_preferences(true,true,true,true)$$,'expired restriction does not permanently ban ordinary preferences');
reset role;
set local role service_role;
select lives_ok($$select public.notification_register_device('d1000000-0000-4000-8000-000000000007',
 'https://push.example.invalid/expired-restriction',repeat('D',87),repeat('A',22),'fictional-consent-v1')$$,
 'registration evaluates the current restriction expiry rather than stale boolean alone');
reset role;
update public.profiles set is_restricted=true where id='d1000000-0000-4000-8000-000000000001';
set local role service_role;
select lives_ok($$select public.notification_revoke_device('d1000000-0000-4000-8000-000000000001',
 (select id from notification_security_context where key='device'))$$,'restricted actor retains ability to withdraw own device consent');
reset role;
update public.profiles set is_restricted=false where id='d1000000-0000-4000-8000-000000000001';
set local role service_role;
select throws_ok($$select public.notification_register_device('d1000000-0000-4000-8000-000000000001',
 'https://push.example.invalid/security-one',repeat('B',87),repeat('A',22),'fictional-consent-v1')$$,
 '55000',null,'replayed registration cannot resurrect a revoked endpoint');
reset role;

select * from finish();
rollback;
