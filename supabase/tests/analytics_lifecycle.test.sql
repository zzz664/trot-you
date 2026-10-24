begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

-- Fictional DB-only observations/evidence. No external analytics or provider call.
create temporary table analytics_context(key text primary key,id uuid,data jsonb,stamp timestamptz);
grant all on analytics_context to authenticated,service_role;
insert into auth.users(id,email,raw_user_meta_data)
select ('e1000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 'analytics-lifecycle-'||n||'@example.invalid','{}'::jsonb from generate_series(1,4) n;
update public.profiles set role='admin' where id='e1000000-0000-4000-8000-000000000003';
update public.profiles set role='artist' where id='e1000000-0000-4000-8000-000000000004';
-- Fictional approved/public policy bodies exist only in this rolled-back test.
insert into private.onboarding_documents(version,kind,title,body,approved_at,published_at) values
 ('e9000000-0000-4000-8000-000000000001','analytics','Fictional CI analytics policy','Fictional test fixture only; not legal policy.',now(),now());
insert into private.analytics_policy(consent_version,enabled,retention_days)
 values('e9000000-0000-4000-8000-000000000001',true,30);
set local role authenticated;
select set_config('request.jwt.claim.sub','e1000000-0000-4000-8000-000000000001',true);
select is((select granted from public.analytics_get_consent()),false,'new fan is not implicitly opted in');
select lives_ok($$select public.analytics_set_consent(true,'e9000000-0000-4000-8000-000000000001')$$,
 'fan may explicitly consent before onboarding completes');
select is((select granted from public.analytics_get_consent()),true,'approved own opt-in is reflected by safe consent DTO');
select throws_ok($$select public.analytics_record_client(gen_random_uuid(),'voice_input_used',null,'reply')$$,
 '42501','ANALYTICS_ACTOR_FORBIDDEN','consent alone does not bypass incomplete onboarding');
reset role;
update public.profiles set call_name='가상 분석 사용자',onboarding_completed_at=clock_timestamp()
 where id in ('e1000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000002');
set local role service_role;
insert into analytics_context(key,id) values('signup',public.analytics_record_server(
 'e1000000-0000-4000-8000-000000000001','e8000000-0000-4000-8000-000000000001','signup_complete'));
select is(public.analytics_record_server('e1000000-0000-4000-8000-000000000001',
 'e8000000-0000-4000-8000-000000000001','signup_complete'),(select id from analytics_context where key='signup'),
 'same signup request key replays one row');
select throws_ok($$select public.analytics_record_server('e1000000-0000-4000-8000-000000000001',
 gen_random_uuid(),'signup_complete')$$,'23514','ANALYTICS_EVENT_CONFLICT',
 'signup semantic identity rejects a conflicting new retry key');
insert into analytics_context(key,id) values('font',public.analytics_record_server(
 'e1000000-0000-4000-8000-000000000001','e8000000-0000-4000-8000-000000000002','font_size_selected',null,'large'));
select throws_ok($$select public.analytics_record_server('e1000000-0000-4000-8000-000000000001',
 gen_random_uuid(),'font_size_selected',null,'normal')$$,'42501','ANALYTICS_SOURCE_FORBIDDEN',
 'font event must match current typed profile setting');
reset role;
select ok((select occurred_at=(select onboarding_completed_at from public.profiles where id=user_id)
 from private.analytics_events where id=(select id from analytics_context where key='signup')),'signup uses server onboarding timestamp');
select ok((select bool_and(recorded_at>=occurred_at and isfinite(occurred_at) and isfinite(recorded_at))
 from private.analytics_events),'recording time is finite and never before occurrence');
insert into public.artists(id,slug,name,grade,status) values
 ('e2000000-0000-4000-8000-000000000001','analytics-main','가상 분석 가수','B','active'),
 ('e2000000-0000-4000-8000-000000000002','analytics-failure','가상 분석 실패 가수','B','active');
insert into public.artist_members(artist_id,user_id) values
 ('e2000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000004');
insert into private.message_policy values(true,'fictional-analytics-message',604800,300,1000,100,10,180,60,5,10485760,20971520,104857600);

-- Real billing primitives produce the only accepted charge source. Financial
-- evidence is synthetic, but the ledger/attempt transitions are the actual RPCs.
set local role service_role;
insert into analytics_context(key,id) values('subscription',public.billing_open_subscription(
 'e1000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000001','toss'));
insert into analytics_context(key,id) values('start',public.analytics_record_server(
 'e1000000-0000-4000-8000-000000000001','e8000000-0000-4000-8000-000000000003','subscribe_start',
 (select id from analytics_context where key='subscription')));
select is(public.analytics_record_server('e1000000-0000-4000-8000-000000000001',
 'e8000000-0000-4000-8000-000000000003','subscribe_start',(select id from analytics_context where key='subscription')),
 (select id from analytics_context where key='start'),'subscription start uses stable request idempotency');
select throws_ok($$select public.analytics_record_server('e1000000-0000-4000-8000-000000000002',gen_random_uuid(),
 'subscribe_start',(select id from analytics_context where key='subscription'))$$,'42501','ANALYTICS_SOURCE_FORBIDDEN','subscribe_start cannot claim another fan actual persisted source');
select public.billing_register_mandate((select id from analytics_context where key='subscription'),
 'test','fictional-analytics-merchant',gen_random_uuid(),gen_random_uuid(),'fictional-billing-consent');
insert into analytics_context(key,id) values('initial-obligation',public.billing_prepare_obligation(
 (select id from analytics_context where key='subscription'),now()-interval '1 day',now()+interval '29 days',
 1000,true,'fictional-price',259200,1,3));
insert into analytics_context(key,id) values('initial-attempt',public.billing_prepare_attempt(
 (select id from analytics_context where key='initial-obligation')));
select throws_ok($$select public.analytics_record_charge((select id from analytics_context where key='initial-attempt'))$$,
 '42501','ANALYTICS_VERIFIED_CHARGE_REQUIRED','an unclaimed attempt cannot count as purchase');
insert into analytics_context(key,data) values('initial-claim',public.billing_claim_attempt(
 (select id from analytics_context where key='initial-attempt'),120));
select public.billing_record_attempt_outcome((select id from analytics_context where key='initial-attempt'),
 (select (data->>'lease_token')::uuid from analytics_context where key='initial-claim'),'unknown',null);
select throws_ok($$select public.analytics_record_charge((select id from analytics_context where key='initial-attempt'))$$,
 '42501','ANALYTICS_VERIFIED_CHARGE_REQUIRED','unknown provider outcome remains absent from purchase counts');
select throws_ok($$select public.analytics_record_server('e1000000-0000-4000-8000-000000000001',gen_random_uuid(),
 'subscribe_fail',(select id from analytics_context where key='initial-attempt'))$$,
 '42501','ANALYTICS_SOURCE_FORBIDDEN','unknown outcome is not misreported as a verified failure');
insert into analytics_context(key,id) values('initial-charge',public.billing_finalize_charge(
 (select id from analytics_context where key='initial-attempt'),'fictional-analytics-initial',1000,'KRW',statement_timestamp(),gen_random_uuid()));
reset role;
set local role authenticated;
select lives_ok($$select public.analytics_record_client((select id from analytics_context where key='initial-charge'),
 'voice_input_used',null,'reply')$$,'client may reuse a known ledger UUID only within its isolated authority namespace');
reset role;
set local role service_role;
insert into analytics_context(key,id) values('initial-event',public.analytics_record_charge(
 (select id from analytics_context where key='initial-charge')));
select is(public.analytics_record_charge((select id from analytics_context where key='initial-charge')),
 (select id from analytics_context where key='initial-event'),'verified charge replay does not duplicate purchase metrics');
reset role;
select is((select name::text from private.analytics_events where id=(select id from analytics_context where key='initial-event')),
 'subscribe_complete','first charge is classified from obligation is_initial, not caller input');
select ok((select a.user_id=s.user_id and a.source_id=e.id and a.event_key=e.id and a.occurred_at=e.occurred_at
 from private.analytics_events a join public.payment_events e on e.id=a.source_id
 join public.subscriptions s on s.id=e.subscription_id where a.id=(select id from analytics_context where key='initial-event')),
 'charge actor, canonical dedupe identity and occurrence time come from verified source');
select is((select count(*) from public.payment_events),1::bigint,'analytics recording never creates a second financial event');

insert into public.messages(id,artist_id,author_id,type,body,status,scheduled_at,sent_at,is_preview,preview_order)
 values('e3000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000001',
 'e1000000-0000-4000-8000-000000000004','text','가상 메시지 원문은 분석에 복제되지 않는다','sent',now(),now(),true,1);
set local role service_role;
insert into analytics_context(key,id) values('preview',public.analytics_record_server(
 'e1000000-0000-4000-8000-000000000001',gen_random_uuid(),'preview_view','e3000000-0000-4000-8000-000000000001'));
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','e1000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claim.sub','e1000000-0000-4000-8000-000000000002',true);
select throws_ok($$select public.analytics_record_client(gen_random_uuid(),'message_open','e3000000-0000-4000-8000-000000000001')$$,
 '42501','ANALYTICS_SOURCE_FORBIDDEN','fan without paid access cannot report an actual private message open');
select set_config('request.jwt.claim.sub','e1000000-0000-4000-8000-000000000001',true);
insert into analytics_context(key,id) values('message',public.analytics_record_client(
 'e8000000-0000-4000-8000-000000000004','message_open','e3000000-0000-4000-8000-000000000001'));
select is(public.analytics_record_client('e8000000-0000-4000-8000-000000000004','message_open',
 'e3000000-0000-4000-8000-000000000001'),(select id from analytics_context where key='message'),'client retry counts one observation');
insert into analytics_context(key,id) values('voice',public.analytics_record_client(
 'e8000000-0000-4000-8000-000000000005','voice_input_used',null,'reply'));
select is(public.analytics_record_client('e8000000-0000-4000-8000-000000000005','voice_input_used',null,'reply'),
 (select id from analytics_context where key='voice'),'same voice observation is idempotent');
select throws_ok($$select public.analytics_record_client('e8000000-0000-4000-8000-000000000005','voice_input_used',null,'post')$$,
 '23514','ANALYTICS_EVENT_CONFLICT','a retry key cannot change typed voice context');
select throws_ok($$select public.analytics_record_client('e8000000-0000-4000-8000-000000000004','voice_input_used',null,'reply')$$,
 '23514','ANALYTICS_EVENT_CONFLICT','a retry key cannot change event kind');
select lives_ok($$select public.analytics_record_client(gen_random_uuid(),'voice_input_used',null,'post')$$,'post voice context is accepted');
select lives_ok($$select public.analytics_record_client(gen_random_uuid(),'voice_input_used',null,'comment')$$,'comment voice context is accepted');
reset role;
select is((select count(*) from private.analytics_events where name='voice_input_used'),4::bigint,
 'four unique voice observations are counted, not duplicate requests');
insert into public.replies(id,user_id,artist_id,subscription_id,body,created_at)
 values('e4000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000001',
 'e2000000-0000-4000-8000-000000000001',(select id from analytics_context where key='subscription'),'가상 답장',clock_timestamp());
insert into public.posts(id,artist_id,user_id,request_id,title,body,created_at)
 values('e5000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000001',
 'e1000000-0000-4000-8000-000000000001',gen_random_uuid(),'가상 게시물','분석 원문 복제 금지',clock_timestamp());
set local role service_role;
insert into analytics_context(key,id) values('reply',public.analytics_record_server(
 'e1000000-0000-4000-8000-000000000001','e8000000-0000-4000-8000-000000000007','reply_sent','e4000000-0000-4000-8000-000000000001'));
select throws_ok($$select public.analytics_record_server('e1000000-0000-4000-8000-000000000001',gen_random_uuid(),
 'reply_sent','e4000000-0000-4000-8000-000000000001')$$,'23514','ANALYTICS_EVENT_CONFLICT','reply source cannot silently adopt another retry key');
select throws_ok($$select public.analytics_record_server('e1000000-0000-4000-8000-000000000002',gen_random_uuid(),
 'reply_sent','e4000000-0000-4000-8000-000000000001')$$,'42501','ANALYTICS_SOURCE_FORBIDDEN','reply_sent cannot claim another fan actual persisted source');
insert into analytics_context(key,id) values('post',public.analytics_record_server(
 'e1000000-0000-4000-8000-000000000001','e8000000-0000-4000-8000-000000000008','post_create','e5000000-0000-4000-8000-000000000001'));
select throws_ok($$select public.analytics_record_server('e1000000-0000-4000-8000-000000000001','e8000000-0000-4000-8000-000000000099',
 'post_create','e5000000-0000-4000-8000-000000000001')$$,'23514','ANALYTICS_EVENT_CONFLICT','post source cannot silently adopt another retry key');
select throws_ok($$select public.analytics_record_server('e1000000-0000-4000-8000-000000000002',gen_random_uuid(),
 'post_create','e5000000-0000-4000-8000-000000000001')$$,'42501','ANALYTICS_SOURCE_FORBIDDEN','post_create cannot claim another fan actual persisted source');
reset role;
insert into public.posts(id,artist_id,user_id,request_id,title,body,created_at)
 values('e5000000-0000-4000-8000-000000000002','e2000000-0000-4000-8000-000000000001',
 'e1000000-0000-4000-8000-000000000001',gen_random_uuid(),'가상 두 번째 게시물','분석 원문 복제 금지',clock_timestamp());
set local role service_role;
select lives_ok($$select public.analytics_record_server('e1000000-0000-4000-8000-000000000001',
 'e8000000-0000-4000-8000-000000000099','post_create','e5000000-0000-4000-8000-000000000002')$$,
 'rejected alternate key remains free for a distinct legitimate source, never a successful hidden alias');
select is(public.analytics_record_server('e1000000-0000-4000-8000-000000000001',
 'e8000000-0000-4000-8000-000000000008','post_create','e5000000-0000-4000-8000-000000000001'),
 (select id from analytics_context where key='post'),'original source keeps its canonical key after rejected alias and new source');
reset role;
insert into private.point_policy(version,attendance_amount,post_amount,comment_amount,deleted_content_treatment)
 values('fictional-analytics-points',10,0,0,'retain');
set local role authenticated;
insert into analytics_context(key,id) values('point',public.point_check_attendance());
reset role;
set local role service_role;
insert into analytics_context(key,id) values('attendance',public.analytics_record_server(
 'e1000000-0000-4000-8000-000000000001','e8000000-0000-4000-8000-000000000009','attendance',(select id from analytics_context where key='point')));
select throws_ok($$select public.analytics_record_server('e1000000-0000-4000-8000-000000000001',gen_random_uuid(),
 'attendance',(select id from analytics_context where key='point'))$$,'23514','ANALYTICS_EVENT_CONFLICT','attendance source cannot silently adopt another retry key');

select throws_ok($$select public.analytics_record_server('e1000000-0000-4000-8000-000000000002',gen_random_uuid(),
 'attendance',(select id from analytics_context where key='point'))$$,'42501','ANALYTICS_SOURCE_FORBIDDEN','attendance cannot claim another fan actual persisted source');
-- A second subscription provides a definitive failed attempt, not a money row.
insert into analytics_context(key,id) values('failure-subscription',public.billing_open_subscription(
 'e1000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000002','toss'));
select public.billing_register_mandate((select id from analytics_context where key='failure-subscription'),
 'test','fictional-analytics-merchant',gen_random_uuid(),gen_random_uuid(),'fictional-billing-consent');
insert into analytics_context(key,id) values('failure-obligation',public.billing_prepare_obligation(
 (select id from analytics_context where key='failure-subscription'),now()-interval '1 day',now()+interval '29 days',
 1000,true,'fictional-price',259200,1,3));
insert into analytics_context(key,id) values('failure-attempt',public.billing_prepare_attempt(
 (select id from analytics_context where key='failure-obligation')));
insert into analytics_context(key,data) values('failure-claim',public.billing_claim_attempt(
 (select id from analytics_context where key='failure-attempt'),120));
select public.billing_record_attempt_outcome((select id from analytics_context where key='failure-attempt'),
 (select (data->>'lease_token')::uuid from analytics_context where key='failure-claim'),'failed',gen_random_uuid());
insert into analytics_context(key,id) values('failure',public.analytics_record_server(
 'e1000000-0000-4000-8000-000000000001','e8000000-0000-4000-8000-000000000010','subscribe_fail',(select id from analytics_context where key='failure-attempt')));
select throws_ok($$select public.analytics_record_server('e1000000-0000-4000-8000-000000000001',gen_random_uuid(),
 'subscribe_fail',(select id from analytics_context where key='failure-attempt'))$$,'23514','ANALYTICS_EVENT_CONFLICT','failed-attempt source cannot silently adopt another retry key');
select throws_ok($$select public.analytics_record_server('e1000000-0000-4000-8000-000000000002',gen_random_uuid(),
 'subscribe_fail',(select id from analytics_context where key='failure-attempt'))$$,'42501','ANALYTICS_SOURCE_FORBIDDEN','subscribe_fail cannot claim another fan actual persisted source');
select throws_ok($$select public.analytics_record_charge((select id from analytics_context where key='failure-attempt'))$$,
 '42501','ANALYTICS_VERIFIED_CHARGE_REQUIRED','definitive failure cannot count as paid renewal or purchase');
reset role;
-- Owner-only clock fixture moves a due boundary without external waiting.
update public.subscriptions set current_period_start=now()-interval '31 days',current_period_end=now()-interval '1 second'
 where id=(select id from analytics_context where key='subscription');
set local role service_role;
insert into analytics_context(key,id) values('renewal-obligation',public.billing_prepare_obligation(
 (select id from analytics_context where key='subscription'),now()-interval '1 second',now()+interval '30 days',
 6500,false,'fictional-price',259200,1,3));
insert into analytics_context(key,id) values('renewal-attempt',public.billing_prepare_attempt(
 (select id from analytics_context where key='renewal-obligation')));
select public.billing_claim_attempt((select id from analytics_context where key='renewal-attempt'),120);
insert into analytics_context(key,id) values('renewal-charge',public.billing_finalize_charge(
 (select id from analytics_context where key='renewal-attempt'),'fictional-analytics-renewal',6500,'KRW',statement_timestamp(),gen_random_uuid()));
insert into analytics_context(key,id) values('renewal-event',public.analytics_record_charge(
 (select id from analytics_context where key='renewal-charge')));
select is(public.analytics_record_charge((select id from analytics_context where key='renewal-charge')),
 (select id from analytics_context where key='renewal-event'),'renewal replay preserves one event identity');
insert into analytics_context(key,id) values('refund',public.billing_record_refund(
 (select id from analytics_context where key='initial-charge'),'fictional-analytics-refund',100,'KRW',statement_timestamp(),gen_random_uuid()));
select throws_ok($$select public.analytics_record_charge((select id from analytics_context where key='refund'))$$,
 '42501','ANALYTICS_VERIFIED_CHARGE_REQUIRED','verified refund is not misclassified as another charge');
reset role;
select is((select name::text from private.analytics_events where id=(select id from analytics_context where key='renewal-event')),
 'renew','renewal type is derived from actual settled obligation');
set local role authenticated;
select public.cancel_subscription((select id from analytics_context where key='subscription'));
reset role;
set local role service_role;
insert into analytics_context(key,id) values('cancel',public.analytics_record_server(
 'e1000000-0000-4000-8000-000000000001','e8000000-0000-4000-8000-000000000006','cancel',
 (select id from analytics_context where key='subscription')));
select is(public.analytics_record_server('e1000000-0000-4000-8000-000000000001',
 'e8000000-0000-4000-8000-000000000006','cancel',(select id from analytics_context where key='subscription')),
 (select id from analytics_context where key='cancel'),'cancel retry key is stable without creating a charge/refund');
select throws_ok($$select public.analytics_record_server('e1000000-0000-4000-8000-000000000002',gen_random_uuid(),
 'cancel',(select id from analytics_context where key='subscription'))$$,'42501','ANALYTICS_SOURCE_FORBIDDEN','cancel cannot claim another fan actual persisted source');
select throws_ok($$select public.analytics_record_server('e1000000-0000-4000-8000-000000000001',
 gen_random_uuid(),'cancel',(select id from analytics_context where key='subscription'))$$,
 '23514','ANALYTICS_EVENT_CONFLICT','same cancellation timestamp cannot be counted with another key');
reset role;
-- Owner-only episode timestamp fixture; a real later episode may cancel again.
update public.subscriptions set canceled_at=clock_timestamp() where id=(select id from analytics_context where key='subscription');
set local role service_role;
select throws_ok($$select public.analytics_record_server('e1000000-0000-4000-8000-000000000001',
 'e8000000-0000-4000-8000-000000000006','cancel',(select id from analytics_context where key='subscription'))$$,
 '23514','ANALYTICS_EVENT_CONFLICT','retry key cannot be reused across distinct cancellation occurrence times');
select lives_ok($$select public.analytics_record_server('e1000000-0000-4000-8000-000000000001',
 gen_random_uuid(),'cancel',(select id from analytics_context where key='subscription'))$$,
 'new key can record genuinely later cancellation timestamp for reused subscription row');
reset role;
insert into analytics_context(key,stamp) select 'post-original-time',created_at from public.posts where id='e5000000-0000-4000-8000-000000000001';
-- Synthetic owner mutation only; live source creation timestamps are immutable.
update public.posts set created_at=clock_timestamp() where id='e5000000-0000-4000-8000-000000000001';
-- The existing source trigger preserves created_at. Assert its original time.
select is((select created_at from public.posts where id='e5000000-0000-4000-8000-000000000001'),
 (select stamp from analytics_context where key='post-original-time'),'source layer itself preserves post creation time against edits');
select is((select count(distinct name) from private.analytics_events),13::bigint,'all thirteen specified event names are covered through authorized intake');
select is((select count(*) from private.analytics_events where origin='verified_charge'),2::bigint,'only two verified positive charges contributed charge observations');
select is((select count(*) from public.payment_events),3::bigint,'analytics did not alter two charge plus one refund ledger rows');
select ok(not exists(select 1 from private.analytics_events where user_id<>'e1000000-0000-4000-8000-000000000001'),
 'all event actors are derived or bound to the one consenting fan');

-- Controlled owner-only timestamp fixtures cover KST boundary arithmetic without
-- fabricating client-controlled occurrence times or operating a real database.
insert into private.analytics_events(user_id,event_key,name,origin,voice_context,consent_version,occurred_at,recorded_at)
select 'e1000000-0000-4000-8000-000000000001',gen_random_uuid(),'voice_input_used','client','reply',
 'e9000000-0000-4000-8000-000000000001',stamp,stamp from (values
 ('2020-01-01 14:59:59.999999+00'::timestamptz),('2020-01-01 15:00:00+00'::timestamptz),
 ('2020-01-02 14:59:59.999999+00'::timestamptz),('2020-01-02 15:00:00+00'::timestamptz)) t(stamp);
set local role authenticated;
select set_config('request.jwt.claim.sub','e1000000-0000-4000-8000-000000000003',true);
select results_eq($$select day_kst,name::text,event_count from public.analytics_daily_counts('2020-01-02','2020-01-03')$$,
 $$values ('2020-01-02'::date,'voice_input_used'::text,2::bigint)$$,'KST [from,until) includes exact start and excludes exact next midnight');
set local timezone='America/Los_Angeles';
select results_eq($$select day_kst,name::text,event_count from public.analytics_daily_counts('2020-01-02','2020-01-03')$$,
 $$values ('2020-01-02'::date,'voice_input_used'::text,2::bigint)$$,'session timezone cannot shift KST analytics buckets');
select is((select count(*) from public.analytics_daily_counts('2020-01-10','2020-01-11')),0::bigint,
 'empty date range returns no fabricated zero-to-conversion metrics');
reset role;
set local timezone='UTC';
set local role service_role;
select is(public.analytics_purge_expired(2),2,'retention deletes at most requested batch of expired raw rows');
select is(public.analytics_purge_expired(2),2,'retention resumes through next bounded batch');
select is(public.analytics_purge_expired(2),0,'retention leaves current observations untouched');
reset role;
select is((select count(*) from public.payment_events),3::bigint,'analytics retention never deletes financial source ledger');
select is((select count(*) from private.analytics_events where name in ('subscribe_complete','renew')),2::bigint,
 'current verified-charge dedupe records survive expired unrelated observation purge');

-- Consent withdrawal blocks future collection, does not misrepresent historical
-- receipt or silently claim privacy erasure. Reconsent starts a fresh time floor.
set local role authenticated;
select set_config('request.jwt.claim.sub','e1000000-0000-4000-8000-000000000001',true);
select public.analytics_set_consent(false,null);
select is((select granted from public.analytics_get_consent()),false,'withdrawal is immediately reflected in own status');
select throws_ok($$select public.analytics_record_client(gen_random_uuid(),'voice_input_used',null,'reply')$$,
 '55000','ANALYTICS_CONSENT_REQUIRED','withdrawn consent prevents new collection');
reset role;
select is((select count(*) from private.analytics_events where name='voice_input_used'),4::bigint,'withdrawal does not erase previously accepted observations');
set local role authenticated;
select public.analytics_set_consent(true,'e9000000-0000-4000-8000-000000000001');
select lives_ok($$select public.analytics_record_client(gen_random_uuid(),'voice_input_used',null,'reply')$$,
 'newly consented current observation may be recorded');
reset role;
set local role service_role;
select throws_ok($$select public.analytics_record_charge((select id from analytics_context where key='initial-charge'))$$,
 '22023','ANALYTICS_EVENT_TIME_INVALID','new consent is not retroactive permission to replay an old source');
reset role;
select * from finish();
rollback;
