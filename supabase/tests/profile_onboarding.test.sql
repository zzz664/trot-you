begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();

-- All identities and policy text are fictional, transaction-local fixtures.
select is((select count(*) from private.profile_onboarding_policy),0::bigint,'no operational name/legal policy is activated by migration');
select is((select count(*) from private.onboarding_documents),0::bigint,'no legal copy is fabricated or seeded');
select is((select count(*) from private.profile_policy_acceptances),0::bigint,'migration accepts no policy for any person');
insert into auth.users(id,email,raw_user_meta_data) values
 ('d1000000-0000-4000-8000-000000000001','profile-one@example.invalid',
  '{"role":"admin","font_selected_at":"2026-01-01","profile_completed_at":"2026-01-01","age_self_attested_at":"2026-01-01","onboarding_completed_at":"2026-01-01","terms_accepted":true}'),
 ('d1000000-0000-4000-8000-000000000002','profile-two@example.invalid','{}'),
 ('d1000000-0000-4000-8000-000000000003','profile-three@example.invalid','{}');
select ok((select font_selected_at is null and age_self_attested_at is null and profile_completed_at is null
  and onboarding_completed_at is null and role='fan' from public.profiles
  where id='d1000000-0000-4000-8000-000000000001'),'editable metadata cannot attest age, accept consent, finish stages or grant role');
create temporary table onboarding_stamps(key text primary key,stamp timestamptz);
grant all on onboarding_stamps to authenticated;
select ok((select bool_and(relrowsecurity) from pg_class where oid in
 ('private.onboarding_documents'::regclass,'private.profile_onboarding_policy'::regclass,
  'private.profile_policy_acceptances'::regclass)),'all private tables enable RLS');
select ok((select bool_and(not has_table_privilege(r,t,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'))
 from unnest(array['anon','authenticated','service_role']) r cross join unnest(array[
 'private.onboarding_documents','private.profile_onboarding_policy','private.profile_policy_acceptances']) t),
 'no application role can author legal policy, activate settings or forge acceptance rows');
select ok((select bool_and(not has_column_privilege('authenticated','public.profiles',c,'UPDATE'))
 from unnest(array['font_selected_at','age_self_attested_at','profile_completed_at','onboarding_completed_at','call_name','role']) c),
 'every new authoritative state remains non-writable by direct API');
select ok((select bool_and(p.prosecdef and 'search_path=""'=any(p.proconfig)) from pg_proc p
 join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'onboarding\_%' escape '\'),
 'public privilege crossings pin empty search_path');
select ok((select bool_and(not has_function_privilege(r,p.oid,'EXECUTE')) from pg_proc p
 join pg_namespace n on n.oid=p.pronamespace cross join unnest(array['anon','service_role']) r
 where n.nspname='public' and p.proname like 'onboarding\_%' escape '\'),
 'anonymous and service roles cannot impersonate self-service actors');
select ok((select bool_and(not has_function_privilege(r,p.oid,'EXECUTE')) from pg_proc p
 join pg_namespace n on n.oid=p.pronamespace cross join unnest(array['anon','authenticated','service_role']) r
 where n.nspname='private' and p.proname like 'onboarding\_%' escape '\'),
 'private helpers are not executable via app roles');
select ok((select bool_and(not (coalesce(p.proargnames,array[]::text[]) &&
 array['p_user_id','p_actor_id','p_role','p_completed_at','p_accepted_at'])) from pg_proc p
 join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'onboarding\_%' escape '\'),
 'no actor, role, completion or consent timestamp is caller-selectable');
set local role anon;
select is((select count(*) from public.onboarding_policy_documents),0::bigint,'public legal projection has no placeholder text');
select throws_ok('select * from public.onboarding_get_state()','42501',null,'anonymous cannot read onboarding state');
select throws_ok($$select public.onboarding_save_font('large')$$,'42501',null,'anonymous cannot mutate profile');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','',true);
select throws_ok('select * from public.onboarding_get_state()','42501','ONBOARDING_ACTOR_FORBIDDEN','missing authenticated subject fails closed');
select set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000001',true);
select is((select name_policy_ready from public.onboarding_get_state()),false,'missing moderation policy is explicit setup-not-ready');
select is((select terms_body from public.onboarding_get_state()),null::text,'missing required policy has no invented body');
select is((select analytics_available from public.onboarding_get_state()),false,'optional analytics defaults unavailable/off');
select throws_ok($$select public.onboarding_save_name('가상팬')$$,'55000','ONBOARDING_FONT_REQUIRED','name step cannot skip font selection');
select throws_ok($$select public.onboarding_save_font(null)$$,'22023','ONBOARDING_FONT_INVALID','null font is not selection');
select lives_ok($$select public.onboarding_save_font('normal')$$,'font preference works before policy setup');
insert into onboarding_stamps values('font',(select font_selected_at from public.onboarding_get_state()));
select lives_ok($$select public.onboarding_save_font('xlarge')$$,'font can be changed and resumed');
select is((select font_selected_at from public.onboarding_get_state()),(select stamp from onboarding_stamps where key='font'),'repeated selection preserves first-stage timestamp');
select is((select font_scale::text from public.onboarding_get_state()),'xlarge','latest selected preference persists');
select throws_ok($$select public.onboarding_save_name('가상팬')$$,'55000','ONBOARDING_SETUP_NOT_READY','name never falls back to an allow-all moderation list');
select throws_ok($$update public.profiles set profile_completed_at=now() where id=auth.uid()$$,'42501',null,'direct stage completion is denied');
select throws_ok($$update public.profiles set age_self_attested_at=now() where id=auth.uid()$$,'42501',null,'direct age timestamp forgery is denied');
select throws_ok($$update public.profiles set call_name='금지단어' where id=auth.uid()$$,'42501',null,'direct name update cannot bypass moderation');
select throws_ok($$insert into private.profile_policy_acceptances values(auth.uid(),'terms',gen_random_uuid(),now())$$,'42501',null,'direct acceptance forgery is denied');
reset role;

insert into private.onboarding_documents(version,kind,title,body,approved_at,published_at) values
 ('d9000000-0000-4000-8000-000000000001','terms','Fictional terms','CI fixture only. Not actual legal terms.',now(),now()),
 ('d9000000-0000-4000-8000-000000000002','privacy','Fictional privacy','CI fixture only. Not an actual privacy policy.',now(),now()),
 ('d9000000-0000-4000-8000-000000000003','analytics','Fictional analytics','CI fixture only. Not actual analytics terms.',null,null),
 ('d9000000-0000-4000-8000-000000000004','terms','Fictional new terms','CI rotation fixture only. Not actual legal terms.',now(),now());
select throws_ok($$insert into private.onboarding_documents values(gen_random_uuid(),'terms','Empty',E' \n\t ',now(),now())$$,
 '23514',null,'whitespace-only policy is not a usable document');
select throws_ok($$update private.onboarding_documents set body='Replacement body' where version='d9000000-0000-4000-8000-000000000001'$$,
 '23514','ONBOARDING_DOCUMENT_IMMUTABLE','approved consent text cannot be rewritten under an accepted version');
select throws_ok($$delete from private.onboarding_documents where version='d9000000-0000-4000-8000-000000000001'$$,
 '23514','ONBOARDING_DOCUMENT_IMMUTABLE','approved document cannot be silently deleted');
insert into private.profile_onboarding_policy values(true,'d8000000-0000-4000-8000-000000000001',null,2,10,
 array['금지단어','blocked'],'d9000000-0000-4000-8000-000000000001','d9000000-0000-4000-8000-000000000002',
 'd9000000-0000-4000-8000-000000000003');
set local role anon;
select is((select count(*) from public.onboarding_policy_documents),3::bigint,'public projection excludes unapproved analytics draft');
reset role;
set local role authenticated;
select throws_ok($$select public.onboarding_save_name('가상팬')$$,'55000','ONBOARDING_SETUP_NOT_READY','unapproved name configuration remains failclosed');
reset role;
update private.profile_onboarding_policy set name_approved_at=now();
set local role authenticated;
select is((select name_policy_ready from public.onboarding_get_state()),true,'approved actual moderation configuration is available');
select is((select call_name_min from public.onboarding_get_state()),2,'configured minimum is exposed');
select is((select call_name_max from public.onboarding_get_state()),10,'configured maximum is exposed');
select throws_ok($$select public.onboarding_save_name('가')$$,'22023','ONBOARDING_NAME_INVALID','one character is too short');
select throws_ok($$select public.onboarding_save_name('가나다라마바사아자차카')$$,'22023','ONBOARDING_NAME_INVALID','eleven characters is too long');
select throws_ok($$select public.onboarding_save_name(null)$$,'22023','ONBOARDING_NAME_INVALID','null name is invalid');
select throws_ok($$select public.onboarding_save_name(E'가상\n팬')$$,'22023','ONBOARDING_NAME_INVALID','control characters are rejected');
select throws_ok($$select public.onboarding_save_name(U&'가상\200B팬')$$,'22023','ONBOARDING_NAME_INVALID','invisible characters are rejected');
select throws_ok($$select public.onboarding_save_name(U&'가상\202E팬')$$,'22023','ONBOARDING_NAME_INVALID','bidi override is rejected');
select throws_ok($$select public.onboarding_save_name('앞금지단어뒤')$$,'22023','ONBOARDING_NAME_FORBIDDEN','approved profanity substring is enforced');
select throws_ok($$select public.onboarding_save_name('BLOCKED')$$,'22023','ONBOARDING_NAME_FORBIDDEN','profanity matching is case insensitive');
select lives_ok($$select public.onboarding_save_name(U&' \1100\1161팬 ')$$,'NFC normalization and outer ASCII trim are applied in the database');
select is((select call_name from public.onboarding_get_state()),'가팬','stored name is normalized, not only checked in client');
select lives_ok($$select public.onboarding_save_name('가나다라마바사아자차')$$,'documented ten-character bound is inclusive');
select lives_ok($$select public.onboarding_save_name('가상팬')$$,'valid name persists independently for resumability');
select throws_ok($$select public.onboarding_complete_profile(false,true,'d9000000-0000-4000-8000-000000000001',true,'d9000000-0000-4000-8000-000000000002')$$,
 '22023','ONBOARDING_AGE_REQUIRED','under-14 or absent self-attestation cannot complete profile');
select throws_ok($$select public.onboarding_complete_profile(null,true,'d9000000-0000-4000-8000-000000000001',true,'d9000000-0000-4000-8000-000000000002')$$,
 '22023','ONBOARDING_AGE_REQUIRED','NULL age is not explicit attestation');
select throws_ok($$select public.onboarding_complete_profile(true,false,'d9000000-0000-4000-8000-000000000001',true,'d9000000-0000-4000-8000-000000000002')$$,
 '22023','ONBOARDING_CONSENT_REQUIRED','terms require explicit true choice, not version presence alone');
select throws_ok($$select public.onboarding_complete_profile(true,true,'d9000000-0000-4000-8000-000000000001',false,'d9000000-0000-4000-8000-000000000002')$$,
 '22023','ONBOARDING_CONSENT_REQUIRED','privacy requires independent explicit choice');
select throws_ok($$select public.onboarding_complete_profile(true,true,gen_random_uuid(),true,'d9000000-0000-4000-8000-000000000002')$$,
 '55000','ONBOARDING_POLICY_CHANGED','unknown policy cannot be accepted');
select throws_ok($$select public.onboarding_complete_profile(true,true,'d9000000-0000-4000-8000-000000000001',true,'d9000000-0000-4000-8000-000000000002',true,'d9000000-0000-4000-8000-000000000003')$$,
 '55000','ONBOARDING_ANALYTICS_UNAVAILABLE','optional consent cannot accept unpublished/unconfigured policy');
reset role;
select is((select count(*) from private.profile_policy_acceptances),0::bigint,'all rejected submissions write no partial required consent');
select is((select age_self_attested_at from public.profiles where id='d1000000-0000-4000-8000-000000000001'),null::timestamptz,'all rejected submissions write no partial age evidence');
insert into private.analytics_policy values(true,'d9000000-0000-4000-8000-000000000003',true,30);
set local role authenticated;
select throws_ok($$select public.analytics_set_consent(true,'d9000000-0000-4000-8000-000000000003')$$,
 '55000','ANALYTICS_CONSENT_REQUIRED','legacy direct analytics RPC also rejects unreadable draft policy');
select lives_ok($$select public.onboarding_complete_profile(true,true,'d9000000-0000-4000-8000-000000000001',true,'d9000000-0000-4000-8000-000000000002')$$,
 'required consent can complete without optional analytics');
insert into onboarding_stamps values('completed',(select profile_completed_at from public.onboarding_get_state())),
 ('age',(select age_self_attested_at from public.onboarding_get_state()));
select ok((select profile_completed_at is not null and age_self_attested_at is not null from public.onboarding_get_state()),'profile stage and self-attestation are persisted');
select is((select granted from public.analytics_get_consent()),false,'optional analytics stays off by default');
select lives_ok($$select public.onboarding_complete_profile(true,true,'d9000000-0000-4000-8000-000000000001',true,'d9000000-0000-4000-8000-000000000002')$$,
 'identical repeated profile submit is idempotent');
select is((select profile_completed_at from public.onboarding_get_state()),(select stamp from onboarding_stamps where key='completed'),'retry retains first completion timestamp');
select is((select age_self_attested_at from public.onboarding_get_state()),(select stamp from onboarding_stamps where key='age'),'retry retains first self-attestation timestamp');
reset role;
select is((select count(*) from private.profile_policy_acceptances),2::bigint,'repeat submissions do not duplicate required consent evidence');
select is((select onboarding_completed_at from public.profiles where id='d1000000-0000-4000-8000-000000000001'),null::timestamptz,'profile stage does not skip artist/install full onboarding');
select is((select role::text from public.profiles where id='d1000000-0000-4000-8000-000000000001'),'fan','profile completion never elevates role');
select is((select count(*) from private.analytics_events),0::bigint,'profile stage does not falsely emit signup_complete or collect telemetry');
update private.onboarding_documents set approved_at=now(),published_at=now() where version='d9000000-0000-4000-8000-000000000003';
set local role authenticated;
select is((select analytics_available from public.onboarding_get_state()),true,'optional analytics appears only after exact approved/public document and matching enabled config exist');
select lives_ok($$select public.onboarding_complete_profile(true,true,'d9000000-0000-4000-8000-000000000001',true,'d9000000-0000-4000-8000-000000000002',true,'d9000000-0000-4000-8000-000000000003')$$,
 'optional analytics requires separate explicit opt-in and exact readable version');
select is((select granted from public.analytics_get_consent()),true,'separate optional grant is persisted');
select lives_ok($$select public.onboarding_complete_profile(true,true,'d9000000-0000-4000-8000-000000000001',true,'d9000000-0000-4000-8000-000000000002',false,null)$$,
 'repeat submission with unchecked optional choice withdraws analytics');
select is((select granted from public.analytics_get_consent()),false,'unchecked optional choice does not preserve prior true grant');
select set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000002',true);
select is((select call_name from public.onboarding_get_state()),null::text,'second actor sees only its own resumable state');
select is((select profile_completed_at from public.onboarding_get_state()),null::timestamptz,'second actor cannot borrow prior completion');
select throws_ok($$select public.onboarding_complete_profile(true,true,'d9000000-0000-4000-8000-000000000001',true,'d9000000-0000-4000-8000-000000000002')$$,
 '55000','ONBOARDING_FONT_REQUIRED','second actor cannot borrow first font selection');
reset role;
update private.profile_onboarding_policy set terms_version='d9000000-0000-4000-8000-000000000004';
set local role authenticated;
select set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000001',true);
select is((select profile_completed_at from public.onboarding_get_state()),null::timestamptz,'current consent rollover resumes required consent instead of skipping ahead');
select throws_ok($$select public.onboarding_complete_profile(true,true,'d9000000-0000-4000-8000-000000000001',true,'d9000000-0000-4000-8000-000000000002')$$,
 '55000','ONBOARDING_POLICY_CHANGED','stale page submission cannot accept newer unseen policy');
select lives_ok($$select public.onboarding_complete_profile(true,true,'d9000000-0000-4000-8000-000000000004',true,'d9000000-0000-4000-8000-000000000002')$$,
 'explicit acceptance of current readable version resumes profile stage');
select is((select profile_completed_at from public.onboarding_get_state()),(select stamp from onboarding_stamps where key='completed'),'new version preserves original stage evidence timestamp');
reset role;
update private.profile_onboarding_policy set privacy_version=null;
set local role authenticated;
select is((select profile_completed_at from public.onboarding_get_state()),null::timestamptz,'missing required active policy makes effective stage incomplete');
select throws_ok($$select public.onboarding_complete_profile(true,true,'d9000000-0000-4000-8000-000000000004',true,'d9000000-0000-4000-8000-000000000002')$$,
 '55000','ONBOARDING_SETUP_NOT_READY','missing policy failsclosed even after prior profile completion');
reset role;
update private.profile_onboarding_policy set privacy_version='d9000000-0000-4000-8000-000000000002',profanity_words=array['가상팬'];
set local role authenticated;
select throws_ok($$select public.onboarding_complete_profile(true,true,'d9000000-0000-4000-8000-000000000004',true,'d9000000-0000-4000-8000-000000000002')$$,
 '22023','ONBOARDING_NAME_FORBIDDEN','completion revalidates saved name against latest approved moderation policy');
reset role;
update public.profiles set is_restricted=true where id='d1000000-0000-4000-8000-000000000001';
set local role authenticated;
select throws_ok('select * from public.onboarding_get_state()','42501','ONBOARDING_ACTOR_FORBIDDEN','restricted actor cannot continue onboarding');
select throws_ok($$select public.onboarding_save_font('normal')$$,'42501','ONBOARDING_ACTOR_FORBIDDEN','restricted actor cannot use preference-stage RPC');
select throws_ok($$select public.onboarding_save_name('다른팬')$$,'42501','ONBOARDING_ACTOR_FORBIDDEN','restricted actor cannot use name RPC');
select throws_ok($$select public.onboarding_complete_profile(true,true,'d9000000-0000-4000-8000-000000000004',true,'d9000000-0000-4000-8000-000000000002')$$,
 '42501','ONBOARDING_ACTOR_FORBIDDEN','restricted actor cannot complete profile');
select lives_ok($$select public.analytics_set_consent(false,null)$$,'analytics withdrawal remains available when restricted');
reset role;
update public.profiles set restricted_until=now()-interval '1 second' where id='d1000000-0000-4000-8000-000000000001';
set local role authenticated;
select lives_ok($$select public.onboarding_save_name('다른팬')$$,'expired restriction permits own profile mutation');
reset role;
update public.profiles set onboarding_completed_at=clock_timestamp() where id='d1000000-0000-4000-8000-000000000001';
set local role authenticated;
select throws_ok($$select public.onboarding_save_font('normal')$$,'55000','ONBOARDING_ALREADY_COMPLETED','full onboarding cannot be reopened through stage mutation');
select throws_ok($$select public.onboarding_save_name('가상팬')$$,'55000','ONBOARDING_ALREADY_COMPLETED','full completion cannot be mutated by direct stage RPC');
reset role;
delete from auth.users where id='d1000000-0000-4000-8000-000000000001';
select is((select count(*) from private.profile_policy_acceptances),0::bigint,'account deletion cascades private consent evidence');
select is((select count(*) from private.onboarding_documents),4::bigint,'account deletion never deletes immutable public policies');
select * from finish();
rollback;
