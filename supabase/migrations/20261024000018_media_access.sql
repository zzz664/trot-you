-- Resource-bound upload reservations and current-access projections. Quarantine
-- bytes never grant message access. The server must probe the actual bytes and
-- upload the exact verified buffer to the immutable final path before finalizing.
begin;

create table private.media_uploads (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null,
  actor_id uuid not null references public.profiles(id) on delete restrict,
  artist_id uuid not null references public.artists(id) on delete restrict,
  message_id uuid not null references public.messages(id) on delete restrict,
  media_id uuid not null unique default gen_random_uuid(),
  kind public.message_type not null check (kind <> 'text'),
  mime_type text not null,
  byte_size bigint not null check (byte_size between 1 and 104857600),
  quarantine_path text not null unique,
  object_path text not null unique,
  state text not null default 'pending' check (state in ('pending','completed','revoked')),
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  completed_at timestamptz,
  revoked_at timestamptz,
  unique(actor_id,request_id),
  check (isfinite(created_at) and isfinite(expires_at) and expires_at>created_at),
  check ((state='pending' and completed_at is null and revoked_at is null)
    or (state='completed' and completed_at is not null and revoked_at is null)
    or (state='revoked' and completed_at is null and revoked_at is not null))
);
create index media_uploads_message_pending_idx on private.media_uploads(message_id,expires_at) where state='pending';
alter table private.media_uploads enable row level security;
revoke all on private.media_uploads from public,anon,authenticated,service_role;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('media-quarantine','media-quarantine',false,104857600,
  array['image/jpeg','image/png','image/webp','audio/mpeg','audio/mp4','audio/webm','video/mp4','video/webm']);
create policy media_quarantine_no_client_bucket on storage.buckets as restrictive for all to anon,authenticated
  using(id<>'media-quarantine') with check(id<>'media-quarantine');
create policy media_quarantine_no_client_select on storage.objects as restrictive for select to anon,authenticated
  using(bucket_id<>'media-quarantine');
create policy media_quarantine_no_client_insert on storage.objects as restrictive for insert to anon,authenticated
  with check(bucket_id<>'media-quarantine');
create policy media_quarantine_no_client_update on storage.objects as restrictive for update to anon,authenticated
  using(bucket_id<>'media-quarantine') with check(bucket_id<>'media-quarantine');
create policy media_quarantine_no_client_delete on storage.objects as restrictive for delete to anon,authenticated
  using(bucket_id<>'media-quarantine');

create function private.media_upload_projection(p_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('upload_id',u.id,'media_id',u.media_id,'artist_id',u.artist_id,'message_id',u.message_id,
    'kind',u.kind,'mime_type',u.mime_type,'byte_size',u.byte_size,'quarantine_path',u.quarantine_path,
    'object_path',u.object_path,'expires_at',u.expires_at,'state',u.state,
    'max_bytes',case u.kind when 'photo' then c.max_photo_bytes when 'voice' then c.max_voice_bytes else c.max_video_bytes end,
    'max_count',case u.kind when 'photo' then c.max_photos else 1 end,
    'max_duration_ms',case u.kind when 'voice' then c.max_voice_seconds::bigint*1000 when 'video' then c.max_video_seconds::bigint*1000 end)
  from private.media_uploads u cross join private.message_policy c where u.id=p_id and c.singleton;
$$;

-- Lock order: profile -> artist -> member -> message -> policy -> intent.
-- Current author status is checked on every call, including idempotent replay.
create function private.media_lock_author(p_actor_id uuid,p_message_id uuid) returns public.messages
language plpgsql security definer set search_path='' as $$
declare m public.messages%rowtype;
begin
  select * into m from public.messages where id=p_message_id;
  if m.id is null then raise exception 'MEDIA_FORBIDDEN' using errcode='42501'; end if;
  perform private.require_message_author(p_actor_id,m.artist_id,true);
  select * into strict m from public.messages where id=p_message_id for update;
  perform 1 from private.message_policy where singleton for share;
  perform private.get_message_policy();
  return m;
end;
$$;

create function public.media_begin_upload(p_actor_id uuid,p_message_id uuid,p_mime_type text,p_byte_size bigint,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.messages%rowtype; c private.message_policy%rowtype; u private.media_uploads%rowtype;
  extension text; cap bigint; occupied bigint; stamp timestamptz;
begin
  perform private.require_message_service();
  m:=private.media_lock_author(p_actor_id,p_message_id);
  c:=private.get_message_policy();
  if p_request_id is null or p_mime_type is null or p_byte_size is null then
    raise exception 'MEDIA_INPUT_INVALID' using errcode='22023';
  end if;
  select * into u from private.media_uploads where actor_id=p_actor_id and request_id=p_request_id for update;
  if u.id is not null then
    if u.message_id<>p_message_id or u.mime_type<>p_mime_type or u.byte_size<>p_byte_size then
      raise exception 'MEDIA_UPLOAD_CONFLICT' using errcode='23514';
    end if;
    if u.state='revoked' then raise exception 'MEDIA_UPLOAD_REVOKED' using errcode='42501'; end if;
    if u.state='completed' then return private.media_upload_projection(u.id); end if;
    if u.expires_at<=clock_timestamp() then raise exception 'MEDIA_UPLOAD_EXPIRED' using errcode='55000'; end if;
    if m.status<>'draft' or m.type<>u.kind then raise exception 'MEDIA_DRAFT_REQUIRED' using errcode='55000'; end if;
    return private.media_upload_projection(u.id);
  end if;
  if m.status<>'draft' or m.type='text' then raise exception 'MEDIA_DRAFT_REQUIRED' using errcode='55000'; end if;
  extension:=case p_mime_type when 'image/jpeg' then 'jpg' when 'image/png' then 'png' when 'image/webp' then 'webp'
    when 'audio/mpeg' then 'mp3' when 'audio/mp4' then 'm4a' when 'audio/webm' then 'webm'
    when 'video/mp4' then 'mp4' when 'video/webm' then 'webm' end;
  if extension is null or not ((m.type='photo' and p_mime_type in ('image/jpeg','image/png','image/webp'))
    or (m.type='voice' and p_mime_type in ('audio/mpeg','audio/mp4','audio/webm'))
    or (m.type='video' and p_mime_type in ('video/mp4','video/webm'))) then
    raise exception 'MEDIA_TYPE_INVALID' using errcode='23514';
  end if;
  cap:=case m.type when 'photo' then c.max_photo_bytes when 'voice' then c.max_voice_bytes else c.max_video_bytes end;
  if p_byte_size<1 or p_byte_size>cap then raise exception 'MEDIA_LIMIT_EXCEEDED' using errcode='23514'; end if;
  stamp:=clock_timestamp();
  select (select count(*) from public.message_media mm where mm.message_id=m.id)+
    (select count(*) from private.media_uploads pending where pending.message_id=m.id and pending.state='pending' and pending.expires_at>stamp)
    into occupied;
  if occupied>=(case m.type when 'photo' then c.max_photos else 1 end) then
    raise exception 'MEDIA_COUNT_EXCEEDED' using errcode='23514';
  end if;
  u.id:=gen_random_uuid(); u.media_id:=gen_random_uuid();
  insert into private.media_uploads(id,request_id,actor_id,artist_id,message_id,media_id,kind,mime_type,byte_size,
    quarantine_path,object_path,created_at,expires_at)
  values(u.id,p_request_id,p_actor_id,m.artist_id,m.id,u.media_id,m.type,p_mime_type,p_byte_size,
    m.artist_id::text||'/'||m.id::text||'/'||u.id::text||'.'||extension,
    m.artist_id::text||'/'||m.id::text||'/'||u.media_id::text||'.'||extension,stamp,stamp+interval '10 minutes');
  return private.media_upload_projection(u.id);
end;
$$;

create function public.media_resolve_upload(p_actor_id uuid,p_upload_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u private.media_uploads%rowtype; m public.messages%rowtype; c private.message_policy%rowtype;
begin
  perform private.require_message_service();
  select * into u from private.media_uploads where id=p_upload_id and actor_id=p_actor_id;
  if u.id is null then raise exception 'MEDIA_FORBIDDEN' using errcode='42501'; end if;
  m:=private.media_lock_author(p_actor_id,u.message_id);
  select * into strict u from private.media_uploads where id=p_upload_id for update;
  if u.state='revoked' then raise exception 'MEDIA_UPLOAD_REVOKED' using errcode='42501'; end if;
  if u.state='completed' then return private.media_upload_projection(u.id); end if;
  if u.expires_at<=clock_timestamp() then raise exception 'MEDIA_UPLOAD_EXPIRED' using errcode='55000'; end if;
  if m.status<>'draft' or m.type<>u.kind then raise exception 'MEDIA_DRAFT_REQUIRED' using errcode='55000'; end if;
  c:=private.get_message_policy();
  if u.byte_size>(case u.kind when 'photo' then c.max_photo_bytes when 'voice' then c.max_voice_bytes else c.max_video_bytes end) then
    raise exception 'MEDIA_LIMIT_EXCEEDED' using errcode='23514';
  end if;
  return private.media_upload_projection(u.id);
end;
$$;

create function public.media_finalize_upload(p_actor_id uuid,p_upload_id uuid,p_storage_object_id uuid,
  p_width integer,p_height integer,p_duration_ms integer) returns uuid
language plpgsql security definer set search_path='' as $$
declare u private.media_uploads%rowtype; o storage.objects%rowtype; mm public.message_media%rowtype;
begin
  perform private.require_message_service();
  perform public.media_resolve_upload(p_actor_id,p_upload_id);
  select * into strict u from private.media_uploads where id=p_upload_id;
  if u.state='completed' then
    select * into mm from public.message_media where id=u.media_id;
    if mm.storage_object_id is distinct from p_storage_object_id or mm.width is distinct from p_width
      or mm.height is distinct from p_height or mm.duration_ms is distinct from p_duration_ms then
      raise exception 'MEDIA_UPLOAD_CONFLICT' using errcode='23514';
    end if;
    return u.media_id;
  end if;
  select * into o from storage.objects where id=p_storage_object_id for share;
  if o.id is null or o.bucket_id<>'message-media' or o.name<>u.object_path
    or o.metadata->>'mimetype' is distinct from u.mime_type or jsonb_typeof(o.metadata->'size') is distinct from 'number'
    or coalesce(o.metadata->>'size','') !~ '^[1-9][0-9]{0,8}$' then
    raise exception 'MEDIA_OBJECT_INVALID' using errcode='23514';
  end if;
  if u.expires_at<=clock_timestamp() then raise exception 'MEDIA_UPLOAD_EXPIRED' using errcode='55000'; end if;
  -- Sanitized image bytes may differ from declared source size. Registration
  -- rechecks the verified final object's kind-specific current policy byte cap.
  perform public.messaging_register_media(p_actor_id,u.message_id,u.media_id,o.id,p_width,p_height,p_duration_ms);
  update private.media_uploads set state='completed',completed_at=clock_timestamp() where id=u.id;
  return u.media_id;
end;
$$;

create function public.media_revoke_upload(p_actor_id uuid,p_upload_id uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare u private.media_uploads%rowtype;
begin
  perform private.require_message_service();
  select * into u from private.media_uploads where id=p_upload_id and actor_id=p_actor_id;
  if u.id is null then raise exception 'MEDIA_FORBIDDEN' using errcode='42501'; end if;
  perform private.media_lock_author(p_actor_id,u.message_id);
  select * into strict u from private.media_uploads where id=p_upload_id for update;
  if u.state='completed' then return false; end if;
  if u.state='revoked' then return true; end if;
  update private.media_uploads set state='revoked',revoked_at=clock_timestamp() where id=u.id;
  return true;
end;
$$;

-- Never accept a browser path. Re-evaluate current membership, preview selection,
-- restriction, subscription state/history, artist/message state and blob identity.
-- Locks serialize revocation; callers still cap URLs to this entitlement deadline.
create function public.media_resolve_read(p_actor_id uuid,p_media_id uuid,p_preview boolean default false) returns jsonb
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

revoke all on function private.media_upload_projection(uuid),private.media_lock_author(uuid,uuid)
  from public,anon,authenticated,service_role;
revoke all on function public.media_begin_upload(uuid,uuid,text,bigint,uuid),public.media_resolve_upload(uuid,uuid),
  public.media_finalize_upload(uuid,uuid,uuid,integer,integer,integer),public.media_revoke_upload(uuid,uuid),
  public.media_resolve_read(uuid,uuid,boolean) from public,anon,authenticated,service_role;
grant execute on function public.media_begin_upload(uuid,uuid,text,bigint,uuid),public.media_resolve_upload(uuid,uuid),
  public.media_finalize_upload(uuid,uuid,uuid,integer,integer,integer),public.media_revoke_upload(uuid,uuid),
  public.media_resolve_read(uuid,uuid,boolean) to service_role;
comment on table private.media_uploads is
  'Server-only 10-minute resource-bound reservations. Supabase signed upload tokens can outlive intent expiry but only reach unreadable quarantine. No production policy enabled.';
comment on function public.media_finalize_upload(uuid,uuid,uuid,integer,integer,integer) is
  'Trusted verified-byte uploader only; never expose raw RPC or accept client-reported dimensions/duration as verification. Canonical final blob must be uploaded with upsert=false.';
comment on function public.media_resolve_read(uuid,uuid,boolean) is
  'Authenticated server-only capability projection; signed URL TTL must be <=60 seconds and <=access_expires_at after revalidation. Issued URLs retain a bounded revocation window.';
commit;
