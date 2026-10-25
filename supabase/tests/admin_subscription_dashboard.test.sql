begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
set local timezone='UTC';
select no_plan();

select is((select count(*) from private.subscription_cancellation_history),0::bigint,'fresh migration invents no cancellation events');
select is((select count(*) from private.subscription_dashboard_history_coverage),1::bigint,'one immutable technical history coverage boundary');
select ok((select bool_and(relrowsecurity) from pg_class where oid in('private.subscription_cancellation_history'::regclass,
  'private.subscription_dashboard_history_coverage'::regclass)),'history metadata is RLS protected');
select ok((select bool_and(not has_table_privilege(r,t,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')) from
  unnest(array['anon','authenticated','service_role'])r cross join unnest(array['private.subscription_cancellation_history','private.subscription_dashboard_history_coverage'])t),
  'API roles cannot read or manufacture cancellation history');
select ok(has_function_privilege('authenticated','public.admin_subscription_dashboard(date,date,uuid,integer)','EXECUTE'),'only actor-bound dashboard entry point granted');
select ok(not has_function_privilege('anon','public.admin_subscription_dashboard(date,date,uuid,integer)','EXECUTE'),'anonymous cannot call dashboard');
select ok(not has_function_privilege('service_role','public.admin_subscription_dashboard(date,date,uuid,integer)','EXECUTE'),'service credential cannot substitute administrator');
select ok((select bool_and(not has_function_privilege(r,oid,'EXECUTE')) from pg_proc cross join unnest(array['anon','authenticated','service_role'])r
  where pronamespace='private'::regnamespace and proname like 'subscription_dashboard_%'),'private dashboard helpers are not directly executable');
select ok((select prosecdef and 'search_path=""'=any(proconfig) from pg_proc where oid='public.admin_subscription_dashboard(date,date,uuid,integer)'::regprocedure),
  'dashboard uses a pinned definer search path');

insert into auth.users(id,email,raw_user_meta_data)
select ('af100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'dashboard-private-'||n||'@example.invalid','{}'::jsonb from generate_series(1,12)n;
update public.profiles set role='admin' where id='af100000-0000-4000-8000-000000000010';
update public.profiles set role='artist' where id='af100000-0000-4000-8000-000000000011';
update public.profiles set role='admin',is_restricted=true where id='af100000-0000-4000-8000-000000000012';
insert into public.artists(id,slug,name,grade,status) values
 ('af200000-0000-4000-8000-000000000001','dashboard-one','A Fictional dashboard','B','active'),
 ('af200000-0000-4000-8000-000000000002','dashboard-two','B Fictional dashboard','B','paused');
create function pg_temp.artist() returns uuid language sql as $$select 'af200000-0000-4000-8000-000000000001'::uuid$$;
create function pg_temp.sid(n integer) returns uuid language sql as $$select ('af300000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
create function pg_temp.dashboard(artist uuid default null,page integer default 1) returns jsonb language sql as $$
 select public.admin_subscription_dashboard('2020-01-01','2020-01-31',artist,page);$$;
insert into public.subscriptions(id,user_id,artist_id,provider,status,current_period_start,current_period_end,grace_started_at,grace_ends_at,next_billing_at)
select pg_temp.sid(n),('af100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,pg_temp.artist(),'toss',
  case when n in(1,2,5,7,8) then 'active' when n=3 then 'grace' when n=4 then 'pending' else 'expired' end::public.subscription_status,
  case when n=4 then null else now()-interval '30 days' end,
  case when n=4 then null when n in(3,6,7) then now()-interval '1 second' when n=8 then now()+interval '60 days' else now()+interval '30 days' end,
  case when n=3 then now()-interval '1 day' end,case when n=3 then now()+interval '2 days' end,
  null from generate_series(1,8)n;
-- Future-start active is not yet eligible, even if its end is in the future.
update public.subscriptions set current_period_start=now()+interval '30 days' where id=pg_temp.sid(8);
insert into public.subscriptions(id,user_id,artist_id,provider,status,current_period_start,current_period_end)
values(pg_temp.sid(9),'af100000-0000-4000-8000-000000000001','af200000-0000-4000-8000-000000000002','toss','active',now()-interval '1 day',now()+interval '1 day');
create function pg_temp.charge(n integer,at_time timestamptz,initial boolean default true,due timestamptz default null) returns uuid language plpgsql as $$
declare sid uuid:=pg_temp.sid(n); mandate uuid; obligation uuid:=gen_random_uuid(); attempt uuid:=gen_random_uuid(); event uuid:=gen_random_uuid();
  period timestamptz:=coalesce(due,at_time);
begin
 select id into mandate from private.payment_mandates where subscription_id=sid;
 if mandate is null then
  mandate:=gen_random_uuid();
  insert into private.payment_mandates(id,subscription_id,provider,environment,merchant_account,provider_customer_ref,secure_credential_ref,consent_version)
  values(mandate,sid,'toss','test','private-merchant-do-not-echo',gen_random_uuid(),gen_random_uuid(),'fictional-dashboard');
 end if;
 insert into private.billing_obligations(id,subscription_id,mandate_id,period_start,period_end,amount_krw,is_initial,is_intro,price_version,grace_seconds,retry_seconds,max_retries,state,next_attempt_at)
 values(obligation,sid,mandate,period,period+interval '1 month',1000,initial,false,'private-policy-do-not-echo',0,1,0,'settled',period);
 insert into private.payment_attempts(id,obligation_id,ordinal,state) values(attempt,obligation,1,'success');
 insert into public.payment_events(id,subscription_id,kind,amount_krw,provider,period_start,period_end,occurred_at,recorded_at)
 values(event,sid,'charge',1000,'toss',period,period+interval '1 month',at_time,at_time);
 insert into private.payment_event_verifications(event_id,attempt_id,provider,environment,merchant_account,provider_action_id,evidence_ref)
 values(event,attempt,'toss','test','private-merchant-do-not-echo','private-action-'||event,gen_random_uuid());
 return event;
end;$$;
-- Exactly the KST start is included; the exclusive end is excluded.
select pg_temp.charge(1,'2019-12-31 15:00:00+00');
select pg_temp.charge(2,'2019-12-01 00:00:00+00');
select pg_temp.charge(2,'2020-02-02 00:00:00+00',false,'2020-01-10 00:00:00+00');
select pg_temp.charge(3,'2019-12-02 00:00:00+00');
select pg_temp.charge(5,'2020-01-15 00:00:00+00');
select pg_temp.charge(6,'2020-01-31 15:00:00+00');
select pg_temp.charge(7,'2019-12-03 00:00:00+00');
select pg_temp.charge(8,'2019-12-31 14:59:59.999999+00');
select pg_temp.charge(9,'2020-01-20 00:00:00+00');
-- Returning episode is not a new lifetime subscriber; first charge stays 2019.
select pg_temp.charge(2,'2020-01-20 00:00:00+00');
insert into private.billing_obligations(id,subscription_id,mandate_id,period_start,period_end,amount_krw,is_initial,is_intro,price_version,grace_seconds,retry_seconds,max_retries,state,next_attempt_at)
select ('af400000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,pg_temp.sid(n),m.id,'2020-01-11 00:00:00+00','2020-02-11 00:00:00+00',1000,false,false,'fictional',3,1,2,'open',now()
from generate_series(3,7,4)n join private.payment_mandates m on m.subscription_id=pg_temp.sid(n);
insert into private.payment_attempts(obligation_id,ordinal,state,outcome_evidence_ref)
values('af400000-0000-4000-8000-000000000003',1,'failed',gen_random_uuid()),
 ('af400000-0000-4000-8000-000000000003',2,'failed',gen_random_uuid()),
 ('af400000-0000-4000-8000-000000000007',1,'unknown',null);
update public.subscriptions set status='canceled',canceled_at='2020-01-20 01:00:00+00' where id=pg_temp.sid(5);
-- Unpaid signup cancellation is evidence, but not a paid cancellation metric.
update public.subscriptions set status='canceled',canceled_at='2020-01-22 00:00:00+00' where id=pg_temp.sid(4);
update public.subscriptions set status='pending',canceled_at=null where id=pg_temp.sid(4);
select is((select count(*) from private.subscription_cancellation_history),2::bigint,'genuine paid and unpaid cancellation transitions captured');
select is((select count(*) from private.subscription_cancellation_history where was_paid),1::bigint,'pending signup abort is not paid cancellation');
select throws_ok('update private.subscription_cancellation_history set was_paid=true','55000','ADMIN_SUBSCRIPTIONS_HISTORY_IMMUTABLE','cancellation history cannot be changed');
select throws_ok('delete from private.subscription_cancellation_history','55000','ADMIN_SUBSCRIPTIONS_HISTORY_IMMUTABLE','cancellation history cannot be erased');
select throws_ok('truncate private.subscription_cancellation_history','55000','ADMIN_SUBSCRIPTIONS_HISTORY_IMMUTABLE','cancellation history cannot be truncated');
select throws_ok('update private.subscription_dashboard_history_coverage set complete_from=now()','55000','ADMIN_SUBSCRIPTIONS_HISTORY_IMMUTABLE','coverage cannot be rewritten');
select throws_ok('delete from private.subscription_dashboard_history_coverage','55000','ADMIN_SUBSCRIPTIONS_HISTORY_IMMUTABLE','coverage cannot be erased');
select throws_ok('truncate private.subscription_dashboard_history_coverage','55000','ADMIN_SUBSCRIPTIONS_HISTORY_IMMUTABLE','coverage cannot be truncated');

set local role authenticated;
select set_config('request.jwt.claim.sub','af100000-0000-4000-8000-000000000010',true);
create temporary table dashboard_result as select pg_temp.dashboard() as data;
select is((select data->>'time_zone' from dashboard_result),'Asia/Seoul','calendar zone explicit');
select is((select (data->>'window_start')::timestamptz from dashboard_result),'2019-12-31 15:00:00+00'::timestamptz,'KST inclusive start precisely converted');
select is((select (data->>'window_end')::timestamptz from dashboard_result),'2020-01-31 15:00:00+00'::timestamptz,'KST inclusive last day becomes exclusive following midnight');
select ok((select (data->>'as_of')::timestamptz>=statement_timestamp()-interval '1 minute' from dashboard_result),'snapshot time is current');
select ok((select (data->>'cancellation_history_complete_from')::timestamptz>(data->>'window_start')::timestamptz from dashboard_result),'older range exposes honest incomplete history boundary');
select is((select data->'selected_artist' from dashboard_result),'null'::jsonb,'global view selects no artist');
select is((select data->'summary'->'current' from dashboard_result),
 '{"total_subscriptions":9,"subscribers":4,"active_paid":3,"grace":1,"canceled_paid":1,"pending":1,"expired":1,"out_of_access":2}'::jsonb,
 'current partitions pair states while total subscribers deduplicates the same fan across artists');
select is((select data->'summary'->'period' from dashboard_result),
 '{"new_subscriptions":3,"cancellations":1,"renewal_due":3,"renewal_paid":1,"renewal_rate":33.33}'::jsonb,
 'verified first charge, paid cancellation, obligation cohort and late approval are distinct metrics');
select is(pg_temp.dashboard(pg_temp.artist())->'summary'->'current',
 '{"total_subscriptions":8,"subscribers":4,"active_paid":2,"grace":1,"canceled_paid":1,"pending":1,"expired":1,"out_of_access":2}'::jsonb,
 'artist filter scopes all current counts');
select is(pg_temp.dashboard(pg_temp.artist())->'summary'->'period',
 '{"new_subscriptions":2,"cancellations":1,"renewal_due":3,"renewal_paid":1,"renewal_rate":33.33}'::jsonb,'artist filter scopes full historical cohort');
select is(pg_temp.dashboard(pg_temp.artist())->'selected_artist'->>'id',pg_temp.artist()::text,'artist selection returns public-safe identity');
select is((pg_temp.dashboard(pg_temp.artist())->>'total_artists')::integer,1,'selected artist keeps one row');
select is(jsonb_array_length(pg_temp.dashboard(pg_temp.artist())->'artists'),1,'artist filtered rows are bounded');
select is(pg_temp.dashboard('af200000-0000-4000-8000-000000000002')->'summary'->'period'->'renewal_rate','null'::jsonb,'zero denominator is undefined not zero percent');
select is(pg_temp.dashboard(null,2)->'artists','[]'::jsonb,'past final page is explicitly empty');
select is(pg_temp.dashboard(null,2)->'summary',(select data->'summary' from dashboard_result),'global summary is independent of pagination');
select is(pg_temp.dashboard(null,2)->>'has_more','false','empty page has no more rows');
select ok((select data::text not like '%private-%' and data::text not like '%@example.invalid%' and data::text not like '%af100000%'
  and data::text not like '%af300000%' and data::text not like '%amount_krw%' from dashboard_result),'no fan identifiers, personal details, payment keys, ledger amounts or provider identifiers are projected');
select is((select count(*) from jsonb_object_keys((select data from dashboard_result))),14::bigint,'top-level DTO stays explicit');
select is((select count(*) from jsonb_object_keys((select data->'artists'->0 from dashboard_result))),6::bigint,'artist DTO stays public-safe and aggregate-only');
select throws_ok($$select public.admin_subscription_dashboard(null,'2020-01-31')$$,'22023','ADMIN_SUBSCRIPTIONS_INVALID_INPUT','missing start rejected');
select throws_ok($$select public.admin_subscription_dashboard('2020-01-01',null)$$,'22023','ADMIN_SUBSCRIPTIONS_INVALID_INPUT','missing end rejected');
select throws_ok($$select public.admin_subscription_dashboard('infinity','infinity')$$,'22023','ADMIN_SUBSCRIPTIONS_INVALID_INPUT','nonfinite dates rejected');
select throws_ok($$select public.admin_subscription_dashboard('1999-12-31','2000-01-01')$$,'22023','ADMIN_SUBSCRIPTIONS_INVALID_INPUT','lower supported date boundary enforced');
select throws_ok($$select public.admin_subscription_dashboard('2020-02-01','2020-01-31')$$,'22023','ADMIN_SUBSCRIPTIONS_INVALID_INPUT','inverted range rejected');
select throws_ok($$select public.admin_subscription_dashboard('2020-01-01','2021-01-01')$$,'22023','ADMIN_SUBSCRIPTIONS_INVALID_INPUT','more than366 inclusive days rejected');
select throws_ok($$select public.admin_subscription_dashboard((clock_timestamp() at time zone 'Asia/Seoul')::date,(clock_timestamp() at time zone 'Asia/Seoul')::date+1)$$,
 '22023','ADMIN_SUBSCRIPTIONS_INVALID_INPUT','future end day rejected');
select lives_ok($$select public.admin_subscription_dashboard('2020-01-01','2020-12-31')$$,'exact366-day leap-year range accepted');
select lives_ok($$select public.admin_subscription_dashboard('2020-01-01','2020-01-01')$$,'one complete calendar day accepted');
select throws_ok($$select pg_temp.dashboard(null,0)$$,'22023','ADMIN_SUBSCRIPTIONS_INVALID_INPUT','zero page rejected');
select throws_ok($$select pg_temp.dashboard(null,1001)$$,'22023','ADMIN_SUBSCRIPTIONS_INVALID_INPUT','page upper bound enforced');
select throws_ok($$select pg_temp.dashboard(null,null)$$,'22023','ADMIN_SUBSCRIPTIONS_INVALID_INPUT','null page rejected');
select throws_ok($$select pg_temp.dashboard('af200000-0000-4000-8000-999999999999')$$,'P0002','ADMIN_SUBSCRIPTIONS_NOT_FOUND','unknown artist is not a fabricated empty dashboard');
reset role;
-- Refunds never become cancellation/new/renewal numerators and retries do not multiply obligations.
insert into public.payment_events(subscription_id,kind,amount_krw,provider,original_event_id,period_start,period_end,occurred_at,recorded_at)
select subscription_id,'refund',-100,'toss',id,period_start,period_end,'2020-01-25 00:00:00+00','2020-01-25 00:00:00+00'
from public.payment_events where subscription_id=pg_temp.sid(1);
-- A raw charge without provider verification is not counted as verified new payment.
insert into public.payment_events(subscription_id,kind,amount_krw,provider,period_start,period_end,occurred_at)
values(pg_temp.sid(4),'charge',1000,'toss','2020-01-01','2020-02-01','2020-01-01');
update public.subscriptions set canceled_at=canceled_at where id=pg_temp.sid(5);
select is((select count(*) from private.subscription_cancellation_history),2::bigint,'same cancellation update remains idempotent');
update public.subscriptions set status='pending',canceled_at=null where id=pg_temp.sid(5);
select is((select count(*) from private.subscription_cancellation_history where was_paid),1::bigint,'reactivation cannot erase prior paid cancellation evidence');
update public.subscriptions set status='canceled',canceled_at='2020-01-28 00:00:00+00' where id=pg_temp.sid(5);
select is((select count(*) from private.subscription_cancellation_history where was_paid),1::bigint,'previously paid pending reactivation abort is not a paid cancellation');
update public.subscriptions set status='active',canceled_at=null where id=pg_temp.sid(5);
select pg_temp.charge(5,'2020-01-29 00:00:00+00');
update public.subscriptions set status='canceled',canceled_at='2020-01-30 00:00:00+00' where id=pg_temp.sid(5);
select is((select count(*) from private.subscription_cancellation_history where was_paid),2::bigint,'later paid episode cancellation is its own event');
set local role authenticated;
select is(pg_temp.dashboard()->'summary'->'period',
 '{"new_subscriptions":3,"cancellations":2,"renewal_due":3,"renewal_paid":1,"renewal_rate":33.33}'::jsonb,
 'immutable money and cancellation facts remain separate across refunds, unverified attempts and reactivation');
select set_config('request.jwt.claim.sub','af100000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"role":"admin"}',true);
select throws_ok($$select pg_temp.dashboard()$$,'42501','ADMIN_SUBSCRIPTIONS_FORBIDDEN','fan cannot claim admin in JWT metadata');
select set_config('request.jwt.claim.sub','af100000-0000-4000-8000-000000000011',true);
select throws_ok($$select pg_temp.dashboard()$$,'42501','ADMIN_SUBSCRIPTIONS_FORBIDDEN','artist cannot inspect dashboard');
select set_config('request.jwt.claim.sub','af100000-0000-4000-8000-000000000012',true);
select throws_ok($$select pg_temp.dashboard()$$,'42501','ADMIN_SUBSCRIPTIONS_FORBIDDEN','restricted administrator denied');
select set_config('request.jwt.claim.sub','af100000-0000-4000-8000-000000000099',true);
select throws_ok($$select pg_temp.dashboard()$$,'42501','ADMIN_SUBSCRIPTIONS_FORBIDDEN','missing actor denied');
reset role;
update public.profiles set role='fan' where id='af100000-0000-4000-8000-000000000010';
set local role authenticated;
select set_config('request.jwt.claim.sub','af100000-0000-4000-8000-000000000010',true);
select throws_ok($$select pg_temp.dashboard()$$,'42501','ADMIN_SUBSCRIPTIONS_FORBIDDEN','current role loss checked every read');
reset role;
update public.profiles set role='admin',is_restricted=true,restricted_until=now()-interval '1 second' where id='af100000-0000-4000-8000-000000000010';
set local role authenticated;
select lives_ok($$select pg_temp.dashboard()$$,'expired restriction does not incorrectly deny admin');
reset role;
-- Pagination tie-breaks by UUID and retains zero-subscription artists in all statuses.
insert into public.artists(id,slug,name,grade,status)
select ('af900000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'dashboard-zero-'||n,'Same name','B',
 case when n%2=0 then 'draft' else 'retired' end::public.artist_status from generate_series(1,21)n;
set local role authenticated;
select is(jsonb_array_length(pg_temp.dashboard()->'artists'),20,'first page capped20');
select is(pg_temp.dashboard()->>'has_more','true','pagination exposes remaining artists');
select is(jsonb_array_length(pg_temp.dashboard(null,2)->'artists'),5,'next page retains zero-subscription artists');
select is(pg_temp.dashboard(null,2)->'artists'->0->>'id','af900000-0000-4000-8000-000000000019','tied names use deterministic UUID boundary');
select is(pg_temp.dashboard(null,2)->'artists'->0->'period'->'renewal_rate','null'::jsonb,'zero-activity artist has no fabricated conversion');
select is(pg_temp.dashboard(null,2)->>'total_artists','25','total includes all states');
select * from finish();
rollback;
