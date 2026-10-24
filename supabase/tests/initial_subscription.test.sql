begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();

-- Synthetic, rollback-only identities and envelopes. These strings are not
-- valid provider credentials or encrypted production data. No HTTP occurs.
select is((select count(*) from private.subscription_enrollments),0::bigint,'migration starts no enrollment');
select is((select count(*) from private.enrollment_credentials),0::bigint,'migration stores no credential');
select is((select count(*) from private.enrollment_reconciliations),0::bigint,'migration creates no financial evidence');
select ok((select bool_and(relrowsecurity) from pg_class where oid in (
 'private.subscription_enrollments'::regclass,'private.enrollment_credentials'::regclass,'private.enrollment_reconciliations'::regclass)),
 'enrollment/vault/reconciliation all use RLS');
select ok((select bool_and(not has_table_privilege(r,t,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'))
 from unnest(array['anon','authenticated','service_role']) r,
 unnest(array['private.subscription_enrollments','private.enrollment_credentials','private.enrollment_reconciliations']) t),
 'no application role has direct enrollment or vault access');
select ok((select bool_and('search_path=""'=any(proconfig)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname in ('private','public') and p.proname like 'enrollment\_%' escape '\'),'every enrollment function pins search_path');
select ok((select bool_and(not has_function_privilege(r,p.oid,'EXECUTE')) from pg_proc p join pg_namespace n on n.oid=p.pronamespace,
 unnest(array['anon','authenticated']) r where n.nspname='public' and p.proname like 'enrollment\_%' escape '\'),
 'browser roles cannot call enrollment RPCs directly');
select ok((select bool_and(has_function_privilege('service_role',p.oid,'EXECUTE')) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname like 'enrollment\_%' escape '\'),'service role has explicit RPC grants');
select ok((select bool_and(not has_function_privilege(r,p.oid,'EXECUTE')) from pg_proc p join pg_namespace n on n.oid=p.pronamespace,
 unnest(array['anon','authenticated','service_role']) r where n.nspname='private' and p.proname like 'enrollment\_%' escape '\'),
 'private enrollment helpers are not callable by application roles');
select ok(not private.enrollment_ciphertext_valid('"raw-credential"'::jsonb),'raw strings are not vault envelopes');
select ok(not private.enrollment_ciphertext_valid('[]'::jsonb),'arrays are not vault envelopes');
select ok(not private.enrollment_ciphertext_valid('{}'::jsonb),'empty envelopes rejected');
select ok(not private.enrollment_ciphertext_valid('{"version":"v1","iv":"AAAAAAAAAAAAAAAA","tag":"AAAAAAAAAAAAAAAAAAAAAA","ciphertext":"AA","raw":"secret"}'),
 'additional secret fields rejected');
select ok(not private.enrollment_ciphertext_valid('{"version":"v1","iv":"short","tag":"AAAAAAAAAAAAAAAAAAAAAA","ciphertext":"AA"}'),
 'malformed IV rejected');
select ok(not private.enrollment_ciphertext_valid('{"version":"../key","iv":"AAAAAAAAAAAAAAAA","tag":"AAAAAAAAAAAAAAAAAAAAAA","ciphertext":"AA"}'),
 'invalid key version rejected');

insert into auth.users(id,email,raw_user_meta_data) values
 ('b1000000-0000-4000-8000-000000000001','enrollment-one@example.invalid','{}'),
 ('b1000000-0000-4000-8000-000000000002','enrollment-two@example.invalid','{}');
insert into public.artists(id,slug,name,grade,status)
 select ('b2000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'enrollment-'||n,'허구 결제 검증 가수 '||n,'B','active'
 from generate_series(1,15) n;
insert into private.onboarding_documents(version,kind,title,body,approved_at,published_at) values
 ('b9000000-0000-4000-8000-000000000001','terms','Fictional terms','Rollback-only onboarding terms.',now(),now()),
 ('b9000000-0000-4000-8000-000000000002','privacy','Fictional privacy','Rollback-only onboarding privacy.',now(),now());
insert into private.profile_onboarding_policy values(true,'b8000000-0000-4000-8000-000000000001',now(),2,10,
 array['금지단어'],'b9000000-0000-4000-8000-000000000001','b9000000-0000-4000-8000-000000000002',null);
update public.profiles set font_selected_at=now(),call_name='허구구독팬',age_self_attested_at=now(),
 profile_completed_at=now(),onboarding_completed_at=now()
 where id in ('b1000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000002');
insert into private.profile_policy_acceptances(user_id,kind,version,accepted_at)
 select u,kind,version,now() from unnest(array['b1000000-0000-4000-8000-000000000001'::uuid,
 'b1000000-0000-4000-8000-000000000002'::uuid]) u, private.onboarding_documents;
insert into private.checkout_policies values
 ('b7000000-0000-4000-8000-000000000001','허구 구독 정책','실제 운영에 사용할 수 없는 결제 테스트 문서입니다.',7200,1200,now(),now()),
 ('b7000000-0000-4000-8000-000000000002','허구 변경 정책','정책 회전 검증용 테스트 문서입니다.',7300,1300,now(),now()),
 ('b7000000-0000-4000-8000-000000000003','허구 무료 정책','무료 등록은 이번 유료 첫 결제 흐름과 다릅니다.',7300,0,now(),now());
insert into private.checkout_policy_current values(true,'b7000000-0000-4000-8000-000000000001');
-- A local notification fixture establishes the existing transactional outbox
-- trigger without sending any notification or using an actual push endpoint.
insert into private.notification_policy values(true,'fixture-policy','fixture-consent',true,1,1,5,60);
insert into private.notification_preferences(user_id,webpush_enabled,billing)
 values('b1000000-0000-4000-8000-000000000001',true,true);
insert into private.push_subscriptions(user_id,endpoint,p256dh,auth,consent_version,consented_at)
 values('b1000000-0000-4000-8000-000000000001','https://push.example.invalid/enrollment-fixture',repeat('A',87),repeat('A',22),'fixture-consent',now());

create temp table enrollment_cases(label text primary key,data jsonb,lease uuid,approved_at timestamptz);
grant all on enrollment_cases to service_role;
create function pg_temp.actor() returns uuid language sql as $$select 'b1000000-0000-4000-8000-000000000001'::uuid$$;
create function pg_temp.policy() returns uuid language sql as $$select 'b7000000-0000-4000-8000-000000000001'::uuid$$;
create function pg_temp.sid(label text) returns uuid language sql as $$select (data->>'session_id')::uuid from enrollment_cases c where c.label=$1$$;
create function pg_temp.envelope() returns jsonb language sql as $$select '{"version":"fixture-v1","iv":"AAAAAAAAAAAAAAAA","tag":"AAAAAAAAAAAAAAAAAAAAAA","ciphertext":"AA"}'::jsonb$$;
create function pg_temp.make_case(label text,artist integer,provider public.payment_provider) returns jsonb
language plpgsql as $$declare sid uuid; result jsonb; begin
 select session_id into sid from public.checkout_prepare_session(pg_temp.actor(),'enrollment-'||artist,provider,'test',gen_random_uuid(),repeat('a',64),pg_temp.policy(),true);
 result:=public.enrollment_start(pg_temp.actor(),sid,repeat('a',64),repeat('b',64),repeat('c',64),'fixture-merchant');
 insert into enrollment_cases(label,data) values(label,result); return result;
end$$;
create function pg_temp.capture(label text) returns jsonb language sql as $$
 select public.enrollment_capture(pg_temp.actor(),pg_temp.sid(label),repeat('a',64),repeat('b',64),repeat('c',64),pg_temp.envelope())$$;
create function pg_temp.claim(label text,stage text,accepted boolean default false) returns jsonb language plpgsql as $$
 declare result jsonb; start_at timestamptz:=statement_timestamp(); begin
 result:=public.enrollment_claim(pg_temp.actor(),pg_temp.sid(label),repeat('a',64),repeat('b',64),stage,accepted,pg_temp.policy(),1200,
  start_at,start_at+interval '1 month');
 if (result->>'dispatch')::boolean then update enrollment_cases set lease=(result->>'lease_token')::uuid where enrollment_cases.label=$1; end if;
 return result;
 end$$;
create function pg_temp.lease(label text) returns uuid language sql as $$select lease from enrollment_cases c where c.label=$1$$;

set local role authenticated;
select throws_ok($$select public.enrollment_read(pg_temp.actor(),gen_random_uuid(),repeat('b',64))$$,'42501',null,'authenticated cannot read server-private descriptor');
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select throws_ok($$select public.enrollment_start(pg_temp.actor(),gen_random_uuid(),repeat('a',64),repeat('b',64),repeat('c',64),'fixture')$$,
 '42501',null,'forged role claim does not authorize enrollment RPC');
reset role;
select throws_ok($$select public.enrollment_start(pg_temp.actor(),gen_random_uuid(),repeat('a',64),repeat('b',64),repeat('c',64),'fixture')$$,
 '42501','BILLING_SERVICE_REQUIRED','owner SQL without actual service role cannot invoke trusted entrypoint');
set local role service_role;
select is(pg_temp.make_case('toss',1,'toss')->>'public_status','awaiting_authorization','Toss start is registration only');
select is((public.enrollment_start(pg_temp.actor(),pg_temp.sid('toss'),repeat('a',64),repeat('b',64),repeat('c',64),'fixture-merchant')->>'mandate_id'),
 (select data->>'mandate_id' from enrollment_cases where label='toss'),'repeated start retains original mandate');
select throws_ok($$select public.enrollment_start(pg_temp.actor(),pg_temp.sid('toss'),repeat('a',64),repeat('d',64),repeat('c',64),'fixture-merchant')$$,
 '42501','ENROLLMENT_BINDING_INVALID','another login session cannot adopt enrollment');
select throws_ok($$select public.enrollment_start(pg_temp.actor(),pg_temp.sid('toss'),repeat('a',64),repeat('b',64),repeat('d',64),'fixture-merchant')$$,
 '42501','ENROLLMENT_BINDING_INVALID','repeated start cannot rotate callback state');
select throws_ok($$select public.enrollment_start(pg_temp.actor(),pg_temp.sid('toss'),repeat('a',64),repeat('b',64),repeat('c',64),'changed-merchant')$$,
 '42501','ENROLLMENT_BINDING_INVALID','merchant is immutable');
select throws_ok($$select public.enrollment_read('b1000000-0000-4000-8000-000000000002',pg_temp.sid('toss'),repeat('b',64))$$,
 'P0002','ENROLLMENT_NOT_FOUND','wrong user cannot inspect enrollment');
select throws_ok($$select public.enrollment_read(pg_temp.actor(),pg_temp.sid('toss'),repeat('d',64))$$,
 'P0002','ENROLLMENT_NOT_FOUND','wrong auth session cannot inspect enrollment');
select throws_ok($$select public.enrollment_read(pg_temp.actor(),pg_temp.sid('toss'),repeat('b',64),repeat('d',64))$$,
 'P0002','ENROLLMENT_NOT_FOUND','nonce-bound action read rejects wrong nonce');
select is(public.enrollment_read(pg_temp.actor(),pg_temp.sid('toss'),repeat('b',64),repeat('a',64))->>'artist_slug','enrollment-1',
 'descriptor carries trusted artist snapshot');
select throws_ok($$select * from public.checkout_prepare_session(pg_temp.actor(),'enrollment-1','kakaopay','test',gen_random_uuid(),repeat('d',64),pg_temp.policy(),true)$$,
 '55000','CHECKOUT_SUBSCRIPTION_EXISTS','launched pending subscription prevents cross-provider fork');
select throws_ok($$select public.checkout_cancel_session(pg_temp.actor(),pg_temp.sid('toss'),repeat('a',64))$$,
 '55000','ENROLLMENT_CANNOT_CANCEL','old preparation cancellation cannot erase launched enrollment');
reset role;
select is((select count(*) from public.payment_events),0::bigint,'registration has no ledger money');
select is((select count(*) from private.payment_attempts),0::bigint,'registration has no charge attempt');
select is((select status::text from public.subscriptions where id=(select (data->>'subscription_id')::uuid from enrollment_cases where label='toss')),
 'pending','registration grants no active access');
select ok((select not is_active from private.payment_mandates where id=(select (data->>'mandate_id')::uuid from enrollment_cases where label='toss')),
 'pending mandate cannot be used before charge consent');
set local role service_role;
select throws_ok($$select public.enrollment_capture(pg_temp.actor(),pg_temp.sid('toss'),repeat('d',64),repeat('b',64),repeat('c',64),pg_temp.envelope())$$,
 '42501','ENROLLMENT_BINDING_INVALID','callback requires original nonce');
select throws_ok($$select public.enrollment_capture(pg_temp.actor(),pg_temp.sid('toss'),repeat('a',64),repeat('b',64),repeat('d',64),pg_temp.envelope())$$,
 '42501','ENROLLMENT_BINDING_INVALID','callback requires original random state digest');
select throws_ok($$select public.enrollment_capture(pg_temp.actor(),pg_temp.sid('toss'),repeat('a',64),repeat('b',64),repeat('c',64),'"raw-auth-key"')$$,
 '22023','ENROLLMENT_INVALID_INPUT','callback rejects unencrypted auth key');
select is(pg_temp.capture('toss')->>'public_status','awaiting_confirmation','callback only captures authorization and waits for explicit POST');
select is(public.enrollment_capture(pg_temp.actor(),pg_temp.sid('toss'),repeat('a',64),repeat('b',64),repeat('c',64),
 jsonb_set(pg_temp.envelope(),'{ciphertext}','"BB"'))->'callback_ciphertext',pg_temp.envelope(),'duplicate callback cannot replace first encrypted auth code');
select throws_ok($$select pg_temp.claim('toss','charge',true)$$,'55000','ENROLLMENT_NOT_READY','charge cannot precede billing-key exchange');
select is(pg_temp.claim('toss','exchange')->>'dispatch','true','one exchange claim receives dispatch lease');
select is(pg_temp.claim('toss','exchange')->>'dispatch','false','duplicate exchange receives no permission');
select throws_ok($$select public.enrollment_record_credential(pg_temp.actor(),pg_temp.sid('toss'),gen_random_uuid(),pg_temp.envelope())$$,
 '55000','ENROLLMENT_OUTCOME_CONFLICT','wrong lease cannot store credential');
select throws_ok($$select public.enrollment_cancel(pg_temp.actor(),pg_temp.sid('toss'),repeat('a',64),repeat('b',64))$$,
 '55000','ENROLLMENT_CANNOT_CANCEL','dismissal cannot erase an in-flight exchange');
select is(public.enrollment_record_credential(pg_temp.actor(),pg_temp.sid('toss'),pg_temp.lease('toss'),pg_temp.envelope())->>'public_status',
 'awaiting_confirmation','credential registration still grants no paid access');
select is(public.enrollment_read(pg_temp.actor(),pg_temp.sid('toss'),repeat('b',64))->'callback_ciphertext','null'::jsonb,'exchanged auth code cleared');
select is(pg_temp.claim('toss','exchange')->>'dispatch','false','stored credential prevents a second exchange');
select throws_ok($$select pg_temp.claim('toss','charge',false)$$,'22023','CHECKOUT_CONSENT_REQUIRED','preparation and registration consent cannot authorize money');
select throws_ok($$select public.enrollment_claim(pg_temp.actor(),pg_temp.sid('toss'),repeat('a',64),repeat('b',64),'charge',true,pg_temp.policy(),1,clock_timestamp(),clock_timestamp()+interval '1 month')$$,
 '55000','CHECKOUT_POLICY_CHANGED','charge amount cannot be substituted');
select throws_ok($$select public.enrollment_claim(pg_temp.actor(),pg_temp.sid('toss'),repeat('a',64),repeat('b',64),'charge',true,gen_random_uuid(),1200,clock_timestamp(),clock_timestamp()+interval '1 month')$$,
 '55000','CHECKOUT_POLICY_CHANGED','charge requires exact policy version');
select throws_ok($$select public.enrollment_claim(pg_temp.actor(),pg_temp.sid('toss'),repeat('a',64),repeat('b',64),'charge',true,pg_temp.policy(),1200,now(),now()+interval '1 day')$$,
 '22023','ENROLLMENT_INVALID_PERIOD','arbitrary entitlement interval rejected');
select is(pg_temp.claim('toss','charge',true)->>'dispatch','true','explicit consent permits exactly one first-charge dispatch');
select is(pg_temp.claim('toss','charge',true)->>'dispatch','false','double confirm cannot claim a new order or changed period');
reset role;
select is((select count(*) from private.payment_attempts),1::bigint,'single first-payment attempt persisted');
select ok((select e.attempt_id=c.order_id from private.subscription_enrollments e join private.checkout_sessions c on c.id=e.session_id
 where e.session_id=pg_temp.sid('toss')),'attempt identity equals immutable checkout/provider order');
select is((select count(*) from public.payment_events),0::bigint,'dispatch is not recognized revenue');
select ok((select charge_consented_at is not null from private.subscription_enrollments where session_id=pg_temp.sid('toss')),'charge consent durably recorded');
update enrollment_cases set approved_at=clock_timestamp() where label='toss';
set local role service_role;
select throws_ok($$select public.enrollment_finalize(pg_temp.actor(),pg_temp.sid('toss'),'action-fixture','payment-fixture',1199,'KRW',
 (select approved_at from enrollment_cases where label='toss'),gen_random_uuid(),null)$$,'23514','VERIFIED_RESULT_MISMATCH','wrong verified amount rolls back finalization');
select is(public.enrollment_finalize(pg_temp.actor(),pg_temp.sid('toss'),'action-fixture','payment-fixture',1200,'KRW',
 (select approved_at from enrollment_cases where label='toss'),gen_random_uuid(),null)->>'public_status','succeeded','verified first charge finalizes');
select is(public.enrollment_finalize(pg_temp.actor(),pg_temp.sid('toss'),'action-fixture','payment-fixture',1200,'KRW',
 (select approved_at from enrollment_cases where label='toss'),gen_random_uuid(),null)->>'public_status','succeeded','verified duplicate finalization is idempotent');
select throws_ok($$select public.enrollment_finalize(pg_temp.actor(),pg_temp.sid('toss'),'action-fixture','changed-payment',1200,'KRW',
 (select approved_at from enrollment_cases where label='toss'),gen_random_uuid(),null)$$,'55000','ENROLLMENT_OUTCOME_CONFLICT','duplicate cannot replace payment identity');
select is(pg_temp.claim('toss','charge',true)->>'dispatch','false','completed enrollment never recharges');
reset role;
select is((select count(*) from public.payment_events),1::bigint,'exactly one ledger event');
select is((select count(*) from private.payment_event_verifications),1::bigint,'exactly one private verification');
select is((select count(*) from private.notification_jobs where source_kind='payment'),1::bigint,'verified payment atomically creates one notification outbox job');
select is((select status::text from public.subscriptions where id=(select (data->>'subscription_id')::uuid from enrollment_cases where label='toss')),
 'active','verified charge alone activates subscription');
select ok((select intro_redeemed_at is not null from public.subscriptions where id=(select (data->>'subscription_id')::uuid from enrollment_cases where label='toss')),
 'successful introductory purchase permanently redeems artist-specific eligibility');

-- Kakao ready -> captured authorization -> approve includes first charge and
-- SID. There is never a follow-up subscription charge in this flow.
set local role service_role;
select is(pg_temp.make_case('kakao',2,'kakaopay')->>'state','ready','Kakao creates undispatched ready state');
select throws_ok($$select pg_temp.capture('kakao')$$,'55000','CHECKOUT_SESSION_REPLAY','Kakao callback rejected before durable TID');
select is(pg_temp.claim('kakao','ready')->>'dispatch','true','ready has one durable dispatch');
select is(pg_temp.claim('kakao','ready')->>'dispatch','false','ready is not repeated after duplicate start');
select is(public.enrollment_record_ready(pg_temp.actor(),pg_temp.sid('kakao'),pg_temp.lease('kakao'),'TID_FIXTURE',pg_temp.envelope())->>'public_status',
 'awaiting_authorization','ready TID and encrypted redirects persist before handoff');
select is(pg_temp.capture('kakao')->>'public_status','awaiting_confirmation','Kakao authorization still is not a settled charge');
select throws_ok($$select pg_temp.claim('kakao','approve',false)$$,'22023','CHECKOUT_CONSENT_REQUIRED','Kakao approve requires new explicit charge consent');
select is(pg_temp.claim('kakao','approve',true)->>'dispatch','true','approve claims the initial payment once');
select is(pg_temp.claim('kakao','approve',true)->>'dispatch','false','duplicate approve cannot replay provider operation');
update enrollment_cases set approved_at=clock_timestamp() where label='kakao';
select throws_ok($$select public.enrollment_finalize(pg_temp.actor(),pg_temp.sid('kakao'),'AID_FIXTURE','WRONG_TID',1200,'KRW',
 (select approved_at from enrollment_cases where label='kakao'),gen_random_uuid(),pg_temp.envelope())$$,'55000','ENROLLMENT_OUTCOME_CONFLICT','Kakao finalization must use stored TID');
select throws_ok($$select public.enrollment_finalize(pg_temp.actor(),pg_temp.sid('kakao'),'AID_FIXTURE','TID_FIXTURE',1200,'KRW',
 (select approved_at from enrollment_cases where label='kakao'),gen_random_uuid(),null)$$,'55000','ENROLLMENT_CREDENTIAL_REQUIRED','approved money alone cannot fabricate missing SID');
select is(public.enrollment_finalize(pg_temp.actor(),pg_temp.sid('kakao'),'AID_FIXTURE','TID_FIXTURE',1200,'KRW',
 (select approved_at from enrollment_cases where label='kakao'),gen_random_uuid(),pg_temp.envelope())->>'public_status','succeeded','charged approve plus SID finalizes directly');
reset role;
select is((select count(*) from private.payment_attempts where obligation_id=(select obligation_id from private.subscription_enrollments where session_id=pg_temp.sid('kakao'))),
 1::bigint,'Kakao first charge has no extra subscription attempt');
select is((select count(*) from public.payment_events),2::bigint,'two independent artists each have one first payment');
select is((select count(*) from private.notification_jobs where source_kind='payment'),2::bigint,'both confirmed payments queued atomically');

-- Unknown approve with known TID can be queried but not retried. The documented
-- order query lacks SID, so normalized evidence remains an explicit review gate.
set local role service_role;
select pg_temp.make_case('unknown',3,'kakaopay');
select pg_temp.claim('unknown','ready');
select public.enrollment_record_ready(pg_temp.actor(),pg_temp.sid('unknown'),pg_temp.lease('unknown'),'TID_UNKNOWN',pg_temp.envelope());
select pg_temp.capture('unknown');
select pg_temp.claim('unknown','approve',true);
select is(public.enrollment_record_outcome(pg_temp.actor(),pg_temp.sid('unknown'),pg_temp.lease('unknown'),'unknown',null)->>'public_status','unknown','response loss preserves uncertainty');
select is(pg_temp.claim('unknown','approve',true)->>'dispatch','false','unknown approve never receives another dispatch lease');
select throws_ok($$select public.enrollment_cancel(pg_temp.actor(),pg_temp.sid('unknown'),repeat('a',64),repeat('b',64))$$,
 '55000','ENROLLMENT_CANNOT_CANCEL','unknown charge cannot be dismissed into cancel/retry');
update enrollment_cases set approved_at=clock_timestamp() where label='unknown';
select is(public.enrollment_record_reconciliation(pg_temp.actor(),pg_temp.sid('unknown'),'AID_UNKNOWN','TID_UNKNOWN',1200,'KRW',
 (select approved_at from enrollment_cases where label='unknown'),gen_random_uuid())->>'public_status','manual_review','verified order without SID needs manual credential reconciliation');
select is(public.enrollment_record_reconciliation(pg_temp.actor(),pg_temp.sid('unknown'),'AID_UNKNOWN','TID_UNKNOWN',1200,'KRW',
 (select approved_at from enrollment_cases where label='unknown'),gen_random_uuid())->>'public_status','manual_review','same normalized recovery is idempotent');
select is(pg_temp.claim('unknown','approve',true)->>'dispatch','false','manual-review operation never reapproves');
reset role;
select is((select count(*) from private.enrollment_reconciliations),1::bigint,'one bounded recovery evidence record');
select is((select count(*) from public.payment_events),2::bigint,'missing credential does not fabricate paid entitlement/ledger completion');
update private.checkout_sessions set expires_at=clock_timestamp()-interval '59 minutes',created_at=clock_timestamp()-interval '1 hour'
 where id=pg_temp.sid('unknown');
set local role service_role;
select is(public.enrollment_read(pg_temp.actor(),pg_temp.sid('unknown'),repeat('b',64))->>'public_status','manual_review','unknown persists beyond checkout TTL');
select throws_ok($$select * from public.checkout_prepare_session(pg_temp.actor(),'enrollment-3','toss','test',gen_random_uuid(),repeat('d',64),pg_temp.policy(),true)$$,
 '55000','CHECKOUT_SUBSCRIPTION_EXISTS','expired unknown checkout still blocks another provider');

-- A lost ready response has no recoverable TID and is never automatically retried.
select pg_temp.make_case('ready-lost',4,'kakaopay');
select pg_temp.claim('ready-lost','ready');
select is(public.enrollment_record_outcome(pg_temp.actor(),pg_temp.sid('ready-lost'),pg_temp.lease('ready-lost'),'unknown',null)->>'public_status',
 'manual_review','lost ready response is a TID-less manual-review gate');
select is(pg_temp.claim('ready-lost','ready')->>'dispatch','false','TID-less ready loss never auto-retries');

-- Expired leases become unknown, and GET projection itself performs no write.
select pg_temp.make_case('lease-lost',5,'toss'); select pg_temp.capture('lease-lost'); select pg_temp.claim('lease-lost','exchange');
reset role;
update private.subscription_enrollments set lease_expires_at=clock_timestamp()-interval '1 second' where session_id=pg_temp.sid('lease-lost');
set local role service_role;
select is(public.enrollment_read(pg_temp.actor(),pg_temp.sid('lease-lost'),repeat('b',64))->>'public_status','manual_review','expired exchange lease projects uncertainty');
reset role;
select is((select state from private.subscription_enrollments where session_id=pg_temp.sid('lease-lost')),'processing','GET uncertainty projection does not mutate');
set local role service_role;
select is(pg_temp.claim('lease-lost','exchange')->>'dispatch','false','expired exchange lease is never reclaimed');

-- Explicit cancellation before any money clears callback capability but does
-- not pretend to revoke credentials at a provider or erase financial history.
select pg_temp.make_case('cancel',6,'toss'); select pg_temp.capture('cancel');
select is(public.enrollment_cancel(pg_temp.actor(),pg_temp.sid('cancel'),repeat('a',64),repeat('b',64))->>'public_status','canceled','authorized idle enrollment can be canceled');
select is(public.enrollment_cancel(pg_temp.actor(),pg_temp.sid('cancel'),repeat('a',64),repeat('b',64))->>'public_status','canceled','cancel replay is harmless');
select is(public.enrollment_read(pg_temp.actor(),pg_temp.sid('cancel'),repeat('b',64))->'callback_ciphertext','null'::jsonb,'cancellation clears captured token');
select throws_ok($$select pg_temp.capture('cancel')$$,'55000','CHECKOUT_SESSION_REPLAY','callback cannot resurrect canceled checkout');
select is(pg_temp.claim('cancel','charge',true)->>'dispatch','false','canceled enrollment never claims charge');

-- A definitive rejection releases pending identity without recording revenue.
select pg_temp.make_case('failed',7,'kakaopay'); select pg_temp.claim('failed','ready');
select throws_ok($$select public.enrollment_record_outcome(pg_temp.actor(),pg_temp.sid('failed'),pg_temp.lease('failed'),'failed',null)$$,
 '22023','ENROLLMENT_INVALID_INPUT','failure needs provider rejection evidence');
select is(public.enrollment_record_outcome(pg_temp.actor(),pg_temp.sid('failed'),pg_temp.lease('failed'),'failed',gen_random_uuid())->>'public_status','failed','definitive rejection is separate from unknown');
reset role;
select is((select status::text from public.subscriptions where id=(select (data->>'subscription_id')::uuid from enrollment_cases where label='failed')),
 'canceled','definitive no-payment failure releases pending subscription');
select is((select count(*) from public.payment_events),2::bigint,'failure and uncertainty create no presumed revenue');

-- Policy rotation, profile restriction and expired captured authorization all
-- stop dispatch even when preparation/registration happened earlier.
set local role service_role;
select pg_temp.make_case('policy',8,'toss'); select pg_temp.capture('policy');
reset role;
update private.checkout_policy_current set policy_version='b7000000-0000-4000-8000-000000000002';
set local role service_role;
select throws_ok($$select pg_temp.claim('policy','exchange')$$,'55000','CHECKOUT_POLICY_CHANGED','policy rotation invalidates uncharged authorization');
select throws_ok($$select pg_temp.capture('policy')$$,'55000','CHECKOUT_POLICY_CHANGED','stale callback policy is denied');
select is(public.enrollment_read(pg_temp.actor(),pg_temp.sid('policy'),repeat('b',64))->>'public_status','awaiting_confirmation','owner can still inspect and cancel stale-policy status');
reset role;
update private.checkout_policy_current set policy_version=pg_temp.policy();
update public.profiles set is_restricted=true where id=pg_temp.actor();
set local role service_role;
select throws_ok($$select pg_temp.claim('policy','exchange')$$,'42501','DISCOVERY_FORBIDDEN','restricted actor cannot dispatch');
select is(public.enrollment_cancel(pg_temp.actor(),pg_temp.sid('policy'),repeat('a',64),repeat('b',64))->>'public_status','canceled','restriction does not prevent safe idle cancellation');
reset role;
update public.profiles set is_restricted=false where id=pg_temp.actor();
set local role service_role;
select pg_temp.make_case('auth-expired',9,'toss'); select pg_temp.capture('auth-expired');
reset role;
update private.subscription_enrollments set callback_expires_at=clock_timestamp()-interval '1 second' where session_id=pg_temp.sid('auth-expired');
set local role service_role;
select is(public.enrollment_read(pg_temp.actor(),pg_temp.sid('auth-expired'),repeat('b',64))->>'public_status','expired','expired authorization cannot appear confirmable');
select is(public.enrollment_read(pg_temp.actor(),pg_temp.sid('auth-expired'),repeat('b',64))->'callback_ciphertext','null'::jsonb,'expired callback is never returned by private read');
select throws_ok($$select pg_temp.claim('auth-expired','exchange')$$,'55000','ENROLLMENT_AUTHORIZATION_EXPIRED','expired authorization cannot be exchanged');
reset role;
update private.checkout_policy_current set policy_version='b7000000-0000-4000-8000-000000000003';
set local role service_role;
select throws_ok($$select public.enrollment_start(pg_temp.actor(),
 (select session_id from public.checkout_prepare_session(pg_temp.actor(),'enrollment-10','toss','test',gen_random_uuid(),repeat('a',64),
 'b7000000-0000-4000-8000-000000000003',true)),repeat('a',64),repeat('b',64),repeat('c',64),'fixture-merchant')$$,
 '55000','CHECKOUT_SETUP_NOT_READY','zero-price intro is not silently turned into a paid charge');
reset role;
update private.checkout_policy_current set policy_version=pg_temp.policy();
-- A successful old checkout must not prevent a later paid episode. Only owner
-- fixture time movement simulates the already-ended period; no ledger is edited.
update private.checkout_sessions set created_at=clock_timestamp()-interval '2 months',
 expires_at=clock_timestamp()-interval '2 months'+interval '15 minutes' where id=pg_temp.sid('toss');
update public.subscriptions set status='canceled',canceled_at=clock_timestamp(),next_billing_at=null,
 current_period_start=clock_timestamp()-interval '2 months',current_period_end=clock_timestamp()-interval '1 month'
 where id=(select (data->>'subscription_id')::uuid from enrollment_cases where label='toss');
set local role service_role;
insert into enrollment_cases(label,data)
 select 'returning',to_jsonb(x) from public.checkout_prepare_session(pg_temp.actor(),'enrollment-1','toss','test',gen_random_uuid(),repeat('a',64),pg_temp.policy(),true) x;
select is((select (data->>'initial_price_krw')::integer from enrollment_cases where label='returning'),7200,'returning to same artist pays regular price');
select is((select data->>'intro_eligible' from enrollment_cases where label='returning'),'false','old introductory eligibility is never restored');
select is(public.enrollment_start(pg_temp.actor(),pg_temp.sid('returning'),repeat('a',64),repeat('b',64),repeat('c',64),'fixture-merchant')->>'subscription_id',
 (select data->>'subscription_id' from enrollment_cases where label='toss'),'resubscription preserves lifetime subscription identity');
reset role;
select is((select status from private.checkout_sessions where id=pg_temp.sid('toss')),'expired','succeeded historical checkout can safely expire');
select ok((select intro_redeemed_at is not null from public.subscriptions where id=(select (data->>'subscription_id')::uuid from enrollment_cases where label='toss')),
 'reopened pending subscription retains introductory redemption');
set local role service_role;
select is(public.enrollment_abandon_expired(pg_temp.actor(),'enrollment-1'),false,'fresh idle registration is not abandoned');
select is(public.enrollment_abandon_expired(pg_temp.actor(),'enrollment-3'),false,'expired manual-review money cannot be abandoned');
select is(public.enrollment_abandon_expired(pg_temp.actor(),'enrollment-4'),false,'TID-less ready uncertainty cannot be abandoned');
select is(public.enrollment_abandon_expired(pg_temp.actor(),'enrollment-5'),false,'expired exchange uncertainty cannot be abandoned');
select is(public.enrollment_abandon_expired(pg_temp.actor(),'enrollment-9'),true,'expired never-charged authorization can be safely abandoned without old session nonce');
select is(public.enrollment_abandon_expired(pg_temp.actor(),'enrollment-9'),false,'abandon replay is harmless');
select pg_temp.make_case('idle-expired',11,'toss');
reset role;
update private.checkout_sessions set created_at=clock_timestamp()-interval '1 hour',expires_at=clock_timestamp()-interval '59 minutes'
 where id=pg_temp.sid('idle-expired');
set local role service_role;
select is(public.enrollment_abandon_expired('b1000000-0000-4000-8000-000000000002','enrollment-11'),false,'another actor cannot abandon owner registration');
select is(public.enrollment_abandon_expired(pg_temp.actor(),'enrollment-11'),true,'expired idle checkout can be abandoned after nonce/session loss');
select lives_ok($$select * from public.checkout_prepare_session(pg_temp.actor(),'enrollment-11','kakaopay','test',gen_random_uuid(),repeat('d',64),pg_temp.policy(),true)$$,
 'safe abandonment permits a new explicitly prepared provider flow');
reset role;
select is((select state from private.subscription_enrollments where session_id=pg_temp.sid('idle-expired')),'canceled','abandonment is auditable, not deletion');
select is((select count(*) from public.payment_events),2::bigint,'abandonment and resubscription do not create money');
reset role;
-- Expired charge leases are unknown, not safe-to-retry failures. A later
-- verified response recovers the existing attempt even after browser expiry.
set local role service_role;
select pg_temp.make_case('charge-expired',12,'toss'); select pg_temp.capture('charge-expired'); select pg_temp.claim('charge-expired','exchange');
select public.enrollment_record_credential(pg_temp.actor(),pg_temp.sid('charge-expired'),pg_temp.lease('charge-expired'),pg_temp.envelope());
select pg_temp.claim('charge-expired','charge',true);
update enrollment_cases set approved_at=clock_timestamp() where label='charge-expired';
reset role;
update private.subscription_enrollments set lease_expires_at=clock_timestamp()-interval '1 second' where session_id=pg_temp.sid('charge-expired');
update private.checkout_sessions set created_at=clock_timestamp()-interval '1 hour',expires_at=clock_timestamp()-interval '59 minutes'
 where id=pg_temp.sid('charge-expired');
set local role service_role;
select is(public.enrollment_read(pg_temp.actor(),pg_temp.sid('charge-expired'),repeat('b',64))->>'public_status','unknown','expired financial lease stays unknown even after browser TTL');
select is(pg_temp.claim('charge-expired','charge',true)->>'dispatch','false','expired financial claim never obtains new dispatch');
select is(public.enrollment_finalize(pg_temp.actor(),pg_temp.sid('charge-expired'),'ACTION_LATE','PAYMENT_LATE',1200,'KRW',
 (select approved_at from enrollment_cases where label='charge-expired'),gen_random_uuid(),null)->>'public_status','succeeded',
 'verified old charge reconciles same attempt after session expiry');
reset role;
select is((select count(*) from public.payment_events),3::bigint,'unknown recovery adds exactly the verified original payment');

-- Force only the local outbox insert to fail. The exact same verified response
-- can be persisted again, with no second provider call and no partial ledger,
-- credential, entitlement or outbox commit from the failed transaction.
set local role service_role;
select pg_temp.make_case('atomic-failure',13,'kakaopay'); select pg_temp.claim('atomic-failure','ready');
select public.enrollment_record_ready(pg_temp.actor(),pg_temp.sid('atomic-failure'),pg_temp.lease('atomic-failure'),'TID_ATOMIC',pg_temp.envelope());
select pg_temp.capture('atomic-failure'); select pg_temp.claim('atomic-failure','approve',true);
update enrollment_cases set approved_at=clock_timestamp() where label='atomic-failure';
reset role;
create function pg_temp.reject_outbox() returns trigger language plpgsql as $$begin
 raise exception 'FIXTURE_OUTBOX_UNAVAILABLE' using errcode='P0001'; end$$;
create trigger enrollment_fixture_outbox_failure before insert on private.notification_jobs for each row execute function pg_temp.reject_outbox();
set local role service_role;
select throws_ok($$select public.enrollment_finalize(pg_temp.actor(),pg_temp.sid('atomic-failure'),'AID_ATOMIC','TID_ATOMIC',1200,'KRW',
 (select approved_at from enrollment_cases where label='atomic-failure'),gen_random_uuid(),pg_temp.envelope())$$,
 'P0001','FIXTURE_OUTBOX_UNAVAILABLE','outbox failure rolls back whole payment finalization');
reset role;
select is((select count(*) from public.payment_events),3::bigint,'failed finalization leaves no partial ledger');
select is((select count(*) from private.enrollment_credentials where id=(select (data->>'credential_ref')::uuid from enrollment_cases where label='atomic-failure')),
 0::bigint,'failed finalization leaves no partial SID vault insert');
select is((select status::text from public.subscriptions where id=(select (data->>'subscription_id')::uuid from enrollment_cases where label='atomic-failure')),
 'pending','failed finalization grants no partial entitlement');
select is((select count(*) from private.notification_jobs where source_kind='payment'),3::bigint,'failed outbox insert leaves only previous successful jobs');
drop trigger enrollment_fixture_outbox_failure on private.notification_jobs;
set local role service_role;
select is(public.enrollment_finalize(pg_temp.actor(),pg_temp.sid('atomic-failure'),'AID_ATOMIC','TID_ATOMIC',1200,'KRW',
 (select approved_at from enrollment_cases where label='atomic-failure'),gen_random_uuid(),pg_temp.envelope())->>'public_status','succeeded',
 'retrying persistence of same verified provider response recovers atomically');
select is(public.enrollment_finalize(pg_temp.actor(),pg_temp.sid('atomic-failure'),'AID_ATOMIC','TID_ATOMIC',1200,'KRW',
 (select approved_at from enrollment_cases where label='atomic-failure'),gen_random_uuid(),pg_temp.envelope())->>'public_status','succeeded',
 'recovered result still deduplicates');
reset role;
select is((select count(*) from public.payment_events),4::bigint,'recovered persistence records one payment only');
select is((select count(*) from private.notification_jobs where source_kind='payment'),4::bigint,'recovered persistence queues one job only');
select ok(not exists(select 1 from information_schema.columns where table_schema='public'
 and table_name in ('subscriptions','payment_events') and column_name in ('sid','billing_key','auth_key','pg_token','ciphertext','credential_ref','provider_tid')),
 'fan-readable tables contain no credential or encrypted vault columns');
select * from finish();
rollback;
