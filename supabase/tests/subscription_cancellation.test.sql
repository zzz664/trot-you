begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();

-- Fictional, rolled-back fixtures only. No live policy approval or provider I/O.
insert into auth.users(id,email,raw_user_meta_data) values
 ('d8000000-0000-4000-8000-000000000001','cancel-owner@example.invalid','{}'),
 ('d8000000-0000-4000-8000-000000000002','cancel-other@example.invalid','{}'),
 ('d8000000-0000-4000-8000-000000000003','cancel-admin@example.invalid','{}'),
 ('d8000000-0000-4000-8000-000000000004','cancel-admin-two@example.invalid','{}');
update public.profiles set role='admin' where id in ('d8000000-0000-4000-8000-000000000003','d8000000-0000-4000-8000-000000000004');
insert into private.checkout_policies(version,title,body,regular_price_krw,intro_price_krw,approved_at,published_at,billing_period_calendar,payment_tax_basis)
values('d8100000-0000-4000-8000-000000000001','Fictional checkout','Disposable refund fixture only.',1000,1000,now(),now(),'utc_monthly_clamped','taxable_krw');
create temp table cancellation_cases(label text primary key,sid uuid,charge uuid,request uuid,token uuid,refund_event uuid,refunded_at timestamptz);
grant all on cancellation_cases to authenticated,service_role;
create function pg_temp.owner() returns uuid language sql as $$select 'd8000000-0000-4000-8000-000000000001'::uuid$$;
create function pg_temp.admin() returns uuid language sql as $$select 'd8000000-0000-4000-8000-000000000003'::uuid$$;
create function pg_temp.sid(text) returns uuid language sql as $$select sid from cancellation_cases where label=$1$$;
create function pg_temp.charge(text) returns uuid language sql as $$select charge from cancellation_cases where label=$1$$;
create function pg_temp.rid(text) returns uuid language sql as $$select request from cancellation_cases where label=$1$$;
create function pg_temp.token(text) returns uuid language sql as $$select token from cancellation_cases where label=$1$$;
create function pg_temp.make_case(label text,provider public.payment_provider default 'toss') returns uuid language plpgsql as $$
declare sid uuid:=gen_random_uuid(); artist uuid:=gen_random_uuid(); mid uuid:=gen_random_uuid(); obligation uuid:=gen_random_uuid(); attempt uuid:=gen_random_uuid(); event uuid:=gen_random_uuid();
begin
 insert into public.artists(id,slug,name,grade,status) values(artist,'cancellation-'||artist,'Fictional cancellation artist','B','active');
 insert into public.subscriptions(id,user_id,artist_id,provider,status,first_started_at,episode_started_at,current_period_start,current_period_end,next_billing_at)
 values(sid,pg_temp.owner(),artist,provider,'active',now()-interval '2 days',now()-interval '2 days',now()-interval '2 days',now()+interval '28 days',now()+interval '28 days');
 insert into private.payment_mandates(id,subscription_id,provider,environment,merchant_account,provider_customer_ref,secure_credential_ref,consent_version)
 values(mid,sid,provider,'test','refund-fixture-merchant',gen_random_uuid(),gen_random_uuid(),'d8100000-0000-4000-8000-000000000001');
 insert into private.billing_obligations(id,subscription_id,mandate_id,period_start,period_end,amount_krw,is_initial,is_intro,price_version,grace_seconds,retry_seconds,max_retries,state,next_attempt_at)
 values(obligation,sid,mid,now()-interval '2 days',now()+interval '28 days',1000,true,false,'d8100000-0000-4000-8000-000000000001',0,1,0,'settled',now());
 insert into private.payment_attempts(id,obligation_id,ordinal,state) values(attempt,obligation,1,'success');
 insert into private.renewal_attempts(attempt_id,provider_payment_id) values(attempt,'PAYMENT_'||attempt);
 insert into public.payment_events(id,subscription_id,kind,amount_krw,provider,period_start,period_end,occurred_at)
 values(event,sid,'charge',1000,provider,now()-interval '2 days',now()+interval '28 days',now()-interval '2 days');
 insert into private.payment_event_verifications(event_id,attempt_id,provider,environment,merchant_account,provider_action_id,evidence_ref)
 values(event,attempt,provider,'test','refund-fixture-merchant','CHARGE_'||attempt,gen_random_uuid());
 insert into cancellation_cases(label,sid,charge) values(label,sid,event); return sid;
end;$$;
create function pg_temp.request(label text,amount integer default 600) returns jsonb language plpgsql as $$declare data jsonb; begin
 data:=public.refund_request(pg_temp.sid(label),pg_temp.charge(label),amount,'Fictional review request',pg_temp.charge(label));
 update cancellation_cases set request=(data->>'id')::uuid where cancellation_cases.label=$1; return data;
end;$$;
create function pg_temp.approve(label text,amount integer default 600) returns jsonb language sql as $$
 select public.refund_decide(pg_temp.rid(label),'approve',amount,'d8200000-0000-4000-8000-000000000001','Fictional reviewed authorization');$$;
create function pg_temp.claim(label text) returns jsonb language plpgsql as $$declare data jsonb; begin
 data:=public.refund_claim(pg_temp.rid(label),pg_temp.admin(),120);
 if (data->>'dispatch')::boolean then update cancellation_cases set token=(data->>'lease_token')::uuid where cancellation_cases.label=$1; end if;
 return data;
end;$$;
create function pg_temp.finalize(label text,action text default 'REFUND_ACTION') returns uuid language plpgsql as $$declare data jsonb; event uuid; at_time timestamptz; begin
 at_time:=coalesce((select refunded_at from cancellation_cases where cancellation_cases.label=$1),date_trunc('second',clock_timestamp()));
 data:=public.refund_read(pg_temp.rid(label));
 event:=public.refund_finalize(pg_temp.rid(label),action,data->>'provider_payment_id',(data->>'amount_krw')::integer,'KRW',at_time,gen_random_uuid());
 update cancellation_cases set refund_event=event,refunded_at=at_time where cancellation_cases.label=$1; return event;
end;$$;
select pg_temp.make_case('success');
select pg_temp.make_case('cancel');
select pg_temp.make_case('unknown','kakaopay');
select pg_temp.make_case('rejected');
select pg_temp.make_case('revoke');
select pg_temp.make_case('failed');
select pg_temp.make_case('changed');
select pg_temp.make_case('lease');

select is((select count(*) from private.refund_policies),0::bigint,'migration seeds no business or legal approval');
select ok(not has_table_privilege('authenticated','private.refund_requests','SELECT'),'request private rows have no fan table access');
select ok(not has_table_privilege('service_role','private.refund_requests','UPDATE'),'service cannot bypass operation RPC');
select ok(not has_function_privilege('authenticated','public.refund_claim(uuid,uuid,integer)','EXECUTE'),'fans and JWT-admins cannot dispatch provider operations');
select ok(not has_function_privilege('service_role','public.refund_decide(uuid,text,integer,uuid,text)','EXECUTE'),'service credential cannot invent human approval');
select ok(not has_function_privilege('anon','public.subscription_management_list(integer)','EXECUTE'),'anonymous cannot enumerate subscription history');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"d8000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select throws_ok($$select public.subscription_management_read(pg_temp.sid('success'))$$,'42501','FORBIDDEN','other fan cannot read paid history');
select throws_ok($$select public.cancel_subscription(pg_temp.sid('cancel'))$$,'42501','FORBIDDEN','other fan cannot cancel');
select throws_ok($$select pg_temp.request('success')$$,'42501','FORBIDDEN','other fan cannot request owner money');
select set_config('request.jwt.claims','{"sub":"d8000000-0000-4000-8000-000000000001","role":"admin"}',true);
select throws_ok($$select public.refund_admin_list()$$,'42501','FORBIDDEN','JWT metadata cannot authorize admin view');
select is(jsonb_array_length(public.subscription_management_list()->'subscriptions'),8,'owner sees own subscriptions');
select is(public.subscription_management_list(2)->'subscriptions','[]'::jsonb,'subscription pagination explicit empty next page');
select throws_ok($$select public.subscription_management_list(0)$$,'22023','REFUND_INVALID_INPUT','invalid page rejected');
select is(jsonb_array_length(public.subscription_management_read(pg_temp.sid('success'))->'charges'),1,'detail includes safe charge');
select is(public.subscription_management_read(pg_temp.sid('success'),2)->'charges','[]'::jsonb,'charge pagination supports older history without invented cutoff');
select is((public.cancel_subscription(pg_temp.sid('cancel'))).status::text,'canceled','owner cancellation works without any provider or refund policy');
select is((public.cancel_subscription(pg_temp.sid('cancel'))).status::text,'canceled','repeated cancel idempotent');
select is((public.cancel_subscription(pg_temp.sid('cancel'))).next_billing_at,null::timestamptz,'future billing disabled');
select is(public.has_active_access((select artist_id from public.subscriptions where id=pg_temp.sid('cancel'))),true,'canceled paid-period access retained');
select throws_ok($$select public.refund_request(pg_temp.sid('success'),pg_temp.charge('success'),600,E'\n\t',gen_random_uuid())$$,'22023','REFUND_INVALID_INPUT','direct RPC rejects tab/newline-only reason before it can poison safe DTO');
select throws_ok($$select public.refund_request(pg_temp.sid('success'),pg_temp.charge('success'),600,U&'\00A0\FEFF',gen_random_uuid())$$,'22023','REFUND_INVALID_INPUT','direct RPC matches Unicode JS trim for whitespace-only reason');
select is(pg_temp.request('success')->>'status','requested','request accepts review without inventing policy approval');
select is(pg_temp.request('success')->>'id',pg_temp.rid('success')::text,'same idempotency key exact replay returns same request');
select throws_ok($$select pg_temp.request('success',500)$$,'55000','REFUND_IDEMPOTENCY_CONFLICT','replay cannot alter amount');
select throws_ok($$select public.refund_request(pg_temp.sid('success'),pg_temp.charge('success'),600,'Another request',gen_random_uuid())$$,'55000','REFUND_ALREADY_OPEN','second operation cannot target unresolved same charge');
select throws_ok($$select public.refund_request(pg_temp.sid('rejected'),pg_temp.charge('rejected'),1001,'Too much',gen_random_uuid())$$,'23514','REFUND_EXCEEDS_CHARGE','requested overrefund fails');
select throws_ok($$select public.refund_request(pg_temp.sid('rejected'),pg_temp.charge('success'),1,'Wrong subscription',gen_random_uuid())$$,'42501','FORBIDDEN','charge and subscription binding checked');
select pg_temp.request('unknown'); select pg_temp.request('rejected'); select pg_temp.request('revoke'); select pg_temp.request('failed'); select pg_temp.request('changed'); select pg_temp.request('lease');
select throws_ok($$select pg_temp.approve('success')$$,'42501','FORBIDDEN','owner cannot self-grant admin refund approval');
select set_config('request.jwt.claims','{"sub":"d8000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
select is(public.refund_admin_read(pg_temp.rid('success'))->'policy','null'::jsonb,'admin sees missing approval explicitly');
select throws_ok($$select pg_temp.approve('success')$$,'55000','REFUND_POLICY_NOT_APPROVED','manual admin does not bypass missing approved policy');
select is(public.refund_admin_list(1)->>'more_available','true','inbox reports pagination instead of hiding history');
select is(public.refund_admin_list(1,2)->>'page','2','admin page returned');
reset role;
insert into private.refund_policies values('d8200000-0000-4000-8000-000000000001','Fictional reviewed policy','Disposable fixture: manual review, paid access retained.','preserve_paid_access','taxable_krw',now(),now());
insert into private.refund_policy_current values(true,'d8200000-0000-4000-8000-000000000001');
select throws_ok($$update private.refund_policies set body='Changed approval'$$,'23514','REFUND_POLICY_IMMUTABLE','approved policy text immutable');
set local role authenticated;
select throws_ok($$select public.refund_decide(pg_temp.rid('success'),'approve',600,'d8200000-0000-4000-8000-000000000001',E'\n\t')$$,'22023','REFUND_INVALID_INPUT','direct admin authorization rejects whitespace-only explanation');
select is(pg_temp.approve('success')->>'status','authorized','exact amount reviewed under approved policy');
select is(pg_temp.approve('success')->>'status','authorized','same authorization replay idempotent');
select throws_ok($$select pg_temp.approve('success',500)$$,'55000','REFUND_STATE_CONFLICT','authorization cannot be rewritten after review');
select throws_ok($$select pg_temp.approve('rejected',500)$$,'23514','REFUND_AMOUNT_MISMATCH','approval must explicitly confirm exact requested amount');
select is(public.refund_decide(pg_temp.rid('rejected'),'reject',null,null,'Fictional rejection')->>'status','rejected','rejection requires no monetary policy');
select pg_temp.approve('unknown'); select pg_temp.approve('revoke'); select pg_temp.approve('failed'); select pg_temp.approve('changed'); select pg_temp.approve('lease');
reset role;
select is((select count(*) from private.refund_decisions where request_id=pg_temp.rid('success')),1::bigint,'duplicate authorization creates no duplicate audit');
select throws_ok($$delete from private.refund_decisions$$,'55000','IMMUTABLE_PAYMENT_LEDGER','decision audit immutable');
set local role service_role;
select throws_ok($$select public.refund_claim(pg_temp.rid('success'),pg_temp.owner(),120)$$,'42501','FORBIDDEN','service claim validates actual executing admin');
select is(pg_temp.claim('success')->>'dispatch','true','one approved dispatch lease');
select is(pg_temp.claim('success')->>'dispatch','false','second claim never repeats provider refund');
select is(public.refund_read(pg_temp.rid('success'))->>'state','inflight','dispatch is not money');
select throws_ok($$select public.refund_record_outcome(pg_temp.rid('success'),gen_random_uuid(),'unknown')$$,'55000','REFUND_OUTCOME_CONFLICT','wrong token cannot classify outcome');
select lives_ok($$select pg_temp.finalize('success')$$,'verified refund recognized once');
select lives_ok($$select pg_temp.finalize('success')$$,'same provider refund replay idempotent');
select is(public.refund_read(pg_temp.rid('success'))->>'state','succeeded','durable success is distinguishable from approved');
select throws_ok($$select pg_temp.finalize('success','DIFFERENT_ACTION')$$,'23514','REFUND_EXCEEDS_CHARGE','second action cannot overrefund on replay');
reset role;
select is((select amount_krw from public.payment_events where id=(select refund_event from cancellation_cases where label='success')),-600,'only verified refund negative money');
select is((select sum(amount_krw) from public.payment_events where subscription_id=pg_temp.sid('success')),400::bigint,'net settlement amount includes refund exactly once');
select is((select status::text from public.subscriptions where id=pg_temp.sid('success')),'active','refund does not silently cancel future renewal');
select is((select current_period_end>now() from public.subscriptions where id=pg_temp.sid('success')),true,'refund does not silently terminate paid access');
set local role service_role;
select is(pg_temp.claim('unknown')->>'dispatch','true','unknown fixture dispatches once');
select is(public.refund_record_outcome(pg_temp.rid('unknown'),pg_temp.token('unknown'),'unknown')->>'state','unknown','timeout preserved unknown');
select is(pg_temp.claim('unknown')->>'dispatch','false','unknown cannot redispatch refund');
reset role;
update private.refund_requests set next_query_at=clock_timestamp()-interval '1 second' where id=pg_temp.rid('unknown');
set local role service_role;
select is(pg_temp.claim('unknown')->>'action','reconcile','known Kakao TID permits query-only recovery');
select is(pg_temp.claim('unknown')->>'dispatch','false','query lease prevents duplicate recovery calls');
select throws_ok($$select public.refund_record_outcome(pg_temp.rid('unknown'),pg_temp.token('unknown'),'failed',gen_random_uuid())$$,'55000','REFUND_OUTCOME_CONFLICT','query failure cannot authorize another monetary attempt');
select lives_ok($$select pg_temp.finalize('unknown','KAKAO_REFUND_ACTION')$$,'exact recovered refund can recognize money');
reset role;
update public.profiles set role='fan' where id=pg_temp.admin();
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"d8000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
select is(public.refund_admin_read(pg_temp.rid('revoke'))->'request'->>'requires_manual_review','true','safe admin DTO shows revoked authorization requires review');
select set_config('request.jwt.claims','{"sub":"d8000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
set local role service_role;
select throws_ok($$select pg_temp.claim('revoke')$$,'42501','FORBIDDEN','executing admin revocation checked at claim');
select is(public.refund_claim(pg_temp.rid('revoke'),'d8000000-0000-4000-8000-000000000004',120)->>'reason','AUTHORIZATION_REVOKED','different executor cannot use revoked approving admin authority');
reset role;
update public.profiles set role='admin' where id=pg_temp.admin();
set local role authenticated;
select is(public.refund_decide(pg_temp.rid('revoke'),'reject',null,null,'Withdrawn before dispatch')->>'status','rejected','admin may withdraw authorization only before provider dispatch');
set local role service_role;
select is(pg_temp.claim('revoke')->>'dispatch','false','withdrawal keeps provider dispatch closed');
select is(pg_temp.claim('failed')->>'dispatch','true','definitive failure fixture claims');
select throws_ok($$select public.refund_record_outcome(pg_temp.rid('failed'),pg_temp.token('failed'),'failed')$$,'55000','REFUND_OUTCOME_CONFLICT','unverified failure does not reopen capacity');
select is(public.refund_record_outcome(pg_temp.rid('failed'),pg_temp.token('failed'),'failed',gen_random_uuid())->>'state','failed','verified definitive failure records no money');
select is(pg_temp.claim('failed')->>'dispatch','false','failed operation never automatically retried');
select lives_ok($$select public.billing_record_refund(pg_temp.charge('changed'),'EXTERNAL_REFUND',500,'KRW',date_trunc('second',clock_timestamp()),gen_random_uuid())$$,'external verified refund fixture');
select is(pg_temp.claim('changed')->>'reason','LEDGER_CHANGED','changed cumulative refund requires new review never silent amount rewrite');
set local role authenticated;
select is(public.refund_admin_read(pg_temp.rid('changed'))->'request'->>'requires_manual_review','true','safe DTO prevents repeated execute when original refund balance changed');
set local role service_role;
select is(pg_temp.claim('lease')->>'dispatch','true','crash fixture dispatch');
reset role;
update private.refund_requests set lease_expires_at=clock_timestamp()-interval '1 second' where id=pg_temp.rid('lease');
set local role service_role;
select is(pg_temp.claim('lease')->>'state','unknown','lease expiry never proves provider refund failed');
select is(pg_temp.claim('lease')->>'action','reconcile','expired lease can only query original operation');
reset role;
update private.refund_requests set query_attempts=3,query_lease_expires_at=null where id=pg_temp.rid('lease');
set local role service_role;
select is(public.refund_read(pg_temp.rid('lease'))->>'action','manual_review','bounded queries finish in manual review not retry');
reset role;
select is((select count(*) from public.payment_events where kind='refund'),3::bigint,'unknown,failed,rejected cases never fabricate ledger money');
select ok((select bool_and(relrowsecurity) from pg_class where oid in ('private.refund_policies'::regclass,'private.refund_policy_current'::regclass,'private.refund_requests'::regclass,'private.refund_decisions'::regclass)),'all added private tables RLS enabled');
select * from finish();
rollback;
