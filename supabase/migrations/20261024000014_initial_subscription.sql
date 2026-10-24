-- Initial subscription enrollment only. No provider I/O, credentials, policy,
-- merchant configuration or financial transaction is seeded by this migration.
begin;

create function private.enrollment_ciphertext_valid(p_value jsonb) returns boolean
language sql immutable set search_path='' as $$
  select case when jsonb_typeof(p_value) is distinct from 'object' then false else coalesce(
    (select count(*)=4 from jsonb_object_keys(p_value))
    and jsonb_typeof(p_value->'version')='string'
    and (p_value->>'version') ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$'
    and jsonb_typeof(p_value->'iv')='string' and (p_value->>'iv') ~ '^[A-Za-z0-9_-]{16}$'
    and jsonb_typeof(p_value->'tag')='string' and (p_value->>'tag') ~ '^[A-Za-z0-9_-]{22}$'
    and jsonb_typeof(p_value->'ciphertext')='string'
    and length(p_value->>'ciphertext') between 1 and 10923
    and (p_value->>'ciphertext') ~ '^[A-Za-z0-9_-]+$',false) end;
$$;

create table private.subscription_enrollments (
  session_id uuid primary key references private.checkout_sessions(id) on delete restrict,
  user_id uuid not null references public.profiles(id) on delete restrict,
  artist_id uuid not null references public.artists(id) on delete restrict,
  subscription_id uuid not null references public.subscriptions(id) on delete restrict,
  mandate_id uuid not null unique references private.payment_mandates(id) on delete restrict,
  credential_ref uuid not null unique,
  auth_session_hash text not null check (auth_session_hash ~ '^[a-f0-9]{64}$'),
  callback_state_hash text not null check (callback_state_hash ~ '^[a-f0-9]{64}$'),
  state text not null check (state in ('ready','awaiting_authorization','awaiting_confirmation',
    'processing','unknown','manual_review','succeeded','failed','canceled')),
  stage text check (stage in ('ready','exchange','charge','approve')),
  lease_token uuid,
  lease_expires_at timestamptz,
  callback_ciphertext jsonb check (callback_ciphertext is null or private.enrollment_ciphertext_valid(callback_ciphertext)),
  callback_expires_at timestamptz,
  ready_ciphertext jsonb check (ready_ciphertext is null or private.enrollment_ciphertext_valid(ready_ciphertext)),
  provider_tid text check (length(provider_tid) between 1 and 100 and provider_tid ~ '^[A-Za-z0-9_-]+$'),
  charge_consented_at timestamptz,
  obligation_id uuid unique references private.billing_obligations(id) on delete restrict,
  attempt_id uuid unique references private.payment_attempts(id) on delete restrict,
  payment_event_id uuid unique references public.payment_events(id) on delete restrict,
  provider_payment_id text check (length(provider_payment_id) between 1 and 200 and provider_payment_id !~ '[[:cntrl:][:space:]]'),
  created_at timestamptz not null default clock_timestamp(),
  finished_at timestamptz,
  check ((callback_ciphertext is null)=(callback_expires_at is null)),
  check (callback_expires_at is null or isfinite(callback_expires_at)),
  check ((lease_token is null)=(lease_expires_at is null)),
  check (lease_expires_at is null or isfinite(lease_expires_at)),
  check (state<>'processing' or (lease_token is not null and stage is not null)),
  check (state<>'succeeded' or payment_event_id is not null),
  check (isfinite(created_at) and (finished_at is null or isfinite(finished_at)))
);
create unique index subscription_enrollments_one_unresolved on private.subscription_enrollments(subscription_id)
  where state not in ('succeeded','failed','canceled');
create table private.enrollment_credentials (
  id uuid primary key,
  mandate_id uuid not null unique references private.payment_mandates(id) on delete restrict,
  ciphertext jsonb not null check (private.enrollment_ciphertext_valid(ciphertext)),
  created_at timestamptz not null default clock_timestamp()
);
create table private.enrollment_reconciliations (
  session_id uuid primary key references private.subscription_enrollments(session_id) on delete restrict,
  provider_action_id text not null check (length(provider_action_id) between 1 and 200 and provider_action_id !~ '[[:cntrl:][:space:]]'),
  provider_payment_id text not null check (length(provider_payment_id) between 1 and 200 and provider_payment_id !~ '[[:cntrl:][:space:]]'),
  amount_krw integer not null check (amount_krw>0),
  currency text not null check (currency='KRW'),
  approved_at timestamptz not null check (isfinite(approved_at)),
  evidence_ref uuid not null,
  reason text not null check (reason='credential_missing'),
  observed_at timestamptz not null default clock_timestamp()
);
alter table private.subscription_enrollments enable row level security;
alter table private.enrollment_credentials enable row level security;
alter table private.enrollment_reconciliations enable row level security;
revoke all on private.subscription_enrollments,private.enrollment_credentials,private.enrollment_reconciliations
  from public,anon,authenticated,service_role;
comment on table private.enrollment_credentials is
  'Server-only AES-256-GCM envelope. Application vault uses dedicated versioned key and AAD binding actor, artist, provider, environment, mandate and purpose. SQL checks envelope shape, not cryptographic authenticity. No clear credential or key is accepted here.';
comment on table private.enrollment_reconciliations is
  'Verified Kakao approval with missing SID: preserves bounded normalized evidence for manual review, never repeats approve or invents a credential. No raw provider response or personal data.';

create function private.enrollment_projection(p_session_id uuid) returns jsonb
language sql volatile security definer set search_path='' as $$
  select jsonb_build_object(
    'session_id',e.session_id,'user_id',e.user_id,'artist_id',e.artist_id,
    'artist_slug',a.slug,'artist_name',a.name,'provider',c.provider,'environment',c.environment,
    'merchant_account',m.merchant_account,'subscription_id',e.subscription_id,'mandate_id',e.mandate_id,
    'credential_ref',e.credential_ref,'customer_ref',c.customer_ref,'order_id',c.order_id,
    'policy_version',c.policy_version,'policy_title',p.title,'policy_body',p.body,
    'initial_price_krw',c.initial_price_krw,'regular_price_krw',c.regular_price_krw,'intro_eligible',c.intro_eligible,
    'expires_at',c.expires_at,'state',e.state,'stage',e.stage,
    'public_status',case
      when e.state in ('succeeded','failed','canceled','unknown','manual_review') then e.state
      when e.state='processing' and e.lease_expires_at<=clock_timestamp() then
        case when e.stage in ('ready','exchange') then 'manual_review' else 'unknown' end
      when e.state='processing' then 'processing'
      when c.expires_at<=clock_timestamp() then 'expired'
      when e.state='awaiting_confirmation' and e.callback_expires_at<=clock_timestamp() and v.id is null then 'expired'
      when e.state='ready' then 'processing' else e.state end,
    'callback_ciphertext',case when e.callback_expires_at>clock_timestamp() and c.expires_at>clock_timestamp()
      and e.state in ('awaiting_confirmation','processing') then e.callback_ciphertext end,
    'callback_expires_at',e.callback_expires_at,
    'credential_ciphertext',v.ciphertext,'tid',e.provider_tid,
    'redirects',case when c.expires_at>clock_timestamp() and e.state='awaiting_authorization' then e.ready_ciphertext end,
    'payment_event_id',e.payment_event_id,'period_start',o.period_start,'period_end',o.period_end)
  from private.subscription_enrollments e join private.checkout_sessions c on c.id=e.session_id
  join public.artists a on a.id=e.artist_id join private.checkout_policies p on p.version=c.policy_version
  join private.payment_mandates m on m.id=e.mandate_id
  left join private.enrollment_credentials v on v.id=e.credential_ref and v.mandate_id=e.mandate_id
  left join private.billing_obligations o on o.id=e.obligation_id where e.session_id=p_session_id;
$$;

-- Every enrollment mutation has one lock order: profile -> artist ->
-- subscription -> checkout -> enrollment -> obligation -> attempt. It matches
-- existing checkout/billing serialization and holds no lock across HTTP I/O.
create function private.enrollment_lock(p_user_id uuid,p_session_id uuid) returns private.subscription_enrollments
language plpgsql security definer set search_path='' as $$
declare e private.subscription_enrollments%rowtype;
begin
  perform 1 from public.profiles where id=p_user_id for update;
  select * into e from private.subscription_enrollments where session_id=p_session_id and user_id=p_user_id;
  if e.session_id is null then raise exception 'ENROLLMENT_NOT_FOUND' using errcode='P0002'; end if;
  perform 1 from public.artists where id=e.artist_id for share;
  perform 1 from public.subscriptions where id=e.subscription_id for update;
  perform 1 from private.checkout_sessions where id=e.session_id for update;
  select * into e from private.subscription_enrollments where session_id=e.session_id for update;
  return e;
end;
$$;
create function private.enrollment_require_binding(p_enrollment private.subscription_enrollments,p_nonce_hash text,p_auth_session_hash text)
returns void language plpgsql security definer set search_path='' as $$
begin
  if p_auth_session_hash is null or p_auth_session_hash !~ '^[a-f0-9]{64}$'
    or p_auth_session_hash<>p_enrollment.auth_session_hash
    or p_nonce_hash is null or p_nonce_hash !~ '^[a-f0-9]{64}$'
    or not exists(select 1 from private.checkout_sessions c where c.id=p_enrollment.session_id and c.nonce_hash=p_nonce_hash) then
    raise exception 'ENROLLMENT_BINDING_INVALID' using errcode='42501'; end if;
end;
$$;
create function private.enrollment_require_current(p_enrollment private.subscription_enrollments) returns private.checkout_sessions
language plpgsql security definer set search_path='' as $$
declare c private.checkout_sessions%rowtype; p private.checkout_policies%rowtype; s public.subscriptions%rowtype;
begin
  perform private.checkout_require_actor(p_enrollment.user_id);
  p:=private.checkout_current_policy();
  select * into strict c from private.checkout_sessions where id=p_enrollment.session_id;
  if c.status<>'pending_intent' then raise exception 'CHECKOUT_SESSION_REPLAY' using errcode='55000'; end if;
  if c.expires_at<=clock_timestamp() then raise exception 'CHECKOUT_SESSION_EXPIRED' using errcode='55000'; end if;
  if c.policy_version<>p.version then raise exception 'CHECKOUT_POLICY_CHANGED' using errcode='55000'; end if;
  if not exists(select 1 from public.artists where id=c.artist_id and status='active') then
    raise exception 'CHECKOUT_NOT_FOUND' using errcode='P0002'; end if;
  select * into strict s from public.subscriptions where id=p_enrollment.subscription_id;
  if s.status<>'pending' or s.canceled_at is not null or s.provider<>c.provider
    or (s.intro_redeemed_at is null)<>c.intro_eligible then
    raise exception 'CHECKOUT_SUBSCRIPTION_EXISTS' using errcode='55000'; end if;
  return c;
end;
$$;

create function public.enrollment_start(p_user_id uuid,p_session_id uuid,p_nonce_hash text,
  p_auth_session_hash text,p_callback_state_hash text,p_merchant_account text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c private.checkout_sessions%rowtype; e private.subscription_enrollments%rowtype;
  p private.checkout_policies%rowtype; s public.subscriptions%rowtype; sid uuid; mid uuid:=gen_random_uuid(); ref uuid:=gen_random_uuid();
begin
  perform private.require_billing_service();
  if p_user_id is null or p_session_id is null or p_auth_session_hash is null
    or p_auth_session_hash !~ '^[a-f0-9]{64}$' or p_callback_state_hash is null
    or p_callback_state_hash !~ '^[a-f0-9]{64}$' or p_nonce_hash is null or p_nonce_hash !~ '^[a-f0-9]{64}$'
    or p_merchant_account is null or length(p_merchant_account) not between 1 and 100
    or p_merchant_account ~ '[[:cntrl:][:space:]]' then
    raise exception 'ENROLLMENT_INVALID_INPUT' using errcode='22023'; end if;
  perform 1 from public.profiles where id=p_user_id for update;
  perform private.checkout_require_actor(p_user_id);
  p:=private.checkout_current_policy();
  select * into c from private.checkout_sessions where id=p_session_id and user_id=p_user_id;
  if c.id is null then raise exception 'CHECKOUT_NOT_FOUND' using errcode='P0002'; end if;
  perform 1 from public.artists where id=c.artist_id and status='active' for share;
  if not found then raise exception 'CHECKOUT_NOT_FOUND' using errcode='P0002'; end if;
  select * into s from public.subscriptions where user_id=p_user_id and artist_id=c.artist_id for update;
  select * into c from private.checkout_sessions where id=p_session_id and user_id=p_user_id for update;
  if c.nonce_hash<>p_nonce_hash then raise exception 'CHECKOUT_NONCE_INVALID' using errcode='42501'; end if;
  if c.policy_version<>p.version then raise exception 'CHECKOUT_POLICY_CHANGED' using errcode='55000'; end if;
  select * into e from private.subscription_enrollments where session_id=c.id for update;
  if e.session_id is not null then
    perform private.enrollment_require_binding(e,p_nonce_hash,p_auth_session_hash);
    if e.callback_state_hash<>p_callback_state_hash or not exists(select 1 from private.payment_mandates
      where id=e.mandate_id and merchant_account=p_merchant_account) then
      raise exception 'ENROLLMENT_BINDING_INVALID' using errcode='42501'; end if;
    return private.enrollment_projection(e.session_id);
  end if;
  if c.status<>'pending_intent' then raise exception 'CHECKOUT_SESSION_REPLAY' using errcode='55000'; end if;
  if c.expires_at<=clock_timestamp() then raise exception 'CHECKOUT_SESSION_EXPIRED' using errcode='55000'; end if;
  -- Zero-price registration is not a positive initial charge and is outside
  -- this paid-enrollment flow. No ledger amount is fabricated to work around it.
  if c.initial_price_krw<=0 then raise exception 'CHECKOUT_SETUP_NOT_READY' using errcode='55000'; end if;
  if s.id is not null and (s.status not in ('expired','canceled') or s.current_period_end>clock_timestamp()
    or exists(select 1 from private.billing_obligations where subscription_id=s.id and state='open')
    or exists(select 1 from private.subscription_enrollments where subscription_id=s.id and state not in ('succeeded','failed','canceled'))) then
    raise exception 'CHECKOUT_SUBSCRIPTION_EXISTS' using errcode='55000'; end if;
  if (s.intro_redeemed_at is null)<>c.intro_eligible then
    raise exception 'CHECKOUT_POLICY_CHANGED' using errcode='55000'; end if;
  sid:=public.billing_open_subscription(p_user_id,c.artist_id,c.provider);
  -- Pending registration reference only. A mandate becomes usable only at the
  -- separately consented first-payment claim; no credential exists at start.
  insert into private.payment_mandates(id,subscription_id,provider,environment,merchant_account,
    provider_customer_ref,secure_credential_ref,consent_version,is_active)
    values(mid,sid,c.provider,c.environment,p_merchant_account,c.customer_ref,ref,c.policy_version::text,false);
  insert into private.subscription_enrollments(session_id,user_id,artist_id,subscription_id,mandate_id,credential_ref,
    auth_session_hash,callback_state_hash,state)
    values(c.id,p_user_id,c.artist_id,sid,mid,ref,p_auth_session_hash,p_callback_state_hash,
      case when c.provider='toss' then 'awaiting_authorization' else 'ready' end);
  return private.enrollment_projection(c.id);
end;
$$;

create function public.enrollment_read(p_user_id uuid,p_session_id uuid,p_auth_session_hash text,p_nonce_hash text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  perform private.require_billing_service();
  if not exists(select 1 from private.subscription_enrollments where session_id=p_session_id and user_id=p_user_id
    and auth_session_hash=p_auth_session_hash and p_auth_session_hash ~ '^[a-f0-9]{64}$'
    and (p_nonce_hash is null or exists(select 1 from private.checkout_sessions c where c.id=p_session_id
      and c.nonce_hash=p_nonce_hash and p_nonce_hash ~ '^[a-f0-9]{64}$'))) then
    raise exception 'ENROLLMENT_NOT_FOUND' using errcode='P0002'; end if;
  -- Owner/session-bound recovery must stay visible after a policy rotation or
  -- restriction. It grants no fresh dispatch; claim revalidates every gate.
  return private.enrollment_projection(p_session_id);
end;
$$;

create function public.enrollment_capture(p_user_id uuid,p_session_id uuid,p_nonce_hash text,
  p_auth_session_hash text,p_callback_state_hash text,p_callback_ciphertext jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare e private.subscription_enrollments%rowtype; c private.checkout_sessions%rowtype;
begin
  perform private.require_billing_service();
  e:=private.enrollment_lock(p_user_id,p_session_id);
  perform private.enrollment_require_binding(e,p_nonce_hash,p_auth_session_hash);
  if p_callback_state_hash is null or p_callback_state_hash<>e.callback_state_hash then
    raise exception 'ENROLLMENT_BINDING_INVALID' using errcode='42501'; end if;
  c:=private.enrollment_require_current(e);
  if not private.enrollment_ciphertext_valid(p_callback_ciphertext) then
    raise exception 'ENROLLMENT_INVALID_INPUT' using errcode='22023'; end if;
  -- GET callbacks may capture encrypted authorization, never exchange/approve
  -- or charge. Repeated callbacks cannot replace the first authorization.
  if e.state in ('awaiting_confirmation','processing','unknown','manual_review','succeeded') then
    return private.enrollment_projection(e.session_id); end if;
  if e.state<>'awaiting_authorization' or (c.provider='kakaopay' and e.provider_tid is null) then
    raise exception 'CHECKOUT_SESSION_REPLAY' using errcode='55000'; end if;
  update private.subscription_enrollments set state='awaiting_confirmation',callback_ciphertext=p_callback_ciphertext,
    callback_expires_at=least(c.expires_at,clock_timestamp()+interval '5 minutes'),ready_ciphertext=null where session_id=e.session_id;
  return private.enrollment_projection(e.session_id);
end;
$$;

create function public.enrollment_claim(p_user_id uuid,p_session_id uuid,p_nonce_hash text,p_auth_session_hash text,
  p_stage text,p_accepted boolean,p_policy_version uuid,p_amount_krw integer,
  p_period_start timestamptz,p_period_end timestamptz) returns jsonb
language plpgsql security definer set search_path='' set timezone='UTC' as $$
declare e private.subscription_enrollments%rowtype; c private.checkout_sessions%rowtype;
  obligation uuid; descriptor jsonb; lease uuid; at_time timestamptz;
begin
  perform private.require_billing_service();
  if p_stage is null or p_stage not in ('ready','exchange','charge','approve') then
    raise exception 'ENROLLMENT_INVALID_INPUT' using errcode='22023'; end if;
  e:=private.enrollment_lock(p_user_id,p_session_id);
  perform private.enrollment_require_binding(e,p_nonce_hash,p_auth_session_hash);
  at_time:=clock_timestamp();
  if e.state='processing' and e.lease_expires_at<=at_time then
    if e.attempt_id is not null then perform public.billing_record_attempt_outcome(e.attempt_id,e.lease_token,'unknown',null); end if;
    update private.subscription_enrollments set state=case when e.stage in ('ready','exchange') then 'manual_review' else 'unknown' end
      where session_id=e.session_id;
    return private.enrollment_projection(e.session_id)||jsonb_build_object('dispatch',false);
  end if;
  if e.state in ('processing','unknown','manual_review','succeeded','failed','canceled') then
    return private.enrollment_projection(e.session_id)||jsonb_build_object('dispatch',false); end if;
  c:=private.enrollment_require_current(e);
  -- Policy/eligibility locks above can wait. Expiry and lease clocks must be
  -- sampled after those waits, never from the start of this RPC.
  at_time:=clock_timestamp();
  if p_stage='exchange' and exists(select 1 from private.enrollment_credentials where id=e.credential_ref) then
    return private.enrollment_projection(e.session_id)||jsonb_build_object('dispatch',false); end if;
  if (p_stage='ready' and (c.provider<>'kakaopay' or e.state<>'ready'))
    or (p_stage='exchange' and (c.provider<>'toss' or e.state<>'awaiting_confirmation'))
    or (p_stage='charge' and (c.provider<>'toss' or e.state<>'awaiting_confirmation'))
    or (p_stage='approve' and (c.provider<>'kakaopay' or e.state<>'awaiting_confirmation')) then
    raise exception 'CHECKOUT_SESSION_REPLAY' using errcode='55000'; end if;
  if p_stage in ('exchange','approve') and (e.callback_ciphertext is null or e.callback_expires_at<=at_time) then
    raise exception 'ENROLLMENT_AUTHORIZATION_EXPIRED' using errcode='55000'; end if;
  if p_stage='approve' and e.provider_tid is null then
    raise exception 'ENROLLMENT_NOT_READY' using errcode='55000'; end if;
  if p_stage='charge' and not exists(select 1 from private.enrollment_credentials where id=e.credential_ref and mandate_id=e.mandate_id) then
    raise exception 'ENROLLMENT_NOT_READY' using errcode='55000'; end if;
  if p_stage in ('charge','approve') then
    if p_accepted is distinct from true then raise exception 'CHECKOUT_CONSENT_REQUIRED' using errcode='22023'; end if;
    if p_policy_version is distinct from c.policy_version or p_amount_krw is distinct from c.initial_price_krw then
      raise exception 'CHECKOUT_POLICY_CHANGED' using errcode='55000'; end if;
    if p_period_start is null or p_period_end is null or not isfinite(p_period_start) or not isfinite(p_period_end)
      or p_period_start>at_time or p_period_start<e.created_at-interval '1 second'
      or p_period_start<at_time-interval '2 minutes'
      or p_period_end<>(p_period_start+interval '1 month') then
      raise exception 'ENROLLMENT_INVALID_PERIOD' using errcode='22023'; end if;
    update private.payment_mandates set is_active=true where id=e.mandate_id;
    -- Initial-only operation: no automatic retry/grace schedule is enabled.
    obligation:=public.billing_prepare_obligation(e.subscription_id,p_period_start,p_period_end,c.initial_price_krw,
      c.intro_eligible,c.policy_version::text,0,1,0);
    -- The provider order used at Kakao ready must be the same stable attempt
    -- identity, not a fresh UUID allocated after authorization.
    insert into private.payment_attempts(id,obligation_id,ordinal) values(c.order_id,obligation,1);
    descriptor:=public.billing_claim_attempt(c.order_id,120);
    if descriptor is null then raise exception 'ENROLLMENT_NOT_READY' using errcode='55000'; end if;
    lease:=(descriptor->>'lease_token')::uuid;
    update private.subscription_enrollments set obligation_id=obligation,attempt_id=c.order_id,charge_consented_at=at_time
      where session_id=e.session_id;
  else lease:=gen_random_uuid(); end if;
  update private.subscription_enrollments set state='processing',stage=p_stage,lease_token=lease,
    lease_expires_at=at_time+interval '120 seconds' where session_id=e.session_id;
  return private.enrollment_projection(e.session_id)||jsonb_build_object('dispatch',true,'lease_token',lease);
end;
$$;

create function public.enrollment_record_ready(p_user_id uuid,p_session_id uuid,p_lease_token uuid,p_tid text,p_redirects jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare e private.subscription_enrollments%rowtype;
begin
  perform private.require_billing_service(); e:=private.enrollment_lock(p_user_id,p_session_id);
  if p_tid is null or length(p_tid) not between 1 and 100 or p_tid !~ '^[A-Za-z0-9_-]+$'
    or not private.enrollment_ciphertext_valid(p_redirects) then
    raise exception 'ENROLLMENT_INVALID_INPUT' using errcode='22023'; end if;
  if e.state<>'processing' or e.stage<>'ready' or e.lease_token is distinct from p_lease_token then
    raise exception 'ENROLLMENT_OUTCOME_CONFLICT' using errcode='55000'; end if;
  update private.subscription_enrollments set state='awaiting_authorization',provider_tid=p_tid,ready_ciphertext=p_redirects,
    lease_token=null,lease_expires_at=null where session_id=e.session_id;
  return private.enrollment_projection(e.session_id);
end;
$$;

create function public.enrollment_record_credential(p_user_id uuid,p_session_id uuid,p_lease_token uuid,p_credential_ciphertext jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare e private.subscription_enrollments%rowtype;
begin
  perform private.require_billing_service(); e:=private.enrollment_lock(p_user_id,p_session_id);
  if not private.enrollment_ciphertext_valid(p_credential_ciphertext) then
    raise exception 'ENROLLMENT_INVALID_INPUT' using errcode='22023'; end if;
  if e.state<>'processing' or e.stage<>'exchange' or e.lease_token is distinct from p_lease_token then
    raise exception 'ENROLLMENT_OUTCOME_CONFLICT' using errcode='55000'; end if;
  insert into private.enrollment_credentials(id,mandate_id,ciphertext) values(e.credential_ref,e.mandate_id,p_credential_ciphertext);
  update private.subscription_enrollments set state='awaiting_confirmation',callback_ciphertext=null,callback_expires_at=null,
    lease_token=null,lease_expires_at=null where session_id=e.session_id;
  return private.enrollment_projection(e.session_id);
end;
$$;

create function public.enrollment_record_outcome(p_user_id uuid,p_session_id uuid,p_lease_token uuid,p_outcome text,p_evidence_ref uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare e private.subscription_enrollments%rowtype;
begin
  perform private.require_billing_service(); e:=private.enrollment_lock(p_user_id,p_session_id);
  if p_outcome is null or p_outcome not in ('failed','unknown') or (p_outcome='failed' and p_evidence_ref is null) then
    raise exception 'ENROLLMENT_INVALID_INPUT' using errcode='22023'; end if;
  if e.state<>'processing' or e.lease_token is distinct from p_lease_token then
    raise exception 'ENROLLMENT_OUTCOME_CONFLICT' using errcode='55000'; end if;
  if e.attempt_id is not null then perform public.billing_record_attempt_outcome(e.attempt_id,e.lease_token,p_outcome,p_evidence_ref); end if;
  update private.subscription_enrollments set state=case when p_outcome='failed' then 'failed'
      when e.stage in ('ready','exchange') then 'manual_review' else 'unknown' end,
    callback_ciphertext=null,callback_expires_at=null,ready_ciphertext=null,
    finished_at=case when p_outcome='failed' then clock_timestamp() end where session_id=e.session_id;
  if p_outcome='failed' then
    perform public.cancel_subscription(e.subscription_id);
    update private.payment_mandates set is_active=false where id=e.mandate_id;
    update private.checkout_sessions set status='canceled',canceled_at=clock_timestamp() where id=e.session_id;
  end if;
  return private.enrollment_projection(e.session_id);
end;
$$;

create function public.enrollment_finalize(p_user_id uuid,p_session_id uuid,p_provider_action_id text,p_provider_payment_id text,
  p_amount_krw integer,p_currency text,p_approved_at timestamptz,p_evidence_ref uuid,p_credential_ciphertext jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare e private.subscription_enrollments%rowtype; c private.checkout_sessions%rowtype; event uuid;
begin
  perform private.require_billing_service(); e:=private.enrollment_lock(p_user_id,p_session_id);
  select * into strict c from private.checkout_sessions where id=e.session_id;
  if p_provider_payment_id is null or length(p_provider_payment_id) not between 1 and 200
    or p_provider_payment_id ~ '[[:cntrl:][:space:]]' or p_provider_action_id is null
    or length(p_provider_action_id) not between 1 and 200 or p_provider_action_id ~ '[[:cntrl:][:space:]]'
    or p_evidence_ref is null then raise exception 'ENROLLMENT_INVALID_INPUT' using errcode='22023'; end if;
  if e.attempt_id is null or e.stage not in ('charge','approve') or e.state not in ('processing','unknown','manual_review','succeeded') then
    raise exception 'ENROLLMENT_OUTCOME_CONFLICT' using errcode='55000'; end if;
  if e.provider_payment_id is not null and e.provider_payment_id<>p_provider_payment_id then
    raise exception 'ENROLLMENT_OUTCOME_CONFLICT' using errcode='55000'; end if;
  if c.provider='kakaopay' and e.provider_tid is distinct from p_provider_payment_id then
    raise exception 'ENROLLMENT_OUTCOME_CONFLICT' using errcode='55000'; end if;
  if not exists(select 1 from private.enrollment_credentials where id=e.credential_ref and mandate_id=e.mandate_id) then
    if c.provider<>'kakaopay' or not private.enrollment_ciphertext_valid(p_credential_ciphertext) then
      raise exception 'ENROLLMENT_CREDENTIAL_REQUIRED' using errcode='55000'; end if;
    insert into private.enrollment_credentials(id,mandate_id,ciphertext) values(e.credential_ref,e.mandate_id,p_credential_ciphertext);
  end if;
  -- Existing verified-charge RPC atomically inserts immutable ledger + evidence,
  -- activates exactly one paid period and fires the notification outbox trigger.
  -- No actor/policy revalidation after dispatch: verified money must be recorded
  -- even if a policy rotates, user is restricted or session expires meanwhile.
  event:=public.billing_finalize_charge(e.attempt_id,p_provider_action_id,p_amount_krw,p_currency,p_approved_at,p_evidence_ref);
  update private.subscription_enrollments set state='succeeded',payment_event_id=event,provider_payment_id=p_provider_payment_id,
    callback_ciphertext=null,callback_expires_at=null,ready_ciphertext=null,finished_at=clock_timestamp() where session_id=e.session_id;
  return private.enrollment_projection(e.session_id);
end;
$$;

create function public.enrollment_record_reconciliation(p_user_id uuid,p_session_id uuid,p_provider_action_id text,
  p_provider_payment_id text,p_amount_krw integer,p_currency text,p_approved_at timestamptz,p_evidence_ref uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare e private.subscription_enrollments%rowtype; c private.checkout_sessions%rowtype;
  r private.enrollment_reconciliations%rowtype; a private.payment_attempts%rowtype;
begin
  perform private.require_billing_service(); e:=private.enrollment_lock(p_user_id,p_session_id);
  select * into strict c from private.checkout_sessions where id=e.session_id;
  select * into a from private.payment_attempts where id=e.attempt_id for update;
  if c.provider<>'kakaopay' or e.stage<>'approve' or e.state not in ('processing','unknown','manual_review')
    or e.provider_tid is distinct from p_provider_payment_id or a.id is null
    or p_provider_action_id is null or length(p_provider_action_id) not between 1 and 200
    or p_provider_action_id ~ '[[:cntrl:][:space:]]' or p_evidence_ref is null
    or p_amount_krw is distinct from c.initial_price_krw or p_currency is distinct from 'KRW'
    or p_approved_at is null or not isfinite(p_approved_at) or p_approved_at>clock_timestamp()
    or p_approved_at<date_trunc('second',a.created_at) then
    raise exception 'ENROLLMENT_OUTCOME_CONFLICT' using errcode='55000'; end if;
  select * into r from private.enrollment_reconciliations where session_id=e.session_id;
  if r.session_id is not null then
    if r.provider_action_id<>p_provider_action_id or r.provider_payment_id<>p_provider_payment_id
      or r.amount_krw<>p_amount_krw or r.currency<>p_currency or r.approved_at<>p_approved_at then
      raise exception 'ENROLLMENT_OUTCOME_CONFLICT' using errcode='55000'; end if;
  else
    insert into private.enrollment_reconciliations(session_id,provider_action_id,provider_payment_id,amount_krw,currency,
      approved_at,evidence_ref,reason) values(e.session_id,p_provider_action_id,p_provider_payment_id,p_amount_krw,p_currency,
      p_approved_at,p_evidence_ref,'credential_missing');
  end if;
  if a.state='inflight' then perform public.billing_record_attempt_outcome(a.id,e.lease_token,'unknown',null); end if;
  update private.subscription_enrollments set state='manual_review',provider_payment_id=p_provider_payment_id,
    callback_ciphertext=null,callback_expires_at=null,ready_ciphertext=null where session_id=e.session_id;
  return private.enrollment_projection(e.session_id);
end;
$$;

create function public.enrollment_cancel(p_user_id uuid,p_session_id uuid,p_nonce_hash text,p_auth_session_hash text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare e private.subscription_enrollments%rowtype;
begin
  perform private.require_billing_service(); e:=private.enrollment_lock(p_user_id,p_session_id);
  perform private.enrollment_require_binding(e,p_nonce_hash,p_auth_session_hash);
  if e.state='canceled' then return private.enrollment_projection(e.session_id); end if;
  if e.state not in ('ready','awaiting_authorization','awaiting_confirmation') then
    raise exception 'ENROLLMENT_CANNOT_CANCEL' using errcode='55000'; end if;
  update private.subscription_enrollments set state='canceled',callback_ciphertext=null,callback_expires_at=null,
    ready_ciphertext=null,finished_at=clock_timestamp() where session_id=e.session_id;
  perform public.cancel_subscription(e.subscription_id);
  update private.payment_mandates set is_active=false where id=e.mandate_id;
  update private.checkout_sessions set status='canceled',canceled_at=clock_timestamp() where id=e.session_id;
  return private.enrollment_projection(e.session_id);
end;
$$;

-- Explicit fresh preparation may safely abandon an expired, never-charged
-- registration after the original nonce/login session is gone. This does not
-- resume authorization, obtain provider credentials or clear uncertain money.
create function public.enrollment_abandon_expired(p_user_id uuid,p_artist_slug text) returns boolean
language plpgsql security definer set search_path='' as $$
declare e private.subscription_enrollments%rowtype; c private.checkout_sessions%rowtype;
  artist uuid; subscription public.subscriptions%rowtype;
begin
  perform private.require_billing_service();
  if p_user_id is null or p_artist_slug is null or length(p_artist_slug)>128
    or p_artist_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
    raise exception 'ENROLLMENT_INVALID_INPUT' using errcode='22023'; end if;
  perform 1 from public.profiles where id=p_user_id for update;
  perform private.checkout_require_actor(p_user_id);
  select id into artist from public.artists where slug=p_artist_slug for share;
  if artist is null then return false; end if;
  select * into subscription from public.subscriptions where user_id=p_user_id and artist_id=artist for update;
  if subscription.id is null or subscription.status<>'pending' then return false; end if;
  select * into e from private.subscription_enrollments where subscription_id=subscription.id
    and state not in ('succeeded','failed','canceled');
  if e.session_id is null then return false; end if;
  e:=private.enrollment_lock(p_user_id,e.session_id);
  select * into strict c from private.checkout_sessions where id=e.session_id;
  if e.state not in ('ready','awaiting_authorization','awaiting_confirmation') or e.attempt_id is not null then return false; end if;
  if c.expires_at>clock_timestamp() and not (e.state='awaiting_confirmation' and e.callback_expires_at<=clock_timestamp()
    and not exists(select 1 from private.enrollment_credentials where id=e.credential_ref)) then return false; end if;
  update private.subscription_enrollments set state='canceled',callback_ciphertext=null,callback_expires_at=null,
    ready_ciphertext=null,finished_at=clock_timestamp() where session_id=e.session_id;
  perform public.cancel_subscription(e.subscription_id);
  update private.payment_mandates set is_active=false where id=e.mandate_id;
  update private.checkout_sessions set status='canceled',canceled_at=clock_timestamp() where id=e.session_id;
  return true;
end;
$$;

-- The older preparation-only cancellation RPC cannot erase a launched or
-- uncertain operation. The enrollment RPC marks its own terminal state first.
create function private.enrollment_checkout_guard() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.status is distinct from old.status and exists(select 1 from private.subscription_enrollments e
    where e.session_id=old.id and e.state not in ('failed','canceled')
      and not (e.state='succeeded' and new.status='expired' and old.expires_at<=clock_timestamp())) then
    raise exception 'ENROLLMENT_CANNOT_CANCEL' using errcode='55000'; end if;
  return new;
end;
$$;
create trigger enrollment_checkout_guard before update of status on private.checkout_sessions
  for each row execute function private.enrollment_checkout_guard();

revoke all on function private.enrollment_ciphertext_valid(jsonb),private.enrollment_projection(uuid),
  private.enrollment_lock(uuid,uuid),private.enrollment_require_binding(private.subscription_enrollments,text,text),
  private.enrollment_require_current(private.subscription_enrollments),private.enrollment_checkout_guard()
  from public,anon,authenticated,service_role;
revoke all on function public.enrollment_start(uuid,uuid,text,text,text,text),public.enrollment_read(uuid,uuid,text,text),
  public.enrollment_capture(uuid,uuid,text,text,text,jsonb),
  public.enrollment_claim(uuid,uuid,text,text,text,boolean,uuid,integer,timestamptz,timestamptz),
  public.enrollment_record_ready(uuid,uuid,uuid,text,jsonb),public.enrollment_record_credential(uuid,uuid,uuid,jsonb),
  public.enrollment_record_outcome(uuid,uuid,uuid,text,uuid),
  public.enrollment_finalize(uuid,uuid,text,text,integer,text,timestamptz,uuid,jsonb),
  public.enrollment_record_reconciliation(uuid,uuid,text,text,integer,text,timestamptz,uuid),
  public.enrollment_cancel(uuid,uuid,text,text),public.enrollment_abandon_expired(uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.enrollment_start(uuid,uuid,text,text,text,text),public.enrollment_read(uuid,uuid,text,text),
  public.enrollment_capture(uuid,uuid,text,text,text,jsonb),
  public.enrollment_claim(uuid,uuid,text,text,text,boolean,uuid,integer,timestamptz,timestamptz),
  public.enrollment_record_ready(uuid,uuid,uuid,text,jsonb),public.enrollment_record_credential(uuid,uuid,uuid,jsonb),
  public.enrollment_record_outcome(uuid,uuid,uuid,text,uuid),
  public.enrollment_finalize(uuid,uuid,text,text,integer,text,timestamptz,uuid,jsonb),
  public.enrollment_record_reconciliation(uuid,uuid,text,text,integer,text,timestamptz,uuid),
  public.enrollment_cancel(uuid,uuid,text,text),public.enrollment_abandon_expired(uuid,text) to service_role;
commit;
