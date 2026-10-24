-- Discovery is an interest preference, never a paid subscription or full signup.
-- No artists, content, policy, media bytes or operating defaults are activated.
begin;

create table private.artist_interests (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  artist_id uuid not null references public.artists(id) on delete cascade,
  selected_at timestamptz not null check (isfinite(selected_at))
);
create index artist_interests_artist_idx on private.artist_interests(artist_id);
alter table private.artist_interests enable row level security;
revoke all on private.artist_interests from public,anon,authenticated,service_role;
comment on table private.artist_interests is
  'One durable discovery choice per actor. Interest only: no subscription, charge, paid access or full onboarding completion. Inactive choices are not returned as completed.';

-- Both auth.uid preference RPCs and the trusted preview service use the same
-- readiness gate. Full onboarding is intentionally not required: installation
-- is a later stage, but every mandatory profile/legal prerequisite still is.
-- Acquire profile -> policy -> artist locks in this order; concurrent policy,
-- restriction and artist changes cannot slip through a waiting write.
create function private.discovery_require_actor(p_actor_id uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare actor public.profiles%rowtype; cfg private.profile_onboarding_policy%rowtype;
  terms private.onboarding_documents%rowtype; privacy private.onboarding_documents%rowtype;
  validated_name text; at_time timestamptz;
begin
  select * into actor from public.profiles where id=p_actor_id for share;
  at_time:=clock_timestamp();
  if actor.id is null or actor.role<>'fan' or (actor.is_restricted and
    (actor.restricted_until is null or actor.restricted_until>at_time)) then
    raise exception 'DISCOVERY_FORBIDDEN' using errcode='42501';
  end if;
  if actor.font_selected_at is null or actor.call_name is null or
    actor.age_self_attested_at is null or actor.profile_completed_at is null then
    raise exception 'DISCOVERY_PROFILE_REQUIRED' using errcode='55000';
  end if;
  begin
    validated_name:=private.onboarding_validate_name(actor.call_name);
  exception
    when sqlstate '22023' then
      raise exception 'DISCOVERY_PROFILE_REQUIRED' using errcode='55000';
    when sqlstate '55000' then
      raise exception 'DISCOVERY_SETUP_NOT_READY' using errcode='55000';
  end;
  -- The validator locks the same singleton before we project its current
  -- legal versions. Only approved, currently published exact versions count.
  select * into cfg from private.profile_onboarding_policy for share;
  select * into terms from private.onboarding_documents
    where version=cfg.terms_version and kind='terms' for share;
  select * into privacy from private.onboarding_documents
    where version=cfg.privacy_version and kind='privacy' for share;
  at_time:=clock_timestamp();
  if terms.version is null or terms.approved_at is null or terms.approved_at>at_time
    or terms.published_at is null or terms.published_at>at_time
    or privacy.version is null or privacy.approved_at is null or privacy.approved_at>at_time
    or privacy.published_at is null or privacy.published_at>at_time then
    raise exception 'DISCOVERY_SETUP_NOT_READY' using errcode='55000';
  end if;
  if not exists(select 1 from private.profile_policy_acceptances a
      where a.user_id=actor.id and a.kind='terms' and a.version=terms.version)
    or not exists(select 1 from private.profile_policy_acceptances a
      where a.user_id=actor.id and a.kind='privacy' and a.version=privacy.version) then
    raise exception 'DISCOVERY_PROFILE_REQUIRED' using errcode='55000';
  end if;
  return validated_name;
end;
$$;

create function public.discovery_get_interest()
returns table(selected_slug text,selected_name text,selected_at timestamptz)
language plpgsql security definer set search_path = '' as $$
begin
  perform private.discovery_require_actor(auth.uid());
  -- Always one safe row. A paused/deleted choice neither leaks hidden artist
  -- data nor advances the installation stage; its private evidence may remain.
  return query select a.slug,a.name,i.selected_at
    from (select true as singleton) one
    left join (private.artist_interests i join public.artists a
      on a.id=i.artist_id and a.status='active') on i.user_id=auth.uid();
end;
$$;

create function public.discovery_select_artist(p_artist_slug text) returns void
language plpgsql security definer set search_path = '' as $$
declare chosen uuid; completed timestamptz;
begin
  -- Serialize repeat/back/reselection for this actor before checking readiness.
  select onboarding_completed_at into completed from public.profiles where id=auth.uid() for update;
  perform private.discovery_require_actor(auth.uid());
  if completed is not null then raise exception 'DISCOVERY_FORBIDDEN' using errcode='42501'; end if;
  if p_artist_slug is null or length(p_artist_slug)>128
    or p_artist_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
    raise exception 'DISCOVERY_INVALID_INPUT' using errcode='22023';
  end if;
  select id into chosen from public.artists where slug=p_artist_slug and status='active' for share;
  if chosen is null then raise exception 'DISCOVERY_NOT_FOUND' using errcode='P0002'; end if;
  insert into private.artist_interests(user_id,artist_id,selected_at)
    values(auth.uid(),chosen,clock_timestamp())
    on conflict(user_id) do update set artist_id=excluded.artist_id,
      selected_at=case when artist_interests.artist_id=excluded.artist_id
        then artist_interests.selected_at else excluded.selected_at end;
end;
$$;

-- Raw templates never become an authenticated PostgREST capability. The server
-- must first verify its session, pass that actor, then use the one application
-- renderer before producing any browser DTO. An empty authorized preview has
-- the same safe context row, rather than confusing no messages with not found.
create function public.discovery_preview(p_actor_id uuid,p_artist_slug text)
returns table(artist_slug text,artist_name text,artist_intro text,call_name text,messages jsonb)
language plpgsql security definer set search_path = '' as $$
declare validated_name text; chosen public.artists%rowtype; cfg private.message_policy%rowtype;
begin
  perform private.require_message_service();
  validated_name:=private.discovery_require_actor(p_actor_id);
  if p_artist_slug is null or length(p_artist_slug)>128
    or p_artist_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
    raise exception 'DISCOVERY_INVALID_INPUT' using errcode='22023';
  end if;
  select * into chosen from public.artists where slug=p_artist_slug and status='active' for share;
  if chosen.id is null then raise exception 'DISCOVERY_NOT_FOUND' using errcode='P0002'; end if;
  select * into cfg from private.message_policy where singleton for share;
  if cfg.singleton is null then raise exception 'DISCOVERY_SETUP_NOT_READY' using errcode='55000'; end if;
  return query select chosen.slug,chosen.name,chosen.intro,validated_name,
    coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'type',m.type,
      'body_template',m.body,'sent_at',m.sent_at,'media',
      coalesce((select jsonb_agg(jsonb_build_object('id',mm.id,'kind',mm.kind,
        'width',mm.width,'height',mm.height,'duration_ms',mm.duration_ms) order by mm.id)
        from public.message_media mm where mm.message_id=m.id),'[]'::jsonb)) order by m.preview_order)
      from (select source.id,source.type,source.body,source.sent_at,source.preview_order
        from public.messages source where source.artist_id=chosen.id
          and source.status='sent' and source.is_preview and source.sent_at<=clock_timestamp()
        order by source.preview_order limit cfg.preview_max_count) m),'[]'::jsonb);
end;
$$;

revoke all on function private.discovery_require_actor(uuid)
  from public,anon,authenticated,service_role;
revoke all on function public.discovery_get_interest(),public.discovery_select_artist(text),
  public.discovery_preview(uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.discovery_get_interest(),public.discovery_select_artist(text) to authenticated;
grant execute on function public.discovery_preview(uuid,text) to service_role;
comment on function public.discovery_preview(uuid,text) is
  'Trusted server-only preview context. Actor must come from a verified session. Templates require application personalization; media metadata grants no byte access.';
commit;
