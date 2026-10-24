-- Full onboarding proves completion of guidance, not browser installation or
-- Web Push subscription/delivery. No operational policy or permissions seeded.
begin;

create table private.onboarding_install_guidance (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  choice text not null check (choice in ('acknowledged','skipped','installed_self_reported')),
  acknowledged_at timestamptz not null check (isfinite(acknowledged_at)),
  installation_self_reported_at timestamptz,
  constraint onboarding_install_report_state check (
    (choice='installed_self_reported' and installation_self_reported_at is not null
      and isfinite(installation_self_reported_at) and installation_self_reported_at>=acknowledged_at)
    or (choice<>'installed_self_reported' and installation_self_reported_at is null))
);
alter table private.onboarding_install_guidance enable row level security;
revoke all on private.onboarding_install_guidance from public,anon,authenticated,service_role;
comment on table private.onboarding_install_guidance is
  'Explicit guidance acknowledgment including an honest skip. Installation self-report is unverified, separate evidence; no Notification permission, Push subscription or delivery claim.';

-- A broad service-role table grant predates the real onboarding RPC. Prevent
-- that role from setting/clearing completion directly. SECURITY INVOKER is
-- intentional: the RPC owner can write after validation; application roles
-- cannot turn JWT claims, profile updates or raw INSERT into validation proof.
-- Existing historical rows are not rewritten or retroactively asserted valid.
create function private.onboarding_protect_completion() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user in ('anon','authenticated','service_role') and
    ((tg_op='INSERT' and new.onboarding_completed_at is not null) or
      (tg_op='UPDATE' and new.onboarding_completed_at is distinct from old.onboarding_completed_at)) then
    raise exception 'ONBOARDING_COMPLETION_RPC_REQUIRED' using errcode='42501';
  end if;
  return new;
end;
$$;
create trigger profiles_protect_onboarding_completion before insert or update on public.profiles
  for each row execute function private.onboarding_protect_completion();

-- Call after locking the profile, then the current profile/name/legal policy.
-- Separate statements recheck rows after waits at READ COMMITTED. Lock the
-- interest before its artist, so revocation and deactivation cannot slip in
-- between the readiness check and completion. Existing selection RPCs first
-- lock the same profile, so re-selection is serialized as well.
create function private.onboarding_require_active_interest() returns void
language plpgsql security definer set search_path = '' as $$
declare chosen uuid;
begin
  select artist_id into chosen from private.artist_interests where user_id=auth.uid() for share;
  if chosen is null then
    raise exception 'ONBOARDING_ARTIST_REQUIRED' using errcode='55000'; end if;
  perform 1 from public.artists where id=chosen and status='active' for share;
  if not found then
    raise exception 'ONBOARDING_ARTIST_REQUIRED' using errcode='55000'; end if;
end;
$$;

create function public.onboarding_get_install_state()
returns table(choice text,acknowledged_at timestamptz,installation_self_reported_at timestamptz,
  onboarding_completed_at timestamptz)
language plpgsql security definer set search_path = '' as $$
begin
  perform private.discovery_require_actor(auth.uid());
  return query select g.choice,g.acknowledged_at,g.installation_self_reported_at,p.onboarding_completed_at
    from public.profiles p left join private.onboarding_install_guidance g on g.user_id=p.id
    where p.id=auth.uid();
end;
$$;

create function public.onboarding_acknowledge_install(p_choice text) returns void
language plpgsql security definer set search_path = '' as $$
declare completed timestamptz; previous_choice text; at_time timestamptz;
begin
  select onboarding_completed_at into completed from public.profiles where id=auth.uid() for update;
  perform private.discovery_require_actor(auth.uid());
  perform private.onboarding_require_active_interest();
  if p_choice is null or p_choice not in ('acknowledged','skipped','installed_self_reported') then
    raise exception 'ONBOARDING_INSTALL_INVALID' using errcode='22023'; end if;
  select choice into previous_choice from private.onboarding_install_guidance where user_id=auth.uid();
  if completed is not null then
    -- A lost acknowledgment response may be retried after finish succeeded.
    if previous_choice=p_choice then return; end if;
    raise exception 'ONBOARDING_ALREADY_COMPLETED' using errcode='55000';
  end if;
  at_time:=clock_timestamp();
  insert into private.onboarding_install_guidance(user_id,choice,acknowledged_at,installation_self_reported_at)
    values(auth.uid(),p_choice,at_time,case when p_choice='installed_self_reported' then at_time end)
    on conflict(user_id) do update set choice=excluded.choice,
      installation_self_reported_at=case when excluded.choice='installed_self_reported'
        then coalesce(onboarding_install_guidance.installation_self_reported_at,excluded.installation_self_reported_at) end;
end;
$$;

create function public.onboarding_complete() returns timestamptz
language plpgsql security definer set search_path = '' as $$
declare completed timestamptz; cfg private.profile_onboarding_policy%rowtype;
begin
  select onboarding_completed_at into completed from public.profiles where id=auth.uid() for update;
  perform private.discovery_require_actor(auth.uid());
  -- Hold exact current consent evidence as well as the already-locked policy.
  -- A privileged evidence withdrawal that wins first is therefore fail-closed.
  select * into cfg from private.profile_onboarding_policy for share;
  perform 1 from private.profile_policy_acceptances where user_id=auth.uid()
    and kind='terms' and version=cfg.terms_version for share;
  if not found then raise exception 'DISCOVERY_PROFILE_REQUIRED' using errcode='55000'; end if;
  perform 1 from private.profile_policy_acceptances where user_id=auth.uid()
    and kind='privacy' and version=cfg.privacy_version for share;
  if not found then raise exception 'DISCOVERY_PROFILE_REQUIRED' using errcode='55000'; end if;
  perform private.onboarding_require_active_interest();
  perform 1 from private.onboarding_install_guidance where user_id=auth.uid() for share;
  if not found then raise exception 'ONBOARDING_INSTALL_REQUIRED' using errcode='55000'; end if;
  -- Even repeated completion rechecks current readiness. A successful retry
  -- returns precisely the original timestamp and creates no duplicate work.
  if completed is not null then return completed; end if;
  completed:=clock_timestamp();
  update public.profiles set onboarding_completed_at=completed where id=auth.uid();
  return completed;
end;
$$;

revoke all on function private.onboarding_protect_completion(),private.onboarding_require_active_interest()
  from public,anon,authenticated,service_role;
revoke all on function public.onboarding_get_install_state(),public.onboarding_acknowledge_install(text),
  public.onboarding_complete() from public,anon,authenticated,service_role;
grant execute on function public.onboarding_get_install_state(),public.onboarding_acknowledge_install(text),
  public.onboarding_complete() to authenticated;
comment on function public.onboarding_complete() is
  'Idempotent actor-scoped full onboarding after current profile/legal/name, active interest and explicit install-guidance review/skip. Never proves installation, notification permission, paid access or Web Push delivery.';
commit;
