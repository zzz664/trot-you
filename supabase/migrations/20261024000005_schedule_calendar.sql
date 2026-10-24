-- Official event / editorial calendar data only. No map URLs, notifications,
-- queue jobs, external services or client calendar UI are created here.
begin;

create type public.schedule_type as enum ('broadcast', 'concert', 'event', 'festival');
create type public.schedule_status as enum ('draft', 'published');

create table public.schedules (
  id uuid primary key default gen_random_uuid(),
  artist_id uuid not null references public.artists(id) on delete restrict,
  type public.schedule_type not null,
  status public.schedule_status not null default 'draft',
  title text not null check (title ~ '[^[:space:]]' and length(title) <= 1000),
  description text check (description is null or length(description) <= 100000),
  starts_at timestamptz not null check (isfinite(starts_at)
    and starts_at >= (timestamp '0001-01-01' at time zone 'Asia/Seoul')
    and starts_at < (timestamp '10000-01-01' at time zone 'Asia/Seoul')),
  ends_at timestamptz check (ends_at is null or (isfinite(ends_at) and ends_at > starts_at
    and ends_at <= (timestamp '10000-01-01' at time zone 'Asia/Seoul'))),
  place_name text check (place_name is null or (place_name ~ '[^[:space:]]' and length(place_name) <= 2000)),
  address text check (address is null or (address ~ '[^[:space:]]' and length(address) <= 2000)),
  lat double precision,
  lng double precision,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint schedule_coordinate_pair check (
    (lat is null and lng is null) or (lat is not null and lng is not null
      and lat between -90 and 90 and lng between -180 and 180)
  )
);
create index schedules_artist_start_idx on public.schedules(artist_id, starts_at, id);
create index schedules_published_start_idx on public.schedules(starts_at, id) where status = 'published';
create trigger schedules_updated_at before update on public.schedules
  for each row execute function private.touch_updated_at();

create table public.schedule_notification_optouts (
  user_id uuid not null references public.profiles(id) on delete cascade,
  schedule_id uuid not null references public.schedules(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, schedule_id)
);
create index schedule_optouts_schedule_idx on public.schedule_notification_optouts(schedule_id);

create table public.content_calendar (
  id uuid primary key default gen_random_uuid(),
  artist_id uuid not null references public.artists(id) on delete restrict,
  date date not null check (isfinite(date) and date between date '0001-01-01' and date '9999-12-31'),
  topic text not null check (topic ~ '[^[:space:]]' and length(topic) <= 1000),
  example_text text check (example_text is null or length(example_text) <= 100000),
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (artist_id, date)
);
create trigger content_calendar_updated_at before update on public.content_calendar
  for each row execute function private.touch_updated_at();

create table public.calendar_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references public.profiles(id) on delete restrict,
  target_type text not null check (target_type in ('schedule', 'content_calendar')),
  target_id uuid not null,
  action text not null check (action in ('create', 'update', 'delete')),
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz not null default now(),
  check ((action = 'create' and before_data is null and after_data is not null)
    or (action = 'update' and before_data is not null and after_data is not null)
    or (action = 'delete' and before_data is not null and after_data is null))
);
create index calendar_audit_target_idx on public.calendar_audit_log(target_type, target_id, created_at, id);
create index calendar_audit_actor_idx on public.calendar_audit_log(actor_id);

alter table public.schedules enable row level security;
alter table public.schedule_notification_optouts enable row level security;
alter table public.content_calendar enable row level security;
alter table public.calendar_audit_log enable row level security;
revoke all on public.schedules, public.schedule_notification_optouts,
  public.content_calendar, public.calendar_audit_log from public, anon, authenticated, service_role;
-- Raw author UUIDs are never part of public/artist calendar projections.
grant select (id, artist_id, type, status, title, description, starts_at, ends_at,
  place_name, address, lat, lng, created_at, updated_at) on public.schedules to authenticated;
grant select (id, artist_id, date, topic, example_text, created_at, updated_at)
  on public.content_calendar to authenticated;
grant select on public.schedule_notification_optouts, public.calendar_audit_log to authenticated;

create function private.calendar_actor_allowed(p_actor uuid, p_at timestamptz)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p where p.id = p_actor
    and (p.role <> 'fan' or p.onboarding_completed_at is not null)
    and not (p.is_restricted and (p.restricted_until is null or p.restricted_until > p_at)));
$$;
create function private.calendar_current_actor_allowed() returns boolean
language sql stable security definer set search_path = '' as $$
  select private.calendar_actor_allowed(auth.uid(), statement_timestamp());
$$;
create function private.calendar_is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
    and private.calendar_actor_allowed(auth.uid(), statement_timestamp());
$$;
create function private.calendar_can_read_content(p_artist uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.calendar_is_admin() or (
    private.calendar_actor_allowed(auth.uid(), statement_timestamp()) and exists (
      select 1 from public.artist_members m join public.profiles p on p.id = m.user_id
      join public.artists a on a.id = m.artist_id where m.artist_id = p_artist
        and p.id = auth.uid() and p.role = 'artist' and a.status = 'active'));
$$;
create function private.calendar_schedule_visible(p_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.schedules s join public.artists a on a.id = s.artist_id
    where s.id = p_id and s.status = 'published' and a.status = 'active');
$$;
create policy schedules_admin_read on public.schedules for select to authenticated
  using (private.calendar_is_admin());
create policy content_calendar_read on public.content_calendar for select to authenticated
  using (private.calendar_can_read_content(artist_id));
create policy schedule_optouts_own_read on public.schedule_notification_optouts for select to authenticated
  using (user_id = auth.uid() and private.calendar_current_actor_allowed()
    and private.calendar_schedule_visible(schedule_id));
create policy calendar_audit_admin_read on public.calendar_audit_log for select to authenticated
  using (private.calendar_is_admin());

-- Deliberate owner-rights safe projection, like artist_catalog. No author,
-- profile/contact, internal status or editorial calendar joins are exposed.
create view public.schedule_catalog with (security_barrier = true) as
  select s.id, s.artist_id, a.slug as artist_slug, a.name as artist_name,
    s.type, s.title, s.description, s.starts_at, s.ends_at, s.place_name,
    s.address, s.lat, s.lng, s.created_at, s.updated_at
  from public.schedules s join public.artists a on a.id = s.artist_id
  where s.status = 'published' and a.status = 'active';
revoke all on public.schedule_catalog from public, anon, authenticated, service_role;
grant select on public.schedule_catalog to anon, authenticated, service_role;
comment on view public.schedule_catalog is
  'Read-only public active-artist published events. Intentional owner-rights safe projection; no private author fields.';
comment on column public.schedules.lat is
  'Finite WGS84 latitude paired with longitude; future map adapters generate trusted links, never open stored URLs.';

-- First-of-month dates represent calendar months in Asia/Seoul, never the
-- database session timezone. ISO year bounds are technical API input limits.
create function private.calendar_month_bounds(p_month date) returns tstzrange
language plpgsql stable set search_path = '' as $$
begin
  if p_month is null or not isfinite(p_month) or extract(day from p_month) <> 1
    or p_month < date '0001-01-01' or p_month > date '9999-12-01' then
    raise exception 'CALENDAR_INVALID_MONTH' using errcode = '22023';
  end if;
  return tstzrange(p_month::timestamp at time zone 'Asia/Seoul',
    (p_month + interval '1 month') at time zone 'Asia/Seoul', '[)');
end;
$$;

create function public.schedule_get(p_schedule_id uuid) returns setof public.schedule_catalog
language plpgsql stable security definer set search_path = '' as $$
begin
  return query select * from public.schedule_catalog where id = p_schedule_id;
  if not found then raise exception 'SCHEDULE_UNAVAILABLE' using errcode = '42501'; end if;
end;
$$;
create function public.schedule_list(p_month date, p_artist_ids uuid[] default null,
  p_after_starts_at timestamptz default null, p_after_id uuid default null, p_limit integer default 100)
returns setof public.schedule_catalog language plpgsql stable security definer set search_path = '' as $$
declare bounds tstzrange;
begin
  bounds := private.calendar_month_bounds(p_month);
  if p_artist_ids is not null and coalesce(array_ndims(p_artist_ids), 1) <> 1 then
    raise exception 'SCHEDULE_INVALID_FILTER' using errcode = '22023';
  end if;
  if p_limit is null or p_limit not between 1 and 100
    or (p_after_starts_at is null) <> (p_after_id is null)
    or (p_after_starts_at is not null and not isfinite(p_after_starts_at))
    or (p_artist_ids is not null and (cardinality(p_artist_ids) > 100 or array_position(p_artist_ids, null) is not null)) then
    raise exception 'SCHEDULE_INVALID_FILTER' using errcode = '22023';
  end if;
  return query select s.* from public.schedule_catalog s
    where (p_artist_ids is null or s.artist_id = any(p_artist_ids))
      and s.starts_at < upper(bounds)
      and ((s.ends_at is null and s.starts_at >= lower(bounds)) or s.ends_at > lower(bounds))
      and (p_after_starts_at is null or (s.starts_at, s.id) > (p_after_starts_at, p_after_id))
    order by s.starts_at, s.id limit p_limit;
end;
$$;

-- Mutations lock authoritative actor -> artist -> event. A fresh wall clock
-- after waiting prevents role/restriction/artist-state revocation races.
create function private.require_calendar_actor(p_admin boolean default false)
returns uuid language plpgsql set search_path = '' as $$
declare actor public.profiles%rowtype;
begin
  select * into actor from public.profiles where id = auth.uid() for update;
  if actor.id is null or (p_admin and actor.role <> 'admin')
    or (actor.role = 'fan' and actor.onboarding_completed_at is null)
    or (actor.is_restricted and (actor.restricted_until is null or actor.restricted_until > clock_timestamp())) then
    raise exception 'CALENDAR_FORBIDDEN' using errcode = '42501';
  end if;
  return actor.id;
end;
$$;
create function private.lock_calendar_artist(p_artist uuid, p_active boolean default false)
returns void language plpgsql set search_path = '' as $$
begin
  perform 1 from public.artists where id = p_artist and (not p_active or status = 'active') for share;
  if not found then raise exception 'CALENDAR_ARTIST_UNAVAILABLE' using errcode = '42501'; end if;
end;
$$;
create function private.lock_schedule(p_id uuid, p_public boolean default false)
returns public.schedules language plpgsql set search_path = '' as $$
declare event public.schedules%rowtype;
begin
  select * into event from public.schedules where id = p_id;
  if event.id is null then raise exception 'SCHEDULE_UNAVAILABLE' using errcode = '42501'; end if;
  perform private.lock_calendar_artist(event.artist_id, p_public);
  select * into event from public.schedules where id = p_id for update;
  if event.id is null or (p_public and event.status <> 'published') then
    raise exception 'SCHEDULE_UNAVAILABLE' using errcode = '42501';
  end if;
  return event;
end;
$$;

create function public.schedule_create(p_artist_id uuid, p_type public.schedule_type, p_title text,
  p_starts_at timestamptz, p_ends_at timestamptz default null, p_description text default null,
  p_place_name text default null, p_address text default null, p_lat double precision default null,
  p_lng double precision default null, p_status public.schedule_status default 'draft')
returns uuid language plpgsql security definer set search_path = '' as $$
declare actor uuid; event public.schedules%rowtype;
begin
  actor := private.require_calendar_actor(true);
  perform private.lock_calendar_artist(p_artist_id);
  insert into public.schedules(artist_id, type, title, starts_at, ends_at, description, place_name, address, lat, lng, status, created_by)
    values (p_artist_id, p_type, p_title, p_starts_at, p_ends_at, p_description, p_place_name, p_address, p_lat, p_lng, p_status, actor)
    returning * into event;
  insert into public.calendar_audit_log(actor_id, target_type, target_id, action, after_data)
    values (actor, 'schedule', event.id, 'create', to_jsonb(event));
  return event.id;
end;
$$;
create function public.schedule_update(p_schedule_id uuid, p_type public.schedule_type, p_title text,
  p_starts_at timestamptz, p_ends_at timestamptz default null, p_description text default null,
  p_place_name text default null, p_address text default null, p_lat double precision default null,
  p_lng double precision default null, p_status public.schedule_status default 'draft')
returns uuid language plpgsql security definer set search_path = '' as $$
declare actor uuid; previous public.schedules%rowtype; event public.schedules%rowtype;
begin
  actor := private.require_calendar_actor(true);
  previous := private.lock_schedule(p_schedule_id);
  update public.schedules set type = p_type, title = p_title, starts_at = p_starts_at, ends_at = p_ends_at,
    description = p_description, place_name = p_place_name, address = p_address, lat = p_lat, lng = p_lng, status = p_status
    where id = p_schedule_id returning * into event;
  insert into public.calendar_audit_log(actor_id, target_type, target_id, action, before_data, after_data)
    values (actor, 'schedule', event.id, 'update', to_jsonb(previous), to_jsonb(event));
  return event.id;
end;
$$;
create function public.schedule_delete(p_schedule_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare actor uuid; event public.schedules%rowtype;
begin
  actor := private.require_calendar_actor(true);
  event := private.lock_schedule(p_schedule_id);
  insert into public.calendar_audit_log(actor_id, target_type, target_id, action, before_data)
    values (actor, 'schedule', event.id, 'delete', to_jsonb(event));
  delete from public.schedules where id = event.id;
end;
$$;

create function public.schedule_set_notification(p_schedule_id uuid, p_enabled boolean) returns boolean
language plpgsql security definer set search_path = '' as $$
declare actor uuid;
begin
  actor := private.require_calendar_actor();
  if p_enabled is null then raise exception 'SCHEDULE_NOTIFICATION_REQUIRED' using errcode = '22004'; end if;
  perform private.lock_schedule(p_schedule_id, true);
  if p_enabled then
    delete from public.schedule_notification_optouts where user_id = actor and schedule_id = p_schedule_id;
  else
    insert into public.schedule_notification_optouts(user_id, schedule_id) values (actor, p_schedule_id)
      on conflict (user_id, schedule_id) do nothing;
  end if;
  return p_enabled;
end;
$$;
create function public.schedule_get_notification(p_schedule_id uuid) returns boolean
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.calendar_actor_allowed(auth.uid(), statement_timestamp()) then
    raise exception 'CALENDAR_FORBIDDEN' using errcode = '42501';
  end if;
  if not private.calendar_schedule_visible(p_schedule_id) then
    raise exception 'SCHEDULE_UNAVAILABLE' using errcode = '42501';
  end if;
  return not exists (select 1 from public.schedule_notification_optouts
    where user_id = auth.uid() and schedule_id = p_schedule_id);
end;
$$;

create function public.content_calendar_upsert(p_artist_id uuid, p_date date, p_topic text,
  p_example_text text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare actor uuid; previous public.content_calendar%rowtype; entry public.content_calendar%rowtype;
begin
  actor := private.require_calendar_actor(true);
  -- Editorial writes serialize per artist, including the first insert into an
  -- absent (artist,date) slot, so audit snapshots cannot mislabel concurrent edits.
  perform 1 from public.artists where id = p_artist_id for update;
  if not found then raise exception 'CALENDAR_ARTIST_UNAVAILABLE' using errcode = '42501'; end if;
  select * into previous from public.content_calendar where artist_id = p_artist_id and date = p_date for update;
  insert into public.content_calendar(artist_id, date, topic, example_text, created_by)
    values (p_artist_id, p_date, p_topic, p_example_text, actor)
    on conflict (artist_id, date) do update set topic = excluded.topic, example_text = excluded.example_text
    returning * into entry;
  insert into public.calendar_audit_log(actor_id, target_type, target_id, action, before_data, after_data)
    values (actor, 'content_calendar', entry.id, case when previous.id is null then 'create' else 'update' end,
      case when previous.id is null then null else to_jsonb(previous) end, to_jsonb(entry));
  return entry.id;
end;
$$;
create function public.content_calendar_delete(p_entry_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare actor uuid; entry public.content_calendar%rowtype;
begin
  actor := private.require_calendar_actor(true);
  select * into entry from public.content_calendar where id = p_entry_id;
  if entry.id is null then raise exception 'CALENDAR_ENTRY_UNAVAILABLE' using errcode = '42501'; end if;
  perform 1 from public.artists where id = entry.artist_id for update;
  select * into entry from public.content_calendar where id = p_entry_id for update;
  if entry.id is null then raise exception 'CALENDAR_ENTRY_UNAVAILABLE' using errcode = '42501'; end if;
  insert into public.calendar_audit_log(actor_id, target_type, target_id, action, before_data)
    values (actor, 'content_calendar', entry.id, 'delete', to_jsonb(entry));
  delete from public.content_calendar where id = entry.id;
end;
$$;
create function public.content_calendar_list(p_artist_id uuid, p_month date)
returns table (id uuid, artist_id uuid, date date, topic text, example_text text, created_at timestamptz, updated_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.calendar_can_read_content(p_artist_id) then
    raise exception 'CALENDAR_FORBIDDEN' using errcode = '42501';
  end if;
  perform private.calendar_month_bounds(p_month);
  return query select c.id, c.artist_id, c.date, c.topic, c.example_text, c.created_at, c.updated_at
    from public.content_calendar c where c.artist_id = p_artist_id
      and c.date >= p_month and c.date < (p_month + interval '1 month')::date order by c.date, c.id;
end;
$$;

-- Supabase default privileges can grant function execution to application roles;
-- revoke those explicitly, including service_role, before the narrow allowlist.
do $$
declare fn regprocedure;
begin
  for fn in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where (n.nspname = 'public' and p.proname in ('schedule_get', 'schedule_list', 'schedule_create',
      'schedule_update', 'schedule_delete', 'schedule_set_notification', 'schedule_get_notification',
      'content_calendar_upsert', 'content_calendar_delete', 'content_calendar_list'))
      or (n.nspname = 'private' and p.proname in ('calendar_actor_allowed', 'calendar_is_admin',
        'calendar_can_read_content', 'calendar_schedule_visible', 'calendar_month_bounds', 'calendar_current_actor_allowed',
        'require_calendar_actor', 'lock_calendar_artist', 'lock_schedule'))
  loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', fn);
  end loop;
end;
$$;
grant execute on function private.calendar_current_actor_allowed(), private.calendar_is_admin(),
  private.calendar_can_read_content(uuid), private.calendar_schedule_visible(uuid) to authenticated;
grant execute on function public.schedule_get(uuid), public.schedule_list(date, uuid[], timestamptz, uuid, integer)
  to anon, authenticated, service_role;
grant execute on function public.schedule_create(uuid, public.schedule_type, text, timestamptz, timestamptz, text, text, text, double precision, double precision, public.schedule_status),
  public.schedule_update(uuid, public.schedule_type, text, timestamptz, timestamptz, text, text, text, double precision, double precision, public.schedule_status),
  public.schedule_delete(uuid), public.schedule_set_notification(uuid, boolean), public.schedule_get_notification(uuid),
  public.content_calendar_upsert(uuid, date, text, text), public.content_calendar_delete(uuid),
  public.content_calendar_list(uuid, date) to authenticated;

commit;
