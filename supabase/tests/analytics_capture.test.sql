begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
create function pg_temp.id(n integer) returns uuid language sql immutable as $$select ('d3910000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
create temporary table capture_context(key text primary key,id uuid,data jsonb);
grant all on capture_context to authenticated,service_role;
select ok((select bool_and(prosecdef and 'search_path=""'=any(proconfig)) from pg_proc where oid in(
 'public.analytics_capture_server(uuid,uuid,public.analytics_event_name,uuid,public.font_scale)'::regprocedure,
 'public.analytics_capture_charge(uuid)'::regprocedure,'public.analytics_record_cancellation(uuid,uuid)'::regprocedure)),'all prospective capture wrappers pin privileged search path');
select ok((select bool_and(has_function_privilege('service_role',oid,'EXECUTE') and not has_function_privilege('authenticated',oid,'EXECUTE') and not has_function_privilege('anon',oid,'EXECUTE')) from pg_proc where oid in(
 'public.analytics_capture_server(uuid,uuid,public.analytics_event_name,uuid,public.font_scale)'::regprocedure,
 'public.analytics_capture_charge(uuid)'::regprocedure,'public.analytics_record_cancellation(uuid,uuid)'::regprocedure)),'only actual service role may call capture wrappers');
select ok((select bool_and(not has_function_privilege(r,oid,'EXECUTE')) from pg_proc cross join unnest(array['anon','authenticated','service_role'])r where pronamespace='private'::regnamespace and proname like 'analytics_capture_%'),'capture private helpers have no application execute grants');
insert into auth.users(id,email,raw_user_meta_data) select pg_temp.id(n),'capture-'||n||'@example.invalid','{}' from generate_series(1,3)n;
-- profiles_updated_at deliberately preserves OLD.created_at. Construct the
-- historical rollback-only profile by INSERT before dependent fixture rows;
-- never disable the real immutable timestamp trigger or weaken its constraint.
delete from public.profiles where id=pg_temp.id(2);
insert into public.profiles(id,call_name,created_at,onboarding_completed_at)
 values(pg_temp.id(2),'허구수집팬',clock_timestamp()-interval '2 days',clock_timestamp()-interval '1 day');
update public.profiles set call_name='허구수집팬',onboarding_completed_at=clock_timestamp() where id=pg_temp.id(1);
select ok((select created_at<=onboarding_completed_at and onboarding_completed_at<(select instrumentation_from from private.analytics_dashboard_coverage where singleton) from public.profiles where id=pg_temp.id(2)),'historical signup fixture satisfies real immutable profile chronology before the capture marker');
update public.profiles set role='artist' where id=pg_temp.id(3);
set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.id(1)::text,true);
select throws_ok($$select public.analytics_capture_server(pg_temp.id(1),pg_temp.id(101),'signup_complete')$$,'42501',null,'browser cannot fabricate trusted capture');
reset role;
set local role service_role;
select throws_ok($$select public.analytics_capture_server(pg_temp.id(1),pg_temp.id(101),'signup_complete')$$,'55000','ANALYTICS_CAPTURE_POLICY_REQUIRED','capture never invents missing policy');
reset role;
insert into private.analytics_policy(consent_version,enabled,retention_days) values(pg_temp.id(301),true,30);
insert into private.analytics_consents(user_id,consent_version,granted,granted_at,updated_at) values
(pg_temp.id(1),pg_temp.id(301),true,clock_timestamp()-interval '2 days',clock_timestamp()),
(pg_temp.id(2),pg_temp.id(301),true,clock_timestamp()-interval '2 days',clock_timestamp());
set local role service_role;
select throws_ok($$select public.analytics_capture_server(pg_temp.id(1),pg_temp.id(101),'signup_complete')$$,'55000','ANALYTICS_CAPTURE_POLICY_REQUIRED','owner fixture consent cannot bypass absent approved readable document');
reset role;
insert into private.onboarding_documents(version,kind,title,body,approved_at,published_at) values
(pg_temp.id(301),'analytics','Fictional capture document','Rollback-only synthetic policy',now(),now());
set local role service_role;
select throws_ok($$select public.analytics_capture_server(pg_temp.id(2),pg_temp.id(102),'signup_complete')$$,'55000','ANALYTICS_CAPTURE_SOURCE_BEFORE_START','old signup read retry is not prospective event backfill');
select throws_ok($$select public.analytics_capture_server(pg_temp.id(3),pg_temp.id(103),'signup_complete')$$,'42501','ANALYTICS_ACTOR_FORBIDDEN','artist cannot be fan capture actor');
insert into capture_context(key,id) values('signup',public.analytics_capture_server(pg_temp.id(1),pg_temp.id(101),'signup_complete'));
select is(public.analytics_capture_server(pg_temp.id(1),pg_temp.id(101),'signup_complete'),(select id from capture_context where key='signup'),'signup stable retry retains one accepted event');
select throws_ok($$select public.analytics_capture_server(pg_temp.id(1),pg_temp.id(102),'signup_complete')$$,'23514','ANALYTICS_EVENT_CONFLICT','signup new retry alias remains rejected');
select throws_ok($$select public.analytics_capture_server(pg_temp.id(1),pg_temp.id(104),'message_open',pg_temp.id(105))$$,'42501','ANALYTICS_SERVER_EVENT_FORBIDDEN','trusted capture cannot bypass client observation boundary');
select throws_ok($$select public.analytics_capture_server(pg_temp.id(1),pg_temp.id(104),'subscribe_complete',pg_temp.id(105))$$,'42501','ANALYTICS_SERVER_EVENT_FORBIDDEN','generic capture cannot fabricate verified purchase');
reset role;
update public.profiles set font_selected_at=clock_timestamp() where id=pg_temp.id(1);
set local role service_role;
select throws_ok($$select public.analytics_capture_server(pg_temp.id(1),pg_temp.id(106),'font_size_selected',null,'large')$$,'55000','ANALYTICS_CAPTURE_SOURCE_UNAVAILABLE','first-selection timestamp cannot prove current font change occurrence');
-- Existing accepted schema is exercised through its unchanged legacy boundary;
-- this is not an automatic or prospective font instrumentation claim.
select lives_ok($$select public.analytics_record_server(pg_temp.id(1),pg_temp.id(106),'font_size_selected',null,'large')$$,'legacy typed font observation contract remains compatible');
select throws_ok($$select public.analytics_capture_server(pg_temp.id(1),pg_temp.id(107),'font_size_selected',null,'normal')$$,'55000','ANALYTICS_CAPTURE_SOURCE_UNAVAILABLE','capture does not infer missing font occurrence evidence');
reset role;
insert into public.artists(id,slug,name,grade,status) values(pg_temp.id(401),'capture-fixture','허구수집가수','B','active'),(pg_temp.id(402),'capture-failure','허구실패가수','B','active');
set local role service_role;
insert into capture_context(key,id) values('subscription',public.billing_open_subscription(pg_temp.id(1),pg_temp.id(401),'toss'));
insert into capture_context(key,id) values('mandate',public.billing_register_mandate((select id from capture_context where key='subscription'),'test','fixture-capture',gen_random_uuid(),gen_random_uuid(),'fixture-consent'));
insert into capture_context(key,id) values('obligation',public.billing_prepare_obligation((select id from capture_context where key='subscription'),now()-interval '1 day',now()+interval '29 days',1000,true,'fixture-price',259200,1,3));
insert into capture_context(key,id) values('attempt',public.billing_prepare_attempt((select id from capture_context where key='obligation')));
insert into capture_context(key,data) values('claim',public.billing_claim_attempt((select id from capture_context where key='attempt'),120));
select throws_ok($$select public.analytics_capture_charge((select id from capture_context where key='attempt'))$$,'42501','ANALYTICS_VERIFIED_CHARGE_REQUIRED','attempt is not verified ledger charge');
insert into capture_context(key,id) values('charge',public.billing_finalize_charge((select id from capture_context where key='attempt'),'fictional-capture-charge',1000,'KRW',statement_timestamp(),gen_random_uuid()));
insert into capture_context(key,id) values('charge-event',public.analytics_capture_charge((select id from capture_context where key='charge')));
select is(public.analytics_capture_charge((select id from capture_context where key='charge')),(select id from capture_context where key='charge-event'),'verified initial capture preserves ledger-key dedupe');
reset role;
select is((select name::text from private.analytics_events where id=(select id from capture_context where key='charge-event')),'subscribe_complete','verified initial is classified from billing evidence');
-- A source-backed enrollment fixture exercises precise start identity/time, not
-- a real provider registration. All underlying references are disposable.
insert into private.checkout_policies(version,title,body,regular_price_krw,intro_price_krw,approved_at,published_at,billing_period_calendar,payment_tax_basis)
 values(pg_temp.id(501),'Fictional checkout','Fictional only',1000,1000,now(),now(),'utc_monthly_clamped','taxable_krw');
insert into private.checkout_sessions(id,user_id,artist_id,provider,environment,idempotency_key,nonce_hash,policy_version,initial_price_krw,regular_price_krw,intro_eligible,expires_at)
 values(pg_temp.id(502),pg_temp.id(1),pg_temp.id(401),'toss','test',pg_temp.id(503),repeat('a',64),pg_temp.id(501),1000,1000,false,clock_timestamp()+interval '10 minutes');
insert into private.subscription_enrollments(session_id,user_id,artist_id,subscription_id,mandate_id,credential_ref,auth_session_hash,callback_state_hash,state,created_at)
 values(pg_temp.id(502),pg_temp.id(1),pg_temp.id(401),(select id from capture_context where key='subscription'),(select id from capture_context where key='mandate'),pg_temp.id(504),repeat('b',64),repeat('c',64),'failed',clock_timestamp());
set local role service_role;
insert into capture_context(key,id) values('start',public.analytics_capture_server(pg_temp.id(1),pg_temp.id(502),'subscribe_start',(select id from capture_context where key='subscription')));
select is(public.analytics_capture_server(pg_temp.id(1),pg_temp.id(502),'subscribe_start',(select id from capture_context where key='subscription')),(select id from capture_context where key='start'),'start capture replays immutable enrollment session even after business state changes');
select throws_ok($$select public.analytics_capture_server(pg_temp.id(1),(select id from capture_context where key='subscription'),'subscribe_start',(select id from capture_context where key='subscription'))$$,'42501','ANALYTICS_SOURCE_FORBIDDEN','reused subscription UUID is not enrollment operation key');
select throws_ok($$select public.analytics_capture_server(pg_temp.id(2),pg_temp.id(502),'subscribe_start',(select id from capture_context where key='subscription'))$$,'42501','ANALYTICS_SOURCE_FORBIDDEN','another fan cannot borrow enrollment source');
reset role;
select is((select occurred_at from private.analytics_events where id=(select id from capture_context where key='start')),(select created_at from private.subscription_enrollments where session_id=pg_temp.id(502)),'start uses immutable persisted enrollment timestamp');
insert into public.replies(id,user_id,artist_id,subscription_id,body,is_blocked,created_at) values
(pg_temp.id(601),pg_temp.id(1),pg_temp.id(401),(select id from capture_context where key='subscription'),'Fictional delivered',false,clock_timestamp()),
(pg_temp.id(602),pg_temp.id(1),pg_temp.id(401),(select id from capture_context where key='subscription'),'Fictional blocked',true,clock_timestamp()),
(pg_temp.id(603),pg_temp.id(1),pg_temp.id(401),(select id from capture_context where key='subscription'),'Fictional old',false,clock_timestamp()-interval '1 day');
insert into public.artist_members(artist_id,user_id) values(pg_temp.id(401),pg_temp.id(3));
insert into private.message_policy values(true,'fictional-capture-message',604800,300,1000,100,10,180,60,5,10485760,20971520,104857600);
insert into public.messages(id,artist_id,author_id,type,body,status,scheduled_at,sent_at,is_preview,preview_order)
 values(pg_temp.id(650),pg_temp.id(401),pg_temp.id(3),'text','Private preview content','sent',now(),now(),true,1);
insert into public.posts(id,artist_id,user_id,request_id,title,body,created_at)
 values(pg_temp.id(651),pg_temp.id(401),pg_temp.id(1),pg_temp.id(652),'Private post title','Private post body',clock_timestamp());
insert into private.point_policy(version,attendance_amount,post_amount,comment_amount,deleted_content_treatment) values('fictional-capture-points',10,0,0,'retain');
set local role authenticated;
insert into capture_context(key,id) values('point',public.point_check_attendance());
select lives_ok($$select public.analytics_record_client(pg_temp.id(653),'message_open',pg_temp.id(650))$$,'authorized real client message observation remains separate');
select lives_ok($$select public.analytics_record_client(pg_temp.id(654),'voice_input_used',null,'reply')$$,'authorized client voice observation remains separate');
reset role;
set local role service_role;
select lives_ok($$select public.analytics_capture_server(pg_temp.id(1),pg_temp.id(655),'preview_view',pg_temp.id(650))$$,'currently visible preview observation captures no private content');
select lives_ok($$select public.analytics_capture_server(pg_temp.id(1),pg_temp.id(652),'post_create',pg_temp.id(651))$$,'new persisted post keeps creation retry key');
select lives_ok($$select public.analytics_capture_server(pg_temp.id(1),(select id from capture_context where key='point'),'attendance',(select id from capture_context where key='point'))$$,'new attendance source uses immutable ledger identity');
insert into capture_context(key,id) values('failed-subscription',public.billing_open_subscription(pg_temp.id(1),pg_temp.id(402),'toss'));
select public.billing_register_mandate((select id from capture_context where key='failed-subscription'),'test','fixture-capture-failure',gen_random_uuid(),gen_random_uuid(),'fixture-consent');
insert into capture_context(key,id) values('failed-obligation',public.billing_prepare_obligation((select id from capture_context where key='failed-subscription'),now()-interval '1 day',now()+interval '29 days',1000,true,'fixture-price',259200,1,3));
insert into capture_context(key,id) values('failed-attempt',public.billing_prepare_attempt((select id from capture_context where key='failed-obligation')));
insert into capture_context(key,data) values('failed-claim',public.billing_claim_attempt((select id from capture_context where key='failed-attempt'),120));
select throws_ok($$select public.analytics_capture_server(pg_temp.id(1),(select id from capture_context where key='failed-attempt'),'subscribe_fail',(select id from capture_context where key='failed-attempt'))$$,'42501','ANALYTICS_SOURCE_FORBIDDEN','inflight provider outcome is not failed subscription capture');
select public.billing_record_attempt_outcome((select id from capture_context where key='failed-attempt'),(select (data->>'lease_token')::uuid from capture_context where key='failed-claim'),'failed',gen_random_uuid());
select lives_ok($$select public.analytics_capture_server(pg_temp.id(1),(select id from capture_context where key='failed-attempt'),'subscribe_fail',(select id from capture_context where key='failed-attempt'))$$,'verified definitive failure captures its private attempt source');
reset role;
update public.subscriptions set current_period_start=now()-interval '31 days',current_period_end=now()-interval '1 second' where id=(select id from capture_context where key='subscription');
set local role service_role;
insert into capture_context(key,id) values('renewal-obligation',public.billing_prepare_obligation((select id from capture_context where key='subscription'),now()-interval '1 second',now()+interval '30 days',6500,false,'fixture-price',259200,1,3));
insert into capture_context(key,id) values('renewal-attempt',public.billing_prepare_attempt((select id from capture_context where key='renewal-obligation')));
select public.billing_claim_attempt((select id from capture_context where key='renewal-attempt'),120);
insert into capture_context(key,id) values('renewal-charge',public.billing_finalize_charge((select id from capture_context where key='renewal-attempt'),'fictional-capture-renewal',6500,'KRW',statement_timestamp(),gen_random_uuid()));
insert into capture_context(key,id) values('renewal-event',public.analytics_capture_charge((select id from capture_context where key='renewal-charge')));
reset role;
select is((select name::text from private.analytics_events where id=(select id from capture_context where key='renewal-event')),'renew','renewal classification derives from actual obligation is_initial=false');
set local role service_role;
select lives_ok($$select public.analytics_capture_server(pg_temp.id(1),pg_temp.id(601),'reply_sent',pg_temp.id(601))$$,'new delivered reply captures verified stored source');
select throws_ok($$select public.analytics_capture_server(pg_temp.id(1),pg_temp.id(602),'reply_sent',pg_temp.id(602))$$,'42501','ANALYTICS_SOURCE_FORBIDDEN','blocked reply is not delivered reply event');
select throws_ok($$select public.analytics_capture_server(pg_temp.id(1),pg_temp.id(603),'reply_sent',pg_temp.id(603))$$,'55000','ANALYTICS_CAPTURE_SOURCE_BEFORE_START','old reply receipt retry cannot backfill analytics');
select throws_ok($$select public.analytics_record_cancellation(pg_temp.id(1),(select id from capture_context where key='subscription'))$$,'42501','ANALYTICS_SOURCE_FORBIDDEN','active subscription is not cancellation source');
reset role;
set local role authenticated;
select public.cancel_subscription((select id from capture_context where key='subscription'));
reset role;
set local role service_role;
insert into capture_context(key,id) values('cancel',public.analytics_record_cancellation(pg_temp.id(1),(select id from capture_context where key='subscription')));
select is(public.analytics_record_cancellation(pg_temp.id(1),(select id from capture_context where key='subscription')),(select id from capture_context where key='cancel'),'cancellation retry derives same current immutable epoch key');
select throws_ok($$select public.analytics_record_cancellation(pg_temp.id(2),(select id from capture_context where key='subscription'))$$,'42501','ANALYTICS_SOURCE_FORBIDDEN','another fan cannot capture cancellation');
select throws_ok($$select public.analytics_capture_server(pg_temp.id(1),gen_random_uuid(),'cancel',(select id from capture_context where key='subscription'))$$,'42501','ANALYTICS_SOURCE_FORBIDDEN','generic cancellation key cannot invent epoch');
reset role;
select ok((select e.event_key=h.id and e.occurred_at=h.canceled_at from private.analytics_events e join private.subscription_cancellation_history h on h.subscription_id=e.source_id and h.canceled_at=e.occurred_at where e.id=(select id from capture_context where key='cancel')),'cancellation uses exact immutable observed history identity and time');
-- An owner-only state fixture simulates a distinct later cancellation epoch;
-- this is not a provider or user action and rolls back with the entire suite.
update public.subscriptions set status='active',canceled_at=null where id=(select id from capture_context where key='subscription');
set local role authenticated;
select public.cancel_subscription((select id from capture_context where key='subscription'));
reset role;
set local role service_role;
select isnt(public.analytics_record_cancellation(pg_temp.id(1),(select id from capture_context where key='subscription')),(select id from capture_context where key='cancel'),'later actual cancellation epoch receives distinct stable event key');
reset role;
select is((select count(*) from private.analytics_events where name='cancel'),2::bigint,'two cancellation epochs are not collapsed by reused subscription ID');
set local role authenticated;
select public.analytics_set_consent(false,null);
reset role;
set local role service_role;
select throws_ok($$select public.analytics_capture_server(pg_temp.id(1),pg_temp.id(601),'reply_sent',pg_temp.id(601))$$,'55000','ANALYTICS_CONSENT_REQUIRED','current withdrawal overrides successful capture replay');
select throws_ok($$select public.analytics_capture_charge((select id from capture_context where key='charge'))$$,'55000','ANALYTICS_CONSENT_REQUIRED','current withdrawal overrides verified charge replay');
reset role;
update private.analytics_policy set enabled=false;
set local role service_role;
select throws_ok($$select public.analytics_capture_server(pg_temp.id(1),pg_temp.id(601),'reply_sent',pg_temp.id(601))$$,'55000','ANALYTICS_CAPTURE_POLICY_REQUIRED','disabled policy blocks prospective capture without changing business source');
reset role;
select is((select count(*) from public.payment_events),2::bigint,'optional capture never creates another financial event');
select is((select count(*) from public.replies),3::bigint,'rejected optional capture leaves business sources intact');
select is((select count(distinct name) from private.analytics_events),13::bigint,'all13 documented names have exercised typed trusted or client ingestion paths');
select * from finish();
rollback;
