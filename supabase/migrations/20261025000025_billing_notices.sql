-- Approved KST pre-billing inbox and existing Web Push outbox integration only.
-- No policy, receipt, provider request, recurring job or charge is activated.
begin;

create table private.billing_notice_policies (
  checkout_policy_version uuid primary key references private.renewal_policies(checkout_policy_version) on delete restrict,
  days_before integer not null check(days_before between 1 and 31),
  hour_kst integer not null check(hour_kst between 0 and 23),
  mandatory_inapp boolean not null,
  approved_at timestamptz check(approved_at is null or isfinite(approved_at)),
  published_at timestamptz check(published_at is null or
    (isfinite(published_at) and approved_at is not null and published_at>=approved_at))
);
create table private.billing_notice_scan_cursor (
  singleton boolean primary key default true check(singleton),
  last_subscription_id uuid
);
alter table private.billing_notice_scan_cursor enable row level security;
revoke all on private.billing_notice_scan_cursor from public,anon,authenticated,service_role;

create table private.billing_notices (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.subscriptions(id) on delete restrict,
  user_id uuid not null references public.profiles(id) on delete restrict,
  artist_id uuid not null references public.artists(id) on delete restrict,
  mandate_id uuid not null references private.payment_mandates(id) on delete restrict,
  checkout_policy_version uuid not null references private.billing_notice_policies(checkout_policy_version) on delete restrict,
  period_start timestamptz not null check(isfinite(period_start)),
  period_end timestamptz not null check(isfinite(period_end) and period_end>period_start),
  billing_at timestamptz not null check(isfinite(billing_at) and billing_at=period_start),
  amount_krw integer not null check(amount_krw>0),
  currency text not null check(currency='KRW'),
  due_at timestamptz not null check(isfinite(due_at) and due_at<billing_at),
  mandatory boolean not null,
  created_at timestamptz not null default clock_timestamp() check(isfinite(created_at)),
  read_at timestamptz check(read_at is null or (isfinite(read_at) and read_at>=created_at)),
  invalidated_at timestamptz check(invalidated_at is null or (isfinite(invalidated_at) and invalidated_at>=created_at)),
  unique(subscription_id,period_start)
);
create index billing_notices_owner_idx on private.billing_notices(user_id,created_at desc,id desc);
alter table private.billing_notice_policies enable row level security;
alter table private.billing_notices enable row level security;
revoke all on private.billing_notice_policies,private.billing_notices from public,anon,authenticated,service_role;
create function private.billing_notice_policy_immutable() returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op='TRUNCATE' or old.approved_at is not null then raise exception 'BILLING_NOTICE_POLICY_IMMUTABLE' using errcode='23514'; end if;
  if tg_op='DELETE' then return old; end if;
  if new.checkout_policy_version is distinct from old.checkout_policy_version then
    raise exception 'BILLING_NOTICE_POLICY_IMMUTABLE' using errcode='23514'; end if;
  return new;
end;
$$;
create trigger billing_notice_policy_immutable before update or delete on private.billing_notice_policies
  for each row execute function private.billing_notice_policy_immutable();
create trigger billing_notice_policy_no_truncate before truncate on private.billing_notice_policies
  for each statement execute function private.billing_notice_policy_immutable();
create function private.billing_notice_immutable() returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op<>'UPDATE' then raise exception 'BILLING_NOTICE_IMMUTABLE' using errcode='23514'; end if;
  if (to_jsonb(new)-'read_at'-'invalidated_at') is distinct from (to_jsonb(old)-'read_at'-'invalidated_at')
    or (old.read_at is not null and new.read_at is distinct from old.read_at)
    or (old.invalidated_at is not null and new.invalidated_at is distinct from old.invalidated_at) then
    raise exception 'BILLING_NOTICE_IMMUTABLE' using errcode='23514'; end if;
  return new;
end;
$$;
create trigger billing_notice_immutable before update or delete on private.billing_notices
  for each row execute function private.billing_notice_immutable();
create trigger billing_notice_no_truncate before truncate on private.billing_notices
  for each statement execute function private.billing_notice_immutable();

-- Calendar days are explicitly Seoul-local. This is not an assumed 24-hour
-- duration: a 10:00 daily notice may be too late for a 09:00 next-day charge.
create function private.billing_notice_due_at(p_billing_at timestamptz,p_days integer,p_hour integer)
returns timestamptz language sql immutable strict set search_path='' as $$
  select case when isfinite(p_billing_at) and p_days between 1 and 31 and p_hour between 0 and 23
    then (((p_billing_at at time zone 'Asia/Seoul')::date-p_days)::timestamp
      +make_interval(hours=>p_hour)) at time zone 'Asia/Seoul' end;
$$;
-- Read-only equivalent of checkout's current profile/name/legal gate. This
-- helper acquires no row locks, so list/candidate statements stay STABLE. The
-- mutation/delivery boundaries lock the authoritative rows separately first.
create function private.billing_notice_actor_current(p_user uuid,p_at timestamptz) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.profiles a cross join private.profile_onboarding_policy cfg
    cross join lateral (select normalize(btrim(a.call_name),NFC) as name) normalized
    join private.onboarding_documents terms on terms.version=cfg.terms_version and terms.kind='terms'
    join private.onboarding_documents privacy on privacy.version=cfg.privacy_version and privacy.kind='privacy'
    where a.id=p_user and private.notification_actor_eligible(p_user,p_at)
      and a.font_selected_at is not null and a.age_self_attested_at is not null and a.profile_completed_at is not null
      and private.onboarding_name_policy_ready(cfg) and cfg.name_approved_at<=p_at
      and normalized.name is not null and char_length(normalized.name) between cfg.call_name_min and cfg.call_name_max
      and normalized.name !~ '[[:cntrl:]]' and normalized.name !~ U&'[\200B-\200F\202A-\202E\2060-\206F\FEFF]'
      and normalized.name !~ '^\s|\s$'
      and not exists(select 1 from unnest(cfg.profanity_words) word where strpos(lower(normalized.name),lower(normalize(word,NFC)))>0)
      and terms.approved_at<=p_at and terms.published_at<=p_at and privacy.approved_at<=p_at and privacy.published_at<=p_at
      and exists(select 1 from private.profile_policy_acceptances pa where pa.user_id=a.id and pa.kind='terms' and pa.version=terms.version)
      and exists(select 1 from private.profile_policy_acceptances pa where pa.user_id=a.id and pa.kind='privacy' and pa.version=privacy.version));
$$;
create function private.billing_notice_lock_actor(p_user uuid) returns void
language plpgsql set search_path='' as $$
begin
  perform 1 from private.profile_onboarding_policy for share;
  perform 1 from private.onboarding_documents d join private.profile_onboarding_policy cfg
    on d.version in(cfg.terms_version,cfg.privacy_version) order by d.version for share of d;
  perform 1 from private.profile_policy_acceptances where user_id=p_user order by kind,version for share;
end;
$$;
create function private.billing_notice_lock_subscription(p_subscription uuid) returns void
language plpgsql set search_path='' as $$
begin
  perform 1 from private.payment_mandates where subscription_id=p_subscription order by id for share;
  perform 1 from private.enrollment_credentials c join private.payment_mandates m on m.id=c.mandate_id
    where m.subscription_id=p_subscription order by c.id for share of c;
  perform 1 from private.checkout_policy_current for share;
end;
$$;
create function private.billing_notice_snapshot(p_subscription_id uuid,p_at timestamptz)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('subscription_id',s.id,'user_id',s.user_id,'artist_id',s.artist_id,
    'mandate_id',m.id,'checkout_policy_version',p.version,'period_start',s.current_period_end,
    'period_end',private.renewal_period_end(s.episode_started_at,s.current_period_end,p.billing_period_calendar),
    'billing_at',s.next_billing_at,'amount_krw',c.regular_price_krw,'currency','KRW',
    'due_at',private.billing_notice_due_at(s.next_billing_at,n.days_before,n.hour_kst),'mandatory',n.mandatory_inapp)
  from public.subscriptions s join public.artists a on a.id=s.artist_id
    join private.payment_mandates m on m.subscription_id=s.id and m.is_active
    join private.subscription_enrollments e on e.mandate_id=m.id and e.subscription_id=s.id and e.state='succeeded'
    join private.checkout_sessions c on c.id=e.session_id and c.user_id=s.user_id and c.artist_id=s.artist_id
    join private.checkout_policies p on p.version=c.policy_version
    join private.checkout_policy_current cp on cp.policy_version=p.version
    join private.renewal_policies r on r.checkout_policy_version=p.version
    join private.billing_notice_policies n on n.checkout_policy_version=p.version
  where s.id=p_subscription_id and s.status='active' and s.canceled_at is null and a.status='active'
    and private.billing_notice_actor_current(s.user_id,p_at)
    and s.next_billing_at=s.current_period_end and s.next_billing_at>p_at
    and m.provider=s.provider and m.consent_version=p.version::text
    and exists(select 1 from private.enrollment_credentials v where v.id=m.secure_credential_ref and v.mandate_id=m.id)
    and c.regular_price_krw=p.regular_price_krw and p.payment_tax_basis='taxable_krw'
    and p.approved_at<=p_at and p.published_at<=p_at and r.approved_at<=p_at and r.published_at<=p_at
    and n.approved_at<=p_at and n.published_at<=p_at
    and private.renewal_period_end(s.episode_started_at,s.current_period_end,p.billing_period_calendar) is not null
    and private.billing_notice_due_at(s.next_billing_at,n.days_before,n.hour_kst)
      <=s.next_billing_at-make_interval(secs=>r.notice_lead_seconds)
    and not exists(select 1 from private.billing_obligations o where o.subscription_id=s.id and o.state='open');
$$;
create function private.billing_notice_current(p_notice_id uuid,p_at timestamptz) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from private.billing_notices n where n.id=p_notice_id and n.invalidated_at is null
    and private.billing_notice_snapshot(n.subscription_id,p_at)=jsonb_build_object(
      'subscription_id',n.subscription_id,'user_id',n.user_id,'artist_id',n.artist_id,'mandate_id',n.mandate_id,
      'checkout_policy_version',n.checkout_policy_version,'period_start',n.period_start,'period_end',n.period_end,
      'billing_at',n.billing_at,'amount_krw',n.amount_krw,'currency',n.currency,'due_at',n.due_at,'mandatory',n.mandatory));
$$;

-- Dedicated source identity, never masquerading as a recognized payment event.
alter table private.notification_jobs add column billing_notice_id uuid references private.billing_notices(id) on delete restrict;
alter table private.notification_jobs drop constraint notification_jobs_source_kind_check;
alter table private.notification_jobs add constraint notification_jobs_source_kind_check
  check(source_kind in('message','payment','schedule','billing_notice'));
do $$declare constraint_name text; begin
  select conname into strict constraint_name from pg_constraint where conrelid='private.notification_jobs'::regclass
    and contype='c' and pg_get_constraintdef(oid) like '%message_id = source_id%';
  execute format('alter table private.notification_jobs drop constraint %I',constraint_name);
end$$;
alter table private.notification_jobs add constraint notification_jobs_typed_source_check check(
  (source_kind='message' and message_id=source_id and message_id is not null and payment_event_id is null
    and schedule_id is null and billing_notice_id is null and route_kind='artist_chat')
  or (source_kind='payment' and payment_event_id=source_id and payment_event_id is not null and message_id is null
    and schedule_id is null and billing_notice_id is null and route_kind='billing')
  or (source_kind='schedule' and (schedule_id=source_id or schedule_id is null) and message_id is null
    and payment_event_id is null and billing_notice_id is null and route_kind='schedule')
  or (source_kind='billing_notice' and billing_notice_id=source_id and billing_notice_id is not null
    and message_id is null and payment_event_id is null and schedule_id is null and route_kind='billing'));
create index notification_jobs_billing_notice_idx on private.notification_jobs(billing_notice_id) where billing_notice_id is not null;

create or replace function private.notification_source_artist(p_kind text,p_source uuid) returns uuid
language sql stable set search_path = '' as $$
  select artist_id from public.messages where p_kind='message' and id=p_source
  union all select s.artist_id from public.payment_events e join public.subscriptions s on s.id=e.subscription_id
    where p_kind='payment' and e.id=p_source
  union all select artist_id from public.schedules where p_kind='schedule' and id=p_source
  union all select artist_id from private.billing_notices where p_kind='billing_notice' and id=p_source;
$$;
create or replace function private.notification_eligible(p_kind text,p_source uuid,p_user uuid,p_device uuid,p_at timestamptz)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.notification_actor_eligible(p_user,p_at) and exists (
    select 1 from private.notification_preferences n join private.push_subscriptions d on d.user_id=n.user_id
      cross join private.notification_policy cfg
    where n.user_id=p_user and n.webpush_enabled and d.id=p_device and d.state='active'
      and cfg.webpush_enabled and d.consent_version=cfg.consent_version
      and case p_kind
        when 'message' then n.new_message and private.message_is_visible(p_user,p_source,false,p_at)
        when 'billing_notice' then n.billing and exists(select 1 from private.billing_notices b
          where b.id=p_source and b.user_id=p_user and private.billing_notice_current(b.id,p_at))
        when 'payment' then n.billing and exists (select 1 from public.payment_events e
          join private.payment_event_verifications v on v.event_id=e.id
          join public.subscriptions s on s.id=e.subscription_id
          where e.id=p_source and s.user_id=p_user)
        when 'schedule' then n.schedule and exists (select 1 from public.schedules s
          join public.artists a on a.id=s.artist_id where s.id=p_source and s.status='published'
            and a.status='active' and s.starts_at>p_at
            and private.has_subscription_access(p_user,s.artist_id,p_at)
            and not exists (select 1 from public.schedule_notification_optouts o
              where o.schedule_id=s.id and o.user_id=p_user))
        else false end);
$$;
create or replace function public.notification_set_preferences(p_webpush_enabled boolean,p_new_message boolean,
  p_billing boolean,p_schedule boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare locked_jobs uuid[];
begin
  perform 1 from public.profiles where id=auth.uid() for update;
  if not private.notification_actor_eligible(auth.uid(),clock_timestamp()) then
    raise exception 'NOTIFICATION_ACTOR_FORBIDDEN' using errcode='42501'; end if;
  if p_webpush_enabled is null or p_new_message is null or p_billing is null or p_schedule is null then
    raise exception 'NOTIFICATION_PREFERENCES_REQUIRED' using errcode='22004'; end if;
  insert into private.notification_preferences(user_id,webpush_enabled,new_message,billing,schedule)
    values(auth.uid(),p_webpush_enabled,p_new_message,p_billing,p_schedule)
    on conflict(user_id) do update set webpush_enabled=excluded.webpush_enabled,new_message=excluded.new_message,
      billing=excluded.billing,schedule=excluded.schedule,updated_at=clock_timestamp();
  -- Every multi-job mutation locks the complete affected active set in UUID
  -- order. Source-wide and device-wide cleanup sets can otherwise form cycles.
  select array_agg(locked.id order by locked.id) into locked_jobs from (
    select id from private.notification_jobs where user_id=auth.uid()
      and state in ('queued','retry_wait','leased','unknown') order by id for update
  ) locked;
  -- Enqueue intentionally does not lock the profile. Capture this locked set
  -- so a later READ COMMITTED snapshot cannot add a lower UUID out of order.
  -- Newly inserted work is suppressed by current preferences at claim time.
  -- Never claim recall of requests already outside the transaction.
  update private.notification_jobs set cancellation_requested_at=coalesce(cancellation_requested_at,clock_timestamp()),
    state=case when state in ('queued','retry_wait') then 'canceled' else state end
    where id=any(locked_jobs) and user_id=auth.uid() and state in ('queued','retry_wait','leased','unknown')
      and (not p_webpush_enabled or (source_kind='message' and not p_new_message)
        or (source_kind in('payment','billing_notice') and not p_billing) or (source_kind='schedule' and not p_schedule));
end;
$$;
create or replace function public.notification_claim(p_job_id uuid)
returns table(job_id uuid,lease_token uuid,lease_expires_at timestamptz,endpoint text,p256dh text,auth text,
  source_kind text,source_id uuid,route_kind text,route_id uuid)
language plpgsql security definer set search_path = '' as $$
declare j private.notification_jobs%rowtype; d private.push_subscriptions%rowtype; artist uuid; at_time timestamptz; schedule_due timestamptz;
begin
  perform private.require_notification_service();
  select * into j from private.notification_jobs where id=p_job_id;
  if j.id is null then return; end if;
  -- Authoritative serialization order matches existing identity, messaging and
  -- calendar RPCs. Never take a job lock before a source/eligibility lock.
  perform 1 from public.profiles where id=j.user_id for share;
  if j.source_kind='billing_notice' then perform private.billing_notice_lock_actor(j.user_id); end if;
  artist:=private.notification_source_artist(j.source_kind,j.source_id);
  perform 1 from public.artists where id=artist for share;
  perform 1 from public.subscriptions where user_id=j.user_id and artist_id=artist for share;
  if j.source_kind='message' then perform 1 from public.messages where id=j.source_id for share;
  elsif j.source_kind='payment' then perform 1 from public.payment_events where id=j.source_id for share;
  elsif j.source_kind='billing_notice' then
    perform private.billing_notice_lock_subscription((select subscription_id from private.billing_notices where id=j.source_id));
    perform 1 from private.billing_notices where id=j.source_id for share;
  else perform 1 from public.schedules where id=j.source_id for share; end if;
  perform 1 from private.notification_preferences where user_id=j.user_id for share;
  select * into d from private.push_subscriptions where id=j.device_id for share;
  -- Policy change/revocation serializes before claim, and runtime eligibility
  -- uses current consent, while attempt limits keep the original job snapshot.
  perform 1 from private.notification_policy for share;
  if j.source_kind='message' then perform 1 from private.message_policy for share; end if;
  select * into j from private.notification_jobs where id=p_job_id for update skip locked;
  if j.id is null then return; end if;
  at_time:=clock_timestamp();
  if j.state='leased' and j.lease_expires_at<=at_time then
    update private.notification_jobs set state='unknown' where id=j.id;
    update private.notification_attempts set state='unknown' where token=j.lease_token and state='leased';
    return; -- An old worker may still be running; NEVER hand its job to another.
  end if;
  if j.state not in ('queued','retry_wait') or j.next_attempt_at>at_time then return; end if;
  if j.cancellation_requested_at is not null or not private.notification_eligible(
    j.source_kind,j.source_id,j.user_id,j.device_id,at_time) then
    update private.notification_jobs set state='canceled',cancellation_requested_at=coalesce(cancellation_requested_at,at_time)
      where id=j.id; return;
  end if;
  if j.source_kind='schedule' then
    -- A source can be postponed while already leased; a later proven non-send
    -- must not retry on its obsolete reminder date. Re-evaluate the current
    -- schedule/policy under their locks, not only in the source update hook.
    select s.starts_at-make_interval(secs=>cfg.schedule_lead_seconds) into schedule_due
      from public.schedules s cross join private.notification_policy cfg where s.id=j.source_id;
    if schedule_due>at_time then
      update private.notification_jobs set next_attempt_at=greatest(next_attempt_at,schedule_due) where id=j.id;
      return;
    end if;
  end if;
  if j.attempt_count>=j.max_attempts then
    update private.notification_jobs set state='failed' where id=j.id; return; end if;
  update private.notification_jobs set state='leased',attempt_count=attempt_count+1,
    lease_token=gen_random_uuid(),lease_expires_at=at_time+make_interval(secs=>j.lease_seconds)
    where id=j.id returning * into j;
  insert into private.notification_attempts(job_id,ordinal,token,state,lease_expires_at)
    values(j.id,j.attempt_count,j.lease_token,'leased',j.lease_expires_at);
  return query select j.id,j.lease_token,j.lease_expires_at,d.endpoint,d.p256dh,d.auth,
    j.source_kind,j.source_id,j.route_kind,j.route_id;
end;
$$;
create or replace function private.webpush_lock_job(p_job_id uuid) returns private.notification_jobs
language plpgsql set search_path='' as $$
declare j private.notification_jobs%rowtype; artist uuid; session_id uuid;
begin
  select * into j from private.notification_jobs where id=p_job_id;
  if j.id is null then return j; end if;
  perform 1 from public.profiles where id=j.user_id for share;
  if j.source_kind='billing_notice' then perform private.billing_notice_lock_actor(j.user_id); end if;
  artist:=private.notification_source_artist(j.source_kind,j.source_id);
  perform 1 from public.artists where id=artist for share;
  perform 1 from public.subscriptions where user_id=j.user_id and artist_id=artist for share;
  if j.source_kind='message' then perform 1 from public.messages where id=j.source_id for share;
  elsif j.source_kind='payment' then perform 1 from public.payment_events where id=j.source_id for share;
  elsif j.source_kind='billing_notice' then
    perform private.billing_notice_lock_subscription((select subscription_id from private.billing_notices where id=j.source_id));
    perform 1 from private.billing_notices where id=j.source_id for share;
  else perform 1 from public.schedules where id=j.source_id for share; end if;
  perform 1 from private.notification_preferences where user_id=j.user_id for share;
  select d.auth_session_id into session_id from private.push_subscriptions d where d.id=j.device_id;
  perform 1 from auth.sessions where id=session_id and user_id=j.user_id for share;
  perform 1 from private.push_subscriptions where id=j.device_id for share;
  perform 1 from private.notification_policy for share;
  if j.source_kind='message' then perform 1 from private.message_policy for share; end if;
  select * into j from private.notification_jobs where id=p_job_id for update;
  return j;
end;
$$;
create or replace function private.webpush_job_eligible(p_job private.notification_jobs,p_at timestamptz)
returns boolean language sql stable set search_path='' as $$
  select p_job.source_kind in('message','billing_notice') and p_job.cancellation_requested_at is null and private.notification_eligible(
    p_job.source_kind,p_job.source_id,p_job.user_id,p_job.device_id,p_at)
    and exists(select 1 from private.push_subscriptions d cross join private.notification_policy cfg
      where d.id=p_job.device_id and cfg.lease_seconds>=10
        and private.webpush_session_active(p_job.user_id,d.auth_session_id,p_at))
    and (p_job.source_kind<>'schedule' or exists(select 1 from public.schedules s
      cross join private.notification_policy cfg where s.id=p_job.source_id
        and s.starts_at-make_interval(secs=>cfg.schedule_lead_seconds)<=p_at));
$$;
create or replace function public.webpush_recover_expired(p_job_id uuid,p_token uuid) returns text
language plpgsql security definer set search_path='' as $$
declare j private.notification_jobs%rowtype; at_time timestamptz; retry_at timestamptz;
begin
  perform private.require_notification_service();
  j:=private.webpush_lock_job(p_job_id); at_time:=clock_timestamp();
  if j.id is null then return 'missing'; end if;
  if j.source_kind not in('message','billing_notice') then return j.state; end if;
  if p_token is null or j.lease_token is distinct from p_token or j.state not in('leased','unknown') then return j.state; end if;
  -- Preserve the old DB-only uncertain contract for unbound historical rows.
  if not exists(select 1 from private.push_subscriptions where id=j.device_id and auth_session_id is not null) then return j.state; end if;
  if j.lease_expires_at>at_time then return j.state; end if;
  if not private.webpush_job_eligible(j,at_time) then
    perform private.webpush_cancel_locked_job(j); return 'canceled'; end if;
  retry_at:=greatest(j.next_attempt_at,j.lease_expires_at+make_interval(secs=>private.webpush_retry_seconds(j)));
  if retry_at>at_time then return j.state; end if;
  update private.notification_attempts set state='unknown',finished_at=at_time where token=j.lease_token and state in('leased','unknown');
  if j.attempt_count>=j.max_attempts then
    update private.notification_jobs set state='failed' where id=j.id; return 'failed'; end if;
  update private.notification_jobs set state='retry_wait',next_attempt_at=at_time where id=j.id;
  return 'retry_wait';
end;
$$;
create or replace function public.webpush_list_due(p_limit integer default 100) returns table(id uuid)
language plpgsql security definer set search_path='' as $$
begin
  perform private.require_notification_service();
  if p_limit is null or p_limit not between 1 and 100 then
    raise exception 'NOTIFICATION_LIMIT_INVALID' using errcode='22023'; end if;
  return query select j.id from private.notification_jobs j join private.push_subscriptions d on d.id=j.device_id
    where j.source_kind in('message','billing_notice') and d.auth_session_id is not null
      and j.state in('queued','retry_wait') and j.next_attempt_at<=clock_timestamp()
    order by j.next_attempt_at,j.id limit p_limit;
end;
$$;
create or replace function public.webpush_list_uncertain(p_limit integer default 100)
returns table(job_id uuid,lease_token uuid,lease_expires_at timestamptz,cancellation_requested_at timestamptz)
language plpgsql security definer set search_path='' as $$
begin
  perform private.require_notification_service();
  if p_limit is null or p_limit not between 1 and 100 then
    raise exception 'NOTIFICATION_LIMIT_INVALID' using errcode='22023'; end if;
  return query select j.id,j.lease_token,j.lease_expires_at,j.cancellation_requested_at
    from private.notification_jobs j join private.push_subscriptions d on d.id=j.device_id
    where j.source_kind in('message','billing_notice') and d.auth_session_id is not null and j.state in('leased','unknown')
      and greatest(j.next_attempt_at,j.lease_expires_at+make_interval(secs=>private.webpush_retry_seconds(j)))<=clock_timestamp()
    order by j.lease_expires_at,j.id limit p_limit;
end;
$$;

create function private.billing_notice_enqueue(p_notice_id uuid) returns integer
language plpgsql set search_path='' as $$
declare cfg private.notification_policy%rowtype; n private.billing_notices%rowtype; affected integer;
begin
  select * into n from private.billing_notices where id=p_notice_id;
  select * into cfg from private.notification_policy;
  if n.id is null or cfg.singleton is null or not cfg.webpush_enabled then return 0; end if;
  insert into private.notification_jobs(source_kind,source_id,billing_notice_id,user_id,device_id,route_kind,route_id,
    next_attempt_at,max_attempts,retry_seconds,lease_seconds,policy_version)
  select 'billing_notice',n.id,n.id,n.user_id,d.id,'billing',n.subscription_id,
    clock_timestamp(),cfg.max_attempts,cfg.retry_seconds,cfg.lease_seconds,cfg.version
    from private.push_subscriptions d where d.user_id=n.user_id
      and private.notification_eligible('billing_notice',n.id,n.user_id,d.id,clock_timestamp())
      and private.webpush_session_active(n.user_id,d.auth_session_id,clock_timestamp())
    on conflict(source_kind,source_id,channel,user_id,device_id) do nothing;
  get diagnostics affected=row_count;
  return affected;
end;
$$;
create function public.billing_notice_candidates(p_limit integer default 20) returns table(subscription_id uuid)
language plpgsql security definer set search_path='' as $$
declare cursor_id uuid; selected uuid[];
begin
  perform private.require_notification_service();
  if p_limit is null or p_limit not between 1 and 20 then raise exception 'BILLING_NOTICE_LIMIT_INVALID' using errcode='22023'; end if;
  insert into private.billing_notice_scan_cursor(singleton) values(true) on conflict(singleton) do nothing;
  select last_subscription_id into cursor_id from private.billing_notice_scan_cursor where singleton for update;
  select array_agg(q.id order by (cursor_id is null or q.id>cursor_id) desc,q.id) into selected from (
    select s.id from public.subscriptions s
      cross join lateral (select private.billing_notice_snapshot(s.id,statement_timestamp()) as value) d
      where s.status='active' and s.next_billing_at>statement_timestamp()
        and (d.value->>'due_at')::timestamptz<=statement_timestamp()
        and ((d.value->>'mandatory')::boolean or exists(select 1 from private.notification_preferences n where n.user_id=s.user_id and n.billing))
        and not exists(select 1 from private.billing_notices n where n.subscription_id=s.id and n.period_start=s.current_period_end)
      order by (cursor_id is null or s.id>cursor_id) desc,s.id limit p_limit
  ) q;
  if cardinality(selected)>0 then
    update private.billing_notice_scan_cursor set last_subscription_id=selected[cardinality(selected)] where singleton;
  end if;
  return query select unnest(coalesce(selected,'{}'::uuid[]));
end;
$$;
create function public.billing_notice_create(p_subscription_id uuid)
returns table(notice_id uuid,created boolean,push_jobs integer)
language plpgsql security definer set search_path='' as $$
declare s public.subscriptions%rowtype; data jsonb; n private.billing_notices%rowtype; inserted boolean; jobs integer; at_time timestamptz;
begin
  perform private.require_notification_service();
  select * into s from public.subscriptions where id=p_subscription_id;
  if s.id is null then return; end if;
  perform 1 from public.profiles where id=s.user_id for share;
  perform private.billing_notice_lock_actor(s.user_id);
  perform 1 from public.artists where id=s.artist_id for share;
  select * into s from public.subscriptions where id=s.id for update;
  perform private.billing_notice_lock_subscription(s.id);
  perform 1 from private.notification_preferences where user_id=s.user_id for share;
  perform 1 from private.notification_policy for share;
  at_time:=clock_timestamp(); data:=private.billing_notice_snapshot(s.id,at_time);
  if data is null or (data->>'due_at')::timestamptz>at_time
    or (not (data->>'mandatory')::boolean and not exists(select 1 from private.notification_preferences where user_id=s.user_id and billing)) then return; end if;
  insert into private.billing_notices(subscription_id,user_id,artist_id,mandate_id,checkout_policy_version,
    period_start,period_end,billing_at,amount_krw,currency,due_at,mandatory,created_at)
  values(s.id,s.user_id,s.artist_id,(data->>'mandate_id')::uuid,(data->>'checkout_policy_version')::uuid,
    (data->>'period_start')::timestamptz,(data->>'period_end')::timestamptz,(data->>'billing_at')::timestamptz,
    (data->>'amount_krw')::integer,'KRW',(data->>'due_at')::timestamptz,(data->>'mandatory')::boolean,at_time)
    on conflict(subscription_id,period_start) do nothing returning * into n;
  inserted:=n.id is not null;
  if not inserted then select * into n from private.billing_notices where subscription_id=s.id and period_start=s.current_period_end; end if;
  if not private.billing_notice_current(n.id,clock_timestamp()) then return; end if;
  -- Inbox commit and deduplicated channel jobs are one transaction. No delivery
  -- or read evidence is synthesized by either write.
  jobs:=private.billing_notice_enqueue(n.id);
  return query select n.id,inserted,jobs;
end;
$$;
create function public.billing_notice_list(p_limit integer default 51,p_before_created_at timestamptz default null,p_before_id uuid default null)
returns table(id uuid,subscription_id uuid,artist_name text,amount_krw integer,currency text,billing_at timestamptz,
  created_at timestamptz,read_at timestamptz,mandatory boolean)
language plpgsql stable security definer set search_path='' as $$
begin
  if not private.notification_actor_eligible(auth.uid(),statement_timestamp()) then
    raise exception 'NOTIFICATION_ACTOR_FORBIDDEN' using errcode='42501'; end if;
  if p_limit is null or p_limit not between 1 and 51 then raise exception 'BILLING_NOTICE_LIMIT_INVALID' using errcode='22023'; end if;
  if (p_before_created_at is null)<>(p_before_id is null) or (p_before_created_at is not null and not isfinite(p_before_created_at)) then
    raise exception 'BILLING_NOTICE_CURSOR_INVALID' using errcode='22023'; end if;
  return query select n.id,n.subscription_id,a.name,n.amount_krw,n.currency,n.billing_at,n.created_at,n.read_at,n.mandatory
    from private.billing_notices n join public.artists a on a.id=n.artist_id
    where n.user_id=auth.uid() and private.billing_notice_current(n.id,statement_timestamp())
      and (n.mandatory or exists(select 1 from private.notification_preferences pref where pref.user_id=n.user_id and pref.billing))
      and (p_before_created_at is null or (n.created_at,n.id)<(p_before_created_at,p_before_id))
    order by n.created_at desc,n.id desc limit p_limit;
end;
$$;
create function public.billing_notice_mark_read(p_notice_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare n private.billing_notices%rowtype; at_time timestamptz;
begin
  perform 1 from public.profiles where id=auth.uid() for share;
  if not private.notification_actor_eligible(auth.uid(),clock_timestamp()) then
    raise exception 'NOTIFICATION_ACTOR_FORBIDDEN' using errcode='42501'; end if;
  perform private.billing_notice_lock_actor(auth.uid());
  select * into n from private.billing_notices where id=p_notice_id and user_id=auth.uid();
  if n.id is null then raise exception 'BILLING_NOTICE_NOT_FOUND' using errcode='P0002'; end if;
  perform 1 from public.artists where id=n.artist_id for share;
  perform 1 from public.subscriptions where id=n.subscription_id for share;
  perform private.billing_notice_lock_subscription(n.subscription_id);
  select * into n from private.billing_notices where id=n.id for update;
  at_time:=clock_timestamp();
  if not private.billing_notice_current(n.id,at_time) or (not n.mandatory and not exists(
    select 1 from private.notification_preferences where user_id=n.user_id and billing)) then
    raise exception 'BILLING_NOTICE_NOT_FOUND' using errcode='P0002'; end if;
  update private.billing_notices set read_at=coalesce(read_at,at_time) where id=n.id;
end;
$$;
create function public.billing_notice_preferences() returns table(billing_enabled boolean)
language plpgsql stable security definer set search_path='' as $$
begin
  if not private.notification_actor_eligible(auth.uid(),statement_timestamp()) then
    raise exception 'NOTIFICATION_ACTOR_FORBIDDEN' using errcode='42501'; end if;
  return query select coalesce((select billing from private.notification_preferences where user_id=auth.uid()),false);
end;
$$;
create function public.billing_notice_set_preference(p_enabled boolean) returns table(billing_enabled boolean)
language plpgsql security definer set search_path='' as $$
declare pref private.notification_preferences%rowtype;
begin
  perform 1 from public.profiles where id=auth.uid() for update;
  if p_enabled is null then raise exception 'NOTIFICATION_PREFERENCES_REQUIRED' using errcode='22004'; end if;
  select * into pref from private.notification_preferences where user_id=auth.uid();
  perform public.notification_set_preferences(coalesce(pref.webpush_enabled,false),coalesce(pref.new_message,false),p_enabled,coalesce(pref.schedule,false));
  return query select p_enabled;
end;
$$;

create function private.billing_notice_subscription_changed() returns trigger
language plpgsql security definer set search_path='' as $$
declare n record; at_time timestamptz:=clock_timestamp();
begin
  if row(new.status,new.canceled_at,new.next_billing_at,new.current_period_start,new.current_period_end,new.episode_started_at,new.provider)
    is not distinct from row(old.status,old.canceled_at,old.next_billing_at,old.current_period_start,old.current_period_end,old.episode_started_at,old.provider) then return new; end if;
  for n in select id from private.billing_notices where subscription_id=new.id and invalidated_at is null order by id for update loop
    update private.billing_notices set invalidated_at=greatest(at_time,created_at) where id=n.id;
    perform private.notification_cancel_source('billing_notice',n.id);
  end loop;
  return new;
end;
$$;
create trigger billing_notice_subscription_changed after update of status,canceled_at,next_billing_at,current_period_start,current_period_end,episode_started_at,provider
  on public.subscriptions for each row execute function private.billing_notice_subscription_changed();

-- One safe source discriminator only; no financial details or arbitrary URL.
drop function public.webpush_prepare_delivery(uuid,uuid);
create function public.webpush_prepare_delivery(p_job_id uuid,p_token uuid)
returns table(job_id uuid,lease_token uuid,lease_expires_at timestamptz,endpoint text,p256dh text,auth text,source_kind text)
language plpgsql security definer set search_path='' as $$
declare j private.notification_jobs%rowtype; at_time timestamptz;
begin
  perform private.require_notification_service();
  j:=private.webpush_lock_job(p_job_id); at_time:=clock_timestamp();
  if j.id is null or p_token is null or j.lease_token is distinct from p_token or j.state<>'leased' then return; end if;
  if exists(select 1 from private.notification_attempts where token=p_token and delivery_prepared_at is not null) then return; end if;
  if not private.webpush_job_eligible(j,at_time) then
    perform private.webpush_cancel_locked_job(j); return; end if;
  -- The HTTP adapter is bounded to <=4 seconds; leave >5 seconds in the DB
  -- lease. A delayed process must still check its deadline before network I/O.
  if j.lease_seconds<10 or j.lease_expires_at<=at_time+interval '5 seconds' then return; end if;
  update private.notification_attempts set delivery_prepared_at=at_time where token=p_token;
  return query select j.id,j.lease_token,j.lease_expires_at,d.endpoint,d.p256dh,d.auth,j.source_kind
    from private.push_subscriptions d where d.id=j.device_id;
end;
$$;

do $$declare fn regprocedure; begin
  for fn in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname in('public','private') and p.proname like 'billing_notice\_%' escape '\'
  loop execute format('revoke all on function %s from public,anon,authenticated,service_role',fn); end loop;
end$$;
revoke all on function public.webpush_prepare_delivery(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.webpush_prepare_delivery(uuid,uuid) to service_role;
grant execute on function public.billing_notice_candidates(integer),public.billing_notice_create(uuid) to service_role;
grant execute on function public.billing_notice_list(integer,timestamptz,uuid),public.billing_notice_mark_read(uuid),
  public.billing_notice_preferences(),public.billing_notice_set_preference(boolean) to authenticated;
comment on table private.billing_notice_policies is
  'Explicit immutable KST timing and in-app preference treatment for exactly one approved checkout/renewal policy. Mandatory means this approved product delivery choice only, never a legal-compliance assertion. No runtime policy is seeded.';
comment on table private.billing_notices is
  'Actual authenticated in-app inbox snapshots. One identity per subscription/period. Creation, read marking and provider acceptance do NOT write renewal_notice_receipts or prove verified delivery. Financial secrets never appear here.';
comment on function public.billing_notice_mark_read(uuid) is
  'Owner-requested read marker only; not proven human comprehension, verified delivery or authority to charge. Existing renewal external-evidence gate is unchanged.';
commit;
