begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();

-- Entirely fictional, rollback-only fixtures. No provider request or real terms.
select is((select count(*) from private.checkout_policies),0::bigint,'migration publishes no checkout terms or price');
select is((select count(*) from private.checkout_policy_current),0::bigint,'migration activates no commercial policy');
select is((select count(*) from private.checkout_sessions),0::bigint,'migration prepares no session');
select ok((select bool_and(relrowsecurity) from pg_class where oid in (
 'private.checkout_policies'::regclass,'private.checkout_policy_current'::regclass,'private.checkout_sessions'::regclass)),
 'every checkout table has RLS');
select ok((select bool_and(not has_table_privilege(r,t,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'))
 from unnest(array['anon','authenticated','service_role']) r,
 unnest(array['private.checkout_policies','private.checkout_policy_current','private.checkout_sessions']) t),
 'all application roles are denied raw policy/session access');
select ok((select bool_and('search_path=""'=any(proconfig)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname in ('private','public') and p.proname like 'checkout\_%' escape '\'),
 'all checkout helpers and RPCs pin empty search_path');
select ok((select bool_and(not has_function_privilege(r,f,'EXECUTE')) from unnest(array['anon','authenticated','service_role']) r,
 unnest(array['private.checkout_policy_immutable()','private.checkout_require_actor(uuid)',
 'private.checkout_current_policy()','private.checkout_session_projection(uuid,text)']) f),'private helpers are not callable');
select ok(has_function_privilege('authenticated','public.checkout_get_offer(text)','EXECUTE'),'authenticated actor can read its offer');
select ok(not has_function_privilege('anon','public.checkout_get_offer(text)','EXECUTE'),'anonymous caller cannot read a personalized offer');
select ok(not has_function_privilege('service_role','public.checkout_get_offer(text)','EXECUTE'),'trusted service cannot impersonate actor offer reads');
select ok((select bool_and(not has_function_privilege(r,f,'EXECUTE')) from unnest(array['anon','authenticated']) r,
 unnest(array['public.checkout_prepare_session(uuid,text,public.payment_provider,text,uuid,text,uuid,boolean)',
 'public.checkout_read_session(uuid,uuid)','public.checkout_cancel_session(uuid,uuid,text)']) f),'session RPCs are not browser capabilities');
select ok((select bool_and(has_function_privilege('service_role',f,'EXECUTE')) from unnest(array[
 'public.checkout_prepare_session(uuid,text,public.payment_provider,text,uuid,text,uuid,boolean)',
 'public.checkout_read_session(uuid,uuid)','public.checkout_cancel_session(uuid,uuid,text)']) f),'only service role has explicit session RPC grants');
select ok((select not (coalesce(proargnames,array[]::text[]) && array['p_user_id','p_actor_id','p_price','p_amount'])
 from pg_proc where oid='public.checkout_get_offer(text)'::regprocedure),'offer accepts neither actor nor price from browser');
select ok((select not exists(select 1 from information_schema.columns where table_schema='private' and table_name='checkout_sessions'
 and column_name in ('billing_key','sid','auth_key','pg_token','provider_payload','nonce','phone','email','call_name'))),
 'session storage has no raw provider credential, nonce, payload or personal data field');

insert into auth.users(id,email,raw_user_meta_data) values
 ('a1000000-0000-4000-8000-000000000001','checkout-one@example.invalid','{}'),
 ('a1000000-0000-4000-8000-000000000002','checkout-two@example.invalid','{}'),
 ('a1000000-0000-4000-8000-000000000003','checkout-incomplete@example.invalid','{}'),
 ('a1000000-0000-4000-8000-000000000004','checkout-artist@example.invalid','{}'),
 ('a1000000-0000-4000-8000-000000000005','checkout-admin@example.invalid','{}');
update public.profiles set role='artist' where id='a1000000-0000-4000-8000-000000000004';
update public.profiles set role='admin' where id='a1000000-0000-4000-8000-000000000005';
insert into public.artists(id,slug,name,grade,status) values
 ('a2000000-0000-4000-8000-000000000001','checkout-one','허구 구독 가수 하나','B','active'),
 ('a2000000-0000-4000-8000-000000000002','checkout-two','허구 구독 가수 둘','C','active'),
 ('a2000000-0000-4000-8000-000000000003','checkout-hidden','숨긴 허구 가수','C','draft');
insert into private.onboarding_documents(version,kind,title,body,approved_at,published_at) values
 ('a9000000-0000-4000-8000-000000000001','terms','Fictional profile terms','Rollback-only profile terms.',now(),now()),
 ('a9000000-0000-4000-8000-000000000002','privacy','Fictional profile privacy','Rollback-only profile privacy.',now(),now()),
 ('a9000000-0000-4000-8000-000000000003','terms','Fictional changed profile terms','Rollback-only changed profile terms.',now(),now());
insert into private.profile_onboarding_policy values(true,'a8000000-0000-4000-8000-000000000001',now(),2,10,
 array['금지단어'],'a9000000-0000-4000-8000-000000000001','a9000000-0000-4000-8000-000000000002',null);
update public.profiles set font_selected_at=now(),call_name='허구구독팬',age_self_attested_at=now(),
 profile_completed_at=now(),onboarding_completed_at=now()
 where id in ('a1000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000002');
insert into private.profile_policy_acceptances(user_id,kind,version,accepted_at)
 select u,kind,version,now() from unnest(array['a1000000-0000-4000-8000-000000000001'::uuid,
 'a1000000-0000-4000-8000-000000000002'::uuid]) u, private.onboarding_documents d where d.kind in ('terms','privacy');

set local role authenticated;
select set_config('request.jwt.claim.sub','',true);
select throws_ok($$select * from public.checkout_get_offer('checkout-one')$$,'42501','DISCOVERY_FORBIDDEN','offer requires actual subject');
select set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000003',true);
select throws_ok($$select * from public.checkout_get_offer('checkout-one')$$,'55000','DISCOVERY_PROFILE_REQUIRED','offer requires profile stage');
select set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000004',true);
select throws_ok($$select * from public.checkout_get_offer('checkout-one')$$,'42501','DISCOVERY_FORBIDDEN','artist cannot use fan checkout');
select set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000005',true);
select throws_ok($$select * from public.checkout_get_offer('checkout-one')$$,'42501','DISCOVERY_FORBIDDEN','admin cannot use fan checkout');
select set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000001',true);
select throws_ok($$select * from public.checkout_get_offer('checkout-one')$$,'55000','CHECKOUT_SETUP_NOT_READY','missing approved price and terms fail closed');
reset role;
insert into private.checkout_policies values
 ('a7000000-0000-4000-8000-000000000001','허구 테스트 구독 약관','승인된 서비스 약관이 아닌 롤백 전용 테스트 문서입니다.',7200,1200,now(),now()),
 ('a7000000-0000-4000-8000-000000000002','변경된 허구 구독 약관','정책 회전만 검증하는 롤백 전용 테스트 문서입니다.',7300,1300,now(),now()),
 ('a7000000-0000-4000-8000-000000000003','미승인 허구 약관','실제 운영에 쓸 수 없는 초안입니다.',7400,1400,null,null),
 ('a7000000-0000-4000-8000-000000000004','미래 허구 약관','미래 게시 상태를 검증하는 문서입니다.',7500,1500,now(),now()+interval '1 day');
insert into private.checkout_policy_current values(true,'a7000000-0000-4000-8000-000000000003');
set local role authenticated;
select throws_ok($$select * from public.checkout_get_offer('checkout-one')$$,'55000','CHECKOUT_SETUP_NOT_READY','unapproved draft fails closed');
reset role;
update private.checkout_policy_current set policy_version='a7000000-0000-4000-8000-000000000004';
set local role authenticated;
select throws_ok($$select * from public.checkout_get_offer('checkout-one')$$,'55000','CHECKOUT_SETUP_NOT_READY','future publication fails closed');
reset role;
update private.checkout_policy_current set policy_version='a7000000-0000-4000-8000-000000000001';
select throws_ok($$update private.checkout_policies set regular_price_krw=1 where version='a7000000-0000-4000-8000-000000000001'$$,
 '23514','CHECKOUT_POLICY_IMMUTABLE','approved price cannot be overwritten');
select throws_ok($$delete from private.checkout_policies where version='a7000000-0000-4000-8000-000000000002'$$,
 '23514','CHECKOUT_POLICY_IMMUTABLE','approved policy cannot be deleted');
select throws_ok('truncate private.checkout_policies cascade','23514','CHECKOUT_POLICY_IMMUTABLE','truncate cannot erase immutable snapshots');
select throws_ok($$insert into private.checkout_policies values(gen_random_uuid(),'제목',' ',7000,0,now(),now())$$,'23514',null,'blank terms cannot be published');
select throws_ok($$insert into private.checkout_policies values(gen_random_uuid(),'제목','내용',0,0,now(),now())$$,'23514',null,'zero regular price cannot become an approved offer');
set local role authenticated;
select throws_ok($$select * from public.checkout_get_offer('../checkout-one')$$,'22023','CHECKOUT_INVALID_INPUT','slug path injection rejected');
select throws_ok($$select * from public.checkout_get_offer('checkout-hidden')$$,'P0002','CHECKOUT_NOT_FOUND','draft artist is not discoverable by checkout');
select ok((select artist_slug='checkout-one' and artist_name='허구 구독 가수 하나' and regular_price_krw=7200
 and intro_price_krw=1200 and intro_eligible and initial_price_krw=1200
 from public.checkout_get_offer('checkout-one')),'offer uses exact approved values, never documentary defaults');
select throws_ok($$select * from public.checkout_prepare_session(auth.uid(),'checkout-one','toss','test',gen_random_uuid(),repeat('a',64),
 'a7000000-0000-4000-8000-000000000001',true)$$,'42501',null,'browser cannot prepare using the privileged RPC directly');
reset role;

create temporary table checkout_saved as select * from private.checkout_session_projection(null);
grant all on checkout_saved to service_role;
set local role service_role;
select throws_ok($$select * from public.checkout_prepare_session('a1000000-0000-4000-8000-000000000001','checkout-one','toss','mock',gen_random_uuid(),repeat('a',64),
 'a7000000-0000-4000-8000-000000000001',true)$$,'22023','CHECKOUT_INVALID_INPUT','mock is not a production payment environment');
select throws_ok($$select * from public.checkout_prepare_session('a1000000-0000-4000-8000-000000000001','checkout-one','toss','test',gen_random_uuid(),'plain-nonce',
 'a7000000-0000-4000-8000-000000000001',true)$$,'22023','CHECKOUT_INVALID_INPUT','plain nonce cannot be stored');
select throws_ok($$select * from public.checkout_prepare_session('a1000000-0000-4000-8000-000000000001','checkout-one','toss','test',gen_random_uuid(),repeat('a',64),
 'a7000000-0000-4000-8000-000000000001',false)$$,'22023','CHECKOUT_CONSENT_REQUIRED','terms must be explicitly accepted');
select throws_ok($$select * from public.checkout_prepare_session('a1000000-0000-4000-8000-000000000001','checkout-one','toss','test',gen_random_uuid(),repeat('a',64),
 'a7000000-0000-4000-8000-000000000002',true)$$,'55000','CHECKOUT_POLICY_CHANGED','browser cannot submit another policy version');
select throws_ok($$select * from public.checkout_prepare_session('a1000000-0000-4000-8000-000000000003','checkout-one','toss','test',gen_random_uuid(),repeat('a',64),
 'a7000000-0000-4000-8000-000000000001',true)$$,'55000','DISCOVERY_PROFILE_REQUIRED','service preparation revalidates current profile');
insert into checkout_saved select * from public.checkout_prepare_session('a1000000-0000-4000-8000-000000000001','checkout-one','toss','test',
 'a6000000-0000-4000-8000-000000000001',repeat('a',64),'a7000000-0000-4000-8000-000000000001',true);
select is((select count(*) from checkout_saved),1::bigint,'one preparation produces one safe row');
select ok((select status='pending_intent' and initial_price_krw=1200 and regular_price_krw=7200 and intro_price_krw=1200
 and nonce_matches and intro_eligible and customer_ref<>session_id and order_id<>session_id
 and expires_at>clock_timestamp() and expires_at<=clock_timestamp()+interval '15 minutes'
 from checkout_saved),'prepared result is a bounded nonfinancial pending intent');
select is((select session_id from public.checkout_prepare_session('a1000000-0000-4000-8000-000000000001','checkout-one','toss','test',
 'a6000000-0000-4000-8000-000000000001',repeat('a',64),'a7000000-0000-4000-8000-000000000001',true)),
 (select session_id from checkout_saved),'same request key reuses original session');
select ok((select not nonce_matches and expires_at=(select expires_at from checkout_saved)
 from public.checkout_prepare_session('a1000000-0000-4000-8000-000000000001','checkout-one','toss','test',
 'a6000000-0000-4000-8000-000000000001',repeat('b',64),'a7000000-0000-4000-8000-000000000001',true)),
 'lost-response replay neither replaces nonce nor extends TTL');
select throws_ok($$select * from public.checkout_prepare_session('a1000000-0000-4000-8000-000000000001','checkout-one','kakaopay','test',
 'a6000000-0000-4000-8000-000000000001',repeat('a',64),'a7000000-0000-4000-8000-000000000001',true)$$,
 '55000','CHECKOUT_IDEMPOTENCY_CONFLICT','same key cannot switch provider');
select throws_ok($$select * from public.checkout_prepare_session('a1000000-0000-4000-8000-000000000001','checkout-two','toss','test',
 'a6000000-0000-4000-8000-000000000001',repeat('a',64),'a7000000-0000-4000-8000-000000000001',true)$$,
 '55000','CHECKOUT_IDEMPOTENCY_CONFLICT','same key cannot switch artist');
select throws_ok($$select * from public.checkout_prepare_session('a1000000-0000-4000-8000-000000000001','checkout-one','toss','live',
 'a6000000-0000-4000-8000-000000000001',repeat('a',64),'a7000000-0000-4000-8000-000000000001',true)$$,
 '55000','CHECKOUT_IDEMPOTENCY_CONFLICT','same key cannot switch merchant environment');
select throws_ok($$select * from public.checkout_prepare_session('a1000000-0000-4000-8000-000000000001','checkout-one','kakaopay','test',
 gen_random_uuid(),repeat('a',64),'a7000000-0000-4000-8000-000000000001',true)$$,
 '55000','CHECKOUT_SESSION_EXISTS','a new key/provider cannot fork pending intent for same actor and artist');
select ok((select status='pending_intent' and not nonce_matches and policy_body=(select policy_body from checkout_saved)
 from public.checkout_read_session('a1000000-0000-4000-8000-000000000001',(select session_id from checkout_saved))),
 'safe reads preserve snapshot but never expose the nonce');
select throws_ok($$select * from public.checkout_read_session('a1000000-0000-4000-8000-000000000002',(select session_id from checkout_saved))$$,
 'P0002','CHECKOUT_NOT_FOUND','another verified actor cannot read the session');
select throws_ok($$select public.checkout_cancel_session('a1000000-0000-4000-8000-000000000002',(select session_id from checkout_saved),repeat('a',64))$$,
 'P0002','CHECKOUT_NOT_FOUND','knowing nonce and session does not bypass owner binding');
select throws_ok($$select public.checkout_cancel_session('a1000000-0000-4000-8000-000000000001',(select session_id from checkout_saved),repeat('b',64))$$,
 '42501','CHECKOUT_NONCE_INVALID','same owner with wrong nonce cannot consume session');
reset role;
select is((select nonce_hash from private.checkout_sessions where id=(select session_id from checkout_saved)),repeat('a',64),'idempotency retry preserves original nonce hash');
select is((select count(*) from public.subscriptions),0::bigint,'preparation creates no subscription');
select is((select count(*) from private.payment_mandates),0::bigint,'preparation creates no mandate');
select is((select count(*) from private.billing_obligations),0::bigint,'preparation creates no payable obligation');
select is((select count(*) from private.payment_attempts),0::bigint,'preparation creates no charge attempt');
select is((select count(*) from public.payment_events),0::bigint,'preparation creates no payment event');

-- Current actor/policy readiness is checked again, even on idempotent retries.
update private.checkout_policy_current set policy_version='a7000000-0000-4000-8000-000000000002';
set local role service_role;
select throws_ok($$select * from public.checkout_prepare_session('a1000000-0000-4000-8000-000000000001','checkout-one','toss','test',
 'a6000000-0000-4000-8000-000000000001',repeat('a',64),'a7000000-0000-4000-8000-000000000001',true)$$,
 '55000','CHECKOUT_POLICY_CHANGED','rotated terms invalidate preparation retry');
select is((select regular_price_krw from public.checkout_read_session('a1000000-0000-4000-8000-000000000001',(select session_id from checkout_saved))),
 7200,'read-only history preserves original snapshot under rotation');
reset role;
update private.checkout_policy_current set policy_version='a7000000-0000-4000-8000-000000000001';
delete from private.profile_policy_acceptances where user_id='a1000000-0000-4000-8000-000000000001' and version='a9000000-0000-4000-8000-000000000001';
set local role authenticated;
select throws_ok($$select * from public.checkout_get_offer('checkout-one')$$,'55000','DISCOVERY_PROFILE_REQUIRED','offer rejects withdrawn current profile consent');
reset role;
set local role service_role;
select throws_ok($$select * from public.checkout_read_session('a1000000-0000-4000-8000-000000000001',(select session_id from checkout_saved))$$,
 '55000','DISCOVERY_PROFILE_REQUIRED','read session rejects withdrawn current profile consent');
select throws_ok($$select * from public.checkout_prepare_session('a1000000-0000-4000-8000-000000000001','checkout-one','toss','test',
 'a6000000-0000-4000-8000-000000000001',repeat('a',64),'a7000000-0000-4000-8000-000000000001',true)$$,
 '55000','DISCOVERY_PROFILE_REQUIRED','prepare rejects withdrawn profile consent');
reset role;
insert into private.profile_policy_acceptances values('a1000000-0000-4000-8000-000000000001','terms','a9000000-0000-4000-8000-000000000001',now());
update public.profiles set onboarding_completed_at=null where id='a1000000-0000-4000-8000-000000000001';
set local role authenticated;
select throws_ok($$select * from public.checkout_get_offer('checkout-one')$$,'55000','CHECKOUT_ONBOARDING_REQUIRED','offer cannot skip full onboarding');
reset role;
set local role service_role;
select throws_ok($$select * from public.checkout_prepare_session('a1000000-0000-4000-8000-000000000001','checkout-one','toss','test',
 'a6000000-0000-4000-8000-000000000001',repeat('a',64),'a7000000-0000-4000-8000-000000000001',true)$$,
 '55000','CHECKOUT_ONBOARDING_REQUIRED','prepare cannot skip full onboarding');
reset role;
update public.profiles set onboarding_completed_at=now(),is_restricted=true where id='a1000000-0000-4000-8000-000000000001';
set local role service_role;
select throws_ok($$select * from public.checkout_prepare_session('a1000000-0000-4000-8000-000000000001','checkout-one','toss','test',
 'a6000000-0000-4000-8000-000000000001',repeat('a',64),'a7000000-0000-4000-8000-000000000001',true)$$,
 '42501','DISCOVERY_FORBIDDEN','new restriction blocks prepared retry');
select lives_ok($$select public.checkout_cancel_session('a1000000-0000-4000-8000-000000000001',(select session_id from checkout_saved),repeat('a',64))$$,
 'restricted actor may abandon own intent without provider work or new access');
select throws_ok($$select public.checkout_cancel_session('a1000000-0000-4000-8000-000000000001',(select session_id from checkout_saved),repeat('a',64))$$,
 '55000','CHECKOUT_SESSION_REPLAY','consumed cancellation nonce cannot replay transition');
reset role;
update public.profiles set is_restricted=false where id='a1000000-0000-4000-8000-000000000001';
select is((select status from private.checkout_sessions where id=(select session_id from checkout_saved)),'canceled','abandonment changes only local intent');
set local role service_role;
select is((select status from public.checkout_prepare_session('a1000000-0000-4000-8000-000000000001','checkout-one','toss','test',
 'a6000000-0000-4000-8000-000000000001',repeat('a',64),'a7000000-0000-4000-8000-000000000001',true)),
 'canceled','same idempotency key cannot reopen canceled intent');
select lives_ok($$select * from public.checkout_prepare_session('a1000000-0000-4000-8000-000000000001','checkout-one','kakaopay','test',
 'a6000000-0000-4000-8000-000000000002',repeat('c',64),'a7000000-0000-4000-8000-000000000001',true)$$,
 'new deliberate request can prepare different provider after abandonment');
reset role;
update private.checkout_sessions set created_at=clock_timestamp()-interval '16 minutes',expires_at=clock_timestamp()-interval '1 minute'
 where idempotency_key='a6000000-0000-4000-8000-000000000002';
set local role service_role;
select is((select status from public.checkout_read_session('a1000000-0000-4000-8000-000000000001',
 (select session_id from public.checkout_prepare_session('a1000000-0000-4000-8000-000000000001','checkout-one','kakaopay','test',
 'a6000000-0000-4000-8000-000000000002',repeat('c',64),'a7000000-0000-4000-8000-000000000001',true)))),
 'expired','expired session is never represented as usable');
select throws_ok($$select public.checkout_cancel_session('a1000000-0000-4000-8000-000000000001',
 (select session_id from public.checkout_prepare_session('a1000000-0000-4000-8000-000000000001','checkout-one','kakaopay','test',
 'a6000000-0000-4000-8000-000000000002',repeat('c',64),'a7000000-0000-4000-8000-000000000001',true)),repeat('c',64))$$,
 '55000','CHECKOUT_SESSION_EXPIRED','expired nonce cannot be consumed');
reset role;
select is((select status from private.checkout_sessions where idempotency_key='a6000000-0000-4000-8000-000000000002'),
 'pending_intent','read-only expiry projection does not mutate storage');
set local role service_role;
select lives_ok($$select * from public.checkout_prepare_session('a1000000-0000-4000-8000-000000000001','checkout-one','toss','test',
 'a6000000-0000-4000-8000-000000000003',repeat('d',64),'a7000000-0000-4000-8000-000000000001',true)$$,
 'explicit new preparation expires abandoned old intent before creating one');
reset role;
select is((select count(*) from private.checkout_sessions where user_id='a1000000-0000-4000-8000-000000000001' and artist_id='a2000000-0000-4000-8000-000000000001' and status='pending_intent'),
 1::bigint,'exactly one pending intent survives repeated/back flows');

-- Lifetime introductory use is read from existing immutable financial history.
insert into public.subscriptions(id,user_id,artist_id,provider,status,intro_redeemed_at)
 values('a5000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000002','a2000000-0000-4000-8000-000000000002','toss','expired',now());
set local role authenticated;
select set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000002',true);
select ok((select not intro_eligible and initial_price_krw=regular_price_krw from public.checkout_get_offer('checkout-two')),
 'repeat subscriber cannot regain introductory price');
reset role;
set local role service_role;
select ok((select not intro_eligible and initial_price_krw=7200 and provider='kakaopay'
 from public.checkout_prepare_session('a1000000-0000-4000-8000-000000000002','checkout-two','kakaopay','test',
 'a6000000-0000-4000-8000-000000000001',repeat('a',64),'a7000000-0000-4000-8000-000000000001',true)),
 'provider switch does not restore lifetime intro eligibility and another actor has independent idempotency namespace');
reset role;
update public.artists set status='paused' where slug='checkout-two';
set local role service_role;
select throws_ok($$select * from public.checkout_prepare_session('a1000000-0000-4000-8000-000000000002','checkout-two','kakaopay','test',
 'a6000000-0000-4000-8000-000000000001',repeat('a',64),'a7000000-0000-4000-8000-000000000001',true)$$,
 'P0002','CHECKOUT_NOT_FOUND','artist deactivation blocks even idempotent preparation');
reset role;
select is((select count(*) from public.subscriptions),1::bigint,'only explicit test fixture is a subscription');
select is((select count(*) from public.payment_events),0::bigint,'all lifecycle paths leave verified money untouched');
select * from finish();
rollback;
