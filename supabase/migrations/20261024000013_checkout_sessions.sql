-- Checkout preparation only. No provider I/O, credentials, mandates, charges,
-- subscription writes or approved operating/legal policy are seeded here.
begin;

create table private.checkout_policies (
  version uuid primary key,
  title text not null check (length(title) between 1 and 200 and btrim(title)<>'' and title !~ '[[:cntrl:]]'),
  body text not null check (length(body) between 1 and 100000 and body ~ '[^[:space:]]'),
  regular_price_krw integer not null check (regular_price_krw>0),
  intro_price_krw integer not null check (intro_price_krw>=0),
  approved_at timestamptz check (approved_at is null or isfinite(approved_at)),
  published_at timestamptz check (published_at is null or
    (isfinite(published_at) and approved_at is not null and published_at>=approved_at))
);
create table private.checkout_policy_current (
  singleton boolean primary key default true check (singleton),
  policy_version uuid not null references private.checkout_policies(version)
);
create table private.checkout_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete restrict,
  artist_id uuid not null references public.artists(id) on delete restrict,
  provider public.payment_provider not null,
  environment private.payment_environment not null,
  idempotency_key uuid not null,
  nonce_hash text not null check (nonce_hash ~ '^[a-f0-9]{64}$'),
  policy_version uuid not null references private.checkout_policies(version),
  initial_price_krw integer not null check (initial_price_krw>=0),
  regular_price_krw integer not null check (regular_price_krw>0),
  intro_eligible boolean not null,
  customer_ref uuid not null default gen_random_uuid(),
  order_id uuid not null default gen_random_uuid(),
  status text not null default 'pending_intent' check (status in ('pending_intent','canceled','expired')),
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  canceled_at timestamptz,
  unique(user_id,idempotency_key),
  unique(customer_ref),
  unique(order_id),
  check (isfinite(created_at) and isfinite(expires_at) and expires_at>created_at
    and expires_at<=created_at+interval '30 minutes'),
  check ((status='canceled' and canceled_at is not null and isfinite(canceled_at) and canceled_at>=created_at)
    or (status<>'canceled' and canceled_at is null))
);
create unique index checkout_sessions_one_pending on private.checkout_sessions(user_id,artist_id)
  where status='pending_intent';
create index checkout_sessions_expiry on private.checkout_sessions(expires_at) where status='pending_intent';

alter table private.checkout_policies enable row level security;
alter table private.checkout_policy_current enable row level security;
alter table private.checkout_sessions enable row level security;
revoke all on private.checkout_policies,private.checkout_policy_current,private.checkout_sessions
  from public,anon,authenticated,service_role;
comment on table private.checkout_policies is
  'An explicitly approved immutable commercial/legal snapshot, including exact KRW prices. No fallback to draft defaults or unrelated mutable settings. Publication requires owner-controlled review; this migration activates nothing.';
comment on table private.checkout_sessions is
  'Short-lived local pending intent only. Opaque customer/order references are not provider keys. No raw nonce, SID, billing key, authKey, pg_token, direct personal details or provider response is stored. Actor-linked pseudonymous records still require a retention policy. Does not create a subscription, mandate, payment or access.';

create function private.checkout_policy_immutable() returns trigger
language plpgsql set search_path='' as $$
begin
  if tg_op='TRUNCATE' or old.approved_at is not null then
    raise exception 'CHECKOUT_POLICY_IMMUTABLE' using errcode='23514'; end if;
  if tg_op='DELETE' then return old; end if;
  if new.version is distinct from old.version then
    raise exception 'CHECKOUT_POLICY_IMMUTABLE' using errcode='23514'; end if;
  return new;
end;
$$;
create trigger checkout_policy_immutable before update or delete on private.checkout_policies
  for each row execute function private.checkout_policy_immutable();
create trigger checkout_policy_no_truncate before truncate on private.checkout_policies
  for each statement execute function private.checkout_policy_immutable();

create function private.checkout_require_actor(p_user_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare cfg private.profile_onboarding_policy%rowtype;
begin
  -- Caller first locks the same profile; the shared discovery gate revalidates
  -- current role/restriction/name/age/legal evidence, not only historic clocks.
  perform private.discovery_require_actor(p_user_id);
  perform 1 from public.profiles where id=p_user_id and onboarding_completed_at is not null for share;
  if not found then raise exception 'CHECKOUT_ONBOARDING_REQUIRED' using errcode='55000'; end if;
  select * into cfg from private.profile_onboarding_policy for share;
  perform 1 from private.profile_policy_acceptances where user_id=p_user_id
    and kind='terms' and version=cfg.terms_version for share;
  if not found then raise exception 'CHECKOUT_PROFILE_REQUIRED' using errcode='55000'; end if;
  perform 1 from private.profile_policy_acceptances where user_id=p_user_id
    and kind='privacy' and version=cfg.privacy_version for share;
  if not found then raise exception 'CHECKOUT_PROFILE_REQUIRED' using errcode='55000'; end if;
end;
$$;

create function private.checkout_current_policy() returns private.checkout_policies
language plpgsql security definer set search_path='' as $$
declare selected uuid; policy private.checkout_policies%rowtype; at_time timestamptz;
begin
  select policy_version into selected from private.checkout_policy_current where singleton for share;
  select * into policy from private.checkout_policies where version=selected for share;
  at_time:=clock_timestamp();
  if policy.version is null or policy.approved_at is null or policy.approved_at>at_time
    or policy.published_at is null or policy.published_at>at_time then
    raise exception 'CHECKOUT_SETUP_NOT_READY' using errcode='55000'; end if;
  return policy;
end;
$$;

create function public.checkout_get_offer(p_artist_slug text)
returns table(artist_slug text,artist_name text,policy_version uuid,policy_title text,policy_body text,
  regular_price_krw integer,intro_price_krw integer,intro_eligible boolean,initial_price_krw integer)
language plpgsql security definer set search_path='' as $$
declare artist public.artists%rowtype; policy private.checkout_policies%rowtype; eligible boolean;
begin
  perform private.checkout_require_actor(auth.uid());
  if p_artist_slug is null or length(p_artist_slug)>128 or p_artist_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
    raise exception 'CHECKOUT_INVALID_INPUT' using errcode='22023'; end if;
  policy:=private.checkout_current_policy();
  select a.* into artist from public.artists a where a.slug=p_artist_slug and a.status='active' for share;
  if artist.id is null then raise exception 'CHECKOUT_NOT_FOUND' using errcode='P0002'; end if;
  select not exists(select 1 from public.subscriptions s where s.user_id=auth.uid()
    and s.artist_id=artist.id and s.intro_redeemed_at is not null) into eligible;
  return query select artist.slug,artist.name,policy.version,policy.title,policy.body,
    policy.regular_price_krw,policy.intro_price_krw,eligible,
    case when eligible then policy.intro_price_krw else policy.regular_price_krw end;
end;
$$;

create function private.checkout_session_projection(p_session_id uuid,p_nonce_hash text default null)
returns table(session_id uuid,status text,artist_slug text,artist_name text,provider public.payment_provider,
  environment text,policy_version uuid,policy_title text,policy_body text,initial_price_krw integer,
  regular_price_krw integer,intro_price_krw integer,intro_eligible boolean,customer_ref uuid,order_id uuid,expires_at timestamptz,nonce_matches boolean)
language sql volatile security definer set search_path='' as $$
  select s.id,case when s.status='pending_intent' and s.expires_at<=clock_timestamp() then 'expired' else s.status end,
    a.slug,a.name,s.provider,s.environment::text,s.policy_version,p.title,p.body,s.initial_price_krw,
    s.regular_price_krw,p.intro_price_krw,s.intro_eligible,s.customer_ref,s.order_id,s.expires_at,coalesce(s.nonce_hash=p_nonce_hash,false)
  from private.checkout_sessions s join public.artists a on a.id=s.artist_id
  join private.checkout_policies p on p.version=s.policy_version where s.id=p_session_id;
$$;

create function public.checkout_prepare_session(p_user_id uuid,p_artist_slug text,p_provider public.payment_provider,
  p_environment text,p_idempotency_key uuid,p_nonce_hash text,p_policy_version uuid,p_terms_accepted boolean)
returns table(session_id uuid,status text,artist_slug text,artist_name text,provider public.payment_provider,
  environment text,policy_version uuid,policy_title text,policy_body text,initial_price_krw integer,
  regular_price_krw integer,intro_price_krw integer,intro_eligible boolean,customer_ref uuid,order_id uuid,expires_at timestamptz,nonce_matches boolean)
language plpgsql security definer set search_path='' as $$
declare artist public.artists%rowtype; policy private.checkout_policies%rowtype;
  prior private.checkout_sessions%rowtype; subscription public.subscriptions%rowtype;
  eligible boolean; prepared uuid; at_time timestamptz;
begin
  perform private.require_billing_service();
  if p_user_id is null or p_artist_slug is null or length(p_artist_slug)>128
    or p_artist_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or p_provider is null
    or p_environment is null or p_environment not in ('test','live') or p_idempotency_key is null
    or p_nonce_hash is null or p_nonce_hash !~ '^[a-f0-9]{64}$' or p_policy_version is null then
    raise exception 'CHECKOUT_INVALID_INPUT' using errcode='22023'; end if;
  if p_terms_accepted is distinct from true then
    raise exception 'CHECKOUT_CONSENT_REQUIRED' using errcode='22023'; end if;
  -- One actor lock serializes double clicks, idempotency and distinct-key races.
  perform 1 from public.profiles where id=p_user_id for update;
  perform private.checkout_require_actor(p_user_id);
  policy:=private.checkout_current_policy();
  select a.* into artist from public.artists a where a.slug=p_artist_slug and a.status='active' for share;
  if artist.id is null then raise exception 'CHECKOUT_NOT_FOUND' using errcode='P0002'; end if;
  if policy.version<>p_policy_version then
    raise exception 'CHECKOUT_POLICY_CHANGED' using errcode='55000'; end if;
  select * into prior from private.checkout_sessions s
    where s.user_id=p_user_id and s.idempotency_key=p_idempotency_key for update;
  if prior.id is not null then
    if prior.artist_id<>artist.id or prior.provider<>p_provider or prior.environment::text<>p_environment
      or prior.policy_version<>p_policy_version then
      raise exception 'CHECKOUT_IDEMPOTENCY_CONFLICT' using errcode='55000'; end if;
    -- Never rotate a nonce, identity, original consent/snapshot or TTL on retry.
    return query select * from private.checkout_session_projection(prior.id,p_nonce_hash);
    return;
  end if;
  select * into subscription from public.subscriptions s
    where s.user_id=p_user_id and s.artist_id=artist.id for update;
  at_time:=clock_timestamp();
  if subscription.id is not null and (subscription.status not in ('expired','canceled')
    or subscription.current_period_end>at_time
    or exists(select 1 from private.billing_obligations o where o.subscription_id=subscription.id and o.state='open')) then
    raise exception 'CHECKOUT_SUBSCRIPTION_EXISTS' using errcode='55000'; end if;
  update private.checkout_sessions s set status='expired'
    where s.user_id=p_user_id and s.artist_id=artist.id and s.status='pending_intent' and s.expires_at<=at_time;
  if exists(select 1 from private.checkout_sessions s
    where s.user_id=p_user_id and s.artist_id=artist.id and s.status='pending_intent') then
    raise exception 'CHECKOUT_SESSION_EXISTS' using errcode='55000'; end if;
  eligible:=subscription.intro_redeemed_at is null;
  insert into private.checkout_sessions(user_id,artist_id,provider,environment,idempotency_key,nonce_hash,
    policy_version,initial_price_krw,regular_price_krw,intro_eligible,created_at,expires_at)
    values(p_user_id,artist.id,p_provider,p_environment::private.payment_environment,p_idempotency_key,p_nonce_hash,
      policy.version,case when eligible then policy.intro_price_krw else policy.regular_price_krw end,
      policy.regular_price_krw,eligible,at_time,at_time+interval '15 minutes') returning id into prepared;
  return query select * from private.checkout_session_projection(prepared,p_nonce_hash);
end;
$$;

create function public.checkout_read_session(p_user_id uuid,p_session_id uuid)
returns table(session_id uuid,status text,artist_slug text,artist_name text,provider public.payment_provider,
  environment text,policy_version uuid,policy_title text,policy_body text,initial_price_krw integer,
  regular_price_krw integer,intro_price_krw integer,intro_eligible boolean,customer_ref uuid,order_id uuid,expires_at timestamptz,nonce_matches boolean)
language plpgsql security definer set search_path='' as $$
begin
  perform private.require_billing_service();
  perform private.checkout_require_actor(p_user_id);
  perform 1 from private.checkout_sessions where id=p_session_id and user_id=p_user_id for share;
  if not found then raise exception 'CHECKOUT_NOT_FOUND' using errcode='P0002'; end if;
  -- Read-only expiry projection. A GET never writes cancellation/expiry state.
  return query select * from private.checkout_session_projection(p_session_id);
end;
$$;

create function public.checkout_cancel_session(p_user_id uuid,p_session_id uuid,p_nonce_hash text) returns void
language plpgsql security definer set search_path='' as $$
declare current_session private.checkout_sessions%rowtype; at_time timestamptz;
begin
  perform private.require_billing_service();
  if p_nonce_hash is null or p_nonce_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'CHECKOUT_INVALID_INPUT' using errcode='22023'; end if;
  -- Even restricted/incomplete actors may abandon their own pending intent;
  -- this grants no new capability, access, consent or provider operation.
  perform 1 from public.profiles where id=p_user_id for update;
  if not found then raise exception 'CHECKOUT_NOT_FOUND' using errcode='P0002'; end if;
  select * into current_session from private.checkout_sessions where id=p_session_id and user_id=p_user_id for update;
  if current_session.id is null then raise exception 'CHECKOUT_NOT_FOUND' using errcode='P0002'; end if;
  if current_session.nonce_hash<>p_nonce_hash then
    raise exception 'CHECKOUT_NONCE_INVALID' using errcode='42501'; end if;
  at_time:=clock_timestamp();
  if current_session.status<>'pending_intent' then
    raise exception 'CHECKOUT_SESSION_REPLAY' using errcode='55000'; end if;
  if current_session.expires_at<=at_time then
    raise exception 'CHECKOUT_SESSION_EXPIRED' using errcode='55000'; end if;
  update private.checkout_sessions set status='canceled',canceled_at=at_time where id=current_session.id;
end;
$$;

revoke all on function private.checkout_policy_immutable(),private.checkout_require_actor(uuid),
  private.checkout_current_policy(),private.checkout_session_projection(uuid,text) from public,anon,authenticated,service_role;
revoke all on function public.checkout_get_offer(text),
  public.checkout_prepare_session(uuid,text,public.payment_provider,text,uuid,text,uuid,boolean),
  public.checkout_read_session(uuid,uuid),public.checkout_cancel_session(uuid,uuid,text)
  from public,anon,authenticated,service_role;
grant execute on function public.checkout_get_offer(text) to authenticated;
grant execute on function public.checkout_prepare_session(uuid,text,public.payment_provider,text,uuid,text,uuid,boolean),
  public.checkout_read_session(uuid,uuid),public.checkout_cancel_session(uuid,uuid,text) to service_role;
comment on function public.checkout_prepare_session(uuid,text,public.payment_provider,text,uuid,text,uuid,boolean) is
  'Trusted server preparation only. Actor comes from verified auth; current exact terms consent and prices rechecked atomically. No provider I/O, subscription, mandate or charge. Replays never rotate the original nonce or TTL.';
commit;
