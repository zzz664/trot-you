begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
create temporary table settlement_security_context(key text primary key,id uuid,data jsonb);
grant all on settlement_security_context to authenticated,service_role;
insert into auth.users(id,email,raw_user_meta_data)
select ('55000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'settlement-security-'||n||'@example.invalid',
 '{"role":"admin","settlement_approved":true,"artist_id":"forged"}'::jsonb from generate_series(1,5) n;
update public.profiles set call_name='가상 정산 보안 사용자',onboarding_completed_at=clock_timestamp() where id::text like '55000000-%';
update public.profiles set role='artist' where id in('55000000-0000-4000-8000-000000000002','55000000-0000-4000-8000-000000000004');
update public.profiles set role='admin' where id='55000000-0000-4000-8000-000000000003';
update public.profiles set role='admin',is_restricted=true where id='55000000-0000-4000-8000-000000000005';
insert into public.artists(id,slug,name,grade,status) values
 ('56000000-0000-4000-8000-000000000001','settlement-security-a','가상 보안 가수','B','active'),
 ('56000000-0000-4000-8000-000000000002','settlement-security-b','가상 보안 타가수','B','active');
insert into public.artist_members(artist_id,user_id) values
 ('56000000-0000-4000-8000-000000000001','55000000-0000-4000-8000-000000000002'),
 ('56000000-0000-4000-8000-000000000002','55000000-0000-4000-8000-000000000004');
-- Historical fictional verified ledger inputs; owner-only fixture setup, not an
-- integration claim. Tests below run actual application roles for all RPCs.
insert into public.subscriptions(id,user_id,artist_id,provider) values
 ('57000000-0000-4000-8000-000000000001','55000000-0000-4000-8000-000000000001','56000000-0000-4000-8000-000000000001','toss'),
 ('57000000-0000-4000-8000-000000000002','55000000-0000-4000-8000-000000000001','56000000-0000-4000-8000-000000000002','toss');
insert into public.payment_events(id,subscription_id,kind,amount_krw,provider,period_start,period_end,occurred_at) values
 ('58000000-0000-4000-8000-000000000001','57000000-0000-4000-8000-000000000001','charge',5000,'toss','2026-03-01+09','2026-04-01+09','2026-03-15+09'),
 ('58000000-0000-4000-8000-000000000002','57000000-0000-4000-8000-000000000002','charge',10000,'toss','2026-03-01+09','2026-04-01+09','2026-03-15+09');
insert into private.payment_event_verifications(event_id,provider,environment,merchant_account,provider_action_id,evidence_ref)
 select id,'toss','test','fictional-settlement-security',id::text,gen_random_uuid() from public.payment_events where id::text like '58000000-%';
insert into private.settlement_policies(artist_id,month,enabled,contract_from,contract_until,base_rate,performance_rate,vat_rate,pg_fee_rate)
 select id,'2026-03-01',true,'2026-03-01','2026-04-01',0.3,0.4,0.1,0.03 from public.artists where id::text like '56000000-%';
select ok((select bool_and(relrowsecurity) from pg_class where oid in('public.settlements'::regclass,'public.settlement_weekly_stats'::regclass,
 'private.settlement_policies'::regclass,'private.settlement_source_versions'::regclass,'private.settlement_event_sources'::regclass,
 'private.settlement_message_sources'::regclass,'private.settlement_adjustments'::regclass)),'all reporting tables enable RLS');
select ok((select bool_and(not has_table_privilege(r,t,'INSERT,UPDATE,DELETE,TRUNCATE')) from unnest(array['anon','authenticated','service_role']) r
 cross join unnest(array['public.settlements','public.settlement_weekly_stats','private.settlement_policies','private.settlement_source_versions',
 'private.settlement_event_sources','private.settlement_message_sources','private.settlement_adjustments']) t),'every application role lacks raw report/policy/source mutation grants');
select ok((select bool_and(not has_table_privilege(r,t,'SELECT')) from unnest(array['anon','authenticated','service_role']) r
 cross join unnest(array['private.settlement_policies','private.settlement_source_versions','private.settlement_event_sources',
 'private.settlement_message_sources','private.settlement_adjustments']) t),'raw policy and identifiable source snapshots remain inaccessible even with service credentials');
select ok((select bool_and(not has_table_privilege(r,t,'SELECT')) from unnest(array['anon','service_role']) r
 cross join unnest(array['public.settlements','public.settlement_weekly_stats']) t),'anonymous and service roles do not bypass report visibility');
select ok((select bool_and(not has_function_privilege(r,p.oid,'EXECUTE')) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 cross join unnest(array['anon','authenticated','service_role']) r where n.nspname='private' and p.proname like 'settlement\_%' escape '\'),
 'private arithmetic, fence and trigger helpers have no application EXECUTE grants');
select ok((select bool_and(not has_function_privilege(r,p.oid,'EXECUTE')) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 cross join unnest(array['anon','service_role']) r where n.nspname='public' and p.proname like 'settlement\_%' escape '\'),
 'service role and anon cannot call browser-admin report APIs');
select is((select provolatile::text from pg_proc where oid='private.settlement_calculate_components(numeric,bigint,bigint,integer,jsonb)'::regprocedure),
 's','numeric calculator truthfully matches STABLE polymorphic JSON construction');
select ok((select bool_and(provolatile='v') from pg_proc where oid in
 ('public.settlement_calculate(uuid,date)'::regprocedure,'public.settlement_confirm(uuid,uuid)'::regprocedure)),
 'mutation callers remain VOLATILE and may use the stable snapshot calculator');
select ok((select bool_and(p.prosecdef and 'search_path=""'=any(p.proconfig)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname like 'settlement\_%' escape '\'),'all public privilege crossings use SECURITY DEFINER with pinned empty search path');
select is((select count(*) from unnest(enum_range(null::public.settlement_status))),2::bigint,'status enum has draft and confirmed only, no paid or remitted state');
select ok(not exists(select 1 from information_schema.columns where table_schema='public' and table_name in('settlements','settlement_weekly_stats')
 and column_name in('user_id','subscription_id','email','phone','bank_account','account_number','provider_action_id','evidence_ref','body','author_id')),
 'artist-readable report carries no fan identity, message content, bank data or provider evidence');
select ok(not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'settlement\_%' escape '\'
 and ('json'::regtype=any(p.proargtypes) or 'jsonb'::regtype=any(p.proargtypes) or 'text'::regtype=any(p.proargtypes))),
 'public report APIs accept typed identifiers/dates only, no arbitrary payout or policy payload');
select ok((select bool_and(data_type='numeric' and numeric_scale is null) from information_schema.columns where table_schema='public' and table_name='settlements'
 and column_name in('vat_krw','pg_fee_krw','base_amount_krw','deduction_krw','unrounded_final_krw','activity_ratio')),'decimal intermediates have no integer or fixed-scale truncating type');

set local role anon;
select throws_ok($$select public.settlement_calculate('56000000-0000-4000-8000-000000000001','2026-03-01')$$,'42501',null,'anonymous caller cannot calculate reports');
select throws_ok($$select public.settlement_confirm(gen_random_uuid(),gen_random_uuid())$$,'42501',null,'anonymous caller cannot confirm');
select throws_ok($$select * from public.settlements$$,'42501',null,'anonymous caller cannot enumerate reports');
reset role;
set local role service_role;
select set_config('request.jwt.claim.sub','55000000-0000-4000-8000-000000000003',true);
select throws_ok($$select public.settlement_calculate('56000000-0000-4000-8000-000000000001','2026-03-01')$$,'42501',null,'service token with forged admin subject cannot calculate');
select throws_ok($$select public.settlement_confirm(gen_random_uuid(),gen_random_uuid())$$,'42501',null,'service token cannot confirm');
select throws_ok($$select public.settlement_queue_adjustment(gen_random_uuid(),'2026-04-01')$$,'42501',null,'service token cannot allocate late adjustments');
select throws_ok($$select * from private.settlement_event_sources$$,'42501',null,'service role cannot extract raw financial source IDs');
select throws_ok($$update private.settlement_policies set enabled=true$$,'42501',null,'service credential cannot approve operational policy');
select throws_ok($$delete from public.settlements$$,'42501',null,'service BYPASSRLS does not restore revoked DELETE grant');
select throws_ok($$truncate private.settlement_adjustments$$,'42501',null,'service cannot clear late-adjustment audit trail');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','55000000-0000-4000-8000-000000000001',true);
select is((select count(*) from public.settlements),0::bigint,'fan sees no reports');
select throws_ok($$select public.settlement_calculate('56000000-0000-4000-8000-000000000001','2026-03-01')$$,'42501','SETTLEMENT_ADMIN_REQUIRED','profile role, not signup metadata, governs calculation');
select throws_ok($$select public.settlement_confirm(gen_random_uuid(),gen_random_uuid())$$,'42501','SETTLEMENT_ADMIN_REQUIRED','fan cannot confirm even guessed UUID');
select throws_ok($$select public.settlement_queue_adjustment('58000000-0000-4000-8000-000000000001','2026-04-01')$$,'42501','SETTLEMENT_ADMIN_REQUIRED','fan cannot allocate even own payment event');
select throws_ok($$select * from public.settlement_report_sources(gen_random_uuid())$$,'42501','SETTLEMENT_ADMIN_REQUIRED','fan cannot enumerate source snapshot');
select throws_ok($$select * from public.settlement_pending_adjustments('56000000-0000-4000-8000-000000000001')$$,'42501','SETTLEMENT_ADMIN_REQUIRED','fan cannot inspect pending financial events');
select set_config('request.jwt.claim.sub','55000000-0000-4000-8000-000000000002',true);
select throws_ok($$select public.settlement_calculate('56000000-0000-4000-8000-000000000001','2026-03-01')$$,'42501','SETTLEMENT_ADMIN_REQUIRED','artist cannot calculate own report');
select throws_ok($$select * from public.settlement_report_sources(gen_random_uuid())$$,'42501','SETTLEMENT_ADMIN_REQUIRED','artist cannot inspect fan-linked event identifiers');
select set_config('request.jwt.claim.sub','55000000-0000-4000-8000-000000000005',true);
select throws_ok($$select public.settlement_calculate('56000000-0000-4000-8000-000000000001','2026-03-01')$$,'42501','SETTLEMENT_ADMIN_REQUIRED','currently restricted admin cannot calculate');
select throws_ok($$select * from public.settlement_pending_adjustments('56000000-0000-4000-8000-000000000001')$$,'42501','SETTLEMENT_ADMIN_REQUIRED','restricted admin cannot inspect financial source data');
select set_config('request.jwt.claim.sub','',true);
select throws_ok($$select public.settlement_calculate('56000000-0000-4000-8000-000000000001','2026-03-01')$$,'42501','SETTLEMENT_ADMIN_REQUIRED','missing auth subject fails closed');
select set_config('request.jwt.claim.sub','55000000-0000-4000-8000-000000000003',true);
insert into settlement_security_context(key,id) values('a',public.settlement_calculate('56000000-0000-4000-8000-000000000001','2026-03-01'));
insert into settlement_security_context(key,id) values('b',public.settlement_calculate('56000000-0000-4000-8000-000000000002','2026-03-01'));
select is((select count(*) from public.settlements),2::bigint,'unrestricted admin can review all draft reports');
select is((select count(*) from public.settlement_weekly_stats),12::bigint,'admin sees both artists six March week windows');
select set_config('request.jwt.claim.sub','55000000-0000-4000-8000-000000000002',true);
select is((select count(*) from public.settlements),0::bigint,'artist cannot see own unconfirmed draft');
select is((select count(*) from public.settlement_weekly_stats),0::bigint,'draft weekly stats are hidden together with report');
select set_config('request.jwt.claim.sub','55000000-0000-4000-8000-000000000003',true);
select public.settlement_confirm((select id from settlement_security_context where key='a'),(select revision from public.settlements where id=(select id from settlement_security_context where key='a')));
select public.settlement_confirm((select id from settlement_security_context where key='b'),(select revision from public.settlements where id=(select id from settlement_security_context where key='b')));
select set_config('request.jwt.claim.sub','55000000-0000-4000-8000-000000000002',true);
select is((select count(*) from public.settlements),1::bigint,'artist can read only own confirmed report');
select is((select artist_id from public.settlements),'56000000-0000-4000-8000-000000000001'::uuid,'membership is the live scope boundary');
select is((select count(*) from public.settlement_weekly_stats),6::bigint,'artist gets only own confirmed weekly metrics');
select throws_ok($$update public.settlements set final_amount_krw=1$$,'42501',null,'artist cannot rewrite confirmed report');
select throws_ok($$insert into private.settlement_event_sources(report_id,event_id,kind,amount_krw,occurred_at,origin) values(gen_random_uuid(),gen_random_uuid(),'charge',1,now(),'current')$$,'42501',null,'artist cannot inject source IDs');
reset role;
delete from public.artist_members where user_id='55000000-0000-4000-8000-000000000002';
set local role authenticated;
select is((select count(*) from public.settlements),0::bigint,'membership removal immediately revokes confirmed-report access');
select is((select count(*) from public.settlement_weekly_stats),0::bigint,'membership removal also revokes child aggregate access');
reset role;
insert into public.artist_members values('56000000-0000-4000-8000-000000000001','55000000-0000-4000-8000-000000000002',false);
update public.profiles set is_restricted=true where id='55000000-0000-4000-8000-000000000002';
set local role authenticated;
select is((select count(*) from public.settlements),0::bigint,'restriction immediately removes artist financial-report access');
reset role;
update public.profiles set restricted_until=now()-interval '1 second' where id='55000000-0000-4000-8000-000000000002';
set local role authenticated;
select is((select count(*) from public.settlements),1::bigint,'expired restriction restores only current membership scope');
reset role;
update public.profiles set role='fan',is_restricted=false,restricted_until=null where id='55000000-0000-4000-8000-000000000002';
set local role authenticated;
select is((select count(*) from public.settlements),0::bigint,'artist role revocation immediately removes report access');
select set_config('request.jwt.claim.sub','55000000-0000-4000-8000-000000000001',true);
select is((select count(*) from public.settlements),0::bigint,'paying fan still cannot read confirmed artist settlement report');
select set_config('request.jwt.claim.sub','55000000-0000-4000-8000-000000000004',true);
select is((select gross_krw from public.settlements),10000::numeric,'other artist sees own aggregate and not the first artist data');
reset role;

-- Explicit policy inputs are constrained, not automatically rounded/enabled.
select throws_ok($$update private.settlement_policies set base_rate='NaN'$$,'23514',null,'NaN rate is rejected');
select throws_ok($$update private.settlement_policies set vat_rate='Infinity'$$,'23514',null,'infinite VAT is rejected');
select throws_ok($$update private.settlement_policies set pg_fee_rate='-Infinity'$$,'23514',null,'negative infinity fee is rejected');
select throws_ok($$update private.settlement_policies set base_rate=-0.01$$,'23514',null,'negative rate is rejected');
select throws_ok($$update private.settlement_policies set base_rate=1.01$$,'23514',null,'rate above one is rejected');
select throws_ok($$update private.settlement_policies set base_rate=0.1234567$$,'23514',null,'excess precision is rejected rather than silently rounded');
select throws_ok($$update private.settlement_policies set performance_conditions='{}'::jsonb$$,'23514',null,'unapproved performance conditions cannot become active');
select throws_ok($$update private.settlement_policies set activity_enabled=true,weekly_message_min=0,weekly_photo_min=2$$,'23514',null,'zero weekly requirement is explicitly rejected');
select throws_ok($$update private.settlement_policies set activity_enabled=true,weekly_message_min=3,weekly_photo_min=null$$,'23514',null,'missing weekly requirement is not interpreted as zero');
select throws_ok($$update private.settlement_policies set activity_enabled=false,weekly_message_min=3,weekly_photo_min=2$$,'23514',null,'disabled activity cannot carry misleading active requirements');
select throws_ok($$update private.settlement_policies set negative_net_policy='clamp_zero'$$,'23514',null,'unapproved negative-net treatment is not available');
select throws_ok($$update private.settlement_policies set partial_week_policy='full_week'$$,'23514',null,'unknown partial-week interpretation is rejected');
select throws_ok($$update private.settlement_policies set late_event_policy='original_reversal'$$,'23514',null,'unknown prior-period valuation cannot be selected');
select throws_ok($$update private.settlement_policies set contract_until=contract_from$$,'23514',null,'empty contract interval is rejected');
select throws_ok($$update private.settlement_policies set contract_from='-infinity'$$,'23514',null,'infinite contract interval is rejected');
select throws_ok($$update private.settlement_policies set month='2026-03-02'$$,'23514',null,'policy month must start on first date');
select throws_ok($$update private.settlement_policies set month='infinity'$$,'23514',null,'policy date must be finite');

-- Reconciliation failures must block confirmation rather than freezing a
-- corrupted draft. Owner corruption below simulates an implementation defect.
insert into private.settlement_policies(artist_id,month,enabled,contract_from,contract_until,base_rate,performance_rate,vat_rate,pg_fee_rate)
 values('56000000-0000-4000-8000-000000000001','2026-04-01',true,'2026-04-01','2026-05-01',0.3,0.4,0.1,0.03);
set local role authenticated;
select set_config('request.jwt.claim.sub','55000000-0000-4000-8000-000000000003',true);
insert into settlement_security_context(key,id) values('draft',public.settlement_calculate('56000000-0000-4000-8000-000000000001','2026-04-01'));
insert into settlement_security_context(key,id) select 'draft-revision',revision from public.settlements where id=(select id from settlement_security_context where key='draft');
select throws_ok($$select public.settlement_confirm(gen_random_uuid(),gen_random_uuid())$$,'P0002','SETTLEMENT_NOT_FOUND','unknown report does not succeed');
reset role;
update public.settlements set source_event_count=1 where id=(select id from settlement_security_context where key='draft');
set local role authenticated;
select throws_ok($$select public.settlement_confirm((select id from settlement_security_context where key='draft'),(select id from settlement_security_context where key='draft-revision'))$$,'55000','SETTLEMENT_SOURCE_MISMATCH','event count reconciliation blocks corrupt draft');
reset role;
update public.settlements set source_event_count=0,source_message_count=1 where id=(select id from settlement_security_context where key='draft');
set local role authenticated;
select throws_ok($$select public.settlement_confirm((select id from settlement_security_context where key='draft'),(select id from settlement_security_context where key='draft-revision'))$$,'55000','SETTLEMENT_SOURCE_MISMATCH','message source reconciliation blocks corrupt draft');
reset role;
update public.settlements set source_message_count=0,final_amount_krw=999 where id=(select id from settlement_security_context where key='draft');
set local role authenticated;
select throws_ok($$select public.settlement_confirm((select id from settlement_security_context where key='draft'),(select id from settlement_security_context where key='draft-revision'))$$,'55000','SETTLEMENT_FORMULA_MISMATCH','final-only formula reconciliation blocks corrupt draft');
select public.settlement_calculate('56000000-0000-4000-8000-000000000001','2026-04-01');
select lives_ok($$select public.settlement_confirm((select id from settlement_security_context where key='draft'),(select revision from public.settlements where id=(select id from settlement_security_context where key='draft')))$$,'explicit draft regeneration repairs derived values before confirmation');
reset role;
select * from finish();
rollback;
