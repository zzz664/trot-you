begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();

-- Fictional rollback-only accounts and policy; never production/legal defaults.
select is((select count(*) from private.onboarding_install_guidance),0::bigint,'migration acknowledges no guidance for any person');
select ok((select relrowsecurity from pg_class where oid='private.onboarding_install_guidance'::regclass),'guidance evidence has RLS');
select ok((select bool_and(not has_table_privilege(r,'private.onboarding_install_guidance','SELECT,INSERT,UPDATE,DELETE,TRUNCATE'))
 from unnest(array['anon','authenticated','service_role']) r),'no application role can enumerate or forge guidance');
select ok((select bool_and(p.prosecdef and 'search_path=""'=any(p.proconfig)) from pg_proc p
 where p.oid in ('public.onboarding_get_install_state()'::regprocedure,'public.onboarding_acknowledge_install(text)'::regprocedure,
 'public.onboarding_complete()'::regprocedure,'private.onboarding_require_active_interest()'::regprocedure)),
 'all onboarding RPC privilege boundaries pin empty search_path');
select ok((select not prosecdef and 'search_path=""'=any(proconfig) from pg_proc where oid='private.onboarding_protect_completion()'::regprocedure),
 'raw-write trigger checks the effective writer without security-definer elevation');
select ok((select bool_and(not has_function_privilege(r,f,'EXECUTE')) from unnest(array['anon','authenticated','service_role']) r,
 unnest(array['private.onboarding_protect_completion()','private.onboarding_require_active_interest()']) f),'application roles cannot execute internal helpers');
select ok((select bool_and(has_function_privilege('authenticated',f,'EXECUTE')) from unnest(array[
 'public.onboarding_get_install_state()','public.onboarding_acknowledge_install(text)','public.onboarding_complete()']) f),'only authenticated actors have self-service RPCs');
select ok((select bool_and(not has_function_privilege(r,f,'EXECUTE')) from unnest(array['anon','service_role']) r,
 unnest(array['public.onboarding_get_install_state()','public.onboarding_acknowledge_install(text)','public.onboarding_complete()']) f),
 'anonymous and service roles cannot impersonate the self-service RPCs');
select ok((select bool_and(not (coalesce(p.proargnames,array[]::text[]) && array[
 'p_user_id','p_actor_id','p_completed_at','p_acknowledged_at','p_permission','p_installed'])) from pg_proc p where p.oid in (
 'public.onboarding_get_install_state()'::regprocedure,'public.onboarding_acknowledge_install(text)'::regprocedure,
 'public.onboarding_complete()'::regprocedure)),'RPCs accept no actor, timestamp, permission or verified-installed claim');

insert into auth.users(id,email,raw_user_meta_data) values
 ('f1000000-0000-4000-8000-000000000001','install-one@example.invalid','{"onboarding_completed_at":"2026-01-01","installation_self_reported_at":"2026-01-01","choice":"installed_self_reported"}'),
 ('f1000000-0000-4000-8000-000000000002','install-two@example.invalid','{}'),
 ('f1000000-0000-4000-8000-000000000003','install-incomplete@example.invalid','{}'),
 ('f1000000-0000-4000-8000-000000000004','install-artist@example.invalid','{}'),
 ('f1000000-0000-4000-8000-000000000005','install-admin@example.invalid','{}');
update public.profiles set role='artist' where id='f1000000-0000-4000-8000-000000000004';
update public.profiles set role='admin' where id='f1000000-0000-4000-8000-000000000005';
select is((select onboarding_completed_at from public.profiles where id='f1000000-0000-4000-8000-000000000001'),null::timestamptz,'metadata cannot claim full completion');
select is((select count(*) from private.onboarding_install_guidance),0::bigint,'metadata cannot claim installation or reviewed guidance');
insert into public.artists(id,slug,name,grade,status) values
 ('f2000000-0000-4000-8000-000000000001','install-active','허구 설치 가수','B','active'),
 ('f2000000-0000-4000-8000-000000000002','install-hidden','숨긴 설치 가수','C','draft');
insert into private.onboarding_documents(version,kind,title,body,approved_at,published_at) values
 ('f9000000-0000-4000-8000-000000000001','terms','Fictional terms','Disposable rollback-only test terms.',now(),now()),
 ('f9000000-0000-4000-8000-000000000002','privacy','Fictional privacy','Disposable rollback-only test privacy.',now(),now()),
 ('f9000000-0000-4000-8000-000000000003','terms','Fictional new terms','Disposable rollback-only changed terms.',now(),now());
insert into private.profile_onboarding_policy values(true,'f8000000-0000-4000-8000-000000000001',now(),2,10,
 array['금지단어'],'f9000000-0000-4000-8000-000000000001','f9000000-0000-4000-8000-000000000002',null);
create temporary table install_stamps(key text primary key,stamp timestamptz);
grant all on install_stamps to authenticated;

set local role authenticated;
select set_config('request.jwt.claim.sub','',true);
select throws_ok('select public.onboarding_complete()','42501','DISCOVERY_FORBIDDEN','a missing subject cannot finish');
select throws_ok($$select public.onboarding_acknowledge_install('acknowledged')$$,'42501','DISCOVERY_FORBIDDEN','a missing subject cannot acknowledge');
select throws_ok('select * from public.onboarding_get_install_state()','42501','DISCOVERY_FORBIDDEN','a missing subject cannot read evidence');
select set_config('request.jwt.claim.sub','f1000000-0000-4000-8000-000000000003',true);
select throws_ok('select public.onboarding_complete()','55000','DISCOVERY_PROFILE_REQUIRED','completion cannot skip profile');
select throws_ok($$select public.onboarding_acknowledge_install('skipped')$$,'55000','DISCOVERY_PROFILE_REQUIRED','skip cannot bypass profile');
select set_config('request.jwt.claim.sub','f1000000-0000-4000-8000-000000000004',true);
select throws_ok('select public.onboarding_complete()','42501','DISCOVERY_FORBIDDEN','artist role does not bypass fan onboarding');
select set_config('request.jwt.claim.sub','f1000000-0000-4000-8000-000000000005',true);
select throws_ok('select public.onboarding_complete()','42501','DISCOVERY_FORBIDDEN','admin role does not bypass fan onboarding');

select set_config('request.jwt.claim.sub','f1000000-0000-4000-8000-000000000001',true);
select public.onboarding_save_font('large');
select public.onboarding_save_name('허구설치팬');
select public.onboarding_complete_profile(true,true,'f9000000-0000-4000-8000-000000000001',true,'f9000000-0000-4000-8000-000000000002');
select is((select count(*) from public.onboarding_get_install_state()),1::bigint,'no evidence is represented by one safe state row');
select ok((select choice is null and acknowledged_at is null and installation_self_reported_at is null and onboarding_completed_at is null
 from public.onboarding_get_install_state()),'fresh profile has no invented installation or completion');
select throws_ok('select public.onboarding_complete()','55000','ONBOARDING_ARTIST_REQUIRED','completion requires an explicit active interest');
select throws_ok($$select public.onboarding_acknowledge_install('acknowledged')$$,'55000','ONBOARDING_ARTIST_REQUIRED','guidance stage cannot skip interest');
select public.discovery_select_artist('install-active');
select throws_ok('select public.onboarding_complete()','55000','ONBOARDING_INSTALL_REQUIRED','active interest is not guidance review');
select throws_ok($$select public.onboarding_acknowledge_install(null)$$,'22023','ONBOARDING_INSTALL_INVALID','null cannot acknowledge guidance');
select throws_ok($$select public.onboarding_acknowledge_install('')$$,'22023','ONBOARDING_INSTALL_INVALID','empty cannot acknowledge guidance');
select throws_ok($$select public.onboarding_acknowledge_install('installed')$$,'22023','ONBOARDING_INSTALL_INVALID','verified installation is not an accepted claim');
select throws_ok($$select public.onboarding_acknowledge_install('granted')$$,'22023','ONBOARDING_INSTALL_INVALID','notification permission is not an accepted completion record');
select throws_ok($$select public.onboarding_acknowledge_install(repeat('a',3000))$$,'22023','ONBOARDING_INSTALL_INVALID','unbounded input cannot become evidence');
select lives_ok($$select public.onboarding_acknowledge_install('acknowledged')$$,'reviewing guidance is a real technical step even without installation');
select ok((select choice='acknowledged' and acknowledged_at is not null and installation_self_reported_at is null and onboarding_completed_at is null
 from public.onboarding_get_install_state()),'acknowledgment is recorded separately without implying installed or complete');
insert into install_stamps values('guidance',(select acknowledged_at from public.onboarding_get_install_state()));
select lives_ok($$select public.onboarding_acknowledge_install('acknowledged')$$,'lost acknowledgment response can be retried');
select is((select acknowledged_at from public.onboarding_get_install_state()),(select stamp from install_stamps where key='guidance'),'acknowledgment retry preserves first timestamp');
select lives_ok($$select public.onboarding_acknowledge_install('installed_self_reported')$$,'explicit self-report is distinct evidence');
select ok((select choice='installed_self_reported' and installation_self_reported_at>=acknowledged_at from public.onboarding_get_install_state()),'self-report timestamp never claims browser verification');
insert into install_stamps values('report',(select installation_self_reported_at from public.onboarding_get_install_state()));
select public.onboarding_acknowledge_install('installed_self_reported');
select is((select installation_self_reported_at from public.onboarding_get_install_state()),(select stamp from install_stamps where key='report'),'self-report retry preserves original timestamp');
select lives_ok($$select public.onboarding_acknowledge_install('skipped')$$,'supported and unsupported browsers may honestly skip installation');
select ok((select choice='skipped' and acknowledged_at is not null and installation_self_reported_at is null from public.onboarding_get_install_state()),'skip preserves guidance review but clears a withdrawn self-report');
select is((select acknowledged_at from public.onboarding_get_install_state()),(select stamp from install_stamps where key='guidance'),'changing an explicit choice preserves original guidance timestamp');
select throws_ok($$insert into private.onboarding_install_guidance(user_id,choice,acknowledged_at) values(auth.uid(),'acknowledged',now())$$,'42501',null,'actor cannot bypass the RPC with direct evidence writes');
select throws_ok($$update public.profiles set onboarding_completed_at=now() where id=auth.uid()$$,'42501',null,'actor cannot bypass completion checks with profile writes');
reset role;

-- Stage clocks are not policy evidence; all conditions are read again at finish.
update private.profile_onboarding_policy set terms_version='f9000000-0000-4000-8000-000000000003';
set local role authenticated;
select throws_ok('select public.onboarding_complete()','55000','DISCOVERY_PROFILE_REQUIRED','stale consent is rejected even after guidance was reviewed');
reset role;
update private.profile_onboarding_policy set terms_version='f9000000-0000-4000-8000-000000000001',privacy_version=null;
set local role authenticated;
select throws_ok('select public.onboarding_complete()','55000','DISCOVERY_SETUP_NOT_READY','missing legal policy fails closed');
reset role;
update private.profile_onboarding_policy set privacy_version='f9000000-0000-4000-8000-000000000002',profanity_words=array['허구설치팬'];
set local role authenticated;
select throws_ok('select public.onboarding_complete()','55000','DISCOVERY_PROFILE_REQUIRED','current calling-name policy is revalidated at finish');
reset role;
update private.profile_onboarding_policy set profanity_words=array['금지단어'],name_approved_at=clock_timestamp()+interval '1 day';
set local role authenticated;
select throws_ok('select public.onboarding_complete()','55000','DISCOVERY_SETUP_NOT_READY','future name policy approval is not ready');
reset role;
update private.profile_onboarding_policy set name_approved_at=now();
update public.artists set status='paused' where slug='install-active';
set local role authenticated;
select throws_ok('select public.onboarding_complete()','55000','ONBOARDING_ARTIST_REQUIRED','paused selected artist cannot finish');
reset role;
update public.artists set status='active' where slug='install-active';
update public.profiles set is_restricted=true where id='f1000000-0000-4000-8000-000000000001';
set local role authenticated;
select throws_ok('select public.onboarding_complete()','42501','DISCOVERY_FORBIDDEN','restricted actor cannot finish');
select throws_ok('select * from public.onboarding_get_install_state()','42501','DISCOVERY_FORBIDDEN','restricted actor cannot inspect stage evidence');
reset role;
update public.profiles set restricted_until=now()-interval '1 second' where id='f1000000-0000-4000-8000-000000000001';
select is((select onboarding_completed_at from public.profiles where id='f1000000-0000-4000-8000-000000000001'),null::timestamptz,'all failed finish attempts left completion null');
select is((select count(*) from private.onboarding_install_guidance),1::bigint,'failed finish preserves review for resumption');
set local role authenticated;
select lives_ok('select public.onboarding_complete()','expired restriction permits finish with honest skip');
insert into install_stamps values('complete',(select onboarding_completed_at from public.onboarding_get_install_state()));
select ok((select stamp is not null from install_stamps where key='complete'),'full completion is a real server timestamp');
select is(public.onboarding_complete(),(select stamp from install_stamps where key='complete'),'lost finish response returns the original completion timestamp');
select lives_ok($$select public.onboarding_acknowledge_install('skipped')$$,'lost acknowledgment response remains safely repeatable after finish');
select throws_ok($$select public.onboarding_acknowledge_install('installed_self_reported')$$,'55000','ONBOARDING_ALREADY_COMPLETED','completed onboarding cannot be edited into an installation claim');
select throws_ok($$select public.discovery_select_artist('install-active')$$,'42501','DISCOVERY_FORBIDDEN','completed onboarding cannot reuse interest-write endpoint');
select throws_ok($$select public.onboarding_save_name('바꾼이름')$$,'55000','ONBOARDING_ALREADY_COMPLETED','completed onboarding cannot reuse profile-write endpoint');
select is(public.has_active_access('f2000000-0000-4000-8000-000000000001'),false,'full onboarding grants no paid artist access');
select set_config('request.jwt.claim.sub','f1000000-0000-4000-8000-000000000002',true);
select public.onboarding_save_font('normal');
select public.onboarding_save_name('허구둘째팬');
select public.onboarding_complete_profile(true,true,'f9000000-0000-4000-8000-000000000001',true,'f9000000-0000-4000-8000-000000000002');
select ok((select choice is null and acknowledged_at is null and onboarding_completed_at is null from public.onboarding_get_install_state()),'second actor cannot borrow first actor evidence');
select public.discovery_select_artist('install-active');
select throws_ok('select public.onboarding_complete()','55000','ONBOARDING_INSTALL_REQUIRED','second actor cannot borrow first actor guidance');
select public.onboarding_acknowledge_install('installed_self_reported');
select lives_ok('select public.onboarding_complete()','explicit self-report can complete without notification permission or Web Push');
reset role;
select is((select count(*) from private.onboarding_install_guidance),2::bigint,'one independent guidance record per actor');
select is((select count(*) from public.profiles where onboarding_completed_at is not null),2::bigint,'only two independently ready actors complete');
select is((select count(*) from public.subscriptions),0::bigint,'completion creates no paid subscription');
select is((select count(*) from public.payment_events),0::bigint,'completion creates no payment event');
select is((select count(*) from private.analytics_events),0::bigint,'completion does not invent optional analytics consent or event collection');

-- Direct service writes retain ordinary existing capabilities but cannot forge
-- INSERT/UPDATE completion, clear it, or copy private evidence from another fan.
set local role service_role;
select throws_ok($$update public.profiles set onboarding_completed_at=now() where id='f1000000-0000-4000-8000-000000000003'$$,
 '42501','ONBOARDING_COMPLETION_RPC_REQUIRED','service role cannot bypass prerequisites with raw completion');
select throws_ok($$update public.profiles set onboarding_completed_at=null where id='f1000000-0000-4000-8000-000000000001'$$,
 '42501','ONBOARDING_COMPLETION_RPC_REQUIRED','service role cannot clear completion to reopen protected onboarding');
select throws_ok($$insert into public.profiles(id,call_name,onboarding_completed_at) values('ffffffff-ffff-4fff-8fff-ffffffffffff','가짜가입',now())$$,
 '42501','ONBOARDING_COMPLETION_RPC_REQUIRED','direct insert cannot forge completion even before FK validation');
select throws_ok($$insert into private.onboarding_install_guidance(user_id,choice,acknowledged_at) values('f1000000-0000-4000-8000-000000000003','skipped',now())$$,
 '42501',null,'service role cannot forge private guidance');
select throws_ok('select public.onboarding_complete()','42501',null,'service role cannot invoke self-service completion with a forged actor claim');
select lives_ok($$update public.profiles set nickname='허구 별명' where id='f1000000-0000-4000-8000-000000000001'$$,'ordinary authorized server update does not reset existing completion');
reset role;

-- Retries recheck readiness, not merely the historic success marker.
delete from private.artist_interests where user_id='f1000000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub','f1000000-0000-4000-8000-000000000001',true);
select throws_ok('select public.onboarding_complete()','55000','ONBOARDING_ARTIST_REQUIRED','retry after interest withdrawal fails closed');
reset role;
select is((select onboarding_completed_at from public.profiles where id='f1000000-0000-4000-8000-000000000001'),
 (select stamp from install_stamps where key='complete'),'withdrawal retry cannot rewrite historical completion');
update private.profile_onboarding_policy set terms_version='f9000000-0000-4000-8000-000000000003';
set local role authenticated;
select set_config('request.jwt.claim.sub','f1000000-0000-4000-8000-000000000002',true);
select throws_ok('select public.onboarding_complete()','55000','DISCOVERY_PROFILE_REQUIRED','retry after legal policy rotation fails closed');
reset role;
select throws_ok($$insert into private.onboarding_install_guidance(user_id,choice,acknowledged_at) values('f1000000-0000-4000-8000-000000000003','installed_self_reported',now())$$,
 '23514',null,'self-report requires its own explicit timestamp');
select throws_ok($$insert into private.onboarding_install_guidance(user_id,choice,acknowledged_at,installation_self_reported_at) values('f1000000-0000-4000-8000-000000000003','skipped',now(),now())$$,
 '23514',null,'skip cannot structurally pretend installed');
select throws_ok($$insert into private.onboarding_install_guidance(user_id,choice,acknowledged_at) values('f1000000-0000-4000-8000-000000000003','acknowledged','infinity')$$,
 '23514',null,'nonfinite review evidence is rejected');
delete from auth.users where id='f1000000-0000-4000-8000-000000000002';
select is((select count(*) from private.onboarding_install_guidance where user_id='f1000000-0000-4000-8000-000000000002'),0::bigint,'account deletion cascades private guidance');
select * from finish();
rollback;
