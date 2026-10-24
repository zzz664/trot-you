begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

-- Fictional rollback-only source/device metadata. No real endpoint, key,
-- provider exchange, delivered message or device receipt is involved.
create temporary table notification_context(key text primary key,id uuid,token uuid,stamp timestamptz);
grant all on notification_context to authenticated,service_role;
insert into auth.users(id,email,raw_user_meta_data)
select ('c1000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid,
 'notification-lifecycle-' || n || '@example.invalid','{}'::jsonb from generate_series(1,6) n;
update public.profiles set call_name='가상 알림 사용자',onboarding_completed_at=now()
 where id::text like 'c1000000-%' and id <> 'c1000000-0000-4000-8000-000000000005';
update public.profiles set role='artist' where id='c1000000-0000-4000-8000-000000000003';
update public.profiles set role='admin' where id='c1000000-0000-4000-8000-000000000004';
update public.profiles set is_restricted=true where id='c1000000-0000-4000-8000-000000000006';
insert into public.artists(id,slug,name,grade,status) values
 ('c2000000-0000-4000-8000-000000000001','notification-lifecycle-main','가상 알림 가수','B','active');
insert into public.artist_members(artist_id,user_id) values
 ('c2000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000003');
insert into public.subscriptions(id,user_id,artist_id,provider,status,first_started_at,episode_started_at,current_period_start,current_period_end)
select ('c4000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid,
 ('c1000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid,
 'c2000000-0000-4000-8000-000000000001','toss','active',now()-interval '1 day',now()-interval '1 day',now()-interval '1 day',now()+interval '1 day'
 from generate_series(1,6) n;
insert into private.message_policy(version,history_before_seconds,cancel_window_seconds,max_text_length,max_reply_length,
 max_photos,max_voice_seconds,max_video_seconds,preview_max_count,max_photo_bytes,max_voice_bytes,max_video_bytes)
 values('fictional-message-policy',604800,300,1000,100,10,180,60,5,10485760,20971520,104857600);
select is((select count(*) from private.notification_policy),0::bigint,'migration does not activate a notification policy');
select is((select count(*) from private.push_subscriptions),0::bigint,'migration does not fabricate device consent');
select is((select count(*) from private.notification_jobs),0::bigint,'migration does not enqueue historical notifications');
select set_config('request.jwt.claim.sub','c1000000-0000-4000-8000-000000000001',true);
set local role authenticated;
select is((select webpush_configured from public.notification_capabilities()),false,'Web Push is unavailable before policy configuration');
select is((select delivery_implemented from public.notification_capabilities()),false,'DB capability does not advertise an implemented sender');
select is((select alimtalk_configured from public.notification_capabilities()),false,'unresolved Alimtalk provider remains unavailable');
select is((select device_receipt_supported from public.notification_capabilities()),false,'provider acceptance is never device receipt support');
select is((select webpush_enabled or new_message or billing or schedule from public.notification_get_preferences()),false,
 'missing preference row fails closed instead of assuming consent');
select lives_ok($$select public.notification_set_preferences(true,true,true,true)$$,'actor can explicitly choose own preferences');
select is((select webpush_enabled and new_message and billing and schedule from public.notification_get_preferences()),true,
 'safe own-preference projection reports the chosen values');
reset role;
insert into private.notification_policy(version,consent_version,webpush_enabled,max_attempts,retry_seconds,lease_seconds,schedule_lead_seconds)
 values('fictional-notification-v1','fictional-consent-v1',true,2,10,30,86400);
set local role authenticated;
select is((select webpush_configured from public.notification_capabilities()),true,'explicit policy configures only the supported DB channel');
select is((select delivery_implemented from public.notification_capabilities()),false,'approved DB policy still does not imply a delivery adapter or running worker');
select is((select alimtalk_configured or device_receipt_supported from public.notification_capabilities()),false,
 'Web Push policy does not enable Alimtalk or claim device receipt');
reset role;
set local role service_role;
insert into notification_context(key,id) values('device1',public.notification_register_device(
 'c1000000-0000-4000-8000-000000000001','https://push.example.invalid/device-one',repeat('B',87),repeat('A',22),'fictional-consent-v1'));
insert into notification_context(key,id) values('device2',public.notification_register_device(
 'c1000000-0000-4000-8000-000000000001','https://push.example.invalid/device-two',repeat('C',87),repeat('A',22),'fictional-consent-v1'));
select is(public.notification_register_device('c1000000-0000-4000-8000-000000000001',
 'https://push.example.invalid/device-one',repeat('B',87),repeat('A',22),'fictional-consent-v1'),
 (select id from notification_context where key='device1'),'same own device registration is idempotent');
reset role;
select is((select count(*) from private.push_subscriptions),2::bigint,'two actual device identities remain distinct');
select is((select state::text from private.push_subscriptions where id=(select id from notification_context where key='device1')),
 'active','registration records explicit active consent');
select is((select consent_version from private.push_subscriptions where id=(select id from notification_context where key='device1')),
 'fictional-consent-v1','device retains explicit consent version');
select ok((select consented_at between now() and clock_timestamp() from private.push_subscriptions
 where id=(select id from notification_context where key='device1')),'consent timestamp is server generated');

-- Actual messaging RPC commits publication and its outbox in one transaction.
set local role service_role;
insert into notification_context(key,id) values('message',public.messaging_save_draft(
 'c1000000-0000-4000-8000-000000000003','c2000000-0000-4000-8000-000000000001',null,'text','알림 원문 {이름}'));
select lives_ok($$select public.messaging_schedule('c1000000-0000-4000-8000-000000000003',
 (select id from notification_context where key='message'),now())$$,'message schedule remains authorized');
select is(public.messaging_dispatch((select id from notification_context where key='message')),true,'actual dispatch publishes source');
select is(public.notification_enqueue('message',(select id from notification_context where key='message')),0,'source replay inserts no duplicate deliveries');
reset role;
select is((select count(*) from private.notification_jobs where source_id=(select id from notification_context where key='message')),2::bigint,
 'one recipient gets exactly one source/channel job per consented device');
select is((select count(distinct user_id) from private.notification_jobs where source_id=(select id from notification_context where key='message')),1::bigint,
 'paid fans without explicit preferences/device consent are excluded');
select ok((select bool_and(message_id=source_id and payment_event_id is null and schedule_id is null and channel='webpush')
 from private.notification_jobs where source_id=(select id from notification_context where key='message')),'message source association is normalized, not inferred from arbitrary JSON');
select ok((select bool_and(route_kind='artist_chat' and route_id='c2000000-0000-4000-8000-000000000001')
 from private.notification_jobs where source_id=(select id from notification_context where key='message')),'internal route type and artist UUID replace arbitrary click URLs');
select ok((select bool_and(state='queued' and attempt_count=0 and lease_token is null and provider_accepted_at is null)
 from private.notification_jobs where source_id=(select id from notification_context where key='message')),'enqueue is not a lease, provider acceptance or delivery');
select ok((select bool_and(max_attempts=2 and retry_seconds=10 and lease_seconds=30 and policy_version='fictional-notification-v1')
 from private.notification_jobs where source_id=(select id from notification_context where key='message')),'jobs retain the approved retry/lease policy snapshot');
insert into notification_context(key,id) select 'job1',id from private.notification_jobs
 where source_id=(select id from notification_context where key='message') and device_id=(select id from notification_context where key='device1');
insert into notification_context(key,id) select 'job2',id from private.notification_jobs
 where source_id=(select id from notification_context where key='message') and device_id=(select id from notification_context where key='device2');
set local role service_role;
select is((select count(*) from public.notification_list_due(100)),2::bigint,'bounded due list exposes pending job handles to the worker only');
insert into notification_context(key,id,token,stamp) select 'claim1',job_id,lease_token,lease_expires_at
 from public.notification_claim((select id from notification_context where key='job1'));
select is((select count(*) from public.notification_claim((select id from notification_context where key='job1'))),0::bigint,
 'a second worker cannot obtain an already leased job');
select is((select count(*) from public.notification_list_uncertain(100)),0::bigint,'live leases are not exposed as uncertain recovery work');
reset role;
select ok((select token is not null and stamp>clock_timestamp() from notification_context where key='claim1'),'claim returns a bounded live fencing token');
select is((select state from private.notification_jobs where id=(select id from notification_context where key='job1')),'leased','claim persists state before any external attempt');
select is((select attempt_count from private.notification_jobs where id=(select id from notification_context where key='job1')),1,'first claim creates exactly one attempt ordinal');
select is((select count(*) from private.notification_attempts where job_id=(select id from notification_context where key='job1')),1::bigint,
 'attempt ledger records one durable dispatch authorization');
set local role service_role;
select throws_ok($$select public.notification_complete((select id from notification_context where key='job1'),
 'c9000000-0000-4000-8000-000000000099','provider_accepted','c9000000-0000-4000-8000-000000000001')$$,
 '42501',null,'wrong token cannot acknowledge another worker lease');
select throws_ok($$select public.notification_complete((select id from notification_context where key='job1'),
 (select token from notification_context where key='claim1'),'provider_accepted',null)$$,
 '22023',null,'acceptance requires definitive evidence, not an assumed success');
select is(public.notification_complete((select id from notification_context where key='job1'),
 (select token from notification_context where key='claim1'),'provider_accepted','c9000000-0000-4000-8000-000000000001'),
 'provider_accepted','verified provider acceptance is represented precisely');
select is(public.notification_complete((select id from notification_context where key='job1'),
 (select token from notification_context where key='claim1'),'provider_accepted','c9000000-0000-4000-8000-000000000001'),
 'provider_accepted','identical acknowledgment replay is idempotent');
select is((select count(*) from public.notification_claim((select id from notification_context where key='job1'))),0::bigint,
 'accepted job cannot be leased again');
reset role;
select ok((select provider_accepted_at is not null from private.notification_jobs where id=(select id from notification_context where key='job1')),
 'provider acceptance records its server timestamp');
select is((select state from private.notification_attempts where job_id=(select id from notification_context where key='job1') and ordinal=1),
 'provider_accepted','attempt records actual accepted outcome without invented device receipt');

-- Uncertain outcomes are never blindly retried, even after lease expiration.
set local role service_role;
insert into notification_context(key,id,token) select 'claim2',job_id,lease_token
 from public.notification_claim((select id from notification_context where key='job2'));
select is(public.notification_complete((select id from notification_context where key='job2'),
 (select token from notification_context where key='claim2'),'unknown',null),'unknown','lost response becomes unknown, never retryable by assumption');
select is((select lease_token from public.notification_list_uncertain(100) where job_id=(select id from notification_context where key='job2')),
 (select token from notification_context where key='claim2'),'reconciliation can recover the original unknown attempt token without re-claiming it');
select is((select count(*) from public.notification_claim((select id from notification_context where key='job2'))),0::bigint,
 'unknown provider outcome cannot create a second worker');
select is(public.notification_complete((select id from notification_context where key='job2'),
 (select token from notification_context where key='claim2'),'not_sent','c9000000-0000-4000-8000-000000000002'),
 'retry_wait','verified non-send can resolve uncertainty into a delayed retry');
select is((select count(*) from public.notification_claim((select id from notification_context where key='job2'))),0::bigint,
 'retry delay cannot be skipped');
reset role;
select is((select state from private.notification_attempts where job_id=(select id from notification_context where key='job2') and ordinal=1),
 'not_sent','attempt keeps definitive non-send evidence');
update private.notification_jobs set next_attempt_at=clock_timestamp()-interval '1 second' where id=(select id from notification_context where key='job2');
set local role service_role;
insert into notification_context(key,id,token) select 'retry2',job_id,lease_token
 from public.notification_claim((select id from notification_context where key='job2'));
select isnt((select token from notification_context where key='retry2'),(select token from notification_context where key='claim2'),
 'new attempt receives a new fencing token');
select throws_ok($$select public.notification_complete((select id from notification_context where key='job2'),
 (select token from notification_context where key='claim2'),'provider_accepted','c9000000-0000-4000-8000-000000000003')$$,
 '23514',null,'superseded worker cannot acknowledge the replacement attempt');
select is(public.notification_complete((select id from notification_context where key='job2'),
 (select token from notification_context where key='retry2'),'not_sent','c9000000-0000-4000-8000-000000000004'),
 'failed','configured maximum bounds definitive retries');
select is((select count(*) from public.notification_claim((select id from notification_context where key='job2'))),0::bigint,
 'exhausted job cannot restart its attempt budget');
reset role;
select is((select count(*) from private.notification_attempts where job_id=(select id from notification_context where key='job2')),2::bigint,
 'both distinct attempt outcomes remain in the ledger');

-- Each source has two devices, allowing cancellation to cover pending and
-- leased states without mutating the business source via a worker argument.
insert into public.messages(id,artist_id,author_id,type,body,status,scheduled_at)
select ('c3000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 'c2000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000003','text','가상 경계 알림','scheduled',now()
 from generate_series(1,6) n;
set local role service_role;
select ok(public.messaging_dispatch(('c3000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid),
 'additional source '||n||' publishes with its outbox') from generate_series(1,6) n;
reset role;
insert into notification_context(key,id) select 'cancel-leased',id from private.notification_jobs
 where source_id='c3000000-0000-4000-8000-000000000002' and device_id=(select id from notification_context where key='device1');
insert into notification_context(key,id) select 'expires',id from private.notification_jobs
 where source_id='c3000000-0000-4000-8000-000000000003' and device_id=(select id from notification_context where key='device1');
insert into notification_context(key,id) select 'dead',id from private.notification_jobs
 where source_id='c3000000-0000-4000-8000-000000000004' and device_id=(select id from notification_context where key='device1');
insert into notification_context(key,id) select 'preference-recheck',id from private.notification_jobs
 where source_id='c3000000-0000-4000-8000-000000000005' and device_id=(select id from notification_context where key='device2');
insert into notification_context(key,id) select 'revoke',id from private.notification_jobs
 where source_id='c3000000-0000-4000-8000-000000000006' and device_id=(select id from notification_context where key='device2');
set local role service_role;
select lives_ok($$select public.messaging_cancel('c1000000-0000-4000-8000-000000000003',
 'c3000000-0000-4000-8000-000000000001')$$,'source cancellation uses original author rights');
reset role;
select is((select count(*) from private.notification_jobs where source_id='c3000000-0000-4000-8000-000000000001'),2::bigint,
 'cancellation retains dedupe identities instead of deleting evidence');
select ok((select bool_and(state='canceled') from private.notification_jobs where source_id='c3000000-0000-4000-8000-000000000001'),
 'source cancellation suppresses all not-yet-claimed devices');
set local role service_role;
select is(public.notification_enqueue('message','c3000000-0000-4000-8000-000000000001'),0,
 'canceled source replay cannot recreate deleted or canceled jobs');
insert into notification_context(key,id,token) select 'cancel-claim',job_id,lease_token
 from public.notification_claim((select id from notification_context where key='cancel-leased'));
select lives_ok($$select public.messaging_cancel('c1000000-0000-4000-8000-000000000003',
 'c3000000-0000-4000-8000-000000000002')$$,'source can be canceled while one provider attempt is in flight');
reset role;
select is((select state from private.notification_jobs where id=(select id from notification_context where key='cancel-leased')),
 'leased','canceling cannot falsely claim that an in-flight provider send never occurred');
select ok((select cancellation_requested_at is not null from private.notification_jobs where id=(select id from notification_context where key='cancel-leased')),
 'in-flight cancellation request is durably associated with the same source');
select is((select count(*) from private.notification_jobs where source_id='c3000000-0000-4000-8000-000000000002' and state='canceled'),1::bigint,
 'the unleased sibling is canceled immediately');
set local role service_role;
select is(public.notification_complete((select id from notification_context where key='cancel-leased'),
 (select token from notification_context where key='cancel-claim'),'provider_accepted','c9000000-0000-4000-8000-000000000005'),
 'provider_accepted','verified in-flight acceptance survives cancellation without promising retraction');
insert into notification_context(key,id,token) select 'expires-claim',job_id,lease_token
 from public.notification_claim((select id from notification_context where key='expires'));
reset role;
update private.notification_jobs set lease_expires_at=clock_timestamp()-interval '1 second' where id=(select id from notification_context where key='expires');
update private.notification_attempts set lease_expires_at=clock_timestamp()-interval '1 second' where job_id=(select id from notification_context where key='expires');
set local role service_role;
select is((select lease_token from public.notification_list_uncertain(100) where job_id=(select id from notification_context where key='expires')),
 (select token from notification_context where key='expires-claim'),'crashed expired lease token is rediscoverable without acquiring another lease');
reset role;
select is((select state from private.notification_jobs where id=(select id from notification_context where key='expires')),
 'leased','uncertain listing is read-only and does not mutate or replace an expired lease');
set local role service_role;
select is((select count(*) from public.notification_claim((select id from notification_context where key='expires'))),0::bigint,
 'expired lease is not reassigned to a second potentially concurrent worker');
reset role;
select is((select state from private.notification_jobs where id=(select id from notification_context where key='expires')),
 'unknown','lease expiry records uncertainty rather than assuming non-send');
select is((select count(*) from private.notification_attempts where job_id=(select id from notification_context where key='expires')),1::bigint,
 'expiry creates no replacement attempt');
set local role service_role;
select is(public.notification_complete((select id from notification_context where key='expires'),
 (select token from notification_context where key='expires-claim'),'provider_accepted','c9000000-0000-4000-8000-000000000006'),
 'provider_accepted','late definitive acceptance reconciles the original expired token');
insert into notification_context(key,id,token) select 'dead-claim',job_id,lease_token
 from public.notification_claim((select id from notification_context where key='dead'));
select is(public.notification_complete((select id from notification_context where key='dead'),
 (select token from notification_context where key='dead-claim'),'dead_endpoint','c9000000-0000-4000-8000-000000000007'),
 'dead_endpoint','definitive endpoint expiry is terminal rather than retryable');
reset role;
select is((select state from private.push_subscriptions where id=(select id from notification_context where key='device1')),
 'dead','dead endpoint is deactivated privately');
select is((select state from private.push_subscriptions where id=(select id from notification_context where key='device2')),
 'active','another device is not deactivated by an unrelated endpoint failure');
select is((select count(*) from private.notification_jobs where device_id=(select id from notification_context where key='device1')
 and state in ('queued','retry_wait')),0::bigint,'terminal device cleanup suppresses other pending attempts on that endpoint');
select set_config('request.jwt.claim.sub','c1000000-0000-4000-8000-000000000001',true);
set local role authenticated;
select lives_ok($$select public.notification_set_preferences(true,false,true,true)$$,'recipient may opt out of only new-message notifications');
reset role;
set local role service_role;
select is((select count(*) from public.notification_claim((select id from notification_context where key='preference-recheck'))),0::bigint,
 'current recipient type preference is rechecked before lease');
reset role;
select is((select state from private.notification_jobs where id=(select id from notification_context where key='preference-recheck')),
 'canceled','suppressed job keeps its non-replayable identity');
set local role authenticated;
select lives_ok($$select public.notification_set_preferences(true,true,true,true)$$,'recipient may enable future messages again');
reset role;
set local role service_role;
select is((select count(*) from public.notification_claim((select id from notification_context where key='preference-recheck'))),0::bigint,
 'preference re-enable does not resurrect an already suppressed notification');
select lives_ok($$select public.notification_revoke_device('c1000000-0000-4000-8000-000000000001',
 (select id from notification_context where key='device2'))$$,'trusted endpoint flow may revoke its bound actor device');
select lives_ok($$select public.notification_revoke_device('c1000000-0000-4000-8000-000000000001',
 (select id from notification_context where key='device2'))$$,'device revoke replay is idempotent');
select is((select count(*) from public.notification_claim((select id from notification_context where key='revoke'))),0::bigint,
 'revoked endpoint never receives a fresh lease');
reset role;
select is((select state from private.push_subscriptions where id=(select id from notification_context where key='device2')),
 'revoked','device revocation is explicit, not hard deletion');
select ok((select revoked_at is not null from private.push_subscriptions where id=(select id from notification_context where key='device2')),
 'revocation preserves its server timestamp');

-- A new physical endpoint is a distinct identity. Replays still dedupe per
-- source/channel/recipient/device and do not grant old accepted jobs a replay.
set local role service_role;
insert into notification_context(key,id) values('device3',public.notification_register_device(
 'c1000000-0000-4000-8000-000000000001','https://push.example.invalid/device-three',repeat('D',87),repeat('A',22),'fictional-consent-v1'));
reset role;
savepoint notification_source_atomic;
insert into public.messages(id,artist_id,author_id,type,body,status,scheduled_at) values
 ('c3000000-0000-4000-8000-000000000007','c2000000-0000-4000-8000-000000000001',
 'c1000000-0000-4000-8000-000000000003','text','함께 롤백','scheduled',now());
set local role service_role;
select ok(public.messaging_dispatch('c3000000-0000-4000-8000-000000000007'),'transactional source fixture dispatches');
reset role;
select is((select count(*) from private.notification_jobs where source_id='c3000000-0000-4000-8000-000000000007'),1::bigint,
 'outbox appears in the same transaction as message publication');
rollback to notification_source_atomic;
select is((select count(*) from public.messages where id='c3000000-0000-4000-8000-000000000007'),0::bigint,'source rollback removes publication');
select is((select count(*) from private.notification_jobs where source_id='c3000000-0000-4000-8000-000000000007'),0::bigint,'source rollback also removes its outbox');

-- Official events schedule their notice relative to the source timestamp;
-- deletion preserves source identity while suppressing unclaimed work.
insert into public.schedules(id,artist_id,type,status,title,starts_at,created_by) values
 ('c5000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000001','event','published','가상 일정',
 now()+interval '12 hours','c1000000-0000-4000-8000-000000000004');
select is((select count(*) from private.notification_jobs where source_id='c5000000-0000-4000-8000-000000000001'),1::bigint,
 'published schedule enqueues only eligible consented subscribers');
select ok((select next_attempt_at between now() and clock_timestamp() from private.notification_jobs
 where source_id='c5000000-0000-4000-8000-000000000001'),'already-due schedule notice uses current server time rather than backdating');
select ok((select route_kind='schedule' and route_id=source_id and schedule_id=source_id from private.notification_jobs
 where source_id='c5000000-0000-4000-8000-000000000001'),'event route carries only its intended internal schedule ID');
select set_config('request.jwt.claim.sub','c1000000-0000-4000-8000-000000000004',true);
set local role authenticated;
select lives_ok($$select public.schedule_delete('c5000000-0000-4000-8000-000000000001')$$,'notification association does not break authorized existing schedule deletion');
reset role;
select is((select state from private.notification_jobs where source_id='c5000000-0000-4000-8000-000000000001'),'canceled',
 'deleted source suppresses its pending event notification');
select is((select schedule_id from private.notification_jobs where source_id='c5000000-0000-4000-8000-000000000001'),null::uuid,
 'nullable live schedule reference is cleared without deleting stable source identity');
set local role service_role;
select is(public.notification_enqueue('schedule','c5000000-0000-4000-8000-000000000001'),0,'deleted event cannot be recreated by stale enqueue request');
reset role;

-- Real billing RPC state transitions, but only fictional verified-result
-- handles. Initial receipt enqueue occurs before pending -> active internally.
insert into public.artists(id,slug,name,grade,status) values
 ('c2000000-0000-4000-8000-000000000002','notification-billing-source','가상 영수증 가수','B','active');
select set_config('request.jwt.claim.sub','c1000000-0000-4000-8000-000000000002',true);
set local role authenticated;
select lives_ok($$select public.notification_set_preferences(true,false,true,false)$$,'billing recipient consents only to owned receipts');
reset role;
set local role service_role;
insert into notification_context(key,id) values('billing-device',public.notification_register_device(
 'c1000000-0000-4000-8000-000000000002','https://push.example.invalid/billing-device',repeat('E',87),repeat('A',22),'fictional-consent-v1'));
insert into notification_context(key,id) values('billing-subscription',public.billing_open_subscription(
 'c1000000-0000-4000-8000-000000000002','c2000000-0000-4000-8000-000000000002','toss'));
insert into notification_context(key,id) values('billing-mandate',public.billing_register_mandate(
 (select id from notification_context where key='billing-subscription'),'test','fictional-notification-merchant',
 'c6000000-0000-4000-8000-000000000001','c6000000-0000-4000-8000-000000000002','fictional-billing-consent'));
insert into notification_context(key,id) values('billing-obligation',public.billing_prepare_obligation(
 (select id from notification_context where key='billing-subscription'),now()-interval '1 day',now()+interval '29 days',
 1000,true,'fictional-price',259200,86400,3));
insert into notification_context(key,id) values('billing-attempt',public.billing_prepare_attempt(
 (select id from notification_context where key='billing-obligation')));
select ok(public.billing_claim_attempt((select id from notification_context where key='billing-attempt'),120) is not null,
 'billing attempt is explicitly claimed before verified-result processing');
reset role;
select is((select count(*) from private.notification_jobs where user_id='c1000000-0000-4000-8000-000000000002'),0::bigint,
 'pending attempt or mandate never masquerades as a verified payment receipt');
set local role service_role;
insert into notification_context(key,id) values('charge',public.billing_finalize_charge(
 (select id from notification_context where key='billing-attempt'),'fictional-notification-charge',1000,'KRW',now(),
 'c6000000-0000-4000-8000-000000000003'));
select is(public.billing_finalize_charge((select id from notification_context where key='billing-attempt'),
 'fictional-notification-charge',1000,'KRW',now(),'c6000000-0000-4000-8000-000000000004'),
 (select id from notification_context where key='charge'),'verified charge replay returns same financial identity');
reset role;
select is((select count(*) from private.notification_jobs where source_id=(select id from notification_context where key='charge')),1::bigint,
 'initial pending-to-active charge produces one transactional owned receipt, not zero or duplicate');
select ok((select source_kind='payment' and payment_event_id=source_id and user_id='c1000000-0000-4000-8000-000000000002'
 and route_kind='billing' and route_id=(select id from notification_context where key='billing-subscription')
 from private.notification_jobs where source_id=(select id from notification_context where key='charge')),
 'billing identity and destination derive from the verified event owner');
select is((select count(*) from private.notification_jobs where source_id=(select id from notification_context where key='charge')
 and user_id='c1000000-0000-4000-8000-000000000001'),0::bigint,'another consented fan cannot receive someone else financial receipt');
select set_config('request.jwt.claim.sub','c1000000-0000-4000-8000-000000000002',true);
set local role authenticated;
select lives_ok($$select public.cancel_subscription((select id from notification_context where key='billing-subscription'))$$,
 'subscriber may cancel renewal independently of already recognized billing history');
reset role;
set local role service_role;
insert into notification_context(key,id) values('refund',public.billing_record_refund(
 (select id from notification_context where key='charge'),'fictional-notification-refund',500,'KRW',now(),
 'c6000000-0000-4000-8000-000000000005'));
select is(public.billing_record_refund((select id from notification_context where key='charge'),
 'fictional-notification-refund',500,'KRW',now(),'c6000000-0000-4000-8000-000000000006'),
 (select id from notification_context where key='refund'),'refund replay remains one verified financial action');
reset role;
select is((select count(*) from private.notification_jobs where source_id=(select id from notification_context where key='refund')),1::bigint,
 'verified refund remains eligible for its owner after subscription cancellation');
select is((select count(*) from private.notification_jobs where source_kind='payment'
 and user_id='c1000000-0000-4000-8000-000000000002'),2::bigint,'charge and refund have separate stable source identities');
insert into notification_context(key,id) select 'refund-job',id from private.notification_jobs where source_id=(select id from notification_context where key='refund');
set local role service_role;
select is((select count(*) from public.notification_claim((select id from notification_context where key='refund-job'))),1::bigint,
 'billing claim checks verified ownership rather than requiring ongoing paid-message entitlement');
reset role;

-- Postponing a schedule after a proven non-send must respect both the retry
-- delay and the revised event notice time, without resetting attempt history.
insert into public.schedules(id,artist_id,type,status,title,starts_at,created_by) values
 ('c5000000-0000-4000-8000-000000000002','c2000000-0000-4000-8000-000000000001','event','published','가상 연기 일정',
 now()+interval '12 hours','c1000000-0000-4000-8000-000000000004');
insert into notification_context(key,id) select 'postpone-job',id from private.notification_jobs
 where source_id='c5000000-0000-4000-8000-000000000002';
set local role service_role;
insert into notification_context(key,id,token) select 'postpone-claim',job_id,lease_token
 from public.notification_claim((select id from notification_context where key='postpone-job'));
select is(public.notification_complete((select id from notification_context where key='postpone-job'),
 (select token from notification_context where key='postpone-claim'),'not_sent','c9000000-0000-4000-8000-000000000008'),
 'retry_wait','definitive non-send creates the original schedule retry delay');
reset role;
select set_config('request.jwt.claim.sub','c1000000-0000-4000-8000-000000000004',true);
set local role authenticated;
select is(public.schedule_update('c5000000-0000-4000-8000-000000000002','event','가상 연기 일정',
 now()+interval '3 days',p_status=>'published'),'c5000000-0000-4000-8000-000000000002'::uuid,
 'authorized event postponement preserves source identity');
reset role;
select is((select next_attempt_at from private.notification_jobs where id=(select id from notification_context where key='postpone-job')),
 now()+interval '2 days','postponed event moves retry to the new source notice boundary');
select is((select attempt_count from private.notification_jobs where id=(select id from notification_context where key='postpone-job')),1,
 'postponement never resets the consumed retry budget');
select is((select state from private.notification_jobs where id=(select id from notification_context where key='postpone-job')),
 'retry_wait','postponement does not relabel known non-send as a fresh queue entry');
set local role service_role;
select is((select count(*) from public.notification_claim((select id from notification_context where key='postpone-job'))),0::bigint,
 'worker cannot send a postponed retry before the new notice time');
reset role;
set local role authenticated;
select is(public.schedule_update('c5000000-0000-4000-8000-000000000002','event','가상 앞당김 일정',
 now()+interval '12 hours',p_status=>'published'),'c5000000-0000-4000-8000-000000000002'::uuid,
 'event can move earlier without granting a retry-delay bypass');
reset role;
select ok((select j.next_attempt_at >= a.finished_at+make_interval(secs=>j.retry_seconds)
 and j.next_attempt_at <= clock_timestamp()+make_interval(secs=>j.retry_seconds)
 from private.notification_jobs j join private.notification_attempts a on a.job_id=j.id and a.ordinal=j.attempt_count
 where j.id=(select id from notification_context where key='postpone-job')),
 'earlier edit retains the true non-send backoff instead of an obsolete postponed event delay');
select is((select count(*) from private.notification_attempts where job_id=(select id from notification_context where key='postpone-job')),1::bigint,
 'source edits do not manufacture provider attempts');

-- A source can also move while a worker already holds the lease. The later
-- known non-send backoff must not outrun the current event time at re-claim.
insert into public.schedules(id,artist_id,type,status,title,starts_at,created_by) values
 ('c5000000-0000-4000-8000-000000000003','c2000000-0000-4000-8000-000000000001','event','published','가상 진행 중 연기',
 now()+interval '12 hours','c1000000-0000-4000-8000-000000000004');
insert into notification_context(key,id) select 'leased-postpone-job',id from private.notification_jobs
 where source_id='c5000000-0000-4000-8000-000000000003';
set local role service_role;
insert into notification_context(key,id,token) select 'leased-postpone-claim',job_id,lease_token
 from public.notification_claim((select id from notification_context where key='leased-postpone-job'));
reset role;
set local role authenticated;
select is(public.schedule_update('c5000000-0000-4000-8000-000000000003','event','가상 진행 중 연기',
 now()+interval '4 days',p_status=>'published'),'c5000000-0000-4000-8000-000000000003'::uuid,
 'source can be postponed while the original provider attempt is leased');
reset role;
set local role service_role;
select is(public.notification_complete((select id from notification_context where key='leased-postpone-job'),
 (select token from notification_context where key='leased-postpone-claim'),'not_sent','c9000000-0000-4000-8000-000000000009'),
 'retry_wait','proven non-send of the old lease remains retryable, not an assumed acceptance');
reset role;
update private.notification_jobs set next_attempt_at=clock_timestamp()-interval '1 second'
 where id=(select id from notification_context where key='leased-postpone-job');
set local role service_role;
select is((select count(*) from public.notification_claim((select id from notification_context where key='leased-postpone-job'))),0::bigint,
 'current event notice boundary blocks an old due backoff after in-flight postponement');
reset role;
select is((select next_attempt_at from private.notification_jobs where id=(select id from notification_context where key='leased-postpone-job')),
 now()+interval '3 days','claim repairs stale backoff to the current locked source notice time');
select is((select attempt_count from private.notification_jobs where id=(select id from notification_context where key='leased-postpone-job')),1,
 'postponement recheck consumes no second lease or retry ordinal');

-- Equal-expiry uncertainty remains fully discoverable with a stable UUID
-- tie-breaker; paging only reads handles and never authorizes another send.
insert into public.messages(id,artist_id,author_id,type,body,status,scheduled_at,sent_at)
select ('c3000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 'c2000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000003','text','가상 복구 페이지',
 'sent',now(),now() from generate_series(8,9) n;
insert into notification_context(key,id) select 'cursor-job-'||right(source_id::text,1),id from private.notification_jobs
 where source_id in ('c3000000-0000-4000-8000-000000000008','c3000000-0000-4000-8000-000000000009');
set local role service_role;
insert into notification_context(key,id,token) select 'cursor-claim-8',job_id,lease_token
 from public.notification_claim((select id from notification_context where key='cursor-job-8'));
insert into notification_context(key,id,token) select 'cursor-claim-9',job_id,lease_token
 from public.notification_claim((select id from notification_context where key='cursor-job-9'));
select is(public.notification_complete((select id from notification_context where key='cursor-job-8'),
 (select token from notification_context where key='cursor-claim-8'),'unknown',null),'unknown','first uncertain source retains its original token');
select is(public.notification_complete((select id from notification_context where key='cursor-job-9'),
 (select token from notification_context where key='cursor-claim-9'),'unknown',null),'unknown','second uncertain source retains its original token');
reset role;
update private.notification_jobs set lease_expires_at=now()-interval '1 second'
 where source_id in ('c3000000-0000-4000-8000-000000000008','c3000000-0000-4000-8000-000000000009');
set local role service_role;
select is((select count(*) from public.notification_list_uncertain(100)),2::bigint,'both unresolved jobs are discoverable without endpoint disclosure');
insert into notification_context(key,id,token,stamp) select 'cursor-first',job_id,lease_token,lease_expires_at
 from public.notification_list_uncertain(1);
select is((select count(*) from public.notification_list_uncertain(1,(select stamp from notification_context where key='cursor-first'),
 (select id from notification_context where key='cursor-first'))),1::bigint,'same-expiry second job remains available on the next keyset page');
select isnt((select job_id from public.notification_list_uncertain(1,(select stamp from notification_context where key='cursor-first'),
 (select id from notification_context where key='cursor-first'))),(select id from notification_context where key='cursor-first'),
 'keyset page never repeats its cursor job');
reset role;
select is((select count(*) from private.notification_attempts where job_id in (select id from notification_context where key in ('cursor-job-8','cursor-job-9'))),2::bigint,
 'uncertain pagination does not create or replace attempts');

select * from finish();
rollback;
