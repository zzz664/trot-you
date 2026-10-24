-- Database outbox only. No provider, worker, network, phone, VAPID or payload API.
begin;

create table private.notification_policy (
  singleton boolean primary key default true check (singleton),
  version text not null check (version ~ '[^[:space:]]' and length(version) <= 100),
  consent_version text not null check (consent_version ~ '[^[:space:]]' and length(consent_version) <= 100),
  webpush_enabled boolean not null,
  max_attempts integer not null check (max_attempts between 1 and 10),
  retry_seconds integer not null check (retry_seconds between 1 and 86400),
  lease_seconds integer not null check (lease_seconds between 5 and 300),
  schedule_lead_seconds integer not null check (schedule_lead_seconds between 1 and 604800)
);
create table private.notification_preferences (
  user_id uuid primary key references public.profiles(id) on delete restrict,
  webpush_enabled boolean not null default false,
  new_message boolean not null default false,
  billing boolean not null default false,
  schedule boolean not null default false,
  updated_at timestamptz not null default now()
);
create table private.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete restrict,
  -- Opaque browser material: only a future server adapter may validate the
  -- provider origin and cryptographic key. These structural checks are NOT an
  -- SSRF allowlist, proof of endpoint ownership, or permission to fetch this URI.
  endpoint text not null unique check (length(endpoint) between 12 and 2048
    and endpoint ~ '^https://[A-Za-z0-9][A-Za-z0-9.-]*(:443)?/[^[:space:]#@]*$'
    and endpoint !~ '[[:cntrl:]]'),
  p256dh text not null check (p256dh ~ '^[A-Za-z0-9_-]{87}$'),
  auth text not null check (auth ~ '^[A-Za-z0-9_-]{22}$'),
  consent_version text not null check (consent_version ~ '[^[:space:]]' and length(consent_version) <= 100),
  consented_at timestamptz not null default now(),
  state text not null default 'active' check (state in ('active','revoked','dead')),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (id,user_id),
  check ((state = 'active' and revoked_at is null) or (state <> 'active' and revoked_at is not null))
);
create index push_subscriptions_user_idx on private.push_subscriptions(user_id,id);

create table private.notification_jobs (
  id uuid primary key default gen_random_uuid(),
  source_kind text not null check (source_kind in ('message','payment','schedule')),
  source_id uuid not null,
  message_id uuid references public.messages(id) on delete restrict,
  payment_event_id uuid references public.payment_events(id) on delete restrict,
  -- Deleted schedules retain the source UUID and cancellation record, not an
  -- orphaned clickable route. Existing authorized schedule deletion still works.
  schedule_id uuid references public.schedules(id) on delete set null,
  channel text not null default 'webpush' check (channel = 'webpush'),
  -- Owner existence is guaranteed transitively by the composite device FK.
  -- A redundant profile FK would take KEY SHARE from inside a source trigger,
  -- inverting calendar optout's profile FOR UPDATE -> source lock order.
  user_id uuid not null,
  device_id uuid not null,
  route_kind text not null check (route_kind in ('artist_chat','billing','schedule')),
  route_id uuid not null,
  state text not null default 'queued' check (state in
    ('queued','leased','retry_wait','provider_accepted','unknown','canceled','failed','dead_endpoint')),
  next_attempt_at timestamptz not null check (isfinite(next_attempt_at)),
  attempt_count integer not null default 0 check (attempt_count between 0 and 10),
  lease_token uuid,
  lease_expires_at timestamptz,
  cancellation_requested_at timestamptz,
  provider_accepted_at timestamptz,
  max_attempts integer not null check (max_attempts between 1 and 10),
  retry_seconds integer not null check (retry_seconds between 1 and 86400),
  lease_seconds integer not null check (lease_seconds between 5 and 300),
  policy_version text not null,
  created_at timestamptz not null default now(),
  foreign key (device_id,user_id) references private.push_subscriptions(id,user_id) on delete restrict,
  unique (source_kind,source_id,channel,user_id,device_id),
  check ((source_kind = 'message' and message_id = source_id and message_id is not null
      and payment_event_id is null and schedule_id is null and route_kind = 'artist_chat')
    or (source_kind = 'payment' and payment_event_id = source_id and payment_event_id is not null
      and message_id is null and schedule_id is null and route_kind = 'billing')
    or (source_kind = 'schedule' and (schedule_id = source_id or schedule_id is null)
      and message_id is null and payment_event_id is null and route_kind = 'schedule')),
  check ((lease_token is null and lease_expires_at is null) or
    (lease_token is not null and lease_expires_at is not null and isfinite(lease_expires_at))),
  check (state not in ('leased','unknown') or lease_token is not null),
  check ((state = 'provider_accepted') = (provider_accepted_at is not null)),
  check (attempt_count <= max_attempts)
);
create index notification_jobs_due_idx on private.notification_jobs(next_attempt_at,id)
  where state in ('queued','retry_wait');
create index notification_jobs_uncertain_idx on private.notification_jobs(lease_expires_at,id)
  where state in ('leased','unknown');
create index notification_jobs_device_idx on private.notification_jobs(device_id);
create index notification_jobs_message_idx on private.notification_jobs(message_id) where message_id is not null;
create index notification_jobs_payment_idx on private.notification_jobs(payment_event_id) where payment_event_id is not null;
create index notification_jobs_schedule_idx on private.notification_jobs(schedule_id) where schedule_id is not null;
create index notification_jobs_user_idx on private.notification_jobs(user_id);
create table private.notification_attempts (
  job_id uuid not null references private.notification_jobs(id) on delete restrict,
  ordinal integer not null check (ordinal between 1 and 10),
  token uuid not null unique,
  state text not null check (state in ('leased','provider_accepted','not_sent','unknown','dead_endpoint','permanent_failure')),
  evidence_ref uuid,
  lease_expires_at timestamptz not null check (isfinite(lease_expires_at)),
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  primary key (job_id,ordinal),
  check (state in ('leased','unknown') or (evidence_ref is not null and finished_at is not null))
);

alter table private.notification_policy enable row level security;
alter table private.notification_preferences enable row level security;
alter table private.push_subscriptions enable row level security;
alter table private.notification_jobs enable row level security;
alter table private.notification_attempts enable row level security;
revoke all on private.notification_policy, private.notification_preferences, private.push_subscriptions,
  private.notification_jobs, private.notification_attempts from public,anon,authenticated,service_role;
-- No raw-table grant, including service_role. Narrow functions return only the
-- endpoint of the one exclusively leased job, never a bulk endpoint directory.

create function private.require_notification_service() returns void
language plpgsql set search_path = '' as $$
begin
  if current_setting('role',true) is distinct from 'service_role' then
    raise exception 'NOTIFICATION_SERVICE_REQUIRED' using errcode = '42501';
  end if;
end;
$$;
create function private.notification_actor_eligible(p_user uuid,p_at timestamptz) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id=p_user and role='fan'
    and onboarding_completed_at is not null
    and not (is_restricted and (restricted_until is null or restricted_until>p_at)));
$$;
create function public.notification_capabilities()
returns table(webpush_configured boolean,alimtalk_configured boolean,device_receipt_supported boolean,delivery_implemented boolean)
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from private.notification_policy where webpush_enabled),false,false,false;
$$;
create function public.notification_get_preferences()
returns table(webpush_enabled boolean,new_message boolean,billing boolean,schedule boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.notification_actor_eligible(auth.uid(),statement_timestamp()) then
    raise exception 'NOTIFICATION_ACTOR_FORBIDDEN' using errcode='42501'; end if;
  return query select coalesce(p.webpush_enabled,false),coalesce(p.new_message,false),
    coalesce(p.billing,false),coalesce(p.schedule,false)
    from (select auth.uid() as id) u left join private.notification_preferences p on p.user_id=u.id;
end;
$$;
create function public.notification_set_preferences(p_webpush_enabled boolean,p_new_message boolean,
  p_billing boolean,p_schedule boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.profiles where id=auth.uid() for update;
  if not private.notification_actor_eligible(auth.uid(),clock_timestamp()) then
    raise exception 'NOTIFICATION_ACTOR_FORBIDDEN' using errcode='42501'; end if;
  if p_webpush_enabled is null or p_new_message is null or p_billing is null or p_schedule is null then
    raise exception 'NOTIFICATION_PREFERENCES_REQUIRED' using errcode='22004'; end if;
  insert into private.notification_preferences(user_id,webpush_enabled,new_message,billing,schedule)
    values(auth.uid(),p_webpush_enabled,p_new_message,p_billing,p_schedule)
    on conflict(user_id) do update set webpush_enabled=excluded.webpush_enabled,new_message=excluded.new_message,
      billing=excluded.billing,schedule=excluded.schedule,updated_at=clock_timestamp();
  -- Every multi-job mutation locks the complete affected active set in UUID
  -- order. Source-wide and device-wide cleanup sets can otherwise form cycles.
  perform 1 from private.notification_jobs where user_id=auth.uid()
    and state in ('queued','retry_wait','leased','unknown') order by id for update;
  -- Never claim recall of requests already outside the transaction.
  update private.notification_jobs set cancellation_requested_at=coalesce(cancellation_requested_at,clock_timestamp()),
    state=case when state in ('queued','retry_wait') then 'canceled' else state end
    where user_id=auth.uid() and state in ('queued','retry_wait','leased','unknown')
      and (not p_webpush_enabled or (source_kind='message' and not p_new_message)
        or (source_kind='payment' and not p_billing) or (source_kind='schedule' and not p_schedule));
end;
$$;
create function public.notification_register_device(p_actor_id uuid,p_endpoint text,p_p256dh text,
  p_auth text,p_consent_version text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare d private.push_subscriptions%rowtype; cfg private.notification_policy%rowtype;
begin
  perform private.require_notification_service();
  perform 1 from public.profiles where id=p_actor_id for share;
  if not private.notification_actor_eligible(p_actor_id,clock_timestamp()) then
    raise exception 'NOTIFICATION_ACTOR_FORBIDDEN' using errcode='42501'; end if;
  select * into cfg from private.notification_policy;
  if cfg.singleton is null or not cfg.webpush_enabled or p_consent_version is distinct from cfg.consent_version then
    raise exception 'NOTIFICATION_CONSENT_REQUIRED' using errcode='55000'; end if;
  -- Conflict never reassigns an endpoint to another actor. A trusted future
  -- API must bind p_actor_id to its verified session (never request JSON).
  insert into private.push_subscriptions(user_id,endpoint,p256dh,auth,consent_version)
    values(p_actor_id,p_endpoint,p_p256dh,p_auth,p_consent_version) on conflict(endpoint) do nothing;
  select * into strict d from private.push_subscriptions where endpoint=p_endpoint for update;
  if d.user_id<>p_actor_id or d.p256dh is distinct from p_p256dh or d.auth is distinct from p_auth
    or d.consent_version is distinct from p_consent_version then
    raise exception 'NOTIFICATION_DEVICE_CONFLICT' using errcode='23514'; end if;
  if d.state<>'active' then
    raise exception 'NOTIFICATION_DEVICE_INACTIVE' using errcode='55000'; end if;
  return d.id;
end;
$$;
create function public.notification_revoke_device(p_actor_id uuid,p_device_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare d private.push_subscriptions%rowtype;
begin
  perform private.require_notification_service();
  -- Revocation remains available to restricted users, but only their own device.
  perform 1 from public.profiles where id=p_actor_id for share;
  select * into d from private.push_subscriptions where id=p_device_id and user_id=p_actor_id for update;
  if d.id is null then raise exception 'NOTIFICATION_DEVICE_FORBIDDEN' using errcode='42501'; end if;
  update private.push_subscriptions set state=case when state='dead' then state else 'revoked' end,
    revoked_at=coalesce(revoked_at,clock_timestamp()) where id=d.id;
  perform 1 from private.notification_jobs where device_id=d.id
    and state in ('queued','retry_wait','leased','unknown') order by id for update;
  update private.notification_jobs set cancellation_requested_at=coalesce(cancellation_requested_at,clock_timestamp()),
    state=case when state in ('queued','retry_wait') then 'canceled' else state end
    where device_id=d.id and state in ('queued','retry_wait','leased','unknown');
end;
$$;

create function private.notification_source_artist(p_kind text,p_source uuid) returns uuid
language sql stable set search_path = '' as $$
  select artist_id from public.messages where p_kind='message' and id=p_source
  union all select s.artist_id from public.payment_events e join public.subscriptions s on s.id=e.subscription_id
    where p_kind='payment' and e.id=p_source
  union all select artist_id from public.schedules where p_kind='schedule' and id=p_source;
$$;
create function private.notification_eligible(p_kind text,p_source uuid,p_user uuid,p_device uuid,p_at timestamptz)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.notification_actor_eligible(p_user,p_at) and exists (
    select 1 from private.notification_preferences n join private.push_subscriptions d on d.user_id=n.user_id
      cross join private.notification_policy cfg
    where n.user_id=p_user and n.webpush_enabled and d.id=p_device and d.state='active'
      and cfg.webpush_enabled and d.consent_version=cfg.consent_version
      and case p_kind
        when 'message' then n.new_message and private.message_is_visible(p_user,p_source,false,p_at)
        when 'payment' then n.billing and exists (select 1 from public.payment_events e
          join private.payment_event_verifications v on v.event_id=e.id
          join public.subscriptions s on s.id=e.subscription_id
          where e.id=p_source and s.user_id=p_user)
        when 'schedule' then n.schedule and exists (select 1 from public.schedules s
          join public.artists a on a.id=s.artist_id where s.id=p_source and s.status='published'
            and a.status='active' and s.starts_at>p_at
            and private.has_subscription_access(p_user,s.artist_id,p_at)
            and not exists (select 1 from public.schedule_notification_optouts o
              where o.schedule_id=s.id and o.user_id=p_user))
        else false end);
$$;
create function private.notification_enqueue_source(p_kind text,p_source uuid) returns integer
language plpgsql set search_path = '' as $$
declare cfg private.notification_policy%rowtype; route uuid; due timestamptz; affected integer;
begin
  if p_kind is null or p_kind not in ('message','payment','schedule') or p_source is null then
    raise exception 'NOTIFICATION_SOURCE_INVALID' using errcode='22023'; end if;
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
create function public.notification_enqueue(p_source_kind text,p_source_id uuid) returns integer
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_notification_service();
  -- Recovery/replay joins the same source lock used by mutation hooks.
  if p_source_kind='message' then perform 1 from public.messages where id=p_source_id for share;
  elsif p_source_kind='payment' then perform 1 from public.payment_events where id=p_source_id for share;
  elsif p_source_kind='schedule' then perform 1 from public.schedules where id=p_source_id for share; end if;
  return private.notification_enqueue_source(p_source_kind,p_source_id);
end;
$$;
create function private.notification_cancel_source(p_kind text,p_source uuid) returns void
language plpgsql set search_path = '' as $$
begin
  perform 1 from private.notification_jobs where source_kind=p_kind and source_id=p_source
    and state in ('queued','retry_wait','leased','unknown') order by id for update;
  update private.notification_jobs set cancellation_requested_at=coalesce(cancellation_requested_at,clock_timestamp()),
    state=case when state in ('queued','retry_wait') then 'canceled' else state end
    where source_kind=p_kind and source_id=p_source and state in ('queued','retry_wait','leased','unknown');
end;
$$;
-- Separate typed trigger records also permit static PostgreSQL function lint;
-- no generic NEW record accesses fields absent on another attached relation.
create function private.notification_message_changed() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status='canceled' then perform private.notification_cancel_source('message',new.id);
  elsif new.status='sent' then perform private.notification_enqueue_source('message',new.id); end if;
  return new;
end;
$$;
create function private.notification_payment_changed() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.notification_enqueue_source('payment',new.event_id);
  return new;
end;
$$;
create function private.notification_schedule_changed() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op='DELETE' then
    perform private.notification_cancel_source('schedule',old.id); return old;
  end if;
  if new.status<>'published' then perform private.notification_cancel_source('schedule',new.id);
  else
    perform private.notification_enqueue_source('schedule',new.id);
    -- Include leased/unknown rows: a concurrent definitive completion may
    -- make them retry_wait while this transaction waits for another row.
    perform 1 from private.notification_jobs where source_kind='schedule' and source_id=new.id
      and state in ('queued','retry_wait','leased','unknown') order by id for update;
    -- Keep the actual non-send retry boundary, not a superseded event delay.
    -- A later edit may bring an event forward again after it was postponed.
    update private.notification_jobs j set next_attempt_at=greatest(clock_timestamp(),
      (select a.finished_at+make_interval(secs=>j.retry_seconds) from private.notification_attempts a
        where a.job_id=j.id and a.ordinal=j.attempt_count and a.state='not_sent'),
      new.starts_at-make_interval(secs=>cfg.schedule_lead_seconds)) from private.notification_policy cfg
      where j.source_kind='schedule' and j.source_id=new.id and j.state in ('queued','retry_wait');
  end if;
  return new;
end;
$$;
create trigger notification_message_source after insert or update of status on public.messages
  for each row execute function private.notification_message_changed();
create trigger notification_payment_source after insert on private.payment_event_verifications
  for each row execute function private.notification_payment_changed();
create trigger notification_schedule_source after insert or update on public.schedules
  for each row execute function private.notification_schedule_changed();
create trigger notification_schedule_delete before delete on public.schedules
  for each row execute function private.notification_schedule_changed();

create function public.notification_list_due(p_limit integer default 100) returns table(id uuid)
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_notification_service();
  if p_limit is null or p_limit not between 1 and 100 then
    raise exception 'NOTIFICATION_LIMIT_INVALID' using errcode='22023'; end if;
  return query select j.id from private.notification_jobs j
    where (j.state in ('queued','retry_wait') and j.next_attempt_at<=clock_timestamp())
      or (j.state='leased' and j.lease_expires_at<=clock_timestamp())
    order by j.next_attempt_at,j.id limit p_limit;
end;
$$;
-- Recovery can rediscover a crashed worker's token without exposing endpoints.
-- Reading uncertain handles never reclaims or permits a new send.
create function public.notification_list_uncertain(p_limit integer default 100,
  p_after_lease_expires_at timestamptz default null,p_after_job_id uuid default null)
returns table(job_id uuid,lease_token uuid,lease_expires_at timestamptz,cancellation_requested_at timestamptz)
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_notification_service();
  if p_limit is null or p_limit not between 1 and 100 then
    raise exception 'NOTIFICATION_LIMIT_INVALID' using errcode='22023'; end if;
  if (p_after_lease_expires_at is null)<>(p_after_job_id is null)
    or (p_after_lease_expires_at is not null and not isfinite(p_after_lease_expires_at)) then
    raise exception 'NOTIFICATION_CURSOR_INVALID' using errcode='22023'; end if;
  return query select j.id,j.lease_token,j.lease_expires_at,j.cancellation_requested_at
    from private.notification_jobs j where (j.state='unknown'
      or (j.state='leased' and j.lease_expires_at<=clock_timestamp()))
      and (p_after_lease_expires_at is null or (j.lease_expires_at,j.id)>(p_after_lease_expires_at,p_after_job_id))
    order by j.lease_expires_at,j.id limit p_limit;
end;
$$;
create function public.notification_claim(p_job_id uuid)
returns table(job_id uuid,lease_token uuid,lease_expires_at timestamptz,endpoint text,p256dh text,auth text,
  source_kind text,source_id uuid,route_kind text,route_id uuid)
language plpgsql security definer set search_path = '' as $$
declare j private.notification_jobs%rowtype; d private.push_subscriptions%rowtype; artist uuid; at_time timestamptz; schedule_due timestamptz;
begin
  perform private.require_notification_service();
  select * into j from private.notification_jobs where id=p_job_id;
  if j.id is null then return; end if;
  -- Authoritative serialization order matches existing identity, messaging and
  -- calendar RPCs. Never take a job lock before a source/eligibility lock.
  perform 1 from public.profiles where id=j.user_id for share;
  artist:=private.notification_source_artist(j.source_kind,j.source_id);
  perform 1 from public.artists where id=artist for share;
  perform 1 from public.subscriptions where user_id=j.user_id and artist_id=artist for share;
  if j.source_kind='message' then perform 1 from public.messages where id=j.source_id for share;
  elsif j.source_kind='payment' then perform 1 from public.payment_events where id=j.source_id for share;
  else perform 1 from public.schedules where id=j.source_id for share; end if;
  perform 1 from private.notification_preferences where user_id=j.user_id for share;
  select * into d from private.push_subscriptions where id=j.device_id for share;
  -- Policy change/revocation serializes before claim, and runtime eligibility
  -- uses current consent, while attempt limits keep the original job snapshot.
  perform 1 from private.notification_policy for share;
  if j.source_kind='message' then perform 1 from private.message_policy for share; end if;
  select * into j from private.notification_jobs where id=p_job_id for update skip locked;
  if j.id is null then return; end if;
  at_time:=clock_timestamp();
  if j.state='leased' and j.lease_expires_at<=at_time then
    update private.notification_jobs set state='unknown' where id=j.id;
    update private.notification_attempts set state='unknown' where token=j.lease_token and state='leased';
    return; -- An old worker may still be running; NEVER hand its job to another.
  end if;
  if j.state not in ('queued','retry_wait') or j.next_attempt_at>at_time then return; end if;
  if j.cancellation_requested_at is not null or not private.notification_eligible(
    j.source_kind,j.source_id,j.user_id,j.device_id,at_time) then
    update private.notification_jobs set state='canceled',cancellation_requested_at=coalesce(cancellation_requested_at,at_time)
      where id=j.id; return;
  end if;
  if j.source_kind='schedule' then
    -- A source can be postponed while already leased; a later proven non-send
    -- must not retry on its obsolete reminder date. Re-evaluate the current
    -- schedule/policy under their locks, not only in the source update hook.
    select s.starts_at-make_interval(secs=>cfg.schedule_lead_seconds) into schedule_due
      from public.schedules s cross join private.notification_policy cfg where s.id=j.source_id;
    if schedule_due>at_time then
      update private.notification_jobs set next_attempt_at=greatest(next_attempt_at,schedule_due) where id=j.id;
      return;
    end if;
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

create function public.notification_complete(p_job_id uuid,p_token uuid,p_outcome text,p_evidence_ref uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare j private.notification_jobs%rowtype; a private.notification_attempts%rowtype; device uuid; result text;
begin
  perform private.require_notification_service();
  if p_outcome is null or p_outcome not in ('provider_accepted','not_sent','unknown','dead_endpoint','permanent_failure')
    or (p_outcome<>'unknown' and p_evidence_ref is null) or p_token is null then
    raise exception 'NOTIFICATION_OUTCOME_INVALID' using errcode='22023'; end if;
  select * into j from private.notification_jobs where id=p_job_id;
  device:=j.device_id;
  -- Preferences can update multiple jobs for this recipient. Serialize on the
  -- profile before locking one job then cleaning up sibling endpoint jobs.
  perform 1 from public.profiles where id=j.user_id for share;
  -- Device first, including dead endpoint cleanup, so completion/revocation
  -- cannot invert claim's device->job lock order.
  perform 1 from private.push_subscriptions where id=device for update;
  if p_outcome='dead_endpoint' then
    -- Lock siblings BEFORE the primary job, in the same global UUID order as
    -- source cancellation. Device/source sets can overlap in a four-way cycle.
    perform 1 from private.notification_jobs where device_id=device
      and (state in ('queued','retry_wait','leased','unknown') or id=p_job_id) order by id for update;
  end if;
  select * into j from private.notification_jobs where id=p_job_id for update;
  select * into a from private.notification_attempts where job_id=p_job_id and token=p_token;
  if j.id is null or a.token is null then raise exception 'NOTIFICATION_LEASE_INVALID' using errcode='42501'; end if;
  if a.state not in ('leased','unknown') then
    if a.state=p_outcome and a.evidence_ref is not distinct from p_evidence_ref then return j.state; end if;
    raise exception 'NOTIFICATION_OUTCOME_CONFLICT' using errcode='23514';
  end if;
  if j.lease_token is distinct from p_token or j.state not in ('leased','unknown') then
    raise exception 'NOTIFICATION_LEASE_INVALID' using errcode='42501'; end if;
  if p_outcome='provider_accepted' then result:='provider_accepted';
  elsif p_outcome='unknown' then result:='unknown';
  elsif p_outcome='dead_endpoint' then result:='dead_endpoint';
  elsif p_outcome='permanent_failure' then result:='failed';
  elsif j.cancellation_requested_at is not null then result:='canceled';
  elsif j.attempt_count>=j.max_attempts then result:='failed';
  else result:='retry_wait'; end if;
  -- not_sent is an evidence-backed assertion of NO acceptance and NO active
  -- send left running, never a generic timeout/network error. No retry_unknown.
  update private.notification_attempts set state=p_outcome,evidence_ref=p_evidence_ref,
    finished_at=case when p_outcome='unknown' then null else clock_timestamp() end where token=p_token;
  update private.notification_jobs set state=result,
    next_attempt_at=case when result='retry_wait' then clock_timestamp()+make_interval(secs=>retry_seconds) else next_attempt_at end,
    provider_accepted_at=case when result='provider_accepted' then clock_timestamp() end where id=j.id;
  if p_outcome='dead_endpoint' then
    update private.push_subscriptions set state='dead',revoked_at=coalesce(revoked_at,clock_timestamp()) where id=device;
    update private.notification_jobs set cancellation_requested_at=coalesce(cancellation_requested_at,clock_timestamp()),
      state=case when state in ('queued','retry_wait') then 'canceled' else state end
      where device_id=device and id<>j.id and state in ('queued','retry_wait','leased','unknown');
  end if;
  return result;
end;
$$;

-- Explicit allowlist overrides permissive hosted default privileges.
do $$
declare fn regprocedure;
begin
  for fn in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where (n.nspname='public' and p.proname like 'notification\_%' escape '\')
      or (n.nspname='private' and (p.proname like 'notification\_%' escape '\' or p.proname='require_notification_service'))
  loop execute format('revoke all on function %s from public,anon,authenticated,service_role',fn); end loop;
end;
$$;
grant execute on function public.notification_capabilities() to anon,authenticated,service_role;
grant execute on function public.notification_get_preferences(),
  public.notification_set_preferences(boolean,boolean,boolean,boolean) to authenticated;
grant execute on function public.notification_register_device(uuid,text,text,text,text),
  public.notification_revoke_device(uuid,uuid),public.notification_enqueue(text,uuid),
  public.notification_list_due(integer),public.notification_list_uncertain(integer,timestamptz,uuid),public.notification_claim(uuid),
  public.notification_complete(uuid,uuid,text,uuid) to service_role;

comment on table private.push_subscriptions is
  'Sensitive private Web Push material. No client/table reads. Future server API must validate provider origins/keys and bind actor to session; no API is implemented here.';
comment on table private.notification_policy is
  'No default activation or consent assumption. Alimtalk provider/phone consent/template contract remain unconfigured and disabled.';
comment on table private.notification_jobs is
  'Transactional DB outbox, one source/channel/recipient/device identity. Provider acceptance is not device receipt. Canceled in-flight work can still be accepted; no recall guarantee.';
comment on function public.notification_complete(uuid,uuid,text,uuid) is
  'Trusted evidence-bound completion/reconciliation. Unknown/expired leases never automatically retry. not_sent certifies no acceptance and no worker still able to send. External exactly-once delivery is impossible here.';
comment on function public.messaging_dispatch(uuid) is
  'DB-only due-message transition and eligible private transactional Web Push outbox. No delivery provider or dispatcher is implemented.';
commit;
