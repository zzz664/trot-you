-- Revision-bound report review and export, not remittance or policy approval.
begin;

-- Direct SELECT and the guarded RPC agree on current artist legal consent.
-- Admin access keeps its established role/restriction contract; consumer
-- onboarding does not become an invented administrator provisioning rule.
create function private.settlement_artist_consent_ready(p_actor uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(
    select 1 from public.profiles p
    join private.profile_onboarding_policy cfg on cfg.singleton
    join private.onboarding_documents terms on terms.version=cfg.terms_version and terms.kind='terms'
    join private.onboarding_documents privacy on privacy.version=cfg.privacy_version and privacy.kind='privacy'
    join private.profile_policy_acceptances ta on ta.user_id=p.id and ta.kind='terms' and ta.version=terms.version
    join private.profile_policy_acceptances pa on pa.user_id=p.id and pa.kind='privacy' and pa.version=privacy.version
    where current_setting('role',true)='authenticated' and p.id=p_actor and p.id=auth.uid() and p.role='artist' and p.onboarding_completed_at is not null
      and not(p.is_restricted and (p.restricted_until is null or p.restricted_until>now()))
      and terms.approved_at<=now() and terms.published_at<=now()
      and privacy.approved_at<=now() and privacy.published_at<=now()
      and ta.accepted_at<=now() and pa.accepted_at<=now());
$$;
revoke all on function private.settlement_artist_consent_ready(uuid) from public,anon,authenticated,service_role;
grant execute on function private.settlement_artist_consent_ready(uuid) to authenticated;
drop policy settlements_read on public.settlements;
create policy settlements_read on public.settlements for select to authenticated using(
  (select private.current_user_role())='admin' or
  (status='confirmed' and private.is_artist_member(artist_id)
    and (select private.settlement_artist_consent_ready(auth.uid()))));

create function private.settlement_report_actor(p_artist_id uuid,p_admin_only boolean) returns public.user_role
language plpgsql security definer set search_path='' as $$
declare actor public.profiles%rowtype; cfg private.profile_onboarding_policy%rowtype;
  terms private.onboarding_documents%rowtype; privacy private.onboarding_documents%rowtype;
begin
  if current_setting('role',true) is distinct from 'authenticated' or auth.uid() is null then
    raise exception 'SETTLEMENT_FORBIDDEN' using errcode='42501'; end if;
  if current_setting('transaction_isolation')<>'read committed' then
    raise exception 'SETTLEMENT_READ_COMMITTED_REQUIRED' using errcode='25001'; end if;
  select * into actor from public.profiles where id=auth.uid() for share;
  if actor.id is null or actor.role not in('admin','artist')
    or (actor.is_restricted and (actor.restricted_until is null or actor.restricted_until>clock_timestamp()))
    or (p_admin_only and actor.role<>'admin') then
    raise exception 'SETTLEMENT_FORBIDDEN' using errcode='42501'; end if;
  if actor.role='artist' then
    if actor.onboarding_completed_at is null then raise exception 'SETTLEMENT_FORBIDDEN' using errcode='42501'; end if;
    -- Profile -> current policy -> published documents -> exact acceptances.
    -- Separate statements after waits and held SHARE locks prevent withdrawal
    -- or a new legal version from slipping between authorization and export.
    select * into cfg from private.profile_onboarding_policy where singleton for share;
    select * into terms from private.onboarding_documents where version=cfg.terms_version and kind='terms' for share;
    select * into privacy from private.onboarding_documents where version=cfg.privacy_version and kind='privacy' for share;
    if terms.version is null or privacy.version is null or terms.approved_at is null or terms.published_at is null
      or privacy.approved_at is null or privacy.published_at is null
      or terms.approved_at>clock_timestamp() or terms.published_at>clock_timestamp()
      or privacy.approved_at>clock_timestamp() or privacy.published_at>clock_timestamp() then
      raise exception 'SETTLEMENT_CONSENT_REQUIRED' using errcode='42501'; end if;
    perform 1 from private.profile_policy_acceptances where user_id=actor.id and kind='terms'
      and version=terms.version and accepted_at<=clock_timestamp() for share;
    if not found then raise exception 'SETTLEMENT_CONSENT_REQUIRED' using errcode='42501'; end if;
    perform 1 from private.profile_policy_acceptances where user_id=actor.id and kind='privacy'
      and version=privacy.version and accepted_at<=clock_timestamp() for share;
    if not found then raise exception 'SETTLEMENT_CONSENT_REQUIRED' using errcode='42501'; end if;
  end if;
  -- Same profile -> report fence -> artist NOWAIT order as calculation.
  -- No source rows are locked after the fence. READ COMMITTED statements below
  -- observe a completed draft and all of its frozen child snapshots together.
  perform pg_advisory_xact_lock(724092610240009::bigint);
  begin
    perform 1 from public.artists where id=p_artist_id for key share nowait;
  exception when lock_not_available then
    raise exception 'SETTLEMENT_SOURCE_BUSY' using errcode='40001';
  end;
  if actor.role='artist' then
    perform 1 from public.artist_members where user_id=actor.id and artist_id=p_artist_id for share;
    if not found then raise exception 'SETTLEMENT_FORBIDDEN' using errcode='42501'; end if;
  end if;
  return actor.role;
end;
$$;

create function public.settlement_report_read(p_artist_id uuid,p_month date,p_include_sources boolean default false)
returns jsonb language plpgsql security definer set search_path='' set timezone='UTC' as $$
declare actor_role public.user_role; artist public.artists%rowtype; report public.settlements%rowtype;
  report_json jsonb; weeks jsonb; sources jsonb; policy jsonb;
  source_limit constant integer:=50000;
begin
  actor_role:=private.settlement_report_actor(p_artist_id,coalesce(p_include_sources,true));
  if p_artist_id is null or p_month is null or not isfinite(p_month) or extract(day from p_month)<>1
    or p_month<date '2000-01-01' or p_month>date '9998-12-01' or p_include_sources is null then
    raise exception 'SETTLEMENT_MONTH_INVALID' using errcode='22023'; end if;
  select * into artist from public.artists where id=p_artist_id;
  if artist.id is null then raise exception 'SETTLEMENT_NOT_FOUND' using errcode='P0002'; end if;
  select * into report from public.settlements where artist_id=p_artist_id and month=p_month
    and (actor_role='admin' or status='confirmed');
  if report.id is not null then
    if report.source_event_count>source_limit or report.source_message_count>source_limit then
      raise exception 'SETTLEMENT_SOURCE_LIMIT_EXCEEDED' using errcode='54000'; end if;
    policy:=report.policy_snapshot;
    select coalesce(jsonb_agg(jsonb_build_object(
      'weekStart',to_char(w.week_start,'YYYY-MM-DD'),'windowStart',to_char(w.window_start,'YYYY-MM-DD'),
      'windowEnd',to_char(w.window_end,'YYYY-MM-DD'),'messageCount',w.message_count::text,'photoCount',w.photo_count::text,
      'messageRequired',w.message_required::text,'photoRequired',w.photo_required::text) order by w.week_start),'[]'::jsonb)
      into weeks from public.settlement_weekly_stats w where w.report_id=report.id;
    report_json:=jsonb_build_object(
      'id',report.id,'revision',report.revision,'status',report.status,
      'periodStart',report.period_start,'periodEnd',report.period_end,'currency',report.currency,
      'sourceVersion',report.source_version::text,'sourceEventCount',report.source_event_count::text,
      'sourceMessageCount',report.source_message_count::text,
      'grossKrw',report.gross_krw::text,'currentGrossKrw',report.current_gross_krw::text,
      'adjustmentGrossKrw',report.adjustment_gross_krw::text,'vatKrw',report.vat_krw::text,
      'pgFeeKrw',report.pg_fee_krw::text,'baseAmountKrw',report.base_amount_krw::text,'rate',report.rate::text,
      'activityRatio',report.activity_ratio::text,'deductionKrw',report.deduction_krw::text,
      'unroundedFinalKrw',report.unrounded_final_krw::text,'finalAmountKrw',report.final_amount_krw::text,
      'exactComponents',report.exact_components,'calculatedAt',report.calculated_at,'confirmedAt',report.confirmed_at,
      'policySnapshot',jsonb_build_object(
        'id',policy->>'id','artistId',p_artist_id,'month',to_char(p_month,'YYYY-MM-DD'),'enabled',true,
        'contractFrom',policy->>'contract_from','contractUntil',policy->>'contract_until',
        'baseRate',policy->>'base_rate','performanceRate',policy->>'performance_rate',
        'vatRate',policy->>'vat_rate','pgFeeRate',policy->>'pg_fee_rate',
        'performanceConditions',policy->'performance_conditions','activityEnabled',policy->'activity_enabled',
        'weeklyMessageMin',policy->'weekly_message_min','weeklyPhotoMin',policy->'weekly_photo_min',
        'partialWeekPolicy',policy->>'partial_week_policy','negativeNetPolicy',policy->>'negative_net_policy',
        'lateEventPolicy',policy->>'late_event_policy'),'weeklyStats',weeks);
    if p_include_sources then
      if report.source_event_count<>(select count(*) from private.settlement_event_sources where report_id=report.id)
        or report.gross_krw<>(select coalesce(sum(amount_krw::numeric),0) from private.settlement_event_sources where report_id=report.id) then
        raise exception 'SETTLEMENT_SOURCE_MISMATCH' using errcode='55000'; end if;
      select coalesce(jsonb_agg(jsonb_build_object('id',e.event_id,'kind',e.kind,'amountKrw',e.amount_krw::text,
        'occurredAt',e.occurred_at,'origin',e.origin,'currency','KRW','verified',true) order by e.occurred_at,e.event_id),'[]'::jsonb)
        into sources from private.settlement_event_sources e where e.report_id=report.id;
    end if;
  end if;
  return jsonb_build_object('actorId',auth.uid(),'actorRole',actor_role,
    'artist',jsonb_build_object('id',artist.id,'slug',artist.slug,'name',artist.name),
    'month',to_char(p_month,'YYYY-MM-DD'),'report',report_json,'sources',sources);
end;
$$;

create function public.settlement_report_export(p_report_id uuid,p_expected_revision uuid)
returns jsonb language plpgsql security definer set search_path='' set timezone='UTC' as $$
declare report public.settlements%rowtype;
begin
  select * into report from public.settlements where id=p_report_id;
  perform private.settlement_report_actor(report.artist_id,true);
  select * into report from public.settlements where id=p_report_id;
  if report.id is null then raise exception 'SETTLEMENT_NOT_FOUND' using errcode='P0002'; end if;
  if p_expected_revision is distinct from report.revision then
    raise exception 'SETTLEMENT_REVISION_CONFLICT' using errcode='55000'; end if;
  return public.settlement_report_read(report.artist_id,report.month,true);
end;
$$;

create function public.settlement_report_calculate(p_artist_id uuid,p_month date,p_expected_revision uuid default null)
returns jsonb language plpgsql security definer set search_path='' set timezone='UTC' as $$
declare report public.settlements%rowtype;
begin
  perform private.settlement_report_actor(p_artist_id,true);
  select * into report from public.settlements where artist_id=p_artist_id and month=p_month;
  if report.status='confirmed' then raise exception 'SETTLEMENT_CONFIRMED' using errcode='55000'; end if;
  if (report.id is null and p_expected_revision is not null)
    or (report.id is not null and p_expected_revision is distinct from report.revision) then
    raise exception 'SETTLEMENT_REVISION_CONFLICT' using errcode='55000'; end if;
  -- Feature40 validates complete-source bounds and explicit approved policy.
  -- The existing source fence remains held through calculation and projection;
  -- no preview values from a prior request authorize this mutation.
  perform public.settlement_calculation_input(p_artist_id,p_month);
  perform public.settlement_calculate(p_artist_id,p_month);
  return public.settlement_report_read(p_artist_id,p_month,false);
end;
$$;

create function public.settlement_report_confirm(p_report_id uuid,p_expected_revision uuid)
returns jsonb language plpgsql security definer set search_path='' set timezone='UTC' as $$
declare report public.settlements%rowtype;
begin
  select * into report from public.settlements where id=p_report_id;
  perform private.settlement_report_actor(report.artist_id,true);
  perform public.settlement_confirm(p_report_id,p_expected_revision);
  select * into report from public.settlements where id=p_report_id;
  return public.settlement_report_read(report.artist_id,report.month,false);
end;
$$;

revoke all on function private.settlement_report_actor(uuid,boolean) from public,anon,authenticated,service_role;
revoke all on function public.settlement_report_read(uuid,date,boolean),public.settlement_report_export(uuid,uuid),
  public.settlement_report_calculate(uuid,date,uuid),public.settlement_report_confirm(uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.settlement_report_read(uuid,date,boolean),public.settlement_report_export(uuid,uuid),
  public.settlement_report_calculate(uuid,date,uuid),public.settlement_report_confirm(uuid,uuid) to authenticated;
comment on function public.settlement_report_read(uuid,date,boolean) is
  'Actor-bound, coherent saved report projection. Artists need current legal consent and membership; confirmed reports only. Numeric values remain text. Sources are admin-only.';
comment on function public.settlement_report_calculate(uuid,date,uuid) is
  'Revision-bound admin draft creation/recalculation, using current fenced approved inputs. No money movement or policy provisioning.';
comment on function public.settlement_report_export(uuid,uuid) is
  'Admin-only exact reviewed revision with frozen verified source rows, without fan or provider identities. No spreadsheet or payout is produced in SQL.';
commit;
