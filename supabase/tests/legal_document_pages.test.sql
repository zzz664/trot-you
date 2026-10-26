begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();

-- Fictional transaction-local projection fixtures only, not approved legal copy.
select is((select count(*) from private.onboarding_documents),0::bigint,
  'legal navigation migration seeds no document');
select is((select count(*) from private.profile_onboarding_policy),0::bigint,
  'legal navigation migration activates no policy');
select is((select array_agg(column_name::text order by ordinal_position)
  from information_schema.columns where table_schema='public' and table_name='current_onboarding_policy_documents'),
  array['version','kind','title','body','approved_at','published_at']::text[],
  'current projection exposes only the existing public document fields');
select ok((select 'security_barrier=true'=any(reloptions) from pg_class
  where oid='public.current_onboarding_policy_documents'::regclass),
  'current projection is a security barrier');
select ok((select bool_and(has_table_privilege(r,'public.current_onboarding_policy_documents','SELECT')
  and not has_table_privilege(r,'public.current_onboarding_policy_documents','INSERT,UPDATE,DELETE,TRUNCATE'))
  from unnest(array['anon','authenticated','service_role']) r),
  'all application roles have only read access to current documents');
select ok((select bool_and(not has_table_privilege(r,t,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'))
  from unnest(array['anon','authenticated','service_role']) r cross join unnest(array[
  'private.onboarding_documents','private.profile_onboarding_policy','private.profile_policy_acceptances']) t),
  'private documents, policy configuration and acceptance evidence stay inaccessible');

set local role anon;
select is((select count(*) from public.current_onboarding_policy_documents),0::bigint,
  'missing configuration produces no placeholder or inferred current document');
reset role;

insert into private.onboarding_documents(version,kind,title,body,approved_at,published_at) values
 ('d4210000-0000-4000-8000-000000000001','terms','Fixture current terms','Transaction-local terms fixture only.',now()-interval '2 days',now()-interval '2 days'),
 ('d4210000-0000-4000-8000-000000000002','privacy','Fixture privacy','Transaction-local privacy fixture only.',now()-interval '2 days',now()-interval '2 days'),
 ('d4210000-0000-4000-8000-000000000003','terms','Fixture newer terms','Transaction-local newer terms fixture only.',now()-interval '1 day',now()-interval '1 day'),
 ('d4210000-0000-4000-8000-000000000004','terms','Fixture draft','Transaction-local unpublished draft fixture only.',null,null),
 ('d4210000-0000-4000-8000-000000000005','terms','Fixture approved unpublished','Transaction-local approved unpublished fixture only.',now(),null),
 ('d4210000-0000-4000-8000-000000000006','terms','Fixture future publication','Transaction-local future publication fixture only.',now(),now()+interval '1 day'),
 ('d4210000-0000-4000-8000-000000000007','terms','Fixture future approval','Transaction-local future approval fixture only.',now()+interval '1 day',now()+interval '1 day'),
 ('d4210000-0000-4000-8000-000000000008','analytics','Fixture analytics','Transaction-local analytics fixture only.',now(),now());

insert into private.profile_onboarding_policy(singleton,name_policy_version,name_approved_at,
  call_name_min,call_name_max,profanity_words,terms_version,privacy_version,analytics_version)
values(true,'d4210000-0000-4000-8000-000000000010',null,2,10,array['fixture'],
  'd4210000-0000-4000-8000-000000000001','d4210000-0000-4000-8000-000000000002',
  'd4210000-0000-4000-8000-000000000008');

set local role anon;
select is((select version from public.current_onboarding_policy_documents where kind='terms'),
  'd4210000-0000-4000-8000-000000000001'::uuid,
  'anonymous current terms follow the configured older pointer, not newest publication');
select is((select version from public.current_onboarding_policy_documents where kind='privacy'),
  'd4210000-0000-4000-8000-000000000002'::uuid,
  'anonymous current privacy follows its independent pointer without requiring an account');
select is((select count(*) from public.current_onboarding_policy_documents),2::bigint,
  'current legal navigation excludes analytics even when its configured document is public');
select is((select body from public.onboarding_policy_documents
  where kind='terms' and version='d4210000-0000-4000-8000-000000000003'),
  'Transaction-local newer terms fixture only.',
  'an approved published exact version remains readable independently of current selection');
select is((select count(*) from public.onboarding_policy_documents
  where version in ('d4210000-0000-4000-8000-000000000004','d4210000-0000-4000-8000-000000000005',
  'd4210000-0000-4000-8000-000000000006','d4210000-0000-4000-8000-000000000007')),0::bigint,
  'exact-version lookup cannot expose drafts, unpublished approval, future publication or future approval');
select is((select count(*) from public.onboarding_policy_documents
  where kind='privacy' and version='d4210000-0000-4000-8000-000000000001'),0::bigint,
  'wrong-kind exact lookup exposes no document');
select is((select count(*) from public.onboarding_policy_documents
  where version='d4210000-0000-4000-8000-000000000099'),0::bigint,
  'unknown exact version exposes no document');
select throws_ok($$select * from private.profile_onboarding_policy$$,'42501',null,
  'anonymous public navigation cannot inspect private configuration');
select throws_ok($$update private.profile_onboarding_policy set terms_version=null$$,'42501',null,
  'anonymous navigation cannot mutate current pointers');
reset role;

set local role authenticated;
select is((select count(*) from public.current_onboarding_policy_documents),2::bigint,
  'authenticated readers receive the same public documents without private account state');
reset role;
set local role service_role;
select is((select count(*) from public.current_onboarding_policy_documents),2::bigint,
  'service readers receive the same public document projection');
reset role;

update private.profile_onboarding_policy set terms_version='d4210000-0000-4000-8000-000000000003';
set local role anon;
select is((select version from public.current_onboarding_policy_documents where kind='terms'),
  'd4210000-0000-4000-8000-000000000003'::uuid,'current lookup follows a changed pointer');
select is((select body from public.onboarding_policy_documents
  where kind='terms' and version='d4210000-0000-4000-8000-000000000001'),
  'Transaction-local terms fixture only.','the previous exact version remains readable after rotation');
reset role;

update private.profile_onboarding_policy set terms_version='d4210000-0000-4000-8000-000000000002';
set local role anon;
select is((select count(*) from public.current_onboarding_policy_documents where kind='terms'),0::bigint,
  'a wrong-kind configured pointer cannot substitute privacy for terms');
reset role;

update private.profile_onboarding_policy set terms_version='d4210000-0000-4000-8000-000000000004';
set local role anon;
select is((select count(*) from public.current_onboarding_policy_documents where kind='terms'),0::bigint,
  'a configured draft is absent and cannot fall back to another published document');
reset role;
update private.profile_onboarding_policy set terms_version='d4210000-0000-4000-8000-000000000005';
set local role anon;
select is((select count(*) from public.current_onboarding_policy_documents where kind='terms'),0::bigint,
  'a configured approved but unpublished document is absent');
reset role;
update private.profile_onboarding_policy set terms_version='d4210000-0000-4000-8000-000000000006';
set local role anon;
select is((select count(*) from public.current_onboarding_policy_documents where kind='terms'),0::bigint,
  'a configured future publication is absent');
reset role;
update private.profile_onboarding_policy set terms_version='d4210000-0000-4000-8000-000000000007';
set local role anon;
select is((select count(*) from public.current_onboarding_policy_documents where kind='terms'),0::bigint,
  'a configured future approval is absent');
reset role;
update private.profile_onboarding_policy set terms_version=null,privacy_version=null;
set local role anon;
select is((select count(*) from public.current_onboarding_policy_documents),0::bigint,
  'null pointers do not infer current documents from the public version archive');
reset role;

select throws_ok($$update private.onboarding_documents set body='Changed fixture'
  where version='d4210000-0000-4000-8000-000000000001'$$,'23514','ONBOARDING_DOCUMENT_IMMUTABLE',
  'an exact published version cannot silently change after pointer rotation');
select throws_ok($$delete from private.onboarding_documents
  where version='d4210000-0000-4000-8000-000000000001'$$,'23514','ONBOARDING_DOCUMENT_IMMUTABLE',
  'an exact published version cannot silently disappear after pointer rotation');
select is((select count(*) from private.profile_policy_acceptances),0::bigint,
  'reading legal documents never accepts a policy for a person');

select * from finish();
rollback;
