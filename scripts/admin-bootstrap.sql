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
