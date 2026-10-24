-- Private, nonmonetary attendance/contribution ledger. No approved policy is
-- seeded; share verification, missions and the activity-grade formula are unset.
begin;

create type public.point_reason as enum ('attendance', 'post', 'comment', 'admin_adjust');
create table private.point_policy (
  singleton boolean primary key default true check (singleton),
  version text not null check (version ~ '[^[:space:]]' and length(version) <= 100),
  attendance_amount bigint not null check (attendance_amount between 0 and 9007199254740991),
  post_amount bigint not null check (post_amount between 0 and 9007199254740991),
  comment_amount bigint not null check (comment_amount between 0 and 9007199254740991),
  -- NULL means no daily cap; only a configured integer limits reward count.
  post_daily_cap integer check (post_daily_cap >= 0),
  comment_daily_cap integer check (comment_daily_cap >= 0),
  -- Only retained historical awards are supported. Activation must explicitly
  -- approve this treatment; no automatic clawback or monetary assumption.
  deleted_content_treatment text not null check (deleted_content_treatment = 'retain')
);
create table private.point_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete restrict,
  amount bigint not null check (amount between -9007199254740991 and 9007199254740991),
  reason public.point_reason not null,
  ref_id text not null check (ref_id ~ '[^[:space:]]' and length(ref_id) <= 100),
  earned_on date not null check (isfinite(earned_on)),
  policy_version text not null check (policy_version ~ '[^[:space:]]' and length(policy_version) <= 100),
  policy_snapshot jsonb not null check (jsonb_typeof(policy_snapshot) = 'object'),
  actor_id uuid not null references public.profiles(id) on delete restrict,
  adjustment_note text,
  post_id uuid references public.posts(id) on delete restrict,
  comment_id uuid references public.comments(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp() check (isfinite(created_at)),
  unique (user_id, reason, ref_id),
  check ((reason = 'admin_adjust' and amount <> 0 and adjustment_note ~ '[^[:space:]]'
      and length(adjustment_note) <= 1000 and adjustment_note is not null)
    or (reason <> 'admin_adjust' and amount >= 0 and adjustment_note is null and actor_id = user_id)),
  check ((reason = 'post' and post_id is not null and comment_id is null and ref_id = post_id::text)
    or (reason = 'comment' and comment_id is not null and post_id is null and ref_id = comment_id::text)
    or (reason in ('attendance', 'admin_adjust') and post_id is null and comment_id is null))
);
create unique index point_correction_request_idx on private.point_ledger(actor_id, ref_id)
  where reason = 'admin_adjust';
create index point_ledger_history_idx on private.point_ledger(user_id, created_at desc, id desc);
create index point_ledger_day_idx on private.point_ledger(user_id, reason, earned_on);
create index point_ledger_post_idx on private.point_ledger(post_id) where post_id is not null;
create index point_ledger_comment_idx on private.point_ledger(comment_id) where comment_id is not null;
create index point_ledger_actor_idx on private.point_ledger(actor_id);
alter table private.point_policy enable row level security;
alter table private.point_ledger enable row level security;
revoke all on private.point_policy, private.point_ledger from public, anon, authenticated, service_role;
-- Trusted configuration writer only; no authenticated administrator policy API.
-- This enables explicit activation/deactivation, never client-supplied rewards.
grant select, insert, update, delete on private.point_policy to service_role;

create function private.point_kst_date(p_at timestamptz) returns date
language sql immutable strict set search_path = '' as $$
  select (p_at at time zone 'Asia/Seoul')::date;
$$;
create function private.point_ledger_immutable() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'POINT_LEDGER_IMMUTABLE' using errcode = '55000';
end;
$$;
create trigger point_ledger_no_mutation before update or delete on private.point_ledger
  for each row execute function private.point_ledger_immutable();
create trigger point_ledger_no_truncate before truncate on private.point_ledger
  for each statement execute function private.point_ledger_immutable();

-- Caller must hold user profile UPDATE lock; all exposed writers do so. Numeric
-- SUM avoids bigint overflow; the JSON-safe bound is structural, not a reward cap.
create function private.append_point_entry(p_user uuid, p_amount bigint,
  p_reason public.point_reason, p_ref text, p_day date, p_version text,
  p_actor uuid, p_note text default null, p_post uuid default null, p_comment uuid default null,
  p_policy jsonb default '{"kind":"admin_adjust"}'::jsonb)
returns uuid language plpgsql set search_path = '' as $$
declare balance numeric; entry_id uuid;
begin
  select coalesce(sum(amount), 0) into balance from private.point_ledger where user_id = p_user;
  if p_amount is null or balance + p_amount < 0 or balance + p_amount > 9007199254740991 then
    raise exception 'POINT_BALANCE_OUT_OF_RANGE' using errcode = '22003';
  end if;
  insert into private.point_ledger(user_id,amount,reason,ref_id,earned_on,policy_version,actor_id,
    adjustment_note,post_id,comment_id,policy_snapshot)
    values(p_user,p_amount,p_reason,p_ref,p_day,p_version,p_actor,p_note,p_post,p_comment,p_policy)
    returning id into entry_id;
  return entry_id;
end;
$$;

create function public.point_check_attendance() returns uuid
language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); day date; entry_id uuid; cfg private.point_policy%rowtype;
begin
  perform private.require_community_actor(actor);
  -- Capture real database time AFTER obtaining the actor lock, not transaction
  -- start or caller-provided time. Session timezone cannot change the KST day.
  day := private.point_kst_date(clock_timestamp());
  select id into entry_id from private.point_ledger where user_id=actor
    and reason='attendance' and ref_id=to_char(day,'YYYY-MM-DD');
  if found then return entry_id; end if;
  select * into cfg from private.point_policy where singleton for share;
  if not found then raise exception 'POINT_POLICY_UNCONFIGURED' using errcode = '55000'; end if;
  -- Re-evaluate after a possible policy-lock wait across midnight.
  day := private.point_kst_date(clock_timestamp());
  select id into entry_id from private.point_ledger where user_id=actor
    and reason='attendance' and ref_id=to_char(day,'YYYY-MM-DD');
  if found then return entry_id; end if;
  return private.append_point_entry(actor,cfg.attendance_amount,'attendance',to_char(day,'YYYY-MM-DD'),
    day,cfg.version,actor,p_policy=>to_jsonb(cfg)-'singleton');
end;
$$;

-- Only newly persisted, actor-owned community creations qualify. A replay of
-- the existing creation RPC returns its old ID and never fires this INSERT
-- trigger. No arbitrary reference/claim API, backfill, queue or double credit.
create function private.reward_community_creation() returns trigger
language plpgsql security definer set search_path = '' as $$
declare cfg private.point_policy%rowtype; day date; award_reason public.point_reason;
  reward bigint; cap integer; parent public.posts%rowtype;
begin
  select * into cfg from private.point_policy where singleton for share;
  if not found then return new; end if;
  if new.user_id is distinct from auth.uid() or new.is_hidden or new.deleted_at is not null then
    raise exception 'POINT_SOURCE_INELIGIBLE' using errcode = '42501';
  end if;
  -- The owning community RPC already holds this lock and has validated text,
  -- board visibility and rate limits; repeat current identity validation here.
  perform private.require_community_actor(new.user_id);
  if tg_table_name = 'posts' then
    select * into parent from public.posts where id = new.id;
    perform private.require_community_artist(parent.artist_id);
    award_reason := 'post'; reward := cfg.post_amount; cap := cfg.post_daily_cap;
  elsif tg_table_name = 'comments' then
    select p.* into parent from public.posts p join public.comments c on c.post_id=p.id
      where c.id=new.id;
    perform private.require_community_artist(parent.artist_id);
    if parent.id is null or parent.is_hidden or parent.deleted_at is not null then
      raise exception 'POINT_SOURCE_INELIGIBLE' using errcode = '42501';
    end if;
    award_reason := 'comment'; reward := cfg.comment_amount; cap := cfg.comment_daily_cap;
  else
    raise exception 'POINT_SOURCE_INELIGIBLE' using errcode = '42501';
  end if;
  day := private.point_kst_date(clock_timestamp());
  if cap is not null and (select count(*) from private.point_ledger
    where user_id=new.user_id and point_ledger.reason=award_reason and earned_on=day) >= cap then
    reward := 0;
  end if;
  perform private.append_point_entry(new.user_id,reward,award_reason,new.id::text,day,cfg.version,new.user_id,
    null,case when award_reason='post' then new.id end,case when award_reason='comment' then new.id end,
    to_jsonb(cfg)-'singleton');
  return new;
end;
$$;
create trigger posts_reward_creation after insert on public.posts
  for each row execute function private.reward_community_creation();
create trigger comments_reward_creation after insert on public.comments
  for each row execute function private.reward_community_creation();

create function public.point_balance() returns bigint
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_community_actor(auth.uid());
  return (select coalesce(sum(amount),0)::bigint from private.point_ledger where user_id=auth.uid());
end;
$$;
create function public.point_history(p_limit integer default 30,
  p_before_created_at timestamptz default null,p_before_id uuid default null)
returns table(id uuid,amount bigint,reason public.point_reason,ref_id text,
  earned_on date,policy_version text,created_at timestamptz)
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_community_actor(auth.uid());
  if p_limit is null or p_limit < 1 or p_limit > 100
    or (p_before_created_at is null) <> (p_before_id is null)
    or (p_before_created_at is not null and not isfinite(p_before_created_at)) then
    raise exception 'POINT_PAGE_INVALID' using errcode = '22023';
  end if;
  return query select l.id,l.amount,l.reason,
    case when l.reason='admin_adjust' then split_part(l.ref_id,'/',2) else l.ref_id end,
    l.earned_on,l.policy_version,l.created_at
    from private.point_ledger l where l.user_id=auth.uid()
    and (p_before_created_at is null or (l.created_at,l.id)<(p_before_created_at,p_before_id))
    order by l.created_at desc,l.id desc limit p_limit;
end;
$$;
create function public.point_capabilities()
returns table(rewards_configured boolean,share_configured boolean,missions_configured boolean,grades_configured boolean)
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_community_actor(auth.uid());
  return query select exists(select 1 from private.point_policy where singleton),false,false,false;
end;
$$;

-- A correction is an audited nonmonetary ledger delta, never an UPDATE, payout,
-- transfer, redemption or assertion about cash value. Administrator identity is
-- auth.uid(); lock both profiles in canonical order before checking either role.
create function public.point_admin_adjust(p_user_id uuid,p_request_id uuid,p_amount bigint,p_note text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); existing private.point_ledger%rowtype; ref text;
begin
  if actor is null or p_user_id is null then
    raise exception 'POINT_ACTOR_REQUIRED' using errcode = '42501';
  end if;
  perform 1 from public.profiles where id in (actor,p_user_id) order by id for update;
  perform private.require_community_actor(actor,true);
  perform private.require_community_actor(p_user_id);
  if p_request_id is null or p_amount is null or p_amount = 0
    or p_amount < -9007199254740991 or p_amount > 9007199254740991
    or p_note is null or p_note !~ '[^[:space:]]' or length(p_note)>1000 then
    raise exception 'POINT_CORRECTION_INVALID' using errcode = '23514';
  end if;
  ref := actor::text || '/' || p_request_id::text;
  select * into existing from private.point_ledger where reason='admin_adjust' and actor_id=actor and ref_id=ref;
  if found then
    if existing.user_id<>p_user_id or existing.amount<>p_amount or existing.adjustment_note<>p_note then
      raise exception 'POINT_IDEMPOTENCY_CONFLICT' using errcode = '23514';
    end if;
    return existing.id;
  end if;
  return private.append_point_entry(p_user_id,p_amount,'admin_adjust',ref,
    private.point_kst_date(clock_timestamp()),'admin-correction-v1',actor,p_note);
end;
$$;

-- Compose safely with the new two-profile correction lock. The original role
-- setter acquired actor before target, which could invert this sorted order.
create or replace function public.set_profile_role(p_user_id uuid,p_role public.user_role)
returns void language plpgsql security definer set search_path = '' as $$
declare actor public.profiles%rowtype;
begin
  perform 1 from public.profiles where id in (auth.uid(),p_user_id) order by id for update;
  select * into actor from public.profiles where id=auth.uid();
  if actor.id is null or actor.role<>'admin' or
    (actor.is_restricted and (actor.restricted_until is null or actor.restricted_until>clock_timestamp())) then
    raise exception 'FORBIDDEN' using errcode='42501';
  end if;
  if p_role is null then raise exception 'ROLE_REQUIRED' using errcode='22004'; end if;
  update public.profiles set role=p_role where id=p_user_id;
  if not found then raise exception 'PROFILE_NOT_FOUND' using errcode='P0002'; end if;
end;
$$;

revoke all on function private.point_kst_date(timestamptz), private.point_ledger_immutable(),
  private.append_point_entry(uuid,bigint,public.point_reason,text,date,text,uuid,text,uuid,uuid,jsonb),
  private.reward_community_creation() from public,anon,authenticated,service_role;
revoke all on function public.point_check_attendance(),public.point_balance(),
  public.point_history(integer,timestamptz,uuid),public.point_capabilities(),
  public.point_admin_adjust(uuid,uuid,bigint,text) from public,anon,authenticated,service_role;
grant execute on function public.point_check_attendance(),public.point_balance(),
  public.point_history(integer,timestamptz,uuid),public.point_capabilities(),
  public.point_admin_adjust(uuid,uuid,bigint,text) to authenticated;

comment on table private.point_policy is 'Explicit approved snapshot only. No row means attendance disabled and community creates without rewards. NULL cap explicitly means unlimited; missing share/mission/grade rules remain unconfigured.';
comment on table private.point_ledger is 'Immutable nonmonetary history. Zero rows record eligible actions with zero award or exhausted explicit daily cap. Hidden/deleted content retains history; corrections append only.';
commit;
