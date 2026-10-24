-- Fan replies: authenticated actor binding, replay-safe writes and private feed.
-- No live policy, profanity list, rate value, reward or notification is seeded.
begin;

create table private.reply_policy (
  singleton boolean primary key default true check (singleton),
  version text not null check (btrim(version)<>'' and length(version)<=100),
  approved_at timestamptz not null check (isfinite(approved_at)),
  rate_window_seconds integer not null check (rate_window_seconds between 1 and 3600),
  rate_max_count integer not null check (rate_max_count between 1 and 10000),
  forbidden_terms text[] not null check (cardinality(forbidden_terms) between 1 and 1000 and array_position(forbidden_terms,null) is null),
  -- Only these bounded built-in detectors are supported; configuration is not
  -- executable regular expression code. Literal profanity terms are separate.
  forbidden_patterns text[] not null check (cardinality(forbidden_patterns) between 1 and 3
    and array_position(forbidden_patterns,null) is null
    and forbidden_patterns <@ array['phone','account','url']::text[])
);
create table private.reply_rate_limits (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  started_at timestamptz not null check (isfinite(started_at)),
  count integer not null check (count between 1 and 10000)
);
alter table private.reply_policy enable row level security;
alter table private.reply_rate_limits enable row level security;
revoke all on private.reply_policy,private.reply_rate_limits from public,anon,authenticated,service_role;
grant select,insert,update on private.reply_policy to service_role;

alter table public.replies add column operation_id uuid;
alter table public.replies add column message_id uuid references public.messages(id) on delete restrict;
create unique index replies_operation_idx on public.replies(user_id,operation_id) where operation_id is not null;
create index replies_own_page_idx on public.replies(user_id,artist_id,created_at desc,id desc);
create index replies_message_idx on public.replies(message_id) where message_id is not null;
-- All fan reads now use the redacted current-access DTO, not raw stored bodies.
revoke select on public.replies from authenticated;

create function private.reply_policy_ready(p_cfg private.reply_policy,p_at timestamptz)
returns boolean language sql immutable set search_path='' as $$
  select (p_cfg).singleton is true and (p_cfg).approved_at<=p_at
    and not exists(select 1 from unnest((p_cfg).forbidden_terms) term
      where term is null or length(term) not between 1 and 200 or term<>btrim(term)
        or normalize(term,NFKC) !~ '[^[:space:]]'
        or term ~ '[[:cntrl:]]' or term ~ U&'[\200B-\200F\202A-\202E\2060-\206F\FEFF]');
$$;

create function private.reply_validate_body(p_body text,p_max_length integer,p_cfg private.reply_policy)
returns void language plpgsql immutable set search_path='' as $$
declare normalized text; term text;
begin
  normalized:=lower(normalize(p_body,NFKC));
  if length(p_body)>p_max_length then raise exception 'REPLY_TOO_LONG' using errcode='23514'; end if;
  if p_body is null or normalized !~ '[^[:space:]]'
    or p_body ~ U&'[\0001-\0008\000B\000C\000E-\001F\007F\200B-\200F\202A-\202E\2060-\206F\FEFF]' then
    raise exception 'REPLY_CONTENT_INVALID' using errcode='23514';
  end if;
  foreach term in array p_cfg.forbidden_terms loop
    if strpos(normalized,lower(normalize(term,NFKC)))>0 then
      raise exception 'REPLY_FORBIDDEN_CONTENT' using errcode='23514';
    end if;
  end loop;
  if ('phone'=any(p_cfg.forbidden_patterns) and normalized ~ '(^|[^[:digit:]])(0[[:digit:]]{1,2}|[+]?82)[ .()-]*[[:digit:]]{3,4}[ .()-]*[[:digit:]]{4}([^[:digit:]]|$)')
    or ('account'=any(p_cfg.forbidden_patterns) and normalized ~ '(^|[^[:digit:]])([[:digit:]][ -]*){10,16}([^[:digit:]]|$)')
    or ('url'=any(p_cfg.forbidden_patterns) and normalized ~ '([[:alpha:]][[:alnum:]+.-]*://)|www[.]|[[:alnum:]][[:alnum:]-]{0,62}[.]([[:alpha:]]{2,63}|xn--[[:alnum:]-]{1,59})([/:?#[:space:]]|$)') then
    raise exception 'REPLY_FORBIDDEN_CONTENT' using errcode='23514';
  end if;
end;
$$;

-- Only wrappers with an established subject may invoke this private primitive.
-- Lock order matches chat: actor -> name/legal -> artist -> subscription ->
-- message policy -> reply policy -> optional message. Actor UPDATE serializes
-- all this fan's keys and artists, including the rate-limit reservation.
create function private.fan_reply_create(p_actor_id uuid,p_artist_slug text,p_operation_id uuid,p_body text,p_message_id uuid)
returns public.replies language plpgsql security definer set search_path='' as $$
declare chosen uuid; sub uuid; cfg private.message_policy%rowtype; policy private.reply_policy%rowtype;
  prior public.replies%rowtype; result public.replies%rowtype; bucket private.reply_rate_limits%rowtype; at_time timestamptz;
begin
  if p_artist_slug is null or length(p_artist_slug)>128 or p_artist_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
    or p_operation_id is null or p_body is null or length(p_body)>10000 then
    raise exception 'REPLY_INVALID_INPUT' using errcode='22023';
  end if;
  perform 1 from public.profiles where id=p_actor_id for update;
  perform private.discovery_require_actor(p_actor_id);
  if not exists(select 1 from public.profiles where id=p_actor_id and onboarding_completed_at is not null) then
    raise exception 'REPLY_PROFILE_REQUIRED' using errcode='55000';
  end if;
  select a.id into chosen from public.artists a where a.slug=p_artist_slug and a.status='active' for share;
  if chosen is null then raise exception 'REPLY_NOT_FOUND' using errcode='P0002'; end if;
  select s.id into sub from public.subscriptions s where s.user_id=p_actor_id and s.artist_id=chosen for share;
  perform 1 from private.message_policy where singleton for share;
  cfg:=private.get_message_policy();
  if not private.has_subscription_access(p_actor_id,chosen,clock_timestamp()) then
    raise exception 'REPLY_SUBSCRIPTION_REQUIRED' using errcode='42501';
  end if;
  select * into prior from public.replies r where r.user_id=p_actor_id and r.operation_id=p_operation_id;
  if prior.id is not null then
    if prior.artist_id<>chosen or prior.body is distinct from p_body or prior.message_id is distinct from p_message_id then
      raise exception 'REPLY_OPERATION_CONFLICT' using errcode='23505';
    end if;
    -- Reconciliation of an accepted write does not spend quota or depend on a
    -- newly changed send policy/message state. Current actor/access still apply.
    return prior;
  end if;
  select * into policy from private.reply_policy where singleton for share;
  if not coalesce(private.reply_policy_ready(policy,clock_timestamp()),false) then
    raise exception 'REPLY_SETUP_NOT_READY' using errcode='55000';
  end if;
  perform private.reply_validate_body(p_body,cfg.max_reply_length,policy);
  if p_message_id is not null then
    perform 1 from public.messages where id=p_message_id and artist_id=chosen for share;
    if not found or not private.message_is_visible(p_actor_id,p_message_id,false,clock_timestamp()) then
      raise exception 'REPLY_MESSAGE_NOT_VISIBLE' using errcode='42501';
    end if;
  end if;
  at_time:=clock_timestamp();
  -- Re-evaluate time boundaries after every possibly waiting lock.
  if not private.has_subscription_access(p_actor_id,chosen,at_time) then
    raise exception 'REPLY_SUBSCRIPTION_REQUIRED' using errcode='42501';
  end if;
  select * into bucket from private.reply_rate_limits where user_id=p_actor_id for update;
  if bucket.user_id is null or at_time>=bucket.started_at+make_interval(secs=>policy.rate_window_seconds) then
    insert into private.reply_rate_limits(user_id,started_at,count) values(p_actor_id,at_time,1)
      on conflict(user_id) do update set started_at=excluded.started_at,count=excluded.count;
  else
    if bucket.count>=policy.rate_max_count then raise exception 'REPLY_RATE_LIMITED' using errcode='P0001'; end if;
    update private.reply_rate_limits set count=count+1 where user_id=p_actor_id;
  end if;
  insert into public.replies(user_id,artist_id,subscription_id,body,operation_id,message_id,created_at)
    values(p_actor_id,chosen,sub,p_body,p_operation_id,p_message_id,at_time) returning * into result;
  return result;
end;
$$;

create function public.fan_reply_send(p_artist_slug text,p_operation_id uuid,p_body text,p_message_id uuid default null)
returns table(id uuid,operation_id uuid,message_id uuid,body text,created_at timestamptz,is_blocked boolean)
language plpgsql security definer set search_path='' as $$
declare r public.replies%rowtype;
begin
  r:=private.fan_reply_create(auth.uid(),p_artist_slug,p_operation_id,p_body,p_message_id);
  return query select r.id,r.operation_id,r.message_id,case when r.is_blocked then null else r.body end,r.created_at,r.is_blocked;
end;
$$;

create function public.fan_reply_page(p_artist_slug text,p_limit integer default 30,
  p_before_created_at timestamptz default null,p_before_id uuid default null)
returns table(artist_slug text,replies jsonb,max_length integer,send_ready boolean,has_more boolean)
language plpgsql security definer set search_path='' as $$
declare chosen uuid; cfg private.message_policy%rowtype; policy private.reply_policy%rowtype;
  rows_json jsonb; page_count integer;
begin
  if p_artist_slug is null or length(p_artist_slug)>128 or p_artist_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
    or p_limit is null or p_limit not between 1 and 100
    or (p_before_created_at is null)<>(p_before_id is null)
    or (p_before_created_at is not null and not isfinite(p_before_created_at)) then
    raise exception 'REPLY_INVALID_INPUT' using errcode='22023';
  end if;
  perform private.discovery_require_actor(auth.uid());
  if not exists(select 1 from public.profiles where id=auth.uid() and onboarding_completed_at is not null) then
    raise exception 'REPLY_PROFILE_REQUIRED' using errcode='55000';
  end if;
  select a.id into chosen from public.artists a where a.slug=p_artist_slug and a.status='active' for share;
  if chosen is null then raise exception 'REPLY_NOT_FOUND' using errcode='P0002'; end if;
  perform 1 from public.subscriptions where user_id=auth.uid() and artist_id=chosen for share;
  perform 1 from private.message_policy where singleton for share;
  cfg:=private.get_message_policy();
  select * into policy from private.reply_policy where singleton for share;
  if not private.has_subscription_access(auth.uid(),chosen,clock_timestamp()) then
    raise exception 'REPLY_SUBSCRIPTION_REQUIRED' using errcode='42501';
  end if;
  -- Own text is retained, including earlier subscription episodes. The source
  -- defines an artist-message history cutoff, not deletion/expiry of own replies.
  -- A later blocked reply keeps its identity/time but never projects its body.
  with candidates as materialized (
    select r.* from public.replies r where r.user_id=auth.uid() and r.artist_id=chosen
      and (p_before_created_at is null or (r.created_at,r.id)<(p_before_created_at,p_before_id))
    order by r.created_at desc,r.id desc limit p_limit+1
  ), page as (select * from candidates order by created_at desc,id desc limit p_limit)
  select coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'operation_id',r.operation_id,
    'message_id',r.message_id,'body',case when r.is_blocked then null else r.body end,
    'created_at',r.created_at,'is_blocked',r.is_blocked) order by r.created_at desc,r.id desc) from page r),'[]'::jsonb),
    (select count(*)::integer from candidates) into rows_json,page_count;
  return query select p_artist_slug,rows_json,cfg.max_reply_length,
    coalesce(private.reply_policy_ready(policy,clock_timestamp()),false),page_count>p_limit;
end;
$$;

-- Existing service-only ABI remains for internal compatibility, but no longer
-- bypasses current readiness, content policy or quota. It has no caller key and
-- MUST NOT be used for retryable browser submissions. New application code uses
-- fan_reply_send exclusively. Initial legacy errors are retained for callers.
create or replace function public.messaging_create_reply(p_actor_id uuid,p_artist_id uuid,p_body text)
returns uuid language plpgsql security definer set search_path='' as $$
declare cfg private.message_policy%rowtype; target_slug text; result public.replies%rowtype;
begin
  perform private.require_message_service();
  cfg:=private.get_message_policy();
  perform 1 from public.profiles where id=p_actor_id and role='fan' and onboarding_completed_at is not null
    and not (is_restricted and (restricted_until is null or restricted_until>clock_timestamp())) for update;
  if not found then raise exception 'REPLY_FORBIDDEN' using errcode='42501'; end if;
  select slug into target_slug from public.artists where id=p_artist_id and status='active';
  if target_slug is null then raise exception 'REPLY_FORBIDDEN' using errcode='42501'; end if;
  if not private.has_subscription_access(p_actor_id,p_artist_id,clock_timestamp()) then
    raise exception 'REPLY_SUBSCRIPTION_REQUIRED' using errcode='42501';
  end if;
  if p_body is null or btrim(p_body)='' or length(p_body)>cfg.max_reply_length then
    raise exception 'REPLY_CONTENT_INVALID' using errcode='23514';
  end if;
  result:=private.fan_reply_create(p_actor_id,target_slug,gen_random_uuid(),p_body,null);
  return result.id;
end;
$$;

revoke all on function private.reply_policy_ready(private.reply_policy,timestamptz),
  private.reply_validate_body(text,integer,private.reply_policy),private.fan_reply_create(uuid,text,uuid,text,uuid),
  public.fan_reply_send(text,uuid,text,uuid),public.fan_reply_page(text,integer,timestamptz,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.fan_reply_send(text,uuid,text,uuid),
  public.fan_reply_page(text,integer,timestamptz,uuid) to authenticated;
comment on table private.reply_policy is 'Explicitly approved server-only send policy. No operational values or moderation dataset are seeded. Built-in detector identifiers, never arbitrary regular expressions.';
comment on function public.fan_reply_send(text,uuid,text,uuid) is 'Self-only current subscriber write. Caller operation UUID is immutable per actor across artists/body/message; exact replay adds no quota, points, telemetry or delivery.';
comment on function public.fan_reply_page(text,integer,timestamptz,uuid) is 'Self-only retained text, descending exact timestamp/UUID page, blocked body redaction. Current access required; absent reply policy leaves history readable and send_ready=false.';
commit;
