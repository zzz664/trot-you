-- Configuration-ready renewal primitives. No policy approval, notice delivery,
-- scheduler, credential or provider transaction is activated by this migration.
begin;

create table private.renewal_policies (
  checkout_policy_version uuid primary key references private.checkout_policies(version) on delete restrict,
  grace_seconds integer not null check (grace_seconds between 0 and 2678400),
  retry_seconds integer not null check (retry_seconds between 1 and 2678400),
  max_retries integer not null check (max_retries between 0 and 10),
  notice_required boolean not null,
  notice_lead_seconds integer not null check (notice_lead_seconds between 0 and 2678400),
  approved_at timestamptz check (approved_at is null or isfinite(approved_at)),
  published_at timestamptz check (published_at is null or (isfinite(published_at) and approved_at is not null and published_at>=approved_at)),
  check (notice_required or notice_lead_seconds=0)
);
create table private.renewal_notice_receipts (
  subscription_id uuid not null references public.subscriptions(id) on delete restrict,
  period_start timestamptz not null check (isfinite(period_start)),
  checkout_policy_version uuid not null references private.renewal_policies(checkout_policy_version) on delete restrict,
  amount_krw integer not null check (amount_krw>0),
  delivered_at timestamptz not null check (isfinite(delivered_at)),
  evidence_ref uuid not null,
  recorded_at timestamptz not null default clock_timestamp(),
  primary key(subscription_id,period_start,checkout_policy_version)
);
create table private.renewal_attempts (
  attempt_id uuid primary key references private.payment_attempts(id) on delete restrict,
  provider_payment_id text check (length(provider_payment_id) between 1 and 200 and provider_payment_id !~ '[[:cntrl:][:space:]]'),
  retryable boolean,
  query_attempts integer not null default 0 check (query_attempts between 0 and 3),
  query_lease_token uuid,
  query_lease_expires_at timestamptz check (query_lease_expires_at is null or isfinite(query_lease_expires_at)),
  next_query_at timestamptz not null default clock_timestamp() check (isfinite(next_query_at)),
  check (query_lease_expires_at is null or query_lease_token is not null)
);
create table private.renewal_scan_cursor (
  singleton boolean primary key default true check(singleton),
  last_subscription_id uuid
);
alter table private.renewal_scan_cursor enable row level security;
revoke all on private.renewal_scan_cursor from public,anon,authenticated,service_role;
comment on table private.renewal_scan_cursor is 'Technical fair bounded worker scan cursor only. Does not authorize dispatch or change business policy. Prevents unconfigured vault/merchant prefixes starving later eligible subscriptions.';
alter table private.renewal_policies enable row level security;
alter table private.renewal_notice_receipts enable row level security;
alter table private.renewal_attempts enable row level security;
revoke all on private.renewal_policies,private.renewal_notice_receipts,private.renewal_attempts from public,anon,authenticated,service_role;
comment on table private.renewal_policies is 'Explicit immutable approval for renewal of exactly the accepted checkout policy. Draft source prices/retry/grace values are not runtime defaults. Notice waiver is never inferred from absent delivery infrastructure.';
comment on table private.renewal_notice_receipts is 'Verified delivery evidence only, not an outbox row or queued/provider-accepted notification. A future approved notice workflow may record it through the service RPC; this feature sends no notices.';
comment on table private.renewal_attempts is 'Bounded recovery metadata. Three query leases with one-hour backoff; lease expiry never authorizes another charge. Kakao without a known TID remains manual review.';

create function private.renewal_policy_immutable() returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op='TRUNCATE' or old.approved_at is not null then raise exception 'RENEWAL_POLICY_IMMUTABLE' using errcode='23514'; end if;
  if tg_op='DELETE' then return old; end if;
  if new.checkout_policy_version is distinct from old.checkout_policy_version then raise exception 'RENEWAL_POLICY_IMMUTABLE' using errcode='23514'; end if;
  return new;
end;
$$;
create trigger renewal_policy_immutable before update or delete on private.renewal_policies for each row execute function private.renewal_policy_immutable();
create trigger renewal_policy_no_truncate before truncate on private.renewal_policies for each statement execute function private.renewal_policy_immutable();
create trigger renewal_notice_immutable before update or delete on private.renewal_notice_receipts for each row execute function private.reject_ledger_mutation();
create trigger renewal_notice_no_truncate before truncate on private.renewal_notice_receipts for each statement execute function private.reject_ledger_mutation();

-- Add N months to the ORIGINAL episode anniversary, not to a February-clamped
-- previous endpoint. UTC/modern Seoul are explicit approved calendars, no host TZ.
create function private.renewal_period_end(p_anchor timestamptz,p_start timestamptz,p_calendar text) returns timestamptz
language plpgsql immutable strict set search_path='' as $$
declare zone text; anchor_local timestamp; start_local timestamp; months integer; expected timestamp;
begin
  if not isfinite(p_anchor) or not isfinite(p_start) or p_anchor>=p_start then return null; end if;
  zone:=case p_calendar when 'utc_monthly_clamped' then 'UTC' when 'seoul_monthly_clamped' then 'Asia/Seoul' end;
  if zone is null then return null; end if;
  anchor_local:=p_anchor at time zone zone; start_local:=p_start at time zone zone;
  months:=(extract(year from start_local)::integer-extract(year from anchor_local)::integer)*12
    +extract(month from start_local)::integer-extract(month from anchor_local)::integer;
  if months<1 then return null; end if;
  expected:=anchor_local+make_interval(months=>months);
  if expected is distinct from start_local then return null; end if;
  return (anchor_local+make_interval(months=>months+1)) at time zone zone;
end;
$$;

create function private.renewal_projection(p_subscription_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s public.subscriptions%rowtype; m private.payment_mandates%rowtype; c private.checkout_sessions%rowtype;
  p private.checkout_policies%rowtype; r private.renewal_policies%rowtype; o private.billing_obligations%rowtype;
  a private.payment_attempts%rowtype; ra private.renewal_attempts%rowtype; credential jsonb;
  action text:='none'; reason text; at_time timestamptz:=clock_timestamp(); start_at timestamptz; end_at timestamptz;
  amount integer; current_policy uuid; eligible boolean:=true;
begin
  select * into s from public.subscriptions where id=p_subscription_id;
  if s.id is null then raise exception 'RENEWAL_NOT_FOUND' using errcode='P0002'; end if;
  select * into o from private.billing_obligations where subscription_id=s.id and state='open';
  if o.id is not null then
    select * into m from private.payment_mandates where id=o.mandate_id;
    select * into a from private.payment_attempts where obligation_id=o.id order by ordinal desc limit 1;
    select * into ra from private.renewal_attempts where attempt_id=a.id;
  else select * into m from private.payment_mandates where subscription_id=s.id and is_active; end if;
  select cs.* into c from private.subscription_enrollments e join private.checkout_sessions cs on cs.id=e.session_id
    where e.mandate_id=m.id and e.state='succeeded';
  select * into p from private.checkout_policies where version=c.policy_version;
  select * into r from private.renewal_policies where checkout_policy_version=c.policy_version;
  select ciphertext into credential from private.enrollment_credentials where id=m.secure_credential_ref and mandate_id=m.id;
  start_at:=coalesce(o.period_start,s.current_period_end);
  end_at:=coalesce(o.period_end,private.renewal_period_end(s.episode_started_at,start_at,p.billing_period_calendar));
  amount:=coalesce(o.amount_krw,c.regular_price_krw);
  if ra.attempt_id is not null and a.state='inflight' and a.lease_expires_at<=at_time then
    action:='lease_expired';
  elsif (s.status='grace' and s.grace_ends_at<=at_time)
    or (s.status='canceled' and coalesce(s.current_period_end,'-infinity'::timestamptz)<=at_time) then
    action:='expired';
  elsif ra.attempt_id is not null and a.state='unknown' then
    if m.provider='kakaopay' and ra.provider_payment_id is null then action:='manual_review'; reason:='PAYMENT_ID_MISSING';
    elsif ra.query_attempts>=3 then action:='manual_review'; reason:='QUERY_BUDGET_EXHAUSTED';
    elsif ra.next_query_at<=at_time and coalesce(ra.query_lease_expires_at,'-infinity'::timestamptz)<=at_time then action:='reconcile';
    else reason:='RECOVERY_WAIT'; end if;
  elsif s.status in ('active','grace') and s.canceled_at is null and s.next_billing_at<=at_time then
    if a.state='inflight' then reason:='PROCESSING';
    elsif o.id is not null and (o.is_initial or (a.id is not null and ra.attempt_id is null)) then action:='blocked'; reason:='UNMANAGED_OBLIGATION';
    elsif a.state='failed' and (ra.retryable is distinct from true or a.ordinal>o.max_retries or o.next_attempt_at>at_time) then reason:='RETRY_NOT_DUE';
    else
      select policy_version into current_policy from private.checkout_policy_current where singleton;
      begin perform private.checkout_require_actor(s.user_id); exception when others then eligible:=false; end;
      at_time:=clock_timestamp();
      if s.status='grace' and s.grace_ends_at<=at_time then action:='expired';
      elsif c.id is null or m.id is null or not m.is_active or m.provider<>s.provider or credential is null then
        action:='blocked'; reason:='MANDATE_UNAVAILABLE';
      elsif p.version is null or p.version is distinct from current_policy or m.consent_version is distinct from p.version::text
        or p.approved_at is null or p.approved_at>at_time or p.published_at is null or p.published_at>at_time
        or p.billing_period_calendar is null or p.payment_tax_basis is distinct from 'taxable_krw'
        or r.checkout_policy_version is null or r.approved_at is null or r.approved_at>at_time
        or r.published_at is null or r.published_at>at_time then action:='blocked'; reason:='POLICY_NOT_APPROVED';
      elsif not eligible or not exists(select 1 from public.artists where id=s.artist_id and status='active') then
        action:='blocked'; reason:='ELIGIBILITY_CHANGED';
      elsif end_at is null or start_at is null or end_at<=at_time or end_at is distinct from private.renewal_period_end(s.episode_started_at,start_at,p.billing_period_calendar)
        or (o.id is not null and (o.amount_krw<>c.regular_price_krw or o.price_version<>p.version::text or o.is_intro
          or o.grace_seconds<>r.grace_seconds or o.retry_seconds<>r.retry_seconds or o.max_retries<>r.max_retries)) then
        action:='blocked'; reason:='PERIOD_REQUIRES_REVIEW';
      elsif r.notice_required and not exists(select 1 from private.renewal_notice_receipts n where n.subscription_id=s.id
        and n.period_start=start_at and n.checkout_policy_version=p.version and n.amount_krw=amount
        and n.delivered_at<=start_at-make_interval(secs=>r.notice_lead_seconds)) then
        action:='blocked'; reason:='NOTICE_REQUIRED';
      else action:='charge'; end if;
    end if;
  end if;
  return jsonb_build_object('subscription_id',s.id,'user_id',s.user_id,'artist_id',s.artist_id,'subscription_status',s.status,
    'action',action,'reason',reason,'dispatch',false,'mandate_id',m.id,'provider',s.provider,'environment',m.environment,
    'merchant_account',m.merchant_account,'customer_ref',m.provider_customer_ref,'credential_ciphertext',credential,
    'policy_version',p.version,'billing_period_calendar',p.billing_period_calendar,'payment_tax_basis',p.payment_tax_basis,
    'episode_started_at',s.episode_started_at,'amount_krw',amount,'period_start',start_at,'period_end',end_at,
    'attempt_id',a.id,'attempt_state',a.state,'provider_payment_id',ra.provider_payment_id,'lease_token',null);
end;
$$;

create function public.renewal_read(p_subscription_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin perform private.require_billing_service(); return private.renewal_projection(p_subscription_id); end;
$$;
create function public.renewal_candidates(p_limit integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; cursor_id uuid;
begin
  perform private.require_billing_service();
  if p_limit is null or p_limit not between 1 and 20 then raise exception 'RENEWAL_INVALID_INPUT' using errcode='22023'; end if;
  insert into private.renewal_scan_cursor(singleton) values(true) on conflict(singleton) do nothing;
  select last_subscription_id into cursor_id from private.renewal_scan_cursor where singleton for update;
  select coalesce(jsonb_agg(q.id order by (cursor_id is null or q.id>cursor_id) desc,q.id),'[]'::jsonb) into result from (
    select s.id from public.subscriptions s where
      ((s.status in ('active','grace') and s.next_billing_at<=clock_timestamp())
        or (s.status='grace' and s.grace_ends_at<=clock_timestamp())
        or (s.status='canceled' and coalesce(s.current_period_end,'-infinity'::timestamptz)<=clock_timestamp())
        or exists(select 1 from private.billing_obligations o join private.payment_attempts a on a.obligation_id=o.id
          join private.renewal_attempts r on r.attempt_id=a.id where o.subscription_id=s.id and o.state='open'
            and (a.state='unknown' or (a.state='inflight' and a.lease_expires_at<=clock_timestamp()))))
      and private.renewal_projection(s.id)->>'action' in ('charge','reconcile','expired','lease_expired')
    order by (cursor_id is null or s.id>cursor_id) desc,s.id limit p_limit
  ) q;
  if jsonb_array_length(result)>0 then
    update private.renewal_scan_cursor set last_subscription_id=(result->>-1)::uuid where singleton;
  end if;
  return result;
end;
$$;

-- Reuse the existing expiry contract, correcting its clock after lock waits.
create or replace function public.billing_expire_subscription(p_subscription_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare s public.subscriptions%rowtype; at_time timestamptz;
begin
  perform private.require_billing_service();
  select * into strict s from public.subscriptions where id=p_subscription_id for update;
  at_time:=clock_timestamp();
  if (s.status='grace' and s.grace_ends_at<=at_time)
    or (s.status='canceled' and coalesce(s.current_period_end,'-infinity'::timestamptz)<=at_time) then
    update public.subscriptions set status='expired',next_billing_at=null where id=s.id;
    update private.billing_obligations o set state='void' where o.subscription_id=s.id and o.state='open'
      and not exists(select 1 from private.payment_attempts a where a.obligation_id=o.id and a.state in ('inflight','unknown'));
  end if;
end;
$$;

create function public.renewal_claim(p_subscription_id uuid,p_mandate_id uuid default null,p_period_start timestamptz default null,
  p_period_end timestamptz default null,p_lease_seconds integer default 180) returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.subscriptions%rowtype; data jsonb; r private.renewal_policies%rowtype; o uuid; a uuid; descriptor jsonb; token uuid; at_time timestamptz;
begin
  perform private.require_billing_service();
  if p_lease_seconds is null or p_lease_seconds not between 90 and 300 then raise exception 'RENEWAL_INVALID_INPUT' using errcode='22023'; end if;
  -- Match enrollment's profile -> artist -> subscription order; cancellation and
  -- verified money lock subscription only and never acquire identity locks later.
  select * into s from public.subscriptions where id=p_subscription_id;
  if s.id is null then raise exception 'RENEWAL_NOT_FOUND' using errcode='P0002'; end if;
  perform 1 from public.profiles where id=s.user_id for update;
  perform 1 from public.artists where id=s.artist_id for share;
  select * into strict s from public.subscriptions where id=s.id for update;
  -- Policy/current legal rows are locked before the post-wait due-time snapshot.
  perform 1 from private.checkout_policy_current for share;
  data:=private.renewal_projection(s.id);
  if data->>'action'='lease_expired' then
    a:=(data->>'attempt_id')::uuid;
    perform public.billing_record_attempt_outcome(a,(select lease_token from private.payment_attempts where id=a),'unknown',null);
    return private.renewal_projection(s.id);
  end if;
  if data->>'action'='expired' then perform public.billing_expire_subscription(s.id); return private.renewal_projection(s.id)||jsonb_build_object('action','expired'); end if;
  if data->>'action' not in ('charge','reconcile') then return data; end if;
  if (data->>'mandate_id')::uuid is distinct from p_mandate_id or (data->>'period_start')::timestamptz is distinct from p_period_start
    or (data->>'period_end')::timestamptz is distinct from p_period_end then raise exception 'RENEWAL_SNAPSHOT_CHANGED' using errcode='55000'; end if;
  if data->>'action'='charge' then
    select * into strict r from private.renewal_policies where checkout_policy_version=(data->>'policy_version')::uuid;
    o:=public.billing_prepare_obligation(s.id,p_period_start,p_period_end,(data->>'amount_krw')::integer,false,
      data->>'policy_version',r.grace_seconds,r.retry_seconds,r.max_retries);
    a:=public.billing_prepare_attempt(o);
    insert into private.renewal_attempts(attempt_id) values(a) on conflict(attempt_id) do nothing;
    descriptor:=public.billing_claim_attempt(a,p_lease_seconds);
    if descriptor is null then return private.renewal_projection(s.id); end if;
    return private.renewal_projection(s.id)||jsonb_build_object('action','charge','dispatch',true,'lease_token',descriptor->'lease_token');
  end if;
  a:=(data->>'attempt_id')::uuid;
  perform 1 from private.billing_obligations where id=(select obligation_id from private.payment_attempts where id=a) for update;
  perform 1 from private.payment_attempts where id=a for update;
  perform 1 from private.renewal_attempts where attempt_id=a for update;
  at_time:=clock_timestamp();
  if exists(select 1 from private.payment_attempts where id=a and state='inflight' and lease_expires_at<=at_time) then
    perform public.billing_record_attempt_outcome(a,(select lease_token from private.payment_attempts where id=a),'unknown',null);
  end if;
  data:=private.renewal_projection(s.id);
  if data->>'action'<>'reconcile' then return data; end if;
  token:=gen_random_uuid();
  update private.renewal_attempts set query_attempts=query_attempts+1,query_lease_token=token,
    query_lease_expires_at=at_time+make_interval(secs=>p_lease_seconds),next_query_at=at_time+interval '1 hour' where attempt_id=a;
  return data||jsonb_build_object('dispatch',true,'lease_token',token);
end;
$$;

create function private.renewal_lock_attempt(p_attempt_id uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare sid uuid; oid uuid;
begin
  select o.subscription_id,o.id into sid,oid from private.payment_attempts a join private.billing_obligations o on o.id=a.obligation_id
    join private.renewal_attempts r on r.attempt_id=a.id where a.id=p_attempt_id;
  if sid is null then raise exception 'RENEWAL_NOT_FOUND' using errcode='P0002'; end if;
  perform 1 from public.subscriptions where id=sid for update;
  perform 1 from private.billing_obligations where id=oid for update;
  perform 1 from private.payment_attempts where id=p_attempt_id for update;
  perform 1 from private.renewal_attempts where attempt_id=p_attempt_id for update;
  return sid;
end;
$$;
create function public.renewal_record_outcome(p_attempt_id uuid,p_lease_token uuid,p_outcome text,p_evidence_ref uuid default null,
  p_retryable boolean default false,p_provider_payment_id text default null) returns void language plpgsql security definer set search_path='' as $$
declare sid uuid; a private.payment_attempts%rowtype; r private.renewal_attempts%rowtype;
begin
  perform private.require_billing_service(); sid:=private.renewal_lock_attempt(p_attempt_id);
  select * into strict a from private.payment_attempts where id=p_attempt_id;
  select * into strict r from private.renewal_attempts where attempt_id=p_attempt_id;
  if p_retryable is null or (p_outcome='unknown' and p_retryable) or p_lease_token is null or a.lease_token is distinct from p_lease_token
    or (p_provider_payment_id is not null and (length(p_provider_payment_id) not between 1 and 200 or p_provider_payment_id ~ '[[:cntrl:][:space:]]'))
    or (r.provider_payment_id is not null and r.provider_payment_id is distinct from p_provider_payment_id)
    or (a.state='failed' and r.retryable is distinct from p_retryable) then raise exception 'RENEWAL_OUTCOME_CONFLICT' using errcode='55000'; end if;
  perform public.billing_record_attempt_outcome(p_attempt_id,p_lease_token,p_outcome,p_evidence_ref);
  update private.renewal_attempts set retryable=case when p_outcome='failed' then p_retryable end,
    provider_payment_id=coalesce(provider_payment_id,p_provider_payment_id),next_query_at=clock_timestamp()+interval '1 hour' where attempt_id=p_attempt_id;
  if p_outcome='failed' and not p_retryable then update public.subscriptions set next_billing_at=null where id=sid; end if;
end;
$$;
create function public.renewal_record_query(p_attempt_id uuid,p_lease_token uuid) returns void language plpgsql security definer set search_path='' as $$
begin
  perform private.require_billing_service(); perform private.renewal_lock_attempt(p_attempt_id);
  if p_lease_token is null or not exists(select 1 from private.renewal_attempts where attempt_id=p_attempt_id and query_lease_token=p_lease_token) then
    raise exception 'RENEWAL_OUTCOME_CONFLICT' using errcode='55000'; end if;
  if not exists(select 1 from private.payment_attempts where id=p_attempt_id and state='unknown') then
    raise exception 'RENEWAL_OUTCOME_CONFLICT' using errcode='55000'; end if;
  -- A lost completion reply may be replayed once, but must not postpone recovery.
  if exists(select 1 from private.renewal_attempts where attempt_id=p_attempt_id and query_lease_expires_at is null) then return; end if;
  update private.renewal_attempts set query_lease_expires_at=null,next_query_at=greatest(next_query_at,clock_timestamp()+interval '1 hour') where attempt_id=p_attempt_id;
end;
$$;
create function public.renewal_finalize(p_attempt_id uuid,p_provider_action_id text,p_provider_payment_id text,
  p_amount_krw integer,p_currency text,p_approved_at timestamptz,p_evidence_ref uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare result uuid; known text;
begin
  perform private.require_billing_service(); perform private.renewal_lock_attempt(p_attempt_id);
  select provider_payment_id into known from private.renewal_attempts where attempt_id=p_attempt_id;
  if p_provider_payment_id is null or length(p_provider_payment_id) not between 1 and 200 or p_provider_payment_id ~ '[[:cntrl:][:space:]]'
    or p_provider_action_id is null or length(p_provider_action_id) not between 1 and 200 or p_provider_action_id ~ '[[:cntrl:][:space:]]'
    or (known is not null and known<>p_provider_payment_id) then raise exception 'RENEWAL_OUTCOME_CONFLICT' using errcode='55000'; end if;
  result:=public.billing_finalize_charge(p_attempt_id,p_provider_action_id,p_amount_krw,p_currency,p_approved_at,p_evidence_ref);
  update private.renewal_attempts set provider_payment_id=p_provider_payment_id,query_lease_token=null,query_lease_expires_at=null where attempt_id=p_attempt_id;
  return result;
end;
$$;
create function public.renewal_read_attempt(p_attempt_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  perform private.require_billing_service();
  select jsonb_build_object('attempt_id',a.id,'state',a.state,'payment_event_id',v.event_id) into result from private.payment_attempts a
    join private.renewal_attempts r on r.attempt_id=a.id left join private.payment_event_verifications v on v.attempt_id=a.id where a.id=p_attempt_id;
  if result is null then raise exception 'RENEWAL_NOT_FOUND' using errcode='P0002'; end if;
  return result;
end;
$$;
create function public.renewal_record_notice(p_subscription_id uuid,p_period_start timestamptz,p_policy_version uuid,
  p_amount_krw integer,p_delivered_at timestamptz,p_evidence_ref uuid) returns void language plpgsql security definer set search_path='' as $$
declare s public.subscriptions%rowtype; r private.renewal_policies%rowtype; existing private.renewal_notice_receipts%rowtype; p private.checkout_policies%rowtype;
begin
  perform private.require_billing_service();
  select * into strict s from public.subscriptions where id=p_subscription_id for update;
  select * into r from private.renewal_policies where checkout_policy_version=p_policy_version;
  select * into p from private.checkout_policies where version=p_policy_version;
  if p_period_start is null or p_delivered_at is null or not isfinite(p_period_start) or not isfinite(p_delivered_at)
    or p_evidence_ref is null or r.approved_at is null or r.approved_at>clock_timestamp() or r.published_at is null or r.published_at>clock_timestamp()
    or p_amount_krw is distinct from p.regular_price_krw or p_delivered_at>clock_timestamp()
    or p_delivered_at>p_period_start-make_interval(secs=>r.notice_lead_seconds)
    or p_period_start is distinct from s.current_period_end
    or not exists(select 1 from private.payment_mandates m where m.subscription_id=s.id and m.is_active and m.consent_version=p_policy_version::text) then
    raise exception 'RENEWAL_INVALID_NOTICE' using errcode='22023'; end if;
  select * into existing from private.renewal_notice_receipts where subscription_id=s.id and period_start=p_period_start and checkout_policy_version=p_policy_version;
  if existing.subscription_id is not null then
    if existing.amount_krw<>p_amount_krw or existing.delivered_at<>p_delivered_at or existing.evidence_ref<>p_evidence_ref then
      raise exception 'RENEWAL_NOTICE_CONFLICT' using errcode='23514'; end if;
    return;
  end if;
  insert into private.renewal_notice_receipts(subscription_id,period_start,checkout_policy_version,amount_krw,delivered_at,evidence_ref)
    values(s.id,p_period_start,p_policy_version,p_amount_krw,p_delivered_at,p_evidence_ref);
end;
$$;

revoke all on function private.renewal_policy_immutable(),private.renewal_period_end(timestamptz,timestamptz,text),
  private.renewal_projection(uuid),private.renewal_lock_attempt(uuid) from public,anon,authenticated,service_role;
revoke all on function public.renewal_read(uuid),public.renewal_candidates(integer),public.renewal_claim(uuid,uuid,timestamptz,timestamptz,integer),
  public.renewal_record_outcome(uuid,uuid,text,uuid,boolean,text),public.renewal_record_query(uuid,uuid),
  public.renewal_finalize(uuid,text,text,integer,text,timestamptz,uuid),public.renewal_read_attempt(uuid),
  public.renewal_record_notice(uuid,timestamptz,uuid,integer,timestamptz,uuid) from public,anon,authenticated,service_role;
grant execute on function public.renewal_read(uuid),public.renewal_candidates(integer),public.renewal_claim(uuid,uuid,timestamptz,timestamptz,integer),
  public.renewal_record_outcome(uuid,uuid,text,uuid,boolean,text),public.renewal_record_query(uuid,uuid),
  public.renewal_finalize(uuid,text,text,integer,text,timestamptz,uuid),public.renewal_read_attempt(uuid),
  public.renewal_record_notice(uuid,timestamptz,uuid,integer,timestamptz,uuid) to service_role;
commit;
