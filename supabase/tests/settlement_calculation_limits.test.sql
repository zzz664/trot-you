begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
-- Exact feature40 response bounds, rollback-only fictional source rows. A
-- technical limit rejects the whole request; money is never silently truncated.
insert into auth.users(id,email,raw_user_meta_data) values
 ('d4060000-0000-4000-8000-000000000001','calculation-limit-admin@example.invalid','{}'),
 ('d4060000-0000-4000-8000-000000000002','calculation-limit-fan@example.invalid','{}');
update public.profiles set role='admin' where id='d4060000-0000-4000-8000-000000000001';
insert into public.artists(id,slug,name,grade,status) values('d4060000-0000-4000-8000-000000000003','calculation-limit','Fictional limit artist','B','active');
insert into public.subscriptions(id,user_id,artist_id,provider) values('d4060000-0000-4000-8000-000000000004','d4060000-0000-4000-8000-000000000002','d4060000-0000-4000-8000-000000000003','toss');
insert into private.settlement_policies(artist_id,month,enabled,contract_from,contract_until,base_rate,performance_rate,vat_rate,pg_fee_rate,activity_enabled)
values('d4060000-0000-4000-8000-000000000003','2026-01-01',true,'2026-01-01','2026-02-01',0.3,0.4,0.1,0.03,false);
select set_config('request.jwt.claim.sub','d4060000-0000-4000-8000-000000000001',true);
insert into public.messages(id,artist_id,author_id,type,body,status,scheduled_at,sent_at)
select ('d4070000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'d4060000-0000-4000-8000-000000000003','d4060000-0000-4000-8000-000000000001',
 'text','Fictional limit body','sent','2026-01-05+09','2026-01-05+09' from generate_series(1,50000) n;
set local role authenticated;
select is(jsonb_array_length(public.settlement_calculation_input('d4060000-0000-4000-8000-000000000003','2026-01-01')#>'{input,messages}'),50000,'exact message bound returns every source, not an off-by-one truncation');
reset role;
insert into public.messages(id,artist_id,author_id,type,body,status,scheduled_at,sent_at)
values('d4070000-0000-4000-8000-000000050001','d4060000-0000-4000-8000-000000000003','d4060000-0000-4000-8000-000000000001','text','Overflow fictional body','sent','2026-01-05+09','2026-01-05+09');
set local role authenticated;
select throws_ok($$select public.settlement_calculation_input('d4060000-0000-4000-8000-000000000003','2026-01-01')$$,'54000','SETTLEMENT_SOURCE_LIMIT_EXCEEDED','50001 messages reject complete response rather than calculate from a prefix');
reset role;
delete from public.messages where id::text like 'd4070000-%';
insert into public.payment_events(id,subscription_id,kind,amount_krw,provider,period_start,period_end,occurred_at)
select ('d4080000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'d4060000-0000-4000-8000-000000000004','charge',1,'toss',
 '2026-01-01+09','2026-02-01+09','2026-01-05+09' from generate_series(1,50000) n;
insert into private.payment_event_verifications(event_id,provider,environment,merchant_account,provider_action_id,evidence_ref)
select id,'toss','test','fictional-limit-merchant',id::text,gen_random_uuid() from public.payment_events where id::text like 'd4080000-%';
set local role authenticated;
select is(jsonb_array_length(public.settlement_calculation_input('d4060000-0000-4000-8000-000000000003','2026-01-01')#>'{input,events}'),50000,'exact verified-event bound retains every KRW');
reset role;
insert into public.payment_events(id,subscription_id,kind,amount_krw,provider,period_start,period_end,occurred_at)
values('d4080000-0000-4000-8000-000000050001','d4060000-0000-4000-8000-000000000004','charge',1,'toss','2026-01-01+09','2026-02-01+09','2026-01-05+09');
insert into private.payment_event_verifications(event_id,provider,environment,merchant_account,provider_action_id,evidence_ref)
values('d4080000-0000-4000-8000-000000050001','toss','test','fictional-limit-merchant','fictional-limit-overflow',gen_random_uuid());
set local role authenticated;
select throws_ok($$select public.settlement_calculation_input('d4060000-0000-4000-8000-000000000003','2026-01-01')$$,'54000','SETTLEMENT_SOURCE_LIMIT_EXCEEDED','50001 verified events reject complete response rather than lose money');
reset role;
select is((select count(*) from public.settlements),0::bigint,'limit probes never create reports');
select * from finish();
rollback;
