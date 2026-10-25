-- Artist received replies and current-week source counts only. No fan identity,
-- outbound reply, notification, report mutation, scheduler or policy activation.
begin;

create index replies_artist_message_page_idx on public.replies(artist_id,message_id,created_at desc,id desc)
  where not is_blocked;

create function private.artist_reply_activity_actor() returns uuid
language plpgsql security definer set search_path='' as $$
declare actor public.profiles%rowtype;
begin
  -- Waiting locks must be followed by fresh READ COMMITTED snapshots.
  if current_setting('transaction_isolation')<>'read committed' then
    raise exception 'ARTIST_REPLY_ISOLATION_UNSUPPORTED' using errcode='25001';
  end if;
  if current_setting('role',true) is distinct from 'authenticated' then
    raise exception 'ARTIST_REPLY_FORBIDDEN' using errcode='42501';
  end if;
  select * into actor from public.profiles where id=auth.uid() for share;
  if actor.id is null or actor.role<>'artist' or actor.onboarding_completed_at is null
    or (actor.is_restricted and (actor.restricted_until is null or actor.restricted_until>clock_timestamp())) then
    raise exception 'ARTIST_REPLY_FORBIDDEN' using errcode='42501';
  end if;
  return actor.id;
end;
$$;
create function private.artist_reply_activity_artist(p_actor_id uuid,p_slug text) returns public.artists
language plpgsql security definer set search_path='' as $$
declare artist public.artists%rowtype;
begin
  if p_slug is null or length(p_slug)>128 or p_slug!~'^[a-z0-9]+(-[a-z0-9]+)*$' then
    raise exception 'ARTIST_REPLY_INVALID_INPUT' using errcode='22023';
  end if;
  select * into artist from public.artists where slug=p_slug and status='active' for share;
  if artist.id is null then raise exception 'ARTIST_REPLY_NOT_FOUND' using errcode='P0002'; end if;
  perform 1 from public.artist_members where user_id=p_actor_id and artist_id=artist.id for share;
  if not found then raise exception 'ARTIST_REPLY_FORBIDDEN' using errcode='42501'; end if;
  return artist;
end;
$$;
create function private.artist_reply_fan_visible(p_user_id uuid,p_at timestamptz) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.profiles p where p.id=p_user_id and p.role='fan'
    and p.onboarding_completed_at is not null and p.call_name is not null
    and not(p.is_restricted and (p.restricted_until is null or p.restricted_until>p_at)));
$$;

-- A snapshot of source activity, NOT settlement arithmetic or an estimated payout.
-- p_at is internal only; callers cannot choose another week/time via a public RPC.
create function private.artist_reply_activity_week(p_artist_id uuid,p_at timestamptz) returns jsonb
language sql stable security definer set search_path='' as $$
  with bounds as (
    select date_trunc('week',p_at at time zone 'Asia/Seoul')::date as first_day
  ), days as (
    select b.first_day,b.first_day+n as day from bounds b cross join generate_series(0,6) n
  ), requirements as (
    select count(p.id)=7
      and coalesce(bool_and(p.enabled and p.activity_enabled and p.contract_from<=d.day and p.contract_until>d.day),false)
      and min(p.weekly_message_min)=max(p.weekly_message_min)
      and min(p.weekly_photo_min)=max(p.weekly_photo_min) as ready,
      min(p.weekly_message_min) as messages,min(p.weekly_photo_min) as photos
    from days d left join private.settlement_policies p
      on p.artist_id=p_artist_id and p.month=date_trunc('month',d.day::timestamp)::date
  ), counts as (
    select count(*) as messages,count(*) filter(where m.type='photo') as photos
    from public.messages m cross join bounds b
    where m.artist_id=p_artist_id and m.status='sent'
      and m.sent_at>=b.first_day::timestamp at time zone 'Asia/Seoul'
      and m.sent_at<(b.first_day+7)::timestamp at time zone 'Asia/Seoul' and m.sent_at<=p_at
  )
  select jsonb_build_object('week_start',b.first_day,'week_end',b.first_day+7,
    'message_count',c.messages,'photo_count',c.photos,'requirements_ready',coalesce(r.ready,false),
    'weekly_message_min',case when r.ready then r.messages end,
    'weekly_photo_min',case when r.ready then r.photos end)
  from bounds b cross join requirements r cross join counts c;
$$;

create function public.artist_reply_activity_artists(p_after_slug text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid; result jsonb;
begin
  actor:=private.artist_reply_activity_actor();
  if p_after_slug is not null and (length(p_after_slug)>128 or p_after_slug!~'^[a-z0-9]+(-[a-z0-9]+)*$') then
    raise exception 'ARTIST_REPLY_INVALID_INPUT' using errcode='22023';
  end if;
  with candidates as materialized (
    select a.id,a.slug,a.name from public.artists a join public.artist_members am on am.artist_id=a.id
    where am.user_id=actor and a.status='active' and (p_after_slug is null or a.slug>p_after_slug)
    order by a.slug limit 51
  ), page as (select * from candidates order by slug limit 50)
  select jsonb_build_object('artists',coalesce((select jsonb_agg(to_jsonb(p) order by p.slug) from page p),'[]'::jsonb),
    'has_more',(select count(*)>50 from candidates)) into result;
  return result;
end;
$$;

create function public.artist_reply_activity_context(p_artist_slug text,p_message_id uuid default null,
  p_before_created_at timestamptz default null,p_before_id uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid; artist public.artists%rowtype; at_time timestamptz; selected jsonb; result jsonb;
begin
  actor:=private.artist_reply_activity_actor();
  artist:=private.artist_reply_activity_artist(actor,p_artist_slug);
  if (p_before_created_at is null)<>(p_before_id is null)
    or (p_before_created_at is not null and not isfinite(p_before_created_at)) then
    raise exception 'ARTIST_REPLY_INVALID_INPUT' using errcode='22023';
  end if;
  at_time:=clock_timestamp();
  if p_message_id is not null then
    select jsonb_build_object('id',m.id,'kind',m.type,'sent_at',m.sent_at) into selected
      from public.messages m where m.id=p_message_id and m.artist_id=artist.id
      and m.status='sent' and m.sent_at<=at_time for share;
    if selected is null then raise exception 'ARTIST_REPLY_NOT_FOUND' using errcode='P0002'; end if;
  end if;
  -- The selected message lock may have waited behind cancellation. Capture the
  -- response as-of clock only after every potentially waiting resource lock.
  at_time:=clock_timestamp();
  -- No fan profile locks after the artist lock: fan send acquires fan -> artist.
  -- Visibility and calling names are one current query snapshot. Expired/canceled
  -- subscriptions do not erase already received, otherwise-visible fan replies.
  with candidates as materialized (
    select r.id,p.call_name,r.body,r.created_at,
      case when m.status='sent' and m.sent_at<=at_time then m.id end as message_id
    from public.replies r join public.profiles p on p.id=r.user_id
    left join public.messages m on m.id=r.message_id and m.artist_id=artist.id
    where r.artist_id=artist.id and not r.is_blocked and r.created_at<=at_time
      and private.artist_reply_fan_visible(r.user_id,at_time)
      and (p_message_id is null or r.message_id=p_message_id)
      and (p_before_created_at is null or (r.created_at,r.id)<(p_before_created_at,p_before_id))
    order by r.created_at desc,r.id desc limit 31
  ), page as (select * from candidates order by created_at desc,id desc limit 30)
  select jsonb_build_object('artist',jsonb_build_object('id',artist.id,'slug',artist.slug,'name',artist.name),
    'server_now',at_time,'selected_message',selected,
    'replies',coalesce((select jsonb_agg(to_jsonb(p) order by p.created_at desc,p.id desc) from page p),'[]'::jsonb),
    'has_more',(select count(*)>30 from candidates),'activity',private.artist_reply_activity_week(artist.id,at_time)) into result;
  return result;
end;
$$;

create function public.artist_reply_activity_messages(p_artist_slug text,
  p_before_sent_at timestamptz default null,p_before_id uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid; artist public.artists%rowtype; at_time timestamptz; result jsonb;
begin
  actor:=private.artist_reply_activity_actor();
  artist:=private.artist_reply_activity_artist(actor,p_artist_slug);
  if (p_before_sent_at is null)<>(p_before_id is null)
    or (p_before_sent_at is not null and not isfinite(p_before_sent_at)) then
    raise exception 'ARTIST_REPLY_INVALID_INPUT' using errcode='22023';
  end if;
  at_time:=clock_timestamp();
  with candidates as materialized (
    select m.id,m.type as kind,m.sent_at from public.messages m where m.artist_id=artist.id
      and m.status='sent' and m.sent_at<=at_time
      and (p_before_sent_at is null or (m.sent_at,m.id)<(p_before_sent_at,p_before_id))
    order by m.sent_at desc,m.id desc limit 31
  ), page as (select * from candidates order by sent_at desc,id desc limit 30)
  select jsonb_build_object('artist',jsonb_build_object('id',artist.id,'slug',artist.slug,'name',artist.name),
    'messages',coalesce((select jsonb_agg(to_jsonb(p) order by p.sent_at desc,p.id desc) from page p),'[]'::jsonb),
    'has_more',(select count(*)>30 from candidates)) into result;
  return result;
end;
$$;

-- Preserve the service-only ABI and its existing actor checks/error vocabulary.
-- It must not become an older path that discloses hidden/restricted fan content.
create or replace function public.messaging_list_replies(p_actor_id uuid,p_artist_id uuid,p_limit integer,
  p_before_created_at timestamptz default null,p_before_id uuid default null)
returns table(id uuid,call_name text,body text,created_at timestamptz)
language plpgsql security definer set search_path='' as $$
begin
  perform private.require_message_service();
  perform private.require_message_author(p_actor_id,p_artist_id);
  if p_limit is null or p_limit not between 1 and 100
    or (p_before_created_at is null)<>(p_before_id is null)
    or (p_before_created_at is not null and not isfinite(p_before_created_at)) then
    raise exception 'MESSAGE_PAGE_INVALID' using errcode='23514';
  end if;
  return query select r.id,p.call_name,r.body,r.created_at from public.replies r join public.profiles p on p.id=r.user_id
    where r.artist_id=p_artist_id and not r.is_blocked and r.created_at<=statement_timestamp()
      and private.artist_reply_fan_visible(r.user_id,statement_timestamp())
      and (p_before_created_at is null or (r.created_at,r.id)<(p_before_created_at,p_before_id))
    order by r.created_at desc,r.id desc limit p_limit;
end;
$$;

revoke all on function private.artist_reply_activity_actor(),private.artist_reply_activity_artist(uuid,text),
  private.artist_reply_fan_visible(uuid,timestamptz),private.artist_reply_activity_week(uuid,timestamptz),
  public.artist_reply_activity_artists(text),public.artist_reply_activity_context(text,uuid,timestamptz,uuid),
  public.artist_reply_activity_messages(text,timestamptz,uuid) from public,anon,authenticated,service_role;
grant execute on function public.artist_reply_activity_artists(text),
  public.artist_reply_activity_context(text,uuid,timestamptz,uuid),public.artist_reply_activity_messages(text,timestamptz,uuid) to authenticated;
comment on function public.artist_reply_activity_context(text,uuid,timestamptz,uuid) is
  'Assigned artist current access only. Fan calling-name-only reply projection, no fan IDs; current KST week sent/photo message source counts. No payment, notification or settlement writes.';
commit;
