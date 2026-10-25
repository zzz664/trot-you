-- Isolated fictional CI fixture only. This file always rolls back its accounts,
-- temporary helper, profile changes and audit rows. No provider is contacted.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
set local timezone='UTC';
select no_plan();

-- BEGIN MANUAL BOOTSTRAP SOURCE (byte-checked by unit test)
-- MANUAL OPERATOR TOOL ONLY. Loading this file grants no application access.
-- It defines a session-local, invoker-rights helper; it never invokes the helper.
-- Do not place in migrations, seeds, application startup or deployment hooks.
-- See docs/operations/admin-artist-management.md before any authorized use.
create or replace function pg_temp.bootstrap_initial_admin(
  p_user_id uuid,
  p_identity_kind text,
  p_verified_identity text,
  p_confirmation text,
  p_approval_reference text
) returns uuid
language plpgsql
set search_path = ''
as $$
declare
  candidate public.profiles%rowtype;
  identity_record auth.users%rowtype;
begin
  -- A client JWT/service-role session must not become a bootstrap operator.
  -- SECURITY INVOKER is intentional: this is not a permanently elevated RPC.
  if session_user <> 'postgres' or current_user <> 'postgres' then
    raise exception 'ADMIN_BOOTSTRAP_OPERATOR_REQUIRED' using errcode = '42501';
  end if;
  if p_user_id is null or p_identity_kind is null
    or p_identity_kind not in ('email', 'phone')
    or p_verified_identity is null or p_verified_identity = ''
    or length(p_verified_identity) > 320
    or p_verified_identity <> btrim(p_verified_identity)
    or p_verified_identity ~ '[[:cntrl:]]'
    or p_confirmation is distinct from ('CONFIRM INITIAL ADMIN ' || p_user_id::text)
    or p_approval_reference is null or length(p_approval_reference) not between 1 and 200
    or p_approval_reference <> btrim(p_approval_reference)
    or p_approval_reference ~ '[[:cntrl:]]' then
    raise exception 'ADMIN_BOOTSTRAP_INVALID_INPUT' using errcode = '23514';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('trot-you:initial-admin-bootstrap', 0));
  -- Excludes other profile writers, including a competing role change, for the
  -- existence check through the grant. Keep the manual transaction brief.
  lock table public.profiles in share row exclusive mode;
  lock table private.admin_bootstrap_audit in share row exclusive mode;
  if exists (select 1 from public.profiles where role = 'admin')
    or exists (select 1 from private.admin_bootstrap_audit) then
    raise exception 'ADMIN_BOOTSTRAP_ALREADY_USED' using errcode = '55000';
  end if;

  select * into candidate from public.profiles where id = p_user_id for update;
  select * into identity_record from auth.users where id = p_user_id for update;
  if candidate.id is null or identity_record.id is null
    or candidate.role <> 'fan'
    or candidate.onboarding_completed_at is null
    or (candidate.is_restricted and (candidate.restricted_until is null or candidate.restricted_until > clock_timestamp()))
    or identity_record.deleted_at is not null
    or identity_record.is_anonymous is true
    or (identity_record.banned_until is not null and identity_record.banned_until > clock_timestamp()) then
    raise exception 'ADMIN_BOOTSTRAP_ACCOUNT_UNAVAILABLE' using errcode = '42501';
  end if;
  if (p_identity_kind = 'email' and (
      identity_record.email is distinct from p_verified_identity
      or identity_record.email_confirmed_at is null
    )) or (p_identity_kind = 'phone' and (
      identity_record.phone is distinct from p_verified_identity
      or identity_record.phone_confirmed_at is null
    )) then
    raise exception 'ADMIN_BOOTSTRAP_IDENTITY_MISMATCH' using errcode = '42501';
  end if;

  -- No password, invite, token, Auth identity or artist membership is created.
  -- Retain only the authorized target and approval reference, not contact PII.
  insert into private.admin_bootstrap_audit(target_user_id, approved_reference)
    values (p_user_id, p_approval_reference);
  update public.profiles set role = 'admin' where id = p_user_id;
  return p_user_id;
end;
$$;
revoke all on function pg_temp.bootstrap_initial_admin(uuid, text, text, text, text)
  from public, anon, authenticated, service_role;
-- END MANUAL BOOTSTRAP SOURCE

select is((select count(*) from public.profiles where role='admin'),0::bigint,
  'loading the manual helper does not create an administrator');
select is((select count(*) from private.admin_bootstrap_audit),0::bigint,
  'loading the helper creates no bootstrap audit/grant');
select ok(not has_function_privilege('authenticated','pg_temp.bootstrap_initial_admin(uuid,text,text,text,text)','execute'),
  'authenticated clients cannot execute the session helper');
select ok(not has_function_privilege('service_role','pg_temp.bootstrap_initial_admin(uuid,text,text,text,text)','execute'),
  'service clients cannot execute the session helper');
select ok(not has_function_privilege('anon','pg_temp.bootstrap_initial_admin(uuid,text,text,text,text)','execute'),
  'anonymous clients cannot execute the session helper');

insert into auth.users(id,email,email_confirmed_at,phone,phone_confirmed_at,raw_user_meta_data) values
  ('da000000-0000-4000-8000-000000000001','bootstrap-one@example.invalid',clock_timestamp(),null,null,'{}'),
  ('da000000-0000-4000-8000-000000000002','bootstrap-unverified@example.invalid',null,null,null,'{}'),
  ('da000000-0000-4000-8000-000000000003','bootstrap-phone@example.invalid',clock_timestamp(),'15550000003',clock_timestamp(),'{}');
update public.profiles set call_name='가상운영자',onboarding_completed_at=clock_timestamp()
  where id in ('da000000-0000-4000-8000-000000000001','da000000-0000-4000-8000-000000000002','da000000-0000-4000-8000-000000000003');

select throws_like($$select pg_temp.bootstrap_initial_admin(null,'email','bootstrap-one@example.invalid','CONFIRM INITIAL ADMIN da000000-0000-4000-8000-000000000001','fictional-bootstrap-ci')$$,
  '%ADMIN_BOOTSTRAP_INVALID_INPUT%','null target fails before any grant');
select throws_like($$select pg_temp.bootstrap_initial_admin('da000000-0000-4000-8000-000000000001','email','bootstrap-one@example.invalid','yes','fictional-bootstrap-ci')$$,
  '%ADMIN_BOOTSTRAP_INVALID_INPUT%','generic confirmation does not authorize an exact target');
select throws_like($$select pg_temp.bootstrap_initial_admin('da000000-0000-4000-8000-000000000001','email','bootstrap-one@example.invalid','CONFIRM INITIAL ADMIN da000000-0000-4000-8000-000000000003','fictional-bootstrap-ci')$$,
  '%ADMIN_BOOTSTRAP_INVALID_INPUT%','confirmation bound to another target fails');
select throws_like($$select pg_temp.bootstrap_initial_admin('da000000-0000-4000-8000-000000000001','email','bootstrap-one@example.invalid','CONFIRM INITIAL ADMIN da000000-0000-4000-8000-000000000001','')$$,
  '%ADMIN_BOOTSTRAP_INVALID_INPUT%','approval reference must be explicit');
select throws_like($$select pg_temp.bootstrap_initial_admin('da000000-0000-4000-8000-000000000001','email','other@example.invalid','CONFIRM INITIAL ADMIN da000000-0000-4000-8000-000000000001','fictional-bootstrap-ci')$$,
  '%ADMIN_BOOTSTRAP_IDENTITY_MISMATCH%','exact Auth identity is checked, not profile metadata');
select throws_like($$select pg_temp.bootstrap_initial_admin('da000000-0000-4000-8000-000000000002','email','bootstrap-unverified@example.invalid','CONFIRM INITIAL ADMIN da000000-0000-4000-8000-000000000002','fictional-bootstrap-ci')$$,
  '%ADMIN_BOOTSTRAP_IDENTITY_MISMATCH%','an unverified exact email is insufficient');
select throws_like($$select pg_temp.bootstrap_initial_admin('da000000-0000-4000-8000-000000000003','phone','15550009999','CONFIRM INITIAL ADMIN da000000-0000-4000-8000-000000000003','fictional-bootstrap-ci')$$,
  '%ADMIN_BOOTSTRAP_IDENTITY_MISMATCH%','an unrelated phone cannot identify the candidate');
select throws_like($$select pg_temp.bootstrap_initial_admin('da000000-0000-4000-8000-000000000099','email','missing@example.invalid','CONFIRM INITIAL ADMIN da000000-0000-4000-8000-000000000099','fictional-bootstrap-ci')$$,
  '%ADMIN_BOOTSTRAP_ACCOUNT_UNAVAILABLE%','missing account is not automatically created');

update public.profiles set is_restricted=true where id='da000000-0000-4000-8000-000000000001';
select throws_like($$select pg_temp.bootstrap_initial_admin('da000000-0000-4000-8000-000000000001','email','bootstrap-one@example.invalid','CONFIRM INITIAL ADMIN da000000-0000-4000-8000-000000000001','fictional-bootstrap-ci')$$,
  '%ADMIN_BOOTSTRAP_ACCOUNT_UNAVAILABLE%','restricted candidate is not elevated');
update public.profiles set is_restricted=false where id='da000000-0000-4000-8000-000000000001';
update auth.users set banned_until=clock_timestamp()+interval '1 day' where id='da000000-0000-4000-8000-000000000001';
select throws_like($$select pg_temp.bootstrap_initial_admin('da000000-0000-4000-8000-000000000001','email','bootstrap-one@example.invalid','CONFIRM INITIAL ADMIN da000000-0000-4000-8000-000000000001','fictional-bootstrap-ci')$$,
  '%ADMIN_BOOTSTRAP_ACCOUNT_UNAVAILABLE%','banned Auth candidate is not elevated');
update auth.users set banned_until=null,deleted_at=clock_timestamp() where id='da000000-0000-4000-8000-000000000001';
select throws_like($$select pg_temp.bootstrap_initial_admin('da000000-0000-4000-8000-000000000001','email','bootstrap-one@example.invalid','CONFIRM INITIAL ADMIN da000000-0000-4000-8000-000000000001','fictional-bootstrap-ci')$$,
  '%ADMIN_BOOTSTRAP_ACCOUNT_UNAVAILABLE%','deleted Auth identity is not elevated');
update auth.users set deleted_at=null,is_anonymous=true where id='da000000-0000-4000-8000-000000000001';
select throws_like($$select pg_temp.bootstrap_initial_admin('da000000-0000-4000-8000-000000000001','email','bootstrap-one@example.invalid','CONFIRM INITIAL ADMIN da000000-0000-4000-8000-000000000001','fictional-bootstrap-ci')$$,
  '%ADMIN_BOOTSTRAP_ACCOUNT_UNAVAILABLE%','anonymous Auth identity is not elevated');
update auth.users set is_anonymous=false where id='da000000-0000-4000-8000-000000000001';
update public.profiles set role='artist' where id='da000000-0000-4000-8000-000000000001';
select throws_like($$select pg_temp.bootstrap_initial_admin('da000000-0000-4000-8000-000000000001','email','bootstrap-one@example.invalid','CONFIRM INITIAL ADMIN da000000-0000-4000-8000-000000000001','fictional-bootstrap-ci')$$,
  '%ADMIN_BOOTSTRAP_ACCOUNT_UNAVAILABLE%','bootstrap cannot replace existing artist authority');
update public.profiles set role='fan',onboarding_completed_at=null where id='da000000-0000-4000-8000-000000000001';
select throws_like($$select pg_temp.bootstrap_initial_admin('da000000-0000-4000-8000-000000000001','email','bootstrap-one@example.invalid','CONFIRM INITIAL ADMIN da000000-0000-4000-8000-000000000001','fictional-bootstrap-ci')$$,
  '%ADMIN_BOOTSTRAP_ACCOUNT_UNAVAILABLE%','ordinary onboarding is required before bootstrap');
update public.profiles set onboarding_completed_at=clock_timestamp() where id='da000000-0000-4000-8000-000000000001';
update public.profiles set role='admin',is_restricted=true where id='da000000-0000-4000-8000-000000000003';
select throws_like($$select pg_temp.bootstrap_initial_admin('da000000-0000-4000-8000-000000000001','email','bootstrap-one@example.invalid','CONFIRM INITIAL ADMIN da000000-0000-4000-8000-000000000001','fictional-bootstrap-ci')$$,
  '%ADMIN_BOOTSTRAP_ALREADY_USED%','even a restricted administrator prevents a new bootstrap');
update public.profiles set role='fan',is_restricted=false where id='da000000-0000-4000-8000-000000000003';

-- The intentional exception rolls back this successful fictional phone grant,
-- allowing an independent email success assertion without removing audit data.
select throws_like($outer$do $inner$ begin
  perform pg_temp.bootstrap_initial_admin('da000000-0000-4000-8000-000000000003','phone','15550000003','CONFIRM INITIAL ADMIN da000000-0000-4000-8000-000000000003','fictional-phone-bootstrap-ci');
  raise exception 'EXPECTED_PHONE_CHECK_ROLLBACK';
end $inner$;$outer$,'%EXPECTED_PHONE_CHECK_ROLLBACK%',
  'exact verified phone follows the same guarded grant path');
select is((select count(*) from private.admin_bootstrap_audit),0::bigint,
  'phone scenario and all failed attempts leave no audit or grant');
select is(pg_temp.bootstrap_initial_admin('da000000-0000-4000-8000-000000000001','email','bootstrap-one@example.invalid','CONFIRM INITIAL ADMIN da000000-0000-4000-8000-000000000001','fictional-email-bootstrap-ci'),
  'da000000-0000-4000-8000-000000000001'::uuid,'confirmed verified existing email returns only the target UUID');
select is((select role::text from public.profiles where id='da000000-0000-4000-8000-000000000001'),'admin',
  'only the intended existing profile is granted initial admin');
select is((select count(*) from public.profiles where role='admin'),1::bigint,
  'bootstrap creates exactly one administrator');
select is((select count(*) from auth.users where id::text like 'da000000-%'),3::bigint,
  'bootstrap creates no new Auth account');
select is((select count(*) from private.admin_bootstrap_audit),1::bigint,
  'exactly one bootstrap audit entry is recorded');
select is((select approved_reference from private.admin_bootstrap_audit),'fictional-email-bootstrap-ci',
  'approval evidence reference is preserved without the contact value');
select throws_like($$update private.admin_bootstrap_audit set approved_reference='changed'$$,
  '%ADMIN_ARTIST_AUDIT_IMMUTABLE%','bootstrap approval audit cannot be edited');
select throws_like($$delete from private.admin_bootstrap_audit$$,
  '%ADMIN_ARTIST_AUDIT_IMMUTABLE%','bootstrap approval audit cannot be removed');
select throws_like($$truncate private.admin_bootstrap_audit$$,
  '%ADMIN_ARTIST_AUDIT_IMMUTABLE%','bootstrap approval audit cannot be truncated');
select throws_like($$select pg_temp.bootstrap_initial_admin('da000000-0000-4000-8000-000000000001','email','bootstrap-one@example.invalid','CONFIRM INITIAL ADMIN da000000-0000-4000-8000-000000000001','fictional-email-bootstrap-ci')$$,
  '%ADMIN_BOOTSTRAP_ALREADY_USED%','identical replay does not grant again');
update public.profiles set role='fan' where id='da000000-0000-4000-8000-000000000001';
select throws_like($$select pg_temp.bootstrap_initial_admin('da000000-0000-4000-8000-000000000003','phone','15550000003','CONFIRM INITIAL ADMIN da000000-0000-4000-8000-000000000003','fictional-phone-bootstrap-ci')$$,
  '%ADMIN_BOOTSTRAP_ALREADY_USED%','losing the first administrator does not silently authorize bootstrap reuse');

select * from finish();
rollback;
