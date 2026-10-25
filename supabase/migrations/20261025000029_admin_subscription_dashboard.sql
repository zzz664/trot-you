-- Read-only dashboard plus immutable cancellation evidence. No billing state,
-- commercial policy, provider, scheduler or role is activated or changed.
begin;
-- Fence migration backfill and trigger installation against concurrent billing writes.
lock table public.subscriptions in share row exclusive mode;

create table private.subscription_cancellation_history (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.subscriptions(id) on delete restrict,
  artist_id uuid not null references public.artists(id) on delete restrict,
  canceled_at timestamptz not null,
  was_paid boolean not null,
  source text not null check(source in('observed','retained_marker')),
  recorded_at timestamptz not null default clock_timestamp(),
  unique(subscription_id,canceled_at)
);
create index subscription_cancellation_history_period_idx on private.subscription_cancellation_history(canceled_at,artist_id) where was_paid;
create table private.subscription_dashboard_history_coverage (
  singleton boolean primary key default true check(singleton),
  complete_from timestamptz not null default clock_timestamp()
);
alter table private.subscription_cancellation_history enable row level security;
alter table private.subscription_dashboard_history_coverage enable row level security;
revoke all on private.subscription_cancellation_history,private.subscription_dashboard_history_coverage from public,anon,authenticated,service_role;
insert into private.subscription_dashboard_history_coverage(singleton) values(true);

create function private.subscription_dashboard_immutable() returns trigger
language plpgsql set search_path='' as $$
begin raise exception 'ADMIN_SUBSCRIPTIONS_HISTORY_IMMUTABLE' using errcode='55000'; end;
$$;
create trigger subscription_cancellation_history_immutable before update or delete on private.subscription_cancellation_history
  for each row execute function private.subscription_dashboard_immutable();
create trigger subscription_cancellation_history_no_truncate before truncate on private.subscription_cancellation_history
  for each statement execute function private.subscription_dashboard_immutable();
create trigger subscription_dashboard_coverage_immutable before update or delete on private.subscription_dashboard_history_coverage
  for each row execute function private.subscription_dashboard_immutable();
create trigger subscription_dashboard_coverage_no_truncate before truncate on private.subscription_dashboard_history_coverage
  for each statement execute function private.subscription_dashboard_immutable();

-- This is a retained marker import, NOT reconstruction of canceled_at values
-- erased by prior re-enrollment. Preserve both original billing rows and the
-- coverage boundary; a pre-boundary range must be labeled incomplete.
insert into private.subscription_cancellation_history(subscription_id,artist_id,canceled_at,was_paid,source)
select s.id,s.artist_id,s.canceled_at,
  ((s.current_period_start<=s.canceled_at and s.current_period_end>s.canceled_at)
    or (s.grace_started_at<=s.canceled_at and s.grace_ends_at>s.canceled_at)) is true
  and exists(select 1 from public.payment_events e
  join private.payment_event_verifications v on v.event_id=e.id
  where e.subscription_id=s.id and e.kind='charge' and e.amount_krw>0
    and e.period_start=s.current_period_start and e.period_end=s.current_period_end
    and e.occurred_at<=s.canceled_at and e.recorded_at<=s.canceled_at),'retained_marker'
from public.subscriptions s where s.canceled_at is not null;

create function private.subscription_dashboard_record_cancellation() returns trigger
language plpgsql security definer set search_path='' as $$
declare eligible boolean;
begin
  if new.canceled_at is null then return null; end if;
  if tg_op='UPDATE' and new.canceled_at is not distinct from old.canceled_at then return null; end if;
  -- Pending re-enrollment retains previous paid period fields: lifetime money
  -- alone must never turn an aborted new checkout into a paid cancellation.
  if tg_op='UPDATE' then eligible:=new.status='canceled' and old.status in('active','grace');
  else eligible:=new.status='canceled' and ((new.current_period_start<=new.canceled_at and new.current_period_end>new.canceled_at)
    or (new.grace_started_at<=new.canceled_at and new.grace_ends_at>new.canceled_at)) is true; end if;
  insert into private.subscription_cancellation_history(subscription_id,artist_id,canceled_at,was_paid,source)
  values(new.id,new.artist_id,new.canceled_at,eligible and exists(select 1 from public.payment_events e
    join private.payment_event_verifications v on v.event_id=e.id
    where e.subscription_id=new.id and e.kind='charge' and e.amount_krw>0
      and (tg_op='UPDATE' or (e.period_start=new.current_period_start and e.period_end=new.current_period_end))
      and e.occurred_at<=new.canceled_at and e.recorded_at<=new.canceled_at),'observed')
  on conflict(subscription_id,canceled_at) do nothing;
  return null;
end;
$$;
create trigger subscription_dashboard_cancellation after insert or update of canceled_at on public.subscriptions
  for each row execute function private.subscription_dashboard_record_cancellation();

create function private.subscription_dashboard_actor() returns void
language plpgsql security definer set search_path='' as $$
declare actor public.profiles%rowtype;
begin
  if current_setting('transaction_isolation')<>'read committed' then
    raise exception 'ADMIN_SUBSCRIPTIONS_ISOLATION_UNSUPPORTED' using errcode='25001'; end if;
  if current_setting('role',true) is distinct from 'authenticated' then
    raise exception 'ADMIN_SUBSCRIPTIONS_FORBIDDEN' using errcode='42501'; end if;
  select * into actor from public.profiles where id=auth.uid() for share;
  if actor.id is null or actor.role<>'admin' or
    (actor.is_restricted and (actor.restricted_until is null or actor.restricted_until>clock_timestamp())) then
    raise exception 'ADMIN_SUBSCRIPTIONS_FORBIDDEN' using errcode='42501'; end if;
end;
$$;

create function public.admin_subscription_dashboard(p_from date,p_to date,p_artist_id uuid default null,p_page integer default 1) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare result jsonb;
begin
  perform private.subscription_dashboard_actor();
  if p_from is null or p_to is null or not isfinite(p_from) or not isfinite(p_to) then
    raise exception 'ADMIN_SUBSCRIPTIONS_INVALID_INPUT' using errcode='22023'; end if;
  if p_from<date '2000-01-01' or p_to<p_from or p_to>(clock_timestamp() at time zone 'Asia/Seoul')::date
    then
    raise exception 'ADMIN_SUBSCRIPTIONS_INVALID_INPUT' using errcode='22023'; end if;
  if p_to-p_from>365 or p_page is null or p_page not between 1 and 1000 then
    raise exception 'ADMIN_SUBSCRIPTIONS_INVALID_INPUT' using errcode='22023'; end if;
  -- Every projection, total, cohort and page below shares ONE READ COMMITTED
  -- statement snapshot after the current-role lock. No per-row volatile RPCs.
  with params as materialized(select clock_timestamp() as at_time,
    p_from::timestamp at time zone 'Asia/Seoul' as starts_at,
    (p_to+1)::timestamp at time zone 'Asia/Seoul' as ends_at),
  scope as materialized(select a.id,a.slug,a.name,a.status from public.artists a where p_artist_id is null or a.id=p_artist_id),
  subs as materialized(select s.id,s.user_id,s.artist_id,
    case when s.status='active' and s.current_period_start<=p.at_time and s.current_period_end>p.at_time then 'active_paid'
      when s.status='grace' and s.grace_started_at<=p.at_time and s.grace_ends_at>p.at_time then 'grace'
      when s.status='canceled' and s.current_period_start<=p.at_time and s.current_period_end>p.at_time then 'canceled_paid'
      when s.status='pending' then 'pending' when s.status='expired' then 'expired' else 'out_of_access' end as category
    from public.subscriptions s join scope a on a.id=s.artist_id cross join params p),
  currents as(select artist_id,count(*) as total_subscriptions,
    count(distinct user_id) filter(where category in('active_paid','grace','canceled_paid')) as subscribers,
    count(*) filter(where category='active_paid') as active_paid,count(*) filter(where category='grace') as grace,
    count(*) filter(where category='canceled_paid') as canceled_paid,count(*) filter(where category='pending') as pending,
    count(*) filter(where category='expired') as expired,count(*) filter(where category='out_of_access') as out_of_access
    from subs group by grouping sets((artist_id),())),
  first_charges as(select s.id,s.artist_id,min(e.occurred_at) as first_paid_at from subs s
    join public.payment_events e on e.subscription_id=s.id and e.kind='charge' and e.amount_krw>0
    join private.payment_event_verifications v on v.event_id=e.id cross join params p
    where e.occurred_at<=p.at_time and e.recorded_at<=p.at_time group by s.id,s.artist_id),
  new_counts as(select artist_id,count(*) as amount from first_charges f cross join params p
    where f.first_paid_at>=p.starts_at and f.first_paid_at<p.ends_at group by grouping sets((artist_id),())),
  cancellations as(select h.artist_id,count(*) as amount from private.subscription_cancellation_history h
    join scope a on a.id=h.artist_id cross join params p where h.was_paid and h.canceled_at>=p.starts_at and h.canceled_at<p.ends_at
      and h.canceled_at<=p.at_time and h.recorded_at<=p.at_time group by grouping sets((h.artist_id),())),
  cohort as materialized(select o.id,s.artist_id,exists(select 1 from private.payment_attempts attempt
      join private.payment_event_verifications v on v.attempt_id=attempt.id join public.payment_events e on e.id=v.event_id
      where attempt.obligation_id=o.id and e.subscription_id=s.id and e.kind='charge' and e.amount_krw>0
        and e.occurred_at<=p.at_time and e.recorded_at<=p.at_time) as paid
    from private.billing_obligations o join subs s on s.id=o.subscription_id cross join params p
    where not o.is_initial and o.period_start>=p.starts_at and o.period_start<p.ends_at and o.period_start<=p.at_time),
  renewals as(select artist_id,count(*) as due,count(*) filter(where paid) as paid from cohort group by grouping sets((artist_id),())),
  keys as(select id from scope union all select null::uuid),
  metrics as materialized(select k.id,
    jsonb_build_object('total_subscriptions',coalesce(c.total_subscriptions,0),'subscribers',coalesce(c.subscribers,0),
      'active_paid',coalesce(c.active_paid,0),'grace',coalesce(c.grace,0),'canceled_paid',coalesce(c.canceled_paid,0),
      'pending',coalesce(c.pending,0),'expired',coalesce(c.expired,0),'out_of_access',coalesce(c.out_of_access,0)) as current,
    jsonb_build_object('new_subscriptions',coalesce(n.amount,0),'cancellations',coalesce(x.amount,0),
      'renewal_due',coalesce(r.due,0),'renewal_paid',coalesce(r.paid,0),
      'renewal_rate',case when r.due>0 then round(100::numeric*r.paid/r.due,2) else null end) as period
    from keys k left join currents c on c.artist_id is not distinct from k.id
      left join new_counts n on n.artist_id is not distinct from k.id left join cancellations x on x.artist_id is not distinct from k.id
      left join renewals r on r.artist_id is not distinct from k.id),
  paged as(select a.id,a.slug,a.name,a.status,m.current,m.period from scope a join metrics m on m.id=a.id
    order by a.name collate "C",a.id offset (p_page-1)*20 limit 20)
  select jsonb_build_object('as_of',p.at_time,'from',p_from,'to',p_to,'window_start',p.starts_at,'window_end',p.ends_at,'time_zone','Asia/Seoul',
    'cancellation_history_complete_from',(select complete_from from private.subscription_dashboard_history_coverage where singleton),
    'selected_artist',(select jsonb_build_object('id',a.id,'slug',a.slug,'name',a.name,'status',a.status) from scope a where a.id=p_artist_id),
    'summary',(select jsonb_build_object('current',m.current,'period',m.period) from metrics m where m.id is null),
    'artists',coalesce((select jsonb_agg(to_jsonb(a) order by a.name collate "C",a.id) from paged a),'[]'::jsonb),
    'page',p_page,'page_size',20,'total_artists',(select count(*) from scope),'has_more',(select count(*)>p_page*20 from scope))
  into result from params p;
  if p_artist_id is not null and result->'selected_artist'='null'::jsonb then
    raise exception 'ADMIN_SUBSCRIPTIONS_NOT_FOUND' using errcode='P0002'; end if;
  return result;
end;
$$;

revoke all on function private.subscription_dashboard_immutable(),private.subscription_dashboard_record_cancellation(),
  private.subscription_dashboard_actor(),public.admin_subscription_dashboard(date,date,uuid,integer) from public,anon,authenticated,service_role;
grant execute on function public.admin_subscription_dashboard(date,date,uuid,integer) to authenticated;
commit;
