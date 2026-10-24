-- Cancellation stops local future renewals. Refund requests, human authorization,
-- provider dispatch and verified financial recognition are separate boundaries.
-- This migration approves no business/legal policy and sends no provider calls.
begin;

create table private.refund_policies (
  version uuid primary key,
  title text not null check(length(title) between 1 and 200),
  body text not null check(length(body) between 1 and 20000),
  access_effect text not null check(access_effect='preserve_paid_access'),
  payment_tax_basis text not null check(payment_tax_basis='taxable_krw'),
  approved_at timestamptz check(approved_at is null or isfinite(approved_at)),
  published_at timestamptz check(published_at is null or (isfinite(published_at) and approved_at is not null and published_at>=approved_at))
);
create table private.refund_policy_current (
  singleton boolean primary key default true check(singleton),
  version uuid not null references private.refund_policies(version) on delete restrict
);
create table private.refund_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete restrict,
  subscription_id uuid not null references public.subscriptions(id) on delete restrict,
  original_event_id uuid not null references public.payment_events(id) on delete restrict,
  idempotency_key uuid not null,
  amount_krw integer not null check(amount_krw>0),
  reason text not null check(length(reason) between 1 and 500),
  state text not null default 'requested' check(state in ('requested','authorized','inflight','unknown','succeeded','failed','rejected')),
  policy_version uuid references private.refund_policies(version) on delete restrict,
  authorized_by uuid references public.profiles(id) on delete restrict,
  decision_reason text check(length(decision_reason) between 1 and 500),
  decided_at timestamptz,
  refunded_before_krw integer check(refunded_before_krw>=0),
  lease_token uuid,
  lease_expires_at timestamptz,
  query_attempts integer not null default 0 check(query_attempts between 0 and 3),
  query_lease_token uuid,
  query_lease_expires_at timestamptz,
  next_query_at timestamptz not null default clock_timestamp(),
  payment_event_id uuid unique references public.payment_events(id) on delete restrict,
  outcome_evidence_ref uuid,
  requested_at timestamptz not null default clock_timestamp(),
  finished_at timestamptz,
  unique(user_id,idempotency_key),
  check(state not in ('authorized','inflight','unknown','succeeded','failed') or (policy_version is not null and authorized_by is not null and decided_at is not null and refunded_before_krw is not null)),
  check(state<>'inflight' or (lease_token is not null and lease_expires_at is not null)),
  check(state<>'succeeded' or payment_event_id is not null),
  check(state<>'failed' or outcome_evidence_ref is not null)
);
create unique index refund_requests_one_unresolved on private.refund_requests(original_event_id)
 where state in ('requested','authorized','inflight','unknown');
create index refund_requests_inbox on private.refund_requests(state,requested_at,id);
create table private.refund_decisions (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references private.refund_requests(id) on delete restrict,
  actor_id uuid not null references public.profiles(id) on delete restrict,
  decision text not null check(decision in ('approve','reject')),
  amount_krw integer not null check(amount_krw>0),
  policy_version uuid references private.refund_policies(version) on delete restrict,
  reason text not null check(length(reason) between 1 and 500),
  decided_at timestamptz not null default clock_timestamp()
);
alter table private.refund_policies enable row level security;
alter table private.refund_policy_current enable row level security;
alter table private.refund_requests enable row level security;
alter table private.refund_decisions enable row level security;
revoke all on private.refund_policies,private.refund_policy_current,private.refund_requests,private.refund_decisions from public,anon,authenticated,service_role;
comment on table private.refund_policies is 'Explicit reviewed legal/business policy only. No 7-day/no-read draft default. Approval authorizes manual case review; implementation supports preserving paid-period access, never implicit immediate termination.';
comment on table private.refund_requests is 'Mutable operation lifecycle, not money. One unresolved operation per original verified charge. A request is not approval and approval is not provider success.';

create function private.refund_policy_immutable() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='TRUNCATE' or old.approved_at is not null then raise exception 'REFUND_POLICY_IMMUTABLE' using errcode='23514'; end if;
 if tg_op='DELETE' then return old; end if;
 if new.version is distinct from old.version then raise exception 'REFUND_POLICY_IMMUTABLE' using errcode='23514'; end if;
 return new;
end;$$;
create trigger refund_policy_immutable before update or delete on private.refund_policies for each row execute function private.refund_policy_immutable();
create trigger refund_policy_no_truncate before truncate on private.refund_policies for each statement execute function private.refund_policy_immutable();
create trigger refund_decisions_immutable before update or delete on private.refund_decisions for each row execute function private.reject_ledger_mutation();
create trigger refund_decisions_no_truncate before truncate on private.refund_decisions for each statement execute function private.reject_ledger_mutation();

-- Match ECMAScript String.trim at the direct RPC boundary too. Internal newlines
-- remain valid human explanation; whitespace-only reasons cannot poison DTOs.
create function private.refund_normalize_reason(p_value text) returns text language sql immutable strict set search_path='' as $$
 select btrim(p_value,U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF');
$$;
alter table private.refund_requests add constraint refund_requests_reason_normalized check(reason=private.refund_normalize_reason(reason) and reason<>'');
alter table private.refund_requests add constraint refund_requests_decision_reason_normalized check(decision_reason is null or (decision_reason=private.refund_normalize_reason(decision_reason) and decision_reason<>''));
alter table private.refund_decisions add constraint refund_decisions_reason_normalized check(reason=private.refund_normalize_reason(reason) and reason<>'');
create function private.refund_require_actor() returns uuid language plpgsql set search_path='' as $$
declare actor uuid:=auth.uid();
begin
 if current_setting('role',true) is distinct from 'authenticated' or actor is null then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 return actor;
end;$$;
-- Refund execution locks executor+approver identities in UUID order. The role
-- mutation path must use the same order, rather than actor-then-target (ABBA).
create or replace function public.set_profile_role(p_user_id uuid,p_role public.user_role)
returns void language plpgsql security definer set search_path='' as $$
declare actor public.profiles%rowtype;
begin
 perform 1 from public.profiles where id in (auth.uid(),p_user_id) order by id for update;
 select * into actor from public.profiles where id=auth.uid();
 if actor.id is null or actor.role<>'admin' or (actor.is_restricted and (actor.restricted_until is null or actor.restricted_until>clock_timestamp())) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_role is null then raise exception 'ROLE_REQUIRED' using errcode='22004'; end if;
 update public.profiles set role=p_role where id=p_user_id;
 if not found then raise exception 'PROFILE_NOT_FOUND' using errcode='P0002'; end if;
end;$$;
create function private.refund_require_admin() returns uuid language plpgsql set search_path='' as $$
declare actor uuid:=private.refund_require_actor(); p public.profiles%rowtype;
begin
 -- Authorization shares the same identity row lock used by set_profile_role.
 select * into p from public.profiles where id=actor for share;
 if p.id is null or p.role<>'admin' or (p.is_restricted and (p.restricted_until is null or p.restricted_until>clock_timestamp())) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 return actor;
end;$$;
create function private.refund_policy_projection() returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('version',p.version,'title',p.title,'body',p.body,'access_effect',p.access_effect)
 from private.refund_policy_current c join private.refund_policies p using(version)
 where c.singleton and p.approved_at<=statement_timestamp() and p.published_at<=statement_timestamp();
$$;
create function private.refund_has_payment_identity(p_event_id uuid) returns boolean language sql stable set search_path='' as $$
 select exists(select 1 from private.payment_event_verifications v
 join private.payment_attempts pa on pa.id=v.attempt_id join private.billing_obligations o on o.id=pa.obligation_id
 join private.payment_mandates m on m.id=o.mandate_id join private.checkout_policies cp on cp.version::text=o.price_version
 where v.event_id=p_event_id and cp.payment_tax_basis='taxable_krw' and coalesce(
 (select se.provider_payment_id from private.subscription_enrollments se where se.payment_event_id=v.event_id),
 (select ra.provider_payment_id from private.renewal_attempts ra where ra.attempt_id=v.attempt_id)) is not null);
$$;
create function private.refund_request_projection(p_request_id uuid) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('id',r.id,'subscription_id',r.subscription_id,'original_event_id',r.original_event_id,
  'artist_name',a.name,'artist_slug',a.slug,'amount_krw',r.amount_krw,'charge_amount_krw',e.amount_krw,
  'refunded_krw',(select coalesce(-sum(x.amount_krw::bigint),0) from public.payment_events x where x.original_event_id=e.id),
  'currency',e.currency,'status',r.state,'reason',r.reason,'decision_reason',r.decision_reason,
  'policy_version',r.policy_version,'requested_at',r.requested_at,'decided_at',r.decided_at,'finished_at',r.finished_at,
  'can_reconcile',((r.state='inflight' and r.lease_expires_at<=statement_timestamp()) or
   (r.state='unknown' and r.query_attempts<3 and r.next_query_at<=statement_timestamp() and (r.query_lease_expires_at is null or r.query_lease_expires_at<=statement_timestamp()) and private.refund_has_payment_identity(r.original_event_id))),
  'requires_manual_review',(r.state in ('authorized','inflight','unknown') and
   (not private.refund_has_payment_identity(r.original_event_id) or r.query_attempts>=3 or
    (r.state='authorized' and (not exists(select 1 from public.profiles approver where approver.id=r.authorized_by and approver.role='admin'
      and not (approver.is_restricted and (approver.restricted_until is null or approver.restricted_until>statement_timestamp())))
      or r.refunded_before_krw is distinct from (select coalesce(-sum(x.amount_krw::bigint),0) from public.payment_events x where x.original_event_id=r.original_event_id))))))
 from private.refund_requests r join public.subscriptions s on s.id=r.subscription_id
 join public.artists a on a.id=s.artist_id join public.payment_events e on e.id=r.original_event_id where r.id=p_request_id;
$$;
create function private.subscription_management_projection(p_subscription_id uuid) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('id',s.id,'artist_id',s.artist_id,'artist_name',a.name,'artist_slug',a.slug,'status',s.status,
  'has_access',public.has_active_access(s.artist_id),'can_cancel',s.status in ('pending','active','grace'),
  'current_period_end',s.current_period_end,'next_billing_at',s.next_billing_at,'canceled_at',s.canceled_at,
  'has_unresolved_charge',exists(select 1 from private.billing_obligations o join private.payment_attempts pa on pa.obligation_id=o.id
    where o.subscription_id=s.id and o.state='open' and pa.state in ('inflight','unknown')))
 from public.subscriptions s join public.artists a on a.id=s.artist_id where s.id=p_subscription_id;
$$;
create function public.subscription_management_list(p_page integer default 1) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=private.refund_require_actor(); result jsonb;
begin
 if p_page is null or p_page not between 1 and 10000 then raise exception 'REFUND_INVALID_INPUT' using errcode='22023'; end if;
 select coalesce(jsonb_agg(private.subscription_management_projection(q.id) order by q.created_at desc,q.id),'[]'::jsonb) into result
 from (select id,created_at from public.subscriptions where user_id=actor order by created_at desc,id limit 100 offset (p_page-1)*100) q;
 return jsonb_build_object('subscriptions',result,'page',p_page,'more_available',(select count(*)>p_page*100 from public.subscriptions where user_id=actor));
end;$$;
create function public.subscription_management_read(p_subscription_id uuid,p_page integer default 1) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=private.refund_require_actor(); result jsonb; charges jsonb;
begin
 if p_page is null or p_page not between 1 and 10000 then raise exception 'REFUND_INVALID_INPUT' using errcode='22023'; end if;
 if not exists(select 1 from public.subscriptions where id=p_subscription_id and user_id=actor) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 result:=private.subscription_management_projection(p_subscription_id);
 select coalesce(jsonb_agg(jsonb_build_object('id',q.id,'amount_krw',q.amount_krw,'currency',q.currency,'occurred_at',q.occurred_at,
 'refunded_krw',(select coalesce(-sum(e.amount_krw::bigint),0) from public.payment_events e where e.original_event_id=q.id),
 'can_request_refund',(q.amount_krw>(select coalesce(-sum(e.amount_krw::bigint),0) from public.payment_events e where e.original_event_id=q.id)
  and exists(select 1 from private.payment_event_verifications v where v.event_id=q.id)
  and not exists(select 1 from private.refund_requests r where r.original_event_id=q.id and r.state in ('requested','authorized','inflight','unknown'))),
 'refund_request',(select private.refund_request_projection(r.id) from private.refund_requests r where r.original_event_id=q.id order by r.requested_at desc,r.id limit 1)) order by q.occurred_at desc,q.id),'[]'::jsonb) into charges
 from (select * from public.payment_events where subscription_id=p_subscription_id and kind='charge' order by occurred_at desc,id limit 20 offset (p_page-1)*20) q;
 return result||jsonb_build_object('charges',charges,'page',p_page,'charges_more_available',(select count(*)>p_page*20 from public.payment_events where subscription_id=p_subscription_id and kind='charge'));
end;$$;

create function public.refund_request(p_subscription_id uuid,p_original_event_id uuid,p_amount_krw integer,p_reason text,p_idempotency_key uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=private.refund_require_actor(); s public.subscriptions%rowtype; e public.payment_events%rowtype; r private.refund_requests%rowtype; used bigint;
begin
 if p_idempotency_key is null or p_amount_krw is null or p_amount_krw<=0 or p_reason is null or length(private.refund_normalize_reason(p_reason)) not between 1 and 500 then raise exception 'REFUND_INVALID_INPUT' using errcode='22023'; end if;
 select * into s from public.subscriptions where id=p_subscription_id for update;
 if s.id is null or s.user_id<>actor then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 select * into e from public.payment_events where id=p_original_event_id for update;
 if e.id is null or e.subscription_id<>s.id or e.kind<>'charge' then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 select * into r from private.refund_requests where user_id=actor and idempotency_key=p_idempotency_key;
 if r.id is not null then
   if r.original_event_id<>e.id or r.amount_krw<>p_amount_krw or r.reason<>private.refund_normalize_reason(p_reason) then raise exception 'REFUND_IDEMPOTENCY_CONFLICT' using errcode='55000'; end if;
   return private.refund_request_projection(r.id);
 end if;
 if not exists(select 1 from private.payment_event_verifications where event_id=e.id) then raise exception 'REFUND_CHARGE_UNVERIFIED' using errcode='55000'; end if;
 select coalesce(-sum(amount_krw::bigint),0) into used from public.payment_events where original_event_id=e.id;
 if p_amount_krw::bigint+used>e.amount_krw then raise exception 'REFUND_EXCEEDS_CHARGE' using errcode='23514'; end if;
 select * into r from private.refund_requests where original_event_id=e.id and state in ('requested','authorized','inflight','unknown');
 if r.id is not null then raise exception 'REFUND_ALREADY_OPEN' using errcode='55000'; end if;
 insert into private.refund_requests(user_id,subscription_id,original_event_id,idempotency_key,amount_krw,reason)
 values(actor,s.id,e.id,p_idempotency_key,p_amount_krw,private.refund_normalize_reason(p_reason)) returning * into r;
 return private.refund_request_projection(r.id);
end;$$;
create function public.refund_admin_list(p_limit integer default 50,p_page integer default 1) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 perform private.refund_require_admin();
 if p_limit is null or p_limit not between 1 and 100 or p_page is null or p_page not between 1 and 10000 then raise exception 'REFUND_INVALID_INPUT' using errcode='22023'; end if;
 select coalesce(jsonb_agg(private.refund_request_projection(q.id) order by q.closed,q.requested_at,q.id),'[]'::jsonb) into result
 from (select id,requested_at,state in ('succeeded','failed','rejected') as closed from private.refund_requests order by state in ('succeeded','failed','rejected'),requested_at,id limit p_limit offset (p_page-1)*p_limit) q;
 return jsonb_build_object('requests',result,'page',p_page,'more_available',(select count(*)>p_limit*p_page from private.refund_requests),'policy',private.refund_policy_projection());
end;$$;
create function public.refund_admin_read(p_request_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 perform private.refund_require_admin(); result:=private.refund_request_projection(p_request_id);
 if result is null then raise exception 'REFUND_NOT_FOUND' using errcode='P0002'; end if;
 return jsonb_build_object('request',result,'policy',private.refund_policy_projection());
end;$$;
create function public.refund_decide(p_request_id uuid,p_decision text,p_amount_krw integer default null,p_policy_version uuid default null,p_reason text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=private.refund_require_admin(); r private.refund_requests%rowtype; p private.refund_policies%rowtype; used bigint; current_version uuid;
begin
 if p_decision is null or p_decision not in ('approve','reject') or p_reason is null or length(private.refund_normalize_reason(p_reason)) not between 1 and 500 then raise exception 'REFUND_INVALID_INPUT' using errcode='22023'; end if;
 select * into r from private.refund_requests where id=p_request_id;
 if r.id is null then raise exception 'REFUND_NOT_FOUND' using errcode='P0002'; end if;
 perform 1 from public.subscriptions where id=r.subscription_id for update;
 perform 1 from public.payment_events where id=r.original_event_id for update;
 select * into strict r from private.refund_requests where id=p_request_id for update;
 if (p_decision='approve' and r.state='authorized' and r.amount_krw=p_amount_krw and r.policy_version=p_policy_version and r.authorized_by=actor and r.decision_reason=private.refund_normalize_reason(p_reason))
 or (p_decision='reject' and r.state='rejected' and r.decision_reason=private.refund_normalize_reason(p_reason)) then return private.refund_request_projection(r.id); end if;
 if r.state<>'requested' and not (p_decision='reject' and r.state='authorized') then raise exception 'REFUND_STATE_CONFLICT' using errcode='55000'; end if;
 if p_decision='approve' then
   select version into current_version from private.refund_policy_current where singleton for share;
   select * into p from private.refund_policies where version=p_policy_version for share;
   if p.version is null or p.version is distinct from current_version or p.approved_at is null or p.published_at is null or p.approved_at>clock_timestamp() or p.published_at>clock_timestamp() then raise exception 'REFUND_POLICY_NOT_APPROVED' using errcode='55000'; end if;
   if p_amount_krw is null or p_amount_krw<>r.amount_krw then raise exception 'REFUND_AMOUNT_MISMATCH' using errcode='23514'; end if;
   select coalesce(-sum(amount_krw::bigint),0) into used from public.payment_events where original_event_id=r.original_event_id;
   if r.amount_krw::bigint+used>(select amount_krw from public.payment_events where id=r.original_event_id) then raise exception 'REFUND_EXCEEDS_CHARGE' using errcode='23514'; end if;
   update private.refund_requests set state='authorized',policy_version=p.version,authorized_by=actor,decision_reason=private.refund_normalize_reason(p_reason),decided_at=clock_timestamp(),refunded_before_krw=used where id=r.id;
 else
   update private.refund_requests set state='rejected',decision_reason=private.refund_normalize_reason(p_reason),decided_at=clock_timestamp(),finished_at=clock_timestamp() where id=r.id;
 end if;
 insert into private.refund_decisions(request_id,actor_id,decision,amount_krw,policy_version,reason) values(r.id,actor,p_decision,r.amount_krw,case when p_decision='approve' then p.version else r.policy_version end,private.refund_normalize_reason(p_reason));
 return private.refund_request_projection(r.id);
end;$$;

create function private.refund_dispatch_projection(p_request_id uuid) returns jsonb language plpgsql set search_path='' as $$
declare r private.refund_requests%rowtype; e public.payment_events%rowtype; v private.payment_event_verifications%rowtype; m private.payment_mandates%rowtype;
 payment_id text; tax_basis text; action text:='none'; reason text; at_time timestamptz:=clock_timestamp();
begin
 select * into r from private.refund_requests where id=p_request_id;
 if r.id is null then raise exception 'REFUND_NOT_FOUND' using errcode='P0002'; end if;
 select * into strict e from public.payment_events where id=r.original_event_id;
 select * into strict v from private.payment_event_verifications where event_id=e.id;
 select pm.* into m from private.payment_mandates pm join private.billing_obligations o on o.mandate_id=pm.id join private.payment_attempts pa on pa.obligation_id=o.id where pa.id=v.attempt_id;
 select coalesce((select se.provider_payment_id from private.subscription_enrollments se where se.payment_event_id=e.id),
 (select ra.provider_payment_id from private.renewal_attempts ra where ra.attempt_id=v.attempt_id)) into payment_id;
 select cp.payment_tax_basis into tax_basis from private.checkout_policies cp join private.billing_obligations o on o.price_version=cp.version::text join private.payment_attempts pa on pa.obligation_id=o.id where pa.id=v.attempt_id;
 if r.state='authorized' then action:='refund';
 elsif r.state='inflight' and r.lease_expires_at<=at_time then action:='lease_expired';
 elsif r.state='unknown' then
   if r.query_attempts>=3 then action:='manual_review'; reason:='QUERY_LIMIT';
   elsif r.next_query_at<=at_time and (r.query_lease_expires_at is null or r.query_lease_expires_at<=at_time) then action:='reconcile'; end if;
 end if;
 if action in ('refund','reconcile') and (payment_id is null or m.id is null or tax_basis is distinct from 'taxable_krw') then action:='manual_review'; reason:='PAYMENT_IDENTITY_UNAVAILABLE'; end if;
 return jsonb_build_object('request_id',r.id,'subscription_id',r.subscription_id,'user_id',r.user_id,'original_event_id',r.original_event_id,
 'state',r.state,'amount_krw',r.amount_krw,'currency',e.currency,'provider',v.provider,'environment',v.environment,'merchant_account',v.merchant_account,
 'customer_ref',m.provider_customer_ref,'order_id',v.attempt_id,'provider_payment_id',payment_id,'provider_charge_action_id',v.provider_action_id,
 'charge_amount_krw',e.amount_krw,'refunded_before_krw',r.refunded_before_krw,'policy_version',r.policy_version,'payment_tax_basis',tax_basis,
 'requested_at',r.requested_at,'authorized_at',r.decided_at,'action',action,'reason',reason,'dispatch',false,'lease_token',null,'payment_event_id',r.payment_event_id);
end;$$;
create function public.refund_read(p_request_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin perform private.require_billing_service(); return private.refund_dispatch_projection(p_request_id); end;$$;
create function public.refund_claim(p_request_id uuid,p_actor_id uuid,p_lease_seconds integer default 180) returns jsonb language plpgsql security definer set search_path='' as $$
declare r private.refund_requests%rowtype; p private.refund_policies%rowtype; admin public.profiles%rowtype; executor public.profiles%rowtype; current_version uuid; used bigint; data jsonb; token uuid; at_time timestamptz;
begin
 perform private.require_billing_service();
 if p_lease_seconds is null or p_lease_seconds not between 90 and 300 then raise exception 'REFUND_INVALID_INPUT' using errcode='22023'; end if;
 select * into r from private.refund_requests where id=p_request_id;
 if r.id is null then raise exception 'REFUND_NOT_FOUND' using errcode='P0002'; end if;
 -- Identity -> subscription -> original money -> operation. Never invert this
 -- order with authorization, cancellation, charge finalization or admin revoke.
 perform 1 from public.profiles where id in (p_actor_id,r.authorized_by) order by id for share;
 select * into executor from public.profiles where id=p_actor_id;
 if executor.id is null or executor.role<>'admin' or (executor.is_restricted and (executor.restricted_until is null or executor.restricted_until>clock_timestamp())) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 select * into admin from public.profiles where id=r.authorized_by;
 perform 1 from public.subscriptions where id=r.subscription_id for update;
 perform 1 from public.payment_events where id=r.original_event_id for update;
 select * into strict r from private.refund_requests where id=p_request_id for update;
 at_time:=clock_timestamp(); data:=private.refund_dispatch_projection(r.id);
 if data->>'action'='lease_expired' then
   update private.refund_requests set state='unknown',next_query_at=at_time where id=r.id;
   return private.refund_dispatch_projection(r.id);
 end if;
 if data->>'action'='reconcile' then
   token:=gen_random_uuid();
   update private.refund_requests set query_attempts=query_attempts+1,query_lease_token=token,query_lease_expires_at=at_time+make_interval(secs=>p_lease_seconds),next_query_at=at_time+interval '1 hour' where id=r.id;
   return data||jsonb_build_object('dispatch',true,'lease_token',token);
 end if;
 if data->>'action'<>'refund' then return data; end if;
 if admin.id is null or admin.role<>'admin' or (admin.is_restricted and (admin.restricted_until is null or admin.restricted_until>at_time)) then return data||jsonb_build_object('action','blocked','reason','AUTHORIZATION_REVOKED'); end if;
 select version into current_version from private.refund_policy_current where singleton for share;
 select * into p from private.refund_policies where version=r.policy_version for share;
 at_time:=clock_timestamp();
 if p.version is null or p.version is distinct from current_version or p.approved_at is null or p.published_at is null or p.approved_at>at_time or p.published_at>at_time then return data||jsonb_build_object('action','blocked','reason','POLICY_NOT_APPROVED'); end if;
 select coalesce(-sum(amount_krw::bigint),0) into used from public.payment_events where original_event_id=r.original_event_id;
 if used<>r.refunded_before_krw or r.amount_krw::bigint+used>(select amount_krw from public.payment_events where id=r.original_event_id) then return data||jsonb_build_object('action','manual_review','reason','LEDGER_CHANGED'); end if;
 token:=gen_random_uuid();
 update private.refund_requests set state='inflight',lease_token=token,lease_expires_at=at_time+make_interval(secs=>p_lease_seconds) where id=r.id;
 return data||jsonb_build_object('state','inflight','dispatch',true,'lease_token',token);
end;$$;
create function public.refund_record_outcome(p_request_id uuid,p_lease_token uuid,p_outcome text,p_evidence_ref uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare r private.refund_requests%rowtype;
begin
 perform private.require_billing_service();
 select * into r from private.refund_requests where id=p_request_id for update;
 if r.id is null then raise exception 'REFUND_NOT_FOUND' using errcode='P0002'; end if;
 if p_lease_token is null or p_outcome is null or p_outcome not in ('failed','unknown') then raise exception 'REFUND_INVALID_INPUT' using errcode='22023'; end if;
 if r.state='unknown' and r.query_lease_token=p_lease_token and p_outcome='unknown' then
   update private.refund_requests set query_lease_expires_at=null where id=r.id;
   return private.refund_dispatch_projection(r.id);
 end if;
 if r.lease_token is distinct from p_lease_token or (p_outcome='failed' and p_evidence_ref is null) then raise exception 'REFUND_OUTCOME_CONFLICT' using errcode='55000'; end if;
 if r.state=p_outcome and (p_outcome='unknown' or r.outcome_evidence_ref=p_evidence_ref) then return private.refund_dispatch_projection(r.id); end if;
 if r.state<>'inflight' then raise exception 'REFUND_OUTCOME_CONFLICT' using errcode='55000'; end if;
 update private.refund_requests set state=p_outcome,outcome_evidence_ref=p_evidence_ref,next_query_at=clock_timestamp()+interval '1 hour',finished_at=case when p_outcome='failed' then clock_timestamp() end where id=r.id;
 return private.refund_dispatch_projection(r.id);
end;$$;
create function public.refund_finalize(p_request_id uuid,p_provider_action_id text,p_provider_payment_id text,p_amount_krw integer,
 p_currency text,p_refunded_at timestamptz,p_evidence_ref uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare r private.refund_requests%rowtype; data jsonb; event uuid;
begin
 perform private.require_billing_service();
 select * into r from private.refund_requests where id=p_request_id;
 if r.id is null then raise exception 'REFUND_NOT_FOUND' using errcode='P0002'; end if;
 perform 1 from public.subscriptions where id=r.subscription_id for update;
 perform 1 from public.payment_events where id=r.original_event_id for update;
 select * into strict r from private.refund_requests where id=p_request_id for update;
 data:=private.refund_dispatch_projection(r.id);
 if p_provider_action_id is null or length(p_provider_action_id) not between 1 and 200 or p_provider_action_id ~ '[[:cntrl:][:space:]]'
  or p_provider_payment_id is null or p_provider_payment_id is distinct from data->>'provider_payment_id' or p_amount_krw is distinct from r.amount_krw
  or p_currency is distinct from 'KRW' or p_refunded_at is null or not isfinite(p_refunded_at) or p_evidence_ref is null
  or p_refunded_at<date_trunc('second',r.decided_at) then raise exception 'REFUND_RESULT_MISMATCH' using errcode='23514'; end if;
 if r.state not in ('inflight','unknown','succeeded') then raise exception 'REFUND_OUTCOME_CONFLICT' using errcode='55000'; end if;
 event:=public.billing_record_refund(r.original_event_id,p_provider_action_id,p_amount_krw,p_currency,p_refunded_at,p_evidence_ref);
 if r.payment_event_id is not null and r.payment_event_id<>event then raise exception 'REFUND_OUTCOME_CONFLICT' using errcode='55000'; end if;
 update private.refund_requests set state='succeeded',payment_event_id=event,outcome_evidence_ref=p_evidence_ref,finished_at=coalesce(finished_at,clock_timestamp()) where id=r.id;
 -- Paid access and renewal intent are deliberately unchanged. Stopping renewal
 -- always uses the separate owner cancellation action; no implicit revocation.
 return event;
end;$$;

revoke all on function private.refund_policy_immutable(),private.refund_normalize_reason(text),private.refund_require_actor(),private.refund_require_admin(),private.refund_policy_projection(),private.refund_request_projection(uuid),private.refund_has_payment_identity(uuid),private.subscription_management_projection(uuid),private.refund_dispatch_projection(uuid) from public,anon,authenticated,service_role;
revoke all on function public.subscription_management_list(integer),public.subscription_management_read(uuid,integer),public.refund_request(uuid,uuid,integer,text,uuid),public.refund_admin_list(integer,integer),public.refund_admin_read(uuid),public.refund_decide(uuid,text,integer,uuid,text),public.refund_read(uuid),public.refund_claim(uuid,uuid,integer),public.refund_record_outcome(uuid,uuid,text,uuid),public.refund_finalize(uuid,text,text,integer,text,timestamptz,uuid) from public,anon,authenticated,service_role;
grant execute on function public.subscription_management_list(integer),public.subscription_management_read(uuid,integer),public.refund_request(uuid,uuid,integer,text,uuid),public.refund_admin_list(integer,integer),public.refund_admin_read(uuid),public.refund_decide(uuid,text,integer,uuid,text) to authenticated;
grant execute on function public.refund_read(uuid),public.refund_claim(uuid,uuid,integer),public.refund_record_outcome(uuid,uuid,text,uuid),public.refund_finalize(uuid,text,text,integer,text,timestamptz,uuid) to service_role;

commit;
