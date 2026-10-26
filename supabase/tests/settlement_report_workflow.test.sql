begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
set local timezone='UTC';
select no_plan();
-- Owner-only fictional rollback fixtures; no real legal or financial approval.
create temporary table report_context(key text primary key,data jsonb);
grant all on report_context to authenticated;
insert into auth.users(id,email,raw_user_meta_data) values
 ('d4110000-0000-4000-8000-000000000001','report-admin@example.invalid','{}'),
 ('d4110000-0000-4000-8000-000000000002','report-fan@example.invalid','{}'),
 ('d4110000-0000-4000-8000-000000000003','report-artist@example.invalid','{}'),
 ('d4110000-0000-4000-8000-000000000004','report-outsider@example.invalid','{}');
update public.profiles set role='admin' where id='d4110000-0000-4000-8000-000000000001';
update public.profiles set role='artist',call_name='가수',onboarding_completed_at=clock_timestamp()
 where id in('d4110000-0000-4000-8000-000000000003','d4110000-0000-4000-8000-000000000004');
insert into public.artists(id,slug,name,grade,status) values
 ('d4120000-0000-4000-8000-000000000001','report-main','=Fictional <artist> & name','B','active'),
 ('d4120000-0000-4000-8000-000000000002','report-other','Fictional other artist','B','paused');
insert into public.artist_members(artist_id,user_id) values('d4120000-0000-4000-8000-000000000001','d4110000-0000-4000-8000-000000000003');
insert into private.onboarding_documents(version,kind,title,body,approved_at,published_at) values
 ('d4160000-0000-4000-8000-000000000001','terms','Fictional terms','Test only',now()-interval '2 day',now()-interval '1 day'),
 ('d4160000-0000-4000-8000-000000000002','privacy','Fictional privacy','Test only',now()-interval '2 day',now()-interval '1 day'),
 ('d4160000-0000-4000-8000-000000000003','terms','Fictional replacement terms','Test only',now()-interval '2 day',now()-interval '1 day');
insert into private.profile_onboarding_policy(singleton,name_policy_version,name_approved_at,call_name_min,call_name_max,profanity_words,terms_version,privacy_version)
values(true,gen_random_uuid(),now()-interval '1 day',2,10,array['fictionalblocked'],'d4160000-0000-4000-8000-000000000001','d4160000-0000-4000-8000-000000000002');
insert into private.profile_policy_acceptances(user_id,kind,version,accepted_at)
select u,kind,version,now() from (values('d4110000-0000-4000-8000-000000000003'::uuid),('d4110000-0000-4000-8000-000000000004'::uuid)) users(u)
cross join private.onboarding_documents where version in('d4160000-0000-4000-8000-000000000001','d4160000-0000-4000-8000-000000000002');
insert into public.subscriptions(id,user_id,artist_id,provider) values
 ('d4130000-0000-4000-8000-000000000001','d4110000-0000-4000-8000-000000000002','d4120000-0000-4000-8000-000000000001','toss');
insert into public.payment_events(id,subscription_id,kind,amount_krw,provider,period_start,period_end,occurred_at) values
 ('d4140000-0000-4000-8000-000000000001','d4130000-0000-4000-8000-000000000001','charge',11000,'toss','2026-01-01+09','2026-02-01+09','2026-01-01+09'),
 ('d4140000-0000-4000-8000-000000000003','d4130000-0000-4000-8000-000000000001','charge',999999,'toss','2026-01-01+09','2026-02-01+09','2026-01-20+09');
insert into public.payment_events(id,subscription_id,kind,amount_krw,provider,original_event_id,period_start,period_end,occurred_at) values
 ('d4140000-0000-4000-8000-000000000002','d4130000-0000-4000-8000-000000000001','refund',-1000,'toss','d4140000-0000-4000-8000-000000000001','2026-01-01+09','2026-02-01+09','2026-01-31 23:59:59.999999+09');
insert into private.payment_event_verifications(event_id,provider,environment,merchant_account,provider_action_id,evidence_ref)
select id,provider,'test','fictional-report-account',id::text,gen_random_uuid() from public.payment_events
 where id in('d4140000-0000-4000-8000-000000000001','d4140000-0000-4000-8000-000000000002');
insert into public.messages(id,artist_id,author_id,type,body,status,scheduled_at,sent_at) values
 ('d4150000-0000-4000-8000-000000000001','d4120000-0000-4000-8000-000000000001','d4110000-0000-4000-8000-000000000003','photo','private report body','sent','2026-01-02+09','2026-01-02+09');
insert into private.settlement_policies(artist_id,month,enabled,contract_from,contract_until,base_rate,performance_rate,vat_rate,pg_fee_rate,activity_enabled)
values('d4120000-0000-4000-8000-000000000001','2026-01-01',true,'2026-01-01','2026-03-01',0.3,0.4,0.1,0.03,false),
 ('d4120000-0000-4000-8000-000000000001','2026-02-01',true,'2026-01-01','2026-03-01',0.3,0.4,0.1,0.03,false);
insert into report_context values('ledger-before',(select jsonb_agg(to_jsonb(e) order by id) from public.payment_events e));

select ok(has_function_privilege('authenticated','public.settlement_report_read(uuid,date,boolean)','execute'),'actor role may invoke guarded read');
select ok(not has_function_privilege('anon','public.settlement_report_read(uuid,date,boolean)','execute'),'anonymous cannot invoke reports');
select ok(not has_function_privilege('service_role','public.settlement_report_export(uuid,uuid)','execute'),'service key cannot export by spoofed subject');
select ok(not has_function_privilege('authenticated','private.settlement_report_actor(uuid,boolean)','execute'),'profile/fence helper is private');
select is((select proconfig from pg_proc where oid='public.settlement_report_read(uuid,date,boolean)'::regprocedure),array['search_path=""','TimeZone=UTC'],'read pins empty search path and UTC transport');
select is((select provolatile::text from pg_proc where oid='public.settlement_report_read(uuid,date,boolean)'::regprocedure),'v','post-wait snapshots remain volatile');
set local role authenticated;
select set_config('request.jwt.claim.sub','d4110000-0000-4000-8000-000000000001',true);
select is(public.settlement_report_read('d4120000-0000-4000-8000-000000000001','2026-01-01')->'report','null'::jsonb,'uncreated report is distinct from zero revenue');
select throws_ok($$select public.settlement_report_read('d4120000-0000-4000-8000-000000000001','2026-01-02')$$,'22023','SETTLEMENT_MONTH_INVALID','invalid month rejected');
select throws_ok($$select public.settlement_report_read('d4120000-0000-4000-8000-000000000099','2026-01-01')$$,'P0002','SETTLEMENT_NOT_FOUND','unknown artist not an empty report');
select throws_ok($$select public.settlement_report_calculate('d4120000-0000-4000-8000-000000000001','2026-01-01',gen_random_uuid())$$,'55000','SETTLEMENT_REVISION_CONFLICT','missing report requires explicit create intent');
select throws_ok($$select public.settlement_report_calculate('d4120000-0000-4000-8000-000000000002','2026-01-01')$$,'55000','SETTLEMENT_POLICY_REQUIRED','no approved monthly policy is invented');
insert into report_context values('draft',public.settlement_report_calculate('d4120000-0000-4000-8000-000000000001','2026-01-01'));
select is((select data->>'actorId' from report_context where key='draft'),'d4110000-0000-4000-8000-000000000001','response bound to current actor');
select is((select data->>'actorRole' from report_context where key='draft'),'admin','role remains server-owned');
select is((select data#>>'{report,status}' from report_context where key='draft'),'draft','create produces draft, not payout');
select is((select data#>>'{report,grossKrw}' from report_context where key='draft'),'10000','only verified charge/refund signed total is recognized');
select is((select data#>>'{report,finalAmountKrw}' from report_context where key='draft'),'2645','existing exact final whole-KRW arithmetic retained');
select is((select data#>>'{report,sourceEventCount}' from report_context where key='draft'),'2','attempt or unverified ledger never becomes source');
select is((select data->'sources' from report_context where key='draft'),'null'::jsonb,'normal admin UI does not receive event identities');
select is((select data#>>'{report,policySnapshot,baseRate}' from report_context where key='draft'),'0.3','snapshot policy rates are lossless text');
select is((select jsonb_typeof(data#>'{report,vatKrw}') from report_context where key='draft'),'string','repeating monetary decimals never become JS numbers');
select is((select jsonb_typeof(data#>'{report,weeklyStats,0,messageCount}') from report_context where key='draft'),'string','weekly counts preserve integer text');
select is((select data#>'{report,exactComponents}' from report_context where key='draft'),(select exact_components from public.settlements where artist_id='d4120000-0000-4000-8000-000000000001' and month='2026-01-01'),'saved exact rational strings preserved unchanged');
select throws_ok($$select public.settlement_report_calculate('d4120000-0000-4000-8000-000000000001','2026-01-01')$$,'55000','SETTLEMENT_REVISION_CONFLICT','repeated create cannot overwrite reviewed draft');
insert into report_context select 'recalculated',public.settlement_report_calculate('d4120000-0000-4000-8000-000000000001','2026-01-01',(data#>>'{report,revision}')::uuid) from report_context where key='draft';
select isnt((select data#>>'{report,revision}' from report_context where key='draft'),(select data#>>'{report,revision}' from report_context where key='recalculated'),'successful exact-revision recalculate issues fresh review revision');
select is((select data#>>'{report,id}' from report_context where key='draft'),(select data#>>'{report,id}' from report_context where key='recalculated'),'recalculate retains unique monthly report identity');
select throws_ok($$select public.settlement_report_export((data#>>'{report,id}')::uuid,(data#>>'{report,revision}')::uuid) from report_context where key='draft'$$,'55000','SETTLEMENT_REVISION_CONFLICT','export cannot silently substitute a newer draft');
select throws_ok($$select public.settlement_report_confirm((data#>>'{report,id}')::uuid,(data#>>'{report,revision}')::uuid) from report_context where key='draft'$$,'55000','SETTLEMENT_REVISION_CONFLICT','confirm requires exact reviewed revision');
insert into report_context select 'export',public.settlement_report_export((data#>>'{report,id}')::uuid,(data#>>'{report,revision}')::uuid) from report_context where key='recalculated';
select is((select jsonb_array_length(data->'sources') from report_context where key='export'),2,'complete frozen source export includes every verified event once');
select is((select data#>>'{sources,1,amountKrw}' from report_context where key='export'),'-1000','refund source is negative exact text');
select is((select data#>>'{sources,1,occurredAt}' from report_context where key='export'),'2026-01-31T14:59:59.999999+00:00','microsecond occurrence boundary preserved');
select ok((select not(data::text like '%private report body%' or data::text like '%subscription_id%' or data::text like '%merchant%' or data::text like '%evidence_ref%' or data::text like '%report-fan%') from report_context where key='export'),'export excludes fan identity, message body and verification/provider secrets');
set local timezone='Pacific/Honolulu'; set local datestyle='SQL, DMY';
select is(public.settlement_report_read('d4120000-0000-4000-8000-000000000001','2026-01-01')->'report',(select data->'report' from report_context where key='recalculated'),'transport and audit strings independent of session time/date formats');
reset role; set local timezone='UTC'; set local datestyle='ISO, MDY';
insert into public.messages(id,artist_id,author_id,type,body,status,scheduled_at,sent_at) values
 ('d4150000-0000-4000-8000-000000000002','d4120000-0000-4000-8000-000000000001','d4110000-0000-4000-8000-000000000003','text','new private report body','sent','2026-01-03+09','2026-01-03+09');
set local role authenticated;
select throws_ok($$select public.settlement_report_confirm((data#>>'{report,id}')::uuid,(data#>>'{report,revision}')::uuid) from report_context where key='recalculated'$$,'55000','SETTLEMENT_DRAFT_STALE','changed committed source requires recalculate/review, not confirmation');
insert into report_context select 'fresh',public.settlement_report_calculate('d4120000-0000-4000-8000-000000000001','2026-01-01',(data#>>'{report,revision}')::uuid) from report_context where key='recalculated';
insert into report_context select 'confirmed',public.settlement_report_confirm((data#>>'{report,id}')::uuid,(data#>>'{report,revision}')::uuid) from report_context where key='fresh';
select is((select data#>>'{report,status}' from report_context where key='confirmed'),'confirmed','review confirmation is final locked report status');
select is((select public.settlement_report_confirm((data#>>'{report,id}')::uuid,(data#>>'{report,revision}')::uuid)->'report' from report_context where key='confirmed'),(select data->'report' from report_context where key='confirmed'),'same-revision confirm retry returns same immutable report');
select throws_ok($$select public.settlement_report_calculate('d4120000-0000-4000-8000-000000000001','2026-01-01',(data#>>'{report,revision}')::uuid) from report_context where key='confirmed'$$,'55000','SETTLEMENT_CONFIRMED','confirmed report cannot be recalculated');
insert into report_context values('february',public.settlement_report_calculate('d4120000-0000-4000-8000-000000000001','2026-02-01'));
select set_config('request.jwt.claim.sub','d4110000-0000-4000-8000-000000000003',true);
select is(public.settlement_report_read('d4120000-0000-4000-8000-000000000001','2026-01-01')#>>'{report,status}','confirmed','currently consented member sees own confirmed report');
select is(public.settlement_report_read('d4120000-0000-4000-8000-000000000001','2026-02-01')->'report','null'::jsonb,'artist cannot infer unconfirmed draft contents');
select is((select count(*) from public.settlements),1::bigint,'direct RLS agrees with confirmed-only visibility');
select is((select count(*) from public.settlement_weekly_stats),(select jsonb_array_length(data#>'{report,weeklyStats}')::bigint from report_context where key='confirmed'),'weekly RLS exposes confirmed own rows only');
select throws_ok($$select public.settlement_report_read('d4120000-0000-4000-8000-000000000001','2026-01-01',true)$$,'42501','SETTLEMENT_FORBIDDEN','artist cannot request source event identities');
select throws_ok($$select public.settlement_report_export((data#>>'{report,id}')::uuid,(data#>>'{report,revision}')::uuid) from report_context where key='confirmed'$$,'42501','SETTLEMENT_FORBIDDEN','artist cannot export admin ledger sheet');
select throws_ok($$select public.settlement_report_calculate('d4120000-0000-4000-8000-000000000001','2026-02-01')$$,'42501','SETTLEMENT_FORBIDDEN','member cannot create financial reports');
select ok(not private.settlement_artist_consent_ready('d4110000-0000-4000-8000-000000000004'),'RLS helper cannot reveal another actor consent');
select set_config('request.jwt.claim.sub','d4110000-0000-4000-8000-000000000004',true);
select throws_ok($$select public.settlement_report_read('d4120000-0000-4000-8000-000000000001','2026-01-01')$$,'42501','SETTLEMENT_FORBIDDEN','consented outsider still lacks membership');
select set_config('request.jwt.claim.sub','d4110000-0000-4000-8000-000000000002',true);
select set_config('request.jwt.claim.role','admin',true);
select throws_ok($$select public.settlement_report_read('d4120000-0000-4000-8000-000000000001','2026-01-01')$$,'42501','SETTLEMENT_FORBIDDEN','fan and forged JWT role cannot read financial report');
select is((select count(*) from public.settlements),0::bigint,'fan direct SELECT is empty');
reset role;
update private.profile_onboarding_policy set terms_version='d4160000-0000-4000-8000-000000000003';
set local role authenticated;
select set_config('request.jwt.claim.sub','d4110000-0000-4000-8000-000000000003',true);
select throws_ok($$select public.settlement_report_read('d4120000-0000-4000-8000-000000000001','2026-01-01')$$,'42501','SETTLEMENT_CONSENT_REQUIRED','new required legal version invalidates prior artist consent immediately');
select is((select count(*) from public.settlements),0::bigint,'direct SELECT cannot bypass current consent');
select is((select count(*) from public.settlement_weekly_stats),0::bigint,'child SELECT cannot bypass current consent');
reset role;
update private.profile_onboarding_policy set terms_version='d4160000-0000-4000-8000-000000000001';
delete from private.profile_policy_acceptances where user_id='d4110000-0000-4000-8000-000000000003' and kind='privacy';
set local role authenticated;
select throws_ok($$select public.settlement_report_read('d4120000-0000-4000-8000-000000000001','2026-01-01')$$,'42501','SETTLEMENT_CONSENT_REQUIRED','withdrawn required consent does not survive a saved report');
select is((select count(*) from public.settlements),0::bigint,'RLS rechecks acceptance removal');
reset role;
insert into private.profile_policy_acceptances(user_id,kind,version,accepted_at) values('d4110000-0000-4000-8000-000000000003','privacy','d4160000-0000-4000-8000-000000000002',now());
delete from public.artist_members where user_id='d4110000-0000-4000-8000-000000000003';
set local role authenticated;
select throws_ok($$select public.settlement_report_read('d4120000-0000-4000-8000-000000000001','2026-01-01')$$,'42501','SETTLEMENT_FORBIDDEN','membership removal is current, not frozen into old reports');
select is((select count(*) from public.settlements),0::bigint,'RLS reflects membership removal');
reset role;
update public.profiles set is_restricted=true where id='d4110000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub','d4110000-0000-4000-8000-000000000001',true);
select throws_ok($$select public.settlement_report_read('d4120000-0000-4000-8000-000000000001','2026-01-01')$$,'42501','SETTLEMENT_FORBIDDEN','restricted admin cannot read through new entrypoint');
reset role;
update public.profiles set restricted_until=clock_timestamp()-interval '1 second' where id='d4110000-0000-4000-8000-000000000001';
set local role authenticated;
select lives_ok($$select public.settlement_report_read('d4120000-0000-4000-8000-000000000001','2026-01-01')$$,'expired restriction restores established admin access without invented consumer consent requirement');
select throws_ok($$update public.settlements set status='draft'$$,'42501',null,'authenticated clients cannot bypass report workflow with table mutations');
reset role;
set local role service_role;
select set_config('request.jwt.claim.sub','d4110000-0000-4000-8000-000000000001',true);
select throws_ok($$select public.settlement_report_read('d4120000-0000-4000-8000-000000000001','2026-01-01')$$,'42501',null,'service key remains denied even with admin subject');
reset role;
select is((select jsonb_agg(to_jsonb(e) order by id) from public.payment_events e),(select data from report_context where key='ledger-before'),'reports never mutate financial success ledger');
select is((select count(*) from private.settlement_policies),2::bigint,'report flow never provisions additional policy');
select * from finish();
rollback;
