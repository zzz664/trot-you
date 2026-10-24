-- First-party event DB foundation only. No endpoint, SDK, external analytics or
-- automatic collection. Approved consent/retention policy is deliberately absent.
begin;

create type public.analytics_event_name as enum (
  'signup_complete','font_size_selected','preview_view','subscribe_start',
  'subscribe_complete','subscribe_fail','message_open','reply_sent',
  'voice_input_used','renew','cancel','post_create','attendance'
);
create type public.analytics_voice_context as enum ('reply','post','comment');

create table private.analytics_policy (
  singleton boolean primary key default true check (singleton),
  consent_version uuid not null,
  enabled boolean not null,
  retention_days integer not null check (retention_days between 1 and 3650)
);
create table private.analytics_consents (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  consent_version uuid not null,
  granted boolean not null,
  granted_at timestamptz not null check (isfinite(granted_at)),
  updated_at timestamptz not null check (isfinite(updated_at))
);
-- Nonpartitioned MVP: a legal single-column primary key, no missing future
-- partitions. A name/time index serves bounded aggregates; recorded time serves
-- bounded retention batches. No arbitrary JSON/text properties or device IDs.
create table private.analytics_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  event_key uuid not null,
  name public.analytics_event_name not null,
  origin text not null check (origin in ('client','server','verified_charge')),
  source_id uuid,
  font_scale public.font_scale,
  voice_context public.analytics_voice_context,
  consent_version uuid not null,
  occurred_at timestamptz not null check (isfinite(occurred_at)),
  recorded_at timestamptz not null check (isfinite(recorded_at) and recorded_at >= occurred_at),
  unique (user_id,origin,event_key),
  check ((name='signup_complete' and source_id is null and font_scale is null and voice_context is null)
    or (name='font_size_selected' and source_id is null and font_scale is not null and voice_context is null)
    or (name='voice_input_used' and source_id is null and font_scale is null and voice_context is not null)
    or (name not in ('signup_complete','font_size_selected','voice_input_used')
      and source_id is not null and font_scale is null and voice_context is null)),
  check ((origin='client' and name in ('message_open','voice_input_used'))
    or (origin='verified_charge' and name in ('subscribe_complete','renew'))
    or (origin='server' and name not in ('message_open','voice_input_used','subscribe_complete','renew')))
);
create index analytics_events_name_time_idx on private.analytics_events(name,occurred_at);
create index analytics_events_time_idx on private.analytics_events(occurred_at,id);
create index analytics_events_recorded_idx on private.analytics_events(recorded_at,id);
create unique index analytics_events_source_once_idx on private.analytics_events(user_id,name,source_id)
  where name in ('subscribe_complete','renew','subscribe_fail','reply_sent','post_create','attendance');
create unique index analytics_events_cancel_once_idx on private.analytics_events(user_id,name,source_id,occurred_at)
  where name='cancel';
create unique index analytics_events_signup_once_idx on private.analytics_events(user_id,name)
  where name='signup_complete';

alter table private.analytics_policy enable row level security;
alter table private.analytics_consents enable row level security;
alter table private.analytics_events enable row level security;
revoke all on private.analytics_policy,private.analytics_consents,private.analytics_events
  from public,anon,authenticated,service_role;

create function private.require_analytics_service() returns void
language plpgsql set search_path = '' as $$
begin
  if current_setting('role',true) is distinct from 'service_role' then
    raise exception 'ANALYTICS_SERVICE_REQUIRED' using errcode='42501'; end if;
end;
$$;
create function private.analytics_actor_allowed(p_user uuid,p_at timestamptz,p_onboarded boolean default true)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.profiles where id=p_user and role='fan'
    and (not p_onboarded or onboarding_completed_at is not null)
    and not (is_restricted and (restricted_until is null or restricted_until>p_at)));
$$;
create function public.analytics_get_consent()
returns table(granted boolean,consent_version uuid,collection_enabled boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'ANALYTICS_ACTOR_FORBIDDEN' using errcode='42501'; end if;
  return query select coalesce(c.granted and c.consent_version=p.consent_version and p.enabled,false),
    p.consent_version,coalesce(p.enabled,false)
    from (select true as singleton) x left join private.analytics_policy p using(singleton)
    left join private.analytics_consents c on c.user_id=auth.uid();
end;
$$;
create function public.analytics_set_consent(p_granted boolean,p_consent_version uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare cfg private.analytics_policy%rowtype;
begin
  -- Same profile lock precedes collection: a committed withdrawal wins over
  -- later collection. Withdrawal is possible even while restricted/disabled.
  perform 1 from public.profiles where id=auth.uid() for update;
  if auth.uid() is null or not found then raise exception 'ANALYTICS_ACTOR_FORBIDDEN' using errcode='42501'; end if;
  if p_granted is null then raise exception 'ANALYTICS_CONSENT_REQUIRED' using errcode='22004'; end if;
  if not p_granted then
    update private.analytics_consents set granted=false,updated_at=clock_timestamp() where user_id=auth.uid();
    return;
  end if;
  if not private.analytics_actor_allowed(auth.uid(),clock_timestamp(),false) then
    raise exception 'ANALYTICS_ACTOR_FORBIDDEN' using errcode='42501'; end if;
  select * into cfg from private.analytics_policy for share;
  if cfg.singleton is null or not cfg.enabled or p_consent_version is distinct from cfg.consent_version then
    raise exception 'ANALYTICS_CONSENT_REQUIRED' using errcode='55000'; end if;
  insert into private.analytics_consents(user_id,consent_version,granted,granted_at,updated_at)
    values(auth.uid(),cfg.consent_version,true,clock_timestamp(),clock_timestamp())
    on conflict(user_id) do update set consent_version=excluded.consent_version,granted=true,
      granted_at=case when analytics_consents.granted and analytics_consents.consent_version=excluded.consent_version
        then analytics_consents.granted_at else excluded.granted_at end,updated_at=excluded.updated_at;
end;
$$;

create function private.analytics_append(p_user uuid,p_event_key uuid,p_name public.analytics_event_name,
  p_origin text,p_source uuid,p_font public.font_scale,p_voice public.analytics_voice_context,p_occurred timestamptz)
returns uuid language plpgsql security definer set search_path = '' as $$
declare cfg private.analytics_policy%rowtype; consent private.analytics_consents%rowtype;
  e private.analytics_events%rowtype; at_time timestamptz;
begin
  perform 1 from public.profiles where id=p_user for share;
  at_time:=clock_timestamp();
  if not private.analytics_actor_allowed(p_user,at_time) then
    raise exception 'ANALYTICS_ACTOR_FORBIDDEN' using errcode='42501'; end if;
  select * into cfg from private.analytics_policy for share;
  select * into consent from private.analytics_consents where user_id=p_user;
  if cfg.singleton is null or not cfg.enabled or consent.user_id is null or not consent.granted
    or consent.consent_version<>cfg.consent_version then
    raise exception 'ANALYTICS_CONSENT_REQUIRED' using errcode='55000'; end if;
  if p_event_key is null or p_name is null or p_occurred is null then
    raise exception 'ANALYTICS_EVENT_REQUIRED' using errcode='22004'; end if;
  if not isfinite(p_occurred) or p_occurred>at_time or p_occurred<consent.granted_at
    or p_occurred<at_time-make_interval(days=>cfg.retention_days) then
    raise exception 'ANALYTICS_EVENT_TIME_INVALID' using errcode='22023'; end if;
  insert into private.analytics_events(user_id,event_key,name,origin,source_id,font_scale,voice_context,
    consent_version,occurred_at,recorded_at)
    values(p_user,p_event_key,p_name,p_origin,p_source,p_font,p_voice,cfg.consent_version,p_occurred,at_time)
    on conflict do nothing returning * into e;
  if e.id is not null then return e.id; end if;
  -- Retry keys are namespaced by authority so a client cannot reserve a known
  -- ledger UUID to suppress its verified charge metric. Unique indexes serialize retries; the following READ COMMITTED statement
  -- sees the winner after waiting. Reusing a key with different data is an error.
  select * into e from private.analytics_events where user_id=p_user and origin=p_origin and event_key=p_event_key;
  if e.id is null then
    select * into e from private.analytics_events where user_id=p_user and name=p_name
      and (name='signup_complete' or (source_id=p_source and name in
        ('subscribe_complete','renew','subscribe_fail','reply_sent','post_create','attendance')));
  end if;
  if e.id is null or e.event_key<>p_event_key or e.name<>p_name or e.origin<>p_origin or e.source_id is distinct from p_source
    or e.font_scale is distinct from p_font or e.voice_context is distinct from p_voice
    or (p_name in ('signup_complete','subscribe_complete','renew','subscribe_fail','reply_sent','post_create','attendance','cancel')
      and e.occurred_at is distinct from p_occurred) then
    raise exception 'ANALYTICS_EVENT_CONFLICT' using errcode='23514'; end if;
  return e.id;
end;
$$;

create function public.analytics_record_client(p_event_key uuid,p_name public.analytics_event_name,
  p_source_id uuid default null,p_voice_context public.analytics_voice_context default null)
returns uuid language plpgsql security definer set search_path = '' as $$
begin
  if p_name is null or p_name not in ('message_open','voice_input_used') then
    raise exception 'ANALYTICS_CLIENT_EVENT_FORBIDDEN' using errcode='42501'; end if;
  if p_name='message_open' and not private.message_is_visible(auth.uid(),p_source_id,false,clock_timestamp()) then
    raise exception 'ANALYTICS_SOURCE_FORBIDDEN' using errcode='42501'; end if;
  -- Observations, not proof of viewing/voice use. No client time or actor argument.
  return private.analytics_append(auth.uid(),p_event_key,p_name,'client',p_source_id,null,p_voice_context,clock_timestamp());
end;
$$;

create function public.analytics_record_server(p_actor_id uuid,p_event_key uuid,p_name public.analytics_event_name,
  p_source_id uuid default null,p_font_scale public.font_scale default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare happened timestamptz; actual_font public.font_scale;
begin
  perform private.require_analytics_service();
  if p_name is null or p_name in ('message_open','voice_input_used','subscribe_complete','renew') then
    raise exception 'ANALYTICS_SERVER_EVENT_FORBIDDEN' using errcode='42501'; end if;
  case p_name
    when 'signup_complete' then
      select onboarding_completed_at into happened from public.profiles where id=p_actor_id;
    when 'font_size_selected' then
      select font_scale into actual_font from public.profiles where id=p_actor_id;
      if p_font_scale is distinct from actual_font then
        raise exception 'ANALYTICS_SOURCE_FORBIDDEN' using errcode='42501'; end if;
      happened:=clock_timestamp();
    when 'preview_view' then
      if private.message_is_visible(p_actor_id,p_source_id,true,clock_timestamp()) then happened:=clock_timestamp(); end if;
    when 'subscribe_start' then
      select clock_timestamp() into happened from public.subscriptions
        where id=p_source_id and user_id=p_actor_id and status='pending';
    when 'subscribe_fail' then
      select a.finished_at into happened from private.payment_attempts a
        join private.billing_obligations o on o.id=a.obligation_id
        join public.subscriptions s on s.id=o.subscription_id
        where a.id=p_source_id and a.state='failed' and a.outcome_evidence_ref is not null and s.user_id=p_actor_id;
    when 'cancel' then
      select canceled_at into happened from public.subscriptions where id=p_source_id and user_id=p_actor_id and status='canceled';
    when 'reply_sent' then
      select created_at into happened from public.replies where id=p_source_id and user_id=p_actor_id;
    when 'post_create' then
      select created_at into happened from public.posts where id=p_source_id and user_id=p_actor_id;
    when 'attendance' then
      select created_at into happened from private.point_ledger where id=p_source_id and user_id=p_actor_id and reason='attendance';
    else raise exception 'ANALYTICS_SERVER_EVENT_FORBIDDEN' using errcode='42501';
  end case;
  if happened is null then raise exception 'ANALYTICS_SOURCE_FORBIDDEN' using errcode='42501'; end if;
  return private.analytics_append(p_actor_id,p_event_key,p_name,'server',p_source_id,p_font_scale,null,happened);
end;
$$;

create function public.analytics_record_charge(p_event_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare actor uuid; happened timestamptz; initial boolean; event_name public.analytics_event_name;
begin
  perform private.require_analytics_service();
  -- Derive actor, type and time from verified immutable evidence. The caller
  -- cannot label renewals as purchases or turn attempts/refunds into revenue.
  select s.user_id,e.occurred_at,o.is_initial into actor,happened,initial
    from public.payment_events e join private.payment_event_verifications v on v.event_id=e.id
    join private.payment_attempts a on a.id=v.attempt_id
    join private.billing_obligations o on o.id=a.obligation_id and o.subscription_id=e.subscription_id
    join public.subscriptions s on s.id=e.subscription_id
    where e.id=p_event_id and e.kind='charge' and a.state='success' and o.state='settled';
  if actor is null then raise exception 'ANALYTICS_VERIFIED_CHARGE_REQUIRED' using errcode='42501'; end if;
  event_name:=case when initial then 'subscribe_complete'::public.analytics_event_name else 'renew'::public.analytics_event_name end;
  return private.analytics_append(actor,p_event_id,event_name,'verified_charge',p_event_id,null,null,happened);
end;
$$;

create function public.analytics_daily_counts(p_from date,p_until date)
returns table(day_kst date,name public.analytics_event_name,event_count bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  if current_setting('role',true) is distinct from 'service_role' and
    (current_setting('role',true) is distinct from 'authenticated' or private.current_user_role() is distinct from 'admin') then
    raise exception 'ANALYTICS_ADMIN_REQUIRED' using errcode='42501'; end if;
  if p_from is null or p_until is null or not isfinite(p_from) or not isfinite(p_until)
    or p_from<date '0001-01-01' or p_until>date '9999-12-31'
    or p_until<=p_from or p_until-p_from>366 then
    raise exception 'ANALYTICS_RANGE_INVALID' using errcode='22023'; end if;
  -- Explicit [from,until) KST calendar dates, independent of session timezone.
  -- Counts only; no actor/source dimensions, raw properties or invented funnels.
  return query select (e.occurred_at at time zone 'Asia/Seoul')::date,e.name,count(*)
    from private.analytics_events e
    where e.occurred_at >= (p_from::timestamp at time zone 'Asia/Seoul')
      and e.occurred_at < (p_until::timestamp at time zone 'Asia/Seoul')
    group by 1,2 order by 1,2;
end;
$$;

create function public.analytics_purge_expired(p_limit integer default 1000) returns integer
language plpgsql security definer set search_path = '' as $$
declare cfg private.analytics_policy%rowtype; removed integer;
begin
  perform private.require_analytics_service();
  if p_limit is null or p_limit not between 1 and 10000 then
    raise exception 'ANALYTICS_LIMIT_INVALID' using errcode='22023'; end if;
  select * into cfg from private.analytics_policy for share;
  if cfg.singleton is null then raise exception 'ANALYTICS_POLICY_REQUIRED' using errcode='55000'; end if;
  -- No scheduler/production execution here. Use recorded time so delayed events
  -- still have a full dedupe horizon, never erase a financial source ledger.
  with expired as (
    select id from private.analytics_events where recorded_at<clock_timestamp()-make_interval(days=>cfg.retention_days)
      order by recorded_at,id limit p_limit for update skip locked
  ) delete from private.analytics_events e using expired x where e.id=x.id;
  get diagnostics removed=row_count;
  return removed;
end;
$$;

revoke all on function private.require_analytics_service(),private.analytics_actor_allowed(uuid,timestamptz,boolean),
  private.analytics_append(uuid,uuid,public.analytics_event_name,text,uuid,public.font_scale,public.analytics_voice_context,timestamptz)
  from public,anon,authenticated,service_role;
revoke all on function public.analytics_get_consent(),public.analytics_set_consent(boolean,uuid),
  public.analytics_record_client(uuid,public.analytics_event_name,uuid,public.analytics_voice_context),
  public.analytics_record_server(uuid,uuid,public.analytics_event_name,uuid,public.font_scale),
  public.analytics_record_charge(uuid),public.analytics_daily_counts(date,date),public.analytics_purge_expired(integer)
  from public,anon,authenticated,service_role;
grant execute on function public.analytics_get_consent(),public.analytics_set_consent(boolean,uuid),
  public.analytics_record_client(uuid,public.analytics_event_name,uuid,public.analytics_voice_context),
  public.analytics_daily_counts(date,date) to authenticated;
grant execute on function public.analytics_record_server(uuid,uuid,public.analytics_event_name,uuid,public.font_scale),
  public.analytics_record_charge(uuid),public.analytics_daily_counts(date,date),public.analytics_purge_expired(integer) to service_role;

comment on table private.analytics_events is
  'Consented first-party observations only; raw rows private. Retry keys dedupe while retained. Anonymous acquisition and four funnel definitions remain pending.';
comment on function public.analytics_record_server(uuid,uuid,public.analytics_event_name,uuid,public.font_scale) is
  'Trusted server-only entry: bind actor to verified session, pass a stable retry key. Not an HTTP endpoint or automatic source hook.';
comment on function public.analytics_record_charge(uuid) is
  'Call only after billing_finalize_charge succeeds (or replay verified ledger). Does not charge, refund or alter financial state. Opt-in collection can be absent.';
commit;
