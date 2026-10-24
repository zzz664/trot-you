begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

create temporary table analytics_security_context(key text primary key,id uuid,stamp timestamptz);
grant all on analytics_security_context to authenticated,service_role;
insert into auth.users(id,email,raw_user_meta_data)
select ('f1000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 'analytics-security-'||n||'@example.invalid',
 '{"role":"admin","analytics_consent":true,"analytics_version":"forged","name":"Untrusted metadata"}'::jsonb
 from generate_series(1,7) n;
update public.profiles set call_name='가상 분석 보안 사용자',onboarding_completed_at=clock_timestamp()
 where id::text like 'f1000000-%' and id<>'f1000000-0000-4000-8000-000000000005';
update public.profiles set role='artist' where id='f1000000-0000-4000-8000-000000000003';
update public.profiles set role='admin' where id='f1000000-0000-4000-8000-000000000004';
update public.profiles set is_restricted=true where id='f1000000-0000-4000-8000-000000000006';
update public.profiles set is_restricted=true,restricted_until=clock_timestamp()-interval '1 second'
 where id='f1000000-0000-4000-8000-000000000007';
select is((select count(*) from private.analytics_policy),0::bigint,'migration never activates an unapproved analytics policy');
select is((select count(*) from private.analytics_consents),0::bigint,'signup metadata cannot forge analytics consent');
select is((select count(*) from private.analytics_events),0::bigint,'account creation does not silently collect analytics');
select is((select count(*) from unnest(enum_range(null::public.analytics_event_name))),13::bigint,
 'database permits exactly the thirteen specified event names');
select is((select relkind::text from pg_class where oid='private.analytics_events'::regclass),'r',
 'MVP uses an ordinary table, avoiding invalid partition primary key and future-month gaps');
select ok((select bool_and(relrowsecurity) from pg_class where oid in
 ('private.analytics_policy'::regclass,'private.analytics_consents'::regclass,'private.analytics_events'::regclass)),
 'every analytics raw table enables RLS');
select ok((select bool_and(not has_table_privilege(r,t,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'))
 from unnest(array['anon','authenticated','service_role']) r cross join unnest(array[
 'private.analytics_policy','private.analytics_consents','private.analytics_events']) t),
 'all application roles including service lack raw analytics reads and mutation grants');
select ok((select bool_and(not has_function_privilege(r,p.oid,'EXECUTE')) from pg_proc p
 join pg_namespace n on n.oid=p.pronamespace cross join unnest(array['anon','authenticated','service_role']) r
 where n.nspname='private' and (p.proname like 'analytics\_%' escape '\' or p.proname='require_analytics_service')),
 'private analytics helpers have no application execute grant');
select ok((select bool_and(p.prosecdef and 'search_path=""'=any(p.proconfig)) from pg_proc p
 join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'analytics\_%' escape '\'),
 'all public analytics privilege crossings pin an empty search path');
select ok((select bool_and(not has_function_privilege('anon',p.oid,'EXECUTE')) from pg_proc p
 join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'analytics\_%' escape '\'),
 'anonymous ingestion is disabled until an explicit anonymous consent contract exists');
select ok((select bool_and(not has_function_privilege('authenticated',p.oid,'EXECUTE')) from pg_proc p
 join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
 and p.proname in ('analytics_record_server','analytics_record_charge','analytics_purge_expired')),
 'browser and browser-admin roles cannot impersonate trusted ingestion or retention workers');
select ok((select bool_and(not has_function_privilege('service_role',p.oid,'EXECUTE')) from pg_proc p
 join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
 and p.proname in ('analytics_get_consent','analytics_set_consent','analytics_record_client')),
 'service role cannot manufacture self-service browser consent or client identity');
select ok(not exists(select 1 from information_schema.columns where table_schema='private'
 and table_name='analytics_events' and column_name in
 ('properties','payload','email','phone','name_text','device_id','ip_address','url','body','token','user_agent')),
 'raw events expose no free-text property bag, content, device fingerprint or token storage');
select ok(not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname like 'analytics\_%' escape '\'
 and ('text'::regtype=any(p.proargtypes) or 'json'::regtype=any(p.proargtypes) or 'jsonb'::regtype=any(p.proargtypes))),
 'public inputs are typed UUID/enums/dates/booleans/integers, never arbitrary text or JSON');
select ok((select proargnames=array['p_from','p_until','day_kst','name','event_count']
 from pg_proc where oid='public.analytics_daily_counts(date,date)'::regprocedure),
 'aggregate projection has no person, source, consent, content or secret dimension');
select ok((select not (proargnames && array['p_actor_id','p_user_id','p_occurred_at','p_recorded_at'])
 from pg_proc where oid='public.analytics_record_client(uuid,public.analytics_event_name,uuid,public.analytics_voice_context)'::regprocedure),
 'client entry cannot choose actor identity or collection timestamp');

set local role anon;
select throws_ok($$select public.analytics_record_client(gen_random_uuid(),'voice_input_used',null,'reply')$$,
 '42501',null,'anonymous client event RPC is not executable');
select throws_ok($$select * from public.analytics_daily_counts('2026-01-01','2026-01-02')$$,
 '42501',null,'anonymous caller cannot query aggregate activity');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','f1000000-0000-4000-8000-000000000001',true);
select is((select granted from public.analytics_get_consent()),false,'missing policy is reported as no consent');
select is((select collection_enabled from public.analytics_get_consent()),false,'collection is disabled without explicit approved policy');
select is((select consent_version from public.analytics_get_consent()),null::uuid,'missing policy does not invent a consent version');
select throws_ok($$select public.analytics_set_consent(true,'f9000000-0000-4000-8000-000000000001')$$,
 '55000','ANALYTICS_CONSENT_REQUIRED','client cannot activate missing policy');
select throws_ok($$select public.analytics_set_consent(null,null)$$,'22004','ANALYTICS_CONSENT_REQUIRED','NULL is not a consent choice');
select lives_ok($$select public.analytics_set_consent(false,null)$$,'withdrawal is harmless even before policy or consent exists');
select throws_ok($$select public.analytics_record_client(gen_random_uuid(),'voice_input_used',null,'reply')$$,
 '55000','ANALYTICS_CONSENT_REQUIRED','default-off collection cannot silently opt the fan in');
select throws_ok($$select * from private.analytics_events$$,'42501',null,'fan cannot read raw analytics rows');
select throws_ok($$select * from private.analytics_consents$$,'42501',null,'fan cannot enumerate other users consent');
select throws_ok($$select public.analytics_record_server('f1000000-0000-4000-8000-000000000002',gen_random_uuid(),'signup_complete')$$,
 '42501',null,'fan cannot nominate an actor through the server-only function');
select throws_ok($$select public.analytics_record_charge(gen_random_uuid())$$,'42501',null,'fan cannot spoof purchase via charge function');
select throws_ok($$select public.analytics_purge_expired(1000)$$,'42501',null,'fan cannot erase raw history');
select throws_ok($$select * from public.analytics_daily_counts('2026-01-01','2026-01-02')$$,
 '42501','ANALYTICS_ADMIN_REQUIRED','fan role cannot read analytics aggregates');
reset role;
set local role service_role;
select throws_ok($$select * from private.analytics_events$$,'42501',null,'service role is not a bulk personal-event reader');
select throws_ok($$insert into private.analytics_policy values(true,gen_random_uuid(),true,30)$$,
 '42501',null,'service ingestion credential cannot approve its own consent policy');
select throws_ok($$update private.analytics_consents set granted=true$$,'42501',null,'service cannot bypass explicit user consent');
select throws_ok($$delete from private.analytics_events$$,'42501',null,'service deletion is restricted to bounded retention RPC');
select throws_ok($$select public.analytics_set_consent(true,gen_random_uuid())$$,'42501',null,'service cannot create consent with a forged session subject');
select throws_ok($$select public.analytics_purge_expired(1)$$,'55000','ANALYTICS_POLICY_REQUIRED','retention refuses to invent missing policy');
reset role;
-- Fictional approved/public policy bodies exist only in this rolled-back test.
insert into private.onboarding_documents(version,kind,title,body,approved_at,published_at) values
 ('f9000000-0000-4000-8000-000000000001','analytics','Fictional CI analytics policy','Fictional test fixture only; not legal policy.',now(),now()),
 ('f9000000-0000-4000-8000-000000000002','analytics','Fictional CI analytics policy','Fictional test fixture only; not legal policy.',now(),now());
insert into private.analytics_policy(consent_version,enabled,retention_days)
 values('f9000000-0000-4000-8000-000000000001',true,30);
select throws_ok($$update private.analytics_policy set retention_days=0$$,'23514',null,'zero retention window is structurally invalid');
select throws_ok($$update private.analytics_policy set retention_days=3651$$,'23514',null,'retention window has a finite structural ceiling');
set local role authenticated;
select throws_ok($$select public.analytics_set_consent(true,null)$$,'55000','ANALYTICS_CONSENT_REQUIRED','explicit approved version is required');
select throws_ok($$select public.analytics_set_consent(true,'f9000000-0000-4000-8000-000000000099')$$,
 '55000','ANALYTICS_CONSENT_REQUIRED','arbitrary consent version is not accepted');
select public.analytics_set_consent(true,'f9000000-0000-4000-8000-000000000001');
reset role;
insert into analytics_security_context(key,stamp) select 'first-consent',granted_at from private.analytics_consents
 where user_id='f1000000-0000-4000-8000-000000000001';
set local role authenticated;
select public.analytics_set_consent(true,'f9000000-0000-4000-8000-000000000001');
reset role;
select is((select granted_at from private.analytics_consents where user_id='f1000000-0000-4000-8000-000000000001'),
 (select stamp from analytics_security_context where key='first-consent'),'identical opt-in replay preserves original consent start');
select is((select count(*) from private.analytics_consents where user_id<>'f1000000-0000-4000-8000-000000000001'),0::bigint,
 'self-service consent writes exactly the authenticated actor row');
set local role authenticated;
select throws_ok($$select public.analytics_record_client(null,'voice_input_used',null,'reply')$$,
 '22004','ANALYTICS_EVENT_REQUIRED','missing idempotency key is rejected');
select throws_ok($$select public.analytics_record_client(gen_random_uuid(),null,null,'reply')$$,
 '42501','ANALYTICS_CLIENT_EVENT_FORBIDDEN','NULL event name does not bypass client allowlist');
select throws_ok($$select public.analytics_record_client(gen_random_uuid(),'subscribe_complete',gen_random_uuid())$$,
 '42501','ANALYTICS_CLIENT_EVENT_FORBIDDEN','client cannot report purchase completion');
select throws_ok($$select public.analytics_record_client(gen_random_uuid(),'renew',gen_random_uuid())$$,
 '42501','ANALYTICS_CLIENT_EVENT_FORBIDDEN','client cannot report renewal');
select throws_ok($$select public.analytics_record_client(gen_random_uuid(),'signup_complete')$$,
 '42501','ANALYTICS_CLIENT_EVENT_FORBIDDEN','client cannot report server-only onboarding success');
select throws_ok($$select public.analytics_record_client(gen_random_uuid(),'font_size_selected')$$,
 '42501','ANALYTICS_CLIENT_EVENT_FORBIDDEN','font event remains on trusted server side of specified client boundary');
select throws_ok($$select public.analytics_record_client(gen_random_uuid(),'message_open',gen_random_uuid())$$,
 '42501','ANALYTICS_SOURCE_FORBIDDEN','client cannot report an inaccessible or nonexistent message');
select throws_ok($$select public.analytics_record_client(gen_random_uuid(),'voice_input_used',null,null)$$,
 '23514',null,'voice event requires one allowed context');
select throws_ok($$select public.analytics_record_client(gen_random_uuid(),'voice_input_used',gen_random_uuid(),'reply')$$,
 '23514',null,'voice event cannot smuggle an unrelated source identifier');
select throws_ok($$select public.analytics_record_client(gen_random_uuid(),'voice_input_used',null,'someone@example.invalid')$$,
 '22P02',null,'email cannot be used as an enum property');
select throws_ok($$select public.analytics_record_client(gen_random_uuid(),'voice_input_used','https://example.invalid/secret','reply')$$,
 '22P02',null,'URL cannot be used as a source UUID');
select throws_ok($$select public.analytics_record_client('personal-name','voice_input_used',null,'reply')$$,
 '22P02',null,'free-form personal data cannot be used as retry identity');
select throws_ok($$select public.analytics_record_client(gen_random_uuid(),'arbitrary_event',null,'reply')$$,
 '22P02',null,'unapproved event name is rejected by database enum');
select throws_ok($$select public.analytics_record_client(p_event_key=>gen_random_uuid(),p_name=>'voice_input_used',p_properties=>'{}'::jsonb)$$,
 '42883',null,'RPC has no arbitrary JSON property bag parameter');
insert into analytics_security_context(key,id) values('own-client',public.analytics_record_client(
 'f8000000-0000-4000-8000-000000000001','voice_input_used',null,'reply'));
reset role;
select is((select user_id from private.analytics_events where id=(select id from analytics_security_context where key='own-client')),
 'f1000000-0000-4000-8000-000000000001'::uuid,'client event user is bound to auth.uid, not payload metadata');
select is((select count(*) from private.analytics_events),1::bigint,'rejected event payloads leave no partial rows');
set local role authenticated;
select set_config('request.jwt.claim.sub','f1000000-0000-4000-8000-000000000002',true);
select throws_ok($$select public.analytics_record_client(gen_random_uuid(),'voice_input_used',null,'reply')$$,
 '55000','ANALYTICS_CONSENT_REQUIRED','another fan cannot borrow the first fan consent');
select public.analytics_set_consent(true,'f9000000-0000-4000-8000-000000000001');
insert into analytics_security_context(key,id) values('other-client',public.analytics_record_client(
 'f8000000-0000-4000-8000-000000000001','voice_input_used',null,'reply'));
reset role;
select isnt((select id from analytics_security_context where key='own-client'),(select id from analytics_security_context where key='other-client'),
 'same retry UUID is safely isolated by actor identity');
set local role authenticated;
select set_config('request.jwt.claim.sub','f1000000-0000-4000-8000-000000000003',true);
select throws_ok($$select public.analytics_set_consent(true,'f9000000-0000-4000-8000-000000000001')$$,
 '42501','ANALYTICS_ACTOR_FORBIDDEN','artist role is not an eligible fan analytics actor');
select throws_ok($$select * from public.analytics_daily_counts('2026-01-01','2026-01-02')$$,
 '42501','ANALYTICS_ADMIN_REQUIRED','artist cannot infer fan activity from aggregate API');
select set_config('request.jwt.claim.sub','f1000000-0000-4000-8000-000000000004',true);
select throws_ok($$select * from private.analytics_events$$,'42501',null,'administrator cannot inspect raw person-level event rows');
select throws_ok($$select public.analytics_record_charge(gen_random_uuid())$$,'42501',null,'administrator browser cannot impersonate verified charge ingestion');
select lives_ok($$select * from public.analytics_daily_counts('2026-01-01','2026-01-02')$$,'administrator can read only bounded aggregate DTO');
select set_config('request.jwt.claim.sub','f1000000-0000-4000-8000-000000000006',true);
select throws_ok($$select public.analytics_set_consent(true,'f9000000-0000-4000-8000-000000000001')$$,
 '42501','ANALYTICS_ACTOR_FORBIDDEN','currently restricted fan cannot opt in for collection');
select lives_ok($$select public.analytics_set_consent(false,null)$$,'restricted user retains consent withdrawal capability');
select set_config('request.jwt.claim.sub','f1000000-0000-4000-8000-000000000007',true);
select lives_ok($$select public.analytics_set_consent(true,'f9000000-0000-4000-8000-000000000001')$$,
 'expired restriction does not permanently suppress valid fan consent');
select lives_ok($$select public.analytics_record_client(gen_random_uuid(),'voice_input_used',null,'reply')$$,
 'expired restriction permits consented client observation');
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claims','{}',true);
select throws_ok($$select public.analytics_get_consent()$$,'42501','ANALYTICS_ACTOR_FORBIDDEN','authenticated role without subject has no own consent');
select throws_ok($$select public.analytics_set_consent(true,'f9000000-0000-4000-8000-000000000001')$$,
 '42501','ANALYTICS_ACTOR_FORBIDDEN','authenticated role alone is not an actor identity');
select throws_ok($$select public.analytics_record_client(gen_random_uuid(),'voice_input_used',null,'reply')$$,
 '42501','ANALYTICS_ACTOR_FORBIDDEN','missing actor cannot create anonymous event through authenticated RPC');
select set_config('request.jwt.claim.sub','f1000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"role":"service_role","user_metadata":{"role":"admin"}}',true);
select throws_ok($$select public.analytics_record_charge(gen_random_uuid())$$,'42501',null,'editable JWT metadata cannot promote actual database role');
reset role;
set local role service_role;
select throws_ok($$select public.analytics_record_server('f1000000-0000-4000-8000-000000000001',gen_random_uuid(),'subscribe_complete',gen_random_uuid())$$,
 '42501','ANALYTICS_SERVER_EVENT_FORBIDDEN','generic trusted writer cannot fabricate purchase from typed source UUID');
select throws_ok($$select public.analytics_record_server('f1000000-0000-4000-8000-000000000001',gen_random_uuid(),'renew',gen_random_uuid())$$,
 '42501','ANALYTICS_SERVER_EVENT_FORBIDDEN','generic trusted writer cannot fabricate renewal');
select throws_ok($$select public.analytics_record_server('f1000000-0000-4000-8000-000000000001',gen_random_uuid(),'voice_input_used')$$,
 '42501','ANALYTICS_SERVER_EVENT_FORBIDDEN','generic server writer cannot bypass auth.uid client observation boundary');
select throws_ok($$select public.analytics_record_charge(null)$$,'42501','ANALYTICS_VERIFIED_CHARGE_REQUIRED','NULL ledger reference is not verified evidence');
select throws_ok($$select public.analytics_record_charge(gen_random_uuid())$$,'42501','ANALYTICS_VERIFIED_CHARGE_REQUIRED','arbitrary UUID is not verified evidence');
select throws_ok($$select public.analytics_record_server('f1000000-0000-4000-8000-000000000001',gen_random_uuid(),'signup_complete')$$,
 '22023','ANALYTICS_EVENT_TIME_INVALID','consent does not authorize retrospective pre-consent onboarding event');
select throws_ok($$select public.analytics_record_server('f1000000-0000-4000-8000-000000000001',gen_random_uuid(),'font_size_selected',null,'xlarge')$$,
 '42501','ANALYTICS_SOURCE_FORBIDDEN','service cannot report a font that profile did not select');
select throws_ok($$select public.analytics_record_server('f1000000-0000-4000-8000-000000000001',gen_random_uuid(),'preview_view',gen_random_uuid())$$,
 '42501','ANALYTICS_SOURCE_FORBIDDEN','preview_view requires an actual actor-owned eligible source');
select throws_ok($$select public.analytics_record_server('f1000000-0000-4000-8000-000000000001',gen_random_uuid(),'subscribe_start',gen_random_uuid())$$,
 '42501','ANALYTICS_SOURCE_FORBIDDEN','subscribe_start requires an actual actor-owned eligible source');
select throws_ok($$select public.analytics_record_server('f1000000-0000-4000-8000-000000000001',gen_random_uuid(),'subscribe_fail',gen_random_uuid())$$,
 '42501','ANALYTICS_SOURCE_FORBIDDEN','subscribe_fail requires an actual actor-owned eligible source');
select throws_ok($$select public.analytics_record_server('f1000000-0000-4000-8000-000000000001',gen_random_uuid(),'cancel',gen_random_uuid())$$,
 '42501','ANALYTICS_SOURCE_FORBIDDEN','cancel requires an actual actor-owned eligible source');
select throws_ok($$select public.analytics_record_server('f1000000-0000-4000-8000-000000000001',gen_random_uuid(),'reply_sent',gen_random_uuid())$$,
 '42501','ANALYTICS_SOURCE_FORBIDDEN','reply_sent requires an actual actor-owned eligible source');
select throws_ok($$select public.analytics_record_server('f1000000-0000-4000-8000-000000000001',gen_random_uuid(),'post_create',gen_random_uuid())$$,
 '42501','ANALYTICS_SOURCE_FORBIDDEN','post_create requires an actual actor-owned eligible source');
select throws_ok($$select public.analytics_record_server('f1000000-0000-4000-8000-000000000001',gen_random_uuid(),'attendance',gen_random_uuid())$$,
 '42501','ANALYTICS_SOURCE_FORBIDDEN','attendance requires an actual actor-owned eligible source');
reset role;
-- Owner-only structural probes; the application has no raw INSERT grant.
select throws_ok($$insert into private.analytics_events(user_id,event_key,name,origin,source_id,font_scale,voice_context,consent_version,occurred_at,recorded_at)
 values('f1000000-0000-4000-8000-000000000001',gen_random_uuid(),'signup_complete','server',gen_random_uuid(),null,null,
 'f9000000-0000-4000-8000-000000000001',now(),now())$$,'23514',null,'signup_complete has an exact required property shape');
select throws_ok($$insert into private.analytics_events(user_id,event_key,name,origin,source_id,font_scale,voice_context,consent_version,occurred_at,recorded_at)
 values('f1000000-0000-4000-8000-000000000001',gen_random_uuid(),'font_size_selected','server',gen_random_uuid(),'large',null,
 'f9000000-0000-4000-8000-000000000001',now(),now())$$,'23514',null,'font_size_selected has an exact required property shape');
select throws_ok($$insert into private.analytics_events(user_id,event_key,name,origin,source_id,font_scale,voice_context,consent_version,occurred_at,recorded_at)
 values('f1000000-0000-4000-8000-000000000001',gen_random_uuid(),'preview_view','server',null,null,null,
 'f9000000-0000-4000-8000-000000000001',now(),now())$$,'23514',null,'preview_view has an exact required property shape');
select throws_ok($$insert into private.analytics_events(user_id,event_key,name,origin,source_id,font_scale,voice_context,consent_version,occurred_at,recorded_at)
 values('f1000000-0000-4000-8000-000000000001',gen_random_uuid(),'subscribe_start','server',null,null,null,
 'f9000000-0000-4000-8000-000000000001',now(),now())$$,'23514',null,'subscribe_start has an exact required property shape');
select throws_ok($$insert into private.analytics_events(user_id,event_key,name,origin,source_id,font_scale,voice_context,consent_version,occurred_at,recorded_at)
 values('f1000000-0000-4000-8000-000000000001',gen_random_uuid(),'subscribe_complete','verified_charge',null,null,null,
 'f9000000-0000-4000-8000-000000000001',now(),now())$$,'23514',null,'subscribe_complete has an exact required property shape');
select throws_ok($$insert into private.analytics_events(user_id,event_key,name,origin,source_id,font_scale,voice_context,consent_version,occurred_at,recorded_at)
 values('f1000000-0000-4000-8000-000000000001',gen_random_uuid(),'subscribe_fail','server',null,null,null,
 'f9000000-0000-4000-8000-000000000001',now(),now())$$,'23514',null,'subscribe_fail has an exact required property shape');
select throws_ok($$insert into private.analytics_events(user_id,event_key,name,origin,source_id,font_scale,voice_context,consent_version,occurred_at,recorded_at)
 values('f1000000-0000-4000-8000-000000000001',gen_random_uuid(),'message_open','client',null,null,null,
 'f9000000-0000-4000-8000-000000000001',now(),now())$$,'23514',null,'message_open has an exact required property shape');
select throws_ok($$insert into private.analytics_events(user_id,event_key,name,origin,source_id,font_scale,voice_context,consent_version,occurred_at,recorded_at)
 values('f1000000-0000-4000-8000-000000000001',gen_random_uuid(),'reply_sent','server',null,null,null,
 'f9000000-0000-4000-8000-000000000001',now(),now())$$,'23514',null,'reply_sent has an exact required property shape');
select throws_ok($$insert into private.analytics_events(user_id,event_key,name,origin,source_id,font_scale,voice_context,consent_version,occurred_at,recorded_at)
 values('f1000000-0000-4000-8000-000000000001',gen_random_uuid(),'voice_input_used','client',gen_random_uuid(),null,'reply',
 'f9000000-0000-4000-8000-000000000001',now(),now())$$,'23514',null,'voice_input_used has an exact required property shape');
select throws_ok($$insert into private.analytics_events(user_id,event_key,name,origin,source_id,font_scale,voice_context,consent_version,occurred_at,recorded_at)
 values('f1000000-0000-4000-8000-000000000001',gen_random_uuid(),'renew','verified_charge',null,null,null,
 'f9000000-0000-4000-8000-000000000001',now(),now())$$,'23514',null,'renew has an exact required property shape');
select throws_ok($$insert into private.analytics_events(user_id,event_key,name,origin,source_id,font_scale,voice_context,consent_version,occurred_at,recorded_at)
 values('f1000000-0000-4000-8000-000000000001',gen_random_uuid(),'cancel','server',null,null,null,
 'f9000000-0000-4000-8000-000000000001',now(),now())$$,'23514',null,'cancel has an exact required property shape');
select throws_ok($$insert into private.analytics_events(user_id,event_key,name,origin,source_id,font_scale,voice_context,consent_version,occurred_at,recorded_at)
 values('f1000000-0000-4000-8000-000000000001',gen_random_uuid(),'post_create','server',null,null,null,
 'f9000000-0000-4000-8000-000000000001',now(),now())$$,'23514',null,'post_create has an exact required property shape');
select throws_ok($$insert into private.analytics_events(user_id,event_key,name,origin,source_id,font_scale,voice_context,consent_version,occurred_at,recorded_at)
 values('f1000000-0000-4000-8000-000000000001',gen_random_uuid(),'attendance','server',null,null,null,
 'f9000000-0000-4000-8000-000000000001',now(),now())$$,'23514',null,'attendance has an exact required property shape');
select throws_ok($$insert into private.analytics_events(user_id,event_key,name,origin,source_id,consent_version,occurred_at,recorded_at)
 values('f1000000-0000-4000-8000-000000000001',gen_random_uuid(),'subscribe_complete','client',gen_random_uuid(),
 'f9000000-0000-4000-8000-000000000001',now(),now())$$,'23514',null,'storage constraint forbids client authority for purchase event');
select throws_ok($$insert into private.analytics_events(user_id,event_key,name,origin,voice_context,consent_version,occurred_at,recorded_at)
 values('f1000000-0000-4000-8000-000000000001',gen_random_uuid(),'voice_input_used','client','reply',
 'f9000000-0000-4000-8000-000000000001','infinity','infinity')$$,'23514',null,'event timestamps cannot be infinite');
select throws_ok($$insert into private.analytics_events(user_id,event_key,name,origin,voice_context,consent_version,occurred_at,recorded_at)
 values('f1000000-0000-4000-8000-000000000001',gen_random_uuid(),'voice_input_used','client','reply',
 'f9000000-0000-4000-8000-000000000001',now(),now()-interval '1 second')$$,'23514',null,'recorded time cannot precede occurred time');
select throws_ok($$select private.analytics_append('f1000000-0000-4000-8000-000000000001',gen_random_uuid(),
 'voice_input_used','client',null,null,'reply','infinity')$$,'22023','ANALYTICS_EVENT_TIME_INVALID','intake rejects nonfinite event time even for internal helper');
select throws_ok($$select private.analytics_append('f1000000-0000-4000-8000-000000000001',gen_random_uuid(),
 'voice_input_used','client',null,null,'reply',clock_timestamp()+interval '1 day')$$,'22023','ANALYTICS_EVENT_TIME_INVALID','intake rejects future event time');
select throws_ok($$select private.analytics_append('f1000000-0000-4000-8000-000000000001',gen_random_uuid(),
 'voice_input_used','client',null,null,'reply',now())$$,'22023','ANALYTICS_EVENT_TIME_INVALID',
 'source using transaction-start now before same-transaction consent is safely rejected, not backdated');
-- Separate finite age guard from consent's start boundary using owner-only old consent fixture.
update private.analytics_consents set granted_at=clock_timestamp()-interval '60 days'
 where user_id='f1000000-0000-4000-8000-000000000001';
select throws_ok($$select private.analytics_append('f1000000-0000-4000-8000-000000000001',gen_random_uuid(),
 'voice_input_used','client',null,null,'reply',clock_timestamp()-interval '31 days')$$,
 '22023','ANALYTICS_EVENT_TIME_INVALID','approved retention age blocks old observations even when consent predates them');
update private.analytics_consents set granted_at=(select stamp from analytics_security_context where key='first-consent')
 where user_id='f1000000-0000-4000-8000-000000000001';
select lives_ok($$insert into private.analytics_events(user_id,event_key,name,origin,voice_context,consent_version,occurred_at,recorded_at)
 values('f1000000-0000-4000-8000-000000000001',gen_random_uuid(),'voice_input_used','client','reply',
 'f9000000-0000-4000-8000-000000000001',date_trunc('month',now())+interval '1 month',date_trunc('month',now())+interval '1 month')$$,
 'owner-only future-month storage probe has no missing partition dependency; intake future time remains forbidden');
insert into public.artists(id,slug,name,grade,status)
 values('f2000000-0000-4000-8000-000000000001','analytics-security-unverified','가상 검증 누락 가수','B','active');
insert into public.subscriptions(id,user_id,artist_id,provider,status)
 values('f3000000-0000-4000-8000-000000000001','f1000000-0000-4000-8000-000000000001','f2000000-0000-4000-8000-000000000001','toss','pending');
insert into public.payment_events(id,subscription_id,kind,amount_krw,currency,provider,period_start,period_end,occurred_at)
 values('f4000000-0000-4000-8000-000000000001','f3000000-0000-4000-8000-000000000001','charge',1000,'KRW','toss',
 now()-interval '1 day',now()+interval '29 days',clock_timestamp());
set local role service_role;
select throws_ok($$select public.analytics_record_charge('f4000000-0000-4000-8000-000000000001')$$,
 '42501','ANALYTICS_VERIFIED_CHARGE_REQUIRED','financial row without private attempt and verification evidence cannot become purchase analytics');
reset role;
update public.profiles set is_restricted=true where id='f1000000-0000-4000-8000-000000000001';
set local role authenticated;
select throws_ok($$select public.analytics_record_client(gen_random_uuid(),'voice_input_used',null,'reply')$$,
 '42501','ANALYTICS_ACTOR_FORBIDDEN','new restriction overrides a previously granted analytics consent');
select lives_ok($$select public.analytics_set_consent(false,null)$$,'restricted user may withdraw an existing granted consent');
reset role;
select is((select granted from private.analytics_consents where user_id='f1000000-0000-4000-8000-000000000001'),false,
 'withdrawal while restricted updates own stored consent rather than silently doing nothing');
update public.profiles set is_restricted=false where id='f1000000-0000-4000-8000-000000000001';
-- Approved policy change invalidates older consent; re-approval is explicit.
update private.analytics_policy set consent_version='f9000000-0000-4000-8000-000000000002';
set local role authenticated;
select is((select granted from public.analytics_get_consent()),false,'new policy version does not inherit consent to old version');
select throws_ok($$select public.analytics_record_client(gen_random_uuid(),'voice_input_used',null,'reply')$$,
 '55000','ANALYTICS_CONSENT_REQUIRED','policy version change stops old-version collection');
select public.analytics_set_consent(true,'f9000000-0000-4000-8000-000000000002');
select lives_ok($$select public.analytics_record_client(gen_random_uuid(),'voice_input_used',null,'reply')$$,'explicit current-version reconsent permits new observation');
reset role;
update private.analytics_policy set enabled=false;
set local role authenticated;
select is((select collection_enabled from public.analytics_get_consent()),false,'operator disablement is visible as collection disabled');
select throws_ok($$select public.analytics_record_client(gen_random_uuid(),'voice_input_used',null,'reply')$$,
 '55000','ANALYTICS_CONSENT_REQUIRED','disabled policy blocks even current-version consent');
select lives_ok($$select public.analytics_set_consent(false,null)$$,'withdrawal still works when policy is disabled');
reset role;
update public.profiles set is_restricted=true where id='f1000000-0000-4000-8000-000000000004';
set local role authenticated;
select set_config('request.jwt.claim.sub','f1000000-0000-4000-8000-000000000004',true);
select throws_ok($$select * from public.analytics_daily_counts('2026-01-01','2026-01-02')$$,
 '42501','ANALYTICS_ADMIN_REQUIRED','restricted admin loses aggregate access');
reset role;
set local role service_role;
select throws_ok($$select * from public.analytics_daily_counts(null,'2026-01-02')$$,'22023','ANALYTICS_RANGE_INVALID','NULL range start is invalid');
select throws_ok($$select * from public.analytics_daily_counts('2026-01-01',null)$$,'22023','ANALYTICS_RANGE_INVALID','NULL range end is invalid');
select throws_ok($$select * from public.analytics_daily_counts('-infinity','2026-01-02')$$,'22023','ANALYTICS_RANGE_INVALID','nonfinite range start is invalid');
select throws_ok($$select * from public.analytics_daily_counts('2026-01-01','infinity')$$,'22023','ANALYTICS_RANGE_INVALID','nonfinite range end is invalid');
select throws_ok($$select * from public.analytics_daily_counts('2026-01-01','2026-01-01')$$,'22023','ANALYTICS_RANGE_INVALID','empty range is invalid');
select throws_ok($$select * from public.analytics_daily_counts('2026-01-02','2026-01-01')$$,'22023','ANALYTICS_RANGE_INVALID','reversed range is invalid');
select throws_ok($$select * from public.analytics_daily_counts('2026-01-01','2027-01-03')$$,'22023','ANALYTICS_RANGE_INVALID','range wider than 366 days is invalid');
select lives_ok($$select * from public.analytics_daily_counts('2026-01-01','2027-01-02')$$,'exact 366-day maximum range is accepted');
select throws_ok($$select * from public.analytics_daily_counts('0001-01-01 BC','0001-01-02')$$,'22023','ANALYTICS_RANGE_INVALID','dates before supported Gregorian year floor are refused');
select throws_ok($$select * from public.analytics_daily_counts('9999-12-31','10000-01-01')$$,'22023','ANALYTICS_RANGE_INVALID','dates beyond supported year ceiling are refused');
select throws_ok($$select public.analytics_purge_expired(null)$$,'22023','ANALYTICS_LIMIT_INVALID','NULL retention batch is invalid');
select throws_ok($$select public.analytics_purge_expired(0)$$,'22023','ANALYTICS_LIMIT_INVALID','zero retention batch is invalid');
select throws_ok($$select public.analytics_purge_expired(10001)$$,'22023','ANALYTICS_LIMIT_INVALID','unbounded retention batch is refused');
select is(public.analytics_purge_expired(10000),0,'maximum retention batch is bounded and does not erase current data');
reset role;
select * from finish();
rollback;
