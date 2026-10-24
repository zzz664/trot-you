-- Profile-stage onboarding only. Approved operating/legal policy is intentionally
-- absent: no live consent, profanity dataset or policy activation is seeded.
begin;

alter table public.profiles
  add column font_selected_at timestamptz,
  add column age_self_attested_at timestamptz,
  add column profile_completed_at timestamptz,
  add constraint profiles_font_selected_time check (font_selected_at is null or
    (isfinite(font_selected_at) and font_selected_at >= created_at)),
  add constraint profiles_age_attestation_time check (age_self_attested_at is null or
    (isfinite(age_self_attested_at) and age_self_attested_at >= created_at)),
  add constraint profiles_profile_completed_state check (profile_completed_at is null or
    (isfinite(profile_completed_at) and profile_completed_at >= created_at
      and font_selected_at is not null and call_name is not null and age_self_attested_at is not null));
comment on column public.profiles.age_self_attested_at is
  'User explicitly self-attested age 14 or older. Not identity verification, DOB or provider-verified age.';
comment on column public.profiles.profile_completed_at is
  'Profile stage only: font, validated calling name, age self-attestation and required versioned consent. Artist/install stages remain incomplete.';
comment on column public.profiles.onboarding_completed_at is
  'Server-only full onboarding completion after all mandatory stages, including artist/install guidance. Profile RPCs never set this.';

create table private.onboarding_documents (
  version uuid primary key,
  kind text not null check (kind in ('terms','privacy','analytics')),
  title text not null check (btrim(title) <> '' and title !~ '[[:cntrl:]]'),
  body text not null check (body ~ '[^[:space:]]'),
  approved_at timestamptz check (approved_at is null or isfinite(approved_at)),
  published_at timestamptz check (published_at is null or
    (isfinite(published_at) and approved_at is not null and published_at >= approved_at))
);
create table private.profile_onboarding_policy (
  singleton boolean primary key default true check (singleton),
  name_policy_version uuid not null,
  name_approved_at timestamptz check (name_approved_at is null or isfinite(name_approved_at)),
  call_name_min integer not null check (call_name_min between 2 and 10),
  call_name_max integer not null check (call_name_max between call_name_min and 10),
  profanity_words text[] not null check (cardinality(profanity_words) > 0),
  terms_version uuid references private.onboarding_documents(version),
  privacy_version uuid references private.onboarding_documents(version),
  analytics_version uuid references private.onboarding_documents(version)
);
create table private.profile_policy_acceptances (
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('terms','privacy','analytics')),
  version uuid not null references private.onboarding_documents(version),
  accepted_at timestamptz not null check (isfinite(accepted_at)),
  primary key (user_id,kind,version)
);

alter table private.onboarding_documents enable row level security;
alter table private.profile_onboarding_policy enable row level security;
alter table private.profile_policy_acceptances enable row level security;
revoke all on private.onboarding_documents,private.profile_onboarding_policy,private.profile_policy_acceptances
  from public,anon,authenticated,service_role;

create function private.onboarding_document_immutable() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.approved_at is not null then
    raise exception 'ONBOARDING_DOCUMENT_IMMUTABLE' using errcode='23514';
  end if;
  if tg_op='DELETE' then return old; end if;
  if new.version is distinct from old.version or new.kind is distinct from old.kind then
    raise exception 'ONBOARDING_DOCUMENT_IMMUTABLE' using errcode='23514';
  end if;
  return new;
end;
$$;
create trigger onboarding_document_immutable before update or delete on private.onboarding_documents
  for each row execute function private.onboarding_document_immutable();

-- Deliberately owner-rights projection. Only explicitly approved and published
-- immutable text is public; draft content and all account evidence stay private.
create view public.onboarding_policy_documents with (security_barrier=true) as
  select version,kind,title,body,approved_at,published_at from private.onboarding_documents
  where approved_at is not null and approved_at <= now()
    and published_at is not null and published_at <= now();
revoke all on public.onboarding_policy_documents from public,anon,authenticated,service_role;
grant select on public.onboarding_policy_documents to anon,authenticated,service_role;

create function private.onboarding_actor_lock() returns public.profiles
language plpgsql security definer set search_path = '' as $$
declare actor public.profiles%rowtype;
begin
  select * into actor from public.profiles where id=auth.uid() for update;
  if actor.id is null or (actor.is_restricted and
    (actor.restricted_until is null or actor.restricted_until > clock_timestamp())) then
    raise exception 'ONBOARDING_ACTOR_FORBIDDEN' using errcode='42501';
  end if;
  if actor.onboarding_completed_at is not null then
    raise exception 'ONBOARDING_ALREADY_COMPLETED' using errcode='55000'; end if;
  return actor;
end;
$$;

create function private.onboarding_name_policy_ready(p_policy private.profile_onboarding_policy)
returns boolean language sql immutable set search_path = '' as $$
  select (p_policy).singleton is true and (p_policy).name_approved_at is not null
    and (p_policy).profanity_words is not null and cardinality((p_policy).profanity_words)>0
    and not exists(select 1 from unnest((p_policy).profanity_words) word
      where word is null or btrim(word)='' or word<>btrim(word) or word ~ '[[:cntrl:]]');
$$;

create function private.onboarding_validate_name(p_call_name text) returns text
language plpgsql security definer set search_path = '' as $$
declare cfg private.profile_onboarding_policy%rowtype; normalized text;
begin
  select * into cfg from private.profile_onboarding_policy for share;
  if not coalesce(private.onboarding_name_policy_ready(cfg),false)
    or cfg.name_approved_at > clock_timestamp() then
    raise exception 'ONBOARDING_SETUP_NOT_READY' using errcode='55000';
  end if;
  normalized:=normalize(btrim(p_call_name),NFC);
  if normalized is null or char_length(normalized) not between cfg.call_name_min and cfg.call_name_max
    or normalized ~ '[[:cntrl:]]' or normalized ~ U&'[\200B-\200F\202A-\202E\2060-\206F\FEFF]'
    or normalized ~ '^\s|\s$' then
    raise exception 'ONBOARDING_NAME_INVALID' using errcode='22023';
  end if;
  if exists(select 1 from unnest(cfg.profanity_words) word
    where strpos(lower(normalized),lower(normalize(word,NFC)))>0) then
    raise exception 'ONBOARDING_NAME_FORBIDDEN' using errcode='22023';
  end if;
  return normalized;
end;
$$;

create function public.onboarding_get_state()
returns table (
  font_scale public.font_scale, call_name text, font_selected_at timestamptz,
  profile_completed_at timestamptz, age_self_attested_at timestamptz,
  name_policy_ready boolean, call_name_min integer, call_name_max integer,
  terms_version uuid, terms_title text, terms_body text,
  privacy_version uuid, privacy_title text, privacy_body text,
  analytics_version uuid, analytics_title text, analytics_body text, analytics_available boolean
)
language plpgsql stable security definer set search_path = '' as $$
declare actor public.profiles%rowtype;
begin
  select * into actor from public.profiles where id=auth.uid();
  if actor.id is null or (actor.is_restricted and
    (actor.restricted_until is null or actor.restricted_until>now())) then
    raise exception 'ONBOARDING_ACTOR_FORBIDDEN' using errcode='42501';
  end if;
  return query select actor.font_scale,actor.call_name,actor.font_selected_at,
    case when terms.version is not null and privacy.version is not null
      and exists(select 1 from private.profile_policy_acceptances a
        where a.user_id=actor.id and a.kind='terms' and a.version=terms.version)
      and exists(select 1 from private.profile_policy_acceptances a
        where a.user_id=actor.id and a.kind='privacy' and a.version=privacy.version)
      then actor.profile_completed_at end,actor.age_self_attested_at,
    coalesce(private.onboarding_name_policy_ready(cfg) and cfg.name_approved_at<=now(),false),
    cfg.call_name_min,cfg.call_name_max,
    terms.version,terms.title,terms.body,privacy.version,privacy.title,privacy.body,
    case when ap.enabled and ap.consent_version=analytics.version and actor.role='fan' then analytics.version end,
    case when ap.enabled and ap.consent_version=analytics.version and actor.role='fan' then analytics.title end,
    case when ap.enabled and ap.consent_version=analytics.version and actor.role='fan' then analytics.body end,
    coalesce(ap.enabled and ap.consent_version=analytics.version and actor.role='fan',false)
    from (select true as singleton) one
    left join private.profile_onboarding_policy cfg using(singleton)
    left join public.onboarding_policy_documents terms on terms.version=cfg.terms_version and terms.kind='terms'
    left join public.onboarding_policy_documents privacy on privacy.version=cfg.privacy_version and privacy.kind='privacy'
    left join public.onboarding_policy_documents analytics on analytics.version=cfg.analytics_version and analytics.kind='analytics'
    left join private.analytics_policy ap on ap.singleton=true;
end;
$$;

create function public.onboarding_save_font(p_font_scale public.font_scale) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.onboarding_actor_lock();
  if p_font_scale is null then raise exception 'ONBOARDING_FONT_INVALID' using errcode='22023'; end if;
  update public.profiles set font_scale=p_font_scale,
    font_selected_at=coalesce(font_selected_at,clock_timestamp()) where id=auth.uid();
end;
$$;

create function public.onboarding_save_name(p_call_name text) returns void
language plpgsql security definer set search_path = '' as $$
declare actor public.profiles%rowtype; normalized text;
begin
  actor:=private.onboarding_actor_lock();
  if actor.font_selected_at is null then
    raise exception 'ONBOARDING_FONT_REQUIRED' using errcode='55000'; end if;
  normalized:=private.onboarding_validate_name(p_call_name);
  update public.profiles set call_name=normalized where id=actor.id;
end;
$$;

-- Tighten the preexisting analytics opt-in RPC as well: calling it directly
-- must not bypass the readable approved policy requirement. Withdrawal remains
-- available when restricted, disabled, unconfigured or after policy rotation.
create or replace function public.analytics_set_consent(p_granted boolean,p_consent_version uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare cfg private.analytics_policy%rowtype; document private.onboarding_documents%rowtype;
begin
  perform 1 from public.profiles where id=auth.uid() for update;
  if auth.uid() is null or not found then
    raise exception 'ANALYTICS_ACTOR_FORBIDDEN' using errcode='42501'; end if;
  if p_granted is null then raise exception 'ANALYTICS_CONSENT_REQUIRED' using errcode='22004'; end if;
  if not p_granted then
    update private.analytics_consents set granted=false,updated_at=clock_timestamp() where user_id=auth.uid();
    return;
  end if;
  if not private.analytics_actor_allowed(auth.uid(),clock_timestamp(),false) then
    raise exception 'ANALYTICS_ACTOR_FORBIDDEN' using errcode='42501'; end if;
  select * into cfg from private.analytics_policy for share;
  select * into document from private.onboarding_documents where version=cfg.consent_version and kind='analytics' for share;
  if cfg.singleton is null or not cfg.enabled or p_consent_version is distinct from cfg.consent_version
    or document.version is null or document.approved_at is null or document.approved_at>clock_timestamp()
    or document.published_at is null or document.published_at>clock_timestamp() then
    raise exception 'ANALYTICS_CONSENT_REQUIRED' using errcode='55000'; end if;
  insert into private.analytics_consents(user_id,consent_version,granted,granted_at,updated_at)
    values(auth.uid(),cfg.consent_version,true,clock_timestamp(),clock_timestamp())
    on conflict(user_id) do update set consent_version=excluded.consent_version,granted=true,
      granted_at=case when analytics_consents.granted and analytics_consents.consent_version=excluded.consent_version
        then analytics_consents.granted_at else excluded.granted_at end,updated_at=excluded.updated_at;
end;
$$;

create function public.onboarding_complete_profile(
  p_age_over_14 boolean,p_terms_accepted boolean,p_terms_version uuid,
  p_privacy_accepted boolean,p_privacy_version uuid,
  p_analytics_granted boolean default false,p_analytics_version uuid default null
) returns void language plpgsql security definer set search_path = '' as $$
declare actor public.profiles%rowtype; cfg private.profile_onboarding_policy%rowtype;
  terms private.onboarding_documents%rowtype; privacy private.onboarding_documents%rowtype;
  analytics private.onboarding_documents%rowtype; ap private.analytics_policy%rowtype;
  at_time timestamptz;
begin
  actor:=private.onboarding_actor_lock();
  if actor.font_selected_at is null then
    raise exception 'ONBOARDING_FONT_REQUIRED' using errcode='55000'; end if;
  perform private.onboarding_validate_name(actor.call_name);
  if p_age_over_14 is distinct from true then
    raise exception 'ONBOARDING_AGE_REQUIRED' using errcode='22023'; end if;
  if p_terms_accepted is distinct from true or p_privacy_accepted is distinct from true
    or p_analytics_granted is null then
    raise exception 'ONBOARDING_CONSENT_REQUIRED' using errcode='22023'; end if;
  select * into cfg from private.profile_onboarding_policy for share;
  select * into terms from private.onboarding_documents where version=cfg.terms_version and kind='terms' for share;
  select * into privacy from private.onboarding_documents where version=cfg.privacy_version and kind='privacy' for share;
  at_time:=clock_timestamp();
  if terms.version is null or terms.approved_at is null or terms.approved_at>at_time
    or terms.published_at is null or terms.published_at>at_time
    or privacy.version is null or privacy.approved_at is null or privacy.approved_at>at_time
    or privacy.published_at is null or privacy.published_at>at_time then
    raise exception 'ONBOARDING_SETUP_NOT_READY' using errcode='55000'; end if;
  if p_terms_version is distinct from terms.version or p_privacy_version is distinct from privacy.version then
    raise exception 'ONBOARDING_POLICY_CHANGED' using errcode='55000'; end if;
  if p_analytics_granted then
    select * into analytics from private.onboarding_documents
      where version=cfg.analytics_version and kind='analytics' for share;
    select * into ap from private.analytics_policy for share;
    if actor.role<>'fan' or analytics.version is null or analytics.approved_at is null or analytics.approved_at>at_time
      or analytics.published_at is null or analytics.published_at>at_time or ap.singleton is null or not ap.enabled
      or ap.consent_version is distinct from analytics.version or p_analytics_version is distinct from analytics.version then
      raise exception 'ONBOARDING_ANALYTICS_UNAVAILABLE' using errcode='55000'; end if;
  end if;
  -- One transaction; repeated acceptance retains the original evidence time.
  insert into private.profile_policy_acceptances(user_id,kind,version,accepted_at)
    values(actor.id,'terms',terms.version,at_time),(actor.id,'privacy',privacy.version,at_time)
    on conflict (user_id,kind,version) do nothing;
  if p_analytics_granted then
    insert into private.profile_policy_acceptances(user_id,kind,version,accepted_at)
      values(actor.id,'analytics',analytics.version,at_time) on conflict (user_id,kind,version) do nothing;
  end if;
  perform public.analytics_set_consent(p_analytics_granted,p_analytics_version);
  update public.profiles set age_self_attested_at=coalesce(age_self_attested_at,at_time),
    profile_completed_at=coalesce(profile_completed_at,at_time) where id=actor.id;
  -- Deliberately no full onboarding timestamp or signup_complete event.
end;
$$;

revoke all on function private.onboarding_document_immutable(),private.onboarding_actor_lock(),
  private.onboarding_name_policy_ready(private.profile_onboarding_policy),private.onboarding_validate_name(text)
  from public,anon,authenticated,service_role;
revoke all on function public.onboarding_get_state(),public.onboarding_save_font(public.font_scale),
  public.onboarding_save_name(text),public.onboarding_complete_profile(boolean,boolean,uuid,boolean,uuid,boolean,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.onboarding_get_state(),public.onboarding_save_font(public.font_scale),
  public.onboarding_save_name(text),public.onboarding_complete_profile(boolean,boolean,uuid,boolean,uuid,boolean,uuid)
  to authenticated;
commit;
