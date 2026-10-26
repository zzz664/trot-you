begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
set local timezone='UTC';
select no_plan();
-- Exactly one selected high-magnitude saved-report projection contract.
-- Owner-created, rollback-only records are not live provider or policy evidence.
create temporary table report_precision_context(data jsonb);
grant all on report_precision_context to authenticated;
insert into auth.users(id,email,raw_user_meta_data) values
 ('d4210000-0000-4000-8000-000000000001','report-precision-admin@example.invalid','{}'),
 ('d4210000-0000-4000-8000-000000000002','report-precision-fan@example.invalid','{}');
update public.profiles set role='admin' where id='d4210000-0000-4000-8000-000000000001';
insert into public.artists(id,slug,name,grade,status) values('d4220000-0000-4000-8000-000000000001','report-precision','Fictional exact report','B','active');
insert into public.subscriptions(id,user_id,artist_id,provider) values
 ('d4230000-0000-4000-8000-000000000001','d4210000-0000-4000-8000-000000000002','d4220000-0000-4000-8000-000000000001','toss');
insert into public.payment_events(id,subscription_id,kind,amount_krw,provider,period_start,period_end,occurred_at)
select ('d4240000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'d4230000-0000-4000-8000-000000000001','charge',2147483647,'toss',
 '2026-01-01+09','2026-02-01+09','2026-01-02+09' from generate_series(1,2) n;
insert into public.payment_events(id,subscription_id,kind,amount_krw,provider,original_event_id,period_start,period_end,occurred_at) values
 ('d4240000-0000-4000-8000-000000000003','d4230000-0000-4000-8000-000000000001','refund',-1000000,'toss','d4240000-0000-4000-8000-000000000001','2026-01-01+09','2026-02-01+09','2026-01-15+09');
insert into private.payment_event_verifications(event_id,provider,environment,merchant_account,provider_action_id,evidence_ref)
select id,provider,'test','fictional-report-precision-account',id::text,gen_random_uuid() from public.payment_events where subscription_id='d4230000-0000-4000-8000-000000000001';
insert into private.settlement_policies(artist_id,month,enabled,contract_from,contract_until,base_rate,performance_rate,vat_rate,pg_fee_rate,activity_enabled,weekly_message_min,weekly_photo_min,partial_week_policy)
values('d4220000-0000-4000-8000-000000000001','2026-01-01',true,'2026-01-01','2026-02-01',0.300001,0.400001,0.123457,0.033333,true,3,2,'prorate_days');
insert into public.messages(artist_id,author_id,type,body,status,scheduled_at,sent_at) values
 ('d4220000-0000-4000-8000-000000000001','d4210000-0000-4000-8000-000000000001','photo','Fictional private precision body','sent','2026-01-03+09','2026-01-03+09');
set local role authenticated;
select set_config('request.jwt.claim.sub','d4210000-0000-4000-8000-000000000001',true);
insert into report_precision_context select public.settlement_report_calculate('d4220000-0000-4000-8000-000000000001','2026-01-01');
select is((select data#>>'{report,grossKrw}' from report_precision_context),'4293967294','gross above signed32bit range is precise integer text');
select is((select data#>>'{report,sourceEventCount}' from report_precision_context),'3','tiny precision fixture retains both charges and signed refund');
select is((select data#>'{report,exactComponents}' from report_precision_context),(select exact_components from public.settlements where artist_id='d4220000-0000-4000-8000-000000000001'),'large saved numerators and denominators retained byte-for-byte');
select is((select data#>>'{report,policySnapshot,vatRate}' from report_precision_context),'0.123457','six-place policy precision is retained');
select is((select (data#>>'{report,finalAmountKrw}')::numeric from report_precision_context),
 div(2::numeric*4293967294*966667*300001*35+1123457::numeric*1000000*372,2::numeric*1123457*1000000*372),'large-gross payout rounds directly from independently reconstructed integer fraction');
select lives_ok($$select public.settlement_report_confirm((data#>>'{report,id}')::uuid,(data#>>'{report,revision}')::uuid) from report_precision_context$$,'exact large-gross audit survives confirmation');
select is((select jsonb_array_length(public.settlement_report_export((data#>>'{report,id}')::uuid,(data#>>'{report,revision}')::uuid)->'sources') from report_precision_context),3,'exact source sheet includes the two charges and signed refund');
reset role;
select * from finish();
rollback;
