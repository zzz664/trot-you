-- Fan community database foundation. No runtime policy defaults, points,
-- uploader, signed URLs, notification delivery or reply-report support.
begin;

create type public.report_target as enum ('post', 'comment', 'reply');
create type public.report_status as enum ('open', 'hidden', 'restored', 'deleted');
create table private.community_policy (
  singleton boolean primary key default true check (singleton),
  version text not null check (btrim(version) <> '' and length(version) <= 100),
  max_title_length integer not null check (max_title_length between 1 and 1000),
  max_body_length integer not null check (max_body_length between 1 and 100000),
  max_comment_length integer not null check (max_comment_length between 1 and 10000),
  max_reason_length integer not null check (max_reason_length between 1 and 10000),
  max_images integer not null check (max_images between 0 and 100),
  max_image_bytes bigint not null check (max_image_bytes between 1 and 10485760),
  max_image_long_edge integer not null check (max_image_long_edge between 1 and 100000),
  auto_hide_report_count integer not null check (auto_hide_report_count between 1 and 100000),
  rate_window_seconds integer not null check (rate_window_seconds between 1 and 86400),
  max_contributions_per_window integer not null check (max_contributions_per_window between 1 and 10000),
  max_reports_per_window integer not null check (max_reports_per_window between 1 and 10000),
  forbidden_terms text[] not null,
  forbidden_patterns text[] not null,
  check (cardinality(forbidden_terms) <= 1000 and array_position(forbidden_terms, null) is null),
  check (cardinality(forbidden_patterns) <= 100 and array_position(forbidden_patterns, null) is null)
);
create table private.community_rate_limits (
  user_id uuid primary key references public.profiles(id) on delete restrict,
  started_at timestamptz not null,
  contributions integer not null default 0 check (contributions >= 0),
  reports integer not null default 0 check (reports >= 0)
);
create table public.posts (
  id uuid primary key default gen_random_uuid(),
  artist_id uuid not null references public.artists(id) on delete restrict,
  user_id uuid not null references public.profiles(id) on delete restrict,
  request_id uuid not null,
  title text not null check (btrim(title) <> '' and length(title) <= 1000),
  body text not null check (btrim(body) <> '' and length(body) <= 100000),
  is_notice boolean not null default false,
  is_pinned boolean not null default false check (not is_pinned or is_notice),
  is_hidden boolean not null default false,
  report_count integer not null default 0 check (report_count >= 0),
  like_count integer not null default 0 check (like_count >= 0),
  comment_count integer not null default 0 check (comment_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz check (deleted_at is null or isfinite(deleted_at)),
  unique (user_id, request_id)
);
create index posts_board_idx on public.posts(artist_id, is_pinned desc, created_at desc, id desc)
  where deleted_at is null and not is_hidden;
create index posts_owner_idx on public.posts(user_id, created_at desc, id desc);
create trigger posts_updated_at before update on public.posts
  for each row execute function private.touch_updated_at();
create table public.comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete restrict,
  user_id uuid not null references public.profiles(id) on delete restrict,
  request_id uuid not null,
  body text not null check (btrim(body) <> '' and length(body) <= 10000),
  is_hidden boolean not null default false,
  report_count integer not null default 0 check (report_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz check (deleted_at is null or isfinite(deleted_at)),
  unique (user_id, request_id)
);
create index comments_post_idx on public.comments(post_id, created_at, id);
create index comments_owner_idx on public.comments(user_id, created_at desc, id desc);
create trigger comments_updated_at before update on public.comments
  for each row execute function private.touch_updated_at();
create table public.post_likes (
  post_id uuid not null references public.posts(id) on delete restrict,
  user_id uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);
create index post_likes_user_idx on public.post_likes(user_id, post_id);
create table public.reports (
  id uuid primary key default gen_random_uuid(),
  target_type public.report_target not null check (target_type <> 'reply'),
  target_id uuid not null,
  reporter_id uuid not null references public.profiles(id) on delete restrict,
  reason text not null check (btrim(reason) <> '' and length(reason) <= 10000),
  status public.report_status not null default 'open',
  resolved_by uuid references public.profiles(id) on delete restrict,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  unique (target_type, target_id, reporter_id),
  check ((status in ('open', 'hidden') and resolved_by is null and resolved_at is null) or
    (status in ('restored', 'deleted') and resolved_by is not null and resolved_at is not null))
);
create index reports_reporter_idx on public.reports(reporter_id, created_at desc, id desc);
create index reports_pending_idx on public.reports(target_type, target_id) where status in ('open', 'hidden');
create table public.community_moderation_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references public.profiles(id) on delete restrict,
  target_type text not null check (target_type in ('post', 'comment', 'user')),
  target_id uuid not null,
  action text not null check (action in ('hide', 'restore', 'delete', 'notice', 'restrict', 'unrestrict')),
  reason text not null check (btrim(reason) <> '' and length(reason) <= 10000),
  created_at timestamptz not null default now()
);
create index community_moderation_target_idx on public.community_moderation_log(target_type, target_id, created_at desc);
create index community_moderation_actor_idx on public.community_moderation_log(actor_id);
create table public.post_images (
  id uuid primary key,
  post_id uuid not null references public.posts(id) on delete restrict,
  storage_object_id uuid not null unique references storage.objects(id) on delete restrict,
  bucket_id text not null check (bucket_id = 'board-media'),
  object_path text not null unique,
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  byte_size bigint not null check (byte_size between 1 and 10485760),
  width integer not null check (width between 1 and 100000),
  height integer not null check (height between 1 and 100000),
  created_at timestamptz not null default now()
);
create index post_images_post_idx on public.post_images(post_id, created_at, id);

alter table private.community_policy enable row level security;
alter table private.community_rate_limits enable row level security;
alter table public.posts enable row level security;
alter table public.comments enable row level security;
alter table public.post_likes enable row level security;
alter table public.reports enable row level security;
alter table public.post_images enable row level security;
alter table public.community_moderation_log enable row level security;
revoke all on private.community_policy, private.community_rate_limits, public.posts,
  public.comments, public.post_likes, public.reports, public.post_images,
  public.community_moderation_log from public, anon, authenticated, service_role;
grant select, insert, update on private.community_policy to service_role;
grant select on public.posts, public.comments, public.post_likes, public.reports,
  public.community_moderation_log to authenticated, service_role;
grant select on public.post_images to service_role;
-- Do not expose Storage locator columns, even to client-side administrators.
grant select (id, post_id, mime_type, byte_size, width, height, created_at)
  on public.post_images to authenticated;

create function private.get_community_policy() returns private.community_policy
language plpgsql stable security definer set search_path = '' as $$
declare cfg private.community_policy%rowtype;
begin
  select * into cfg from private.community_policy where singleton;
  if not found then raise exception 'COMMUNITY_POLICY_REQUIRED' using errcode = '55000'; end if;
  return cfg;
end;
$$;
create function private.community_actor_allowed(p_actor uuid, p_at timestamptz)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p where p.id = p_actor
    and (p.role <> 'fan' or p.onboarding_completed_at is not null)
    and not (p.is_restricted and (p.restricted_until is null or p.restricted_until > p_at)));
$$;
create function private.community_is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
    and private.community_actor_allowed(auth.uid(), statement_timestamp());
$$;
create function private.community_can_read_post(p_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.community_actor_allowed(auth.uid(), statement_timestamp()) and exists (
    select 1 from public.posts p join public.artists a on a.id = p.artist_id
    where p.id = p_id and (private.community_is_admin() or (a.status = 'active' and
      (p.user_id = auth.uid() or (not p.is_hidden and p.deleted_at is null)))));
$$;
create function private.community_can_read_comment(p_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.community_actor_allowed(auth.uid(), statement_timestamp()) and exists (
    select 1 from public.comments c join public.posts p on p.id = c.post_id
    join public.artists a on a.id = p.artist_id where c.id = p_id and
      (private.community_is_admin() or (a.status = 'active' and
        (c.user_id = auth.uid() or (not c.is_hidden and c.deleted_at is null
          and not p.is_hidden and p.deleted_at is null)))));
$$;
create policy posts_read on public.posts for select to authenticated
  using (private.community_can_read_post(id));
create policy comments_read on public.comments for select to authenticated
  using (private.community_can_read_comment(id));
create policy post_likes_read on public.post_likes for select to authenticated
  using (private.community_is_admin() or (user_id = auth.uid() and private.community_can_read_post(post_id)));
create policy reports_read on public.reports for select to authenticated
  using (private.community_is_admin() or (reporter_id = auth.uid()
    and private.community_actor_allowed(auth.uid(), statement_timestamp())));
create policy post_images_read on public.post_images for select to authenticated
  using (private.community_can_read_post(post_id));
create policy community_moderation_read on public.community_moderation_log for select to authenticated
  using (private.community_is_admin());

-- A profile UPDATE lock serializes per-actor idempotency and rate accounting;
-- artist SHARE -> post UPDATE -> comment UPDATE serializes resource transitions.
-- Authorization is checked AFTER lock acquisition against a fresh wall clock.
create function private.require_community_actor(p_actor uuid, p_admin boolean default false)
returns public.profiles language plpgsql set search_path = '' as $$
declare actor public.profiles%rowtype;
begin
  select * into actor from public.profiles where id = p_actor for update;
  if actor.id is null or (p_admin and actor.role <> 'admin')
    or (actor.role = 'fan' and actor.onboarding_completed_at is null) or
    (actor.is_restricted and (actor.restricted_until is null or actor.restricted_until > clock_timestamp())) then
    raise exception 'COMMUNITY_FORBIDDEN' using errcode = '42501';
  end if;
  return actor;
end;
$$;
create function private.require_community_artist(p_id uuid, p_allow_inactive boolean default false)
returns void language plpgsql set search_path = '' as $$
begin
  perform 1 from public.artists where id = p_id and (p_allow_inactive or status = 'active') for share;
  if not found then raise exception 'COMMUNITY_BOARD_UNAVAILABLE' using errcode = '42501'; end if;
end;
$$;
create function private.lock_community_post(p_id uuid, p_allow_inactive boolean default false)
returns public.posts language plpgsql set search_path = '' as $$
declare p public.posts%rowtype;
begin
  select * into p from public.posts where id = p_id;
  perform private.require_community_artist(p.artist_id, p_allow_inactive);
  select * into p from public.posts where id = p_id for update;
  if p.id is null then raise exception 'COMMUNITY_TARGET_UNAVAILABLE' using errcode = '42501'; end if;
  return p;
end;
$$;
create function private.validate_community_text(p_text text, p_max integer, p_cfg private.community_policy)
returns void language plpgsql immutable set search_path = '' as $$
declare term text;
begin
  if p_text is null or p_text !~ '[^[:space:]]' or length(p_text) > p_max or p_text ~ '[\x00-\x08\x0B\x0C\x0E-\x1F]' then
    raise exception 'COMMUNITY_CONTENT_INVALID' using errcode = '23514';
  end if;
  foreach term in array p_cfg.forbidden_terms loop
    if btrim(term) = '' or length(term) > 1000 then raise exception 'COMMUNITY_POLICY_INVALID' using errcode = '55000'; end if;
    if strpos(lower(p_text), lower(term)) > 0 then raise exception 'COMMUNITY_CONTENT_BLOCKED' using errcode = '23514'; end if;
  end loop;
  foreach term in array p_cfg.forbidden_patterns loop
    if btrim(term) = '' or length(term) > 1000 then raise exception 'COMMUNITY_POLICY_INVALID' using errcode = '55000'; end if;
    if p_text ~* term then raise exception 'COMMUNITY_CONTENT_BLOCKED' using errcode = '23514'; end if;
  end loop;
end;
$$;
create function private.claim_community_rate(p_actor uuid, p_report boolean, p_cfg private.community_policy)
returns void language plpgsql set search_path = '' as $$
declare r private.community_rate_limits%rowtype; stamp timestamptz := clock_timestamp();
begin
  insert into private.community_rate_limits(user_id, started_at) values (p_actor, stamp)
    on conflict (user_id) do nothing;
  select * into r from private.community_rate_limits where user_id = p_actor for update;
  if r.started_at + make_interval(secs => p_cfg.rate_window_seconds) <= stamp then
    r.contributions := 0; r.reports := 0; r.started_at := stamp;
  end if;
  if (p_report and r.reports >= p_cfg.max_reports_per_window) or
    (not p_report and r.contributions >= p_cfg.max_contributions_per_window) then
    raise exception 'COMMUNITY_RATE_LIMITED' using errcode = '54000';
  end if;
  update private.community_rate_limits set started_at = r.started_at,
    contributions = r.contributions + case when p_report then 0 else 1 end,
    reports = r.reports + case when p_report then 1 else 0 end where user_id = p_actor;
end;
$$;

create function public.community_create_post(p_artist_id uuid, p_request_id uuid, p_title text, p_body text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); cfg private.community_policy%rowtype; p public.posts%rowtype;
begin
  perform private.require_community_actor(actor);
  perform private.require_community_artist(p_artist_id);
  cfg := private.get_community_policy();
  if p_request_id is null then raise exception 'COMMUNITY_REQUEST_REQUIRED' using errcode = '22004'; end if;
  select * into p from public.posts where user_id = actor and request_id = p_request_id;
  if found then
    if p.artist_id <> p_artist_id or p.title <> p_title or p.body <> p_body or p_title is null or p_body is null then
      raise exception 'COMMUNITY_IDEMPOTENCY_CONFLICT' using errcode = '23514';
    end if;
    return p.id;
  end if;
  perform private.validate_community_text(p_title, cfg.max_title_length, cfg);
  perform private.validate_community_text(p_body, cfg.max_body_length, cfg);
  perform private.claim_community_rate(actor, false, cfg);
  insert into public.posts(artist_id, user_id, request_id, title, body)
    values (p_artist_id, actor, p_request_id, p_title, p_body) returning id into p.id;
  return p.id;
end;
$$;
create function public.community_update_post(p_post_id uuid, p_title text, p_body text)
returns void language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); cfg private.community_policy%rowtype; p public.posts%rowtype;
begin
  perform private.require_community_actor(actor);
  p := private.lock_community_post(p_post_id);
  if p.user_id <> actor or p.is_hidden or p.deleted_at is not null
    or (p.is_notice and not private.community_is_admin()) then
    raise exception 'COMMUNITY_TARGET_UNAVAILABLE' using errcode = '42501';
  end if;
  cfg := private.get_community_policy();
  perform private.validate_community_text(p_title, cfg.max_title_length, cfg);
  perform private.validate_community_text(p_body, cfg.max_body_length, cfg);
  if p.title = p_title and p.body = p_body then return; end if;
  perform private.claim_community_rate(actor, false, cfg);
  update public.posts set title = p_title, body = p_body where id = p_post_id;
end;
$$;
create function public.community_create_comment(p_post_id uuid, p_request_id uuid, p_body text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); cfg private.community_policy%rowtype; p public.posts%rowtype; c public.comments%rowtype;
begin
  perform private.require_community_actor(actor);
  p := private.lock_community_post(p_post_id);
  if p.is_hidden or p.deleted_at is not null then raise exception 'COMMUNITY_TARGET_UNAVAILABLE' using errcode = '42501'; end if;
  cfg := private.get_community_policy();
  if p_request_id is null then raise exception 'COMMUNITY_REQUEST_REQUIRED' using errcode = '22004'; end if;
  select * into c from public.comments where user_id = actor and request_id = p_request_id;
  if found then
    if c.post_id <> p_post_id or c.body <> p_body or p_body is null then
      raise exception 'COMMUNITY_IDEMPOTENCY_CONFLICT' using errcode = '23514';
    end if;
    return c.id;
  end if;
  perform private.validate_community_text(p_body, cfg.max_comment_length, cfg);
  perform private.claim_community_rate(actor, false, cfg);
  insert into public.comments(post_id, user_id, request_id, body)
    values (p_post_id, actor, p_request_id, p_body) returning id into c.id;
  update public.posts set comment_count = comment_count + 1 where id = p_post_id;
  return c.id;
end;
$$;
create function public.community_update_comment(p_comment_id uuid, p_body text)
returns void language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); cfg private.community_policy%rowtype; p public.posts%rowtype; c public.comments%rowtype;
begin
  perform private.require_community_actor(actor);
  select * into c from public.comments where id = p_comment_id;
  p := private.lock_community_post(c.post_id);
  select * into c from public.comments where id = p_comment_id for update;
  if c.id is null or c.user_id <> actor or c.is_hidden or c.deleted_at is not null or p.is_hidden or p.deleted_at is not null then
    raise exception 'COMMUNITY_TARGET_UNAVAILABLE' using errcode = '42501';
  end if;
  cfg := private.get_community_policy();
  perform private.validate_community_text(p_body, cfg.max_comment_length, cfg);
  if c.body = p_body then return; end if;
  perform private.claim_community_rate(actor, false, cfg);
  update public.comments set body = p_body where id = p_comment_id;
end;
$$;
create function public.community_set_like(p_post_id uuid, p_liked boolean)
returns boolean language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); p public.posts%rowtype; changed integer;
begin
  perform private.require_community_actor(actor);
  p := private.lock_community_post(p_post_id);
  if p.is_hidden or p.deleted_at is not null then raise exception 'COMMUNITY_TARGET_UNAVAILABLE' using errcode = '42501'; end if;
  if p_liked is null then raise exception 'COMMUNITY_LIKE_REQUIRED' using errcode = '22004'; end if;
  if p_liked then
    insert into public.post_likes(post_id, user_id) values (p_post_id, actor) on conflict do nothing;
    get diagnostics changed = row_count;
    update public.posts set like_count = like_count + changed where id = p_post_id;
  else
    delete from public.post_likes where post_id = p_post_id and user_id = actor;
    get diagnostics changed = row_count;
    update public.posts set like_count = like_count - changed where id = p_post_id;
  end if;
  return p_liked;
end;
$$;

-- Reports preserve lifetime distinct counts. Only unresolved reports participate
-- in each auto-hide cycle; a restore resolves that cycle without allowing the
-- same person to report the same target again.
create function public.community_report(p_target_type public.report_target, p_target_id uuid, p_reason text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); cfg private.community_policy%rowtype; p public.posts%rowtype;
  c public.comments%rowtype; report_id uuid; pending_count integer; owner_id uuid;
begin
  perform private.require_community_actor(actor);
  if p_target_type = 'reply' then raise exception 'COMMUNITY_REPLY_REPORT_UNSUPPORTED' using errcode = '0A000'; end if;
  if p_target_type is null then raise exception 'COMMUNITY_TARGET_REQUIRED' using errcode = '22004'; end if;
  if p_target_type = 'comment' then
    select * into c from public.comments where id = p_target_id;
    p := private.lock_community_post(c.post_id);
    select * into c from public.comments where id = p_target_id for update;
    owner_id := c.user_id;
  else
    p := private.lock_community_post(p_target_id); owner_id := p.user_id;
  end if;
  -- An existing reporter may retrieve ONLY their immutable report ID even after
  -- the report they filed hid/deleted the target. No body or new access is given.
  select id into report_id from public.reports where target_type = p_target_type
    and target_id = p_target_id and reporter_id = actor;
  if found then return report_id; end if;
  if p.is_hidden or p.deleted_at is not null or owner_id = actor or
    (p_target_type = 'comment' and (c.id is null or c.is_hidden or c.deleted_at is not null)) then
    raise exception 'COMMUNITY_TARGET_UNAVAILABLE' using errcode = '42501';
  end if;
  cfg := private.get_community_policy();
  perform private.validate_community_text(p_reason, cfg.max_reason_length, cfg);
  perform private.claim_community_rate(actor, true, cfg);
  insert into public.reports(target_type, target_id, reporter_id, reason)
    values (p_target_type, p_target_id, actor, p_reason) returning id into report_id;
  select count(*) into pending_count from public.reports where target_type = p_target_type
    and target_id = p_target_id and status in ('open', 'hidden');
  if p_target_type = 'post' then
    update public.posts set report_count = report_count + 1,
      is_hidden = is_hidden or pending_count >= cfg.auto_hide_report_count where id = p_target_id;
  else
    update public.comments set report_count = report_count + 1,
      is_hidden = is_hidden or pending_count >= cfg.auto_hide_report_count where id = p_target_id;
    if pending_count >= cfg.auto_hide_report_count then
      update public.posts set comment_count = comment_count - 1 where id = p.id;
    end if;
  end if;
  if pending_count >= cfg.auto_hide_report_count then
    update public.reports set status = 'hidden' where target_type = p_target_type
      and target_id = p_target_id and status = 'open';
  end if;
  return report_id;
end;
$$;

create function private.community_change_visibility(p_actor uuid, p_target_type public.report_target,
  p_target_id uuid, p_decision text, p_reason text, p_admin boolean)
returns void language plpgsql set search_path = '' as $$
declare p public.posts%rowtype; c public.comments%rowtype; was_visible boolean; now_visible boolean;
  deleted timestamptz; owner_id uuid; stamp timestamptz;
begin
  if p_target_type = 'reply' then raise exception 'COMMUNITY_REPLY_REPORT_UNSUPPORTED' using errcode = '0A000'; end if;
  if p_target_type is null then raise exception 'COMMUNITY_TARGET_REQUIRED' using errcode = '22004'; end if;
  if p_decision is null or p_decision not in ('hide', 'restore', 'delete') then
    raise exception 'COMMUNITY_DECISION_INVALID' using errcode = '23514';
  end if;
  if p_reason is null or p_reason !~ '[^[:space:]]' or length(p_reason) > 10000 then
    raise exception 'COMMUNITY_CONTENT_INVALID' using errcode = '23514';
  end if;
  if p_target_type = 'comment' then
    select * into c from public.comments where id = p_target_id;
    p := private.lock_community_post(c.post_id, p_admin);
    select * into c from public.comments where id = p_target_id for update;
    if c.id is null then raise exception 'COMMUNITY_TARGET_UNAVAILABLE' using errcode = '42501'; end if;
    owner_id := c.user_id; deleted := c.deleted_at;
    was_visible := not c.is_hidden and c.deleted_at is null;
  else
    p := private.lock_community_post(p_target_id, p_admin);
    owner_id := p.user_id; deleted := p.deleted_at;
  end if;
  if not p_admin and (owner_id <> p_actor or p_decision <> 'delete') then
    raise exception 'COMMUNITY_TARGET_UNAVAILABLE' using errcode = '42501';
  end if;
  if deleted is not null then
    if p_decision = 'delete' then return; end if;
    raise exception 'COMMUNITY_DELETED_TERMINAL' using errcode = '55000';
  end if;
  stamp := clock_timestamp();
  if p_target_type = 'post' then
    update public.posts set is_hidden = p_decision <> 'restore',
      deleted_at = case when p_decision = 'delete' then stamp end,
      is_pinned = case when p_decision = 'delete' then false else is_pinned end where id = p_target_id;
  else
    now_visible := p_decision = 'restore';
    update public.comments set is_hidden = not now_visible,
      deleted_at = case when p_decision = 'delete' then stamp end where id = p_target_id;
    update public.posts set comment_count = comment_count + now_visible::integer - was_visible::integer where id = p.id;
  end if;
  if p_decision = 'hide' then
    update public.reports set status = 'hidden' where target_type = p_target_type and target_id = p_target_id and status = 'open';
  else
    update public.reports set status = (case when p_decision = 'restore' then 'restored' else 'deleted' end)::public.report_status,
      resolved_by = p_actor, resolved_at = stamp where target_type = p_target_type and target_id = p_target_id
      and (status in ('open', 'hidden') or p_decision = 'delete');
  end if;
  insert into public.community_moderation_log(actor_id, target_type, target_id, action, reason)
    values (p_actor, p_target_type::text, p_target_id, p_decision, p_reason);
end;
$$;
create function public.community_delete(p_target_type public.report_target, p_target_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare actor public.profiles%rowtype;
begin
  actor := private.require_community_actor(auth.uid());
  perform private.community_change_visibility(actor.id, p_target_type, p_target_id, 'delete', 'owner-or-admin-delete', actor.role = 'admin');
end;
$$;
create function public.community_moderate(p_target_type public.report_target, p_target_id uuid, p_decision text, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_community_actor(auth.uid(), true);
  perform private.community_change_visibility(auth.uid(), p_target_type, p_target_id, p_decision, p_reason, true);
end;
$$;
create function public.community_set_notice(p_post_id uuid, p_is_notice boolean, p_is_pinned boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare p public.posts%rowtype;
begin
  perform private.require_community_actor(auth.uid(), true);
  p := private.lock_community_post(p_post_id);
  if p.deleted_at is not null or p_is_notice is null or p_is_pinned is null or (p_is_pinned and not p_is_notice) then
    raise exception 'COMMUNITY_NOTICE_INVALID' using errcode = '23514';
  end if;
  if p.is_notice = p_is_notice and p.is_pinned = p_is_pinned then return; end if;
  update public.posts set is_notice = p_is_notice, is_pinned = p_is_pinned where id = p_post_id;
  insert into public.community_moderation_log(actor_id, target_type, target_id, action, reason)
    values (auth.uid(), 'post', p_post_id, 'notice', jsonb_build_object('notice', p_is_notice, 'pinned', p_is_pinned)::text);
end;
$$;
create function public.community_restrict_user(p_user_id uuid, p_restricted boolean, p_until timestamptz, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare actor public.profiles%rowtype; target public.profiles%rowtype;
begin
  -- Deterministic multi-profile order avoids reciprocal restriction lock cycles.
  perform 1 from public.profiles where id in (auth.uid(), p_user_id) order by id for update;
  actor := private.require_community_actor(auth.uid(), true);
  select * into target from public.profiles where id = p_user_id;
  if target.id is null or target.role = 'admin' or target.id = actor.id then
    raise exception 'COMMUNITY_RESTRICTION_TARGET_FORBIDDEN' using errcode = '42501';
  end if;
  if p_restricted is null or (p_restricted and (p_until is null or not isfinite(p_until) or p_until <= clock_timestamp()))
    or (not p_restricted and p_until is not null) then
    raise exception 'COMMUNITY_RESTRICTION_INVALID' using errcode = '23514';
  end if;
  if p_reason is null or p_reason !~ '[^[:space:]]' or length(p_reason) > 10000 then
    raise exception 'COMMUNITY_CONTENT_INVALID' using errcode = '23514';
  end if;
  update public.profiles set is_restricted = p_restricted, restricted_until = p_until where id = p_user_id;
  insert into public.community_moderation_log(actor_id, target_type, target_id, action, reason)
    values (actor.id, 'user', p_user_id, case when p_restricted then 'restrict' else 'unrestrict' end, p_reason);
end;
$$;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('board-media', 'board-media', false, 10485760, array['image/jpeg', 'image/png', 'image/webp']);
create policy board_media_no_client_bucket on storage.buckets as restrictive for all to anon, authenticated
  using (id <> 'board-media') with check (id <> 'board-media');
create policy board_media_no_client_select on storage.objects as restrictive for select to anon, authenticated
  using (bucket_id <> 'board-media');
create policy board_media_no_client_insert on storage.objects as restrictive for insert to anon, authenticated
  with check (bucket_id <> 'board-media');
create policy board_media_no_client_update on storage.objects as restrictive for update to anon, authenticated
  using (bucket_id <> 'board-media') with check (bucket_id <> 'board-media');
create policy board_media_no_client_delete on storage.objects as restrictive for delete to anon, authenticated
  using (bucket_id <> 'board-media');
create function public.community_register_image(p_actor_id uuid, p_post_id uuid, p_image_id uuid,
  p_storage_object_id uuid, p_width integer, p_height integer)
returns uuid language plpgsql security definer set search_path = '' as $$
declare p public.posts%rowtype; cfg private.community_policy%rowtype; o storage.objects%rowtype;
  i public.post_images%rowtype; mime text; ext text; bytes bigint;
begin
  if current_setting('role', true) is distinct from 'service_role' then
    raise exception 'COMMUNITY_SERVICE_REQUIRED' using errcode = '42501';
  end if;
  perform private.require_community_actor(p_actor_id);
  p := private.lock_community_post(p_post_id);
  if p.user_id <> p_actor_id or p.is_hidden or p.deleted_at is not null
    or (p.is_notice and not exists (select 1 from public.profiles where id = p_actor_id and role = 'admin')) then
    raise exception 'COMMUNITY_TARGET_UNAVAILABLE' using errcode = '42501';
  end if;
  cfg := private.get_community_policy();
  select * into o from storage.objects where id = p_storage_object_id for share;
  mime := o.metadata ->> 'mimetype';
  ext := case mime when 'image/jpeg' then 'jpg' when 'image/png' then 'png' when 'image/webp' then 'webp' end;
  if o.id is null or p_image_id is null or o.bucket_id <> 'board-media' or ext is null
    or o.name <> p.artist_id::text || '/' || p.id::text || '/' || p_image_id::text || '.' || ext
    or jsonb_typeof(o.metadata -> 'size') is distinct from 'number'
    or (o.metadata ->> 'size') !~ '^[0-9]{1,8}$'
    or p_width is null or p_height is null or p_width < 1 or p_height < 1
    or greatest(p_width, p_height) > cfg.max_image_long_edge then
    raise exception 'COMMUNITY_IMAGE_INVALID' using errcode = '23514';
  end if;
  bytes := (o.metadata ->> 'size')::bigint;
  if bytes < 1 or bytes > cfg.max_image_bytes then raise exception 'COMMUNITY_IMAGE_INVALID' using errcode = '23514'; end if;
  select * into i from public.post_images where id = p_image_id;
  if found then
    if i.post_id <> p_post_id or i.storage_object_id <> p_storage_object_id or i.width <> p_width or i.height <> p_height
      or i.mime_type <> mime or i.byte_size <> bytes or i.object_path <> o.name then
      raise exception 'COMMUNITY_IDEMPOTENCY_CONFLICT' using errcode = '23514';
    end if;
    return i.id;
  end if;
  if (select count(*) from public.post_images where post_id = p_post_id) >= cfg.max_images then
    raise exception 'COMMUNITY_IMAGE_LIMIT' using errcode = '23514';
  end if;
  insert into public.post_images(id, post_id, storage_object_id, bucket_id, object_path, mime_type, byte_size, width, height)
    values (p_image_id, p_post_id, p_storage_object_id, o.bucket_id, o.name, mime, bytes, p_width, p_height);
  return p_image_id;
end;
$$;

-- Explicit allowlist: never let a new definer function inherit PUBLIC EXECUTE.
revoke all on function private.get_community_policy(), private.community_actor_allowed(uuid,timestamptz),
  private.community_is_admin(), private.community_can_read_post(uuid), private.community_can_read_comment(uuid),
  private.require_community_actor(uuid,boolean), private.require_community_artist(uuid,boolean),
  private.lock_community_post(uuid,boolean), private.validate_community_text(text,integer,private.community_policy),
  private.claim_community_rate(uuid,boolean,private.community_policy),
  private.community_change_visibility(uuid,public.report_target,uuid,text,text,boolean)
  from public, anon, authenticated, service_role;
grant execute on function private.community_is_admin(), private.community_can_read_post(uuid),
  private.community_can_read_comment(uuid) to authenticated;
-- RLS report policy uses this only with auth.uid(); keep its arbitrary-actor form
-- private by wrapping the caller check rather than exposing an identity oracle.
create function private.community_current_actor_allowed() returns boolean
language sql stable security definer set search_path = '' as $$
  select private.community_actor_allowed(auth.uid(), statement_timestamp());
$$;
revoke all on function private.community_current_actor_allowed() from public, anon, authenticated, service_role;
grant execute on function private.community_current_actor_allowed() to authenticated;
alter policy reports_read on public.reports using (private.community_is_admin() or
  (reporter_id = auth.uid() and private.community_current_actor_allowed()));
revoke all on function public.community_create_post(uuid,uuid,text,text), public.community_update_post(uuid,text,text),
  public.community_create_comment(uuid,uuid,text), public.community_update_comment(uuid,text),
  public.community_set_like(uuid,boolean), public.community_report(public.report_target,uuid,text),
  public.community_delete(public.report_target,uuid), public.community_moderate(public.report_target,uuid,text,text),
  public.community_set_notice(uuid,boolean,boolean), public.community_restrict_user(uuid,boolean,timestamptz,text),
  public.community_register_image(uuid,uuid,uuid,uuid,integer,integer)
  from public, anon, authenticated, service_role;
grant execute on function public.community_create_post(uuid,uuid,text,text), public.community_update_post(uuid,text,text),
  public.community_create_comment(uuid,uuid,text), public.community_update_comment(uuid,text),
  public.community_set_like(uuid,boolean), public.community_report(public.report_target,uuid,text),
  public.community_delete(public.report_target,uuid), public.community_moderate(public.report_target,uuid,text,text),
  public.community_set_notice(uuid,boolean,boolean), public.community_restrict_user(uuid,boolean,timestamptz,text)
  to authenticated;
grant execute on function public.community_register_image(uuid,uuid,uuid,uuid,integer,integer) to service_role;

comment on type public.report_target is 'reply is reserved but explicitly unsupported by this foundation; every reply report/moderation RPC fails with 0A000.';
comment on column public.posts.comment_count is 'Number of nonhidden, nondeleted comments, independent of parent visibility. Parent deletion never physically removes comments.';
comment on column public.posts.report_count is 'Lifetime distinct reporters. Restore resolves pending reports; only new distinct reporters contribute to the next auto-hide cycle.';
comment on table public.post_images is 'Verified metadata only. No uploader, byte inspection or signed URL authority. Storage locators are service-only.';
commit;
