-- Artist-owned in-app publication and transactional notification enqueue only.
-- No external provider calls, scheduler activation, policy seed or media parsing.
begin;

create table private.artist_dispatch_submissions (
  message_id uuid primary key references private.artist_compose_drafts(message_id) on delete restrict,
  created_at timestamptz not null default clock_timestamp() check(isfinite(created_at)),
  next_attempt_at timestamptz not null check(isfinite(next_attempt_at)),
  dispatch_error text check(dispatch_error in ('author_unavailable','content_invalid','policy_unavailable','backpressure')),
  fanout_completed boolean not null default false,
  notification_queued boolean not null default false
);
create index artist_dispatch_due on private.artist_dispatch_submissions(next_attempt_at,message_id) where not fanout_completed;
create index artist_dispatch_history on private.artist_dispatch_submissions(created_at desc,message_id desc);
create table private.artist_dispatch_operations (
  actor_id uuid not null references public.profiles(id) on delete restrict,
  operation_id uuid not null,
  message_id uuid not null references private.artist_dispatch_submissions(message_id) on delete restrict,
  request jsonb not null check(jsonb_typeof(request)='object'),
  created_at timestamptz not null default clock_timestamp(),
  primary key(actor_id,operation_id)
);
create index artist_dispatch_actor_rate on private.artist_dispatch_operations(actor_id,created_at desc);
alter table private.artist_dispatch_submissions enable row level security;
alter table private.artist_dispatch_operations enable row level security;
revoke all on private.artist_dispatch_submissions,private.artist_dispatch_operations from public,anon,authenticated,service_role;

-- Pausing an artist stops new publication, not the owner's ability to inspect
-- and suppress an already scheduled item before later reactivation.
create function private.artist_dispatch_artist(p_actor uuid,p_slug text) returns public.artists
language plpgsql security definer set search_path='' as $$
declare artist public.artists%rowtype;
begin
  if p_slug is null or length(p_slug)>128 or p_slug!~'^[a-z0-9]+(-[a-z0-9]+)*$' then
    raise exception 'DISPATCH_INVALID_INPUT' using errcode='22023'; end if;
  select * into artist from public.artists where slug=p_slug for update;
  if artist.id is null then raise exception 'DISPATCH_NOT_FOUND' using errcode='P0002'; end if;
  perform 1 from public.artist_members where artist_id=artist.id and user_id=p_actor for share;
  if not found then raise exception 'COMPOSE_FORBIDDEN' using errcode='42501'; end if;
  return artist;
end;
$$;
create function private.artist_dispatch_lock(p_actor uuid,p_artist uuid,p_message uuid) returns public.messages
language plpgsql security definer set search_path='' as $$
declare m public.messages%rowtype; d private.artist_compose_drafts%rowtype;
begin
  select * into m from public.messages where id=p_message for update;
  select * into d from private.artist_compose_drafts where message_id=p_message for update;
  if m.id is null or d.message_id is null or m.artist_id<>p_artist or d.artist_id<>p_artist
    or m.author_id<>p_actor or d.owner_id<>p_actor then
    raise exception 'DISPATCH_NOT_FOUND' using errcode='P0002';
  end if;
  return m;
end;
$$;
create function private.artist_dispatch_projection(p_message uuid,p_now timestamptz) returns jsonb
language sql volatile security definer set search_path='' as $$
  select jsonb_build_object('id',m.id,'kind',m.type,'body',m.body,'revision',d.revision,'status',m.status,
    'created_at',s.created_at,'scheduled_at',m.scheduled_at,'sent_at',m.sent_at,'canceled_at',m.canceled_at,
    'cancel_before',case when m.sent_at is not null then m.sent_at+make_interval(secs=>cfg.cancel_window_seconds) end,
    'can_cancel',m.status='scheduled' or (m.status='sent' and p_now<m.sent_at+make_interval(secs=>cfg.cancel_window_seconds)),
    'notification_state',case when s.notification_queued and m.status='canceled' then 'canceled'
      when s.notification_queued then 'queued' else 'not_queued' end,
    'dispatch_error',s.dispatch_error,
    'media',coalesce((select jsonb_agg(jsonb_build_object('id',mm.id,'kind',mm.kind,'width',mm.width,
      'height',mm.height,'duration_ms',mm.duration_ms) order by mm.id)
      from public.message_media mm where mm.message_id=m.id),'[]'::jsonb))
  from public.messages m join private.artist_compose_drafts d on d.message_id=m.id
    join private.artist_dispatch_submissions s on s.message_id=m.id cross join private.message_policy cfg
  where m.id=p_message;
$$;

-- Keep legacy source behavior unchanged, but new managed submissions freeze the
-- notification recipient/device snapshot at publication. Replay cannot add new
-- devices or newly subscribed fans later. In-app reads remain current access.
alter function private.notification_enqueue_source(text,uuid) rename to notification_enqueue_source_legacy;
create function private.notification_enqueue_source(p_kind text,p_source uuid) returns integer
language plpgsql set search_path='' as $$
declare cfg private.notification_policy%rowtype; s private.artist_dispatch_submissions%rowtype;
  m public.messages%rowtype; devices uuid[]; stamp timestamptz; affected integer;
begin
  if p_kind is distinct from 'message' or not exists(select 1 from private.artist_dispatch_submissions where message_id=p_source) then
    return private.notification_enqueue_source_legacy(p_kind,p_source);
  end if;
  select * into s from private.artist_dispatch_submissions where message_id=p_source for update;
  select * into m from public.messages where id=p_source;
  if s.fanout_completed or m.status<>'sent' then return 0; end if;
  select * into cfg from private.notification_policy where singleton for share;
  stamp:=clock_timestamp();
  if cfg.singleton is null or not cfg.webpush_enabled then
    update private.artist_dispatch_submissions set fanout_completed=true where message_id=p_source;
    return 0;
  end if;
  -- At most 5,001 identities are materialized. Reject overflow atomically;
  -- never truncate the audience and mark a partially published message sent.
  select coalesce(array_agg(candidate.id),'{}'::uuid[]) into devices from (
    select d.id from public.subscriptions sub
      join private.push_subscriptions d on d.user_id=sub.user_id
    where sub.artist_id=m.artist_id and private.notification_eligible('message',p_source,d.user_id,d.id,stamp)
    order by d.id limit 5001
  ) candidate;
  if cardinality(devices)>5000 then raise exception 'DISPATCH_BACKPRESSURE' using errcode='54000'; end if;
  insert into private.notification_jobs(source_kind,source_id,message_id,user_id,device_id,route_kind,route_id,
    next_attempt_at,max_attempts,retry_seconds,lease_seconds,policy_version)
  select 'message',p_source,p_source,d.user_id,d.id,'artist_chat',m.artist_id,stamp,
    cfg.max_attempts,cfg.retry_seconds,cfg.lease_seconds,cfg.version
    from private.push_subscriptions d where d.id=any(devices)
    on conflict(source_kind,source_id,channel,user_id,device_id) do nothing;
  get diagnostics affected=row_count;
  update private.artist_dispatch_submissions set fanout_completed=true,notification_queued=cardinality(devices)>0
    where message_id=p_source;
  return affected;
end;
$$;

create function public.artist_dispatch_artists(p_after_slug text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid; items jsonb; total integer;
begin
  actor:=private.artist_compose_actor();
  if p_after_slug is not null and (length(p_after_slug)>128 or p_after_slug!~'^[a-z0-9]+(-[a-z0-9]+)*$') then
    raise exception 'DISPATCH_INVALID_INPUT' using errcode='22023'; end if;
  with candidates as materialized (
    select a.id,a.slug,a.name from public.artists a join public.artist_members member on member.artist_id=a.id
    where member.user_id=actor and (p_after_slug is null or a.slug>p_after_slug)
      and exists(select 1 from private.artist_dispatch_submissions s join private.artist_compose_drafts d on d.message_id=s.message_id
        where d.owner_id=actor and d.artist_id=a.id)
    order by a.slug limit 51
  ), page as (select * from candidates order by slug limit 50)
  select coalesce((select jsonb_agg(to_jsonb(p) order by p.slug) from page p),'[]'::jsonb),
    (select count(*)::integer from candidates) into items,total;
  return jsonb_build_object('artists',items,'has_more',total>50);
end;
$$;

create function public.artist_dispatch_context(p_artist_slug text,p_message_id uuid default null,
  p_before_created_at timestamptz default null,p_before_id uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid; artist public.artists%rowtype; cfg private.message_policy%rowtype;
  selected jsonb; items jsonb; total integer; stamp timestamptz;
begin
  actor:=private.artist_compose_actor(); artist:=private.artist_dispatch_artist(actor,p_artist_slug);
  if (p_before_created_at is null)<>(p_before_id is null) or
    (p_before_created_at is not null and not isfinite(p_before_created_at)) then
    raise exception 'DISPATCH_INVALID_INPUT' using errcode='22023';
  end if;
  if p_message_id is not null then perform private.artist_dispatch_lock(actor,artist.id,p_message_id); end if;
  select * into cfg from private.message_policy where singleton for share;
  if cfg.singleton is null then raise exception 'COMPOSE_SETUP_NOT_READY' using errcode='55000'; end if;
  stamp:=clock_timestamp();
  if p_message_id is not null then
    selected:=private.artist_dispatch_projection(p_message_id,stamp);
    if selected is null then raise exception 'DISPATCH_NOT_FOUND' using errcode='P0002'; end if;
  end if;
  with candidates as materialized (
    select s.message_id,s.created_at from private.artist_dispatch_submissions s
      join private.artist_compose_drafts d on d.message_id=s.message_id
    where d.owner_id=actor and d.artist_id=artist.id
      and (p_before_created_at is null or (s.created_at,s.message_id)<(p_before_created_at,p_before_id))
    order by s.created_at desc,s.message_id desc limit 31
  ), page as (select * from candidates order by created_at desc,message_id desc limit 30)
  select coalesce((select jsonb_agg(private.artist_dispatch_projection(p.message_id,stamp) order by p.created_at desc,p.message_id desc)
    from page p),'[]'::jsonb),(select count(*)::integer from candidates) into items,total;
  return jsonb_build_object('artist',jsonb_build_object('id',artist.id,'slug',artist.slug,'name',artist.name),
    'server_now',stamp,'cancel_window_seconds',cfg.cancel_window_seconds,'messages',items,'selected_message',selected,'has_more',total>30);
end;
$$;

create function public.artist_dispatch_submit(p_artist_slug text,p_message_id uuid,p_operation_id uuid,
  p_expected_revision bigint,p_scheduled_at timestamptz default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid; artist public.artists%rowtype; m public.messages%rowtype; req jsonb;
  previous private.artist_dispatch_operations%rowtype; stamp timestamptz; current_revision bigint;
begin
  actor:=private.artist_compose_actor(); artist:=private.artist_compose_artist(actor,p_artist_slug);
  if p_message_id is null or p_operation_id is null or p_expected_revision is null or p_expected_revision<1
    or p_expected_revision>9007199254740990 or (p_scheduled_at is not null and not isfinite(p_scheduled_at)) then
    raise exception 'DISPATCH_INVALID_INPUT' using errcode='22023';
  end if;
  m:=private.artist_dispatch_lock(actor,artist.id,p_message_id);
  req:=jsonb_build_object('action','submit','artist_slug',p_artist_slug,'message_id',p_message_id,
    'expected_revision',p_expected_revision,'scheduled_at_epoch',extract(epoch from p_scheduled_at));
  select * into previous from private.artist_dispatch_operations where actor_id=actor and operation_id=p_operation_id;
  if previous.operation_id is not null then
    if previous.request<>req then raise exception 'DISPATCH_OPERATION_CONFLICT' using errcode='23505'; end if;
    perform 1 from private.message_policy where singleton for share;
    perform private.get_message_policy();
    return private.artist_dispatch_projection(p_message_id,clock_timestamp());
  end if;
  if m.status<>'draft' then raise exception 'DISPATCH_NOT_DRAFT' using errcode='55000'; end if;
  select d.revision into current_revision from private.artist_compose_drafts d where d.message_id=p_message_id;
  if current_revision<>p_expected_revision then raise exception 'DISPATCH_REVISION_CONFLICT' using errcode='40001'; end if;
  perform private.artist_compose_policy();
  perform private.validate_message_content(p_message_id);
  stamp:=clock_timestamp();
  if p_scheduled_at is not null and p_scheduled_at<=stamp then raise exception 'DISPATCH_SCHEDULE_INVALID' using errcode='22023'; end if;
  if exists(select 1 from private.media_uploads where message_id=p_message_id and state='pending' and expires_at>stamp) then
    raise exception 'DISPATCH_UPLOAD_PENDING' using errcode='55000';
  end if;
  -- Safety ceilings, not approved business quotas. Actor/artist locks serialize
  -- count+insert; exact retries above never consume a second allowance.
  if (select count(*) from private.artist_dispatch_operations where actor_id=actor
    and created_at>stamp-interval '1 minute' and request->>'action'='submit')>=30 then
    raise exception 'DISPATCH_RATE_LIMITED' using errcode='54000';
  end if;
  if (select count(*) from private.artist_dispatch_submissions s join public.messages candidate on candidate.id=s.message_id
    where candidate.artist_id=artist.id and candidate.status='scheduled')>=100 then
    raise exception 'DISPATCH_BACKPRESSURE' using errcode='54000';
  end if;
  insert into private.artist_dispatch_submissions(message_id,next_attempt_at) values(p_message_id,coalesce(p_scheduled_at,stamp));
  update public.messages set status='scheduled',scheduled_at=coalesce(p_scheduled_at,stamp) where id=p_message_id;
  update private.artist_compose_drafts set revision=revision+1,updated_at=stamp where message_id=p_message_id;
  if p_scheduled_at is null then
    update public.messages set status='sent',sent_at=clock_timestamp() where id=p_message_id;
  end if;
  insert into private.artist_dispatch_operations(actor_id,operation_id,message_id,request) values(actor,p_operation_id,p_message_id,req);
  return private.artist_dispatch_projection(p_message_id,clock_timestamp());
end;
$$;

create function public.artist_dispatch_cancel(p_artist_slug text,p_message_id uuid,p_operation_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid; artist public.artists%rowtype; m public.messages%rowtype; req jsonb;
  previous private.artist_dispatch_operations%rowtype; cfg private.message_policy%rowtype; stamp timestamptz;
begin
  actor:=private.artist_compose_actor(); artist:=private.artist_dispatch_artist(actor,p_artist_slug);
  if p_message_id is null or p_operation_id is null then raise exception 'DISPATCH_INVALID_INPUT' using errcode='22023'; end if;
  m:=private.artist_dispatch_lock(actor,artist.id,p_message_id);
  if not exists(select 1 from private.artist_dispatch_submissions where message_id=p_message_id) then
    raise exception 'DISPATCH_NOT_FOUND' using errcode='P0002';
  end if;
  select * into cfg from private.message_policy where singleton for share;
  if cfg.singleton is null then raise exception 'COMPOSE_SETUP_NOT_READY' using errcode='55000'; end if;
  req:=jsonb_build_object('action','cancel','artist_slug',p_artist_slug,'message_id',p_message_id);
  select * into previous from private.artist_dispatch_operations where actor_id=actor and operation_id=p_operation_id;
  if previous.operation_id is not null then
    if previous.request<>req then raise exception 'DISPATCH_OPERATION_CONFLICT' using errcode='23505'; end if;
    return private.artist_dispatch_projection(p_message_id,clock_timestamp());
  end if;
  stamp:=clock_timestamp();
  if m.status='sent' and stamp>=m.sent_at+make_interval(secs=>cfg.cancel_window_seconds) then
    raise exception 'CANCEL_WINDOW_PASSED' using errcode='55000';
  end if;
  if m.status<>'canceled' then
    update public.messages set status='canceled',canceled_at=stamp,is_preview=false,preview_order=null where id=p_message_id;
    update private.artist_compose_drafts set revision=least(revision+1,9007199254740991),updated_at=stamp where message_id=p_message_id;
    update private.artist_dispatch_submissions set dispatch_error=null,fanout_completed=true where message_id=p_message_id;
  end if;
  insert into private.artist_dispatch_operations(actor_id,operation_id,message_id,request) values(actor,p_operation_id,p_message_id,req);
  return private.artist_dispatch_projection(p_message_id,clock_timestamp());
end;
$$;

create function public.message_dispatch_run(p_limit integer default 10) returns jsonb
language plpgsql security definer set search_path='' as $$
declare candidate record; actor public.profiles%rowtype; artist public.artists%rowtype; m public.messages%rowtype;
  published integer:=0; blocked integer:=0; skipped integer:=0; reason text; failure text; stamp timestamptz;
begin
  perform private.require_message_service();
  if p_limit is null or p_limit<1 or p_limit>20 then raise exception 'DISPATCH_INVALID_INPUT' using errcode='22023'; end if;
  for candidate in select s.message_id,source.author_id,source.artist_id from private.artist_dispatch_submissions s
    join public.messages source on source.id=s.message_id
    where not s.fanout_completed and source.status='scheduled' and source.scheduled_at<=clock_timestamp() and s.next_attempt_at<=clock_timestamp()
    order by s.next_attempt_at,s.message_id limit p_limit
  loop
    -- Locks are the claim: no network work occurs and no lease survives a crash.
    -- Each subtransaction rolls back its locks/work on contention or known
    -- prerequisite failure, so one blocked source does not poison the batch.
    begin
      select * into actor from public.profiles where id=candidate.author_id for update nowait;
      select * into artist from public.artists where id=candidate.artist_id for update nowait;
      perform 1 from public.artist_members where user_id=candidate.author_id and artist_id=candidate.artist_id for share nowait;
      if not found or actor.role<>'artist' or artist.status<>'active' or
        (actor.is_restricted and (actor.restricted_until is null or actor.restricted_until>clock_timestamp())) then
        raise exception 'DISPATCH_AUTHOR_UNAVAILABLE' using errcode='42501';
      end if;
      select * into m from public.messages where id=candidate.message_id for update nowait;
      perform 1 from private.artist_compose_drafts where message_id=m.id for update nowait;
      perform 1 from private.artist_dispatch_submissions where message_id=m.id for update nowait;
      stamp:=clock_timestamp();
      if m.status<>'scheduled' or m.scheduled_at>stamp then skipped:=skipped+1; continue; end if;
      perform 1 from private.message_policy where singleton for share nowait;
      perform private.validate_message_content(m.id);
      update public.messages set status='sent',sent_at=clock_timestamp() where id=m.id;
      update private.artist_dispatch_submissions set dispatch_error=null where message_id=m.id;
      published:=published+1;
    exception
      when lock_not_available then
        begin
          perform 1 from private.artist_dispatch_submissions where message_id=candidate.message_id for update nowait;
          update private.artist_dispatch_submissions set next_attempt_at=clock_timestamp()+interval '60 seconds'
            where message_id=candidate.message_id and exists(select 1 from public.messages current_message
              where current_message.id=candidate.message_id and current_message.status='scheduled');
        exception when lock_not_available then null; end;
        skipped:=skipped+1;
      when insufficient_privilege or check_violation or object_not_in_prerequisite_state or program_limit_exceeded then
        get stacked diagnostics failure=message_text;
        reason:=case when failure='DISPATCH_AUTHOR_UNAVAILABLE' then 'author_unavailable'
          when failure='DISPATCH_BACKPRESSURE' then 'backpressure'
          when failure='MESSAGE_POLICY_REQUIRED' then 'policy_unavailable'
          when failure in ('MESSAGE_CONTENT_INVALID','MESSAGE_MEDIA_REQUIRED','MEDIA_OBJECT_CHANGED') then 'content_invalid' end;
        if reason is null then raise; end if;
        -- Do not wait behind a simultaneous cancel/worker merely to record the
        -- retry note. This best-effort write is itself nonblocking.
        begin
          perform 1 from private.artist_dispatch_submissions where message_id=candidate.message_id for update nowait;
          update private.artist_dispatch_submissions set dispatch_error=reason,next_attempt_at=clock_timestamp()+interval '60 seconds'
            where message_id=candidate.message_id and exists(select 1 from public.messages current_message
              where current_message.id=candidate.message_id and current_message.status='scheduled');
        exception when lock_not_available then null; end;
        blocked:=blocked+1;
    end;
  end loop;
  return jsonb_build_object('published',published,'blocked',blocked,'skipped',skipped,
    'has_more',exists(select 1 from private.artist_dispatch_submissions s join public.messages source on source.id=s.message_id
      where not s.fanout_completed and source.status='scheduled' and source.scheduled_at<=clock_timestamp() and s.next_attempt_at<=clock_timestamp()));
end;
$$;

-- Legacy collaborators must not bypass the new owner's confirmation/revision
-- boundary. Legacy unmanaged messages keep the earlier public RPC contracts.
alter function public.messaging_schedule(uuid,uuid,timestamptz) rename to messaging_schedule_legacy;
alter function public.messaging_cancel(uuid,uuid) rename to messaging_cancel_legacy;
alter function public.messaging_dispatch(uuid) rename to messaging_dispatch_legacy;
-- Hide internal compatibility implementations from PostgREST's public schema.
alter function public.messaging_schedule_legacy(uuid,uuid,timestamptz) set schema private;
alter function public.messaging_cancel_legacy(uuid,uuid) set schema private;
alter function public.messaging_dispatch_legacy(uuid) set schema private;
-- PL/pgSQL resolves qualified names at execution; update wrappers after moving.
create or replace function public.messaging_schedule(p_actor_id uuid,p_message_id uuid,p_scheduled_at timestamptz) returns void
language plpgsql security definer set search_path='' as $$
begin
  perform private.require_message_service();
  if exists(select 1 from private.artist_compose_drafts where message_id=p_message_id) then
    raise exception 'COMPOSE_MANAGED_DRAFT' using errcode='42501'; end if;
  perform private.messaging_schedule_legacy(p_actor_id,p_message_id,p_scheduled_at);
end;
$$;
create or replace function public.messaging_cancel(p_actor_id uuid,p_message_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  perform private.require_message_service();
  if exists(select 1 from private.artist_compose_drafts where message_id=p_message_id) then
    raise exception 'COMPOSE_MANAGED_DRAFT' using errcode='42501'; end if;
  perform private.messaging_cancel_legacy(p_actor_id,p_message_id);
end;
$$;
create or replace function public.messaging_dispatch(p_message_id uuid) returns boolean
language plpgsql security definer set search_path='' as $$
begin
  perform private.require_message_service();
  if exists(select 1 from private.artist_compose_drafts where message_id=p_message_id) then
    raise exception 'COMPOSE_MANAGED_DRAFT' using errcode='42501'; end if;
  return private.messaging_dispatch_legacy(p_message_id);
end;
$$;
revoke all on function private.artist_dispatch_artist(uuid,text),private.artist_dispatch_lock(uuid,uuid,uuid),private.artist_dispatch_projection(uuid,timestamptz),
  private.notification_enqueue_source(text,uuid),private.notification_enqueue_source_legacy(text,uuid),
  private.messaging_schedule_legacy(uuid,uuid,timestamptz),private.messaging_cancel_legacy(uuid,uuid),private.messaging_dispatch_legacy(uuid)
  from public,anon,authenticated,service_role;
revoke all on function public.artist_dispatch_artists(text),public.artist_dispatch_context(text,uuid,timestamptz,uuid),
  public.artist_dispatch_submit(text,uuid,uuid,bigint,timestamptz),public.artist_dispatch_cancel(text,uuid,uuid),
  public.message_dispatch_run(integer),public.messaging_schedule(uuid,uuid,timestamptz),public.messaging_cancel(uuid,uuid),public.messaging_dispatch(uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.artist_dispatch_artists(text),public.artist_dispatch_context(text,uuid,timestamptz,uuid),
  public.artist_dispatch_submit(text,uuid,uuid,bigint,timestamptz),public.artist_dispatch_cancel(text,uuid,uuid) to authenticated;
grant execute on function public.message_dispatch_run(integer),public.messaging_schedule(uuid,uuid,timestamptz),
  public.messaging_cancel(uuid,uuid),public.messaging_dispatch(uuid) to service_role;
comment on function public.message_dispatch_run(integer) is 'Bounded transaction-only in-app publication claim. No provider delivery. Crash rolls back source/outbox together; current recipient consent/access is rechecked by notification claim later.';
commit;
