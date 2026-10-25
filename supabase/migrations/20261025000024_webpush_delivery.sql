-- Session-bound browser opt-in and delivery fences. No policy is activated,
-- endpoint contacted, VAPID key generated, or recurring worker installed here.
begin;

alter table private.push_subscriptions add column auth_session_id uuid;
alter table private.notification_attempts add column delivery_prepared_at timestamptz;
alter table private.notification_attempts add column retry_after_seconds integer check (retry_after_seconds between 0 and 86400);
alter table private.notification_attempts add column retry_not_before timestamptz check (isfinite(retry_not_before));
alter table private.notification_attempts add column retry_outcome text check (retry_outcome in('not_sent','unknown'));
alter table private.notification_attempts add constraint notification_attempt_retry_snapshot
  check ((retry_not_before is null)=(retry_outcome is null));
create index push_subscriptions_session_idx on private.push_subscriptions(user_id,auth_session_id,id);
-- No FK: Auth removes sessions on sign-out, while notification audit identities
-- must remain. Missing/expired sessions fail closed at the delivery boundary.

create function private.webpush_session_active(p_user uuid,p_session uuid,p_at timestamptz)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from auth.sessions s where s.id=p_session and s.user_id=p_user
    and (s.not_after is null or s.not_after>p_at));
$$;
create function private.webpush_require_session(p_user uuid,p_session uuid) returns void
language plpgsql set search_path='' as $$
begin
  perform 1 from auth.sessions where id=p_session and user_id=p_user for share;
  if not private.webpush_session_active(p_user,p_session,clock_timestamp()) then
    raise exception 'WEBPUSH_SESSION_REQUIRED' using errcode='42501'; end if;
end;
$$;
create function private.webpush_cancel_devices(p_user uuid,p_devices uuid[]) returns integer
language plpgsql set search_path='' as $$
declare affected integer;
begin
  perform 1 from private.push_subscriptions where user_id=p_user and id=any(p_devices) order by id for update;
  update private.push_subscriptions set state=case when state='dead' then state else 'revoked' end,
    revoked_at=coalesce(revoked_at,clock_timestamp()) where user_id=p_user and id=any(p_devices) and state='active';
  get diagnostics affected=row_count;
  perform 1 from private.notification_jobs where user_id=p_user and device_id=any(p_devices)
    and state in('queued','retry_wait','leased','unknown') order by id for update;
  update private.notification_jobs set cancellation_requested_at=coalesce(cancellation_requested_at,clock_timestamp()),
    state=case when state in('queued','retry_wait') then 'canceled' else state end
    where user_id=p_user and device_id=any(p_devices) and state in('queued','retry_wait','leased','unknown');
  return affected;
end;
$$;

create function private.webpush_device_status(p_actor_id uuid,p_auth_session_id uuid,p_endpoint text default null)
returns table(configured boolean,consent_version text,webpush_enabled boolean,new_message boolean,device_id uuid,device_active boolean)
language plpgsql security definer set search_path='' as $$
begin
  perform 1 from public.profiles where id=p_actor_id for share;
  perform private.webpush_require_session(p_actor_id,p_auth_session_id);
  if p_endpoint is not null and length(p_endpoint)>2048 then
    raise exception 'WEBPUSH_ENDPOINT_INVALID' using errcode='22023'; end if;
  return query select coalesce(cfg.webpush_enabled and cfg.lease_seconds>=10,false),cfg.consent_version,
    coalesce(n.webpush_enabled,false),coalesce(n.new_message,false),d.id,
    coalesce(d.state='active' and d.auth_session_id=p_auth_session_id and d.consent_version=cfg.consent_version
      and cfg.webpush_enabled and cfg.lease_seconds>=10 and n.webpush_enabled and n.new_message
      and private.notification_actor_eligible(p_actor_id,clock_timestamp()),false)
    from (select p_actor_id as id) u
    left join private.notification_policy cfg on true
    left join private.notification_preferences n on n.user_id=u.id
    left join private.push_subscriptions d on d.user_id=u.id and d.endpoint=p_endpoint;
end;
$$;

create function public.webpush_device_status(p_actor_id uuid,p_auth_session_id uuid,p_endpoint text default null)
returns table(configured boolean,consent_version text,webpush_enabled boolean,new_message boolean,device_id uuid,device_active boolean)
language plpgsql security definer set search_path='' as $$
begin
  perform private.require_notification_service();
  return query select * from private.webpush_device_status(p_actor_id,p_auth_session_id,p_endpoint);
end;
$$;
create function public.webpush_current_status(p_endpoint text default null)
returns table(configured boolean,consent_version text,webpush_enabled boolean,new_message boolean,device_id uuid,device_active boolean)
language plpgsql security definer set search_path='' as $$
declare actor uuid; session_id uuid;
begin
  actor:=auth.uid();
  begin session_id:=nullif(auth.jwt()->>'session_id','')::uuid;
  exception when invalid_text_representation then
    raise exception 'WEBPUSH_SESSION_REQUIRED' using errcode='42501'; end;
  if actor is null or session_id is null then
    raise exception 'WEBPUSH_SESSION_REQUIRED' using errcode='42501'; end if;
  return query select * from private.webpush_device_status(actor,session_id,p_endpoint);
end;
$$;

create function public.webpush_register_device(p_actor_id uuid,p_auth_session_id uuid,p_endpoint text,
  p_p256dh text,p_auth text,p_consent_version text) returns uuid
language plpgsql security definer set search_path='' as $$
declare d private.push_subscriptions%rowtype; cfg private.notification_policy%rowtype;
begin
  perform private.require_notification_service();
  -- UPDATE serializes parallel registrations with preferences/session revocation
  -- and enforces the structural active-device bound without a counting race.
  perform 1 from public.profiles where id=p_actor_id for update;
  if not private.notification_actor_eligible(p_actor_id,clock_timestamp()) then
    raise exception 'NOTIFICATION_ACTOR_FORBIDDEN' using errcode='42501'; end if;
  perform private.webpush_require_session(p_actor_id,p_auth_session_id);
  select * into cfg from private.notification_policy for share;
  if cfg.singleton is null or not cfg.webpush_enabled or cfg.lease_seconds<10
    or p_consent_version is distinct from cfg.consent_version then
    raise exception 'NOTIFICATION_CONSENT_REQUIRED' using errcode='55000'; end if;
  select * into d from private.push_subscriptions where endpoint=p_endpoint for update;
  if d.id is not null and (d.user_id<>p_actor_id or d.p256dh is distinct from p_p256dh or d.auth is distinct from p_auth) then
    raise exception 'NOTIFICATION_DEVICE_CONFLICT' using errcode='23514'; end if;
  if d.state='dead' then raise exception 'NOTIFICATION_DEVICE_INACTIVE' using errcode='55000'; end if;
  if (d.id is null or d.state<>'active') and (select count(*) from private.push_subscriptions
    where user_id=p_actor_id and state='active')>=10 then
    raise exception 'WEBPUSH_DEVICE_LIMIT' using errcode='54000'; end if;
  -- Insert conflict is checked again: different actors lock different profiles.
  insert into private.push_subscriptions(user_id,endpoint,p256dh,auth,consent_version,auth_session_id)
    values(p_actor_id,p_endpoint,p_p256dh,p_auth,p_consent_version,p_auth_session_id)
    on conflict(endpoint) do nothing;
  select * into strict d from private.push_subscriptions where endpoint=p_endpoint for update;
  if d.user_id<>p_actor_id or d.p256dh is distinct from p_p256dh or d.auth is distinct from p_auth then
    raise exception 'NOTIFICATION_DEVICE_CONFLICT' using errcode='23514'; end if;
  if d.state='dead' then raise exception 'NOTIFICATION_DEVICE_INACTIVE' using errcode='55000'; end if;
  if d.auth_session_id is distinct from p_auth_session_id or d.consent_version is distinct from p_consent_version then
    -- Old outbox rows are not retroactively reconsented to the new session.
    perform private.webpush_cancel_devices(p_actor_id,array[d.id]);
  end if;
  update private.push_subscriptions set auth_session_id=p_auth_session_id,consent_version=p_consent_version,
    consented_at=case when state<>'active' or auth_session_id is distinct from p_auth_session_id
      or consent_version is distinct from p_consent_version then clock_timestamp() else consented_at end,
    state='active',revoked_at=null where id=d.id;
  insert into private.notification_preferences(user_id,webpush_enabled,new_message,billing,schedule)
    values(p_actor_id,true,true,false,false) on conflict(user_id) do update
      set webpush_enabled=true,new_message=true,updated_at=clock_timestamp();
  return d.id;
end;
$$;

create function public.webpush_revoke_device(p_actor_id uuid,p_auth_session_id uuid,p_endpoint text) returns void
language plpgsql security definer set search_path='' as $$
declare devices uuid[];
begin
  perform private.require_notification_service();
  perform 1 from public.profiles where id=p_actor_id for update;
  perform private.webpush_require_session(p_actor_id,p_auth_session_id);
  if p_endpoint is null or length(p_endpoint)>2048 then
    raise exception 'WEBPUSH_ENDPOINT_INVALID' using errcode='22023'; end if;
  select array_agg(id) into devices from private.push_subscriptions
    where user_id=p_actor_id and endpoint=p_endpoint;
  -- Same-owner prior-session endpoints may be disabled, never another owner's.
  -- Missing/foreign endpoint is an idempotent no-op, not an ownership oracle.
  perform private.webpush_cancel_devices(p_actor_id,coalesce(devices,'{}'::uuid[]));
end;
$$;

create function public.webpush_revoke_session() returns integer
language plpgsql security definer set search_path='' as $$
declare actor uuid; session_id uuid; devices uuid[];
begin
  actor:=auth.uid();
  begin session_id:=nullif(auth.jwt()->>'session_id','')::uuid;
  exception when invalid_text_representation then
    raise exception 'WEBPUSH_SESSION_REQUIRED' using errcode='42501'; end;
  if actor is null or session_id is null then
    raise exception 'WEBPUSH_SESSION_REQUIRED' using errcode='42501'; end if;
  perform 1 from public.profiles where id=actor for update;
  -- No policy, fan eligibility, service secret or surviving Auth row is needed
  -- to opt out during logout; JWT identity bounds every affected row.
  select array_agg(id order by id) into devices from private.push_subscriptions
    where user_id=actor and auth_session_id=session_id;
  return private.webpush_cancel_devices(actor,coalesce(devices,'{}'::uuid[]));
end;
$$;

create function public.webpush_revoke_current_device(p_endpoint text) returns void
language plpgsql security definer set search_path='' as $$
declare actor uuid; session_id uuid; devices uuid[];
begin
  actor:=auth.uid();
  begin session_id:=nullif(auth.jwt()->>'session_id','')::uuid;
  exception when invalid_text_representation then
    raise exception 'WEBPUSH_SESSION_REQUIRED' using errcode='42501'; end;
  if actor is null or session_id is null then
    raise exception 'WEBPUSH_SESSION_REQUIRED' using errcode='42501'; end if;
  if p_endpoint is null or length(p_endpoint)>2048 then
    raise exception 'WEBPUSH_ENDPOINT_INVALID' using errcode='22023'; end if;
  perform 1 from public.profiles where id=actor for update;
  select array_agg(id) into devices from private.push_subscriptions where user_id=actor and endpoint=p_endpoint;
  perform private.webpush_cancel_devices(actor,coalesce(devices,'{}'::uuid[]));
end;
$$;

create function private.webpush_lock_job(p_job_id uuid) returns private.notification_jobs
language plpgsql set search_path='' as $$
declare j private.notification_jobs%rowtype; artist uuid; session_id uuid;
begin
  select * into j from private.notification_jobs where id=p_job_id;
  if j.id is null then return j; end if;
  perform 1 from public.profiles where id=j.user_id for share;
  artist:=private.notification_source_artist(j.source_kind,j.source_id);
  perform 1 from public.artists where id=artist for share;
  perform 1 from public.subscriptions where user_id=j.user_id and artist_id=artist for share;
  if j.source_kind='message' then perform 1 from public.messages where id=j.source_id for share;
  elsif j.source_kind='payment' then perform 1 from public.payment_events where id=j.source_id for share;
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
create function private.webpush_job_eligible(p_job private.notification_jobs,p_at timestamptz)
returns boolean language sql stable set search_path='' as $$
  select p_job.source_kind='message' and p_job.cancellation_requested_at is null and private.notification_eligible(
    p_job.source_kind,p_job.source_id,p_job.user_id,p_job.device_id,p_at)
    and exists(select 1 from private.push_subscriptions d cross join private.notification_policy cfg
      where d.id=p_job.device_id and cfg.lease_seconds>=10
        and private.webpush_session_active(p_job.user_id,d.auth_session_id,p_at))
    and (p_job.source_kind<>'schedule' or exists(select 1 from public.schedules s
      cross join private.notification_policy cfg where s.id=p_job.source_id
        and s.starts_at-make_interval(secs=>cfg.schedule_lead_seconds)<=p_at));
$$;
create function private.webpush_cancel_locked_job(p_job private.notification_jobs) returns void
language plpgsql set search_path='' as $$
begin
  update private.notification_jobs set state='canceled',
    cancellation_requested_at=coalesce(cancellation_requested_at,clock_timestamp()) where id=p_job.id;
  update private.notification_attempts set state=case when delivery_prepared_at is null and state='leased' then 'not_sent' else 'unknown' end,
    evidence_ref=case when delivery_prepared_at is null and state='leased' then gen_random_uuid() else evidence_ref end,
    finished_at=clock_timestamp() where token=p_job.lease_token and state in('leased','unknown');
end;
$$;

create function public.webpush_prepare_delivery(p_job_id uuid,p_token uuid)
returns table(job_id uuid,lease_token uuid,lease_expires_at timestamptz,endpoint text,p256dh text,auth text)
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
  return query select j.id,j.lease_token,j.lease_expires_at,d.endpoint,d.p256dh,d.auth
    from private.push_subscriptions d where d.id=j.device_id;
end;
$$;

create function private.webpush_retry_seconds(p_job private.notification_jobs) returns integer
language sql immutable set search_path='' as $$
  select least(86400,p_job.retry_seconds*power(2,greatest(0,p_job.attempt_count-1)))::integer;
$$;
create function public.webpush_complete(p_job_id uuid,p_token uuid,p_outcome text,p_evidence_ref uuid,
  p_retry_after_seconds integer default null)
returns text language plpgsql security definer set search_path='' as $$
declare result text; j private.notification_jobs%rowtype; a private.notification_attempts%rowtype; retry_at timestamptz;
begin
  perform private.require_notification_service();
  if p_retry_after_seconds is not null and p_retry_after_seconds not between 0 and 86400 then
    raise exception 'WEBPUSH_RETRY_AFTER_INVALID' using errcode='22023'; end if;
  -- Legacy completion takes the canonical device/job locks and validates
  -- evidence, replay, ordered dead-endpoint cleanup and stale-token fencing.
  result:=public.notification_complete(p_job_id,p_token,p_outcome,p_evidence_ref);
  if result not in('retry_wait','unknown') then return result; end if;
  select * into j from private.notification_jobs where id=p_job_id;
  select * into a from private.notification_attempts where token=p_token;
  -- Persist the outcome's first retry decision under those locks. Neither an
  -- ordinary replay nor a concurrent same-token replay can move its deadline.
  if a.retry_outcome is not distinct from p_outcome then return result; end if;
  retry_at:=greatest(a.retry_not_before,
    (case when result='unknown' then j.lease_expires_at else a.finished_at end)
      +make_interval(secs=>greatest(private.webpush_retry_seconds(j),coalesce(p_retry_after_seconds,0))));
  update private.notification_attempts set retry_outcome=p_outcome,
    retry_after_seconds=p_retry_after_seconds,retry_not_before=retry_at where token=p_token;
  update private.notification_jobs set next_attempt_at=retry_at where id=j.id;
  return result;
end;
$$;

create function public.webpush_recover_expired(p_job_id uuid,p_token uuid) returns text
language plpgsql security definer set search_path='' as $$
declare j private.notification_jobs%rowtype; at_time timestamptz; retry_at timestamptz;
begin
  perform private.require_notification_service();
  j:=private.webpush_lock_job(p_job_id); at_time:=clock_timestamp();
  if j.id is null then return 'missing'; end if;
  if j.source_kind<>'message' then return j.state; end if;
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

create function public.webpush_list_due(p_limit integer default 100) returns table(id uuid)
language plpgsql security definer set search_path='' as $$
begin
  perform private.require_notification_service();
  if p_limit is null or p_limit not between 1 and 100 then
    raise exception 'NOTIFICATION_LIMIT_INVALID' using errcode='22023'; end if;
  return query select j.id from private.notification_jobs j join private.push_subscriptions d on d.id=j.device_id
    where j.source_kind='message' and d.auth_session_id is not null
      and j.state in('queued','retry_wait') and j.next_attempt_at<=clock_timestamp()
    order by j.next_attempt_at,j.id limit p_limit;
end;
$$;
create function public.webpush_list_uncertain(p_limit integer default 100)
returns table(job_id uuid,lease_token uuid,lease_expires_at timestamptz,cancellation_requested_at timestamptz)
language plpgsql security definer set search_path='' as $$
begin
  perform private.require_notification_service();
  if p_limit is null or p_limit not between 1 and 100 then
    raise exception 'NOTIFICATION_LIMIT_INVALID' using errcode='22023'; end if;
  return query select j.id,j.lease_token,j.lease_expires_at,j.cancellation_requested_at
    from private.notification_jobs j join private.push_subscriptions d on d.id=j.device_id
    where j.source_kind='message' and d.auth_session_id is not null and j.state in('leased','unknown')
      and greatest(j.next_attempt_at,j.lease_expires_at+make_interval(secs=>private.webpush_retry_seconds(j)))<=clock_timestamp()
    order by j.lease_expires_at,j.id limit p_limit;
end;
$$;

-- Do not change the legacy capability RPC into proof of VAPID/readiness. The
-- application combines this new status API with actual server adapter config.
do $$
declare fn regprocedure;
begin
  for fn in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname in('public','private') and p.proname like 'webpush\_%' escape '\'
  loop execute format('revoke all on function %s from public,anon,authenticated,service_role',fn); end loop;
end;
$$;
grant execute on function public.webpush_revoke_session(),public.webpush_revoke_current_device(text),public.webpush_current_status(text) to authenticated;
grant execute on function public.webpush_device_status(uuid,uuid,text),
  public.webpush_register_device(uuid,uuid,text,text,text,text),public.webpush_revoke_device(uuid,uuid,text),
  public.webpush_prepare_delivery(uuid,uuid),public.webpush_complete(uuid,uuid,text,uuid,integer),
  public.webpush_recover_expired(uuid,uuid),public.webpush_list_due(integer),public.webpush_list_uncertain(integer) to service_role;
comment on column private.push_subscriptions.auth_session_id is
  'Verified Supabase Auth session UUID. Legacy NULL rows can retain DB-only audit behavior but can never pass the actual delivery gate.';
comment on function public.webpush_prepare_delivery(uuid,uuid) is
  'Current source/recipient/session/preferences/consent check immediately before bounded HTTP. No transaction can recall a request already sent; HTTP acceptance is not display or read.';
comment on function public.webpush_recover_expired(uuid,uuid) is
  'Explicit at-least-once Web Push recovery only after lease plus bounded backoff. An ambiguous prior acceptance can cause duplicates. Old tokens cannot complete a newer attempt.';
commit;
