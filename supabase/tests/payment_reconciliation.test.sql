begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();

-- Entirely fictional, transaction-rolled-back identities and monetary fixtures.
insert into auth.users(id,email,raw_user_meta_data) values
 ('d9000000-0000-4000-8000-000000000001','reconcile-owner@example.invalid','{}'),
 ('d9000000-0000-4000-8000-000000000002','reconcile-admin@example.invalid','{}'),
 ('d9000000-0000-4000-8000-000000000003','reconcile-other@example.invalid','{}');
update public.profiles set role='admin' where id='d9000000-0000-4000-8000-000000000002';
insert into private.checkout_policies(version,title,body,regular_price_krw,intro_price_krw,approved_at,published_at,billing_period_calendar,payment_tax_basis)
 values('d9100000-0000-4000-8000-000000000001','Fictional checkout','Disposable query-only test policy',1000,1000,now(),now(),'utc_monthly_clamped','taxable_krw');
insert into private.refund_policies values('d9200000-0000-4000-8000-000000000001','Fictional refund','Disposable query-only approval','preserve_paid_access','taxable_krw',now(),now());
create temp table reconciliation_fixtures(label text primary key,kind text,sid uuid,attempt uuid,session uuid,request uuid,original_event uuid,case_id uuid,token uuid);
grant all on reconciliation_fixtures to service_role,authenticated;
create function pg_temp.make_reconciliation(label text,kind text default 'renewal',provider public.payment_provider default 'toss',known_id boolean default true,credential boolean default true) returns uuid language plpgsql as $$
declare sid uuid:=gen_random_uuid(); artist uuid:=gen_random_uuid(); mid uuid:=gen_random_uuid(); oid uuid:=gen_random_uuid(); attempt uuid:=gen_random_uuid(); session uuid:=gen_random_uuid(); customer uuid:=gen_random_uuid(); ref uuid:=gen_random_uuid(); event uuid; request uuid; token uuid:=gen_random_uuid();
begin
 insert into public.artists(id,slug,name,grade,status) values(artist,'reconciliation-'||artist,'Fictional reconciliation artist','B','active');
 insert into public.subscriptions(id,user_id,artist_id,provider,status,first_started_at,episode_started_at,current_period_start,current_period_end,next_billing_at)
 values(sid,'d9000000-0000-4000-8000-000000000001',artist,provider,case when kind='initial' then 'pending'::public.subscription_status else 'active'::public.subscription_status end,
 now()-interval '1 month',now()-interval '1 month',now()-interval '1 day',now()+interval '29 days',now()+interval '29 days');
 insert into private.payment_mandates(id,subscription_id,provider,environment,merchant_account,provider_customer_ref,secure_credential_ref,consent_version)
 values(mid,sid,provider,'test','reconciliation-fixture',customer,ref,'d9100000-0000-4000-8000-000000000001');
 insert into private.billing_obligations(id,subscription_id,mandate_id,period_start,period_end,amount_krw,is_initial,is_intro,price_version,grace_seconds,retry_seconds,max_retries,state,next_attempt_at)
 values(oid,sid,mid,now()-interval '1 hour',now()+interval '30 days',1000,kind='initial',false,'d9100000-0000-4000-8000-000000000001',0,1,0,case when kind='refund' then 'settled' else 'open' end,now());
 insert into private.payment_attempts(id,obligation_id,ordinal,state,lease_token,lease_expires_at,created_at)
 values(attempt,oid,1,case when kind='refund' then 'success'::private.payment_attempt_state else 'unknown'::private.payment_attempt_state end,token,now()-interval '1 minute',now()-interval '1 hour');
 if kind='initial' then
   insert into private.checkout_sessions(id,user_id,artist_id,provider,environment,idempotency_key,nonce_hash,policy_version,initial_price_krw,regular_price_krw,intro_eligible,customer_ref,order_id,created_at,expires_at)
   values(session,'d9000000-0000-4000-8000-000000000001',artist,provider,'test',gen_random_uuid(),repeat('a',64),'d9100000-0000-4000-8000-000000000001',1000,1000,false,customer,attempt,now()-interval '1 hour',now()-interval '30 minutes');
   insert into private.subscription_enrollments(session_id,user_id,artist_id,subscription_id,mandate_id,credential_ref,auth_session_hash,callback_state_hash,state,stage,lease_token,lease_expires_at,provider_tid,charge_consented_at,obligation_id,attempt_id,created_at)
   values(session,'d9000000-0000-4000-8000-000000000001',artist,sid,mid,ref,repeat('b',64),repeat('c',64),'unknown',case when provider='toss' then 'charge' else 'approve' end,token,now()-interval '1 minute',case when provider='kakaopay' and known_id then 'PAYMENT_'||attempt end,now()-interval '1 hour',oid,attempt,now()-interval '1 hour');
   if credential then insert into private.enrollment_credentials(id,mandate_id,ciphertext) values(ref,mid,'{"version":"fixture","iv":"AAAAAAAAAAAAAAAA","tag":"AAAAAAAAAAAAAAAAAAAAAA","ciphertext":"AA"}'); end if;
 else
   insert into private.renewal_attempts(attempt_id,provider_payment_id,next_query_at) values(attempt,case when known_id then 'PAYMENT_'||attempt end,now()-interval '1 second');
 end if;
 if kind='refund' then
   event:=gen_random_uuid(); request:=gen_random_uuid();
   insert into public.payment_events(id,subscription_id,kind,amount_krw,provider,period_start,period_end,occurred_at)
   values(event,sid,'charge',1000,provider,now()-interval '1 hour',now()+interval '30 days',now()-interval '50 minutes');
   insert into private.payment_event_verifications(event_id,attempt_id,provider,environment,merchant_account,provider_action_id,evidence_ref)
   values(event,attempt,provider,'test','reconciliation-fixture','CHARGE_'||attempt,gen_random_uuid());
   insert into private.refund_requests(id,user_id,subscription_id,original_event_id,idempotency_key,amount_krw,reason,state,policy_version,authorized_by,decision_reason,decided_at,refunded_before_krw,lease_token,lease_expires_at,next_query_at)
   values(request,'d9000000-0000-4000-8000-000000000001',sid,event,gen_random_uuid(),600,'Fictional authorized refund','unknown','d9200000-0000-4000-8000-000000000001','d9000000-0000-4000-8000-000000000002','Fictional decision',now()-interval '40 minutes',0,token,now()-interval '1 minute',now()-interval '1 second');
 end if;
 insert into reconciliation_fixtures(label,kind,sid,attempt,session,request,original_event) values(label,kind,sid,attempt,case when kind='initial' then session end,request,event);
 return sid;
end;$$;
create function pg_temp.cid(text) returns uuid language sql as $$select case_id from reconciliation_fixtures where label=$1$$;
create function pg_temp.claim_reconciliation(text) returns jsonb language plpgsql as $$declare data jsonb; begin
 data:=public.reconciliation_claim(pg_temp.cid($1),120);
 if (data->>'dispatch')::boolean then update reconciliation_fixtures set token=(data->>'lease_token')::uuid where label=$1; end if;
 return data;
end;$$;
create function pg_temp.complete_reconciliation(text,amount integer default null,action text default null) returns jsonb language plpgsql as $$declare f reconciliation_fixtures%rowtype; begin
 select * into strict f from reconciliation_fixtures where label=$1;
 return public.reconciliation_complete(f.case_id,f.token,coalesce(action,'ACTION_'||f.label),'PAYMENT_'||f.attempt,
 coalesce(amount,case when f.kind='refund' then 600 else 1000 end),'KRW',date_trunc('second',now()-interval '10 minutes'),gen_random_uuid());
end;$$;
create function pg_temp.receive_reconciliation(text,status text default 'DONE',payment text default null,amount integer default 1000,merchant text default 'reconciliation-fixture',environment text default 'test',digest text default repeat('a',64)) returns jsonb language sql as $$
 select public.reconciliation_receive_toss(environment,merchant,f.attempt,coalesce(payment,'PAYMENT_'||f.attempt),status,amount,digest) from reconciliation_fixtures f where f.label=$1;
$$;

select pg_temp.make_reconciliation('renewal');
select pg_temp.make_reconciliation('initial','initial');
select pg_temp.make_reconciliation('kakao-initial','initial','kakaopay',true,false);
select pg_temp.make_reconciliation('kakao-missing','renewal','kakaopay',false);
select pg_temp.make_reconciliation('kakao-known','renewal','kakaopay');
select pg_temp.make_reconciliation('refund','refund');
select pg_temp.make_reconciliation('budget');
select pg_temp.make_reconciliation('expired');
select pg_temp.make_reconciliation('canceled');
select pg_temp.make_reconciliation('other-worker');
update private.payment_attempts set state='inflight' where id=(select attempt from reconciliation_fixtures where label='expired');
update public.subscriptions set status='canceled',canceled_at=now(),next_billing_at=null where id=(select sid from reconciliation_fixtures where label='canceled');
select is((select count(*) from private.payment_reconciliation_cases),0::bigint,'migration seeds no operation or query');
select is((select count(*) from private.payment_provider_inbox),0::bigint,'migration seeds no provider event');
select ok(not has_table_privilege('authenticated','private.payment_provider_inbox','SELECT'),'inbox never fan-readable');
select ok(not has_table_privilege('service_role','private.payment_provider_inbox','INSERT'),'service cannot bypass normalized receipt RPC');
select ok(not has_table_privilege('authenticated','private.payment_reconciliation_cases','SELECT'),'private cases never raw admin-readable');
select ok(not has_table_privilege('service_role','private.payment_reconciliation_cases','UPDATE'),'service cannot reset budgets directly');
select ok((select relrowsecurity from pg_class where oid='private.payment_provider_inbox'::regclass),'inbox RLS enabled');
select ok((select relrowsecurity from pg_class where oid='private.payment_reconciliation_cases'::regclass),'case RLS enabled');
select ok(not has_function_privilege('anon','public.reconciliation_receive_toss(text,text,uuid,text,text,integer,text)','EXECUTE'),'anonymous cannot write receipt RPC');
select ok(not has_function_privilege('authenticated','public.reconciliation_claim(uuid,integer)','EXECUTE'),'JWT admin cannot claim with public client');
select ok(not has_function_privilege('service_role','public.reconciliation_admin_list(integer,integer)','EXECUTE'),'service cannot impersonate actor admin view');
select ok(not has_function_privilege('authenticated','public.reconciliation_complete(uuid,uuid,text,text,integer,text,timestamptz,uuid)','EXECUTE'),'fan cannot manufacture query verification');
select ok(not has_function_privilege('authenticated','private.reconciliation_snapshot(uuid)','EXECUTE'),'private identity helper inaccessible');
set local role service_role;
select throws_ok($$select public.reconciliation_candidates(0)$$,'22023','RECONCILIATION_INVALID_INPUT','candidate lower bound enforced');
select throws_ok($$select public.reconciliation_candidates(21)$$,'22023','RECONCILIATION_INVALID_INPUT','candidate upper bound enforced');
select throws_ok($$select public.reconciliation_candidates(null)$$,'22023','RECONCILIATION_INVALID_INPUT','candidate null rejected');
select ok(jsonb_array_length(public.reconciliation_candidates(20))<=20,'candidate query bounded');
reset role;
update reconciliation_fixtures f set case_id=c.id from private.payment_reconciliation_cases c where c.target_id=case f.kind when 'initial' then f.session when 'refund' then f.request else f.attempt end;
select is((select count(*) from private.payment_reconciliation_cases),10::bigint,'one durable case per unresolved operation');
set local role service_role;
select is(jsonb_array_length(public.reconciliation_candidates(20)),9,'missing Kakao TID excluded from dispatch candidates');
select is(public.reconciliation_read(pg_temp.cid('kakao-missing'))->>'state','manual_review','missing Kakao TID retained as manual review');
select is(public.reconciliation_read(pg_temp.cid('kakao-missing'))->>'reason','PAYMENT_ID_MISSING','manual reason precise');
select is(pg_temp.claim_reconciliation('kakao-missing')->>'dispatch','false','missing TID cannot obtain query lease');
select is(public.reconciliation_read(pg_temp.cid('kakao-missing'))->>'query_attempts','0','missing TID consumes no imaginary API query');
select ok(not(public.reconciliation_read(pg_temp.cid('initial')) ?| array['credential_ciphertext','callback_ciphertext','redirects','user_id','artist_name','policy_body']),'worker projection removes credentials, callbacks and PII');
select throws_ok($$select public.reconciliation_read(gen_random_uuid())$$,'P0002','RECONCILIATION_NOT_FOUND','unknown case not found');
select throws_ok($$select public.reconciliation_claim(pg_temp.cid('initial'),89)$$,'22023','RECONCILIATION_INVALID_INPUT','lease lower bound');
select throws_ok($$select public.reconciliation_claim(pg_temp.cid('initial'),301)$$,'22023','RECONCILIATION_INVALID_INPUT','lease upper bound');
select throws_ok($$select public.reconciliation_enrollment_case('d9000000-0000-4000-8000-000000000003',(select session from reconciliation_fixtures where label='initial'))$$,'P0002','RECONCILIATION_NOT_FOUND','initial case selector enforces owner');
select is(public.reconciliation_enrollment_case('d9000000-0000-4000-8000-000000000001',(select session from reconciliation_fixtures where label='initial')),pg_temp.cid('initial'),'legacy recovery shares same durable case');
create temp table fair_pages(page jsonb);
grant all on fair_pages to service_role;
insert into fair_pages values(public.reconciliation_candidates(1)),(public.reconciliation_candidates(1));
select is((select count(distinct page->>0) from fair_pages),2::bigint,'fair cursor rotates past unchanged due cases without consuming query budget');
select is(pg_temp.receive_reconciliation('renewal')->>'accepted','true','known local Toss hint retained');
select is(pg_temp.receive_reconciliation('renewal')->>'duplicate','true','same semantic notice idempotent');
select is(pg_temp.receive_reconciliation('renewal','DONE',null,1000,'reconciliation-fixture','test',repeat('f',64))->>'duplicate','true','attacker digest variants cannot grow storage');
select is(pg_temp.receive_reconciliation('renewal','DONE','wrong-payment')->>'accepted','false','known payment key mismatch discarded');
select is(pg_temp.receive_reconciliation('renewal','DONE',null,999)->>'accepted','false','amount mismatch discarded');
select is(pg_temp.receive_reconciliation('renewal','DONE',null,1000,'wrong-mid')->>'accepted','false','MID mismatch discarded');
select is(pg_temp.receive_reconciliation('renewal','DONE',null,1000,'reconciliation-fixture','live')->>'accepted','false','test/live isolation enforced');
select is(pg_temp.receive_reconciliation('renewal','CANCELED')->>'accepted','false','unsolicited refund cannot fabricate authorized operation');
select is(pg_temp.receive_reconciliation('kakao-known')->>'accepted','false','Toss hint cannot bind Kakao order');
select is(public.reconciliation_receive_toss('test','reconciliation-fixture',gen_random_uuid(),'PAYMENT','DONE',1000,repeat('a',64))->>'accepted','false','arbitrary order does not grow inbox');
select throws_ok($$select pg_temp.receive_reconciliation('renewal','WAITING_FOR_DEPOSIT')$$,'22023','RECONCILIATION_INVALID_INPUT','unsupported status rejected');
select throws_ok($$select pg_temp.receive_reconciliation('renewal','DONE',null,1000,'reconciliation-fixture','test','not-a-digest')$$,'22023','RECONCILIATION_INVALID_INPUT','digest shape bounded');
reset role;
select is((select count(*) from private.payment_provider_inbox),1::bigint,'rejected/mutated hints do not grow inbox');
select is((select count(*) from public.payment_events where subscription_id=(select sid from reconciliation_fixtures where label='renewal')),0::bigint,'untrusted hint creates zero revenue');
set local role service_role;
select is(pg_temp.claim_reconciliation('renewal')->>'dispatch','true','query-only lease granted for known unknown outcome');
select is(pg_temp.claim_reconciliation('renewal')->>'dispatch','false','double claim cannot query twice');
select throws_ok($$select public.reconciliation_defer(pg_temp.cid('renewal'),gen_random_uuid())$$,'55000','RECONCILIATION_LEASE_CONFLICT','stale worker cannot defer');
select throws_ok($$select pg_temp.complete_reconciliation('renewal',999)$$,'23514','VERIFIED_RESULT_MISMATCH','amount conflict rolls settlement back');
reset role;
select is((select state from private.payment_provider_inbox where case_id=pg_temp.cid('renewal')),'pending','failed financial commit does not consume inbox');
select is((select state from private.payment_reconciliation_cases where id=pg_temp.cid('renewal')),'processing','failed financial commit retains lease');
select is((select count(*) from public.payment_events where subscription_id=(select sid from reconciliation_fixtures where label='renewal')),0::bigint,'invalid verification creates no ledger event');
set local role service_role;
select is(pg_temp.complete_reconciliation('renewal')->>'state','processed','verified query settles money and case together');
select is(pg_temp.complete_reconciliation('renewal')->>'state','processed','lost completion reply supports exact replay');
select throws_ok($$select pg_temp.complete_reconciliation('renewal',1000,'DIFFERENT_ACTION')$$,'23514','VERIFIED_RESULT_CONFLICT','replay cannot replace provider action');
select throws_ok($$select public.reconciliation_complete(pg_temp.cid('renewal'),(select token from reconciliation_fixtures where label='renewal'),'ACTION_renewal','PAYMENT_'||(select attempt from reconciliation_fixtures where label='renewal'),1000,'USD',date_trunc('second',now()-interval '10 minutes'),gen_random_uuid())$$,'23514','VERIFIED_RESULT_CONFLICT','replay cannot change currency');
select throws_ok($$select public.reconciliation_complete(pg_temp.cid('renewal'),(select token from reconciliation_fixtures where label='renewal'),'ACTION_renewal','PAYMENT_'||(select attempt from reconciliation_fixtures where label='renewal'),1000,'KRW',date_trunc('second',now()-interval '9 minutes'),gen_random_uuid())$$,'23514','VERIFIED_RESULT_CONFLICT','replay cannot change provider approval timestamp');
select throws_ok($$select public.reconciliation_complete(pg_temp.cid('renewal'),(select token from reconciliation_fixtures where label='renewal'),'ACTION_renewal','WRONG_PAYMENT',1000,'KRW',date_trunc('second',now()-interval '10 minutes'),gen_random_uuid())$$,'55000','RENEWAL_OUTCOME_CONFLICT','replay cannot change provider payment identity');
select throws_ok($$select public.reconciliation_complete(pg_temp.cid('renewal'),null,'ACTION_renewal','PAYMENT_'||(select attempt from reconciliation_fixtures where label='renewal'),1000,'KRW',date_trunc('second',now()-interval '10 minutes'),gen_random_uuid())$$,'55000','RECONCILIATION_LEASE_CONFLICT','missing completion token rejected');

select is(pg_temp.receive_reconciliation('renewal')->>'duplicate','true','completed duplicate remains idempotent');
select is(pg_temp.claim_reconciliation('renewal')->>'dispatch','false','completed event never queries again');
reset role;
select is((select count(*) from public.payment_events where subscription_id=(select sid from reconciliation_fixtures where label='renewal')),1::bigint,'exactly one ledger entry after replay');
select is((select state from private.payment_provider_inbox where case_id=pg_temp.cid('renewal')),'processed','inbox processed atomically with verified ledger');
select is((select query_attempts from private.renewal_attempts where attempt_id=(select attempt from reconciliation_fixtures where label='renewal')),1,'renewal existing query budget shared');
set local role service_role;
select is(pg_temp.claim_reconciliation('initial')->>'dispatch','true','initial recovery shares bounded query claim');
select is(pg_temp.complete_reconciliation('initial')->>'state','processed','initial known credential verified recovery settles');
select is(pg_temp.claim_reconciliation('kakao-initial')->>'dispatch','true','known Kakao TID allows query without SID');
select is(pg_temp.complete_reconciliation('kakao-initial')->>'state','manual_review','missing Kakao SID prevents fabricated credential/activation');
select is(pg_temp.complete_reconciliation('kakao-initial')->>'reason','CREDENTIAL_MISSING','verified credential-loss evidence replay is idempotent');
reset role;
select is((select count(*) from private.enrollment_reconciliations where session_id=(select session from reconciliation_fixtures where label='kakao-initial')),1::bigint,'verified Kakao observation retained once');
select is((select count(*) from public.payment_events where subscription_id=(select sid from reconciliation_fixtures where label='kakao-initial')),0::bigint,'missing SID does not invent paid entitlement ledger');
select is((select status::text from public.subscriptions where id=(select sid from reconciliation_fixtures where label='kakao-initial')),'pending','missing SID keeps activation manual');
set local role service_role;
select is(pg_temp.claim_reconciliation('kakao-known')->>'dispatch','true','known renewal TID query allowed');
select is(pg_temp.complete_reconciliation('kakao-known')->>'state','processed','Kakao renewal query records verified known TID');
select is(pg_temp.receive_reconciliation('refund','PARTIAL_CANCELED')->>'accepted','true','refund hint binds already-dispatched authorized operation');
select is(pg_temp.claim_reconciliation('refund')->>'dispatch','true','refund query requires no new admin dispatch');
select is(pg_temp.complete_reconciliation('refund')->>'state','processed','verified refund query atomically settles');
select is(pg_temp.complete_reconciliation('refund')->>'state','processed','refund response-loss replay idempotent');
reset role;
select is((select sum(amount_krw) from public.payment_events where subscription_id=(select sid from reconciliation_fixtures where label='refund')),400::bigint,'exact negative refund value retained with original charge');
select is((select query_attempts from private.refund_requests where id=(select request from reconciliation_fixtures where label='refund')),1,'refund existing query budget shared');
set local role service_role;
select is(pg_temp.claim_reconciliation('expired')->>'dispatch','true','expired dispatch lease recovered as query only');
reset role;
select is((select state::text from private.payment_attempts where id=(select attempt from reconciliation_fixtures where label='expired')),'unknown','expired lease never resets payment to chargeable created state');
set local role service_role;
select is(pg_temp.complete_reconciliation('expired')->>'state','processed','lost response after expired lease can settle');
select is(pg_temp.claim_reconciliation('canceled')->>'dispatch','true','cancellation preserves unknown money recovery');
select is(pg_temp.complete_reconciliation('canceled')->>'state','processed','verified charge recovered after cancellation');
reset role;
select is((select status::text from public.subscriptions where id=(select sid from reconciliation_fixtures where label='canceled')),'canceled','recovery does not reopen canceled renewal');
select is((select next_billing_at from public.subscriptions where id=(select sid from reconciliation_fixtures where label='canceled')),null::timestamptz,'recovery does not reschedule canceled renewal');
set local role service_role;
select is(pg_temp.claim_reconciliation('budget')->>'query_attempts','1','first query budget counted');
select is(public.reconciliation_defer(pg_temp.cid('budget'),(select token from reconciliation_fixtures where label='budget'))->>'state','retry','unconfirmed query remains recoverable');
select is(pg_temp.claim_reconciliation('budget')->>'dispatch','false','backoff prevents immediate query loop');
reset role;
update private.payment_reconciliation_cases set next_query_at=now()-interval '1 second' where id=pg_temp.cid('budget');
update private.renewal_attempts set next_query_at=now()-interval '1 second' where attempt_id=(select attempt from reconciliation_fixtures where label='budget');
set local role service_role;
select is(pg_temp.claim_reconciliation('budget')->>'query_attempts','2','second bounded recovery query');
select is(public.reconciliation_defer(pg_temp.cid('budget'),(select token from reconciliation_fixtures where label='budget'))->>'state','retry','second unconfirmed query remains unknown');
reset role;
update private.payment_reconciliation_cases set next_query_at=now()-interval '1 second' where id=pg_temp.cid('budget');
update private.renewal_attempts set next_query_at=now()-interval '1 second' where attempt_id=(select attempt from reconciliation_fixtures where label='budget');
set local role service_role;
select is(pg_temp.claim_reconciliation('budget')->>'query_attempts','3','third and final bounded recovery query');
select is(public.reconciliation_defer(pg_temp.cid('budget'),(select token from reconciliation_fixtures where label='budget'))->>'state','manual_review','query exhaustion becomes attention case');
select is(pg_temp.receive_reconciliation('budget')->>'accepted','true','new hint can be retained without authorizing extra work');
select is(pg_temp.claim_reconciliation('budget')->>'dispatch','false','hint cannot reset exhausted budget');
select is(public.reconciliation_read(pg_temp.cid('budget'))->>'query_attempts','3','terminal budget preserved');
select is(public.reconciliation_read(pg_temp.cid('budget'))->>'reason','QUERY_BUDGET_EXHAUSTED','bounded exhaustion reason visible');
select is(pg_temp.claim_reconciliation('other-worker')->>'dispatch','true','other worker case leased');
select public.renewal_finalize((select attempt from reconciliation_fixtures where label='other-worker'),'OTHER_ACTION','PAYMENT_'||(select attempt from reconciliation_fixtures where label='other-worker'),1000,'KRW',date_trunc('second',now()-interval '10 minutes'),gen_random_uuid());
select public.reconciliation_candidates(20);
select is(public.reconciliation_read(pg_temp.cid('other-worker'))->>'state','processed','existing worker completion observed without another provider query');
reset role;
select is((select state::text from private.payment_attempts where id=(select attempt from reconciliation_fixtures where label='budget')),'unknown','exhausted query never presumed failure');
select is((select count(*) from public.payment_events where subscription_id=(select sid from reconciliation_fixtures where label='budget')),0::bigint,'exhaustion never presumed money');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"d9000000-0000-4000-8000-000000000001","role":"admin"}',true);
select throws_ok($$select public.reconciliation_admin_list()$$,'42501','FORBIDDEN','forged admin JWT metadata cannot read cases');
select set_config('request.jwt.claims','{"sub":"d9000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select is(jsonb_array_length(public.reconciliation_admin_list()->'cases'),10,'real unrestricted admin sees safe cases');
select is(jsonb_array_length(public.reconciliation_admin_list(1,1)->'cases'),1,'admin pagination bounded');
select is(public.reconciliation_admin_list(1,1)->>'has_more','true','admin page exposes truthful next page');
select is(public.reconciliation_admin_list(100000)->'cases','[]'::jsonb,'empty admin page handled');
select throws_ok($$select public.reconciliation_admin_list(0)$$,'22023','RECONCILIATION_INVALID_INPUT','admin page minimum');
select throws_ok($$select public.reconciliation_admin_list(100001)$$,'22023','RECONCILIATION_INVALID_INPUT','admin page maximum');
select throws_ok($$select public.reconciliation_admin_list(1,51)$$,'22023','RECONCILIATION_INVALID_INPUT','admin page size maximum');
select ok(not((public.reconciliation_admin_list()->'cases'->0) ?| array['user_id','customer_ref','order_id','provider_payment_id','provider_charge_action_id','merchant_account','lease_token','target_id']),'admin rows omit provider identity and customer PII');
reset role;
update public.profiles set is_restricted=true where id='d9000000-0000-4000-8000-000000000002';
set local role authenticated;
select throws_ok($$select public.reconciliation_admin_list()$$,'42501','FORBIDDEN','restricted admin denied');
reset role;
select * from finish();
rollback;
