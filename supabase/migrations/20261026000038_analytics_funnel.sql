-- Current-consent aggregate visibility only. No policy, consent, role, business
-- metric definition, backfill, source hook, external collector or scheduler.
begin;

create table private.analytics_dashboard_coverage (
  singleton boolean primary key default true check(singleton),
  instrumentation_from timestamptz not null default clock_timestamp()
    check(isfinite(instrumentation_from))
);
alter table private.analytics_dashboard_coverage enable row level security;
revoke all on private.analytics_dashboard_coverage from public,anon,authenticated,service_role;
insert into private.analytics_dashboard_coverage(singleton) values(true);

create function private.analytics_dashboard_coverage_immutable() returns trigger
language plpgsql set search_path='' as $$
begin raise exception 'ANALYTICS_DASHBOARD_COVERAGE_IMMUTABLE' using errcode='55000'; end;
$$;
create trigger analytics_dashboard_coverage_immutable before update or delete on private.analytics_dashboard_coverage
  for each row execute function private.analytics_dashboard_coverage_immutable();
create trigger analytics_dashboard_coverage_no_truncate before truncate on private.analytics_dashboard_coverage
  for each statement execute function private.analytics_dashboard_coverage_immutable();

create function private.analytics_dashboard_actor() returns uuid
language plpgsql security definer set search_path='' as $$
declare actor public.profiles%rowtype;
begin
  if current_setting('transaction_isolation')<>'read committed' then
    raise exception 'ANALYTICS_DASHBOARD_ISOLATION_UNSUPPORTED' using errcode='25001'; end if;
  if current_setting('role',true) is distinct from 'authenticated' then
    raise exception 'ANALYTICS_DASHBOARD_FORBIDDEN' using errcode='42501'; end if;
  select * into actor from public.profiles where id=auth.uid() for share;
  if actor.id is null or actor.role<>'admin' or
    (actor.is_restricted and (actor.restricted_until is null or actor.restricted_until>clock_timestamp())) then
    raise exception 'ANALYTICS_DASHBOARD_FORBIDDEN' using errcode='42501'; end if;
  return actor.id;
end;
$$;

create function public.admin_analytics_dashboard(p_from date,p_to date) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare actor uuid; cfg private.analytics_policy%rowtype; document private.onboarding_documents%rowtype;
  snapshot_at timestamptz; window_start_value timestamptz; window_end_value timestamptz;
  coverage_at timestamptz; collection_status text; event_rows jsonb; daily_rows jsonb; largest_count bigint;
begin
  -- Preliminary authorization does not lock out of UUID order. Current role is
  -- checked again under all ordered profile locks below.
  if current_setting('transaction_isolation')<>'read committed' then
    raise exception 'ANALYTICS_DASHBOARD_ISOLATION_UNSUPPORTED' using errcode='25001'; end if;
  if current_setting('role',true) is distinct from 'authenticated'
    or private.current_user_role() is distinct from 'admin' then
    raise exception 'ANALYTICS_DASHBOARD_FORBIDDEN' using errcode='42501'; end if;
  snapshot_at:=clock_timestamp();
  if p_from is null or p_to is null or not isfinite(p_from) or not isfinite(p_to)
    or p_from<date '2000-01-01' or p_to<p_from
    or p_to>(snapshot_at at time zone 'Asia/Seoul')::date or p_to-p_from>=366 then
    raise exception 'ANALYTICS_DASHBOARD_INVALID_INPUT' using errcode='22023'; end if;
  window_start_value:=p_from::timestamp at time zone 'Asia/Seoul';
  window_end_value:=(p_to+1)::timestamp at time zone 'Asia/Seoul';

  -- Profile -> policy -> document matches consent/ingestion lock ordering.
  -- Lock every window participant, including currently withdrawn/restricted
  -- actors, before evaluating current eligibility. A withdrawal that committed
  -- while this request waited must not be resurrected by its earlier snapshot.
  -- The recorded-time fence excludes new participants arriving after this scan.
  perform p.id from public.profiles p where p.id=auth.uid() or exists(
    select 1 from private.analytics_events e where e.user_id=p.id
      and e.occurred_at>=window_start_value and e.occurred_at<window_end_value
      and e.recorded_at<=snapshot_at)
    order by p.id for share;
  actor:=private.analytics_dashboard_actor();
  select * into cfg from private.analytics_policy where singleton for share;
  select * into document from private.onboarding_documents
    where version=cfg.consent_version and kind='analytics' for share;
  collection_status:=case
    when cfg.singleton is null or document.version is null or document.approved_at is null
      or document.approved_at>clock_timestamp() or document.published_at is null
      or document.published_at>clock_timestamp() then 'unconfigured'
    when not cfg.enabled then 'disabled' else 'enabled' end;
  select instrumentation_from into coverage_at from private.analytics_dashboard_coverage where singleton;

  if collection_status='enabled' then
    with eligible as materialized(
      select e.name,(e.occurred_at at time zone 'Asia/Seoul')::date as day_kst
      from private.analytics_events e
      join private.analytics_consents c on c.user_id=e.user_id
        and c.granted and c.consent_version=cfg.consent_version
      join public.profiles p on p.id=e.user_id and p.role='fan' and p.onboarding_completed_at is not null
      where e.consent_version=cfg.consent_version and e.occurred_at>=c.granted_at
        and not(p.is_restricted and (p.restricted_until is null or p.restricted_until>clock_timestamp()))
        and e.occurred_at>=window_start_value and e.occurred_at<window_end_value
        and e.recorded_at<=snapshot_at
        and e.recorded_at>=snapshot_at-make_interval(days=>cfg.retention_days)),
    totals as materialized(select name,count(*) as event_count from eligible group by name),
    days as materialized(select day_kst,name,count(*) as event_count from eligible group by day_kst,name)
    select (select jsonb_agg(jsonb_build_object('name',n.name,'event_count',coalesce(t.event_count,0)) order by n.position)
      from unnest(enum_range(null::public.analytics_event_name)) with ordinality n(name,position)
      left join totals t using(name)),
      coalesce((select jsonb_agg(to_jsonb(d) order by d.day_kst,d.name) from days d),'[]'::jsonb),
      coalesce((select max(event_count) from totals),0)
    into event_rows,daily_rows,largest_count;
    if largest_count>9007199254740991 then
      raise exception 'ANALYTICS_DASHBOARD_COUNT_OUT_OF_RANGE' using errcode='22003'; end if;
  else
    select jsonb_agg(jsonb_build_object('name',n.name,'event_count',null) order by n.position)
      into event_rows from unnest(enum_range(null::public.analytics_event_name)) with ordinality n(name,position);
    daily_rows:='[]'::jsonb;
  end if;
  return jsonb_build_object('actor_id',actor,'as_of',snapshot_at,'from',to_char(p_from,'YYYY-MM-DD'),
    'to',to_char(p_to,'YYYY-MM-DD'),'window_start',window_start_value,'window_end',window_end_value,
    'time_zone','Asia/Seoul','collection',jsonb_build_object('status',collection_status,
      'retention_days',case when collection_status<>'unconfigured' then cfg.retention_days end),
    'coverage',jsonb_build_object('instrumentation_from',coverage_at,'history_complete',false,
      'mode','current_consent_observations'),'events',event_rows,'daily',daily_rows,
    'business_metrics',jsonb_build_object('configured',false,'reason','definitions_unapproved','expected_count',4));
end;
$$;

-- Opt-in prospective source capture. Legacy receipt APIs remain byte-for-byte
-- unchanged: the application adopts these stricter wrappers explicitly.
create function private.analytics_capture_ready(p_actor_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare cfg private.analytics_policy%rowtype; document private.onboarding_documents%rowtype;
begin
  perform private.require_analytics_service();
  if current_setting('transaction_isolation')<>'read committed' then
    raise exception 'ANALYTICS_CAPTURE_ISOLATION_UNSUPPORTED' using errcode='25001'; end if;
  perform 1 from public.profiles where id=p_actor_id for share;
  if not private.analytics_actor_allowed(p_actor_id,clock_timestamp()) then
    raise exception 'ANALYTICS_ACTOR_FORBIDDEN' using errcode='42501'; end if;
  select * into cfg from private.analytics_policy where singleton for share;
  select * into document from private.onboarding_documents
    where version=cfg.consent_version and kind='analytics' for share;
  if cfg.singleton is null or not cfg.enabled or document.version is null
    or document.approved_at is null or document.approved_at>clock_timestamp()
    or document.published_at is null or document.published_at>clock_timestamp() then
    raise exception 'ANALYTICS_CAPTURE_POLICY_REQUIRED' using errcode='55000'; end if;
end;
$$;
create function private.analytics_capture_time(p_occurred timestamptz) returns void
language plpgsql security definer set search_path='' as $$
begin
  if p_occurred is null then raise exception 'ANALYTICS_SOURCE_FORBIDDEN' using errcode='42501'; end if;
  if not exists(select 1 from private.analytics_dashboard_coverage where singleton
    and p_occurred>=instrumentation_from) then
    raise exception 'ANALYTICS_CAPTURE_SOURCE_BEFORE_START' using errcode='55000'; end if;
end;
$$;
create function public.analytics_capture_server(p_actor_id uuid,p_event_key uuid,p_name public.analytics_event_name,
  p_source_id uuid default null,p_font_scale public.font_scale default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare happened timestamptz;
begin
  perform private.analytics_capture_ready(p_actor_id);
  if p_name is null or p_name in('message_open','voice_input_used','subscribe_complete','renew') then
    raise exception 'ANALYTICS_SERVER_EVENT_FORBIDDEN' using errcode='42501'; end if;
  case p_name
    when 'signup_complete' then
      select onboarding_completed_at into happened from public.profiles where id=p_actor_id;
    when 'font_size_selected' then
      -- font_selected_at is the first selection, not the current value's change
      -- receipt. Pairing it with today's font would fabricate an occurrence.
      raise exception 'ANALYTICS_CAPTURE_SOURCE_UNAVAILABLE' using errcode='55000';
    when 'preview_view' then
      perform 1 from public.messages where id=p_source_id for share;
      if private.message_is_visible(p_actor_id,p_source_id,true,clock_timestamp()) then happened:=clock_timestamp(); end if;
    when 'subscribe_start' then
      -- A re-enrollment reuses the subscription, but not its enrollment session.
      -- Do not relabel a stale start as current merely because its read retried.
      select e.created_at into happened from private.subscription_enrollments e
        join public.subscriptions s on s.id=e.subscription_id and s.user_id=e.user_id
        where e.session_id=p_event_key and e.user_id=p_actor_id and e.subscription_id=p_source_id
        for share of s,e;
    when 'subscribe_fail' then
      select a.finished_at into happened from private.payment_attempts a
        join private.billing_obligations o on o.id=a.obligation_id
        join public.subscriptions s on s.id=o.subscription_id
        where a.id=p_source_id and a.state='failed' and a.outcome_evidence_ref is not null and s.user_id=p_actor_id
        for share of s,a,o;
    when 'cancel' then
      select s.canceled_at into happened from public.subscriptions s
        join private.subscription_cancellation_history h on h.subscription_id=s.id and h.canceled_at=s.canceled_at
        where s.id=p_source_id and s.user_id=p_actor_id and s.status='canceled'
          and h.source='observed' and h.id=p_event_key for share of s;
    when 'reply_sent' then
      select created_at into happened from public.replies where id=p_source_id and user_id=p_actor_id and not is_blocked for share;
    when 'post_create' then
      select created_at into happened from public.posts where id=p_source_id and user_id=p_actor_id for share;
    when 'attendance' then
      select created_at into happened from private.point_ledger where id=p_source_id and user_id=p_actor_id and reason='attendance';
    else raise exception 'ANALYTICS_SERVER_EVENT_FORBIDDEN' using errcode='42501';
  end case;
  perform private.analytics_capture_time(happened);
  return private.analytics_append(p_actor_id,p_event_key,p_name,'server',p_source_id,p_font_scale,null,happened);
end;
$$;
create function public.analytics_capture_charge(p_event_id uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare actor uuid; happened timestamptz;
begin
  perform private.require_analytics_service();
  select s.user_id,e.occurred_at into actor,happened from public.payment_events e
    join public.subscriptions s on s.id=e.subscription_id
    where e.id=p_event_id and e.kind='charge';
  if actor is null then raise exception 'ANALYTICS_VERIFIED_CHARGE_REQUIRED' using errcode='42501'; end if;
  perform private.analytics_capture_ready(actor);
  perform private.analytics_capture_time(happened);
  -- Classification, immutable verification, current consent and canonical
  -- charge identity remain derived by the original verified-ledger boundary.
  return public.analytics_record_charge(p_event_id);
end;
$$;
create function public.analytics_record_cancellation(p_actor_id uuid,p_subscription_id uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare event_key_value uuid;
begin
  perform private.analytics_capture_ready(p_actor_id);
  select h.id into event_key_value from public.subscriptions s
    join private.subscription_cancellation_history h on h.subscription_id=s.id and h.canceled_at=s.canceled_at
    where s.id=p_subscription_id and s.user_id=p_actor_id and s.status='canceled' and h.source='observed'
    for share of s;
  if event_key_value is null then raise exception 'ANALYTICS_SOURCE_FORBIDDEN' using errcode='42501'; end if;
  return public.analytics_capture_server(p_actor_id,event_key_value,'cancel',p_subscription_id);
end;
$$;
revoke all on function private.analytics_capture_ready(uuid),private.analytics_capture_time(timestamptz)
  from public,anon,authenticated,service_role;
revoke all on function public.analytics_capture_server(uuid,uuid,public.analytics_event_name,uuid,public.font_scale),
  public.analytics_capture_charge(uuid),public.analytics_record_cancellation(uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.analytics_capture_server(uuid,uuid,public.analytics_event_name,uuid,public.font_scale),
  public.analytics_capture_charge(uuid),public.analytics_record_cancellation(uuid,uuid) to service_role;
comment on function public.analytics_capture_server(uuid,uuid,public.analytics_event_name,uuid,public.font_scale) is
  'Prospective approved-document capture only. Real immutable source time must follow migration marker and current consent. Subscription start key is enrollment session; cancellation key is current observed history epoch. No caller-provided time or arbitrary properties.';
comment on function public.analytics_capture_charge(uuid) is
  'Prospective verified immutable charge capture; no replay backfill of pre-instrumentation source. Does not alter billing state or infer success from provider responses.';
comment on function public.analytics_record_cancellation(uuid,uuid) is
  'Prospective current cancellation capture deriving stable event key from immutable observed history; repeated cancellation epochs remain distinct. No retained-marker reconstruction.';

revoke all on function private.analytics_dashboard_coverage_immutable(),private.analytics_dashboard_actor()
  from public,anon,authenticated,service_role;
revoke all on function public.admin_analytics_dashboard(date,date) from public,anon,authenticated,service_role;
grant execute on function public.admin_analytics_dashboard(date,date) to authenticated;
comment on table private.analytics_dashboard_coverage is
  'Immutable migration installation timestamp, not application activation or complete collection. No old event, consent or financial row is changed or backfilled.';
comment on function public.admin_analytics_dashboard(date,date) is
  'Current authorized admin aggregate only: inclusive KST window, current enabled published-policy consent and eligible fans, current grant epoch, recorded retention horizon. Withdrawal excludes retained rows without erasing them. No user/source dimensions or four unapproved business metric definitions.';
commit;
