-- Billing database primitives only. No provider calls, secrets or live defaults.
begin;

create type public.payment_provider as enum ('toss', 'kakaopay');
create type public.subscription_status as enum ('pending', 'active', 'grace', 'canceled', 'expired');
create type public.payment_event_kind as enum ('charge', 'refund');
create type private.payment_environment as enum ('test', 'live');
create type private.payment_attempt_state as enum ('created', 'inflight', 'success', 'failed', 'unknown');

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  -- Financial retention: account/artist deletion must not erase identity/history.
  user_id uuid not null references public.profiles(id) on delete restrict,
  artist_id uuid not null references public.artists(id) on delete restrict,
  provider public.payment_provider not null,
  status public.subscription_status not null default 'pending',
  intro_redeemed_at timestamptz,
  first_started_at timestamptz,
  episode_started_at timestamptz,
  current_period_start timestamptz,
  current_period_end timestamptz,
  grace_started_at timestamptz,
  grace_ends_at timestamptz,
  next_billing_at timestamptz,
  canceled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, artist_id),
  check ((current_period_start is null and current_period_end is null) or
    (current_period_start is not null and current_period_end is not null and current_period_end > current_period_start
      and isfinite(current_period_start) and isfinite(current_period_end))),
  check ((grace_started_at is null and grace_ends_at is null) or
    (grace_started_at is not null and grace_ends_at is not null and grace_ends_at >= grace_started_at
      and isfinite(grace_started_at) and isfinite(grace_ends_at))),
  check (status <> 'grace' or grace_ends_at is not null),
  check (status not in ('active', 'grace') or current_period_end is not null),
  check (status not in ('canceled', 'expired') or next_billing_at is null),
  check (status <> 'canceled' or canceled_at is not null)
);
create index subscriptions_due_idx on public.subscriptions(next_billing_at)
  where status in ('active', 'grace');
create index subscriptions_artist_idx on public.subscriptions(artist_id, status);
create trigger subscriptions_updated_at before update on public.subscriptions
  for each row execute function private.touch_updated_at();

-- UUID is a handle into a future secure credential store, NOT a billing key/SID,
-- ciphertext or customer key. No credential encryption/resolution is implemented.
create table private.payment_mandates (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.subscriptions(id),
  provider public.payment_provider not null,
  environment private.payment_environment not null,
  merchant_account text not null check (merchant_account = btrim(merchant_account) and merchant_account <> ''),
  provider_customer_ref uuid not null,
  secure_credential_ref uuid not null unique,
  consent_version text not null check (consent_version = btrim(consent_version) and consent_version <> ''),
  consented_at timestamptz not null default now(),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index payment_mandates_one_active on private.payment_mandates(subscription_id) where is_active;

create table private.billing_obligations (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.subscriptions(id),
  mandate_id uuid not null references private.payment_mandates(id),
  period_start timestamptz not null check (isfinite(period_start)),
  period_end timestamptz not null check (isfinite(period_end) and period_end > period_start),
  amount_krw integer not null check (amount_krw > 0),
  currency text not null default 'KRW' check (currency = 'KRW'),
  is_initial boolean not null,
  is_intro boolean not null,
  price_version text not null check (price_version = btrim(price_version) and price_version <> ''),
  grace_seconds integer not null check (grace_seconds >= 0),
  retry_seconds integer not null check (retry_seconds > 0),
  max_retries integer not null check (max_retries >= 0),
  state text not null default 'open' check (state in ('open', 'settled', 'void')),
  next_attempt_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (subscription_id, period_start),
  check (not is_intro or is_initial)
);
create unique index billing_obligations_one_open on private.billing_obligations(subscription_id) where state = 'open';

create table private.payment_attempts (
  -- Stable order/idempotency identity: persisted before any external operation.
  id uuid primary key default gen_random_uuid(),
  obligation_id uuid not null references private.billing_obligations(id),
  ordinal integer not null check (ordinal > 0),
  state private.payment_attempt_state not null default 'created',
  lease_token uuid,
  lease_expires_at timestamptz,
  outcome_evidence_ref uuid,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (obligation_id, ordinal),
  check (state <> 'inflight' or (lease_token is not null and lease_expires_at is not null)),
  check (state <> 'failed' or outcome_evidence_ref is not null)
);
create unique index payment_attempts_one_unresolved on private.payment_attempts(obligation_id)
  where state in ('created', 'inflight', 'unknown', 'success');

-- Safe, minimal financial DTO. No provider payload, SID/billing key, customer,
-- merchant identifiers, lease token or credential reference in the public table.
create table public.payment_events (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.subscriptions(id),
  kind public.payment_event_kind not null,
  amount_krw integer not null,
  currency text not null default 'KRW' check (currency = 'KRW'),
  provider public.payment_provider not null,
  original_event_id uuid references public.payment_events(id),
  period_start timestamptz not null check (isfinite(period_start)),
  period_end timestamptz not null check (isfinite(period_end) and period_end > period_start),
  occurred_at timestamptz not null check (isfinite(occurred_at)),
  recorded_at timestamptz not null default now(),
  check ((kind = 'charge' and amount_krw > 0 and original_event_id is null) or
    (kind = 'refund' and amount_krw < 0 and original_event_id is not null))
);
create index payment_events_subscription_idx on public.payment_events(subscription_id, occurred_at);
create index payment_events_original_idx on public.payment_events(original_event_id) where original_event_id is not null;

-- Verified provider action identity (AID / transactionKey, not just payment/TID).
-- A refund has its own action identity and separately references its charge.
create table private.payment_event_verifications (
  event_id uuid primary key references public.payment_events(id),
  attempt_id uuid references private.payment_attempts(id),
  provider public.payment_provider not null,
  environment private.payment_environment not null,
  merchant_account text not null,
  provider_action_id text not null check (provider_action_id = btrim(provider_action_id) and provider_action_id <> ''),
  evidence_ref uuid not null,
  unique (provider, environment, merchant_account, provider_action_id),
  unique (attempt_id)
);

alter table public.subscriptions enable row level security;
alter table public.payment_events enable row level security;
alter table private.payment_mandates enable row level security;
alter table private.billing_obligations enable row level security;
alter table private.payment_attempts enable row level security;
alter table private.payment_event_verifications enable row level security;
revoke all on public.subscriptions, public.payment_events,
  private.payment_mandates, private.billing_obligations, private.payment_attempts,
  private.payment_event_verifications from public, anon, authenticated, service_role;
grant select on public.subscriptions, public.payment_events to authenticated, service_role;
grant select on private.payment_mandates, private.billing_obligations,
  private.payment_attempts, private.payment_event_verifications to service_role;

create policy subscriptions_read_own_or_admin on public.subscriptions for select to authenticated
  using (user_id = (select auth.uid()) or (select private.current_user_role()) = 'admin');
create policy payment_events_read_own_or_admin on public.payment_events for select to authenticated
  using (exists (select 1 from public.subscriptions s where s.id = subscription_id
    and (s.user_id = (select auth.uid()) or (select private.current_user_role()) = 'admin')));

create function private.require_billing_service() returns void
language plpgsql set search_path = '' as $$
begin
  -- current_user is the function owner inside SECURITY DEFINER, not the caller.
  -- The actual SET ROLE is checked, never editable JWT metadata or a profile role.
  if current_setting('role', true) is distinct from 'service_role' then
    raise exception 'BILLING_SERVICE_REQUIRED' using errcode = '42501';
  end if;
end;
$$;

create function private.reject_ledger_mutation() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'IMMUTABLE_PAYMENT_LEDGER' using errcode = '55000';
end;
$$;
create trigger payment_events_immutable before update or delete on public.payment_events
  for each row execute function private.reject_ledger_mutation();
create trigger payment_events_no_truncate before truncate on public.payment_events
  for each statement execute function private.reject_ledger_mutation();
create trigger payment_verifications_immutable before update or delete on private.payment_event_verifications
  for each row execute function private.reject_ledger_mutation();
create trigger payment_verifications_no_truncate before truncate on private.payment_event_verifications
  for each statement execute function private.reject_ledger_mutation();

create function public.billing_open_subscription(p_user_id uuid, p_artist_id uuid, p_provider public.payment_provider)
returns uuid language plpgsql security definer set search_path = '' as $$
declare s public.subscriptions%rowtype;
begin
  perform private.require_billing_service();
  if p_user_id is null or p_artist_id is null or p_provider is null then
    raise exception 'REQUIRED_INPUT' using errcode = '22004';
  end if;
  -- Enrollment authorization serializes with profile restriction/artist pause.
  -- Enrollment lock order: profile -> artist -> subscription. Other billing
  -- paths never acquire those identity rows after locking the subscription.
  perform 1 from public.profiles where id = p_user_id and onboarding_completed_at is not null
    and not (is_restricted and (restricted_until is null or restricted_until > statement_timestamp())) for share;
  if not found then raise exception 'SUBSCRIPTION_NOT_ELIGIBLE' using errcode = '23514'; end if;
  perform 1 from public.artists where id = p_artist_id and status = 'active' for share;
  if not found then raise exception 'SUBSCRIPTION_NOT_ELIGIBLE' using errcode = '23514'; end if;
  insert into public.subscriptions(user_id, artist_id, provider)
    values (p_user_id, p_artist_id, p_provider) on conflict (user_id, artist_id) do nothing;
  select * into strict s from public.subscriptions where user_id = p_user_id and artist_id = p_artist_id for update;
  if s.status = 'pending' and s.provider = p_provider then return s.id; end if;
  if s.status not in ('expired', 'canceled') or s.current_period_end > statement_timestamp() then
    raise exception 'SUBSCRIPTION_EXISTS' using errcode = '55000';
  end if;
  if exists (select 1 from private.billing_obligations where subscription_id = s.id and state = 'open') then
    raise exception 'BILLING_UNRESOLVED' using errcode = '55000';
  end if;
  update private.payment_mandates set is_active = false where subscription_id = s.id;
  update public.subscriptions set status = 'pending', provider = p_provider,
    grace_started_at = null, grace_ends_at = null, next_billing_at = null, canceled_at = null where id = s.id;
  -- Deliberately retain lifetime redemption and last paid/episode history until
  -- a new verified first charge starts the next episode. No resume-before-end API.
  return s.id;
end;
$$;

create function public.billing_register_mandate(
  p_subscription_id uuid, p_environment text, p_merchant_account text,
  p_provider_customer_ref uuid, p_secure_credential_ref uuid, p_consent_version text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare s public.subscriptions%rowtype; m private.payment_mandates%rowtype;
begin
  perform private.require_billing_service();
  if p_environment is null or p_merchant_account is null or p_provider_customer_ref is null
    or p_secure_credential_ref is null or p_consent_version is null then
    raise exception 'REQUIRED_INPUT' using errcode = '22004';
  end if;
  select * into strict s from public.subscriptions where id = p_subscription_id for update;
  if s.status <> 'pending' then raise exception 'MANDATE_REQUIRES_PENDING' using errcode = '55000'; end if;
  select * into m from private.payment_mandates where subscription_id = s.id and is_active;
  if found then
    if m.environment::text <> p_environment or m.merchant_account <> p_merchant_account
      or m.provider_customer_ref <> p_provider_customer_ref or m.secure_credential_ref <> p_secure_credential_ref
      or m.consent_version <> p_consent_version then
      raise exception 'MANDATE_CONFLICT' using errcode = '23514';
    end if;
    return m.id;
  end if;
  insert into private.payment_mandates(subscription_id, provider, environment, merchant_account,
    provider_customer_ref, secure_credential_ref, consent_version)
  values (s.id, s.provider, p_environment::private.payment_environment, p_merchant_account,
    p_provider_customer_ref, p_secure_credential_ref, p_consent_version) returning id into m.id;
  return m.id;
end;
$$;

create function public.billing_prepare_obligation(
  p_subscription_id uuid, p_period_start timestamptz, p_period_end timestamptz,
  p_amount_krw integer, p_is_intro boolean, p_price_version text,
  p_grace_seconds integer, p_retry_seconds integer, p_max_retries integer)
returns uuid language plpgsql security definer set search_path = '' as $$
declare s public.subscriptions%rowtype; o private.billing_obligations%rowtype; m uuid;
begin
  perform private.require_billing_service();
  if p_period_start is null or p_period_end is null or p_amount_krw is null or p_is_intro is null
    or p_price_version is null or p_grace_seconds is null or p_retry_seconds is null or p_max_retries is null then
    raise exception 'REQUIRED_INPUT' using errcode = '22004';
  end if;
  select * into strict s from public.subscriptions where id = p_subscription_id for update;
  select * into o from private.billing_obligations where subscription_id = s.id and period_start = p_period_start;
  if found then
    if o.period_end <> p_period_end or o.amount_krw <> p_amount_krw or o.is_intro <> p_is_intro
      or o.price_version <> p_price_version or o.grace_seconds <> p_grace_seconds
      or o.retry_seconds <> p_retry_seconds or o.max_retries <> p_max_retries then
      raise exception 'OBLIGATION_CONFLICT' using errcode = '23514';
    end if;
    return o.id;
  end if;
  if s.status not in ('pending', 'active') or
    (s.status = 'active' and p_period_start is distinct from s.current_period_end) or
    (s.status = 'pending' and (p_period_start > statement_timestamp() or
      p_period_start < coalesce(s.current_period_end, '-infinity'::timestamptz))) then
    raise exception 'INVALID_BILLING_PERIOD' using errcode = '23514';
  end if;
  if p_is_intro and (s.intro_redeemed_at is not null or s.status <> 'pending') then
    raise exception 'INTRO_ALREADY_REDEEMED' using errcode = '23514';
  end if;
  select id into m from private.payment_mandates where subscription_id = s.id and is_active and provider = s.provider;
  if m is null then raise exception 'MANDATE_REQUIRED' using errcode = '55000'; end if;
  insert into private.billing_obligations(subscription_id, mandate_id, period_start, period_end,
    amount_krw, is_initial, is_intro, price_version, grace_seconds, retry_seconds, max_retries, next_attempt_at)
  values (s.id, m, p_period_start, p_period_end, p_amount_krw, s.status = 'pending', p_is_intro,
    p_price_version, p_grace_seconds, p_retry_seconds, p_max_retries, p_period_start) returning id into o.id;
  return o.id;
end;
$$;

create function public.billing_prepare_attempt(p_obligation_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare s public.subscriptions%rowtype; o private.billing_obligations%rowtype;
  a private.payment_attempts%rowtype; n integer;
begin
  perform private.require_billing_service();
  select s0.* into strict s from public.subscriptions s0 join private.billing_obligations o0
    on o0.subscription_id = s0.id where o0.id = p_obligation_id for update of s0;
  select * into strict o from private.billing_obligations where id = p_obligation_id for update;
  select * into a from private.payment_attempts where obligation_id = o.id order by ordinal desc limit 1 for update;
  -- Returning the same ID is NOT permission to call a provider. Only a successful
  -- one-time claim authorizes dispatch; unknown and expired leases never replay.
  if found and a.state <> 'failed' then
    if a.state = 'inflight' and a.lease_expires_at <= statement_timestamp() then
      update private.payment_attempts set state = 'unknown' where id = a.id;
    end if;
    return a.id;
  end if;
  n := coalesce(a.ordinal, 0) + 1;
  if o.state <> 'open' or s.status not in ('pending', 'active', 'grace') or s.canceled_at is not null then
    raise exception 'BILLING_NOT_OPEN' using errcode = '55000';
  end if;
  if n::bigint > o.max_retries::bigint + 1 or o.next_attempt_at > statement_timestamp()
    or (s.status = 'grace' and s.grace_ends_at <= statement_timestamp()) then
    raise exception 'RETRY_NOT_DUE_OR_EXHAUSTED' using errcode = '55000';
  end if;
  insert into private.payment_attempts(obligation_id, ordinal) values (o.id, n) returning id into a.id;
  return a.id;
end;
$$;

create function public.billing_claim_attempt(p_attempt_id uuid, p_lease_seconds integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s public.subscriptions%rowtype; o private.billing_obligations%rowtype;
  a private.payment_attempts%rowtype; m private.payment_mandates%rowtype; v_now timestamptz;
begin
  perform private.require_billing_service();
  if p_lease_seconds is null or p_lease_seconds <= 0 then
    raise exception 'INVALID_LEASE' using errcode = '22023';
  end if;
  select s0.* into strict s from public.subscriptions s0 join private.billing_obligations o0 on o0.subscription_id = s0.id
    join private.payment_attempts a0 on a0.obligation_id = o0.id where a0.id = p_attempt_id for update of s0;
  select o0.* into strict o from private.billing_obligations o0 join private.payment_attempts a0 on a0.obligation_id = o0.id
    where a0.id = p_attempt_id for update of o0;
  select * into strict a from private.payment_attempts where id = p_attempt_id for update;
  -- Lock waits must not preserve a pre-wait grace deadline or shorten a lease.
  v_now := clock_timestamp();
  if a.state = 'inflight' and a.lease_expires_at <= v_now then
    update private.payment_attempts set state = 'unknown' where id = a.id;
    return null;
  end if;
  if a.state <> 'created' or o.state <> 'open' or s.status not in ('pending', 'active', 'grace')
    or s.canceled_at is not null or o.next_attempt_at > v_now
    or (s.status = 'grace' and s.grace_ends_at <= v_now) then return null; end if;
  select * into strict m from private.payment_mandates where id = o.mandate_id;
  if not m.is_active or m.provider <> s.provider then return null; end if;
  update private.payment_attempts set state = 'inflight', lease_token = gen_random_uuid(),
    lease_expires_at = v_now + make_interval(secs => p_lease_seconds)
    where id = a.id returning * into a;
  return jsonb_build_object('attempt_id', a.id, 'order_id', a.id, 'lease_token', a.lease_token,
    'lease_expires_at', a.lease_expires_at, 'provider', m.provider, 'environment', m.environment,
    'merchant_account', m.merchant_account, 'provider_customer_ref', m.provider_customer_ref,
    'secure_credential_ref', m.secure_credential_ref, 'amount_krw', o.amount_krw, 'currency', o.currency);
end;
$$;

create function public.billing_record_attempt_outcome(
  p_attempt_id uuid, p_lease_token uuid, p_outcome text, p_evidence_ref uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare s public.subscriptions%rowtype; o private.billing_obligations%rowtype; a private.payment_attempts%rowtype; v_now timestamptz;
begin
  perform private.require_billing_service();
  if p_outcome is null or p_outcome not in ('failed', 'unknown') or (p_outcome = 'failed' and p_evidence_ref is null) then
    raise exception 'VERIFIED_OUTCOME_REQUIRED' using errcode = '22023';
  end if;
  select s0.* into strict s from public.subscriptions s0 join private.billing_obligations o0 on o0.subscription_id = s0.id
    join private.payment_attempts a0 on a0.obligation_id = o0.id where a0.id = p_attempt_id for update of s0;
  select o0.* into strict o from private.billing_obligations o0 join private.payment_attempts a0 on a0.obligation_id = o0.id
    where a0.id = p_attempt_id for update of o0;
  select * into strict a from private.payment_attempts where id = p_attempt_id for update;
  v_now := clock_timestamp();
  if a.state::text = p_outcome and a.outcome_evidence_ref is not distinct from p_evidence_ref then return; end if;
  if a.state not in ('inflight', 'unknown') or
    (a.state = 'inflight' and a.lease_token is distinct from p_lease_token) then
    raise exception 'ATTEMPT_OUTCOME_CONFLICT' using errcode = '55000';
  end if;
  update private.payment_attempts set state = p_outcome::private.payment_attempt_state,
    outcome_evidence_ref = p_evidence_ref,
    finished_at = case when p_outcome = 'failed' then v_now end where id = a.id;
  if p_outcome = 'failed' then
    update private.billing_obligations set next_attempt_at = v_now + make_interval(secs => o.retry_seconds),
      state = case when s.canceled_at is not null or s.status = 'expired' then 'void' else state end where id = o.id;
  end if;
  if not o.is_initial and s.status in ('active', 'grace') then
    -- Grace is anchored to the unpaid renewal boundary, never reset by retries.
    update public.subscriptions set status = 'grace', grace_started_at = o.period_start,
      grace_ends_at = o.period_start + make_interval(secs => o.grace_seconds),
      next_billing_at = case when p_outcome = 'failed' and a.ordinal <= o.max_retries
        then v_now + make_interval(secs => o.retry_seconds) else null end where id = s.id;
  end if;
end;
$$;

create function public.billing_finalize_charge(
  p_attempt_id uuid, p_provider_action_id text, p_amount_krw integer,
  p_currency text, p_approved_at timestamptz, p_evidence_ref uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare s public.subscriptions%rowtype; o private.billing_obligations%rowtype;
  a private.payment_attempts%rowtype; m private.payment_mandates%rowtype;
  e public.payment_events%rowtype; v private.payment_event_verifications%rowtype;
begin
  perform private.require_billing_service();
  if p_provider_action_id is null or p_amount_krw is null or p_currency is null
    or p_approved_at is null or p_evidence_ref is null then
    raise exception 'VERIFIED_RESULT_REQUIRED' using errcode = '22004';
  end if;
  select s0.* into strict s from public.subscriptions s0 join private.billing_obligations o0 on o0.subscription_id = s0.id
    join private.payment_attempts a0 on a0.obligation_id = o0.id where a0.id = p_attempt_id for update of s0;
  select o0.* into strict o from private.billing_obligations o0 join private.payment_attempts a0 on a0.obligation_id = o0.id
    where a0.id = p_attempt_id for update of o0;
  select * into strict a from private.payment_attempts where id = p_attempt_id for update;
  select * into strict m from private.payment_mandates where id = o.mandate_id;
  select * into v from private.payment_event_verifications where attempt_id = a.id;
  if found then
    select * into strict e from public.payment_events where id = v.event_id;
    if v.provider_action_id <> p_provider_action_id or e.amount_krw <> p_amount_krw
      or e.currency <> p_currency or e.occurred_at <> p_approved_at then
      raise exception 'VERIFIED_RESULT_CONFLICT' using errcode = '23514';
    end if;
    return e.id;
  end if;
  if a.state not in ('inflight', 'unknown') or o.state <> 'open' then
    raise exception 'ATTEMPT_NOT_FINALIZABLE' using errcode = '55000';
  end if;
  if not isfinite(p_approved_at) or p_amount_krw <> o.amount_krw or p_currency <> o.currency or p_approved_at > statement_timestamp()
    -- Provider approval timestamps may have whole-second precision (Toss).
    -- Preserve their timestamp; do not fabricate microsecond precision.
    or p_approved_at < date_trunc('second', a.created_at) then
    raise exception 'VERIFIED_RESULT_MISMATCH' using errcode = '23514';
  end if;
  insert into public.payment_events(subscription_id, kind, amount_krw, currency, provider, period_start, period_end, occurred_at)
    values (s.id, 'charge', o.amount_krw, o.currency, m.provider, o.period_start, o.period_end, p_approved_at) returning * into e;
  insert into private.payment_event_verifications(event_id, attempt_id, provider, environment, merchant_account, provider_action_id, evidence_ref)
    values (e.id, a.id, m.provider, m.environment, m.merchant_account, p_provider_action_id, p_evidence_ref);
  update private.payment_attempts set state = 'success', finished_at = statement_timestamp(), outcome_evidence_ref = p_evidence_ref where id = a.id;
  update private.billing_obligations set state = 'settled' where id = o.id;
  update public.subscriptions set
    status = case when canceled_at is not null then 'canceled'::public.subscription_status
      when o.period_end <= statement_timestamp() then 'expired'::public.subscription_status else 'active'::public.subscription_status end,
    intro_redeemed_at = coalesce(intro_redeemed_at, p_approved_at),
    first_started_at = coalesce(first_started_at, o.period_start),
    episode_started_at = case when o.is_initial then o.period_start else episode_started_at end,
    current_period_start = o.period_start, current_period_end = o.period_end,
    grace_started_at = null, grace_ends_at = null,
    next_billing_at = case when canceled_at is null and o.period_end > statement_timestamp() then o.period_end end
    where id = s.id;
  return e.id;
end;
$$;

create function public.cancel_subscription(p_subscription_id uuid)
returns public.subscriptions language plpgsql security definer set search_path = '' as $$
declare s public.subscriptions%rowtype;
begin
  select * into s from public.subscriptions where id = p_subscription_id for update;
  if s.id is null or (current_setting('role', true) is distinct from 'service_role' and
    (current_setting('role', true) is distinct from 'authenticated' or s.user_id is distinct from auth.uid())) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if s.status in ('canceled', 'expired') then return s; end if;
  update public.subscriptions set status = 'canceled', canceled_at = clock_timestamp(), next_billing_at = null
    where id = s.id returning * into s;
  update private.billing_obligations o set state = 'void' where o.subscription_id = s.id and o.state = 'open'
    and not exists (select 1 from private.payment_attempts a where a.obligation_id = o.id and a.state in ('inflight', 'unknown'));
  -- An already claimed operation may have reached the provider. Keep it for
  -- reconciliation; a verified late approval adds paid access but never renews.
  return s;
end;
$$;

create function public.billing_expire_subscription(p_subscription_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare s public.subscriptions%rowtype;
begin
  perform private.require_billing_service();
  select * into strict s from public.subscriptions where id = p_subscription_id for update;
  if (s.status = 'grace' and s.grace_ends_at <= statement_timestamp()) or
    (s.status = 'canceled' and coalesce(s.current_period_end, '-infinity'::timestamptz) <= statement_timestamp()) then
    update public.subscriptions set status = 'expired', next_billing_at = null where id = s.id;
    update private.billing_obligations o set state = 'void' where o.subscription_id = s.id and o.state = 'open'
      and not exists (select 1 from private.payment_attempts a where a.obligation_id = o.id and a.state in ('inflight', 'unknown'));
  end if;
end;
$$;

-- RLS enforces own/admin visibility; no caller-supplied user ID oracle. Access
-- ends at an exclusive boundary even if the expiry worker has not run yet.
create function public.has_active_access(p_artist_id uuid)
returns boolean language sql stable security invoker set search_path = '' as $$
  select exists (select 1 from public.subscriptions s where s.user_id = auth.uid() and s.artist_id = p_artist_id
    and ((s.status in ('active', 'canceled') and s.current_period_start <= now() and s.current_period_end > now())
      or (s.status = 'grace' and s.grace_started_at <= now() and s.grace_ends_at > now()))
    and exists (select 1 from public.profiles p where p.id = auth.uid()
      and not (p.is_restricted and (p.restricted_until is null or p.restricted_until > now()))));
$$;

create function public.billing_record_refund(
  p_original_event_id uuid, p_provider_action_id text, p_amount_krw integer,
  p_currency text, p_refunded_at timestamptz, p_evidence_ref uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare original public.payment_events%rowtype; v private.payment_event_verifications%rowtype;
  existing public.payment_events%rowtype; new_id uuid; refunded bigint;
begin
  perform private.require_billing_service();
  if p_provider_action_id is null or p_amount_krw is null or p_currency is null
    or p_refunded_at is null or p_evidence_ref is null then
    raise exception 'VERIFIED_RESULT_REQUIRED' using errcode = '22004';
  end if;
  -- Serialize refunds on the original, including simultaneous partial refunds.
  select * into strict original from public.payment_events where id = p_original_event_id for update;
  if original.kind <> 'charge' then raise exception 'REFUND_REQUIRES_CHARGE' using errcode = '23514'; end if;
  select * into strict v from private.payment_event_verifications where event_id = original.id;
  select e.* into existing from public.payment_events e join private.payment_event_verifications ev on ev.event_id = e.id
    where ev.provider = v.provider and ev.environment = v.environment and ev.merchant_account = v.merchant_account
      and ev.provider_action_id = p_provider_action_id;
  if found then
    if existing.kind <> 'refund' or existing.original_event_id <> original.id or existing.amount_krw::bigint <> -p_amount_krw::bigint
      or existing.currency <> p_currency or existing.occurred_at <> p_refunded_at then
      raise exception 'REFUND_RESULT_CONFLICT' using errcode = '23514';
    end if;
    return existing.id;
  end if;
  if not isfinite(p_refunded_at) or p_amount_krw <= 0 or p_currency <> original.currency or p_refunded_at < original.occurred_at
    or p_refunded_at > statement_timestamp() then
    raise exception 'REFUND_RESULT_MISMATCH' using errcode = '23514';
  end if;
  select coalesce(-sum(amount_krw::bigint), 0) into refunded from public.payment_events where original_event_id = original.id;
  if refunded + p_amount_krw::bigint > original.amount_krw then
    raise exception 'REFUND_EXCEEDS_CHARGE' using errcode = '23514';
  end if;
  insert into public.payment_events(subscription_id, kind, amount_krw, currency, provider, original_event_id,
    period_start, period_end, occurred_at)
  values (original.subscription_id, 'refund', -p_amount_krw, original.currency, original.provider, original.id,
    original.period_start, original.period_end, p_refunded_at) returning id into new_id;
  insert into private.payment_event_verifications(event_id, provider, environment, merchant_account, provider_action_id, evidence_ref)
    values (new_id, v.provider, v.environment, v.merchant_account, p_provider_action_id, p_evidence_ref);
  -- Financial recognition only; entitlement/refund eligibility policy is separate.
  return new_id;
end;
$$;

-- Explicit allowlist, including service_role default grants from hosted setups.
-- New billing functions cannot inherit PUBLIC EXECUTE or client grants.
revoke all on function private.require_billing_service(), private.reject_ledger_mutation()
  from public, anon, authenticated, service_role;
revoke all on function
  public.billing_open_subscription(uuid, uuid, public.payment_provider),
  public.billing_register_mandate(uuid, text, text, uuid, uuid, text),
  public.billing_prepare_obligation(uuid, timestamptz, timestamptz, integer, boolean, text, integer, integer, integer),
  public.billing_prepare_attempt(uuid), public.billing_claim_attempt(uuid, integer),
  public.billing_record_attempt_outcome(uuid, uuid, text, uuid),
  public.billing_finalize_charge(uuid, text, integer, text, timestamptz, uuid),
  public.billing_expire_subscription(uuid),
  public.billing_record_refund(uuid, text, integer, text, timestamptz, uuid),
  public.cancel_subscription(uuid), public.has_active_access(uuid)
  from public, anon, authenticated, service_role;
grant execute on function
  public.billing_open_subscription(uuid, uuid, public.payment_provider),
  public.billing_register_mandate(uuid, text, text, uuid, uuid, text),
  public.billing_prepare_obligation(uuid, timestamptz, timestamptz, integer, boolean, text, integer, integer, integer),
  public.billing_prepare_attempt(uuid), public.billing_claim_attempt(uuid, integer),
  public.billing_record_attempt_outcome(uuid, uuid, text, uuid),
  public.billing_finalize_charge(uuid, text, integer, text, timestamptz, uuid),
  public.billing_expire_subscription(uuid),
  public.billing_record_refund(uuid, text, integer, text, timestamptz, uuid)
  to service_role;
grant execute on function public.cancel_subscription(uuid) to authenticated, service_role;
grant execute on function public.has_active_access(uuid) to authenticated;

comment on table public.payment_events is 'Append-only verified money, integer KRW. Never attempts, assumed success or raw provider payloads.';
comment on table private.payment_mandates is 'Server-only opaque secure-store handles; no credential storage/resolution adapter implemented.';
comment on function public.billing_finalize_charge(uuid, text, integer, text, timestamptz, uuid) is
  'Trusted server only after authenticated provider verification of order/customer/merchant/environment/amount/currency/action. SQL does not verify provider signatures.';
comment on function public.billing_record_refund(uuid, text, integer, text, timestamptz, uuid) is
  'Record a provider-verified refund, not permission to issue one. Eligibility and access revocation require separately approved policy.';

commit;
