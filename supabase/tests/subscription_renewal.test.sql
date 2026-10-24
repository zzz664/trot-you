begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();

select is((select count(*) from private.renewal_policies),0::bigint,'migration approves no renewal business policy');
select is((select count(*) from private.renewal_notice_receipts),0::bigint,'migration invents no delivered notices');
select is((select count(*) from private.renewal_attempts),0::bigint,'migration charges nobody');
select ok((select bool_and(relrowsecurity) from pg_class where oid in ('private.renewal_policies'::regclass,
 'private.renewal_notice_receipts'::regclass,'private.renewal_attempts'::regclass)),'all renewal private tables have RLS');
select ok((select bool_and(not has_table_privilege(r,t,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'))
 from unnest(array['anon','authenticated','service_role']) r,unnest(array['private.renewal_policies','private.renewal_notice_receipts','private.renewal_attempts']) t),
 'no application role directly reads or mutates renewal policy, receipt or recovery metadata');
select ok((select bool_and('search_path=""'=any(proconfig)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname in ('private','public') and p.proname like 'renewal\_%' escape '\'),'renewal functions pin empty search path');
select ok((select bool_and(not has_function_privilege(r,p.oid,'EXECUTE')) from pg_proc p join pg_namespace n on n.oid=p.pronamespace,
 unnest(array['anon','authenticated']) r where n.nspname='public' and p.proname like 'renewal\_%' escape '\'),'clients cannot invoke renewal RPCs');
select ok((select bool_and(has_function_privilege('service_role',p.oid,'EXECUTE')) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname like 'renewal\_%' escape '\'),'service has explicit renewal RPC grants');
select ok((select bool_and(not has_function_privilege(r,p.oid,'EXECUTE')) from pg_proc p join pg_namespace n on n.oid=p.pronamespace,
 unnest(array['anon','authenticated','service_role']) r where n.nspname='private' and p.proname like 'renewal\_%' escape '\'),'private renewal helpers are inaccessible to application roles');
select is(private.renewal_period_end('2027-01-31T03:12:34Z','2027-02-28T03:12:34Z','utc_monthly_clamped'),
 '2027-03-31T03:12:34Z'::timestamptz,'UTC February clamp restores original thirty-first anniversary');
select is(private.renewal_period_end('2028-01-31T23:12:34Z','2028-02-29T23:12:34Z','utc_monthly_clamped'),
 '2028-03-31T23:12:34Z'::timestamptz,'leap February restores original anniversary');
select is(private.renewal_period_end('2027-01-30T15:12:34Z','2027-02-27T15:12:34Z','seoul_monthly_clamped'),
 '2027-03-30T15:12:34Z'::timestamptz,'Seoul local January thirty-first is not interpreted as UTC thirtieth');
select is(private.renewal_period_end('2027-01-31T03:12:34Z','2027-02-27T03:12:34Z','utc_monthly_clamped'),null::timestamptz,
 'non-anniversary paid endpoint is not silently repaired into a new billing calendar');
select is(private.renewal_period_end('2027-01-31T03:12:34Z','2027-02-28T03:12:34Z','unapproved'),null::timestamptz,'unknown calendar fails closed');

insert into auth.users(id,email,raw_user_meta_data) values('c1000000-0000-4000-8000-000000000001','renewal-only@example.invalid','{}');
insert into private.onboarding_documents(version,kind,title,body,approved_at,published_at) values
 ('c9000000-0000-4000-8000-000000000001','terms','Fictional terms','Rollback-only terms.',now(),now()),
 ('c9000000-0000-4000-8000-000000000002','privacy','Fictional privacy','Rollback-only privacy.',now(),now());
insert into private.profile_onboarding_policy values(true,'c8000000-0000-4000-8000-000000000001',now(),2,10,
 array['금지단어'],'c9000000-0000-4000-8000-000000000001','c9000000-0000-4000-8000-000000000002',null);
update public.profiles set font_selected_at=now(),call_name='허구갱신팬',age_self_attested_at=now(),profile_completed_at=now(),onboarding_completed_at=now()
 where id='c1000000-0000-4000-8000-000000000001';
insert into private.profile_policy_acceptances(user_id,kind,version,accepted_at)
 select 'c1000000-0000-4000-8000-000000000001',kind,version,now() from private.onboarding_documents;
insert into private.checkout_policies values
 ('c7000000-0000-4000-8000-000000000001','허구 갱신 정책','운영에 사용할 수 없는 테스트 전용 명시 승인 정책입니다.',7200,1200,now(),now(),'utc_monthly_clamped','taxable_krw'),
 ('c7000000-0000-4000-8000-000000000002','허구 통지 정책','운영에 사용할 수 없는 테스트 전용 통지 필수 정책입니다.',7200,1200,now(),now(),'utc_monthly_clamped','taxable_krw');
insert into private.checkout_policy_current values(true,'c7000000-0000-4000-8000-000000000001');
create temp table renewal_cases(label text primary key,sid uuid,descriptor jsonb,approved_at timestamptz,evidence uuid);
grant all on renewal_cases to service_role;
create function pg_temp.fan() returns uuid language sql as $$select 'c1000000-0000-4000-8000-000000000001'::uuid$$;
create function pg_temp.policy() returns uuid language sql as $$select 'c7000000-0000-4000-8000-000000000001'::uuid$$;
create function pg_temp.sid(label text) returns uuid language sql as $$select sid from renewal_cases c where c.label=$1$$;
create function pg_temp.aid(label text) returns uuid language sql as $$select (descriptor->>'attempt_id')::uuid from renewal_cases c where c.label=$1$$;
create function pg_temp.lease(label text) returns uuid language sql as $$select (descriptor->>'lease_token')::uuid from renewal_cases c where c.label=$1$$;
create function pg_temp.make_case(label text,provider public.payment_provider default 'toss',policy uuid default pg_temp.policy()) returns uuid
language plpgsql as $$declare artist uuid:=gen_random_uuid(); sid uuid:=gen_random_uuid(); mid uuid:=gen_random_uuid(); cid uuid:=gen_random_uuid();
 session uuid:=gen_random_uuid(); event uuid:=gen_random_uuid(); anchor timestamptz:=date_trunc('hour',clock_timestamp())-interval '1 month 1 hour'; due timestamptz;
begin
 due:=private.enrollment_period_end(anchor,'utc_monthly_clamped');
 insert into public.artists(id,slug,name,grade,status) values(artist,'renewal-'||artist,'허구 갱신 가수','B','active');
 insert into public.subscriptions(id,user_id,artist_id,provider,status,intro_redeemed_at,first_started_at,episode_started_at,current_period_start,current_period_end,next_billing_at)
 values(sid,pg_temp.fan(),artist,provider,'active',anchor,anchor,anchor,anchor,due,due);
 insert into private.payment_mandates(id,subscription_id,provider,environment,merchant_account,provider_customer_ref,secure_credential_ref,consent_version)
 values(mid,sid,provider,'test','fixture-merchant',gen_random_uuid(),cid,policy::text);
 insert into public.payment_events(id,subscription_id,kind,amount_krw,currency,provider,period_start,period_end,occurred_at)
 values(event,sid,'charge',1200,'KRW',provider,anchor,due,anchor);
 insert into private.checkout_sessions(id,user_id,artist_id,provider,environment,idempotency_key,nonce_hash,policy_version,initial_price_krw,
 regular_price_krw,intro_eligible,created_at,expires_at)
 values(session,pg_temp.fan(),artist,provider,'test',gen_random_uuid(),repeat('a',64),policy,1200,7200,true,anchor,anchor+interval '30 minutes');
 insert into private.subscription_enrollments(session_id,user_id,artist_id,subscription_id,mandate_id,credential_ref,auth_session_hash,callback_state_hash,state,stage,payment_event_id)
 values(session,pg_temp.fan(),artist,sid,mid,cid,repeat('b',64),repeat('c',64),'succeeded',case provider when 'toss' then 'charge' else 'approve' end,event);
 insert into private.enrollment_credentials(id,mandate_id,ciphertext)
 values(cid,mid,'{"version":"fixture-v1","iv":"AAAAAAAAAAAAAAAA","tag":"AAAAAAAAAAAAAAAAAAAAAA","ciphertext":"AA"}');
 insert into renewal_cases(label,sid,evidence) values(label,sid,gen_random_uuid()); return sid;
end$$;
create function pg_temp.claim(label text) returns jsonb language plpgsql as $$declare d jsonb; begin
 d:=public.renewal_read(pg_temp.sid(label));
 d:=public.renewal_claim(pg_temp.sid(label),(d->>'mandate_id')::uuid,(d->>'period_start')::timestamptz,(d->>'period_end')::timestamptz,120);
 if (d->>'dispatch')::boolean then update renewal_cases set descriptor=d where renewal_cases.label=$1; end if;
 return d;
end$$;
select pg_temp.make_case('success');
set local role authenticated;
select throws_ok($$select public.renewal_candidates(4)$$,'42501',null,'authenticated cannot discover private renewals');
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select throws_ok($$select public.renewal_read(pg_temp.sid('success'))$$,'42501',null,'forged JWT role cannot read vault');
reset role;
select throws_ok($$select public.renewal_candidates(4)$$,'42501','BILLING_SERVICE_REQUIRED','actual service database role is required');
set local role service_role;
select is(public.renewal_read(pg_temp.sid('success'))->>'reason','POLICY_NOT_APPROVED','accepted checkout price alone is not renewal/grace/retry approval');
select is(public.renewal_candidates(4),'[]'::jsonb,'blocked rows do not starve processable candidates');
select throws_ok($$select public.renewal_candidates(0)$$,'22023','RENEWAL_INVALID_INPUT','zero candidate limit rejected');
select throws_ok($$select public.renewal_candidates(21)$$,'22023','RENEWAL_INVALID_INPUT','unbounded candidate batch rejected');
reset role;
insert into private.renewal_policies values(pg_temp.policy(),259200,86400,3,false,0,now(),now());
insert into private.renewal_policies values('c7000000-0000-4000-8000-000000000002',259200,86400,3,true,86400,now(),now());
select throws_ok($$update private.renewal_policies set grace_seconds=1 where checkout_policy_version=pg_temp.policy()$$,
 '23514','RENEWAL_POLICY_IMMUTABLE','approved grace/retry/notice choices cannot be silently changed');
set local role service_role;
select is(public.renewal_read(pg_temp.sid('success'))->>'action','charge','explicit matched approval enables a due renewal');
select is((public.renewal_read(pg_temp.sid('success'))->>'amount_krw')::integer,7200,'renewal uses immutable regular price never introduction');
select is(jsonb_array_length(public.renewal_candidates(1)),1,'candidate list is bounded');
select throws_ok($$select public.renewal_claim(pg_temp.sid('success'),gen_random_uuid(),now(),now()+interval '1 month',120)$$,
 '55000','RENEWAL_SNAPSHOT_CHANGED','changed identity/period preflight cannot claim');
select throws_ok($$select public.renewal_claim(pg_temp.sid('success'),null,null,null,1)$$,'22023','RENEWAL_INVALID_INPUT','lease shorter than provider budget rejected');
select is(pg_temp.claim('success')->>'dispatch','true','due obligation and fresh lease created atomically');
select is(pg_temp.claim('success')->>'dispatch','false','second worker cannot dispatch same due period');
select is(public.renewal_read_attempt(pg_temp.aid('success'))->>'state','inflight','attempt alone is not revenue');
reset role;
select is((select count(*) from private.billing_obligations where subscription_id=pg_temp.sid('success')),1::bigint,'one obligation exists per due period');
select is((select count(*) from private.payment_attempts a join private.billing_obligations o on o.id=a.obligation_id where o.subscription_id=pg_temp.sid('success')),1::bigint,'one stable first renewal attempt');
select ok((select not is_initial and not is_intro and amount_krw=7200 from private.billing_obligations where subscription_id=pg_temp.sid('success')),'renewal snapshot is not introductory');
update renewal_cases set approved_at=clock_timestamp() where label='success';
set local role service_role;
select throws_ok($$select public.renewal_finalize(pg_temp.aid('success'),'action-success','payment-success',1,'KRW',
 (select approved_at from renewal_cases where label='success'),gen_random_uuid())$$,'23514','VERIFIED_RESULT_MISMATCH','wrong verified amount is not money');
select lives_ok($$select public.renewal_finalize(pg_temp.aid('success'),'action-success','payment-success',7200,'KRW',
 (select approved_at from renewal_cases where label='success'),gen_random_uuid())$$,'verified renewal finalizes');
select lives_ok($$select public.renewal_finalize(pg_temp.aid('success'),'action-success','payment-success',7200,'KRW',
 (select approved_at from renewal_cases where label='success'),gen_random_uuid())$$,'exact replay records no second charge');
select is(public.renewal_read_attempt(pg_temp.aid('success'))->>'state','success','durable read resolves a lost database reply');
select throws_ok($$select public.renewal_finalize(pg_temp.aid('success'),'action-success','changed-payment',7200,'KRW',
 (select approved_at from renewal_cases where label='success'),gen_random_uuid())$$,'55000','RENEWAL_OUTCOME_CONFLICT','replay cannot substitute payment identity');
reset role;
select is((select count(*) from public.payment_events where subscription_id=pg_temp.sid('success')),2::bigint,'one initial and one verified renewal ledger event');
select is((select current_period_start from public.subscriptions where id=pg_temp.sid('success')),
 (select (descriptor->>'period_start')::timestamptz from renewal_cases where label='success'),'paid period starts at prior end, never worker invocation');
select is((select next_billing_at=current_period_end from public.subscriptions where id=pg_temp.sid('success')),true,'next billing follows settled period');

select pg_temp.make_case('retry');
set local role service_role;
select is(pg_temp.claim('retry')->>'dispatch','true','retry scenario first dispatch');
select throws_ok($$select public.renewal_record_outcome(pg_temp.aid('retry'),gen_random_uuid(),'failed',gen_random_uuid(),true)$$,
 '55000','RENEWAL_OUTCOME_CONFLICT','wrong lease cannot classify a decline');
select lives_ok($$select public.renewal_record_outcome(pg_temp.aid('retry'),pg_temp.lease('retry'),'failed',
 (select evidence from renewal_cases where label='retry'),true)$$,'verified retryable decline enters grace');
select is(pg_temp.claim('retry')->>'dispatch','false','immediate cron replay is not another due retry');
reset role;
select is((select status::text from public.subscriptions where id=pg_temp.sid('retry')),'grace','decline grants only bounded unpaid grace');
select is((select grace_started_at from public.subscriptions where id=pg_temp.sid('retry')),
 (select (descriptor->>'period_start')::timestamptz from renewal_cases where label='retry'),'grace anchor is unpaid period, not retry clock');
select is((select grace_ends_at-grace_started_at from public.subscriptions where id=pg_temp.sid('retry')),interval '3 days','approved grace snapshot applies');
select ok((select next_billing_at>clock_timestamp()+interval '23 hours' from public.subscriptions where id=pg_temp.sid('retry')),'approved retry interval is not doubledue');
-- Owner-only clock fixture: move scheduling metadata, never change ledger facts.
update private.billing_obligations set next_attempt_at=clock_timestamp()-interval '1 second' where subscription_id=pg_temp.sid('retry');
update public.subscriptions set next_billing_at=clock_timestamp()-interval '1 second' where id=pg_temp.sid('retry');
set local role service_role;
select is(pg_temp.claim('retry')->>'dispatch','true','only definitive decline plus due schedule permits a fresh attempt');
select is(pg_temp.claim('retry')->>'dispatch','false','concurrent retry replay has no second dispatch');
reset role;
select is((select max(ordinal) from private.payment_attempts where obligation_id=(select id from private.billing_obligations where subscription_id=pg_temp.sid('retry'))),2,'retry retains obligation and advances bounded attempt ordinal');
select pg_temp.make_case('terminal');
set local role service_role;
select is(pg_temp.claim('terminal')->>'dispatch','true','terminal decline first dispatch');
select lives_ok($$select public.renewal_record_outcome(pg_temp.aid('terminal'),pg_temp.lease('terminal'),'failed',gen_random_uuid(),false)$$,
 'terminal refusal does not schedule a retry');
reset role;
select is((select next_billing_at from public.subscriptions where id=pg_temp.sid('terminal')),null::timestamptz,'terminal decline clears next charge');
select is((select status::text from public.subscriptions where id=pg_temp.sid('terminal')),'grace','terminal refusal preserves approved grace until expiry');

select pg_temp.make_case('unknown');
set local role service_role;
select is(pg_temp.claim('unknown')->>'dispatch','true','unknown scenario has one charge');
select throws_ok($$select public.renewal_record_outcome(pg_temp.aid('unknown'),pg_temp.lease('unknown'),'unknown',null,true)$$,
 '55000','RENEWAL_OUTCOME_CONFLICT','unknown cannot authorize retries');
select lives_ok($$select public.renewal_record_outcome(pg_temp.aid('unknown'),pg_temp.lease('unknown'),'unknown',null,false)$$,'timeout held as unknown');
select is(public.renewal_read(pg_temp.sid('unknown'))->>'action','none','recovery backoff is finite and not immediate polling');
select is(pg_temp.claim('unknown')->>'dispatch','false','unknown response never recharges');
reset role;
update private.renewal_attempts set next_query_at=clock_timestamp()-interval '1 second' where attempt_id=pg_temp.aid('unknown');
set local role service_role;
select is(public.renewal_read(pg_temp.sid('unknown'))->>'action','reconcile','Toss unknown uses same-order query only');
select is(pg_temp.claim('unknown')->>'action','reconcile','fresh query lease dispatches read-only recovery');
select is(pg_temp.claim('unknown')->>'dispatch','false','query leases prevent concurrent recovery flood');
select throws_ok($$select public.renewal_record_query(pg_temp.aid('unknown'),gen_random_uuid())$$,'55000','RENEWAL_OUTCOME_CONFLICT','query completion is token-bound');
select lives_ok($$select public.renewal_record_query(pg_temp.aid('unknown'),pg_temp.lease('unknown'))$$,'inconclusive query releases lease without retrying charge');
reset role;
update renewal_cases set approved_at=(select next_query_at from private.renewal_attempts where attempt_id=pg_temp.aid('unknown')) where label='unknown';
set local role service_role;
select lives_ok($$select public.renewal_record_query(pg_temp.aid('unknown'),pg_temp.lease('unknown'))$$,'duplicate query completion safely replays');
reset role;
select is((select next_query_at from private.renewal_attempts where attempt_id=pg_temp.aid('unknown')),
 (select approved_at from renewal_cases where label='unknown'),'duplicate query reply cannot postpone future recovery');
select is((select count(*) from private.payment_attempts where obligation_id=(select id from private.billing_obligations where subscription_id=pg_temp.sid('unknown'))),1::bigint,'recovery never creates a payment attempt');
update private.renewal_attempts set query_attempts=3,next_query_at=clock_timestamp()-interval '1 second' where attempt_id=pg_temp.aid('unknown');
set local role service_role;
select is(public.renewal_read(pg_temp.sid('unknown'))->>'action','manual_review','query budget exhaustion remains unresolved manual review');
select is(pg_temp.claim('unknown')->>'dispatch','false','exhausted query budget never rotates order or sends more requests');
reset role;
select pg_temp.make_case('kakao','kakaopay');
set local role service_role;
select is(pg_temp.claim('kakao')->>'dispatch','true','Kakao renewal has one atomic application dispatch');
select lives_ok($$select public.renewal_record_outcome(pg_temp.aid('kakao'),pg_temp.lease('kakao'),'unknown',null,false)$$,'lost Kakao subscription response held');
select is(public.renewal_read(pg_temp.sid('kakao'))->>'reason','PAYMENT_ID_MISSING','unknown Kakao TID cannot be reconstructed from SID availability');
select is(pg_temp.claim('kakao')->>'dispatch','false','TID-less Kakao cannot be charged or queried blindly');
reset role;
select pg_temp.make_case('known-kakao','kakaopay');
set local role service_role;
select is(pg_temp.claim('known-kakao')->>'dispatch','true','known Kakao fixture dispatch');
select lives_ok($$select public.renewal_record_outcome(pg_temp.aid('known-kakao'),pg_temp.lease('known-kakao'),'unknown',null,false,'TID_KNOWN')$$,
 'trusted bounded partial identity can be retained for documented TID query');
reset role;
update private.renewal_attempts set next_query_at=clock_timestamp()-interval '1 second' where attempt_id=pg_temp.aid('known-kakao');
set local role service_role;
select is(public.renewal_read(pg_temp.sid('known-kakao'))->>'action','reconcile','known TID allows order query, never SID inference');
reset role;

select pg_temp.make_case('cancel-first');
set local role service_role;
select lives_ok($$select public.cancel_subscription(pg_temp.sid('cancel-first'))$$,'cancellation wins before claim');
select is(pg_temp.claim('cancel-first')->>'dispatch','false','cancellation prevents a later renewal dispatch');
reset role;
select pg_temp.make_case('cancel-late');
set local role service_role;
select is(pg_temp.claim('cancel-late')->>'dispatch','true','already dispatched renewal remains reconcilable');
select lives_ok($$select public.cancel_subscription(pg_temp.sid('cancel-late'))$$,'cancellation does not unsend provider request');
reset role;
update renewal_cases set approved_at=clock_timestamp() where label='cancel-late';
set local role service_role;
select lives_ok($$select public.renewal_finalize(pg_temp.aid('cancel-late'),'action-late','payment-late',7200,'KRW',
 (select approved_at from renewal_cases where label='cancel-late'),gen_random_uuid())$$,'verified late payment records once after cancellation');
reset role;
select is((select status::text from public.subscriptions where id=pg_temp.sid('cancel-late')),'canceled','late approval cannot reenable future billing');
select is((select next_billing_at from public.subscriptions where id=pg_temp.sid('cancel-late')),null::timestamptz,'canceled paid period has no next billing');
select ok((select current_period_end>clock_timestamp() from public.subscriptions where id=pg_temp.sid('cancel-late')),'late canceled approval preserves genuinely paid access');
update public.subscriptions set grace_ends_at=clock_timestamp()-interval '1 second',grace_started_at=clock_timestamp()-interval '2 seconds'
 where id=pg_temp.sid('terminal');
set local role service_role;
select is(public.renewal_read(pg_temp.sid('terminal'))->>'action','expired','grace expiry is local maintenance, not another charge');
select is(public.renewal_claim(pg_temp.sid('terminal'),null,null,null,120)->>'dispatch','false','expiry requires no credential/config preflight');
reset role;
select is((select status::text from public.subscriptions where id=pg_temp.sid('terminal')),'expired','worker expires grace at boundary');
select is((select state from private.billing_obligations where subscription_id=pg_temp.sid('terminal')),'void','resolved unsuccessful obligation closes on expiry');

select pg_temp.make_case('policy');
update private.checkout_policy_current set policy_version='c7000000-0000-4000-8000-000000000002';
set local role service_role;
select is(public.renewal_read(pg_temp.sid('policy'))->>'reason','POLICY_NOT_APPROVED','changed commercial terms require new accepted approval');
reset role;
update private.checkout_policy_current set policy_version=pg_temp.policy();
update public.profiles set is_restricted=true where id=pg_temp.fan();
set local role service_role;
select is(public.renewal_read(pg_temp.sid('policy'))->>'reason','ELIGIBILITY_CHANGED','restricted profile cannot acquire new renewal dispatch');
reset role;
update public.profiles set is_restricted=false where id=pg_temp.fan();
update public.artists set status='paused' where id=(select artist_id from public.subscriptions where id=pg_temp.sid('policy'));
set local role service_role;
select is(public.renewal_read(pg_temp.sid('policy'))->>'reason','ELIGIBILITY_CHANGED','paused artist cannot acquire new renewal dispatch');
reset role;
select pg_temp.make_case('notice','toss','c7000000-0000-4000-8000-000000000002');
update private.checkout_policy_current set policy_version='c7000000-0000-4000-8000-000000000002';
set local role service_role;
select is(public.renewal_read(pg_temp.sid('notice'))->>'reason','NOTICE_REQUIRED','mandatory prebilling notice cannot be silently waived');
select throws_ok($$select public.renewal_record_notice(pg_temp.sid('notice'),(select current_period_end from public.subscriptions where id=pg_temp.sid('notice')),
 'c7000000-0000-4000-8000-000000000002',7200,clock_timestamp(),gen_random_uuid())$$,'22023','RENEWAL_INVALID_NOTICE','late notification is not required advance notice');
select lives_ok($$select public.renewal_record_notice(pg_temp.sid('notice'),(select current_period_end from public.subscriptions where id=pg_temp.sid('notice')),
 'c7000000-0000-4000-8000-000000000002',7200,(select current_period_end-interval '1 day' from public.subscriptions where id=pg_temp.sid('notice')),
 (select evidence from renewal_cases where label='notice'))$$,'verified delivery evidence records exact period, price and approved policy');
select is(public.renewal_read(pg_temp.sid('notice'))->>'action','charge','verified timely notice enables only its exact due period');
reset role;
select throws_ok($$update private.renewal_notice_receipts set amount_krw=1$$,'55000','IMMUTABLE_PAYMENT_LEDGER','notice evidence cannot be silently rewritten');

update private.checkout_policy_current set policy_version=pg_temp.policy();
select pg_temp.make_case('lease-toss');
select pg_temp.make_case('lease-kakao','kakaopay');
set local role service_role;
select is(pg_temp.claim('lease-toss')->>'dispatch','true','Toss process-death fixture claimed once');
select is(pg_temp.claim('lease-kakao')->>'dispatch','true','Kakao process-death fixture claimed once');
reset role;
update private.payment_attempts set lease_expires_at=clock_timestamp()-interval '1 second'
 where id in (pg_temp.aid('lease-toss'),pg_temp.aid('lease-kakao'));
set local role service_role;
select is(public.renewal_read(pg_temp.sid('lease-toss'))->>'action','lease_expired','expired charge lease requests local maintenance');
select is(public.renewal_claim(pg_temp.sid('lease-toss'))->>'dispatch','false','lease expiry never gives another charge lease');
select is(public.renewal_read_attempt(pg_temp.aid('lease-toss'))->>'state','unknown','expired Toss dispatch becomes durable unknown');
select is(public.renewal_read(pg_temp.sid('lease-toss'))->>'action','reconcile','expired Toss operation can only query original order');
select is(public.renewal_read(pg_temp.sid('lease-kakao'))->>'action','lease_expired','expired Kakao dispatch is locally maintained even with missing TID');
select is(public.renewal_claim(pg_temp.sid('lease-kakao'))->>'action','manual_review','Kakao lease expiry holds manual review without any provider I/O');
select is(public.renewal_read_attempt(pg_temp.aid('lease-kakao'))->>'state','unknown','Kakao uncertainty is durable, not left active processing');
reset role;
select is((select status::text from public.subscriptions where id=pg_temp.sid('lease-kakao')),'grace','expired Kakao lease still grants only anchored grace');
select pg_temp.make_case('exhausted');
set local role service_role;
select is(pg_temp.claim('exhausted')->>'dispatch','true','retry exhaustion fixture has original attempt');
select lives_ok($$select public.renewal_record_outcome(pg_temp.aid('exhausted'),pg_temp.lease('exhausted'),'failed',gen_random_uuid(),true)$$,'first failed attempt permits bounded later retry');
reset role;
-- Move only fictional mutable scheduling metadata to exercise all three retries
-- deterministically; no wall-clock wait or immutable ledger edit is needed.
create function pg_temp.fail_retry(label text) returns void language plpgsql as $$declare d jsonb; begin
 update private.billing_obligations set next_attempt_at=clock_timestamp()-interval '1 second' where subscription_id=pg_temp.sid(label);
 update public.subscriptions set next_billing_at=clock_timestamp()-interval '1 second' where id=pg_temp.sid(label);
 set local role service_role;
 d:=pg_temp.claim(label);
 if d->>'dispatch'<>'true' then raise exception 'FIXTURE_RETRY_NOT_CLAIMED'; end if;
 perform public.renewal_record_outcome(pg_temp.aid(label),pg_temp.lease(label),'failed',gen_random_uuid(),true);
 reset role;
end$$;
select lives_ok($$select pg_temp.fail_retry('exhausted')$$,'approved first retry is available');
select lives_ok($$select pg_temp.fail_retry('exhausted')$$,'approved second retry is available');
select lives_ok($$select pg_temp.fail_retry('exhausted')$$,'approved third retry is available');
select is((select max(ordinal) from private.payment_attempts where obligation_id=(select id from private.billing_obligations where subscription_id=pg_temp.sid('exhausted'))),4,
 'max_retries means original plus exactly three retries');
select is((select next_billing_at from public.subscriptions where id=pg_temp.sid('exhausted')),null::timestamptz,'retry exhaustion clears future schedule');
set local role service_role;
select is(pg_temp.claim('exhausted')->>'dispatch','false','a fifth charge attempt is not authorized');
reset role;
select pg_temp.make_case('stale');
update public.subscriptions set episode_started_at=episode_started_at-interval '3 months',current_period_start=current_period_start-interval '3 months',
 current_period_end=current_period_end-interval '3 months',next_billing_at=next_billing_at-interval '3 months' where id=pg_temp.sid('stale');
set local role service_role;
select is(public.renewal_read(pg_temp.sid('stale'))->>'reason','PERIOD_REQUIRES_REVIEW','fully missed periods are not silently catch-up charged');
reset role;
-- Current legal consent is rechecked independently of the commercial snapshot.
delete from private.profile_policy_acceptances where user_id=pg_temp.fan() and kind='terms';
set local role service_role;
select is(public.renewal_read(pg_temp.sid('notice'))->>'reason','POLICY_NOT_APPROVED','unaccepted commercial rotation remains fail closed');
select is(public.renewal_read(pg_temp.sid('exhausted'))->>'dispatch','false','missing consent never changes terminal result into dispatch');
reset role;


insert into private.profile_policy_acceptances(user_id,kind,version,accepted_at)
 select pg_temp.fan(),kind,version,now() from private.onboarding_documents where kind='terms';
update public.subscriptions set next_billing_at=null;
update private.payment_attempts set state='unknown' where state='inflight';
update private.renewal_attempts set next_query_at=clock_timestamp()+interval '1 year';
select pg_temp.make_case('fair-1'); select pg_temp.make_case('fair-2'); select pg_temp.make_case('fair-3');
select pg_temp.make_case('fair-4'); select pg_temp.make_case('fair-5');
create temp table renewal_scans(first_page jsonb,second_page jsonb);
grant all on renewal_scans to service_role;
set local role service_role;
insert into renewal_scans(first_page) select public.renewal_candidates(4);
update renewal_scans set second_page=public.renewal_candidates(4);
select is((select jsonb_array_length(first_page) from renewal_scans),4,'first fair scan remains bounded even when all four credentials may be unavailable');
select is((select count(distinct value) from renewal_scans,jsonb_array_elements(first_page||second_page)),5::bigint,
 'unchanged unavailable prefix cannot starve fifth valid candidate across bounded scans');
reset role;
select is((select count(*) from private.billing_obligations where subscription_id in(select sid from renewal_cases where label like 'fair-%')),0::bigint,
 'technical scan cursor creates no financial obligation');
select ok(not has_table_privilege('service_role','private.renewal_scan_cursor','SELECT,INSERT,UPDATE,DELETE,TRUNCATE'),
 'fairness cursor remains private RPC-only technical state');
-- A verified result remains recordable even if current terms/eligibility change.
set local role service_role;
select is(pg_temp.claim('fair-1')->>'dispatch','true','recovery-after-policy-change fixture dispatched');
select lives_ok($$select public.renewal_record_outcome(pg_temp.aid('fair-1'),pg_temp.lease('fair-1'),'unknown',null,false)$$,'uncertain dispatched charge held');
reset role;
update private.renewal_attempts set next_query_at=clock_timestamp()-interval '1 second' where attempt_id=pg_temp.aid('fair-1');
set local role service_role;
select is(pg_temp.claim('fair-1')->>'action','reconcile','query lease exists before eventual verified recovery');
reset role;
update renewal_cases set approved_at=clock_timestamp() where label='fair-1';
update private.checkout_policy_current set policy_version='c7000000-0000-4000-8000-000000000002';
update public.profiles set is_restricted=true where id=pg_temp.fan();
set local role service_role;
select lives_ok($$select public.renewal_finalize(pg_temp.aid('fair-1'),'action-policy-recovery','payment-policy-recovery',7200,'KRW',
 (select approved_at from renewal_cases where label='fair-1'),gen_random_uuid())$$,'policy and actor change after dispatch cannot erase verified money');
select throws_ok($$select public.renewal_record_query(pg_temp.aid('fair-1'),pg_temp.lease('fair-1'))$$,
 '55000','RENEWAL_OUTCOME_CONFLICT','stale query worker cannot mutate successful recovery');
reset role;

select * from finish();
rollback;
