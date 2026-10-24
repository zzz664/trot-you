-- Artist-owned draft authoring only. No dispatch, schedule, cancellation-window,
-- notification delivery, operational policy activation, or Storage deletion.
begin;

create table private.artist_compose_drafts (
  message_id uuid primary key references public.messages(id) on delete restrict,
  owner_id uuid not null references public.profiles(id) on delete restrict,
  artist_id uuid not null references public.artists(id) on delete restrict,
  revision bigint not null default 1 check (revision between 1 and 9007199254740991),
  updated_at timestamptz not null default clock_timestamp() check(isfinite(updated_at))
);
create index artist_compose_drafts_owner_page on private.artist_compose_drafts(owner_id,artist_id,updated_at desc,message_id desc);
create table private.artist_compose_operations (
  actor_id uuid not null references public.profiles(id) on delete restrict,
  operation_id uuid not null,
  message_id uuid not null references private.artist_compose_drafts(message_id) on delete restrict,
  request jsonb not null check(jsonb_typeof(request)='object'),
  response jsonb not null check(jsonb_typeof(response)='object'),
  created_at timestamptz not null default clock_timestamp(),
  primary key(actor_id,operation_id)
);
alter table private.artist_compose_drafts enable row level security;
alter table private.artist_compose_operations enable row level security;
revoke all on private.artist_compose_drafts,private.artist_compose_operations from public,anon,authenticated,service_role;

-- Actor first, then artist/member/message/policy/operation. The actor update
-- lock serializes operation keys across the same account's assigned artists.
create function private.artist_compose_actor() returns uuid
language plpgsql security definer set search_path='' as $$
declare actor public.profiles%rowtype;
begin
  select * into actor from public.profiles where id=auth.uid() for update;
  if actor.id is null or actor.role<>'artist' or
    (actor.is_restricted and (actor.restricted_until is null or actor.restricted_until>clock_timestamp())) then
    raise exception 'COMPOSE_FORBIDDEN' using errcode='42501';
  end if;
  return actor.id;
end;
$$;
create function private.artist_compose_artist(p_actor_id uuid,p_slug text) returns public.artists
language plpgsql security definer set search_path='' as $$
declare artist public.artists%rowtype;
begin
  if p_slug is null or length(p_slug)>128 or p_slug!~'^[a-z0-9]+(-[a-z0-9]+)*$' then
    raise exception 'COMPOSE_INVALID_INPUT' using errcode='22023';
  end if;
  select * into artist from public.artists where slug=p_slug and status='active' for update;
  if artist.id is null then raise exception 'COMPOSE_NOT_FOUND' using errcode='P0002'; end if;
  perform 1 from public.artist_members where artist_id=artist.id and user_id=p_actor_id for share;
  if not found then raise exception 'COMPOSE_FORBIDDEN' using errcode='42501'; end if;
  return artist;
end;
$$;
create function private.artist_compose_policy() returns jsonb
language plpgsql security definer set search_path='' as $$
declare cfg private.message_policy%rowtype; names private.profile_onboarding_policy%rowtype;
begin
  select * into cfg from private.message_policy where singleton for share;
  select * into names from private.profile_onboarding_policy where singleton for share;
  if cfg.singleton is null or not coalesce(private.onboarding_name_policy_ready(names),false)
    or names.name_approved_at>clock_timestamp() then
    raise exception 'COMPOSE_SETUP_NOT_READY' using errcode='55000';
  end if;
  return jsonb_build_object('max_text_length',cfg.max_text_length,'max_photo_count',cfg.max_photos,
    'max_voice_seconds',cfg.max_voice_seconds,'max_video_seconds',cfg.max_video_seconds,
    'photo_max_bytes',cfg.max_photo_bytes,'voice_max_bytes',cfg.max_voice_bytes,'video_max_bytes',cfg.max_video_bytes,
    'call_name_min_length',names.call_name_min,'call_name_max_length',names.call_name_max);
end;
$$;
create function private.artist_compose_projection(p_message_id uuid) returns jsonb
language sql volatile security definer set search_path='' as $$
  select jsonb_build_object('id',m.id,'kind',m.type,'body',m.body,'revision',d.revision,'updated_at',d.updated_at,
    'pending_upload_ids',coalesce((select jsonb_agg(u.id order by u.id) from private.media_uploads u
      where u.message_id=m.id and u.actor_id=d.owner_id and u.state='pending' and u.expires_at>clock_timestamp()),'[]'::jsonb),
    'media',coalesce((select jsonb_agg(jsonb_build_object('id',mm.id,'kind',mm.kind,'width',mm.width,
      'height',mm.height,'duration_ms',mm.duration_ms) order by mm.id)
      from public.message_media mm where mm.message_id=m.id),'[]'::jsonb))
  from public.messages m join private.artist_compose_drafts d on d.message_id=m.id where m.id=p_message_id;
$$;
create function private.artist_compose_lock_draft(p_actor_id uuid,p_artist_id uuid,p_message_id uuid)
returns private.artist_compose_drafts language plpgsql security definer set search_path='' as $$
declare m public.messages%rowtype; d private.artist_compose_drafts%rowtype;
begin
  select * into m from public.messages where id=p_message_id for update;
  select * into d from private.artist_compose_drafts where message_id=p_message_id for update;
  if d.message_id is null or m.artist_id<>p_artist_id or d.artist_id<>p_artist_id
    or m.author_id<>p_actor_id or d.owner_id<>p_actor_id then
    raise exception 'COMPOSE_NOT_FOUND' using errcode='P0002';
  end if;
  if m.status<>'draft' then raise exception 'COMPOSE_NOT_DRAFT' using errcode='55000'; end if;
  return d;
end;
$$;

create function public.artist_compose_artists(p_after_slug text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid; rows_json jsonb; total integer;
begin
  actor:=private.artist_compose_actor();
  if p_after_slug is not null and (length(p_after_slug)>128 or p_after_slug!~'^[a-z0-9]+(-[a-z0-9]+)*$') then
    raise exception 'COMPOSE_INVALID_INPUT' using errcode='22023';
  end if;
  with candidates as materialized (
    select a.id,a.slug,a.name from public.artists a join public.artist_members am on am.artist_id=a.id
    where am.user_id=actor and a.status='active' and (p_after_slug is null or a.slug>p_after_slug)
    order by a.slug limit 51
  ), page as (select * from candidates order by slug limit 50)
  select coalesce((select jsonb_agg(to_jsonb(p) order by p.slug) from page p),'[]'::jsonb),
    (select count(*)::integer from candidates) into rows_json,total;
  return jsonb_build_object('artists',rows_json,'has_more',total>50);
end;
$$;
create function public.artist_compose_context(p_artist_slug text,p_message_id uuid default null,
  p_before_updated_at timestamptz default null,p_before_id uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid; artist public.artists%rowtype; policy jsonb; selected jsonb; rows_json jsonb; total integer;
begin
  actor:=private.artist_compose_actor();
  artist:=private.artist_compose_artist(actor,p_artist_slug);
  if (p_before_updated_at is null)<>(p_before_id is null) or
    (p_before_updated_at is not null and not isfinite(p_before_updated_at)) then
    raise exception 'COMPOSE_INVALID_INPUT' using errcode='22023';
  end if;
  if p_message_id is not null then
    perform private.artist_compose_lock_draft(actor,artist.id,p_message_id);
    selected:=private.artist_compose_projection(p_message_id);
  end if;
  policy:=private.artist_compose_policy();
  with candidates as materialized (
    select d.message_id,d.updated_at from private.artist_compose_drafts d join public.messages m on m.id=d.message_id
    where d.owner_id=actor and m.author_id=actor and d.artist_id=artist.id and m.artist_id=artist.id and m.status='draft'
      and (p_before_updated_at is null or (d.updated_at,d.message_id)<(p_before_updated_at,p_before_id))
    order by d.updated_at desc,d.message_id desc limit 31
  ), page as (select * from candidates order by updated_at desc,message_id desc limit 30)
  select coalesce((select jsonb_agg(private.artist_compose_projection(p.message_id) order by p.updated_at desc,p.message_id desc)
      from page p),'[]'::jsonb),(select count(*)::integer from candidates) into rows_json,total;
  return jsonb_build_object('artist',jsonb_build_object('id',artist.id,'slug',artist.slug,'name',artist.name),
    'policy',policy,'drafts',rows_json,'selected_draft',selected,'has_more',total>30);
end;
$$;

create function public.artist_compose_save(p_artist_slug text,p_message_id uuid,p_operation_id uuid,
  p_expected_revision bigint,p_type public.message_type,p_body text default null,p_media_ids uuid[] default '{}'::uuid[]) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid; artist public.artists%rowtype; d private.artist_compose_drafts%rowtype;
  previous private.artist_compose_operations%rowtype; req jsonb; policy jsonb; ids uuid[]; current_ids uuid[];
  m public.messages%rowtype;
begin
  actor:=private.artist_compose_actor();
  artist:=private.artist_compose_artist(actor,p_artist_slug);
  if p_message_id is null or p_operation_id is null or p_expected_revision is null or p_expected_revision<0
    or p_expected_revision>9007199254740990 or p_type is null or p_media_ids is null
    or cardinality(p_media_ids)>100 or array_position(p_media_ids,null) is not null then
    raise exception 'COMPOSE_INVALID_INPUT' using errcode='22023';
  end if;
  select coalesce(array_agg(id order by id),'{}'::uuid[]) into ids from unnest(p_media_ids) id;
  if cardinality(ids)<>(select count(distinct id) from unnest(ids) id) then
    raise exception 'COMPOSE_INVALID_INPUT' using errcode='22023';
  end if;
  req:=jsonb_build_object('action','save','artist_slug',p_artist_slug,'message_id',p_message_id,
    'expected_revision',p_expected_revision,'kind',p_type,'body',p_body,'media_ids',ids);
  select * into previous from private.artist_compose_operations where actor_id=actor and operation_id=p_operation_id;
  if previous.operation_id is not null then
    if previous.request<>req then raise exception 'COMPOSE_OPERATION_CONFLICT' using errcode='23505'; end if;
    perform private.artist_compose_lock_draft(actor,artist.id,p_message_id);
    perform private.artist_compose_policy();
    -- Replays return the accepted snapshot and never reapply old content. The
    -- caller refreshes current context before another optimistic mutation.
    return previous.response;
  end if;
  select * into m from public.messages where id=p_message_id for update;
  if m.id is not null then d:=private.artist_compose_lock_draft(actor,artist.id,p_message_id);
  elsif p_expected_revision<>0 then raise exception 'COMPOSE_NOT_FOUND' using errcode='P0002'; end if;
  policy:=private.artist_compose_policy();
  if p_body is not null and char_length(p_body)>(policy->>'max_text_length')::integer then
    raise exception 'COMPOSE_TOO_LONG' using errcode='23514';
  end if;
  if (p_body is not null and (p_body!~U&'[^\0009-\000D\0020\00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF]' or p_body ~ U&'[\0001-\0008\000B\000C\000E-\001F\007F]'))
    or (p_type='text' and p_body is null) then
    raise exception 'COMPOSE_CONTENT_INVALID' using errcode='23514';
  end if;
  if m.id is null then
    if cardinality(ids)<>0 then raise exception 'COMPOSE_MEDIA_CONFLICT' using errcode='23514'; end if;
    insert into public.messages(id,artist_id,author_id,type,body) values(p_message_id,artist.id,actor,p_type,p_body);
    insert into private.artist_compose_drafts(message_id,owner_id,artist_id) values(p_message_id,actor,artist.id);
  else
    if d.revision<>p_expected_revision then raise exception 'COMPOSE_REVISION_CONFLICT' using errcode='40001'; end if;
    select coalesce(array_agg(id order by id),'{}'::uuid[]) into current_ids from public.message_media where message_id=p_message_id;
    if ids<>current_ids then raise exception 'COMPOSE_MEDIA_CONFLICT' using errcode='23514'; end if;
    if m.type<>p_type and (cardinality(ids)>0 or exists(select 1 from private.media_uploads u
      where u.message_id=p_message_id and u.state='pending' and u.expires_at>clock_timestamp())) then
      raise exception 'COMPOSE_MEDIA_CONFLICT' using errcode='23514';
    end if;
    update public.messages set type=p_type,body=p_body where id=p_message_id;
    update private.artist_compose_drafts set revision=revision+1,updated_at=clock_timestamp() where message_id=p_message_id;
  end if;
  insert into private.artist_compose_operations(actor_id,operation_id,message_id,request,response)
    values(actor,p_operation_id,p_message_id,req,private.artist_compose_projection(p_message_id));
  return private.artist_compose_projection(p_message_id);
end;
$$;

create function public.artist_compose_remove_media(p_artist_slug text,p_message_id uuid,p_media_id uuid,
  p_expected_revision bigint,p_operation_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid; artist public.artists%rowtype; d private.artist_compose_drafts%rowtype;
  previous private.artist_compose_operations%rowtype; req jsonb;
begin
  actor:=private.artist_compose_actor();
  artist:=private.artist_compose_artist(actor,p_artist_slug);
  if p_message_id is null or p_media_id is null or p_operation_id is null or p_expected_revision is null
    or p_expected_revision<1 or p_expected_revision>9007199254740990 then
    raise exception 'COMPOSE_INVALID_INPUT' using errcode='22023';
  end if;
  d:=private.artist_compose_lock_draft(actor,artist.id,p_message_id);
  perform private.artist_compose_policy();
  req:=jsonb_build_object('action','remove','artist_slug',p_artist_slug,'message_id',p_message_id,
    'media_id',p_media_id,'expected_revision',p_expected_revision);
  select * into previous from private.artist_compose_operations where actor_id=actor and operation_id=p_operation_id;
  if previous.operation_id is not null then
    if previous.request<>req then raise exception 'COMPOSE_OPERATION_CONFLICT' using errcode='23505'; end if;
    return previous.response;
  end if;
  if d.revision<>p_expected_revision then raise exception 'COMPOSE_REVISION_CONFLICT' using errcode='40001'; end if;
  if not exists(select 1 from public.message_media where id=p_media_id and message_id=p_message_id) then
    raise exception 'COMPOSE_MEDIA_CONFLICT' using errcode='23514';
  end if;
  -- Preserve immutable final bytes; unlinking must never delete another current
  -- object or let a previously completed intent reattach the removed resource.
  update private.media_uploads set state='revoked',completed_at=null,revoked_at=clock_timestamp()
    where message_id=p_message_id and media_id=p_media_id and state='completed';
  delete from public.message_media where id=p_media_id and message_id=p_message_id;
  insert into private.artist_compose_operations(actor_id,operation_id,message_id,request,response)
    values(actor,p_operation_id,p_message_id,req,private.artist_compose_projection(p_message_id));
  return private.artist_compose_projection(p_message_id);
end;
$$;

create function private.artist_compose_media_changed() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  update private.artist_compose_drafts set revision=revision+1,updated_at=clock_timestamp()
    where message_id=case when tg_op='DELETE' then old.message_id else new.message_id end;
  return null;
end;
$$;
create trigger artist_compose_media_revision after insert or delete on public.message_media
  for each row execute function private.artist_compose_media_changed();

-- Only composer-owned drafts acquire new ownership rules. Existing legacy
-- collaborative drafts, their service APIs and test fixtures retain contracts.
create function private.artist_compose_can_read(p_message_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select not exists(select 1 from private.artist_compose_drafts d join public.messages m on m.id=d.message_id
    where d.message_id=p_message_id and m.status='draft' and d.owner_id is distinct from auth.uid());
$$;
drop policy messages_author_read on public.messages;
create policy messages_author_read on public.messages for select to authenticated using (
  (private.is_artist_member(artist_id) and private.artist_compose_can_read(id)) or (select private.current_user_role())='admin'
);
create or replace function public.messaging_save_draft(p_actor_id uuid, p_artist_id uuid, p_message_id uuid,
  p_type public.message_type, p_body text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare cfg private.message_policy%rowtype; m public.messages%rowtype;
begin
  perform private.require_message_service();
  perform private.require_message_author(p_actor_id, p_artist_id);
  cfg := private.get_message_policy();
  if p_type is null or (p_body is not null and (btrim(p_body) = '' or length(p_body) > cfg.max_text_length))
    or (p_type = 'text' and p_body is null) then
    raise exception 'MESSAGE_CONTENT_INVALID' using errcode = '23514';
  end if;
  if p_message_id is null then
    insert into public.messages(artist_id, author_id, type, body) values (p_artist_id, p_actor_id, p_type, p_body)
      returning id into p_message_id;
  else
    select * into m from public.messages where id = p_message_id for update;
    if m.id is null or m.artist_id <> p_artist_id then raise exception 'MESSAGE_NOT_FOUND' using errcode = 'P0002'; end if;
    if exists(select 1 from private.artist_compose_drafts where message_id=m.id) then
      raise exception 'COMPOSE_MANAGED_DRAFT' using errcode='42501';
    end if;
    if m.status <> 'draft' then raise exception 'MESSAGE_NOT_DRAFT' using errcode = '55000'; end if;
    if m.type <> p_type and exists (select 1 from public.message_media where message_id = m.id) then
      raise exception 'MESSAGE_MEDIA_TYPE_CONFLICT' using errcode = '23514';
    end if;
    update public.messages set type = p_type, body = p_body where id = m.id;
  end if;
  return p_message_id;
end;
$$;

create or replace function public.messaging_register_media(p_actor_id uuid, p_message_id uuid, p_media_id uuid,
  p_storage_object_id uuid, p_width integer, p_height integer, p_duration_ms integer)
returns uuid language plpgsql security definer set search_path = '' as $$
declare m public.messages%rowtype; o storage.objects%rowtype; cfg private.message_policy%rowtype;
  mime text; ext text; bytes bigint; cap bigint; media_count integer;
begin
  perform private.require_message_service();
  select * into m from public.messages where id = p_message_id;
  perform private.require_message_author(p_actor_id, m.artist_id);
  select * into m from public.messages where id = p_message_id for update;
  if m.id is null or m.status <> 'draft' or m.type = 'text' then raise exception 'MESSAGE_NOT_MEDIA_DRAFT' using errcode = '55000'; end if;
  if exists(select 1 from private.artist_compose_drafts where message_id=m.id and owner_id<>p_actor_id) then
    raise exception 'MEDIA_FORBIDDEN' using errcode='42501';
  end if;
  cfg := private.get_message_policy();
  select * into o from storage.objects where id = p_storage_object_id for share;
  if o.id is null or p_media_id is null or o.bucket_id <> 'message-media' then
    raise exception 'MEDIA_OBJECT_INVALID' using errcode = '23514';
  end if;
  mime := o.metadata ->> 'mimetype';
  ext := case mime when 'image/jpeg' then 'jpg' when 'image/png' then 'png' when 'image/webp' then 'webp'
    when 'audio/mpeg' then 'mp3' when 'audio/mp4' then 'm4a' when 'audio/webm' then 'webm'
    when 'video/mp4' then 'mp4' when 'video/webm' then 'webm' end;
  if ext is null or o.name <> m.artist_id::text || '/' || m.id::text || '/' || p_media_id::text || '.' || ext
    or coalesce(o.metadata ->> 'size', '') !~ '^[1-9][0-9]{0,8}$' then
    raise exception 'MEDIA_PATH_OR_METADATA_INVALID' using errcode = '23514';
  end if;
  bytes := (o.metadata ->> 'size')::bigint;
  cap := case m.type when 'photo' then cfg.max_photo_bytes when 'voice' then cfg.max_voice_bytes else cfg.max_video_bytes end;
  if bytes > cap or (m.type = 'voice' and p_duration_ms::bigint > cfg.max_voice_seconds::bigint * 1000)
    or (m.type = 'video' and p_duration_ms::bigint > cfg.max_video_seconds::bigint * 1000) then
    raise exception 'MEDIA_LIMIT_EXCEEDED' using errcode = '23514';
  end if;
  select count(*) into media_count from public.message_media where message_id = m.id;
  if media_count >= (case when m.type = 'photo' then cfg.max_photos else 1 end) then
    raise exception 'MEDIA_COUNT_EXCEEDED' using errcode = '23514';
  end if;
  insert into public.message_media(id, message_id, storage_object_id, bucket_id, object_path, kind, mime_type,
    byte_size, width, height, duration_ms)
  values (p_media_id, m.id, o.id, o.bucket_id, o.name, m.type, mime, bytes, p_width, p_height, p_duration_ms);
  return p_media_id;
end;
$$;

create or replace function private.media_lock_author(p_actor_id uuid,p_message_id uuid) returns public.messages
language plpgsql security definer set search_path='' as $$
declare m public.messages%rowtype;
begin
  select * into m from public.messages where id=p_message_id;
  if m.id is null then raise exception 'MEDIA_FORBIDDEN' using errcode='42501'; end if;
  perform private.require_message_author(p_actor_id,m.artist_id,true);
  select * into strict m from public.messages where id=p_message_id for update;
  if exists(select 1 from private.artist_compose_drafts where message_id=m.id and owner_id<>p_actor_id) then
    raise exception 'MEDIA_FORBIDDEN' using errcode='42501';
  end if;
  perform 1 from private.message_policy where singleton for share;
  perform private.get_message_policy();
  return m;
end;
$$;

create or replace function public.media_resolve_read(p_actor_id uuid,p_media_id uuid,p_preview boolean default false) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor public.profiles%rowtype; m public.messages%rowtype; mm public.message_media%rowtype;
  a public.artists%rowtype; o storage.objects%rowtype; s public.subscriptions%rowtype;
  cfg private.message_policy%rowtype; stamp timestamptz; deadline timestamptz;
begin
  perform private.require_message_service();
  if p_preview is null then raise exception 'MEDIA_INPUT_INVALID' using errcode='22023'; end if;
  select * into actor from public.profiles where id=p_actor_id for share;
  if actor.id is null then raise exception 'MEDIA_FORBIDDEN' using errcode='42501'; end if;
  select * into mm from public.message_media where id=p_media_id;
  select * into m from public.messages where id=mm.message_id;
  if mm.id is null or m.id is null then raise exception 'MEDIA_FORBIDDEN' using errcode='42501'; end if;
  if actor.role='fan' and p_preview then perform private.discovery_require_actor(p_actor_id); end if;
  select * into a from public.artists where id=m.artist_id for share;
  if actor.role in ('artist','admin') then
    if actor.role='artist' then
      perform 1 from public.artist_members where artist_id=m.artist_id and user_id=p_actor_id for share;
      if not found then raise exception 'MEDIA_FORBIDDEN' using errcode='42501'; end if;
    end if;
  elsif actor.role='fan' and not p_preview then
    select * into s from public.subscriptions where user_id=p_actor_id and artist_id=m.artist_id for share;
  end if;
  select * into m from public.messages where id=mm.message_id for share;
  select * into mm from public.message_media where id=p_media_id for share;
  select * into cfg from private.message_policy where singleton for share;
  if cfg.singleton is null then raise exception 'MESSAGE_POLICY_REQUIRED' using errcode='55000'; end if;
  stamp:=clock_timestamp(); deadline:=stamp+interval '60 seconds';
  if actor.is_restricted and (actor.restricted_until is null or actor.restricted_until>stamp)
    or a.status is distinct from 'active' or m.status='canceled' then
    raise exception 'MEDIA_FORBIDDEN' using errcode='42501';
  end if;
  if actor.role='fan' then
    if p_preview then
      if m.status<>'sent' or m.sent_at>stamp or not m.is_preview or
        not exists(select 1 from (select source.id from public.messages source where source.artist_id=m.artist_id
          and source.status='sent' and source.is_preview and source.sent_at<=stamp order by source.preview_order
          limit cfg.preview_max_count) selected where selected.id=m.id) then
        raise exception 'MEDIA_FORBIDDEN' using errcode='42501';
      end if;
    else
      if not private.message_is_visible(p_actor_id,m.id,false,stamp) then
        raise exception 'MEDIA_FORBIDDEN' using errcode='42501';
      end if;
      deadline:=least(deadline,case when s.status='grace' then s.grace_ends_at else s.current_period_end end);
    end if;
  elsif actor.role='artist' and m.status='draft' and exists(
    select 1 from private.artist_compose_drafts d where d.message_id=m.id and d.owner_id<>p_actor_id) then
    raise exception 'MEDIA_FORBIDDEN' using errcode='42501';
  elsif actor.role not in ('artist','admin') then raise exception 'MEDIA_FORBIDDEN' using errcode='42501';
  end if;
  select * into o from storage.objects where id=mm.storage_object_id for share;
  if o.id is null or o.bucket_id<>mm.bucket_id or o.name<>mm.object_path or o.metadata->>'mimetype' is distinct from mm.mime_type
    or jsonb_typeof(o.metadata->'size') is distinct from 'number' or o.metadata->>'size' is distinct from mm.byte_size::text then
    raise exception 'MEDIA_OBJECT_INVALID' using errcode='23514';
  end if;
  return jsonb_build_object('media_id',mm.id,'message_id',m.id,'kind',mm.kind,'mime_type',mm.mime_type,
    'byte_size',mm.byte_size,'width',mm.width,'height',mm.height,'duration_ms',mm.duration_ms,
    'object_path',mm.object_path,'bucket_id',mm.bucket_id,'access_expires_at',deadline);
end;
$$;

revoke all on function private.artist_compose_actor(),private.artist_compose_artist(uuid,text),
  private.artist_compose_policy(),private.artist_compose_projection(uuid),private.artist_compose_lock_draft(uuid,uuid,uuid),
  private.artist_compose_media_changed(),private.artist_compose_can_read(uuid)
  from public,anon,authenticated,service_role;
grant execute on function private.artist_compose_can_read(uuid) to authenticated;
revoke all on function public.artist_compose_artists(text),public.artist_compose_context(text,uuid,timestamptz,uuid),
  public.artist_compose_save(text,uuid,uuid,bigint,public.message_type,text,uuid[]),
  public.artist_compose_remove_media(text,uuid,uuid,bigint,uuid) from public,anon,authenticated,service_role;
grant execute on function public.artist_compose_artists(text),public.artist_compose_context(text,uuid,timestamptz,uuid),
  public.artist_compose_save(text,uuid,uuid,bigint,public.message_type,text,uuid[]),
  public.artist_compose_remove_media(text,uuid,uuid,bigint,uuid) to authenticated;
comment on function public.artist_compose_save(text,uuid,uuid,bigint,public.message_type,text,uuid[]) is
  'Artist self-only owned draft save. Stable caller-generated message and operation UUIDs; exact media binding; optimistic revision. No schedule/send. Current access and policy checked on replay.';
comment on table private.artist_compose_operations is
  'Private operation bindings preserve retry idempotency. No browser enumeration. Retention requires separately authorized policy; never blindly truncate while retries remain possible.';
commit;
