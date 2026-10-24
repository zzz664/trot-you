-- Message database foundation. No operational policy seed, media uploads,
-- personalization service, notification delivery or signed URL capability.
begin;

create type public.message_type as enum ('text', 'photo', 'voice', 'video');
create type public.message_status as enum ('draft', 'scheduled', 'sent', 'canceled');

-- Authorization policy snapshot, provisioned only by a trusted settings service.
-- No default document values: missing policy fails closed. Technical ceilings
-- bound SQL arithmetic/storage, not an assertion of approved product policy.
create table private.message_policy (
  singleton boolean primary key default true check (singleton),
  version text not null check (btrim(version) <> '' and length(version) <= 100),
  history_before_seconds integer not null check (history_before_seconds between 0 and 31536000),
  cancel_window_seconds integer not null check (cancel_window_seconds between 0 and 86400),
  max_text_length integer not null check (max_text_length between 1 and 100000),
  max_reply_length integer not null check (max_reply_length between 1 and 10000),
  max_photos integer not null check (max_photos between 1 and 100),
  max_voice_seconds integer not null check (max_voice_seconds between 1 and 86400),
  max_video_seconds integer not null check (max_video_seconds between 1 and 86400),
  preview_max_count integer not null check (preview_max_count between 0 and 100),
  max_photo_bytes bigint not null check (max_photo_bytes between 1 and 10485760),
  max_voice_bytes bigint not null check (max_voice_bytes between 1 and 20971520),
  max_video_bytes bigint not null check (max_video_bytes between 1 and 104857600)
);
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  artist_id uuid not null references public.artists(id),
  author_id uuid not null references public.profiles(id),
  type public.message_type not null,
  body text,
  status public.message_status not null default 'draft',
  is_preview boolean not null default false,
  preview_order smallint,
  scheduled_at timestamptz,
  sent_at timestamptz,
  canceled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (body is null or (btrim(body) <> '' and length(body) <= 100000)),
  check (type <> 'text' or body is not null),
  check ((is_preview and status = 'sent' and preview_order is not null and preview_order > 0) or
    (not is_preview and preview_order is null)),
  check (scheduled_at is null or isfinite(scheduled_at)),
  check (sent_at is null or (isfinite(sent_at) and scheduled_at is not null and sent_at >= scheduled_at)),
  check (canceled_at is null or (isfinite(canceled_at) and (sent_at is null or canceled_at >= sent_at))),
  check ((status = 'draft' and scheduled_at is null and sent_at is null and canceled_at is null) or
    (status = 'scheduled' and scheduled_at is not null and sent_at is null and canceled_at is null) or
    (status = 'sent' and scheduled_at is not null and sent_at is not null and canceled_at is null) or
    (status = 'canceled' and canceled_at is not null))
);
create index messages_sent_idx on public.messages(artist_id, sent_at desc, id desc) where status = 'sent';
create index messages_due_idx on public.messages(scheduled_at, id) where status = 'scheduled';
create index messages_author_idx on public.messages(author_id);
create unique index messages_preview_order_idx on public.messages(artist_id, preview_order) where is_preview;
create trigger messages_updated_at before update on public.messages
  for each row execute function private.touch_updated_at();

-- Normalized references, never arbitrary JSON paths. Actual bytes are verified
-- by the future uploader before this service-only registration is called.
create table public.message_media (
  id uuid primary key,
  message_id uuid not null references public.messages(id) on delete restrict,
  storage_object_id uuid not null unique references storage.objects(id) on delete restrict,
  bucket_id text not null check (bucket_id = 'message-media'),
  object_path text not null unique,
  kind public.message_type not null check (kind <> 'text'),
  mime_type text not null,
  byte_size bigint not null check (byte_size > 0 and byte_size <= 104857600),
  width integer,
  height integer,
  duration_ms integer,
  verified_at timestamptz not null default now(),
  check (width is null or width between 1 and 100000),
  check (height is null or height between 1 and 100000),
  check ((kind = 'photo' and width is not null and height is not null and duration_ms is null) or
    (kind = 'voice' and width is null and height is null and duration_ms is not null and duration_ms between 1 and 86400000) or
    (kind = 'video' and width is not null and height is not null and duration_ms is not null and duration_ms between 1 and 86400000)),
  check ((kind = 'photo' and mime_type in ('image/jpeg', 'image/png', 'image/webp') and byte_size <= 10485760) or
    (kind = 'voice' and mime_type in ('audio/mpeg', 'audio/mp4', 'audio/webm') and byte_size <= 20971520) or
    (kind = 'video' and mime_type in ('video/mp4', 'video/webm')))
);
create index message_media_message_idx on public.message_media(message_id);
create table public.message_reads (
  user_id uuid not null references public.profiles(id) on delete cascade,
  message_id uuid not null references public.messages(id) on delete restrict,
  read_at timestamptz not null default now(),
  primary key (user_id, message_id)
);
create index message_reads_message_idx on public.message_reads(message_id);
create table public.replies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete restrict,
  artist_id uuid not null references public.artists(id) on delete restrict,
  subscription_id uuid not null references public.subscriptions(id) on delete restrict,
  body text not null check (btrim(body) <> '' and length(body) <= 10000),
  is_blocked boolean not null default false,
  created_at timestamptz not null default now()
);
create index replies_artist_idx on public.replies(artist_id, created_at desc, id desc);
create index replies_user_idx on public.replies(user_id, created_at desc);
create index replies_subscription_idx on public.replies(subscription_id);

alter table private.message_policy enable row level security;
alter table public.messages enable row level security;
alter table public.message_media enable row level security;
alter table public.message_reads enable row level security;
alter table public.replies enable row level security;
revoke all on private.message_policy, public.messages, public.message_media,
  public.message_reads, public.replies from public, anon, authenticated, service_role;
grant select, insert, update on private.message_policy to service_role;
grant select on public.messages, public.message_media, public.message_reads, public.replies to authenticated, service_role;
create policy messages_author_read on public.messages for select to authenticated using (
  private.is_artist_member(artist_id) or (select private.current_user_role()) = 'admin'
);
create policy message_media_author_read on public.message_media for select to authenticated using (
  exists (select 1 from public.messages m where m.id = message_id)
);
-- Do not leak subscriber identities to artists through read receipts/replies.
create policy message_reads_own on public.message_reads for select to authenticated using (
  user_id = (select auth.uid()) and (select private.current_user_role()) = 'fan'
);
create policy replies_own on public.replies for select to authenticated using (
  user_id = (select auth.uid()) and (select private.current_user_role()) = 'fan'
);

-- Storage reads/writes stay server-only until resource-authorized signing and
-- verified uploads exist. Restrictive policies also resist future broad grants.
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('message-media', 'message-media', false, 104857600,
  array['image/jpeg', 'image/png', 'image/webp', 'audio/mpeg', 'audio/mp4', 'audio/webm', 'video/mp4', 'video/webm']);
create policy message_media_no_client_bucket on storage.buckets as restrictive for all to anon, authenticated
  using (id <> 'message-media') with check (id <> 'message-media');
create policy message_media_no_client_select on storage.objects as restrictive for select to anon, authenticated
  using (bucket_id <> 'message-media');
create policy message_media_no_client_insert on storage.objects as restrictive for insert to anon, authenticated
  with check (bucket_id <> 'message-media');
create policy message_media_no_client_update on storage.objects as restrictive for update to anon, authenticated
  using (bucket_id <> 'message-media') with check (bucket_id <> 'message-media');
create policy message_media_no_client_delete on storage.objects as restrictive for delete to anon, authenticated
  using (bucket_id <> 'message-media');

-- Read-only role configuration guard: STABLE callers may invoke it. This
-- helper does not acquire locks, write rows or read clock_timestamp().
create function private.require_message_service() returns void
language plpgsql stable set search_path = '' as $$
begin
  if current_setting('role', true) is distinct from 'service_role' then
    raise exception 'MESSAGE_SERVICE_REQUIRED' using errcode = '42501';
  end if;
end;
$$;
create function private.get_message_policy() returns private.message_policy
language plpgsql stable security definer set search_path = '' as $$
declare p private.message_policy%rowtype;
begin
  select * into p from private.message_policy where singleton;
  if not found then raise exception 'MESSAGE_POLICY_REQUIRED' using errcode = '55000'; end if;
  return p;
end;
$$;

-- Single shared access predicate. This preserves the previous billing function's
-- exact paid/canceled/grace boundaries and restriction semantics for all callers.
create function private.has_subscription_access(p_user_id uuid, p_artist_id uuid, p_at timestamptz)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.subscriptions s where s.user_id = p_user_id and s.artist_id = p_artist_id
    and ((s.status in ('active', 'canceled') and s.current_period_start <= p_at and s.current_period_end > p_at)
      or (s.status = 'grace' and s.grace_started_at <= p_at and s.grace_ends_at > p_at))
    and exists (select 1 from public.profiles p where p.id = p_user_id
      and not (p.is_restricted and (p.restricted_until is null or p.restricted_until > p_at))));
$$;
create or replace function public.has_active_access(p_artist_id uuid)
returns boolean language sql stable security invoker set search_path = '' as $$
  select private.has_subscription_access(auth.uid(), p_artist_id, now());
$$;
-- Public helper cannot be abused as a cross-user subscription oracle: only the
-- wrapper is client-executable; its definer owner invokes the private predicate.
alter function public.has_active_access(uuid) security definer;

create function private.require_message_author(p_actor_id uuid, p_artist_id uuid, p_active boolean default false)
returns void language plpgsql set search_path = '' as $$
declare p public.profiles%rowtype;
begin
  select * into p from public.profiles where id = p_actor_id for share;
  if p.id is null or p.role not in ('artist', 'admin') or
    (p.is_restricted and (p.restricted_until is null or p.restricted_until > clock_timestamp())) then
    raise exception 'MESSAGE_AUTHOR_FORBIDDEN' using errcode = '42501';
  end if;
  perform 1 from public.artists where id = p_artist_id and (not p_active or status = 'active') for update;
  if not found then raise exception 'MESSAGE_ARTIST_UNAVAILABLE' using errcode = '42501'; end if;
  if p.role = 'artist' then
    perform 1 from public.artist_members where user_id = p_actor_id and artist_id = p_artist_id for share;
    if not found then raise exception 'MESSAGE_AUTHOR_FORBIDDEN' using errcode = '42501'; end if;
  end if;
end;
$$;
create function private.message_is_visible(p_actor_id uuid, p_message_id uuid, p_preview boolean, p_at timestamptz)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.messages m join public.artists a on a.id = m.artist_id
    join public.profiles p on p.id = p_actor_id cross join private.message_policy cfg
    where m.id = p_message_id and m.status = 'sent' and m.sent_at <= p_at and a.status = 'active'
      and p.role = 'fan' and p.onboarding_completed_at is not null
      and not (p.is_restricted and (p.restricted_until is null or p.restricted_until > p_at))
      and ((p_preview and m.is_preview) or (not p_preview
        and private.has_subscription_access(p_actor_id, m.artist_id, p_at)
        and exists (select 1 from public.subscriptions s where s.user_id = p_actor_id and s.artist_id = m.artist_id
          and m.sent_at >= s.episode_started_at - make_interval(secs => cfg.history_before_seconds))))
  );
$$;

create function public.messaging_save_draft(p_actor_id uuid, p_artist_id uuid, p_message_id uuid,
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
    if m.status <> 'draft' then raise exception 'MESSAGE_NOT_DRAFT' using errcode = '55000'; end if;
    if m.type <> p_type and exists (select 1 from public.message_media where message_id = m.id) then
      raise exception 'MESSAGE_MEDIA_TYPE_CONFLICT' using errcode = '23514';
    end if;
    update public.messages set type = p_type, body = p_body where id = m.id;
  end if;
  return p_message_id;
end;
$$;

create function public.messaging_register_media(p_actor_id uuid, p_message_id uuid, p_media_id uuid,
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

create function private.validate_message_content(p_message_id uuid) returns void
language plpgsql set search_path = '' as $$
declare m public.messages%rowtype; cfg private.message_policy%rowtype; n integer;
begin
  cfg := private.get_message_policy();
  select * into strict m from public.messages where id = p_message_id;
  if m.body is not null and length(m.body) > cfg.max_text_length then raise exception 'MESSAGE_CONTENT_INVALID' using errcode = '23514'; end if;
  select count(*) into n from public.message_media where message_id = m.id;
  if (m.type = 'text' and n <> 0) or (m.type = 'photo' and (n < 1 or n > cfg.max_photos))
    or (m.type in ('voice', 'video') and n <> 1) then raise exception 'MESSAGE_MEDIA_REQUIRED' using errcode = '23514'; end if;
  -- Recheck object association, MIME and bytes at the publication boundary.
  if exists (select 1 from public.message_media mm left join storage.objects o on o.id = mm.storage_object_id
    where mm.message_id = m.id and (o.id is null or o.bucket_id <> mm.bucket_id or o.name <> mm.object_path
      or o.metadata ->> 'mimetype' is distinct from mm.mime_type
      or o.metadata ->> 'size' is distinct from mm.byte_size::text
      or mm.byte_size > case mm.kind when 'photo' then cfg.max_photo_bytes when 'voice' then cfg.max_voice_bytes else cfg.max_video_bytes end
      or (mm.kind = 'voice' and mm.duration_ms::bigint > cfg.max_voice_seconds::bigint * 1000)
      or (mm.kind = 'video' and mm.duration_ms::bigint > cfg.max_video_seconds::bigint * 1000))) then
    raise exception 'MEDIA_OBJECT_CHANGED' using errcode = '23514';
  end if;
end;
$$;
create function public.messaging_schedule(p_actor_id uuid, p_message_id uuid, p_scheduled_at timestamptz)
returns void language plpgsql security definer set search_path = '' as $$
declare m public.messages%rowtype;
begin
  perform private.require_message_service();
  select * into m from public.messages where id = p_message_id;
  perform private.require_message_author(p_actor_id, m.artist_id, true);
  select * into m from public.messages where id = p_message_id for update;
  if m.id is null or m.status <> 'draft' then raise exception 'MESSAGE_NOT_DRAFT' using errcode = '55000'; end if;
  if p_scheduled_at is null or not isfinite(p_scheduled_at) then raise exception 'MESSAGE_SCHEDULE_INVALID' using errcode = '23514'; end if;
  perform private.validate_message_content(m.id);
  -- Past requested times mean "send as soon as the dispatcher processes it";
  -- sent_at is always authoritative server time, never caller-backdated history.
  update public.messages set status = 'scheduled', scheduled_at = greatest(p_scheduled_at, clock_timestamp()) where id = m.id;
end;
$$;
create function public.messaging_dispatch(p_message_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare m public.messages%rowtype; send_time timestamptz;
begin
  perform private.require_message_service();
  select * into m from public.messages where id = p_message_id;
  if m.id is null then raise exception 'MESSAGE_NOT_FOUND' using errcode = 'P0002'; end if;
  perform private.require_message_author(m.author_id, m.artist_id, true);
  select * into m from public.messages where id = p_message_id for update;
  send_time := clock_timestamp();
  if m.status <> 'scheduled' or m.scheduled_at > send_time then return false; end if;
  perform private.validate_message_content(m.id);
  update public.messages set status = 'sent', sent_at = send_time where id = m.id;
  return true;
end;
$$;
create function public.messaging_cancel(p_actor_id uuid, p_message_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare m public.messages%rowtype; cfg private.message_policy%rowtype; cancel_time timestamptz;
begin
  perform private.require_message_service();
  select * into m from public.messages where id = p_message_id;
  perform private.require_message_author(p_actor_id, m.artist_id);
  select * into m from public.messages where id = p_message_id for update;
  if m.id is null then raise exception 'MESSAGE_NOT_FOUND' using errcode = 'P0002'; end if;
  if m.status = 'canceled' then return; end if;
  cfg := private.get_message_policy();
  cancel_time := clock_timestamp();
  if m.status = 'sent' and cancel_time >= m.sent_at + make_interval(secs => cfg.cancel_window_seconds) then
    raise exception 'CANCEL_WINDOW_PASSED' using errcode = '55000';
  end if;
  update public.messages set status = 'canceled', canceled_at = cancel_time, is_preview = false, preview_order = null where id = m.id;
end;
$$;
create function public.messaging_set_previews(p_actor_id uuid, p_artist_id uuid, p_message_ids uuid[])
returns void language plpgsql security definer set search_path = '' as $$
declare cfg private.message_policy%rowtype;
begin
  perform private.require_message_service();
  perform private.require_message_author(p_actor_id, p_artist_id, true);
  if not exists (select 1 from public.profiles where id = p_actor_id and role = 'admin') then
    raise exception 'MESSAGE_ADMIN_REQUIRED' using errcode = '42501';
  end if;
  -- Serialize all replacements of an artist's preview selection.
  perform 1 from public.artists where id = p_artist_id for update;
  cfg := private.get_message_policy();
  if p_message_ids is null or cardinality(p_message_ids) > cfg.preview_max_count
    or cardinality(p_message_ids) <> (select count(distinct id) from unnest(p_message_ids) id) then
    raise exception 'MESSAGE_PREVIEWS_INVALID' using errcode = '23514';
  end if;
  perform 1 from public.messages where artist_id = p_artist_id order by id for update;
  if exists (select 1 from unnest(p_message_ids) u(message_id) where not exists (
    select 1 from public.messages m where m.id = u.message_id and m.artist_id = p_artist_id and m.status = 'sent')) then
    raise exception 'MESSAGE_PREVIEWS_INVALID' using errcode = '23514';
  end if;
  update public.messages set is_preview = false, preview_order = null where artist_id = p_artist_id and is_preview;
  update public.messages m set is_preview = true, preview_order = u.ordinality::smallint
    from unnest(p_message_ids) with ordinality u(id, ordinality) where m.id = u.id and m.artist_id = p_artist_id and m.status = 'sent';
end;
$$;

-- Trusted service DTO only. It must authenticate the actor and perform the
-- single application personalization routine before returning browser content.
create function public.messaging_list_messages(p_actor_id uuid, p_artist_id uuid, p_preview boolean,
  p_limit integer, p_before_sent_at timestamptz default null, p_before_id uuid default null)
returns table(id uuid, artist_id uuid, type public.message_type, body_template text, sent_at timestamptz, media jsonb)
language plpgsql stable security definer set search_path = '' as $$
declare cfg private.message_policy%rowtype;
begin
  perform private.require_message_service();
  cfg := private.get_message_policy();
  if p_preview is null or p_limit is null or p_limit not between 1 and 100
    or (p_preview and p_before_sent_at is not null)
    or (p_before_sent_at is null) <> (p_before_id is null)
    or (p_before_sent_at is not null and not isfinite(p_before_sent_at)) then
    raise exception 'MESSAGE_PAGE_INVALID' using errcode = '23514';
  end if;
  return query select m.id, m.artist_id, m.type, m.body, m.sent_at,
    coalesce((select jsonb_agg(jsonb_build_object('id', mm.id, 'kind', mm.kind,
      'width', mm.width, 'height', mm.height, 'duration_ms', mm.duration_ms) order by mm.id)
      from public.message_media mm where mm.message_id = m.id), '[]'::jsonb)
    from public.messages m where m.artist_id = p_artist_id and private.message_is_visible(p_actor_id, m.id, p_preview, statement_timestamp())
      and (p_before_sent_at is null or (m.sent_at, m.id) < (p_before_sent_at, p_before_id))
    order by (case when p_preview then m.preview_order end), m.sent_at desc, m.id desc
    limit (case when p_preview then least(p_limit, cfg.preview_max_count) else p_limit end);
end;
$$;
create function public.mark_message_read(p_message_id uuid)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare result timestamptz; target_artist uuid;
begin
  perform private.get_message_policy();
  select artist_id into target_artist from public.messages where id = p_message_id;
  -- Same actor -> artist -> subscription -> message order as author/reply paths.
  perform 1 from public.profiles where id = auth.uid() for share;
  perform 1 from public.artists where id = target_artist for share;
  perform 1 from public.subscriptions where user_id = auth.uid() and artist_id = target_artist for share;
  -- Serialize with cancel/dispatch. A preview is not paid reading/refund evidence.
  perform 1 from public.messages where id = p_message_id for update;
  if not private.message_is_visible(auth.uid(), p_message_id, false, clock_timestamp()) then
    raise exception 'MESSAGE_NOT_VISIBLE' using errcode = '42501';
  end if;
  insert into public.message_reads(user_id, message_id, read_at) values (auth.uid(), p_message_id, clock_timestamp())
    on conflict (user_id, message_id) do nothing;
  select read_at into result from public.message_reads where user_id = auth.uid() and message_id = p_message_id;
  return result;
end;
$$;
create function public.messaging_create_reply(p_actor_id uuid, p_artist_id uuid, p_body text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare cfg private.message_policy%rowtype; sub uuid; result uuid;
begin
  perform private.require_message_service();
  cfg := private.get_message_policy();
  perform 1 from public.profiles where id = p_actor_id and role = 'fan' and onboarding_completed_at is not null
    and not (is_restricted and (restricted_until is null or restricted_until > clock_timestamp())) for share;
  if not found then raise exception 'REPLY_FORBIDDEN' using errcode = '42501'; end if;
  perform 1 from public.artists where id = p_artist_id and status = 'active' for share;
  if not found then raise exception 'REPLY_FORBIDDEN' using errcode = '42501'; end if;
  select id into sub from public.subscriptions where user_id = p_actor_id and artist_id = p_artist_id for share;
  if not private.has_subscription_access(p_actor_id, p_artist_id, clock_timestamp()) then raise exception 'REPLY_SUBSCRIPTION_REQUIRED' using errcode = '42501'; end if;
  if p_body is null or btrim(p_body) = '' or length(p_body) > cfg.max_reply_length then
    raise exception 'REPLY_CONTENT_INVALID' using errcode = '23514';
  end if;
  -- Future caller must validate forbidden content and rate limit BEFORE this RPC.
  insert into public.replies(user_id, artist_id, subscription_id, body) values (p_actor_id, p_artist_id, sub, p_body) returning id into result;
  return result;
end;
$$;
create function public.messaging_list_replies(p_actor_id uuid, p_artist_id uuid, p_limit integer,
  p_before_created_at timestamptz default null, p_before_id uuid default null)
returns table(id uuid, call_name text, body text, created_at timestamptz)
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_message_service();
  perform private.require_message_author(p_actor_id, p_artist_id);
  if p_limit is null or p_limit not between 1 and 100
    or (p_before_created_at is null) <> (p_before_id is null)
    or (p_before_created_at is not null and not isfinite(p_before_created_at)) then
    raise exception 'MESSAGE_PAGE_INVALID' using errcode = '23514';
  end if;
  return query select r.id, p.call_name, r.body, r.created_at from public.replies r join public.profiles p on p.id = r.user_id
    where r.artist_id = p_artist_id and not r.is_blocked
      and (p_before_created_at is null or (r.created_at, r.id) < (p_before_created_at, p_before_id))
    order by r.created_at desc, r.id desc limit p_limit;
end;
$$;

-- Explicit grants even under permissive hosted default privileges.
revoke all on function private.require_message_service(), private.get_message_policy(),
  private.has_subscription_access(uuid, uuid, timestamptz), private.require_message_author(uuid, uuid, boolean),
  private.message_is_visible(uuid, uuid, boolean, timestamptz), private.validate_message_content(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.messaging_save_draft(uuid, uuid, uuid, public.message_type, text),
  public.messaging_register_media(uuid, uuid, uuid, uuid, integer, integer, integer),
  public.messaging_schedule(uuid, uuid, timestamptz), public.messaging_dispatch(uuid),
  public.messaging_cancel(uuid, uuid), public.messaging_set_previews(uuid, uuid, uuid[]),
  public.messaging_list_messages(uuid, uuid, boolean, integer, timestamptz, uuid),
  public.messaging_create_reply(uuid, uuid, text), public.messaging_list_replies(uuid, uuid, integer, timestamptz, uuid),
  public.mark_message_read(uuid) from public, anon, authenticated, service_role;
grant execute on function public.messaging_save_draft(uuid, uuid, uuid, public.message_type, text),
  public.messaging_register_media(uuid, uuid, uuid, uuid, integer, integer, integer),
  public.messaging_schedule(uuid, uuid, timestamptz), public.messaging_dispatch(uuid),
  public.messaging_cancel(uuid, uuid), public.messaging_set_previews(uuid, uuid, uuid[]),
  public.messaging_list_messages(uuid, uuid, boolean, integer, timestamptz, uuid),
  public.messaging_create_reply(uuid, uuid, text), public.messaging_list_replies(uuid, uuid, integer, timestamptz, uuid)
  to service_role;
grant execute on function public.mark_message_read(uuid) to authenticated;

comment on table private.message_policy is 'Server-only approved policy snapshot. No seed/fallback; settings integration is pending.';
comment on function public.messaging_register_media(uuid, uuid, uuid, uuid, integer, integer, integer) is
  'Trusted uploader only after byte sniffing, size/dimension/duration probing and moderation. SQL checks Storage metadata, not actual bytes.';
comment on function public.messaging_list_messages(uuid, uuid, boolean, integer, timestamptz, uuid) is
  'Server-only safe DTO, no author identity or storage path. Authenticate actor and personalize body_template before browser delivery.';
comment on function public.messaging_dispatch(uuid) is
  'DB-only due-message transition; no notification outbox or dispatcher implemented. Do not expose as a live delivery flow.';
comment on table public.message_reads is 'Immutable historical paid-read evidence; retained after cancellation. New canceled-message reads are denied.';
commit;
