begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();

-- Fictional rollback-only fixtures. One historical charge uses actual billing
-- RPCs with an owner-only attempt-clock fixture; further boundary events are
-- owner-inserted verified historical fixtures, never provider verification.
create temporary table settlement_context(key text primary key,id uuid,data jsonb);
grant all on settlement_context to authenticated,service_role;
insert into auth.users(id,email,raw_user_meta_data) values
 ('51000000-0000-4000-8000-000000000001','settlement-fan@example.invalid','{}'),
 ('51000000-0000-4000-8000-000000000002','settlement-artist@example.invalid','{}'),
 ('51000000-0000-4000-8000-000000000003','settlement-admin@example.invalid','{}');
update public.profiles set call_name='가상 정산 사용자',onboarding_completed_at=clock_timestamp() where id::text like '51000000-%';
update public.profiles set role='artist' where id='51000000-0000-4000-8000-000000000002';
update public.profiles set role='admin' where id='51000000-0000-4000-8000-000000000003';
insert into public.artists(id,slug,name,grade,status) values
 ('52000000-0000-4000-8000-000000000001','settlement-main','가상 정산 가수','B','active'),
 ('52000000-0000-4000-8000-000000000002','settlement-other','가상 정산 타가수','B','active');
insert into public.artist_members(artist_id,user_id) values('52000000-0000-4000-8000-000000000001','51000000-0000-4000-8000-000000000002');
select is((select count(*) from private.settlement_policies),0::bigint,'migration does not activate operational rates or contract policy');
set local role service_role;
insert into settlement_context(key,id) values('subscription',public.billing_open_subscription('51000000-0000-4000-8000-000000000001','52000000-0000-4000-8000-000000000001','toss'));
select public.billing_register_mandate((select id from settlement_context where key='subscription'),'test','fictional-settlement-merchant',gen_random_uuid(),gen_random_uuid(),'fictional-consent');
insert into settlement_context(key,id) values('obligation',public.billing_prepare_obligation((select id from settlement_context where key='subscription'),
 '2026-01-01 00:00+09','2026-02-01 00:00+09',10000,true,'fictional-settlement-price',0,86400,0));
insert into settlement_context(key,id) values('attempt',public.billing_prepare_attempt((select id from settlement_context where key='obligation')));
select public.billing_claim_attempt((select id from settlement_context where key='attempt'),120);
reset role;
update private.payment_attempts set created_at='2026-01-01 00:00+09' where id=(select id from settlement_context where key='attempt');
set local role service_role;
insert into settlement_context(key,id) values('charge',public.billing_finalize_charge((select id from settlement_context where key='attempt'),
 'fictional-settlement-first',10000,'KRW','2026-01-01 00:00+09',gen_random_uuid()));
insert into settlement_context(key,id) values('refund',public.billing_record_refund((select id from settlement_context where key='charge'),
 'fictional-settlement-refund',500,'KRW','2026-01-15 00:00+09',gen_random_uuid()));
reset role;
insert into public.payment_events(id,subscription_id,kind,amount_krw,provider,period_start,period_end,occurred_at)
select ('53000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,(select id from settlement_context where key='subscription'),'charge',amount,'toss',
 '2026-01-01 00:00+09','2026-02-01 00:00+09',happened from (values
 (1,7000,'2025-12-31 23:59:59.999999+09'::timestamptz),
 (2,1001,'2026-01-31 23:59:59.999999+09'::timestamptz),
 (3,20000,'2026-02-01 00:00+09'::timestamptz),
 (4,999999,'2026-01-10 00:00+09'::timestamptz)) x(n,amount,happened);
insert into private.payment_event_verifications(event_id,provider,environment,merchant_account,provider_action_id,evidence_ref)
select id,'toss','test','fictional-settlement-merchant',id::text,gen_random_uuid() from public.payment_events
where id in ('53000000-0000-4000-8000-000000000001','53000000-0000-4000-8000-000000000002','53000000-0000-4000-8000-000000000003');
-- Jan has seven sent messages, including three photo messages, not photo files.
insert into public.messages(id,artist_id,author_id,type,body,status,scheduled_at,sent_at)
select ('54000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'52000000-0000-4000-8000-000000000001','51000000-0000-4000-8000-000000000002',
 case when n in(1,3,7) then 'photo'::public.message_type else 'text'::public.message_type end,'Fictional body','sent',happened,happened
from (values(1,'2026-01-01 00:00+09'::timestamptz),(2,'2026-01-04 23:59:59+09'::timestamptz),
 (3,'2026-01-05 00:00+09'::timestamptz),(4,'2026-01-11 23:00+09'::timestamptz),
 (5,'2026-01-17 00:00+09'::timestamptz),(6,'2026-01-24 00:00+09'::timestamptz),
 (7,'2026-01-31 23:59:59.999999+09'::timestamptz),(8,'2025-12-31 23:59:59.999999+09'::timestamptz),
 (9,'2026-02-01 00:00+09'::timestamptz)) x(n,happened);
insert into public.messages(artist_id,author_id,type,body,status,scheduled_at,sent_at,canceled_at) values
 ('52000000-0000-4000-8000-000000000001','51000000-0000-4000-8000-000000000002','photo',null,'canceled','2026-01-02+09','2026-01-02+09','2026-01-02 00:01+09');
set local role authenticated;
select set_config('request.jwt.claim.sub','51000000-0000-4000-8000-000000000003',true);
select throws_ok($$select public.settlement_calculate('52000000-0000-4000-8000-000000000001','2026-01-01')$$,'55000','SETTLEMENT_POLICY_REQUIRED','missing policy fails closed');
select throws_ok($$select public.settlement_calculate('52000000-0000-4000-8000-000000000001',null)$$,'22023','SETTLEMENT_MONTH_INVALID','NULL month is not inferred');
select throws_ok($$select public.settlement_calculate(null,'2026-01-01')$$,'22023','SETTLEMENT_MONTH_INVALID','NULL artist is rejected');
select throws_ok($$select public.settlement_calculate('52000000-0000-4000-8000-000000000001','2026-01-02')$$,'22023','SETTLEMENT_MONTH_INVALID','report month must start on first day');
select throws_ok($$select public.settlement_calculate('52000000-0000-4000-8000-000000000001','infinity')$$,'22023','SETTLEMENT_MONTH_INVALID','infinite month is rejected');
select throws_ok($$select public.settlement_calculate('52000000-0000-4000-8000-000000000001',date_trunc('month',clock_timestamp() at time zone 'Asia/Seoul')::date)$$,'55000','SETTLEMENT_MONTH_OPEN','open KST month cannot be reported');
reset role;
insert into private.settlement_policies(artist_id,month,contract_from,contract_until,base_rate,performance_rate,vat_rate,pg_fee_rate,
 activity_enabled,weekly_message_min,weekly_photo_min) values('52000000-0000-4000-8000-000000000001','2026-01-01','2026-01-01','2026-02-01',0.30,0.40,0.10,0.03,true,3,2);
set local role authenticated;
select throws_ok($$select public.settlement_calculate('52000000-0000-4000-8000-000000000001','2026-01-01')$$,'55000','SETTLEMENT_POLICY_REQUIRED','new policy stays disabled');
reset role;
update private.settlement_policies set enabled=true;
set local role authenticated;
select throws_ok($$select public.settlement_calculate('52000000-0000-4000-8000-000000000001','2026-01-01')$$,'55000','SETTLEMENT_PARTIAL_WEEK_POLICY_REQUIRED','partial weeks require explicit policy');
reset role;
update private.settlement_policies set partial_week_policy='prorate_days',contract_from='2026-01-02';
set local role authenticated;
select throws_ok($$select public.settlement_calculate('52000000-0000-4000-8000-000000000001','2026-01-01')$$,'55000','SETTLEMENT_FULL_MONTH_CONTRACT_REQUIRED','midmonth contract start is not silently prorated');
reset role;
update private.settlement_policies set contract_from='2026-01-01',contract_until='2026-01-31';
set local role authenticated;
select throws_ok($$select public.settlement_calculate('52000000-0000-4000-8000-000000000001','2026-01-01')$$,'55000','SETTLEMENT_FULL_MONTH_CONTRACT_REQUIRED','contract must cover exclusive month end');
reset role;
update private.settlement_policies set contract_until='2026-02-01';
set local role authenticated;
insert into settlement_context(key,id) values('report',public.settlement_calculate('52000000-0000-4000-8000-000000000001','2026-01-01'));
insert into settlement_context(key,id) select 'revision',revision from public.settlements where id=(select id from settlement_context where key='report');
select is((select status::text from public.settlements),'draft','calculation creates a reviewable draft only');
select is((select period_start from public.settlements),'2025-12-31 15:00+00'::timestamptz,'KST month inclusive start is exact');
select is((select period_end from public.settlements),'2026-01-31 15:00+00'::timestamptz,'KST month exclusive end is exact');
select is((select gross_krw from public.settlements),10501::numeric,'verified charges and negative refund reconcile, unverified event excluded');
select is((select current_gross_krw from public.settlements),10501::numeric,'current subtotal is independently persisted');
select is((select adjustment_gross_krw from public.settlements),0::numeric,'no implied late adjustment is invented');
select is((select source_event_count from public.settlements),3::bigint,'source event IDs match the reported total');
select is((select source_message_count from public.settlements),7::bigint,'sent month messages exclude canceled and out-of-month rows');
select is((select count(*) from public.settlement_report_sources((select id from settlement_context where key='report'))),3::bigint,'admin source RPC returns auditable event set');
select is((select rate from public.settlements),0.30::numeric,'unset performance conditions apply base rate even with higher performance rate');
select is((select policy_snapshot->'performance_conditions' from public.settlements),'null'::jsonb,'disabled performance condition is snapshotted');
select is((select policy_snapshot->>'partial_week_policy' from public.settlements),'prorate_days','explicit partial-week choice is snapshotted');
select is((select vat_krw from public.settlements),10501::numeric*100000/1100000,'VAT division preserves decimal, not integer money');
select is((select pg_fee_krw from public.settlements),10501::numeric*30000/1100000,'fee is calculated after VAT with decimal storage');
select is((select base_amount_krw from public.settlements),10501::numeric*970000/1100000,'base amount retains nonterminating decimal precision');
select is((select activity_ratio from public.settlements),161::numeric/372,'activity ratio uses month-clipped exact weekly requirements');
select is((select final_amount_krw from public.settlements),1202::numeric,'final-only exact rational KRW rounding matches independently derived fraction');
select is((select (exact_components->'final'->>0)::numeric/(exact_components->'final'->>1)::numeric from public.settlements),163994117::numeric/136400,'exact final rational reproduces independent result');
select ok((select vat_krw<>trunc(vat_krw) and pg_fee_krw<>trunc(pg_fee_krw) and deduction_krw<>trunc(deduction_krw) from public.settlements),'decimal intermediate columns do not truncate');
select is((select count(*) from public.settlement_weekly_stats),5::bigint,'January snapshot has five Monday-anchored clipped weeks');
select is((select min(week_start) from public.settlement_weekly_stats),'2025-12-29'::date,'first partial week preserves Monday KST anchor');
select is((select min(window_start) from public.settlement_weekly_stats),'2026-01-01'::date,'first window clips to month start');
select is((select max(window_end) from public.settlement_weekly_stats),'2026-02-01'::date,'last window clips to exclusive month end');
select is((select sum(message_count) from public.settlement_weekly_stats),7::numeric,'weekly message totals reconcile with frozen source IDs');
select is((select sum(photo_count) from public.settlement_weekly_stats),3::numeric,'photo message count is not attachment count');
select is((select message_required from public.settlement_weekly_stats order by week_start limit 1),12::numeric/7,'first four-day week requirement remains fractional');
select is((select photo_required from public.settlement_weekly_stats order by week_start limit 1),8::numeric/7,'photo requirement preserves partial-week fraction');
select is(public.settlement_calculate('52000000-0000-4000-8000-000000000001','2026-01-01'),(select id from settlement_context where key='report'),'draft recalculation keeps report identity');
select isnt((select revision from public.settlements),(select id from settlement_context where key='revision'),'every draft revision is explicit');
select throws_ok($$select public.settlement_confirm((select id from settlement_context where key='report'),(select id from settlement_context where key='revision'))$$,'55000','SETTLEMENT_REVISION_CONFLICT','reviewer of old revision cannot silently approve recalculation');
select throws_ok($$select public.settlement_confirm((select id from settlement_context where key='report'),null)$$,'55000','SETTLEMENT_REVISION_CONFLICT','confirmation requires expected revision');
update settlement_context set id=(select revision from public.settlements) where key='revision';
reset role;
update private.settlement_policies set base_rate=0.31;
set local role authenticated;
select throws_ok($$select public.settlement_confirm((select id from settlement_context where key='report'),(select id from settlement_context where key='revision'))$$,'55000','SETTLEMENT_DRAFT_STALE','policy change invalidates draft source version');
select is((select rate from public.settlements),0.30::numeric,'policy edit never silently recomputes existing draft');
reset role;
update private.settlement_policies set base_rate=0.30;
set local role authenticated;
select public.settlement_calculate('52000000-0000-4000-8000-000000000001','2026-01-01');
update settlement_context set id=(select revision from public.settlements) where key='revision';
reset role;
update public.messages set body='Edited fictional content' where id='54000000-0000-4000-8000-000000000001';
set local role authenticated;
select throws_ok($$select public.settlement_confirm((select id from settlement_context where key='report'),(select id from settlement_context where key='revision'))$$,'55000','SETTLEMENT_DRAFT_STALE','message mutation invalidates snapshot conservatively');
select public.settlement_calculate('52000000-0000-4000-8000-000000000001','2026-01-01');
update settlement_context set id=(select revision from public.settlements) where key='revision';
select lives_ok($$select public.settlement_confirm((select id from settlement_context where key='report'),(select id from settlement_context where key='revision'))$$,'admin can confirm exact reviewed current draft');
select is((select status::text from public.settlements),'confirmed','confirmed status is a report lock, never paid');
select ok((select confirmed_at is not null from public.settlements),'confirmation has database timestamp');
insert into settlement_context(key,data) select 'frozen',to_jsonb(r) from public.settlements r;
select lives_ok($$select public.settlement_confirm((select id from settlement_context where key='report'),(select id from settlement_context where key='revision'))$$,'same confirmed revision retry is idempotent');
select throws_ok($$select public.settlement_calculate('52000000-0000-4000-8000-000000000001','2026-01-01')$$,'55000','SETTLEMENT_CONFIRMED','upsert/recalculation cannot overwrite confirmed report');
reset role;
select throws_ok($$update public.settlements set gross_krw=gross_krw where id=(select id from settlement_context where key='report')$$,'55000','SETTLEMENT_CONFIRMED','even owner no-op UPDATE cannot rewrite confirmed report');
select throws_ok($$delete from public.settlements where id=(select id from settlement_context where key='report')$$,'55000','SETTLEMENT_CONFIRMED','confirmed report deletion is rejected');
select throws_ok($$delete from private.settlement_event_sources where report_id=(select id from settlement_context where key='report')$$,'55000','SETTLEMENT_CONFIRMED','confirmed event set is immutable');
select throws_ok($$update private.settlement_message_sources set type='text' where report_id=(select id from settlement_context where key='report')$$,'55000','SETTLEMENT_CONFIRMED','confirmed message metrics source is immutable');
select throws_ok($$update public.settlement_weekly_stats set message_count=0 where report_id=(select id from settlement_context where key='report')$$,'55000','SETTLEMENT_CONFIRMED','confirmed weekly statistics are immutable');
select throws_ok($$truncate public.settlement_weekly_stats$$,'55000','SETTLEMENT_IMMUTABLE','TRUNCATE cannot bypass weekly immutability');

-- New backdated verified refund commits after a report: explicit later-report
-- allocation only, with target-period valuation selected by provisioned policy.
set local role service_role;
insert into settlement_context(key,id) values('late-refund',public.billing_record_refund((select id from settlement_context where key='charge'),
 'fictional-settlement-late',600,'KRW','2026-01-20 00:00+09',gen_random_uuid()));
reset role;
select is((select to_jsonb(r) from public.settlements r where id=(select id from settlement_context where key='report')),
 (select data from settlement_context where key='frozen'),'new ledger commits never modify confirmed snapshot');
set local role authenticated;
select lives_ok($$select public.settlement_confirm((select id from settlement_context where key='report'),(select id from settlement_context where key='revision'))$$,'confirmed retry remains idempotent after later ledger changes');
select is((select count(*) from public.settlement_pending_adjustments('52000000-0000-4000-8000-000000000001')),1::bigint,'late unallocated verified event is visible to admin as pending');
select throws_ok($$select public.settlement_queue_adjustment((select id from settlement_context where key='late-refund'),'2026-01-01')$$,'22023','SETTLEMENT_ADJUSTMENT_MONTH_INVALID','adjustment cannot target same occurrence month');
select throws_ok($$select public.settlement_queue_adjustment((select id from settlement_context where key='late-refund'),'2025-12-01')$$,'22023','SETTLEMENT_ADJUSTMENT_MONTH_INVALID','adjustment cannot target earlier month');
select throws_ok($$select public.settlement_queue_adjustment((select id from settlement_context where key='late-refund'),'2026-02-02')$$,'22023','SETTLEMENT_ADJUSTMENT_MONTH_INVALID','adjustment target must be a month start');
select throws_ok($$select public.settlement_queue_adjustment('53000000-0000-4000-8000-000000000004','2026-02-01')$$,'22023','SETTLEMENT_VERIFIED_EVENT_REQUIRED','unverified event cannot be queued');
select throws_ok($$select public.settlement_queue_adjustment((select id from settlement_context where key='charge'),'2026-02-01')$$,'55000','SETTLEMENT_EVENT_ALREADY_ASSIGNED','already reported charge cannot be double allocated');
select throws_ok($$select public.settlement_queue_adjustment('53000000-0000-4000-8000-000000000003','2026-03-01')$$,'55000','SETTLEMENT_CONFIRMED_SOURCE_REQUIRED','ordinary event in unconfirmed month is not a late adjustment');
select throws_ok($$select public.settlement_queue_adjustment((select id from settlement_context where key='late-refund'),'2026-02-01')$$,'55000','SETTLEMENT_ADJUSTMENT_POLICY_REQUIRED','late adjustment valuation cannot be assumed');
reset role;
insert into private.settlement_policies(artist_id,month,enabled,contract_from,contract_until,base_rate,performance_rate,vat_rate,pg_fee_rate)
 values('52000000-0000-4000-8000-000000000001','2026-02-01',true,'2026-02-01','2026-03-01',0.50,0.60,0,0);
set local role authenticated;
insert into settlement_context(key,id) values('feb-report',public.settlement_calculate('52000000-0000-4000-8000-000000000001','2026-02-01'));
insert into settlement_context(key,id) select 'feb-revision',revision from public.settlements where month='2026-02-01';
select is((select activity_ratio from public.settlements where month='2026-02-01'),1::numeric,'explicitly disabled activity uses neutral ratio without zero denominator');
select is((select final_amount_krw from public.settlements where month='2026-02-01'),10000::numeric,'normal next-month report excludes late prior-month event');
reset role;
update private.settlement_policies set late_event_policy='explicit_current_formula' where month='2026-02-01';
set local role authenticated;
select lives_ok($$select public.settlement_queue_adjustment((select id from settlement_context where key='late-refund'),'2026-02-01')$$,'admin explicitly allocates late event using selected target formula');
select lives_ok($$select public.settlement_queue_adjustment((select id from settlement_context where key='late-refund'),'2026-02-01')$$,'same adjustment replay is idempotent');
select throws_ok($$select public.settlement_queue_adjustment((select id from settlement_context where key='late-refund'),'2026-03-01')$$,'23514','SETTLEMENT_ADJUSTMENT_CONFLICT','adjustment target cannot silently move');
select throws_ok($$select public.settlement_confirm((select id from settlement_context where key='feb-report'),(select id from settlement_context where key='feb-revision'))$$,'55000','SETTLEMENT_DRAFT_STALE','queued adjustment invalidates a previously reviewed target draft');
select public.settlement_calculate('52000000-0000-4000-8000-000000000001','2026-02-01');
select is((select gross_krw from public.settlements where month='2026-02-01'),19400::numeric,'explicit target gross includes negative late adjustment exactly once');
select is((select current_gross_krw from public.settlements where month='2026-02-01'),20000::numeric,'current-month source subtotal stays separate');
select is((select adjustment_gross_krw from public.settlements where month='2026-02-01'),(-600)::numeric,'late source subtotal is independently auditable');
select is((select final_amount_krw from public.settlements where month='2026-02-01'),9700::numeric,'explicit target-period valuation uses target rate, not invented historical reversal');
select is((select count(*) from public.settlement_pending_adjustments('52000000-0000-4000-8000-000000000001')),0::bigint,'allocated event leaves pending list only after frozen draft source inclusion');
select is((select count(*) from public.settlement_report_sources((select id from settlement_context where key='feb-report')) where origin='adjustment'),1::bigint,'source API identifies adjustment separately');
reset role;
select is((select to_jsonb(r) from public.settlements r where id=(select id from settlement_context where key='report')),
 (select data from settlement_context where key='frozen'),'later report calculation cannot recompute original confirmed report');

-- A later-occurrence refund of an old charge follows occurrence month; it
-- never needs a historical-report rewrite or an invented rate reversal.
set local role service_role;
insert into settlement_context(key,id) values('current-refund',public.billing_record_refund((select id from settlement_context where key='charge'),
 'fictional-settlement-current-refund',700,'KRW','2026-02-15 00:00+09',gen_random_uuid()));
reset role;
set local role authenticated;
select public.settlement_calculate('52000000-0000-4000-8000-000000000001','2026-02-01');
select is((select current_gross_krw from public.settlements where month='2026-02-01'),19300::numeric,'old-charge refund occurring in later month belongs to current source subtotal');
select is((select adjustment_gross_krw from public.settlements where month='2026-02-01'),(-600)::numeric,'later-occurrence refund does not duplicate explicit late-event subtotal');
select is((select final_amount_krw from public.settlements where month='2026-02-01'),9350::numeric,'later-occurrence refund uses explicit occurrence-month report formula');
select is((select origin from public.settlement_report_sources((select id from settlement_context where key='feb-report')) where event_id=(select id from settlement_context where key='current-refund')),'current','source audit distinguishes normal refund from late-recorded event');
reset role;
select throws_ok($$insert into private.settlement_event_sources(report_id,event_id,kind,amount_krw,occurred_at,origin)
 values((select id from settlement_context where key='report'),'53000000-0000-4000-8000-000000000004','charge',999999,'2026-01-10 00:00+09','current')$$,
 '55000','SETTLEMENT_CONFIRMED','confirmed report cannot acquire a newly inserted source row');
select throws_ok($$update private.settlement_adjustments set target_month='2026-03-01'$$,'55000','IMMUTABLE_PAYMENT_LEDGER','explicit late assignment cannot be rewritten after recording');
select throws_ok($$delete from private.settlement_adjustments$$,'55000','IMMUTABLE_PAYMENT_LEDGER','late allocation audit history cannot be deleted');

-- A newly negative month must leave its prior reviewable draft byte-identical.
insert into private.settlement_policies(artist_id,month,enabled,contract_from,contract_until,base_rate,performance_rate,vat_rate,pg_fee_rate)
 values('52000000-0000-4000-8000-000000000001','2026-03-01',true,'2026-03-01','2026-04-01',0.30,0.40,0.10,0.03);
set local role authenticated;
insert into settlement_context(key,id) values('negative-report',public.settlement_calculate('52000000-0000-4000-8000-000000000001','2026-03-01'));
insert into settlement_context(key,data) select 'negative-before',to_jsonb(r) from public.settlements r where id=(select id from settlement_context where key='negative-report');
reset role;
set local role service_role;
select public.billing_record_refund((select id from settlement_context where key='charge'),'fictional-settlement-negative',400,'KRW','2026-03-15 00:00+09',gen_random_uuid());
reset role;
set local role authenticated;
select throws_ok($$select public.settlement_calculate('52000000-0000-4000-8000-000000000001','2026-03-01')$$,'55000','SETTLEMENT_NEGATIVE_NET_REQUIRES_POLICY','negative monthly source net fails closed during real calculation');
select is((select to_jsonb(r) from public.settlements r where id=(select id from settlement_context where key='negative-report')),
 (select data from settlement_context where key='negative-before'),'failed negative calculation preserves old draft and reviewed revision exactly');
select is((select count(*) from public.settlement_report_sources((select id from settlement_context where key='negative-report'))),0::bigint,'failed calculation rolls back partial source allocations');
select is((select count(*) from public.settlement_weekly_stats where report_id=(select id from settlement_context where key='negative-report')),6::bigint,'failed negative calculation preserves previous weekly rows');
reset role;
set local timezone='America/Los_Angeles';
set local role authenticated;
select public.settlement_calculate('52000000-0000-4000-8000-000000000001','2026-02-01');
select is((select period_start from public.settlements where month='2026-02-01'),'2026-01-31 15:00+00'::timestamptz,'session timezone does not move report boundary');
select is((select final_amount_krw from public.settlements where month='2026-02-01'),9350::numeric,'session timezone does not alter source inclusion or formula');
reset role;
set local timezone='UTC';

-- Formula tests deliberately use owner-only pure helper, not browser authority.
select is((private.settlement_calculate_components(1,0,0,31,'{"vat_rate":0,"pg_fee_rate":0,"base_rate":0.5,"activity_enabled":false}'::jsonb)->>'final_amount_krw')::numeric,1::numeric,'exact half KRW rounds away from zero');
select is((private.settlement_calculate_components(1,0,0,31,'{"vat_rate":0,"pg_fee_rate":0,"base_rate":0.499999,"activity_enabled":false}'::jsonb)->>'final_amount_krw')::numeric,0::numeric,'one millionth below half rounds down');
select is((private.settlement_calculate_components(1,0,0,31,'{"vat_rate":0,"pg_fee_rate":0,"base_rate":0.500001,"activity_enabled":false}'::jsonb)->>'final_amount_krw')::numeric,1::numeric,'one millionth above half rounds up');
select is((private.settlement_calculate_components(999999999999999999999999999999999999999999,0,0,31,'{"vat_rate":0,"pg_fee_rate":0,"base_rate":0.5,"activity_enabled":false}'::jsonb)->>'final_amount_krw')::numeric,
 500000000000000000000000000000000000000000::numeric,'huge exact half does not lose final rounding to floating point or division scale');
select is((private.settlement_calculate_components(10000,1000,1000,31,'{"vat_rate":0.1,"pg_fee_rate":0.03,"base_rate":0.3,"activity_enabled":true,"weekly_message_min":3,"weekly_photo_min":2}'::jsonb)->>'activity_ratio')::numeric,1::numeric,'activity ratio caps at one');
select is((private.settlement_calculate_components(10000,0,0,31,'{"vat_rate":0.1,"pg_fee_rate":0.03,"base_rate":0.3,"activity_enabled":true,"weekly_message_min":3,"weekly_photo_min":2}'::jsonb)->>'final_amount_krw')::numeric,0::numeric,'zero activity with enabled positive requirements yields zero');
select is((private.settlement_calculate_components(0,0,0,31,'{"vat_rate":0.1,"pg_fee_rate":0.03,"base_rate":0.3,"activity_enabled":false}'::jsonb)->>'final_amount_krw')::numeric,0::numeric,'zero gross never fabricates payout');
select throws_ok($$select private.settlement_calculate_components(-1,0,0,31,'{"vat_rate":0.1,"pg_fee_rate":0.03,"base_rate":0.3,"activity_enabled":false}'::jsonb)$$,'55000','SETTLEMENT_NEGATIVE_NET_REQUIRES_POLICY','negative monthly net requires future explicit policy, not a silent clamp');
select * from finish();
rollback;
