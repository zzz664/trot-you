-- Read-only calculation inputs. No report, policy, payout or scheduler changes.
begin;

create function public.settlement_calculation_input(p_artist_id uuid,p_month date)
returns jsonb language plpgsql security definer set search_path='' set timezone='UTC' as $$
declare
  cfg private.settlement_policies%rowtype;
  report public.settlements%rowtype;
  next_month date; start_at timestamptz; end_at timestamptz; observed_at timestamptz;
  source_version bigint; event_rows jsonb; message_rows jsonb; selected_count bigint;
  -- Technical response bound only, never truncation or an accounting rule.
  source_limit constant integer:=50000;
begin
  -- Current profile authority is locked before the existing exclusive source
  -- fence. Source row locks are deliberately never acquired after that fence.
  perform private.settlement_admin_lock(p_artist_id);
  if p_artist_id is null or p_month is null or not isfinite(p_month)
    or extract(day from p_month)<>1 or p_month<date '2000-01-01' or p_month>date '9998-12-01' then
    raise exception 'SETTLEMENT_MONTH_INVALID' using errcode='22023'; end if;
  if not exists(select 1 from public.artists where id=p_artist_id) then
    raise exception 'SETTLEMENT_NOT_FOUND' using errcode='P0002'; end if;
  observed_at:=clock_timestamp();
  next_month:=(p_month+interval '1 month')::date;
  start_at:=p_month::timestamp at time zone 'Asia/Seoul';
  end_at:=next_month::timestamp at time zone 'Asia/Seoul';
  if end_at>observed_at then
    raise exception 'SETTLEMENT_MONTH_OPEN' using errcode='55000'; end if;
  select * into report from public.settlements where artist_id=p_artist_id and month=p_month;
  if report.status='confirmed' then
    raise exception 'SETTLEMENT_CONFIRMED' using errcode='55000'; end if;
  select * into cfg from private.settlement_policies where artist_id=p_artist_id and month=p_month;
  if cfg.id is null or not cfg.enabled then
    raise exception 'SETTLEMENT_POLICY_REQUIRED' using errcode='55000'; end if;
  if cfg.contract_from>p_month or cfg.contract_until<next_month then
    raise exception 'SETTLEMENT_FULL_MONTH_CONTRACT_REQUIRED' using errcode='55000'; end if;
  if cfg.activity_enabled and cfg.partial_week_policy='block'
    and (extract(isodow from p_month)<>1 or extract(isodow from next_month)<>1) then
    raise exception 'SETTLEMENT_PARTIAL_WEEK_POLICY_REQUIRED' using errcode='55000'; end if;
  if exists(select 1 from private.settlement_adjustments where artist_id=p_artist_id and target_month=p_month)
    and cfg.late_event_policy<>'explicit_current_formula' then
    raise exception 'SETTLEMENT_ADJUSTMENT_POLICY_REQUIRED' using errcode='55000'; end if;

  -- A verified immutable ledger event is the only monetary source. Attempt
  -- state, subscription status and analytics are never financial evidence.
  -- Existing draft assignment to this month is harmless; another report's
  -- assignment must never silently vanish or be counted a second time.
  if exists(
    select 1 from public.payment_events e
    join public.subscriptions s on s.id=e.subscription_id
    join private.payment_event_verifications v on v.event_id=e.id
    left join private.settlement_adjustments a on a.event_id=e.id and a.artist_id=p_artist_id and a.target_month=p_month
    join private.settlement_event_sources assigned on assigned.event_id=e.id
    where s.artist_id=p_artist_id and e.currency='KRW'
      and ((e.occurred_at>=start_at and e.occurred_at<end_at) or a.event_id is not null)
      and assigned.report_id is distinct from report.id
  ) then raise exception 'SETTLEMENT_SOURCE_MISMATCH' using errcode='55000'; end if;

  select count(*) into selected_count from (
    select e.id from public.payment_events e
    join public.subscriptions s on s.id=e.subscription_id
    join private.payment_event_verifications v on v.event_id=e.id
    left join private.settlement_adjustments a on a.event_id=e.id and a.artist_id=p_artist_id and a.target_month=p_month
    where s.artist_id=p_artist_id and e.currency='KRW'
      and ((e.occurred_at>=start_at and e.occurred_at<end_at) or a.event_id is not null)
    limit source_limit+1
  ) selected;
  if selected_count>source_limit then
    raise exception 'SETTLEMENT_SOURCE_LIMIT_EXCEEDED' using errcode='54000'; end if;
  select count(*) into selected_count from (
    select id from public.messages where artist_id=p_artist_id and status='sent'
      and sent_at>=start_at and sent_at<end_at limit source_limit+1
  ) selected;
  if selected_count>source_limit then
    raise exception 'SETTLEMENT_SOURCE_LIMIT_EXCEEDED' using errcode='54000'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',e.id,'kind',e.kind,'amountKrw',e.amount_krw::text,'occurredAt',e.occurred_at,
    'origin',case when a.event_id is null then 'current' else 'adjustment' end,
    'currency',e.currency,'verified',true) order by e.occurred_at,e.id),'[]'::jsonb)
    into event_rows from public.payment_events e
    join public.subscriptions s on s.id=e.subscription_id
    join private.payment_event_verifications v on v.event_id=e.id
    left join private.settlement_adjustments a on a.event_id=e.id and a.artist_id=p_artist_id and a.target_month=p_month
    where s.artist_id=p_artist_id and e.currency='KRW'
      and ((e.occurred_at>=start_at and e.occurred_at<end_at) or a.event_id is not null);
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'type',type,'sentAt',sent_at)
    order by sent_at,id),'[]'::jsonb) into message_rows from public.messages
    where artist_id=p_artist_id and status='sent' and sent_at>=start_at and sent_at<end_at;
  select coalesce(max(version),0) into source_version from private.settlement_source_versions where artist_id=p_artist_id;
  return jsonb_build_object('actorId',auth.uid(),'input',jsonb_build_object(
    'artistId',p_artist_id,'month',to_char(p_month,'YYYY-MM-DD'),'asOf',observed_at,'sourceVersion',source_version::text,
    'policy',jsonb_build_object(
      'id',cfg.id,'artistId',cfg.artist_id,'month',to_char(cfg.month,'YYYY-MM-DD'),'enabled',cfg.enabled,
      'contractFrom',to_char(cfg.contract_from,'YYYY-MM-DD'),'contractUntil',to_char(cfg.contract_until,'YYYY-MM-DD'),
      'baseRate',cfg.base_rate::text,'performanceRate',cfg.performance_rate::text,
      'vatRate',cfg.vat_rate::text,'pgFeeRate',cfg.pg_fee_rate::text,'performanceConditions',cfg.performance_conditions,
      'activityEnabled',cfg.activity_enabled,'weeklyMessageMin',cfg.weekly_message_min,'weeklyPhotoMin',cfg.weekly_photo_min,
      'partialWeekPolicy',cfg.partial_week_policy,'negativeNetPolicy',cfg.negative_net_policy,'lateEventPolicy',cfg.late_event_policy),
    'events',event_rows,'messages',message_rows));
end;
$$;

revoke all on function public.settlement_calculation_input(uuid,date) from public,anon,authenticated,service_role;
grant execute on function public.settlement_calculation_input(uuid,date) to authenticated;
comment on function public.settlement_calculation_input(uuid,date) is
  'Current-admin, fenced, read-only verified ledger and approved-policy calculation inputs. Money/rates are decimal strings; no report writes or payout authorization.';
commit;
