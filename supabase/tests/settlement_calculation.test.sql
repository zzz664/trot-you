begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
set local timezone='UTC';
select no_plan();

-- Fictional rollback-only historical ledger fixtures. Verification rows are
-- owner-provisioned test evidence, not proof of any external payment or policy.
create temporary table calculation_context(key text primary key,data jsonb);
grant all on calculation_context to authenticated;
insert into auth.users(id,email,raw_user_meta_data) values
 ('d4010000-0000-4000-8000-000000000001','calculation-admin@example.invalid','{}'),
 ('d4010000-0000-4000-8000-000000000002','calculation-fan@example.invalid','{}'),
 ('d4010000-0000-4000-8000-000000000003','calculation-artist@example.invalid','{}');
update public.profiles set role='admin' where id='d4010000-0000-4000-8000-000000000001';
update public.profiles set role='artist' where id='d4010000-0000-4000-8000-000000000003';
insert into public.artists(id,slug,name,grade,status) values
 ('d4020000-0000-4000-8000-000000000001','calculation-main','Fictional calculation artist','B','active'),
 ('d4020000-0000-4000-8000-000000000002','calculation-other','Fictional other artist','B','active');
insert into public.artist_members(artist_id,user_id) values('d4020000-0000-4000-8000-000000000001','d4010000-0000-4000-8000-000000000003');
insert into public.subscriptions(id,user_id,artist_id,provider) values
 ('d4030000-0000-4000-8000-000000000001','d4010000-0000-4000-8000-000000000002','d4020000-0000-4000-8000-000000000001','toss'),
 ('d4030000-0000-4000-8000-000000000002','d4010000-0000-4000-8000-000000000002','d4020000-0000-4000-8000-000000000002','kakaopay');
insert into public.payment_events(id,subscription_id,kind,amount_krw,provider,period_start,period_end,occurred_at)
select ('d4040000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 case when n=6 then 'd4030000-0000-4000-8000-000000000002'::uuid else 'd4030000-0000-4000-8000-000000000001'::uuid end,
 'charge',amount,case when n=6 then 'kakaopay'::public.payment_provider else 'toss'::public.payment_provider end,
 '2026-01-01 00:00+09','2026-02-01 00:00+09',happened from (values
 (1,10000,'2026-01-01 00:00+09'::timestamptz),
 (2,1001,'2026-01-31 23:59:59.999999+09'::timestamptz),
 (3,7000,'2025-12-31 23:59:59.999999+09'::timestamptz),
 (4,20000,'2026-02-01 00:00+09'::timestamptz),
 (5,999999,'2026-01-10 00:00+09'::timestamptz),
 (6,888888,'2026-01-10 00:00+09'::timestamptz)) x(n,amount,happened);
insert into public.payment_events(id,subscription_id,kind,amount_krw,provider,original_event_id,period_start,period_end,occurred_at)
values('d4040000-0000-4000-8000-000000000007','d4030000-0000-4000-8000-000000000001','refund',-500,'toss',
 'd4040000-0000-4000-8000-000000000001','2026-01-01 00:00+09','2026-02-01 00:00+09','2026-01-15 00:00+09');
insert into private.payment_event_verifications(event_id,provider,environment,merchant_account,provider_action_id,evidence_ref)
select id,provider,'test','fictional-calculation-merchant',id::text,gen_random_uuid() from public.payment_events
where id::text like 'd4040000-%' and id<>'d4040000-0000-4000-8000-000000000005';
insert into public.messages(id,artist_id,author_id,type,body,status,scheduled_at,sent_at)
select ('d4050000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'d4020000-0000-4000-8000-000000000001',
 'd4010000-0000-4000-8000-000000000003',case when n=1 then 'photo'::public.message_type else 'text'::public.message_type end,
 'Private fictional message body','sent',happened,happened from (values
 (1,'2026-01-01 00:00+09'::timestamptz),(2,'2026-01-31 23:59:59.999999+09'::timestamptz),
 (3,'2025-12-31 23:59:59.999999+09'::timestamptz),(4,'2026-02-01 00:00+09'::timestamptz)) x(n,happened);
insert into public.messages(artist_id,author_id,type,body,status,scheduled_at,sent_at,canceled_at) values
 ('d4020000-0000-4000-8000-000000000001','d4010000-0000-4000-8000-000000000003','photo',null,'canceled','2026-01-02+09','2026-01-02+09','2026-01-02 00:01+09');

select is((select count(*) from private.settlement_policies),0::bigint,'migration never provisions or approves a financial policy');
select ok(has_function_privilege('authenticated','public.settlement_calculation_input(uuid,date)','execute'),'authenticated has guarded entrypoint');
select ok(not has_function_privilege('anon','public.settlement_calculation_input(uuid,date)','execute'),'anonymous cannot invoke calculation inputs');
select ok(not has_function_privilege('service_role','public.settlement_calculation_input(uuid,date)','execute'),'service key cannot impersonate administrator');
select is((select provolatile::text from pg_proc where oid='public.settlement_calculation_input(uuid,date)'::regprocedure),'v','fenced reader remains volatile for fresh post-wait snapshots');
select is((select proconfig from pg_proc where oid='public.settlement_calculation_input(uuid,date)'::regprocedure),array['search_path=""','TimeZone=UTC'],'security definer has empty search path and stable UTC transport');
set local role authenticated;
select set_config('request.jwt.claim.sub','d4010000-0000-4000-8000-000000000001',true);
select throws_ok($$select public.settlement_calculation_input('d4020000-0000-4000-8000-000000000001','2026-01-01')$$,'55000','SETTLEMENT_POLICY_REQUIRED','missing approved monthly policy fails closed');
select throws_ok($$select public.settlement_calculation_input(null,'2026-01-01')$$,'22023','SETTLEMENT_MONTH_INVALID','artist cannot be inferred');
select throws_ok($$select public.settlement_calculation_input('d4020000-0000-4000-8000-000000000001',null)$$,'22023','SETTLEMENT_MONTH_INVALID','month cannot be inferred');
select throws_ok($$select public.settlement_calculation_input('d4020000-0000-4000-8000-000000000001','2026-01-02')$$,'22023','SETTLEMENT_MONTH_INVALID','month first-day invariant');
select throws_ok($$select public.settlement_calculation_input('d4020000-0000-4000-8000-000000000001','infinity')$$,'22023','SETTLEMENT_MONTH_INVALID','infinite dates fail closed');
select throws_ok($$select public.settlement_calculation_input('d4020000-0000-4000-8000-000000000001','1999-12-01')$$,'22023','SETTLEMENT_MONTH_INVALID','unsupported historical timezone period fails closed');
select throws_ok($$select public.settlement_calculation_input('d4020000-0000-4000-8000-000000000001','9999-01-01')$$,'22023','SETTLEMENT_MONTH_INVALID','extended-year boundary fails closed');
select throws_ok($$select public.settlement_calculation_input('d4020000-0000-4000-8000-000000000099','2026-01-01')$$,'P0002','SETTLEMENT_NOT_FOUND','unknown artist is not an empty revenue result');
select throws_ok($$select public.settlement_calculation_input('d4020000-0000-4000-8000-000000000001',date_trunc('month',clock_timestamp() at time zone 'Asia/Seoul')::date)$$,'55000','SETTLEMENT_MONTH_OPEN','open KST month cannot be calculated');
reset role;
insert into private.settlement_policies(artist_id,month,contract_from,contract_until,base_rate,performance_rate,vat_rate,pg_fee_rate,activity_enabled,weekly_message_min,weekly_photo_min)
values('d4020000-0000-4000-8000-000000000001','2026-01-01','2026-01-01','2026-02-01',0.300000,0.400000,0.100000,0.030000,true,3,2);
set local role authenticated;
select throws_ok($$select public.settlement_calculation_input('d4020000-0000-4000-8000-000000000001','2026-01-01')$$,'55000','SETTLEMENT_POLICY_REQUIRED','disabled draft policy stays unavailable');
reset role;
update private.settlement_policies set enabled=true;
set local role authenticated;
select throws_ok($$select public.settlement_calculation_input('d4020000-0000-4000-8000-000000000001','2026-01-01')$$,'55000','SETTLEMENT_PARTIAL_WEEK_POLICY_REQUIRED','partial-week rule is not invented');
reset role;
update private.settlement_policies set partial_week_policy='prorate_days',contract_from='2026-01-02';
set local role authenticated;
select throws_ok($$select public.settlement_calculation_input('d4020000-0000-4000-8000-000000000001','2026-01-01')$$,'55000','SETTLEMENT_FULL_MONTH_CONTRACT_REQUIRED','partial-month start is not silently prorated');
reset role;
update private.settlement_policies set contract_from='2026-01-01',contract_until='2026-01-31';
set local role authenticated;
select throws_ok($$select public.settlement_calculation_input('d4020000-0000-4000-8000-000000000001','2026-01-01')$$,'55000','SETTLEMENT_FULL_MONTH_CONTRACT_REQUIRED','exclusive month end must be covered');
reset role;
update private.settlement_policies set contract_until='2026-02-01';
insert into calculation_context select 'before',jsonb_build_object(
 'reports',(select jsonb_agg(to_jsonb(r)) from public.settlements r),
 'events',(select jsonb_agg(to_jsonb(e) order by id) from public.payment_events e),
 'verifications',(select jsonb_agg(to_jsonb(v) order by event_id) from private.payment_event_verifications v),
 'messages',(select jsonb_agg(to_jsonb(m) order by id) from public.messages m),
 'policies',(select jsonb_agg(to_jsonb(p) order by id) from private.settlement_policies p),
 'versions',(select jsonb_agg(to_jsonb(v) order by version) from private.settlement_source_versions v));
set local role authenticated;
insert into calculation_context values('result',public.settlement_calculation_input('d4020000-0000-4000-8000-000000000001','2026-01-01'));
select is((select data->>'actorId' from calculation_context where key='result'),'d4010000-0000-4000-8000-000000000001','server authority binds the input envelope');
select is((select data#>>'{input,artistId}' from calculation_context where key='result'),'d4020000-0000-4000-8000-000000000001','artist input identity is preserved');
select is((select data#>>'{input,month}' from calculation_context where key='result'),'2026-01-01','month uses stable ISO transport');
select ok((select (data#>>'{input,asOf}')::timestamptz<=clock_timestamp() from calculation_context where key='result'),'snapshot has server-owned observation time');
select is((select jsonb_array_length(data#>'{input,events}') from calculation_context where key='result'),3,'only verified in-month same-artist money is selected');
select is((select sum((e->>'amountKrw')::numeric) from calculation_context c cross join lateral jsonb_array_elements(c.data#>'{input,events}') e where c.key='result'),10501::numeric,'refund is signed negative and unverified/other-period money is excluded');
select ok((select bool_and(jsonb_typeof(e->'amountKrw')='string' and e->>'verified'='true' and e->>'currency'='KRW' and e->>'origin'='current') from calculation_context c cross join lateral jsonb_array_elements(c.data#>'{input,events}') e where c.key='result'),'financial amounts travel only as verified integer text');
select is((select data#>>'{input,events,1,kind}' from calculation_context where key='result'),'refund','ledger kind remains charge/refund, never mutable attempt classification');
select is((select data#>>'{input,events,1,amountKrw}' from calculation_context where key='result'),'-500','negative refund text is lossless');
select is((select data#>>'{input,events,2,occurredAt}' from calculation_context where key='result'),'2026-01-31T14:59:59.999999+00:00','sub-millisecond inclusive boundary is retained');
select is((select jsonb_array_length(data#>'{input,messages}') from calculation_context where key='result'),2,'only sent in-month messages feed weekly aggregation');
select is((select data#>>'{input,messages,0,type}' from calculation_context where key='result'),'photo','photo messages are counted, not attached media');
select is((select data#>>'{input,policy,baseRate}' from calculation_context where key='result'),'0.300000','rate decimal scale is lossless');
select is((select data#>>'{input,policy,pgFeeRate}' from calculation_context where key='result'),'0.030000','PG fee is monthly approved policy, not defaults');
select is((select data#>'{input,policy,performanceConditions}' from calculation_context where key='result'),'null'::jsonb,'unapproved performance thresholds are never invented');
select is((select data#>>'{input,policy,partialWeekPolicy}' from calculation_context where key='result'),'prorate_days','explicit clipped-week accounting choice is preserved');
select is((select jsonb_typeof(data#>'{input,sourceVersion}') from calculation_context where key='result'),'string','source version never crosses an unsafe JS integer');
select ok((select not(data::text like '%Private fictional message body%' or data::text like '%subscriptionId%' or data::text like '%merchant%' or data::text like '%providerAction%' or data::text like '%evidenceRef%') from calculation_context where key='result'),'input DTO contains no fan, message body or provider-secret evidence');
set local timezone='Pacific/Honolulu';
select is(public.settlement_calculation_input('d4020000-0000-4000-8000-000000000001','2026-01-01')#>'{input,events}',(select data#>'{input,events}' from calculation_context where key='result'),'session timezone cannot move KST ledger boundaries or transport');
set local datestyle='SQL, DMY';
select is(public.settlement_calculation_input('d4020000-0000-4000-8000-000000000001','2026-01-01')#>>'{input,month}','2026-01-01','session date display cannot change ISO month');
reset role;
set local timezone='UTC'; set local datestyle='ISO, MDY';
select is(jsonb_build_object(
 'reports',(select jsonb_agg(to_jsonb(r)) from public.settlements r),
 'events',(select jsonb_agg(to_jsonb(e) order by id) from public.payment_events e),
 'verifications',(select jsonb_agg(to_jsonb(v) order by event_id) from private.payment_event_verifications v),
 'messages',(select jsonb_agg(to_jsonb(m) order by id) from public.messages m),
 'policies',(select jsonb_agg(to_jsonb(p) order by id) from private.settlement_policies p),
 'versions',(select jsonb_agg(to_jsonb(v) order by version) from private.settlement_source_versions v)),
 (select data from calculation_context where key='before'),'repeated preview is read-only for report, ledger, message, policy and version state');
set local timezone='UTC'; set local datestyle='ISO, MDY';
set local role authenticated;
select set_config('request.jwt.claim.sub','d4010000-0000-4000-8000-000000000002',true);
select set_config('request.jwt.claim.role','admin',true);
select throws_ok($$select public.settlement_calculation_input('d4020000-0000-4000-8000-000000000001','2026-01-01')$$,'42501','SETTLEMENT_ADMIN_REQUIRED','fan and forged JWT role cannot obtain money inputs');
select set_config('request.jwt.claim.sub','d4010000-0000-4000-8000-000000000003',true);
select throws_ok($$select public.settlement_calculation_input('d4020000-0000-4000-8000-000000000001','2026-01-01')$$,'42501','SETTLEMENT_ADMIN_REQUIRED','artist membership does not grant draft calculation access');
select set_config('request.jwt.claim.sub','d4010000-0000-4000-8000-000000000001',true);
reset role;
update public.profiles set is_restricted=true where id='d4010000-0000-4000-8000-000000000001';
set local role authenticated;
select throws_ok($$select public.settlement_calculation_input('d4020000-0000-4000-8000-000000000001','2026-01-01')$$,'42501','SETTLEMENT_ADMIN_REQUIRED','restricted current administrator fails closed');
reset role;
update public.profiles set restricted_until=clock_timestamp()-interval '1 second' where id='d4010000-0000-4000-8000-000000000001';
set local role authenticated;
select lives_ok($$select public.settlement_calculation_input('d4020000-0000-4000-8000-000000000001','2026-01-01')$$,'expired restriction no longer denies current administrator');
insert into calculation_context values('draft',to_jsonb(public.settlement_calculate('d4020000-0000-4000-8000-000000000001','2026-01-01')));
select lives_ok($$select public.settlement_calculation_input('d4020000-0000-4000-8000-000000000001','2026-01-01')$$,'existing same-month draft assignment does not disappear or duplicate');
insert into calculation_context select 'draft-before',to_jsonb(r) from public.settlements r where id=(select (data#>>'{}')::uuid from calculation_context where key='draft');
select public.settlement_calculation_input('d4020000-0000-4000-8000-000000000001','2026-01-01');
select is((select to_jsonb(r) from public.settlements r where id=(select (data#>>'{}')::uuid from calculation_context where key='draft')),(select data from calculation_context where key='draft-before'),'preview never updates draft revision or contents');
select public.settlement_confirm(id,revision) from public.settlements where id=(select (data#>>'{}')::uuid from calculation_context where key='draft');
select throws_ok($$select public.settlement_calculation_input('d4020000-0000-4000-8000-000000000001','2026-01-01')$$,'55000','SETTLEMENT_CONFIRMED','confirmed month never becomes a new recalculation preview');
reset role;
-- A prior charge refunded now follows occurrence month; a backdated late event
-- from a confirmed month needs the existing explicit assignment mechanism.
insert into private.settlement_policies(artist_id,month,enabled,contract_from,contract_until,base_rate,performance_rate,vat_rate,pg_fee_rate,activity_enabled)
values('d4020000-0000-4000-8000-000000000001','2026-02-01',true,'2026-01-01','2026-04-01',0.3,0.4,0.1,0.03,false),
 ('d4020000-0000-4000-8000-000000000001','2026-03-01',true,'2026-01-01','2026-04-01',0.3,0.4,0.1,0.03,false);
set local role service_role;
select public.billing_record_refund('d4040000-0000-4000-8000-000000000001','fictional-calculation-late',600,'KRW','2026-01-20 00:00+09',gen_random_uuid());
select public.billing_record_refund('d4040000-0000-4000-8000-000000000001','fictional-calculation-current-refund',700,'KRW','2026-02-10 00:00+09',gen_random_uuid());
reset role;
set local role authenticated;
insert into calculation_context values('feb-before',public.settlement_calculation_input('d4020000-0000-4000-8000-000000000001','2026-02-01'));
select is((select jsonb_array_length(data#>'{input,events}') from calculation_context where key='feb-before'),2,'late prior-month event is not silently added without explicit queue');
select is((select sum((e->>'amountKrw')::numeric) from calculation_context c cross join lateral jsonb_array_elements(c.data#>'{input,events}') e where c.key='feb-before'),19300::numeric,'current-month refund of old charge reduces current-month recognized gross');
reset role;
update private.settlement_policies set late_event_policy='explicit_current_formula' where month='2026-02-01';
set local role authenticated;
select public.settlement_queue_adjustment(id,'2026-02-01') from public.payment_events where amount_krw=-600 and subscription_id='d4030000-0000-4000-8000-000000000001';
insert into calculation_context values('feb-after',public.settlement_calculation_input('d4020000-0000-4000-8000-000000000001','2026-02-01'));
select is((select jsonb_array_length(data#>'{input,events}') from calculation_context where key='feb-after'),3,'one explicitly queued late event joins current month sources once');
select is((select sum((e->>'amountKrw')::numeric) from calculation_context c cross join lateral jsonb_array_elements(c.data#>'{input,events}') e where c.key='feb-after'),18700::numeric,'signed late refund and current refund remain separate events');
select is((select count(*) from calculation_context c cross join lateral jsonb_array_elements(c.data#>'{input,events}') e where c.key='feb-after' and e->>'origin'='adjustment'),1::bigint,'explicit adjustment carries audit origin');
select is((select data#>>'{input,policy,lateEventPolicy}' from calculation_context where key='feb-after'),'explicit_current_formula','target-month valuation rule is visible rather than inferred original rate reversal');
reset role;
update private.settlement_policies set late_event_policy='block' where month='2026-02-01';
set local role authenticated;
select throws_ok($$select public.settlement_calculation_input('d4020000-0000-4000-8000-000000000001','2026-02-01')$$,'55000','SETTLEMENT_ADJUSTMENT_POLICY_REQUIRED','revoked current adjustment rule blocks previously queued adjustment');
reset role;
update private.settlement_policies set late_event_policy='explicit_current_formula' where month='2026-02-01';
set local role authenticated;
select public.settlement_calculate('d4020000-0000-4000-8000-000000000001','2026-02-01');
select public.settlement_calculate('d4020000-0000-4000-8000-000000000001','2026-03-01');
reset role;
update private.settlement_event_sources set report_id=(select id from public.settlements where artist_id='d4020000-0000-4000-8000-000000000001' and month='2026-03-01')
 where event_id='d4040000-0000-4000-8000-000000000004';
set local role authenticated;
select throws_ok($$select public.settlement_calculation_input('d4020000-0000-4000-8000-000000000001','2026-02-01')$$,'55000','SETTLEMENT_SOURCE_MISMATCH','event assigned to a different report cannot be silently omitted or counted again');
reset role;
select * from finish();
rollback;
