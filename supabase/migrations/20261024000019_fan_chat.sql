-- Fan chat projection and self-service paid read evidence. No policy activation,
-- subscription mutation, reply authoring, media signing or telemetry is added.
begin;

-- This server-only projection deliberately carries raw templates to the one
-- application renderer. Never expose this RPC to browser roles.
create function public.fan_chat_page(p_actor_id uuid,p_artist_slug text,
  p_limit integer default 30,p_before_sent_at timestamptz default null,p_before_id uuid default null)
returns table(artist_id uuid,artist_slug text,artist_name text,artist_intro text,
  call_name text,has_access boolean,messages jsonb,read_count bigint,has_more boolean)
language plpgsql security definer set search_path = '' as $$
declare chosen public.artists%rowtype; validated_name text; allowed boolean;
  at_time timestamptz; rows_json jsonb; read_total bigint; page_count integer;
begin
  perform private.require_message_service();
  if p_artist_slug is null or length(p_artist_slug)>128
    or p_artist_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
    or p_limit is null or p_limit not between 1 and 100
    or (p_before_sent_at is null)<>(p_before_id is null)
    or (p_before_sent_at is not null and not isfinite(p_before_sent_at)) then
    raise exception 'CHAT_INVALID_INPUT' using errcode='22023';
  end if;
  validated_name:=private.discovery_require_actor(p_actor_id);
  if not exists(select 1 from public.profiles p where p.id=p_actor_id and p.onboarding_completed_at is not null) then
    raise exception 'CHAT_PROFILE_REQUIRED' using errcode='55000';
  end if;
  select * into chosen from public.artists a where a.slug=p_artist_slug and a.status='active' for share;
  if chosen.id is null then raise exception 'CHAT_NOT_FOUND' using errcode='P0002'; end if;
  perform 1 from public.subscriptions s where s.user_id=p_actor_id and s.artist_id=chosen.id for share;
  perform 1 from private.message_policy where singleton for share;
  perform private.get_message_policy();
  at_time:=clock_timestamp();
  allowed:=private.has_subscription_access(p_actor_id,chosen.id,at_time);
  if not allowed then
    return query select chosen.id,chosen.slug,chosen.name,chosen.intro,validated_name,false,'[]'::jsonb,0::bigint,false;
    return;
  end if;
  -- Cursor tuple remains timestamptz + UUID at full database precision. The
  -- extra row establishes has_more without returning an unbounded collection.
  -- Profile -> name/legal policy -> artist -> subscription -> message policy
  -- matches the readmark prefix. Page reads do not lock message rows: another
  -- fan's receipt must not delay this independent MVCC projection. Cancellation
  -- locks the artist, so a waiting page obtains the post-cancellation snapshot.
  -- Explicit sent/time predicates make the existing partial sent-order index
  -- usable; the private predicate still decides every eligibility condition.
  with candidates as materialized (
    select m.id,m.type,m.body,m.sent_at from public.messages m
    where m.artist_id=chosen.id and m.status='sent' and m.sent_at<=at_time
      and private.message_is_visible(p_actor_id,m.id,false,at_time)
      and (p_before_sent_at is null or (m.sent_at,m.id)<(p_before_sent_at,p_before_id))
    order by m.sent_at desc,m.id desc limit p_limit+1
  ), page as (select * from candidates order by sent_at desc,id desc limit p_limit)
  select coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'type',m.type,
    'body_template',m.body,'sent_at',m.sent_at,'read_at',r.read_at,'media',
    coalesce((select jsonb_agg(jsonb_build_object('id',mm.id,'kind',mm.kind,
      'width',mm.width,'height',mm.height,'duration_ms',mm.duration_ms) order by mm.id)
      from public.message_media mm where mm.message_id=m.id),'[]'::jsonb)) order by m.sent_at desc,m.id desc)
    from page m left join public.message_reads r on r.message_id=m.id and r.user_id=p_actor_id),'[]'::jsonb),
    (select count(*)::integer from candidates)
    into rows_json,page_count;
  select count(*) into read_total from public.message_reads r join public.messages m on m.id=r.message_id
    where r.user_id=p_actor_id and m.artist_id=chosen.id and private.message_is_visible(p_actor_id,m.id,false,at_time);
  return query select chosen.id,chosen.slug,chosen.name,chosen.intro,validated_name,true,rows_json,read_total,page_count>p_limit;
end;
$$;

-- auth.uid is the sole subject. A per-actor lock serializes different visible
-- messages as well as repeats so each returned count includes committed prior
-- reads; the underlying receipt insert remains the existing immutable primitive.
create function public.fan_chat_mark_read(p_artist_slug text,p_message_id uuid)
returns table(read_at timestamptz,read_count bigint)
language plpgsql security definer set search_path = '' as $$
declare chosen uuid; stamp timestamptz; read_total bigint; at_time timestamptz;
begin
  if p_artist_slug is null or length(p_artist_slug)>128
    or p_artist_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or p_message_id is null then
    raise exception 'CHAT_INVALID_INPUT' using errcode='22023';
  end if;
  perform 1 from public.profiles where id=auth.uid() for update;
  perform private.discovery_require_actor(auth.uid());
  if not exists(select 1 from public.profiles p where p.id=auth.uid() and p.onboarding_completed_at is not null) then
    raise exception 'CHAT_PROFILE_REQUIRED' using errcode='55000';
  end if;
  select a.id into chosen from public.artists a where a.slug=p_artist_slug and a.status='active' for share;
  if chosen is null then raise exception 'CHAT_NOT_FOUND' using errcode='P0002'; end if;
  if not exists(select 1 from public.messages m where m.id=p_message_id and m.artist_id=chosen) then
    raise exception 'MESSAGE_NOT_VISIBLE' using errcode='42501';
  end if;
  perform 1 from public.subscriptions s where s.user_id=auth.uid() and s.artist_id=chosen for share;
  perform 1 from private.message_policy where singleton for share;
  stamp:=public.mark_message_read(p_message_id);
  at_time:=clock_timestamp();
  select count(*) into read_total from public.message_reads r join public.messages m on m.id=r.message_id
    where r.user_id=auth.uid() and m.artist_id=chosen and private.message_is_visible(auth.uid(),m.id,false,at_time);
  return query select stamp,read_total;
end;
$$;

revoke all on function public.fan_chat_page(uuid,text,integer,timestamptz,uuid),
  public.fan_chat_mark_read(text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.fan_chat_page(uuid,text,integer,timestamptz,uuid) to service_role;
grant execute on function public.fan_chat_mark_read(text,uuid) to authenticated;
comment on function public.fan_chat_page(uuid,text,integer,timestamptz,uuid) is
  'Verified server actor only. Raw templates/calling name require canonical server personalization before client DTO serialization. No read side effects; read_count counts only this actor current visible paid receipts.';
comment on function public.fan_chat_mark_read(text,uuid) is
  'Authenticated self-only current eligible paid read evidence. Artist bound and idempotent. Count excludes canceled, hidden, out-of-history and other-artist messages; historical evidence is never deleted.';
commit;
