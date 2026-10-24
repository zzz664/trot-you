-- Query-only recovery. A provider notice is an untrusted, bounded hint, never
-- verified financial evidence. This migration enables no scheduler or provider.
begin;

create table private.payment_reconciliation_cases (
  id uuid primary key default gen_random_uuid(),
  initial_session_id uuid unique references private.subscription_enrollments(session_id) on delete restrict,
  renewal_attempt_id uuid unique references private.renewal_attempts(attempt_id) on delete restrict,
  refund_request_id uuid unique references private.refund_requests(id) on delete restrict,
  kind text generated always as (case when initial_session_id is not null then 'initial' when renewal_attempt_id is not null then 'renewal' else 'refund' end) stored,
  target_id uuid generated always as (coalesce(initial_session_id,renewal_attempt_id,refund_request_id)) stored,
  state text not null default 'pending' check(state in ('pending','processing','retry','processed','manual_review')),
  reason text check(reason in ('PAYMENT_ID_MISSING','CREDENTIAL_MISSING','QUERY_BUDGET_EXHAUSTED','OPERATION_NOT_QUERYABLE','QUERY_UNCONFIRMED')),
  query_attempts integer not null default 0 check(query_attempts between 0 and 3),
  lease_token uuid,
  lease_expires_at timestamptz,
  next_query_at timestamptz not null default clock_timestamp(),
  payment_event_id uuid references public.payment_events(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check(num_nonnulls(initial_session_id,renewal_attempt_id,refund_request_id)=1),
  check((lease_token is null)=(lease_expires_at is null)),
  check(state<>'processing' or lease_token is not null),
  check(isfinite(created_at) and isfinite(updated_at) and isfinite(next_query_at) and (lease_expires_at is null or isfinite(lease_expires_at)))
);
create index payment_reconciliation_work on private.payment_reconciliation_cases(state,next_query_at,created_at,id);
create table private.payment_provider_inbox (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references private.payment_reconciliation_cases(id) on delete restrict,
  status text not null check(status in ('DONE','CANCELED','PARTIAL_CANCELED')),
  payload_digest text not null check(payload_digest ~ '^[a-f0-9]{64}$'),
  state text not null default 'pending' check(state in ('pending','processed','manual_review')),
  received_at timestamptz not null default clock_timestamp(),
  processed_at timestamptz,
  unique(case_id,status),
  check(isfinite(received_at) and (processed_at is null or isfinite(processed_at)))
);
alter table private.payment_reconciliation_cases enable row level security;
alter table private.payment_provider_inbox enable row level security;
revoke all on private.payment_reconciliation_cases,private.payment_provider_inbox from public,anon,authenticated,service_role;
comment on table private.payment_provider_inbox is 'Untrusted Toss payment-status hints for known operations only; at most three semantic states per case. No payload, customer data, payment key, credential, transmission ID or financial assertion is retained. Duplicate notices never reset recovery budgets.';
comment on table private.payment_reconciliation_cases is 'At most one case per existing operation. Query-only recovery shares renewal/refund budgets and leases. Kakao without TID cannot dispatch. No case authorizes a charge, refund, retry or mandate change.';

create function private.reconciliation_snapshot(p_case_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c private.payment_reconciliation_cases%rowtype; data jsonb; e private.subscription_enrollments%rowtype;
  r private.refund_requests%rowtype; a private.payment_attempts%rowtype; sid uuid; payment_id text; action_id text;
  original_amount integer; refunded_before integer; approved_at timestamptz; started_at timestamptz; event uuid;
begin
  select * into c from private.payment_reconciliation_cases where id=p_case_id;
  if c.id is null then raise exception 'RECONCILIATION_NOT_FOUND' using errcode='P0002'; end if;
  if c.kind='initial' then
    select * into strict e from private.subscription_enrollments where session_id=c.target_id;
    data:=private.enrollment_projection(c.target_id);
    select * into a from private.payment_attempts where id=e.attempt_id;
    sid:=e.subscription_id; payment_id:=coalesce(e.provider_payment_id,e.provider_tid); started_at:=coalesce(a.created_at,e.created_at); event:=e.payment_event_id;
    data:=jsonb_build_object('provider',data->'provider','environment',data->'environment','merchant_account',data->'merchant_account',
      'customer_ref',data->'customer_ref','order_id',data->'order_id','amount_krw',data->'initial_price_krw','tax_basis',data->'payment_tax_basis');
  elsif c.kind='renewal' then
    select pa.* into strict a from private.payment_attempts pa where pa.id=c.target_id;
    select o.subscription_id into strict sid from private.billing_obligations o where o.id=a.obligation_id;
    select jsonb_build_object('provider',m.provider,'environment',m.environment,'merchant_account',m.merchant_account,
      'customer_ref',m.provider_customer_ref,'order_id',a.id,'amount_krw',o.amount_krw,'tax_basis',p.payment_tax_basis),ra.provider_payment_id
      into data,payment_id from private.billing_obligations o join private.payment_mandates m on m.id=o.mandate_id
      join private.checkout_policies p on p.version::text=o.price_version join private.renewal_attempts ra on ra.attempt_id=a.id where o.id=a.obligation_id;
    select v.event_id into event from private.payment_event_verifications v where v.attempt_id=a.id;
    started_at:=a.created_at;
  else
    select * into strict r from private.refund_requests where id=c.target_id;
    data:=private.refund_dispatch_projection(c.target_id);
    sid:=r.subscription_id; payment_id:=data->>'provider_payment_id'; action_id:=data->>'provider_charge_action_id';
    original_amount:=(data->>'charge_amount_krw')::integer; refunded_before:=r.refunded_before_krw; approved_at:=r.decided_at;
    started_at:=r.requested_at; event:=r.payment_event_id;
    data:=jsonb_build_object('provider',data->'provider','environment',data->'environment','merchant_account',data->'merchant_account',
      'customer_ref',data->'customer_ref','order_id',data->'order_id','amount_krw',data->'amount_krw','tax_basis',data->'payment_tax_basis');
  end if;
  return data||jsonb_build_object('id',c.id,'kind',c.kind,'target_id',c.target_id,'subscription_id',sid,'currency','KRW',
    'provider_payment_id',payment_id,'provider_charge_action_id',action_id,'original_amount_krw',original_amount,
    'refunded_before_krw',refunded_before,'authorized_at',approved_at,'operation_started_at',started_at,
    'state',c.state,'reason',c.reason,'dispatch',false,'lease_token',null,'query_attempts',c.query_attempts,'payment_event_id',event);
end;$$;

create function public.reconciliation_read(p_case_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin perform private.require_billing_service(); return private.reconciliation_snapshot(p_case_id); end;$$;

create function public.reconciliation_enrollment_case(p_user_id uuid,p_session_id uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare e private.subscription_enrollments%rowtype; result uuid;
begin
  perform private.require_billing_service();
  select * into e from private.subscription_enrollments where session_id=p_session_id and user_id=p_user_id;
  if e.session_id is null then raise exception 'RECONCILIATION_NOT_FOUND' using errcode='P0002'; end if;
  if e.state not in ('unknown','manual_review','succeeded') and not(e.state='processing' and e.lease_expires_at<=clock_timestamp()) then
    raise exception 'RECONCILIATION_STATE_CONFLICT' using errcode='55000'; end if;
  insert into private.payment_reconciliation_cases(initial_session_id,state,reason,payment_event_id)
    values(e.session_id,case when e.state='succeeded' then 'processed' when e.state='manual_review' then 'manual_review' else 'pending' end,
      case when e.state='manual_review' then case when e.stage in ('charge','approve') then 'CREDENTIAL_MISSING' else 'OPERATION_NOT_QUERYABLE' end end,e.payment_event_id)
    on conflict(initial_session_id) do nothing;
  select id into strict result from private.payment_reconciliation_cases where initial_session_id=e.session_id;
  return result;
end;$$;

create function public.reconciliation_candidates(p_limit integer default 20) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb; settled record;
begin
  perform private.require_billing_service();
  if p_limit is null or p_limit not between 1 and 20 then raise exception 'RECONCILIATION_INVALID_INPUT' using errcode='22023'; end if;
  -- Each source contributes a bounded batch. Already-cased rows cannot starve
  -- later operations, including operations that need human rather than API work.
  insert into private.payment_reconciliation_cases(initial_session_id,state,reason)
  select e.session_id,case when e.stage not in ('charge','approve') or e.state='manual_review' then 'manual_review' else 'pending' end,
    case when e.stage not in ('charge','approve') then 'OPERATION_NOT_QUERYABLE' when e.state='manual_review' then 'CREDENTIAL_MISSING' end
    from private.subscription_enrollments e where (e.state in ('unknown','manual_review') or (e.state='processing' and e.lease_expires_at<=clock_timestamp()))
    and not exists(select 1 from private.payment_reconciliation_cases c where c.initial_session_id=e.session_id)
    order by e.created_at,e.session_id limit p_limit on conflict(initial_session_id) do nothing;
  insert into private.payment_reconciliation_cases(renewal_attempt_id,state,reason,query_attempts,next_query_at)
  select a.id,case when (m.provider='kakaopay' and ra.provider_payment_id is null) or ra.query_attempts>=3 then 'manual_review' else 'pending' end,
    case when m.provider='kakaopay' and ra.provider_payment_id is null then 'PAYMENT_ID_MISSING' when ra.query_attempts>=3 then 'QUERY_BUDGET_EXHAUSTED' end,
    ra.query_attempts,ra.next_query_at from private.renewal_attempts ra join private.payment_attempts a on a.id=ra.attempt_id
    join private.billing_obligations o on o.id=a.obligation_id join private.payment_mandates m on m.id=o.mandate_id
    where (a.state='unknown' or (a.state='inflight' and a.lease_expires_at<=clock_timestamp()))
    and not exists(select 1 from private.payment_reconciliation_cases c where c.renewal_attempt_id=a.id)
    order by a.created_at,a.id limit p_limit on conflict(renewal_attempt_id) do nothing;
  insert into private.payment_reconciliation_cases(refund_request_id,state,reason,query_attempts,next_query_at)
  select r.id,case when r.query_attempts>=3 then 'manual_review' else 'pending' end,
    case when r.query_attempts>=3 then 'QUERY_BUDGET_EXHAUSTED' end,r.query_attempts,r.next_query_at
    from private.refund_requests r where (r.state='unknown' or (r.state='inflight' and r.lease_expires_at<=clock_timestamp()))
    and not exists(select 1 from private.payment_reconciliation_cases c where c.refund_request_id=r.id)
    order by r.requested_at,r.id limit p_limit on conflict(refund_request_id) do nothing;
  -- Existing owner/renewal/refund recovery may settle while a case is waiting.
  -- Observe committed ledger evidence without acquiring domain locks and repair
  -- the inbox together; never keep a stale manual-review badge for settled money.
  for settled in
    select c.id,coalesce(e.payment_event_id,v.event_id,r.payment_event_id) event_id
      from private.payment_reconciliation_cases c
      left join private.subscription_enrollments e on e.session_id=c.initial_session_id
      left join private.payment_event_verifications v on v.attempt_id=c.renewal_attempt_id
      left join private.refund_requests r on r.id=c.refund_request_id
      where c.state<>'processed' and coalesce(e.payment_event_id,v.event_id,r.payment_event_id) is not null
      order by c.created_at,c.id limit p_limit
  loop
    update private.payment_reconciliation_cases set state='processed',reason=null,payment_event_id=settled.event_id,
      lease_token=null,lease_expires_at=null,updated_at=clock_timestamp() where id=settled.id;
    update private.payment_provider_inbox set state='processed',processed_at=coalesce(processed_at,clock_timestamp()) where case_id=settled.id;
  end loop;
  select coalesce(jsonb_agg(q.id order by q.next_query_at,q.created_at,q.id),'[]'::jsonb) into result from (
    select c.id,c.next_query_at,c.created_at from private.payment_reconciliation_cases c
    where c.state in ('pending','retry','processing') and c.next_query_at<=clock_timestamp()
      and (c.lease_expires_at is null or c.lease_expires_at<=clock_timestamp())
    order by c.next_query_at,c.created_at,c.id limit p_limit) q;
  return result;
end;$$;

-- Inbox matching is against local immutable payment identity. In particular an
-- attacker-provided paymentKey is NEVER adopted to repair a missing identifier.
create function public.reconciliation_receive_toss(p_environment text,p_merchant_account text,p_order_id uuid,
  p_payment_id text,p_status text,p_amount_krw integer,p_payload_digest text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a private.payment_attempts%rowtype; o private.billing_obligations%rowtype; m private.payment_mandates%rowtype;
  e private.subscription_enrollments%rowtype; r private.refund_requests%rowtype; c private.payment_reconciliation_cases%rowtype;
  known text; cid uuid; inserted uuid;
begin
  perform private.require_billing_service();
  if p_environment is null or p_environment not in ('test','live') or p_order_id is null or p_amount_krw is null or p_amount_krw<=0
    or p_merchant_account is null or length(p_merchant_account) not between 1 and 100 or p_merchant_account ~ '[[:cntrl:][:space:]]'
    or p_payment_id is null or length(p_payment_id) not between 1 and 200 or p_payment_id ~ '[[:cntrl:][:space:]]'
    or p_status is null or p_status not in ('DONE','CANCELED','PARTIAL_CANCELED') or p_payload_digest is null or p_payload_digest !~ '^[a-f0-9]{64}$' then
    raise exception 'RECONCILIATION_INVALID_INPUT' using errcode='22023'; end if;
  select * into a from private.payment_attempts where id=p_order_id;
  select * into o from private.billing_obligations where id=a.obligation_id;
  select * into m from private.payment_mandates where id=o.mandate_id;
  if a.id is null or a.state not in ('inflight','unknown','success') or m.provider is distinct from 'toss'::public.payment_provider
    or m.environment::text is distinct from p_environment or m.merchant_account is distinct from p_merchant_account or o.amount_krw is distinct from p_amount_krw then
    return jsonb_build_object('accepted',false,'duplicate',false); end if;
  select * into e from private.subscription_enrollments where attempt_id=a.id;
  known:=coalesce(e.provider_payment_id,(select ra.provider_payment_id from private.renewal_attempts ra where ra.attempt_id=a.id));
  if known is not null and known<>p_payment_id then return jsonb_build_object('accepted',false,'duplicate',false); end if;
  if p_status in ('CANCELED','PARTIAL_CANCELED') then
    select rr.* into r from private.refund_requests rr join private.payment_event_verifications v on v.event_id=rr.original_event_id
      where v.attempt_id=a.id and rr.state in ('inflight','unknown','succeeded') order by rr.requested_at desc,rr.id limit 1;
    if r.id is null then return jsonb_build_object('accepted',false,'duplicate',false); end if;
    insert into private.payment_reconciliation_cases(refund_request_id,state,payment_event_id,query_attempts,next_query_at)
      values(r.id,case when r.state='succeeded' then 'processed' else 'pending' end,r.payment_event_id,r.query_attempts,r.next_query_at)
      on conflict(refund_request_id) do nothing;
    select id into cid from private.payment_reconciliation_cases where refund_request_id=r.id;
  elsif e.session_id is not null then
    insert into private.payment_reconciliation_cases(initial_session_id,state,payment_event_id)
      values(e.session_id,case when e.state='succeeded' then 'processed' when e.state='manual_review' then 'manual_review' else 'pending' end,e.payment_event_id)
      on conflict(initial_session_id) do nothing;
    select id into cid from private.payment_reconciliation_cases where initial_session_id=e.session_id;
  elsif exists(select 1 from private.renewal_attempts where attempt_id=a.id) then
    insert into private.payment_reconciliation_cases(renewal_attempt_id,state,payment_event_id,query_attempts,next_query_at)
      select a.id,case when a.state='success' then 'processed' else 'pending' end,(select event_id from private.payment_event_verifications where attempt_id=a.id),ra.query_attempts,ra.next_query_at
      from private.renewal_attempts ra where ra.attempt_id=a.id on conflict(renewal_attempt_id) do nothing;
    select id into cid from private.payment_reconciliation_cases where renewal_attempt_id=a.id;
  else return jsonb_build_object('accepted',false,'duplicate',false); end if;
  select * into strict c from private.payment_reconciliation_cases where id=cid for update;
  insert into private.payment_provider_inbox(case_id,status,payload_digest,state,processed_at)
    values(cid,p_status,p_payload_digest,case when c.state in ('processed','manual_review') then c.state else 'pending' end,
      case when c.state in ('processed','manual_review') then clock_timestamp() end)
    on conflict(case_id,status) do nothing returning id into inserted;
  return jsonb_build_object('accepted',true,'duplicate',inserted is null);
end;$$;

create function public.reconciliation_claim(p_case_id uuid,p_lease_seconds integer default 180) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c private.payment_reconciliation_cases%rowtype; e private.subscription_enrollments%rowtype;
  a private.payment_attempts%rowtype; r private.refund_requests%rowtype; ra private.renewal_attempts%rowtype;
  data jsonb; token uuid; at_time timestamptz; review_reason text; attempts integer; due timestamptz; active_lease timestamptz; event uuid;
begin
  perform private.require_billing_service();
  if p_lease_seconds is null or p_lease_seconds not between 90 and 300 then raise exception 'RECONCILIATION_INVALID_INPUT' using errcode='22023'; end if;
  -- Case row is acquired before existing domain lock orders. No existing
  -- domain RPC acquires a case row, so this introduces no reverse dependency.
  select * into c from private.payment_reconciliation_cases where id=p_case_id for update;
  if c.id is null then raise exception 'RECONCILIATION_NOT_FOUND' using errcode='P0002'; end if;
  at_time:=clock_timestamp();
  if c.state in ('processed','manual_review') or c.next_query_at>at_time or c.lease_expires_at>at_time then return private.reconciliation_snapshot(c.id); end if;
  if c.kind='initial' then
    select * into strict e from private.subscription_enrollments where session_id=c.target_id;
    e:=private.enrollment_lock(e.user_id,e.session_id);
    at_time:=clock_timestamp();
    if e.state='succeeded' then event:=e.payment_event_id;
    elsif e.stage not in ('charge','approve') or e.attempt_id is null or e.state in ('failed','canceled','ready','awaiting_authorization','awaiting_confirmation') then review_reason:='OPERATION_NOT_QUERYABLE';
    elsif e.state='manual_review' then review_reason:='CREDENTIAL_MISSING';
    elsif e.state='processing' and e.lease_expires_at>at_time then due:=e.lease_expires_at;
    else
      if e.state='processing' then
        perform public.billing_record_attempt_outcome(e.attempt_id,e.lease_token,'unknown',null);
        update private.subscription_enrollments set state='unknown',callback_ciphertext=null,callback_expires_at=null,ready_ciphertext=null where session_id=e.session_id;
      end if;
      data:=private.reconciliation_snapshot(c.id);
      if data->>'provider'='kakaopay' and data->>'provider_payment_id' is null then review_reason:='PAYMENT_ID_MISSING'; end if;
    end if;
    attempts:=c.query_attempts;
  elsif c.kind='renewal' then
    perform private.renewal_lock_attempt(c.target_id);
    select * into strict a from private.payment_attempts where id=c.target_id;
    select * into strict ra from private.renewal_attempts where attempt_id=c.target_id;
    at_time:=clock_timestamp(); attempts:=ra.query_attempts; due:=ra.next_query_at; active_lease:=ra.query_lease_expires_at;
    if a.state='success' then select v.event_id into event from private.payment_event_verifications v where v.attempt_id=a.id;
    elsif a.state='inflight' and a.lease_expires_at>at_time then due:=greatest(due,a.lease_expires_at);
    elsif a.state not in ('unknown','inflight') then review_reason:='OPERATION_NOT_QUERYABLE';
    else
      if a.state='inflight' then perform public.billing_record_attempt_outcome(a.id,a.lease_token,'unknown',null); end if;
      data:=private.reconciliation_snapshot(c.id);
      if data->>'provider'='kakaopay' and ra.provider_payment_id is null then review_reason:='PAYMENT_ID_MISSING'; end if;
    end if;
  else
    select * into strict r from private.refund_requests where id=c.target_id;
    perform 1 from public.subscriptions where id=r.subscription_id for update;
    perform 1 from public.payment_events where id=r.original_event_id for update;
    select * into strict r from private.refund_requests where id=c.target_id for update;
    at_time:=clock_timestamp(); attempts:=r.query_attempts; due:=r.next_query_at; active_lease:=r.query_lease_expires_at;
    if r.state='succeeded' then event:=r.payment_event_id;
    elsif r.state='inflight' and r.lease_expires_at>at_time then due:=greatest(due,r.lease_expires_at);
    elsif r.state not in ('unknown','inflight') then review_reason:='OPERATION_NOT_QUERYABLE';
    else
      if r.state='inflight' then update private.refund_requests set state='unknown',next_query_at=at_time where id=r.id; due:=at_time; end if;
      data:=private.reconciliation_snapshot(c.id);
      if data->>'provider_payment_id' is null then review_reason:='PAYMENT_ID_MISSING'; end if;
    end if;
  end if;
  if event is not null then
    update private.payment_reconciliation_cases set state='processed',reason=null,payment_event_id=event,lease_token=null,lease_expires_at=null,query_attempts=attempts,updated_at=clock_timestamp() where id=c.id;
    update private.payment_provider_inbox set state='processed',processed_at=coalesce(processed_at,clock_timestamp()) where case_id=c.id;
    return private.reconciliation_snapshot(c.id);
  end if;
  if attempts>=3 then review_reason:=coalesce(review_reason,'QUERY_BUDGET_EXHAUSTED'); end if;
  if review_reason is not null then
    update private.payment_reconciliation_cases set state='manual_review',reason=review_reason,query_attempts=attempts,lease_token=null,lease_expires_at=null,updated_at=clock_timestamp() where id=c.id;
    update private.payment_provider_inbox set state='manual_review',processed_at=coalesce(processed_at,clock_timestamp()) where case_id=c.id;
    return private.reconciliation_snapshot(c.id);
  end if;
  if due>at_time or active_lease>at_time then
    update private.payment_reconciliation_cases set state='retry',query_attempts=attempts,lease_token=null,lease_expires_at=null,next_query_at=greatest(due,active_lease),updated_at=clock_timestamp() where id=c.id;
    return private.reconciliation_snapshot(c.id);
  end if;
  token:=gen_random_uuid();
  update private.payment_reconciliation_cases set state='processing',reason=null,query_attempts=attempts+1,lease_token=token,
    lease_expires_at=at_time+make_interval(secs=>p_lease_seconds),next_query_at=at_time+interval '1 hour',updated_at=at_time where id=c.id;
  if c.kind='renewal' then
    update private.renewal_attempts set query_attempts=attempts+1,query_lease_token=token,query_lease_expires_at=at_time+make_interval(secs=>p_lease_seconds),next_query_at=at_time+interval '1 hour' where attempt_id=c.target_id;
  elsif c.kind='refund' then
    update private.refund_requests set query_attempts=attempts+1,query_lease_token=token,query_lease_expires_at=at_time+make_interval(secs=>p_lease_seconds),next_query_at=at_time+interval '1 hour' where id=c.target_id;
  end if;
  return private.reconciliation_snapshot(c.id)||jsonb_build_object('dispatch',true,'lease_token',token);
end;$$;

create function public.reconciliation_defer(p_case_id uuid,p_lease_token uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c private.payment_reconciliation_cases%rowtype;
begin
  perform private.require_billing_service();
  select * into c from private.payment_reconciliation_cases where id=p_case_id for update;
  if c.id is null then raise exception 'RECONCILIATION_NOT_FOUND' using errcode='P0002'; end if;
  if p_lease_token is null or c.lease_token is distinct from p_lease_token or c.state<>'processing' then
    raise exception 'RECONCILIATION_LEASE_CONFLICT' using errcode='55000'; end if;
  if c.kind='renewal' then perform public.renewal_record_query(c.target_id,p_lease_token);
  elsif c.kind='refund' then perform public.refund_record_outcome(c.target_id,p_lease_token,'unknown',null); end if;
  update private.payment_reconciliation_cases set state=case when query_attempts>=3 then 'manual_review' else 'retry' end,
    reason=case when query_attempts>=3 then 'QUERY_BUDGET_EXHAUSTED' else 'QUERY_UNCONFIRMED' end,
    lease_token=null,lease_expires_at=null,updated_at=clock_timestamp() where id=c.id;
  if c.query_attempts>=3 then update private.payment_provider_inbox set state='manual_review',processed_at=coalesce(processed_at,clock_timestamp()) where case_id=c.id; end if;
  return private.reconciliation_snapshot(c.id);
end;$$;

create function public.reconciliation_complete(p_case_id uuid,p_lease_token uuid,p_provider_action_id text,p_provider_payment_id text,
  p_amount_krw integer,p_currency text,p_occurred_at timestamptz,p_evidence_ref uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c private.payment_reconciliation_cases%rowtype; e private.subscription_enrollments%rowtype; data jsonb; event uuid; missing boolean:=false;
begin
  perform private.require_billing_service();
  select * into c from private.payment_reconciliation_cases where id=p_case_id for update;
  if c.id is null then raise exception 'RECONCILIATION_NOT_FOUND' using errcode='P0002'; end if;
  if p_lease_token is null or c.lease_token is distinct from p_lease_token or c.state not in ('processing','processed','manual_review') then
    raise exception 'RECONCILIATION_LEASE_CONFLICT' using errcode='55000'; end if;
  -- Exact finalizer replay remains allowed after a response is lost. A newly
  -- claimed lease changes the token and rejects an older worker's settlement.
  if c.kind='initial' then
    select * into strict e from private.subscription_enrollments where session_id=c.target_id;
    e:=private.enrollment_lock(e.user_id,e.session_id);
    data:=private.reconciliation_snapshot(c.id);
    missing:=data->>'provider'='kakaopay' and not exists(select 1 from private.enrollment_credentials v where v.id=e.credential_ref and v.mandate_id=e.mandate_id);
    if missing then
      perform public.enrollment_record_reconciliation(e.user_id,e.session_id,p_provider_action_id,p_provider_payment_id,p_amount_krw,p_currency,p_occurred_at,p_evidence_ref);
    else
      data:=public.enrollment_finalize(e.user_id,e.session_id,p_provider_action_id,p_provider_payment_id,p_amount_krw,p_currency,p_occurred_at,p_evidence_ref,null);
      event:=(data->>'payment_event_id')::uuid;
    end if;
  elsif c.kind='renewal' then
    event:=public.renewal_finalize(c.target_id,p_provider_action_id,p_provider_payment_id,p_amount_krw,p_currency,p_occurred_at,p_evidence_ref);
  else event:=public.refund_finalize(c.target_id,p_provider_action_id,p_provider_payment_id,p_amount_krw,p_currency,p_occurred_at,p_evidence_ref); end if;
  update private.payment_reconciliation_cases set state=case when missing then 'manual_review' else 'processed' end,
    reason=case when missing then 'CREDENTIAL_MISSING' end,payment_event_id=event,updated_at=clock_timestamp() where id=c.id;
  update private.payment_provider_inbox set state=case when missing then 'manual_review' else 'processed' end,
    processed_at=coalesce(processed_at,clock_timestamp()) where case_id=c.id;
  return private.reconciliation_snapshot(c.id);
end;$$;

create function public.reconciliation_admin_list(p_page integer default 1,p_limit integer default 50) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb; more boolean;
begin
  perform private.refund_require_admin();
  if p_page is null or p_page not between 1 and 100000 or p_limit is null or p_limit not between 1 and 50 then
    raise exception 'RECONCILIATION_INVALID_INPUT' using errcode='22023'; end if;
  select coalesce(jsonb_agg(q.item order by q.created_at desc,q.id desc),'[]'::jsonb) into result from (
    select c.id,c.created_at,jsonb_build_object('id',c.id,'kind',c.kind,'subscription_id',s.data->'subscription_id',
      'provider',s.data->'provider','environment',s.data->'environment','amount_krw',s.data->'amount_krw',
      'status',c.state,'reason',c.reason,'query_attempts',c.query_attempts,'created_at',c.created_at,'updated_at',c.updated_at) item
      from private.payment_reconciliation_cases c cross join lateral(select private.reconciliation_snapshot(c.id) data) s
      order by c.created_at desc,c.id desc limit p_limit offset (p_page-1)*p_limit) q;
  select exists(select 1 from private.payment_reconciliation_cases order by created_at desc,id desc offset p_page*p_limit limit 1) into more;
  return jsonb_build_object('cases',result,'page',p_page,'has_more',more);
end;$$;

revoke all on function private.reconciliation_snapshot(uuid) from public,anon,authenticated,service_role;
revoke all on function public.reconciliation_read(uuid),public.reconciliation_enrollment_case(uuid,uuid),public.reconciliation_candidates(integer),public.reconciliation_receive_toss(text,text,uuid,text,text,integer,text),public.reconciliation_claim(uuid,integer),public.reconciliation_defer(uuid,uuid),public.reconciliation_complete(uuid,uuid,text,text,integer,text,timestamptz,uuid),public.reconciliation_admin_list(integer,integer) from public,anon,authenticated,service_role;
grant execute on function public.reconciliation_read(uuid),public.reconciliation_enrollment_case(uuid,uuid),public.reconciliation_candidates(integer),public.reconciliation_receive_toss(text,text,uuid,text,text,integer,text),public.reconciliation_claim(uuid,integer),public.reconciliation_defer(uuid,uuid),public.reconciliation_complete(uuid,uuid,text,text,integer,text,timestamptz,uuid) to service_role;
grant execute on function public.reconciliation_admin_list(integer,integer) to authenticated;
commit;
