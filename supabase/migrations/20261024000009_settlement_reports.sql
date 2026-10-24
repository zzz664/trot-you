-- Reporting only: no transfer, account details, provider call or policy activation.
begin;

create type public.settlement_status as enum ('draft','confirmed');
create table private.settlement_policies (
  id uuid primary key default gen_random_uuid(),
  artist_id uuid not null references public.artists(id),
  month date not null check (isfinite(month) and extract(day from month)=1),
  enabled boolean not null default false,
  contract_from date not null check (isfinite(contract_from)),
  contract_until date not null check (isfinite(contract_until) and contract_until>contract_from),
  base_rate numeric not null check (base_rate between 0 and 1 and scale(base_rate)<=6),
  performance_rate numeric not null check (performance_rate between 0 and 1 and scale(performance_rate)<=6),
  -- Conditions are unresolved; do not activate an invented performance threshold.
  performance_conditions jsonb check (performance_conditions is null),
  vat_rate numeric not null check (vat_rate between 0 and 1 and scale(vat_rate)<=6),
  pg_fee_rate numeric not null check (pg_fee_rate between 0 and 1 and scale(pg_fee_rate)<=6),
  activity_enabled boolean not null default false,
  weekly_message_min integer,
  weekly_photo_min integer,
  partial_week_policy text not null default 'block' check (partial_week_policy in ('block','prorate_days')),
  negative_net_policy text not null default 'block' check (negative_net_policy='block'),
  late_event_policy text not null default 'block' check (late_event_policy in ('block','explicit_current_formula')),
  unique(artist_id,month),
  check ((activity_enabled and weekly_message_min>0 and weekly_photo_min>0
    and weekly_message_min is not null and weekly_photo_min is not null)
    or (not activity_enabled and weekly_message_min is null and weekly_photo_min is null))
);
create table private.settlement_source_versions (
  version bigint generated always as identity primary key,
  artist_id uuid not null
);
create index settlement_source_versions_artist_idx on private.settlement_source_versions(artist_id,version desc);
create table public.settlements (
  id uuid primary key default gen_random_uuid(),
  artist_id uuid not null references public.artists(id),
  month date not null check (isfinite(month) and extract(day from month)=1),
  period_start timestamptz not null,
  period_end timestamptz not null check(period_end>period_start),
  currency text not null default 'KRW' check(currency='KRW'),
  status public.settlement_status not null default 'draft',
  revision uuid not null default gen_random_uuid(),
  policy_snapshot jsonb not null,
  source_version bigint not null,
  source_event_count bigint not null,
  source_message_count bigint not null,
  gross_krw numeric not null,
  current_gross_krw numeric not null,
  adjustment_gross_krw numeric not null,
  vat_krw numeric not null,
  pg_fee_krw numeric not null,
  base_amount_krw numeric not null,
  rate numeric not null,
  activity_ratio numeric not null,
  deduction_krw numeric not null,
  unrounded_final_krw numeric not null,
  final_amount_krw numeric not null,
  -- Decimal display values are accompanied by exact integer rational pairs.
  -- Repeating decimal division never decides a half-KRW rounding boundary.
  exact_components jsonb not null,
  calculated_at timestamptz not null,
  confirmed_at timestamptz,
  unique(artist_id,month),
  check(gross_krw=current_gross_krw+adjustment_gross_krw),
  check((status='draft' and confirmed_at is null) or (status='confirmed' and confirmed_at is not null))
);
create table private.settlement_event_sources (
  report_id uuid not null references public.settlements(id),
  event_id uuid not null unique,
  kind public.payment_event_kind not null,
  amount_krw integer not null,
  occurred_at timestamptz not null,
  origin text not null check(origin in ('current','adjustment')),
  primary key(report_id,event_id)
);
create table private.settlement_message_sources (
  report_id uuid not null references public.settlements(id),
  message_id uuid not null,
  type public.message_type not null,
  sent_at timestamptz not null,
  primary key(report_id,message_id)
);
create table public.settlement_weekly_stats (
  report_id uuid not null references public.settlements(id),
  week_start date not null check(extract(isodow from week_start)=1),
  window_start date not null,
  window_end date not null check(window_end>window_start),
  message_count bigint not null check(message_count>=0),
  photo_count bigint not null check(photo_count>=0 and photo_count<=message_count),
  message_required numeric not null,
  photo_required numeric not null,
  primary key(report_id,week_start)
);
create table private.settlement_adjustments (
  event_id uuid primary key,
  source_report_id uuid not null references public.settlements(id),
  artist_id uuid not null,
  target_month date not null,
  valuation_policy text not null check(valuation_policy='explicit_current_formula'),
  requested_at timestamptz not null default clock_timestamp()
);

-- One coarse reporting fence intentionally favors correctness over throughput.
-- Source writers hold SHARE, report writers EXCLUSIVE for the entire transaction.
-- Never acquire source row locks after EXCLUSIVE (billing already owns them).
create function private.settlement_source_changed() returns trigger
language plpgsql security definer set search_path='' as $$
declare artist uuid; event uuid;
begin
  perform pg_advisory_xact_lock_shared(724092610240009::bigint);
  if tg_table_name='payment_event_verifications' then
    event:=new.event_id;
    select s.artist_id into artist from public.payment_events e join public.subscriptions s on s.id=e.subscription_id where e.id=event;
  elsif tg_table_name='payment_events' then
    select artist_id into artist from public.subscriptions where id=new.subscription_id;
  elsif tg_op='DELETE' then artist:=old.artist_id;
  else artist:=new.artist_id;
  end if;
  insert into private.settlement_source_versions(artist_id) values(artist);
  if tg_op='UPDATE' and tg_table_name in ('messages','settlement_policies') then
    if old.artist_id<>new.artist_id then
      insert into private.settlement_source_versions(artist_id) values(old.artist_id);
    end if;
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;
create trigger settlement_payment_source before insert on public.payment_events
  for each row execute function private.settlement_source_changed();
create trigger settlement_verification_source before insert on private.payment_event_verifications
  for each row execute function private.settlement_source_changed();
create trigger settlement_message_source before insert or update or delete on public.messages
  for each row execute function private.settlement_source_changed();
create trigger settlement_policy_source before insert or update or delete on private.settlement_policies
  for each row execute function private.settlement_source_changed();

create function private.settlement_admin_lock(p_artist_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare actor public.profiles%rowtype;
begin
  if current_setting('role',true) is distinct from 'authenticated' or auth.uid() is null then
    raise exception 'SETTLEMENT_ADMIN_REQUIRED' using errcode='42501'; end if;
  if current_setting('transaction_isolation')<>'read committed' then
    raise exception 'SETTLEMENT_READ_COMMITTED_REQUIRED' using errcode='25001'; end if;
  select * into actor from public.profiles where id=auth.uid() for share;
  if actor.role is distinct from 'admin' or (actor.is_restricted and
    (actor.restricted_until is null or actor.restricted_until>clock_timestamp())) then
    raise exception 'SETTLEMENT_ADMIN_REQUIRED' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(724092610240009::bigint);
  -- Existing source RPCs may own artist FOR UPDATE before reaching their fence.
  -- Never WAIT here: it would invert locks, including multi-artist batches. The
  -- caller may retry the entire rolled-back transaction on this explicit 40001.
  begin
    perform 1 from public.artists where id=p_artist_id for key share nowait;
  exception when lock_not_available then
    raise exception 'SETTLEMENT_SOURCE_BUSY' using errcode='40001';
  end;
end;
$$;

create function private.settlement_immutable() returns trigger
language plpgsql set search_path='' as $$
declare report uuid;
begin
  if tg_op='TRUNCATE' then raise exception 'SETTLEMENT_IMMUTABLE' using errcode='55000'; end if;
  if tg_table_name='settlements' then
    if old.status='confirmed' then raise exception 'SETTLEMENT_CONFIRMED' using errcode='55000'; end if;
  else
    if tg_op<>'INSERT' then
      report:=old.report_id;
      if exists(select 1 from public.settlements where id=report and status='confirmed') then
        raise exception 'SETTLEMENT_CONFIRMED' using errcode='55000'; end if;
    end if;
    if tg_op<>'DELETE' and exists(select 1 from public.settlements where id=new.report_id and status='confirmed') then
      raise exception 'SETTLEMENT_CONFIRMED' using errcode='55000'; end if;
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;
create trigger settlement_policy_no_truncate before truncate on private.settlement_policies
  for each statement execute function private.settlement_immutable();
create trigger settlements_immutable before update or delete on public.settlements
  for each row execute function private.settlement_immutable();
create trigger settlements_no_truncate before truncate on public.settlements
  for each statement execute function private.settlement_immutable();
create trigger settlement_events_immutable before insert or update or delete on private.settlement_event_sources
  for each row execute function private.settlement_immutable();
create trigger settlement_events_no_truncate before truncate on private.settlement_event_sources
  for each statement execute function private.settlement_immutable();
create trigger settlement_messages_immutable before insert or update or delete on private.settlement_message_sources
  for each row execute function private.settlement_immutable();
create trigger settlement_messages_no_truncate before truncate on private.settlement_message_sources
  for each statement execute function private.settlement_immutable();
create trigger settlement_weeks_immutable before insert or update or delete on public.settlement_weekly_stats
  for each row execute function private.settlement_immutable();
create trigger settlement_weeks_no_truncate before truncate on public.settlement_weekly_stats
  for each statement execute function private.settlement_immutable();
create trigger settlement_versions_immutable before update or delete on private.settlement_source_versions
  for each row execute function private.reject_ledger_mutation();
create trigger settlement_versions_no_truncate before truncate on private.settlement_source_versions
  for each statement execute function private.reject_ledger_mutation();
create trigger settlement_adjustments_immutable before update or delete on private.settlement_adjustments
  for each row execute function private.reject_ledger_mutation();
create trigger settlement_adjustments_no_truncate before truncate on private.settlement_adjustments
  for each statement execute function private.reject_ledger_mutation();

-- Exact rational components + arbitrary-precision numeric approximations.
create function private.settlement_calculate_components(p_gross numeric,p_messages bigint,p_photos bigint,p_days integer,p_policy jsonb)
returns jsonb language plpgsql immutable set search_path='' as $$
declare unit numeric:=1000000; v numeric; f numeric; r numeric; an numeric:=1; ad numeric:=1;
  vn numeric; vd numeric; pn numeric; bn numeric; sn numeric; sd numeric; dn numeric; dd numeric; fn numeric; fd numeric;
begin
  if p_gross<0 then raise exception 'SETTLEMENT_NEGATIVE_NET_REQUIRES_POLICY' using errcode='55000'; end if;
  v:=(p_policy->>'vat_rate')::numeric*unit; f:=(p_policy->>'pg_fee_rate')::numeric*unit; r:=(p_policy->>'base_rate')::numeric*unit;
  if (p_policy->>'activity_enabled')::boolean then
    an:=7::numeric*(p_messages*(p_policy->>'weekly_photo_min')::numeric+p_photos*(p_policy->>'weekly_message_min')::numeric);
    ad:=2::numeric*p_days*(p_policy->>'weekly_message_min')::numeric*(p_policy->>'weekly_photo_min')::numeric;
    an:=least(an,ad);
  end if;
  vn:=p_gross*v; vd:=unit+v; pn:=p_gross*f; bn:=p_gross*(unit-f);
  sn:=bn*r; sd:=vd*unit; dn:=sn*(ad-an); dd:=sd*ad; fn:=sn*an; fd:=sd*ad;
  return jsonb_build_object('vat_krw',vn/vd,'pg_fee_krw',pn/vd,'base_amount_krw',bn/vd,
    'rate',r/unit,'activity_ratio',an/ad,'deduction_krw',dn/dd,'unrounded_final_krw',fn/fd,
    'final_amount_krw',div(2*fn+fd,2*fd),
    'exact_components',jsonb_build_object(
      'vat',jsonb_build_array(vn::text,vd::text),'pg_fee',jsonb_build_array(pn::text,vd::text),
      'base',jsonb_build_array(bn::text,vd::text),'share',jsonb_build_array(sn::text,sd::text),
      'activity_ratio',jsonb_build_array(an::text,ad::text),
      'deduction',jsonb_build_array(dn::text,dd::text),'final',jsonb_build_array(fn::text,fd::text)));
end;
$$;

create function public.settlement_calculate(p_artist_id uuid,p_month date) returns uuid
language plpgsql security definer set search_path='' as $$
declare cfg private.settlement_policies%rowtype; report public.settlements%rowtype;
  first_day date; next_month date; start_at timestamptz; end_at timestamptz; snapshot jsonb; breakdown jsonb;
  gross numeric; current_gross numeric; adjustment_gross numeric; messages bigint; photos bigint; event_count bigint; version bigint;
begin
  perform private.settlement_admin_lock(p_artist_id);
  if p_month is null or not isfinite(p_month) or extract(day from p_month)<>1 or p_artist_id is null then
    raise exception 'SETTLEMENT_MONTH_INVALID' using errcode='22023'; end if;
  first_day:=p_month; next_month:=(p_month+interval '1 month')::date;
  start_at:=first_day::timestamp at time zone 'Asia/Seoul'; end_at:=next_month::timestamp at time zone 'Asia/Seoul';
  if end_at>clock_timestamp() then raise exception 'SETTLEMENT_MONTH_OPEN' using errcode='55000'; end if;
  select * into report from public.settlements where artist_id=p_artist_id and month=p_month;
  if report.status='confirmed' then raise exception 'SETTLEMENT_CONFIRMED' using errcode='55000'; end if;
  select * into cfg from private.settlement_policies where artist_id=p_artist_id and month=p_month;
  if cfg.id is null or not cfg.enabled then raise exception 'SETTLEMENT_POLICY_REQUIRED' using errcode='55000'; end if;
  if cfg.contract_from>first_day or cfg.contract_until<next_month then
    raise exception 'SETTLEMENT_FULL_MONTH_CONTRACT_REQUIRED' using errcode='55000'; end if;
  if cfg.activity_enabled and cfg.partial_week_policy='block' and
    (extract(isodow from first_day)<>1 or extract(isodow from next_month)<>1) then
    raise exception 'SETTLEMENT_PARTIAL_WEEK_POLICY_REQUIRED' using errcode='55000'; end if;
  if exists(select 1 from private.settlement_adjustments where artist_id=p_artist_id and target_month=p_month)
    and cfg.late_event_policy<>'explicit_current_formula' then
    raise exception 'SETTLEMENT_ADJUSTMENT_POLICY_REQUIRED' using errcode='55000'; end if;
  snapshot:=to_jsonb(cfg)-'artist_id'-'month'-'enabled';
  select coalesce(max(v.version),0) into version from private.settlement_source_versions v where v.artist_id=p_artist_id;
  if report.id is null then
    insert into public.settlements(artist_id,month,period_start,period_end,policy_snapshot,source_version,
      source_event_count,source_message_count,gross_krw,current_gross_krw,adjustment_gross_krw,vat_krw,pg_fee_krw,
      base_amount_krw,rate,activity_ratio,deduction_krw,unrounded_final_krw,final_amount_krw,exact_components,calculated_at)
      values(p_artist_id,p_month,start_at,end_at,snapshot,version,0,0,0,0,0,0,0,0,0,0,0,0,0,'{}',clock_timestamp()) returning * into report;
  else
    delete from private.settlement_event_sources where report_id=report.id;
    delete from private.settlement_message_sources where report_id=report.id;
    delete from public.settlement_weekly_stats where report_id=report.id;
  end if;
  -- A verification row is mandatory; raw fabricated/unverified ledger fixtures
  -- cannot become report revenue. No mutable billing state is used as revenue.
  insert into private.settlement_event_sources(report_id,event_id,kind,amount_krw,occurred_at,origin)
    select report.id,e.id,e.kind,e.amount_krw,e.occurred_at,
      case when a.event_id is null then 'current' else 'adjustment' end
    from public.payment_events e join public.subscriptions s on s.id=e.subscription_id
    join private.payment_event_verifications v on v.event_id=e.id
    left join private.settlement_adjustments a on a.event_id=e.id and a.target_month=p_month
    where s.artist_id=p_artist_id and e.currency='KRW'
      and ((e.occurred_at>=start_at and e.occurred_at<end_at) or a.event_id is not null);
  insert into private.settlement_message_sources(report_id,message_id,type,sent_at)
    select report.id,id,type,sent_at from public.messages where artist_id=p_artist_id and status='sent'
      and sent_at>=start_at and sent_at<end_at;
  insert into public.settlement_weekly_stats(report_id,week_start,window_start,window_end,message_count,photo_count,message_required,photo_required)
    select report.id,w::date,greatest(w::date,first_day),least(w::date+7,next_month),
      count(m.message_id),count(m.message_id) filter(where m.type='photo'),
      case when cfg.activity_enabled then (least(w::date+7,next_month)-greatest(w::date,first_day))::numeric*cfg.weekly_message_min/7 else 0 end,
      case when cfg.activity_enabled then (least(w::date+7,next_month)-greatest(w::date,first_day))::numeric*cfg.weekly_photo_min/7 else 0 end
    from generate_series(date_trunc('week',first_day::timestamp),next_month::timestamp-interval '1 day',interval '1 week') w
    left join private.settlement_message_sources m on m.report_id=report.id
      and (m.sent_at at time zone 'Asia/Seoul')::date>=greatest(w::date,first_day)
      and (m.sent_at at time zone 'Asia/Seoul')::date<least(w::date+7,next_month)
    group by w;
  select count(*),coalesce(sum(amount_krw::numeric) filter(where origin='current'),0),coalesce(sum(amount_krw::numeric) filter(where origin='adjustment'),0)
    into event_count,current_gross,adjustment_gross from private.settlement_event_sources where report_id=report.id;
  gross:=current_gross+adjustment_gross;
  select count(*),count(*) filter(where type='photo') into messages,photos from private.settlement_message_sources where report_id=report.id;
  breakdown:=private.settlement_calculate_components(gross,messages,photos,next_month-first_day,snapshot);
  update public.settlements set revision=gen_random_uuid(),policy_snapshot=snapshot,source_version=version,source_event_count=event_count,source_message_count=messages,
    gross_krw=gross,current_gross_krw=current_gross,adjustment_gross_krw=adjustment_gross,
    vat_krw=(breakdown->>'vat_krw')::numeric,pg_fee_krw=(breakdown->>'pg_fee_krw')::numeric,
    base_amount_krw=(breakdown->>'base_amount_krw')::numeric,rate=(breakdown->>'rate')::numeric,
    activity_ratio=(breakdown->>'activity_ratio')::numeric,deduction_krw=(breakdown->>'deduction_krw')::numeric,
    unrounded_final_krw=(breakdown->>'unrounded_final_krw')::numeric,final_amount_krw=(breakdown->>'final_amount_krw')::numeric,
    exact_components=breakdown->'exact_components',calculated_at=clock_timestamp() where id=report.id;
  return report.id;
end;
$$;

create function public.settlement_confirm(p_report_id uuid,p_expected_revision uuid) returns void
language plpgsql security definer set search_path='' as $$
declare report public.settlements%rowtype; artist uuid; version bigint; expected jsonb; actual jsonb; messages bigint; photos bigint;
begin
  select artist_id into artist from public.settlements where id=p_report_id;
  perform private.settlement_admin_lock(artist);
  select * into report from public.settlements where id=p_report_id;
  if report.id is null then raise exception 'SETTLEMENT_NOT_FOUND' using errcode='P0002'; end if;
  if p_expected_revision is distinct from report.revision then raise exception 'SETTLEMENT_REVISION_CONFLICT' using errcode='55000'; end if;
  if report.status='confirmed' then return; end if;
  select coalesce(max(v.version),0) into version from private.settlement_source_versions v where v.artist_id=report.artist_id;
  if version<>report.source_version then raise exception 'SETTLEMENT_DRAFT_STALE' using errcode='55000'; end if;
  if report.source_event_count<>(select count(*) from private.settlement_event_sources where report_id=report.id)
    or report.gross_krw<>(select coalesce(sum(amount_krw::numeric),0) from private.settlement_event_sources where report_id=report.id)
    or report.current_gross_krw<>(select coalesce(sum(amount_krw::numeric),0) from private.settlement_event_sources where report_id=report.id and origin='current')
    or report.adjustment_gross_krw<>(select coalesce(sum(amount_krw::numeric),0) from private.settlement_event_sources where report_id=report.id and origin='adjustment') then
    raise exception 'SETTLEMENT_SOURCE_MISMATCH' using errcode='55000'; end if;
  select count(*),count(*) filter(where type='photo') into messages,photos from private.settlement_message_sources where report_id=report.id;
  if messages<>report.source_message_count or messages<>(select coalesce(sum(message_count),0) from public.settlement_weekly_stats where report_id=report.id)
    or photos<>(select coalesce(sum(photo_count),0) from public.settlement_weekly_stats where report_id=report.id) then
    raise exception 'SETTLEMENT_SOURCE_MISMATCH' using errcode='55000'; end if;
  expected:=private.settlement_calculate_components(report.gross_krw,messages,photos,
    (report.month+interval '1 month')::date-report.month,report.policy_snapshot);
  actual:=jsonb_build_object('vat_krw',report.vat_krw,'pg_fee_krw',report.pg_fee_krw,'base_amount_krw',report.base_amount_krw,
    'rate',report.rate,'activity_ratio',report.activity_ratio,'deduction_krw',report.deduction_krw,
    'unrounded_final_krw',report.unrounded_final_krw,'final_amount_krw',report.final_amount_krw,'exact_components',report.exact_components);
  if expected<>actual then raise exception 'SETTLEMENT_FORMULA_MISMATCH' using errcode='55000'; end if;
  update public.settlements set status='confirmed',confirmed_at=clock_timestamp() where id=report.id;
end;
$$;

create function public.settlement_queue_adjustment(p_event_id uuid,p_target_month date) returns void
language plpgsql security definer set search_path='' as $$
declare artist uuid; happened date; source uuid; existing private.settlement_adjustments%rowtype;
begin
  select s.artist_id,date_trunc('month',e.occurred_at at time zone 'Asia/Seoul')::date into artist,happened
    from public.payment_events e join public.subscriptions s on s.id=e.subscription_id
    join private.payment_event_verifications v on v.event_id=e.id where e.id=p_event_id;
  perform private.settlement_admin_lock(artist);
  if artist is null then raise exception 'SETTLEMENT_VERIFIED_EVENT_REQUIRED' using errcode='22023'; end if;
  if p_target_month is null or not isfinite(p_target_month) or extract(day from p_target_month)<>1 or p_target_month<=happened then
    raise exception 'SETTLEMENT_ADJUSTMENT_MONTH_INVALID' using errcode='22023'; end if;
  select * into existing from private.settlement_adjustments where event_id=p_event_id;
  if existing.event_id is not null then
    if existing.target_month=p_target_month then return; end if;
    raise exception 'SETTLEMENT_ADJUSTMENT_CONFLICT' using errcode='23514'; end if;
  if exists(select 1 from private.settlement_event_sources where event_id=p_event_id) then
    raise exception 'SETTLEMENT_EVENT_ALREADY_ASSIGNED' using errcode='55000'; end if;
  select id into source from public.settlements where artist_id=artist and month=happened and status='confirmed';
  if source is null then raise exception 'SETTLEMENT_CONFIRMED_SOURCE_REQUIRED' using errcode='55000'; end if;
  if exists(select 1 from public.settlements where artist_id=artist and month=p_target_month and status='confirmed') then
    raise exception 'SETTLEMENT_CONFIRMED' using errcode='55000'; end if;
  if not exists(select 1 from private.settlement_policies where artist_id=artist and month=p_target_month and enabled
    and late_event_policy='explicit_current_formula') then
    raise exception 'SETTLEMENT_ADJUSTMENT_POLICY_REQUIRED' using errcode='55000'; end if;
  insert into private.settlement_adjustments(event_id,source_report_id,artist_id,target_month,valuation_policy)
    values(p_event_id,source,artist,p_target_month,'explicit_current_formula');
  insert into private.settlement_source_versions(artist_id) values(artist);
end;
$$;

create function public.settlement_report_sources(p_report_id uuid)
returns table(event_id uuid,kind public.payment_event_kind,amount_krw integer,occurred_at timestamptz,origin text)
language plpgsql stable security definer set search_path='' as $$
begin
  if current_setting('role',true) is distinct from 'authenticated' or private.current_user_role() is distinct from 'admin' then
    raise exception 'SETTLEMENT_ADMIN_REQUIRED' using errcode='42501'; end if;
  return query select e.event_id,e.kind,e.amount_krw,e.occurred_at,e.origin from private.settlement_event_sources e where e.report_id=p_report_id order by e.occurred_at,e.event_id;
end;
$$;
create function public.settlement_pending_adjustments(p_artist_id uuid)
returns table(event_id uuid,kind public.payment_event_kind,amount_krw integer,occurred_at timestamptz,source_report_id uuid,target_month date)
language plpgsql stable security definer set search_path='' as $$
begin
  if current_setting('role',true) is distinct from 'authenticated' or private.current_user_role() is distinct from 'admin' then
    raise exception 'SETTLEMENT_ADMIN_REQUIRED' using errcode='42501'; end if;
  return query select e.id,e.kind,e.amount_krw,e.occurred_at,r.id,a.target_month from public.payment_events e
    join public.subscriptions s on s.id=e.subscription_id join private.payment_event_verifications v on v.event_id=e.id
    join public.settlements r on r.artist_id=s.artist_id and r.status='confirmed'
      and e.occurred_at>=r.period_start and e.occurred_at<r.period_end
    left join private.settlement_adjustments a on a.event_id=e.id
    where s.artist_id=p_artist_id and not exists(select 1 from private.settlement_event_sources x where x.event_id=e.id)
    order by e.occurred_at,e.id;
end;
$$;

alter table public.settlements enable row level security;
alter table public.settlement_weekly_stats enable row level security;
alter table private.settlement_policies enable row level security;
alter table private.settlement_source_versions enable row level security;
alter table private.settlement_event_sources enable row level security;
alter table private.settlement_message_sources enable row level security;
alter table private.settlement_adjustments enable row level security;
revoke all on public.settlements,public.settlement_weekly_stats,private.settlement_policies,private.settlement_source_versions,
  private.settlement_event_sources,private.settlement_message_sources,private.settlement_adjustments from public,anon,authenticated,service_role;
revoke all on sequence private.settlement_source_versions_version_seq from public,anon,authenticated,service_role;
grant select on public.settlements,public.settlement_weekly_stats to authenticated;
create policy settlements_read on public.settlements for select to authenticated using(
  (select private.current_user_role())='admin' or (status='confirmed' and private.is_artist_member(artist_id)));
create policy settlement_weeks_read on public.settlement_weekly_stats for select to authenticated using(
  exists(select 1 from public.settlements r where r.id=report_id));

revoke all on function private.settlement_source_changed(),private.settlement_admin_lock(uuid),private.settlement_immutable(),
  private.settlement_calculate_components(numeric,bigint,bigint,integer,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.settlement_calculate(uuid,date),public.settlement_confirm(uuid,uuid),public.settlement_queue_adjustment(uuid,date),
  public.settlement_report_sources(uuid),public.settlement_pending_adjustments(uuid) from public,anon,authenticated,service_role;
grant execute on function public.settlement_calculate(uuid,date),public.settlement_confirm(uuid,uuid),public.settlement_queue_adjustment(uuid,date),
  public.settlement_report_sources(uuid),public.settlement_pending_adjustments(uuid) to authenticated;
comment on table public.settlements is 'Immutable-after-confirmation KRW report, not remittance or payment authorization. No policy is seeded.';
commit;
