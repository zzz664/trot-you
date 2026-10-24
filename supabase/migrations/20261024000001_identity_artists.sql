-- Identity/artist foundation only; no accounts, credentials or operational seeds.
begin;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated, service_role;
revoke create on schema public from public, anon, authenticated;

create type public.user_role as enum ('fan', 'artist', 'admin');
create type public.font_scale as enum ('normal', 'large', 'xlarge');
create type public.artist_grade as enum ('B', 'C');
create type public.artist_status as enum ('draft', 'active', 'paused', 'retired');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role public.user_role not null default 'fan',
  nickname text,
  call_name text,
  font_scale public.font_scale not null default 'large',
  age_range text,
  gender text,
  phone text,
  kakao_channel_added boolean not null default false,
  onboarding_completed_at timestamptz,
  is_restricted boolean not null default false,
  restricted_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Structural integrity, not the configurable business length/profanity policy.
  constraint profiles_call_name_structure check (
    call_name is null or (
      call_name = btrim(call_name) and call_name <> ''
      and call_name !~ '[[:cntrl:]]'
    )
  ),
  constraint profiles_onboarding_requires_name check (
    onboarding_completed_at is null or call_name is not null
  ),
  constraint profiles_onboarding_time check (
    onboarding_completed_at is null or onboarding_completed_at >= created_at
  ),
  constraint profiles_restriction_time check (
    restricted_until is null or is_restricted
  )
);

comment on column public.profiles.nickname is
  'Untrusted display metadata, never identity/authorization evidence.';
comment on column public.profiles.age_range is
  'Untrusted metadata; not proof of age or consent. Eligibility is server-verified.';
comment on column public.profiles.onboarding_completed_at is
  'Server-only after validated name, age and required consent; not client-settable.';

create table public.artists (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  profile_image_path text,
  intro text,
  grade public.artist_grade not null,
  status public.artist_status not null default 'draft',
  agency_name text,
  contract_started_at date,
  contract_ended_at date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint artists_slug_structure check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint artists_name_structure check (
    name = btrim(name) and name <> '' and name !~ '[[:cntrl:]]'
  ),
  constraint artists_contract_dates check (
    contract_ended_at is null or (
      contract_started_at is not null and contract_ended_at >= contract_started_at
    )
  )
);

create index artists_active_slug_idx on public.artists(slug) where status = 'active';

create table public.artist_members (
  artist_id uuid not null references public.artists(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  is_manager boolean not null default false,
  primary key (artist_id, user_id)
);
create index artist_members_user_id_idx on public.artist_members(user_id, artist_id);

alter table public.profiles enable row level security;
alter table public.artists enable row level security;
alter table public.artist_members enable row level security;

-- Never rely on hosted/default grants. Authenticated admins still use the same
-- database role as fans, so table grants alone cannot authorize privileged fields.
revoke all on public.profiles, public.artists, public.artist_members
  from public, anon, authenticated;
grant select on public.profiles to authenticated;
-- Calling-name validation depends on runtime policy. Keep it server-only until
-- the onboarding/profile service enforces that policy; direct API writes would
-- otherwise bypass profanity/length checks even after completed onboarding.
grant update (font_scale) on public.profiles to authenticated;
grant select, insert, update, delete on public.artists, public.artist_members
  to authenticated;
grant all on public.profiles, public.artists, public.artist_members to service_role;

create function private.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.id is distinct from old.id then
    raise exception 'IMMUTABLE_ID' using errcode = '23514';
  end if;
  new.created_at := old.created_at;
  new.updated_at := statement_timestamp();
  return new;
end;
$$;
revoke all on function private.touch_updated_at() from public, anon, authenticated;

create trigger profiles_updated_at before update on public.profiles
  for each row execute function private.touch_updated_at();
create trigger artists_updated_at before update on public.artists
  for each row execute function private.touch_updated_at();

create function private.clear_revoked_artist_memberships() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.role is distinct from old.role and new.role <> 'artist' then
    delete from public.artist_members where user_id = new.id;
  end if;
  return new;
end;
$$;
revoke all on function private.clear_revoked_artist_memberships()
  from public, anon, authenticated;
create trigger profiles_revoke_memberships after update of role on public.profiles
  for each row execute function private.clear_revoked_artist_memberships();

create function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- raw_user_meta_data is editable by the user. Copy only non-authoritative
  -- display/demographic strings; never role, restrictions or onboarding claims.
  insert into public.profiles (id, nickname, age_range, gender)
  values (
    new.id,
    case when jsonb_typeof(new.raw_user_meta_data -> 'name') = 'string'
      then nullif(btrim(new.raw_user_meta_data ->> 'name'), '') end,
    case when jsonb_typeof(new.raw_user_meta_data -> 'age_range') = 'string'
      then nullif(btrim(new.raw_user_meta_data ->> 'age_range'), '') end,
    case when jsonb_typeof(new.raw_user_meta_data -> 'gender') = 'string'
      then nullif(btrim(new.raw_user_meta_data ->> 'gender'), '') end
  );
  return new;
end;
$$;
revoke all on function private.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_user();

-- No caller-supplied user ID; no JWT metadata role; no recursion through RLS.
-- Restricted actors lose elevated capabilities until the restriction expires.
create function private.current_user_role() returns public.user_role
language sql stable security definer set search_path = '' as $$
  select p.role from public.profiles p
  where p.id = (select auth.uid())
    and not (p.is_restricted and (
      p.restricted_until is null or p.restricted_until > now()
    ));
$$;
revoke all on function private.current_user_role() from public, anon, authenticated;
grant execute on function private.current_user_role() to authenticated;

create function private.is_artist_member(p_artist uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(private.current_user_role() = 'artist', false) and exists (
    select 1 from public.artist_members m
    where m.artist_id = p_artist and m.user_id = (select auth.uid())
  );
$$;
revoke all on function private.is_artist_member(uuid) from public, anon, authenticated;
grant execute on function private.is_artist_member(uuid) to authenticated;

create policy profiles_read_own_or_admin on public.profiles for select
  to authenticated using (
    id = (select auth.uid()) or (select private.current_user_role()) = 'admin'
  );
create policy profiles_update_own_or_admin on public.profiles for update
  to authenticated using (
    id = (select auth.uid()) or (select private.current_user_role()) = 'admin'
  ) with check (
    id = (select auth.uid()) or (select private.current_user_role()) = 'admin'
  );

create policy artists_read_member_or_admin on public.artists for select
  to authenticated using (
    private.is_artist_member(id) or (select private.current_user_role()) = 'admin'
  );
create policy artists_admin_insert on public.artists for insert
  to authenticated with check ((select private.current_user_role()) = 'admin');
create policy artists_admin_update on public.artists for update
  to authenticated using ((select private.current_user_role()) = 'admin')
  with check ((select private.current_user_role()) = 'admin');
create policy artists_admin_delete on public.artists for delete
  to authenticated using ((select private.current_user_role()) = 'admin');

create policy artist_members_read_own_or_admin on public.artist_members for select
  to authenticated using (
    user_id = (select auth.uid()) or (select private.current_user_role()) = 'admin'
  );
create policy artist_members_admin_insert on public.artist_members for insert
  to authenticated with check ((select private.current_user_role()) = 'admin');
create policy artist_members_admin_update on public.artist_members for update
  to authenticated using ((select private.current_user_role()) = 'admin')
  with check ((select private.current_user_role()) = 'admin');
create policy artist_members_admin_delete on public.artist_members for delete
  to authenticated using ((select private.current_user_role()) = 'admin');

-- Intentional owner-rights projection: public access must NOT inherit the raw
-- artist RLS (members/admin only). Fixed active filter + explicit safe columns,
-- security barrier, no write grants. Never add contract/membership/PII columns.
create view public.artist_catalog with (security_barrier = true) as
  select id, slug, name, profile_image_path, intro
  from public.artists where status = 'active';
revoke all on public.artist_catalog from public, anon, authenticated;
grant select on public.artist_catalog to anon, authenticated, service_role;
comment on view public.artist_catalog is
  'Public read-only active artist projection. Deliberate owner-rights view; excludes contracts and private fields.';

-- Explicit admin-only role change. First admin must be provisioned by a separately
-- authorized operator/server; no role comes from a signup or seed. Lock the actor
-- so concurrent revocation cannot race this authorization check.
create function public.set_profile_role(p_user_id uuid, p_role public.user_role)
returns void language plpgsql security definer set search_path = '' as $$
declare
  actor public.profiles%rowtype;
begin
  select * into actor from public.profiles where id = (select auth.uid()) for update;
  if actor.id is null or actor.role <> 'admin' or (
    actor.is_restricted and (actor.restricted_until is null or actor.restricted_until > now())
  ) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if p_role is null then
    raise exception 'ROLE_REQUIRED' using errcode = '22004';
  end if;
  update public.profiles set role = p_role where id = p_user_id;
  if not found then
    raise exception 'PROFILE_NOT_FOUND' using errcode = 'P0002';
  end if;
  -- The role-change trigger clears revoked memberships for ALL writers, including
  -- trusted server updates, so re-promotion never resurrects old bindings.
end;
$$;
revoke all on function public.set_profile_role(uuid, public.user_role)
  from public, anon, authenticated, service_role;
grant execute on function public.set_profile_role(uuid, public.user_role) to authenticated;

commit;
