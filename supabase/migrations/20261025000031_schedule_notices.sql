-- Approved next-KST-day schedule reminders. No approved policy, provider,
-- credentials, external contact or recurring deployment is activated here.
begin;
create table private.schedule_notice_policies (
  version uuid primary key,
  hour_kst integer not null check(hour_kst between 0 and 23),
  approved_at timestamptz check(approved_at is null or isfinite(approved_at)),
  published_at timestamptz check(published_at is null or
    (isfinite(published_at) and approved_at is not null and published_at>=approved_at))
);
create table private.schedule_notice_policy_current (
  singleton boolean primary key default true check(singleton),
  policy_version uuid not null references private.schedule_notice_policies(version) on delete restrict
);
create table private.schedule_notice_scan_cursor (
  singleton boolean primary key default true check(singleton),
  last_schedule_id uuid
);
alter table private.schedule_notice_policies enable row level security;
alter table private.schedule_notice_policy_current enable row level security;
alter table private.schedule_notice_scan_cursor enable row level security;
revoke all on private.schedule_notice_policies,private.schedule_notice_policy_current,private.schedule_notice_scan_cursor
  from public,anon,authenticated,service_role;
create function private.schedule_notice_policy_immutable() returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op='TRUNCATE' or old.approved_at is not null then
    raise exception 'SCHEDULE_NOTICE_POLICY_IMMUTABLE' using errcode='23514'; end if;
  if tg_op='DELETE' then return old; end if;
  if new.version is distinct from old.version then
    raise exception 'SCHEDULE_NOTICE_POLICY_IMMUTABLE' using errcode='23514'; end if;
  return new;
end;
$$;
create trigger schedule_notice_policy_immutable before update or delete on private.schedule_notice_policies
  for each row execute function private.schedule_notice_policy_immutable();
create trigger schedule_notice_policy_no_truncate before truncate on private.schedule_notice_policies
  for each statement execute function private.schedule_notice_policy_immutable();
alter table private.notification_jobs add column schedule_notice_policy_version uuid
  references private.schedule_notice_policies(version) on delete restrict;
alter table private.notification_jobs add column schedule_notice_starts_at timestamptz
  check(schedule_notice_starts_at is null or isfinite(schedule_notice_starts_at));
alter table private.notification_jobs add constraint notification_schedule_notice_snapshot check(
  (schedule_notice_policy_version is null and schedule_notice_starts_at is null)
  or (source_kind='schedule' and schedule_notice_policy_version is not null and schedule_notice_starts_at is not null));
-- Old rolling-hour work is retained, but cannot become approved next-day work.
-- A leased/unknown attempt is not falsely called unsent or recalled.
update private.notification_jobs set cancellation_requested_at=coalesce(cancellation_requested_at,clock_timestamp()),
  state=case when state in('queued','retry_wait') then 'canceled' else state end
  where source_kind='schedule' and state in('queued','retry_wait','leased','unknown');

create function private.schedule_notice_policy_at(p_at timestamptz) returns private.schedule_notice_policies
language sql stable set search_path='' as $$
  select p.* from private.schedule_notice_policy_current c join private.schedule_notice_policies p on p.version=c.policy_version
    where p.approved_at<=p_at and p.published_at<=p_at;
$$;
create function private.schedule_notice_window(p_starts_at timestamptz,p_at timestamptz,p_hour integer) returns boolean
language sql immutable set search_path='' as $$
  select coalesce(isfinite(p_starts_at) and isfinite(p_at) and p_hour between 0 and 23
    and (p_starts_at at time zone 'Asia/Seoul')::date=(p_at at time zone 'Asia/Seoul')::date+1
    and extract(hour from p_at at time zone 'Asia/Seoul')>=p_hour,false);
$$;
create function private.schedule_notice_event_due(p_schedule_id uuid,p_at timestamptz) returns boolean
language sql stable set search_path='' as $$
  select exists(select 1 from public.schedules s join public.artists a on a.id=s.artist_id
    cross join lateral private.schedule_notice_policy_at(p_at) p
    where s.id=p_schedule_id and s.status='published' and a.status='active'
      and private.schedule_notice_window(s.starts_at,p_at,p.hour_kst));
$$;
create function private.schedule_notice_job_current(p_job private.notification_jobs,p_at timestamptz) returns boolean
language sql stable set search_path='' as $$
  select exists(select 1 from public.schedules s cross join lateral private.schedule_notice_policy_at(p_at) p
    where s.id=p_job.source_id and s.starts_at=p_job.schedule_notice_starts_at
      and p.version=p_job.schedule_notice_policy_version
      and exists(select 1 from private.push_subscriptions d where d.id=p_job.device_id
        and private.webpush_session_active(p_job.user_id,d.auth_session_id,p_at))
      and private.schedule_notice_window(s.starts_at,p_at,p.hour_kst));
$$;
create or replace function private.notification_enqueue_source(p_kind text,p_source uuid) returns integer
language plpgsql set search_path = '' as $$
declare cfg private.notification_policy%rowtype; route uuid; due timestamptz; affected integer;
begin
  if p_kind is null or p_kind not in ('message','payment','schedule') or p_source is null then
    raise exception 'NOTIFICATION_SOURCE_INVALID' using errcode='22023'; end if;
  if p_kind='schedule' then return 0; end if;
  select * into cfg from private.notification_policy;
  if cfg.singleton is null or not cfg.webpush_enabled then return 0; end if;
  due:=clock_timestamp();
  if p_kind='message' then select artist_id into route from public.messages where id=p_source;
  elsif p_kind='payment' then select subscription_id into route from public.payment_events where id=p_source;
  else select id,greatest(due,starts_at-make_interval(secs=>cfg.schedule_lead_seconds)) into route,due
    from public.schedules where id=p_source; end if;
  if route is null then return 0; end if;
  -- Source hooks already own their source lock. Do not acquire recipient row
  -- locks here (would invert identity->source ordering). Eligibility is checked
  -- now and under all authoritative locks again at the claim boundary.
  insert into private.notification_jobs(source_kind,source_id,message_id,payment_event_id,schedule_id,
    user_id,device_id,route_kind,route_id,next_attempt_at,max_attempts,retry_seconds,lease_seconds,policy_version)
  select p_kind,p_source,case when p_kind='message' then p_source end,
    case when p_kind='payment' then p_source end,case when p_kind='schedule' then p_source end,
    d.user_id,d.id,case p_kind when 'message' then 'artist_chat' when 'payment' then 'billing' else 'schedule' end,
    route,due,cfg.max_attempts,cfg.retry_seconds,cfg.lease_seconds,cfg.version
    from private.push_subscriptions d
    where private.notification_eligible(p_kind,p_source,d.user_id,d.id,clock_timestamp())
    on conflict(source_kind,source_id,channel,user_id,device_id) do nothing;
  get diagnostics affected=row_count;
  return affected;
end;
$$;
create or replace function private.notification_eligible(p_kind text,p_source uuid,p_user uuid,p_device uuid,p_at timestamptz)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.notification_actor_eligible(p_user,p_at) and exists (
    select 1 from private.notification_preferences n join private.push_subscriptions d on d.user_id=n.user_id
      cross join private.notification_policy cfg
    where n.user_id=p_user and n.webpush_enabled and d.id=p_device and d.state='active'
      and cfg.webpush_enabled and d.consent_version=cfg.consent_version
      and case p_kind
        when 'message' then n.new_message and private.message_is_visible(p_user,p_source,false,p_at)
        when 'billing_notice' then n.billing and exists(select 1 from private.billing_notices b
          where b.id=p_source and b.user_id=p_user and private.billing_notice_current(b.id,p_at))
        when 'payment' then n.billing and exists (select 1 from public.payment_events e
          join private.payment_event_verifications v on v.event_id=e.id
          join public.subscriptions s on s.id=e.subscription_id
          where e.id=p_source and s.user_id=p_user)
        when 'schedule' then n.schedule and private.schedule_notice_event_due(p_source,p_at) and exists (select 1 from public.schedules s
          join public.artists a on a.id=s.artist_id where s.id=p_source and s.status='published'
            and a.status='active' and s.starts_at>p_at
            and private.has_subscription_access(p_user,s.artist_id,p_at)
            and not exists (select 1 from public.schedule_notification_optouts o
              where o.schedule_id=s.id and o.user_id=p_user))
        else false end);
$$;
create or replace function private.notification_schedule_changed() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if tg_op='DELETE' then
    perform private.notification_cancel_source('schedule',old.id); return old;
  end if;
  if new.status<>'published' or (tg_op='UPDATE' and
    (new.starts_at is distinct from old.starts_at or new.artist_id is distinct from old.artist_id)) then
    perform private.notification_cancel_source('schedule',new.id);
  end if;
  return new;
end;
$$;
create function private.schedule_notice_optout_changed() returns trigger
language plpgsql security definer set search_path='' as $$
declare locked_jobs uuid[];
begin
  select array_agg(locked.id order by locked.id) into locked_jobs from (
    select id from private.notification_jobs where source_kind='schedule' and source_id=new.schedule_id
      and user_id=new.user_id and state in('queued','retry_wait','leased','unknown') order by id for update
  ) locked;
  update private.notification_jobs set cancellation_requested_at=coalesce(cancellation_requested_at,clock_timestamp()),
    state=case when state in('queued','retry_wait') then 'canceled' else state end
    where id=any(locked_jobs) and source_kind='schedule' and source_id=new.schedule_id and user_id=new.user_id
      and state in('queued','retry_wait','leased','unknown');
  return new;
end;
$$;
create trigger schedule_notice_optout_changed after insert on public.schedule_notification_optouts
  for each row execute function private.schedule_notice_optout_changed();

-- Selection has a rotating cursor, so repeatedly failing earlier events do not
-- permanently starve later events. Creating work rechecks under source locks.
create function public.schedule_notice_candidates(p_limit integer default 20) returns table(schedule_id uuid)
language plpgsql security definer set search_path='' as $$
declare selected uuid[]; cursor_id uuid;
begin
  perform private.require_notification_service();
  if p_limit is null or p_limit not between 1 and 20 then
    raise exception 'SCHEDULE_NOTICE_LIMIT_INVALID' using errcode='22023'; end if;
  if (private.schedule_notice_policy_at(clock_timestamp())).version is null
    or not exists(select 1 from private.notification_policy np where np.webpush_enabled and np.lease_seconds>=10) then
    raise exception 'SCHEDULE_NOTICE_POLICY_NOT_APPROVED' using errcode='55000'; end if;
  insert into private.schedule_notice_scan_cursor(singleton) values(true) on conflict(singleton) do nothing;
  select last_schedule_id into cursor_id from private.schedule_notice_scan_cursor where singleton for update;
  select array_agg(picked.id order by picked.wrap,picked.id) into selected from (
    select s.id,case when cursor_id is null or s.id>cursor_id then 0 else 1 end as wrap
    from public.schedules s where private.schedule_notice_event_due(s.id,statement_timestamp())
      and exists(select 1 from private.push_subscriptions d where d.auth_session_id is not null
        and private.webpush_session_active(d.user_id,d.auth_session_id,statement_timestamp())
        and private.notification_eligible('schedule',s.id,d.user_id,d.id,statement_timestamp())
        and not exists(select 1 from private.notification_jobs j where j.source_kind='schedule' and j.source_id=s.id
          and j.user_id=d.user_id and j.device_id=d.id))
    order by wrap,s.id limit p_limit) picked;
  if cardinality(selected)>0 then
    update private.schedule_notice_scan_cursor set last_schedule_id=selected[cardinality(selected)] where singleton;
  end if;
  return query select unnest(coalesce(selected,'{}'::uuid[]));
end;
$$;
create function public.schedule_notice_create(p_schedule_id uuid) returns table(created boolean,push_jobs integer)
language plpgsql security definer set search_path='' as $$
declare event public.schedules%rowtype; cfg private.notification_policy%rowtype;
  policy private.schedule_notice_policies%rowtype; at_time timestamptz; affected integer;
begin
  perform private.require_notification_service();
  if p_schedule_id is null then raise exception 'SCHEDULE_NOTICE_INVALID_INPUT' using errcode='22004'; end if;
  select * into event from public.schedules where id=p_schedule_id;
  if event.id is null then return query select false,0; return; end if;
  perform 1 from public.artists where id=event.artist_id for share;
  select * into event from public.schedules where id=p_schedule_id for update;
  perform 1 from private.notification_policy for share;
  perform 1 from private.schedule_notice_policy_current for share;
  perform 1 from private.schedule_notice_policies p join private.schedule_notice_policy_current c on c.policy_version=p.version for share of p;
  at_time:=clock_timestamp();
  select * into cfg from private.notification_policy;
  policy:=private.schedule_notice_policy_at(at_time);
  if cfg.singleton is null or not cfg.webpush_enabled or cfg.lease_seconds<10 or policy.version is null then
    raise exception 'SCHEDULE_NOTICE_POLICY_NOT_APPROVED' using errcode='55000'; end if;
  if event.id is null or not private.schedule_notice_event_due(event.id,at_time) then
    return query select false,0; return; end if;
  -- Do not lock recipient profiles while owning the event. Concurrent optout,
  -- restriction, preference, logout and entitlement changes are checked again
  -- under the canonical locks at claim and immediately before external I/O.
  insert into private.notification_jobs(source_kind,source_id,schedule_id,user_id,device_id,route_kind,route_id,
    next_attempt_at,max_attempts,retry_seconds,lease_seconds,policy_version,schedule_notice_policy_version,schedule_notice_starts_at)
  select 'schedule',event.id,event.id,d.user_id,d.id,'schedule',event.id,
    at_time,cfg.max_attempts,cfg.retry_seconds,cfg.lease_seconds,cfg.version,policy.version,event.starts_at
    from private.push_subscriptions d where d.auth_session_id is not null
      and private.webpush_session_active(d.user_id,d.auth_session_id,at_time)
      and private.notification_eligible('schedule',event.id,d.user_id,d.id,at_time)
    on conflict(source_kind,source_id,channel,user_id,device_id) do nothing;
  get diagnostics affected=row_count;
  return query select affected>0,affected;
end;
$$;

create function public.schedule_notice_preferences(p_schedule_id uuid default null)
returns table(schedule_enabled boolean,event_enabled boolean,eligible boolean,webpush_enabled boolean,configured boolean,hour_kst integer)
language plpgsql security definer set search_path='' as $$
declare actor uuid; event public.schedules%rowtype; at_time timestamptz;
  pref private.notification_preferences%rowtype; policy private.schedule_notice_policies%rowtype;
begin
  actor:=private.schedule_ui_actor(false);
  if not private.notification_actor_eligible(actor,clock_timestamp()) then
    raise exception 'NOTIFICATION_ACTOR_FORBIDDEN' using errcode='42501'; end if;
  if p_schedule_id is not null then event:=private.lock_schedule(p_schedule_id,true); end if;
  at_time:=clock_timestamp();
  select * into pref from private.notification_preferences where user_id=actor;
  policy:=private.schedule_notice_policy_at(at_time);
  if not exists(select 1 from private.notification_policy np where np.webpush_enabled and np.lease_seconds>=10) then policy:=null; end if;
  return query select coalesce(pref.schedule,false),
    case when p_schedule_id is not null then not exists(select 1 from public.schedule_notification_optouts o where o.user_id=actor and o.schedule_id=p_schedule_id) end,
    case when p_schedule_id is not null then private.has_subscription_access(actor,event.artist_id,at_time) end,
    coalesce(pref.webpush_enabled,false),policy.version is not null,policy.hour_kst;
end;
$$;
create function public.schedule_notice_set_preference(p_enabled boolean)
returns table(schedule_enabled boolean,event_enabled boolean,eligible boolean,webpush_enabled boolean,configured boolean,hour_kst integer)
language plpgsql security definer set search_path='' as $$
declare actor uuid; pref private.notification_preferences%rowtype;
begin
  actor:=private.schedule_ui_actor(false,true);
  if p_enabled is null then raise exception 'SCHEDULE_NOTICE_INVALID_INPUT' using errcode='22004'; end if;
  select * into pref from private.notification_preferences where user_id=actor;
  perform public.notification_set_preferences(coalesce(pref.webpush_enabled,false),coalesce(pref.new_message,false),coalesce(pref.billing,false),p_enabled);
  return query select * from public.schedule_notice_preferences();
end;
$$;
create function public.schedule_notice_set_event(p_schedule_id uuid,p_enabled boolean)
returns table(schedule_enabled boolean,event_enabled boolean,eligible boolean,webpush_enabled boolean,configured boolean,hour_kst integer)
language plpgsql security definer set search_path='' as $$
begin
  perform private.schedule_ui_actor(false,true);
  if p_schedule_id is null or p_enabled is null then raise exception 'SCHEDULE_NOTICE_INVALID_INPUT' using errcode='22004'; end if;
  if not private.notification_actor_eligible(auth.uid(),clock_timestamp()) then
    raise exception 'NOTIFICATION_ACTOR_FORBIDDEN' using errcode='42501'; end if;
  perform public.schedule_set_notification(p_schedule_id,p_enabled);
  return query select * from public.schedule_notice_preferences(p_schedule_id);
end;
$$;
create or replace function public.notification_claim(p_job_id uuid)
returns table(job_id uuid,lease_token uuid,lease_expires_at timestamptz,endpoint text,p256dh text,auth text,
  source_kind text,source_id uuid,route_kind text,route_id uuid)
language plpgsql security definer set search_path = '' as $$
declare j private.notification_jobs%rowtype; d private.push_subscriptions%rowtype; artist uuid; at_time timestamptz; session_id uuid;
begin
  perform private.require_notification_service();
  select * into j from private.notification_jobs where id=p_job_id;
  if j.id is null then return; end if;
  -- Authoritative serialization order matches existing identity, messaging and
  -- calendar RPCs. Never take a job lock before a source/eligibility lock.
  perform 1 from public.profiles where id=j.user_id for share;
  if j.source_kind='billing_notice' then perform private.billing_notice_lock_actor(j.user_id); end if;
  artist:=private.notification_source_artist(j.source_kind,j.source_id);
  perform 1 from public.artists where id=artist for share;
  perform 1 from public.subscriptions where user_id=j.user_id and artist_id=artist for share;
  if j.source_kind='message' then perform 1 from public.messages where id=j.source_id for share;
  elsif j.source_kind='payment' then perform 1 from public.payment_events where id=j.source_id for share;
  elsif j.source_kind='billing_notice' then
    perform private.billing_notice_lock_subscription((select subscription_id from private.billing_notices where id=j.source_id));
    perform 1 from private.billing_notices where id=j.source_id for share;
  else perform 1 from public.schedules where id=j.source_id for share; end if;
  perform 1 from private.notification_preferences where user_id=j.user_id for share;
  if j.source_kind='schedule' then
    select ps.auth_session_id into session_id from private.push_subscriptions ps where ps.id=j.device_id;
    perform 1 from auth.sessions where id=session_id and user_id=j.user_id for share;
  end if;
  select * into d from private.push_subscriptions where id=j.device_id for share;
  -- Policy change/revocation serializes before claim, and runtime eligibility
  -- uses current consent, while attempt limits keep the original job snapshot.
  perform 1 from private.notification_policy for share;
  if j.source_kind='message' then perform 1 from private.message_policy for share; end if;
  if j.source_kind='schedule' then
    perform 1 from private.schedule_notice_policy_current for share;
    perform 1 from private.schedule_notice_policies p join private.schedule_notice_policy_current c on c.policy_version=p.version for share of p;
  end if;
  select * into j from private.notification_jobs where id=p_job_id for update skip locked;
  if j.id is null then return; end if;
  at_time:=clock_timestamp();
  if j.state='leased' and j.lease_expires_at<=at_time then
    update private.notification_jobs set state='unknown' where id=j.id;
    update private.notification_attempts set state='unknown' where token=j.lease_token and state='leased';
    return; -- An old worker may still be running; NEVER hand its job to another.
  end if;
  if j.state not in ('queued','retry_wait') or j.next_attempt_at>at_time then return; end if;
  if j.cancellation_requested_at is not null
    or (j.source_kind='schedule' and not private.schedule_notice_job_current(j,at_time))
    or not private.notification_eligible(
    j.source_kind,j.source_id,j.user_id,j.device_id,at_time) then
    update private.notification_jobs set state='canceled',cancellation_requested_at=coalesce(cancellation_requested_at,at_time)
      where id=j.id; return;
  end if;
  if j.attempt_count>=j.max_attempts then
    update private.notification_jobs set state='failed' where id=j.id; return; end if;
  update private.notification_jobs set state='leased',attempt_count=attempt_count+1,
    lease_token=gen_random_uuid(),lease_expires_at=at_time+make_interval(secs=>j.lease_seconds)
    where id=j.id returning * into j;
  insert into private.notification_attempts(job_id,ordinal,token,state,lease_expires_at)
    values(j.id,j.attempt_count,j.lease_token,'leased',j.lease_expires_at);
  return query select j.id,j.lease_token,j.lease_expires_at,d.endpoint,d.p256dh,d.auth,
    j.source_kind,j.source_id,j.route_kind,j.route_id;
end;
$$;
create or replace function private.webpush_lock_job(p_job_id uuid) returns private.notification_jobs
language plpgsql set search_path='' as $$
declare j private.notification_jobs%rowtype; artist uuid; session_id uuid;
begin
  select * into j from private.notification_jobs where id=p_job_id;
  if j.id is null then return j; end if;
  perform 1 from public.profiles where id=j.user_id for share;
  if j.source_kind='billing_notice' then perform private.billing_notice_lock_actor(j.user_id); end if;
  artist:=private.notification_source_artist(j.source_kind,j.source_id);
  perform 1 from public.artists where id=artist for share;
  perform 1 from public.subscriptions where user_id=j.user_id and artist_id=artist for share;
  if j.source_kind='message' then perform 1 from public.messages where id=j.source_id for share;
  elsif j.source_kind='payment' then perform 1 from public.payment_events where id=j.source_id for share;
  elsif j.source_kind='billing_notice' then
    perform private.billing_notice_lock_subscription((select subscription_id from private.billing_notices where id=j.source_id));
    perform 1 from private.billing_notices where id=j.source_id for share;
  else perform 1 from public.schedules where id=j.source_id for share; end if;
  perform 1 from private.notification_preferences where user_id=j.user_id for share;
  select d.auth_session_id into session_id from private.push_subscriptions d where d.id=j.device_id;
  perform 1 from auth.sessions where id=session_id and user_id=j.user_id for share;
  perform 1 from private.push_subscriptions where id=j.device_id for share;
  perform 1 from private.notification_policy for share;
  if j.source_kind='message' then perform 1 from private.message_policy for share; end if;
  if j.source_kind='schedule' then
    perform 1 from private.schedule_notice_policy_current for share;
    perform 1 from private.schedule_notice_policies p join private.schedule_notice_policy_current c on c.policy_version=p.version for share of p;
  end if;
  select * into j from private.notification_jobs where id=p_job_id for update;
  return j;
end;
$$;
create or replace function private.webpush_job_eligible(p_job private.notification_jobs,p_at timestamptz)
returns boolean language sql stable set search_path='' as $$
  select p_job.source_kind in('message','billing_notice','schedule') and p_job.cancellation_requested_at is null and private.notification_eligible(
    p_job.source_kind,p_job.source_id,p_job.user_id,p_job.device_id,p_at)
    and exists(select 1 from private.push_subscriptions d cross join private.notification_policy cfg
      where d.id=p_job.device_id and cfg.lease_seconds>=10
        and private.webpush_session_active(p_job.user_id,d.auth_session_id,p_at))
    and (p_job.source_kind<>'schedule' or private.schedule_notice_job_current(p_job,p_at));
$$;
create or replace function public.webpush_recover_expired(p_job_id uuid,p_token uuid) returns text
language plpgsql security definer set search_path='' as $$
declare j private.notification_jobs%rowtype; at_time timestamptz; retry_at timestamptz;
begin
  perform private.require_notification_service();
  j:=private.webpush_lock_job(p_job_id); at_time:=clock_timestamp();
  if j.id is null then return 'missing'; end if;
  if j.source_kind not in('message','billing_notice','schedule') then return j.state; end if;
  if p_token is null or j.lease_token is distinct from p_token or j.state not in('leased','unknown') then return j.state; end if;
  -- Preserve the old DB-only uncertain contract for unbound historical rows.
  if not exists(select 1 from private.push_subscriptions where id=j.device_id and auth_session_id is not null) then return j.state; end if;
  if j.lease_expires_at>at_time then return j.state; end if;
  if not private.webpush_job_eligible(j,at_time) then
    perform private.webpush_cancel_locked_job(j); return 'canceled'; end if;
  retry_at:=greatest(j.next_attempt_at,j.lease_expires_at+make_interval(secs=>private.webpush_retry_seconds(j)));
  if retry_at>at_time then return j.state; end if;
  update private.notification_attempts set state='unknown',finished_at=at_time where token=j.lease_token and state in('leased','unknown');
  if j.attempt_count>=j.max_attempts then
    update private.notification_jobs set state='failed' where id=j.id; return 'failed'; end if;
  update private.notification_jobs set state='retry_wait',next_attempt_at=at_time where id=j.id;
  return 'retry_wait';
end;
$$;
create or replace function public.webpush_list_due(p_limit integer default 100) returns table(id uuid)
language plpgsql security definer set search_path='' as $$
begin
  perform private.require_notification_service();
  if p_limit is null or p_limit not between 1 and 100 then
    raise exception 'NOTIFICATION_LIMIT_INVALID' using errcode='22023'; end if;
  return query select j.id from private.notification_jobs j join private.push_subscriptions d on d.id=j.device_id
    where j.source_kind in('message','billing_notice','schedule') and d.auth_session_id is not null
      and j.state in('queued','retry_wait') and j.next_attempt_at<=clock_timestamp()
    order by j.next_attempt_at,j.id limit p_limit;
end;
$$;
create or replace function public.webpush_list_uncertain(p_limit integer default 100)
returns table(job_id uuid,lease_token uuid,lease_expires_at timestamptz,cancellation_requested_at timestamptz)
language plpgsql security definer set search_path='' as $$
begin
  perform private.require_notification_service();
  if p_limit is null or p_limit not between 1 and 100 then
    raise exception 'NOTIFICATION_LIMIT_INVALID' using errcode='22023'; end if;
  return query select j.id,j.lease_token,j.lease_expires_at,j.cancellation_requested_at
    from private.notification_jobs j join private.push_subscriptions d on d.id=j.device_id
    where j.source_kind in('message','billing_notice','schedule') and d.auth_session_id is not null and j.state in('leased','unknown')
      and greatest(j.next_attempt_at,j.lease_expires_at+make_interval(secs=>private.webpush_retry_seconds(j)))<=clock_timestamp()
    order by j.lease_expires_at,j.id limit p_limit;
end;
$$;
do $$declare fn regprocedure; begin
  for fn in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname in('public','private') and p.proname like 'schedule_notice\_%' escape '\'
  loop execute format('revoke all on function %s from public,anon,authenticated,service_role',fn); end loop;
end$$;
grant execute on function public.schedule_notice_candidates(integer),public.schedule_notice_create(uuid) to service_role;
grant execute on function public.schedule_notice_preferences(uuid),public.schedule_notice_set_preference(boolean),
  public.schedule_notice_set_event(uuid,boolean) to authenticated;
comment on table private.schedule_notice_policies is
  'Explicit approval required before next-day Asia/Seoul schedule reminders. Source documents suggest hour 10, not a runtime approval. No policy is seeded; Alimtalk remains unconfigured.';
comment on function public.schedule_notice_create(uuid) is
  'One durable source/channel/user/device identity. Current next-day window only; no late same-day catchup. Edits and optouts never resurrect terminal work; provider acceptance is not device delivery.';
commit;
