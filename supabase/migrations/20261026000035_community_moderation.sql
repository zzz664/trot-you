-- Feature 36: reports, review receipts, reply moderation and in-app decisions.
-- No policy defaults/approvals, role grants, provider delivery or scheduled work.
begin;
alter table public.reports drop constraint reports_target_type_check;
alter table public.community_moderation_log drop constraint community_moderation_log_target_type_check;
alter table public.community_moderation_log add constraint community_moderation_log_target_type_check
 check(target_type in('post','comment','reply','user'));
alter table public.replies add column is_hidden boolean not null default false;
alter table public.replies add column deleted_at timestamptz check(deleted_at is null or (isfinite(deleted_at) and is_hidden));
alter table public.replies add column report_count integer not null default 0 check(report_count>=0);
alter table public.replies add column revision bigint not null default 1 check(revision between 1 and 9007199254740991);
create trigger moderation_reply_revision before update on public.replies for each row execute function private.board_revision();
create index moderation_reports_page_idx on public.reports(created_at desc,id desc);
create table private.moderation_operations (
 actor_id uuid not null references public.profiles(id) on delete restrict,
 operation_id uuid not null,request jsonb not null check(jsonb_typeof(request)='object'),
 response jsonb not null check(jsonb_typeof(response)='object'),created_at timestamptz not null default clock_timestamp(),
 primary key(actor_id,operation_id));
create table private.moderation_notices (
 id uuid primary key default gen_random_uuid(),report_id uuid not null references public.reports(id) on delete restrict,
 -- The report FK transitively retains its reporter; avoid a redundant profile
 -- FK whose KEY SHARE would invert actor -> target locking during decisions.
 user_id uuid not null,
 decision public.report_status not null check(decision in('restored','deleted')),
 created_at timestamptz not null default clock_timestamp(),unique(report_id,decision));
create index moderation_notices_recipient_idx on private.moderation_notices(user_id,created_at desc,id desc);
alter table private.moderation_operations enable row level security;
alter table private.moderation_notices enable row level security;
revoke all on private.moderation_operations,private.moderation_notices from public,anon,authenticated,service_role;
create function private.moderation_immutable() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'MODERATION_RECORD_IMMUTABLE' using errcode='55000'; end;
$$;
create trigger moderation_operations_immutable before update or delete on private.moderation_operations
 for each row execute function private.moderation_immutable();
create trigger moderation_operations_no_truncate before truncate on private.moderation_operations
 for each statement execute function private.moderation_immutable();
create trigger moderation_notices_immutable before update or delete on private.moderation_notices
 for each row execute function private.moderation_immutable();
create trigger moderation_notices_no_truncate before truncate on private.moderation_notices
 for each statement execute function private.moderation_immutable();
-- A recipient-specific in-app outbox, not authorization to contact a provider.
-- No retroactive notifications are manufactured for historical resolved reports.
create function private.moderation_report_notice() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.status in('restored','deleted') and new.status is distinct from old.status then
   insert into private.moderation_notices(report_id,user_id,decision) values(new.id,new.reporter_id,new.status)
     on conflict(report_id,decision) do nothing;
 end if;
 return new;
end;
$$;
create trigger moderation_report_notice after update of status on public.reports
 for each row execute function private.moderation_report_notice();

create function private.moderation_lock_target(p_type public.report_target,p_id uuid,p_admin boolean)
returns void language plpgsql security definer set search_path='' as $$
declare post_id_value uuid; artist_id_value uuid;
begin
 if p_type is null or p_id is null then raise exception 'BOARD_INVALID_INPUT' using errcode='22023'; end if;
 if p_type='post' then perform private.lock_community_post(p_id,p_admin);
 elsif p_type='comment' then
   select post_id into post_id_value from public.comments where id=p_id;
   if post_id_value is null then raise exception 'COMMUNITY_TARGET_UNAVAILABLE' using errcode='42501'; end if;
   perform private.lock_community_post(post_id_value,p_admin);
   perform 1 from public.comments where id=p_id for update;
 else
   select artist_id into artist_id_value from public.replies where id=p_id;
   if artist_id_value is null then raise exception 'COMMUNITY_TARGET_UNAVAILABLE' using errcode='42501'; end if;
   perform private.require_community_artist(artist_id_value,p_admin);
   perform 1 from public.replies where id=p_id for update;
 end if;
end;
$$;
create function private.moderation_target(p_type public.report_target,p_id uuid,p_actor uuid)
returns jsonb language sql stable security definer set search_path='' as $$
 with target as (
 select p.artist_id,p.id as post_id,p.title,p.body,p.is_hidden,p.deleted_at,p.revision,p.report_count,p.user_id
 from public.posts p where p_type='post' and p.id=p_id
 union all
 select p.artist_id,c.post_id,null,c.body,c.is_hidden,c.deleted_at,c.revision,c.report_count,c.user_id
 from public.comments c join public.posts p on p.id=c.post_id where p_type='comment' and c.id=p_id
 union all
 select r.artist_id,null,null,r.body,r.is_hidden,r.deleted_at,r.revision,r.report_count,r.user_id
 from public.replies r where p_type='reply' and r.id=p_id)
 select jsonb_build_object('artist',jsonb_build_object('id',a.id,'slug',a.slug,'name',a.name),
 'post_id',t.post_id,'title',t.title,'body',t.body,'is_hidden',t.is_hidden,'deleted_at',t.deleted_at,
 'revision',t.revision,'report_count',t.report_count,'owner',jsonb_build_object('id',u.id,'call_name',u.call_name,
 'is_restricted',u.is_restricted,'restricted_until',u.restricted_until,'updated_at',u.updated_at,
 'can_restrict',u.role<>'admin' and u.id<>p_actor))
 from target t join public.artists a on a.id=t.artist_id join public.profiles u on u.id=t.user_id;
$$;
create function private.moderation_reportable(p_type public.report_target,p_id uuid,p_actor uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select case p_type
 when 'post' then exists(select 1 from public.posts p join public.artists a on a.id=p.artist_id
   where p.id=p_id and p.user_id<>p_actor and not p.is_hidden and p.deleted_at is null and a.status='active')
 when 'comment' then exists(select 1 from public.comments c join public.posts p on p.id=c.post_id
   join public.artists a on a.id=p.artist_id where c.id=p_id and c.user_id<>p_actor
   and not c.is_hidden and c.deleted_at is null and not p.is_hidden and p.deleted_at is null and a.status='active')
 when 'reply' then exists(select 1 from public.replies r join public.artists a on a.id=r.artist_id
   join public.profiles actor on actor.id=p_actor where r.id=p_id and r.user_id<>p_actor and not r.is_blocked
   and not r.is_hidden and r.deleted_at is null and r.created_at<=clock_timestamp()
   and a.status='active' and private.artist_reply_fan_visible(r.user_id,clock_timestamp())
   and (actor.role='admin' or (actor.role='artist' and actor.onboarding_completed_at is not null and exists(select 1 from public.artist_members am where am.artist_id=r.artist_id and am.user_id=p_actor))))
 else false end;
$$;

create or replace function public.community_report(p_target_type public.report_target,p_target_id uuid,p_reason text)
returns uuid language plpgsql security definer set search_path='' as $$
declare actor public.profiles%rowtype; cfg private.community_policy%rowtype; report_id uuid; pending_count integer; post_id_value uuid;
begin
 actor:=private.board_actor(auth.uid(),false,true);
 if p_target_type is null or p_target_id is null then raise exception 'COMMUNITY_TARGET_REQUIRED' using errcode='22004'; end if;
 -- Only immutable own evidence is recoverable after hidden/deleted/inactive state.
 select id into report_id from public.reports where target_type=p_target_type and target_id=p_target_id and reporter_id=actor.id;
 if found then return report_id; end if;
 perform private.moderation_lock_target(p_target_type,p_target_id,false);
 if p_target_type='reply' and actor.role='artist' then
   perform 1 from public.artist_members where user_id=actor.id and artist_id=(select artist_id from public.replies where id=p_target_id) for share;
 end if;
 if not private.moderation_reportable(p_target_type,p_target_id,actor.id) then
   raise exception 'COMMUNITY_TARGET_UNAVAILABLE' using errcode='42501'; end if;
 cfg:=private.board_policy();
 perform private.validate_community_text(p_reason,cfg.max_reason_length,cfg);
 perform private.claim_community_rate(actor.id,true,cfg);
 insert into public.reports(target_type,target_id,reporter_id,reason) values(p_target_type,p_target_id,actor.id,p_reason) returning id into report_id;
 select count(*) into pending_count from public.reports where target_type=p_target_type and target_id=p_target_id and status in('open','hidden');
 if p_target_type='post' then
   update public.posts set report_count=report_count+1,is_hidden=is_hidden or pending_count>=cfg.auto_hide_report_count where id=p_target_id;
 elsif p_target_type='comment' then
   update public.comments set report_count=report_count+1,is_hidden=is_hidden or pending_count>=cfg.auto_hide_report_count where id=p_target_id returning post_id into post_id_value;
   if pending_count>=cfg.auto_hide_report_count then update public.posts set comment_count=comment_count-1 where id=post_id_value; end if;
 else
   update public.replies set report_count=report_count+1,is_hidden=is_hidden or pending_count>=cfg.auto_hide_report_count where id=p_target_id;
 end if;
 if pending_count>=cfg.auto_hide_report_count then
   update public.reports set status='hidden' where target_type=p_target_type and target_id=p_target_id and status='open';
 end if;
 return report_id;
end;
$$;
create or replace function private.community_change_visibility(p_actor uuid, p_target_type public.report_target,
  p_target_id uuid, p_decision text, p_reason text, p_admin boolean)
returns void language plpgsql set search_path = '' as $$
declare p public.posts%rowtype; c public.comments%rowtype; was_visible boolean; now_visible boolean;
  deleted timestamptz; owner_id uuid; stamp timestamptz; r public.replies%rowtype;
begin
  if p_target_type is null then raise exception 'COMMUNITY_TARGET_REQUIRED' using errcode = '22004'; end if;
  if p_decision is null or p_decision not in ('hide', 'restore', 'delete') then
    raise exception 'COMMUNITY_DECISION_INVALID' using errcode = '23514';
  end if;
  if p_reason is null or p_reason !~ '[^[:space:]]' or length(p_reason) > 10000 then
    raise exception 'COMMUNITY_CONTENT_INVALID' using errcode = '23514';
  end if;
  if p_target_type = 'reply' then
    perform private.moderation_lock_target(p_target_type,p_target_id,p_admin);
    select * into r from public.replies where id=p_target_id;
    owner_id:=r.user_id; deleted:=r.deleted_at;
  elsif p_target_type = 'comment' then
    select * into c from public.comments where id = p_target_id;
    p := private.lock_community_post(c.post_id, p_admin);
    select * into c from public.comments where id = p_target_id for update;
    if c.id is null then raise exception 'COMMUNITY_TARGET_UNAVAILABLE' using errcode = '42501'; end if;
    owner_id := c.user_id; deleted := c.deleted_at;
    was_visible := not c.is_hidden and c.deleted_at is null;
  else
    p := private.lock_community_post(p_target_id, p_admin);
    owner_id := p.user_id; deleted := p.deleted_at;
  end if;
  if not p_admin and (owner_id <> p_actor or p_decision <> 'delete') then
    raise exception 'COMMUNITY_TARGET_UNAVAILABLE' using errcode = '42501';
  end if;
  if deleted is not null then
    if p_decision = 'delete' then return; end if;
    raise exception 'COMMUNITY_DELETED_TERMINAL' using errcode = '55000';
  end if;
  stamp := clock_timestamp();
  if p_target_type = 'reply' then
    update public.replies set is_hidden=p_decision<>'restore',
      deleted_at=case when p_decision='delete' then stamp end where id=p_target_id;
  elsif p_target_type = 'post' then
    update public.posts set is_hidden = p_decision <> 'restore',
      deleted_at = case when p_decision = 'delete' then stamp end,
      is_pinned = case when p_decision = 'delete' then false else is_pinned end where id = p_target_id;
  else
    now_visible := p_decision = 'restore';
    update public.comments set is_hidden = not now_visible,
      deleted_at = case when p_decision = 'delete' then stamp end where id = p_target_id;
    update public.posts set comment_count = comment_count + now_visible::integer - was_visible::integer where id = p.id;
  end if;
  if p_decision = 'hide' then
    update public.reports set status = 'hidden' where target_type = p_target_type and target_id = p_target_id and status = 'open';
  else
    update public.reports set status = (case when p_decision = 'restore' then 'restored' else 'deleted' end)::public.report_status,
      resolved_by = p_actor, resolved_at = stamp where target_type = p_target_type and target_id = p_target_id
      and (status in ('open', 'hidden') or p_decision = 'delete');
  end if;
  insert into public.community_moderation_log(actor_id, target_type, target_id, action, reason)
    values (p_actor, p_target_type::text, p_target_id, p_decision, p_reason);
end;
$$;
create or replace function public.community_moderate(p_target_type public.report_target, p_target_id uuid, p_decision text, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.board_actor(auth.uid(),false,true,true);
  perform private.community_change_visibility(auth.uid(), p_target_type, p_target_id, p_decision, p_reason, true);
end;
$$;
create or replace function public.community_restrict_user(p_user_id uuid, p_restricted boolean, p_until timestamptz, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare actor public.profiles%rowtype; target public.profiles%rowtype;
begin
  if current_setting('transaction_isolation')<>'read committed' then raise exception 'BOARD_ISOLATION_UNSUPPORTED' using errcode='25001'; end if;
  -- Deterministic multi-profile order avoids reciprocal restriction lock cycles.
  perform 1 from public.profiles where id in (auth.uid(), p_user_id) order by id for update;
  actor := private.board_actor(auth.uid(),false,true,true);
  select * into target from public.profiles where id = p_user_id;
  if target.id is null or target.role = 'admin' or target.id = actor.id then
    raise exception 'COMMUNITY_RESTRICTION_TARGET_FORBIDDEN' using errcode = '42501';
  end if;
  if p_restricted is null or (p_restricted and (p_until is null or not isfinite(p_until) or p_until <= clock_timestamp()))
    or (not p_restricted and p_until is not null) then
    raise exception 'COMMUNITY_RESTRICTION_INVALID' using errcode = '23514';
  end if;
  if p_reason is null or p_reason !~ '[^[:space:]]' or length(p_reason) > 10000 then
    raise exception 'COMMUNITY_CONTENT_INVALID' using errcode = '23514';
  end if;
  update public.profiles set is_restricted = p_restricted, restricted_until = p_until where id = p_user_id;
  insert into public.community_moderation_log(actor_id, target_type, target_id, action, reason)
    values (actor.id, 'user', p_user_id, case when p_restricted then 'restrict' else 'unrestrict' end, p_reason);
end;
$$;

create or replace function public.fan_reply_send(p_artist_slug text,p_operation_id uuid,p_body text,p_message_id uuid default null)
returns table(id uuid,operation_id uuid,message_id uuid,body text,created_at timestamptz,is_blocked boolean)
language plpgsql security definer set search_path='' as $$
declare r public.replies%rowtype;
begin
  r:=private.fan_reply_create(auth.uid(),p_artist_slug,p_operation_id,p_body,p_message_id);
  return query select r.id,r.operation_id,r.message_id,case when r.is_blocked or r.is_hidden or r.deleted_at is not null then null else r.body end,r.created_at,(r.is_blocked or r.is_hidden or r.deleted_at is not null);
end;
$$;

create or replace function public.fan_reply_page(p_artist_slug text,p_limit integer default 30,
  p_before_created_at timestamptz default null,p_before_id uuid default null)
returns table(artist_slug text,replies jsonb,max_length integer,send_ready boolean,has_more boolean)
language plpgsql security definer set search_path='' as $$
declare chosen uuid; cfg private.message_policy%rowtype; policy private.reply_policy%rowtype;
  rows_json jsonb; page_count integer;
begin
  if p_artist_slug is null or length(p_artist_slug)>128 or p_artist_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
    or p_limit is null or p_limit not between 1 and 100
    or (p_before_created_at is null)<>(p_before_id is null)
    or (p_before_created_at is not null and not isfinite(p_before_created_at)) then
    raise exception 'REPLY_INVALID_INPUT' using errcode='22023';
  end if;
  perform private.discovery_require_actor(auth.uid());
  if not exists(select 1 from public.profiles where id=auth.uid() and onboarding_completed_at is not null) then
    raise exception 'REPLY_PROFILE_REQUIRED' using errcode='55000';
  end if;
  select a.id into chosen from public.artists a where a.slug=p_artist_slug and a.status='active' for share;
  if chosen is null then raise exception 'REPLY_NOT_FOUND' using errcode='P0002'; end if;
  perform 1 from public.subscriptions where user_id=auth.uid() and artist_id=chosen for share;
  perform 1 from private.message_policy where singleton for share;
  cfg:=private.get_message_policy();
  select * into policy from private.reply_policy where singleton for share;
  if not private.has_subscription_access(auth.uid(),chosen,clock_timestamp()) then
    raise exception 'REPLY_SUBSCRIPTION_REQUIRED' using errcode='42501';
  end if;
  -- Own text is retained, including earlier subscription episodes. The source
  -- defines an artist-message history cutoff, not deletion/expiry of own replies.
  -- A later blocked reply keeps its identity/time but never projects its body.
  with candidates as materialized (
    select r.* from public.replies r where r.user_id=auth.uid() and r.artist_id=chosen
      and (p_before_created_at is null or (r.created_at,r.id)<(p_before_created_at,p_before_id))
    order by r.created_at desc,r.id desc limit p_limit+1
  ), page as (select * from candidates order by created_at desc,id desc limit p_limit)
  select coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'operation_id',r.operation_id,
    'message_id',r.message_id,'body',case when r.is_blocked or r.is_hidden or r.deleted_at is not null then null else r.body end,
    'created_at',r.created_at,'is_blocked',(r.is_blocked or r.is_hidden or r.deleted_at is not null)) order by r.created_at desc,r.id desc) from page r),'[]'::jsonb),
    (select count(*)::integer from candidates) into rows_json,page_count;
  return query select p_artist_slug,rows_json,cfg.max_reply_length,
    coalesce(private.reply_policy_ready(policy,clock_timestamp()),false),page_count>p_limit;
end;
$$;

-- Preserve the latest artist privacy projections, adding only independent
-- moderation visibility; do not restore older fan/role/assignment checks.
create or replace function public.artist_reply_activity_context(p_artist_slug text,p_message_id uuid default null,
  p_before_created_at timestamptz default null,p_before_id uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid; artist public.artists%rowtype; at_time timestamptz; selected jsonb; result jsonb;
begin
  actor:=private.artist_reply_activity_actor();
  artist:=private.artist_reply_activity_artist(actor,p_artist_slug);
  if (p_before_created_at is null)<>(p_before_id is null)
    or (p_before_created_at is not null and not isfinite(p_before_created_at)) then
    raise exception 'ARTIST_REPLY_INVALID_INPUT' using errcode='22023';
  end if;
  at_time:=clock_timestamp();
  if p_message_id is not null then
    select jsonb_build_object('id',m.id,'kind',m.type,'sent_at',m.sent_at) into selected
      from public.messages m where m.id=p_message_id and m.artist_id=artist.id
      and m.status='sent' and m.sent_at<=at_time for share;
    if selected is null then raise exception 'ARTIST_REPLY_NOT_FOUND' using errcode='P0002'; end if;
  end if;
  -- The selected message lock may have waited behind cancellation. Capture the
  -- response as-of clock only after every potentially waiting resource lock.
  at_time:=clock_timestamp();
  -- No fan profile locks after the artist lock: fan send acquires fan -> artist.
  -- Visibility and calling names are one current query snapshot. Expired/canceled
  -- subscriptions do not erase already received, otherwise-visible fan replies.
  with candidates as materialized (
    select r.id,p.call_name,r.body,r.created_at,
      case when m.status='sent' and m.sent_at<=at_time then m.id end as message_id
    from public.replies r join public.profiles p on p.id=r.user_id
    left join public.messages m on m.id=r.message_id and m.artist_id=artist.id
    where r.artist_id=artist.id and not r.is_blocked and not r.is_hidden and r.deleted_at is null and r.created_at<=at_time
      and private.artist_reply_fan_visible(r.user_id,at_time)
      and (p_message_id is null or r.message_id=p_message_id)
      and (p_before_created_at is null or (r.created_at,r.id)<(p_before_created_at,p_before_id))
    order by r.created_at desc,r.id desc limit 31
  ), page as (select * from candidates order by created_at desc,id desc limit 30)
  select jsonb_build_object('artist',jsonb_build_object('id',artist.id,'slug',artist.slug,'name',artist.name),
    'server_now',at_time,'selected_message',selected,
    'replies',coalesce((select jsonb_agg(to_jsonb(p) order by p.created_at desc,p.id desc) from page p),'[]'::jsonb),
    'has_more',(select count(*)>30 from candidates),'activity',private.artist_reply_activity_week(artist.id,at_time)) into result;
  return result;
end;
$$;

create or replace function public.messaging_list_replies(p_actor_id uuid,p_artist_id uuid,p_limit integer,
  p_before_created_at timestamptz default null,p_before_id uuid default null)
returns table(id uuid,call_name text,body text,created_at timestamptz)
language plpgsql security definer set search_path='' as $$
begin
  perform private.require_message_service();
  perform private.require_message_author(p_actor_id,p_artist_id);
  if p_limit is null or p_limit not between 1 and 100
    or (p_before_created_at is null)<>(p_before_id is null)
    or (p_before_created_at is not null and not isfinite(p_before_created_at)) then
    raise exception 'MESSAGE_PAGE_INVALID' using errcode='23514';
  end if;
  return query select r.id,p.call_name,r.body,r.created_at from public.replies r join public.profiles p on p.id=r.user_id
    where r.artist_id=p_artist_id and not r.is_blocked and not r.is_hidden and r.deleted_at is null and r.created_at<=statement_timestamp()
      and private.artist_reply_fan_visible(r.user_id,statement_timestamp())
      and (p_before_created_at is null or (r.created_at,r.id)<(p_before_created_at,p_before_id))
    order by r.created_at desc,r.id desc limit p_limit;
end;
$$;

-- New UI paths carry immutable actor-bound request receipts. Replays disclose
-- identifiers/results only; target content is always fetched under current access.
create function public.community_moderation_context(p_target_type public.report_target,p_target_id uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare actor public.profiles%rowtype; cfg private.community_policy%rowtype; prior public.reports%rowtype;
begin
 actor:=private.board_actor(auth.uid(),false);
 if p_target_type is null or p_target_id is null then raise exception 'BOARD_INVALID_INPUT' using errcode='22023'; end if;
 select * into prior from public.reports where target_type=p_target_type and target_id=p_target_id and reporter_id=actor.id;
 if prior.id is null then
   perform private.moderation_lock_target(p_target_type,p_target_id,false);
   if not private.moderation_reportable(p_target_type,p_target_id,actor.id) then
     raise exception 'COMMUNITY_TARGET_UNAVAILABLE' using errcode='42501'; end if;
 end if;
 cfg:=private.board_policy();
 return jsonb_build_object('actor_id',actor.id,'target_type',p_target_type,'target_id',p_target_id,
 'max_reason_length',cfg.max_reason_length,'existing_report',case when prior.id is not null then jsonb_build_object('id',prior.id,'status',prior.status) end);
end;
$$;
create function public.community_moderation_report(p_operation_id uuid,p_target_type public.report_target,p_target_id uuid,p_reason text)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare actor public.profiles%rowtype; prior private.moderation_operations%rowtype; request_value jsonb; result jsonb; report_value public.reports%rowtype;
begin
 actor:=private.board_actor(auth.uid(),false,true);
 if p_operation_id is null or p_target_type is null or p_target_id is null then raise exception 'BOARD_INVALID_INPUT' using errcode='22023'; end if;
 request_value:=jsonb_build_object('action','report','target_type',p_target_type,'target_id',p_target_id,'reason',p_reason);
 select * into prior from private.moderation_operations where actor_id=actor.id and operation_id=p_operation_id;
 if prior.operation_id is not null then
   if prior.request<>request_value then raise exception 'MODERATION_OPERATION_CONFLICT' using errcode='23505'; end if;
   return prior.response;
 end if;
 select * into report_value from public.reports where target_type=p_target_type and target_id=p_target_id and reporter_id=actor.id;
 if report_value.id is not null and report_value.reason is distinct from p_reason then
   raise exception 'MODERATION_OPERATION_CONFLICT' using errcode='23505'; end if;
 result:=jsonb_build_object('id',public.community_report(p_target_type,p_target_id,p_reason),'target_type',p_target_type,'target_id',p_target_id);
 insert into private.moderation_operations(actor_id,operation_id,request,response) values(actor.id,p_operation_id,request_value,result);
 return result;
end;
$$;
create function public.community_moderation_queue(p_limit integer default 21,p_before_created_at timestamptz default null,p_before_id uuid default null)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare actor public.profiles%rowtype; rows jsonb; cursor_value jsonb;
begin
 actor:=private.board_actor(auth.uid(),false,false,true);
 if p_limit is null or p_limit not between 1 and 100 or (p_before_created_at is null)<>(p_before_id is null)
   or (p_before_created_at is not null and not isfinite(p_before_created_at)) then raise exception 'BOARD_INVALID_INPUT' using errcode='22023'; end if;
 with page as materialized(select r.* from public.reports r
   where p_before_id is null or (r.created_at,r.id)<(p_before_created_at,p_before_id)
   order by r.created_at desc,r.id desc limit p_limit+1),
 shown as materialized(select * from page order by created_at desc,id desc limit p_limit)
 select coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'target_type',r.target_type,'target_id',r.target_id,
 'reason',r.reason,'status',r.status,'created_at',r.created_at,'resolved_at',r.resolved_at,
 'target',private.moderation_target(r.target_type,r.target_id,actor.id)) order by r.created_at desc,r.id desc) from shown r),'[]'::jsonb),
 case when (select count(*) from page)>p_limit then (select jsonb_build_object('created_at',r.created_at,'id',r.id)
 from shown r order by r.created_at,r.id limit 1) end into rows,cursor_value;
 return jsonb_build_object('actor_id',actor.id,'reports',rows,'next_cursor',cursor_value);
end;
$$;
create function public.community_moderation_resolve(p_operation_id uuid,p_report_id uuid,p_expected_revision bigint,
 p_decision text,p_reason text,p_confirmed boolean)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare actor public.profiles%rowtype; prior private.moderation_operations%rowtype; request_value jsonb; result jsonb;
 report_value public.reports%rowtype; target jsonb;
begin
 actor:=private.board_actor(auth.uid(),false,true,true);
 if p_confirmed is distinct from true then raise exception 'MODERATION_CONFIRMATION_REQUIRED' using errcode='22023'; end if;
 if p_operation_id is null or p_report_id is null or p_expected_revision is null or p_expected_revision not between 1 and 9007199254740990
   or p_decision is null or p_decision not in('restore','delete') then raise exception 'BOARD_INVALID_INPUT' using errcode='22023'; end if;
 request_value:=jsonb_build_object('action','resolve','report_id',p_report_id,'revision',p_expected_revision,'decision',p_decision,'reason',p_reason);
 select * into prior from private.moderation_operations where actor_id=actor.id and operation_id=p_operation_id;
 if prior.operation_id is not null then
   if prior.request<>request_value then raise exception 'MODERATION_OPERATION_CONFLICT' using errcode='23505'; end if;
   return prior.response;
 end if;
 select * into report_value from public.reports where id=p_report_id;
 if report_value.id is null then raise exception 'COMMUNITY_TARGET_UNAVAILABLE' using errcode='42501'; end if;
 perform private.moderation_lock_target(report_value.target_type,report_value.target_id,true);
 select * into report_value from public.reports where id=p_report_id for update;
 if report_value.status not in('open','hidden') then raise exception 'MODERATION_REPORT_RESOLVED' using errcode='55000'; end if;
 target:=private.moderation_target(report_value.target_type,report_value.target_id,actor.id);
 if (target->>'revision')::bigint<>p_expected_revision then raise exception 'MODERATION_REVISION_CONFLICT' using errcode='40001'; end if;
 perform private.community_change_visibility(actor.id,report_value.target_type,report_value.target_id,p_decision,p_reason,true);
 target:=private.moderation_target(report_value.target_type,report_value.target_id,actor.id);
 result:=jsonb_build_object('report_id',report_value.id,'target_type',report_value.target_type,'target_id',report_value.target_id,
 'decision',p_decision,'revision',(target->>'revision')::bigint);
 insert into private.moderation_operations(actor_id,operation_id,request,response) values(actor.id,p_operation_id,request_value,result);
 return result;
end;
$$;
create function public.community_moderation_restrict(p_operation_id uuid,p_user_id uuid,p_expected_updated_at timestamptz,
 p_restricted boolean,p_until timestamptz default null,p_reason text default null,p_confirmed boolean default false)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare actor public.profiles%rowtype; target public.profiles%rowtype; prior private.moderation_operations%rowtype;
 request_value jsonb; result jsonb;
begin
 -- Never acquire actor then target in arbitrary order: reciprocal restriction
 -- attempts and existing legacy moderation use deterministic profile order.
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'BOARD_ISOLATION_UNSUPPORTED' using errcode='25001'; end if;
 if current_setting('role',true) is distinct from 'authenticated' then raise exception 'COMMUNITY_FORBIDDEN' using errcode='42501'; end if;
 perform 1 from public.profiles where id in(auth.uid(),p_user_id) order by id for update;
 actor:=private.board_actor(auth.uid(),false,true,true);
 if p_confirmed is distinct from true then raise exception 'MODERATION_CONFIRMATION_REQUIRED' using errcode='22023'; end if;
 if p_operation_id is null or p_user_id is null or p_expected_updated_at is null or not isfinite(p_expected_updated_at)
   then raise exception 'BOARD_INVALID_INPUT' using errcode='22023'; end if;
 request_value:=jsonb_build_object('action','restrict','user_id',p_user_id,'updated_at',p_expected_updated_at,
 'restricted',p_restricted,'until',p_until,'reason',p_reason);
 select * into prior from private.moderation_operations where actor_id=actor.id and operation_id=p_operation_id;
 if prior.operation_id is not null then
   if prior.request<>request_value then raise exception 'MODERATION_OPERATION_CONFLICT' using errcode='23505'; end if;
   return prior.response;
 end if;
 select * into target from public.profiles where id=p_user_id;
 if target.id is null or target.role='admin' or target.id=actor.id then
   raise exception 'COMMUNITY_RESTRICTION_TARGET_FORBIDDEN' using errcode='42501'; end if;
 if target.updated_at<>p_expected_updated_at then raise exception 'MODERATION_REVISION_CONFLICT' using errcode='40001'; end if;
 perform public.community_restrict_user(p_user_id,p_restricted,p_until,p_reason);
 select * into target from public.profiles where id=p_user_id;
 result:=jsonb_build_object('user_id',target.id,'is_restricted',target.is_restricted,'restricted_until',target.restricted_until,'updated_at',target.updated_at);
 insert into private.moderation_operations(actor_id,operation_id,request,response) values(actor.id,p_operation_id,request_value,result);
 return result;
end;
$$;
create function public.community_moderation_notices(p_limit integer default 21,p_before_created_at timestamptz default null,p_before_id uuid default null)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare actor public.profiles%rowtype; rows jsonb; cursor_value jsonb;
begin
 actor:=private.board_actor(auth.uid(),false);
 if p_limit is null or p_limit not between 1 and 100 or (p_before_created_at is null)<>(p_before_id is null)
   or (p_before_created_at is not null and not isfinite(p_before_created_at)) then raise exception 'BOARD_INVALID_INPUT' using errcode='22023'; end if;
 with page as materialized(select n.* from private.moderation_notices n where n.user_id=actor.id
 and (p_before_id is null or (n.created_at,n.id)<(p_before_created_at,p_before_id))
 order by n.created_at desc,n.id desc limit p_limit+1),
 shown as materialized(select * from page order by created_at desc,id desc limit p_limit)
 select coalesce((select jsonb_agg(jsonb_build_object('id',n.id,'report_id',n.report_id,'decision',n.decision,'created_at',n.created_at)
 order by n.created_at desc,n.id desc) from shown n),'[]'::jsonb),
 case when (select count(*) from page)>p_limit then (select jsonb_build_object('created_at',n.created_at,'id',n.id)
 from shown n order by n.created_at,n.id limit 1) end into rows,cursor_value;
 return jsonb_build_object('actor_id',actor.id,'notices',rows,'next_cursor',cursor_value);
end;
$$;
revoke all on function private.moderation_immutable(),private.moderation_report_notice(),
 private.moderation_lock_target(public.report_target,uuid,boolean),private.moderation_target(public.report_target,uuid,uuid),
 private.moderation_reportable(public.report_target,uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.community_moderation_context(public.report_target,uuid),
 public.community_moderation_report(uuid,public.report_target,uuid,text),public.community_moderation_queue(integer,timestamptz,uuid),
 public.community_moderation_resolve(uuid,uuid,bigint,text,text,boolean),
 public.community_moderation_restrict(uuid,uuid,timestamptz,boolean,timestamptz,text,boolean),
 public.community_moderation_notices(integer,timestamptz,uuid) from public,anon,authenticated,service_role;
grant execute on function public.community_moderation_context(public.report_target,uuid),
 public.community_moderation_report(uuid,public.report_target,uuid,text),public.community_moderation_queue(integer,timestamptz,uuid),
 public.community_moderation_resolve(uuid,uuid,bigint,text,text,boolean),
 public.community_moderation_restrict(uuid,uuid,timestamptz,boolean,timestamptz,text,boolean),
 public.community_moderation_notices(integer,timestamptz,uuid) to authenticated;
comment on type public.report_target is 'Post/comment visible-content reporting and assigned-artist/admin reply reporting. Distinct reporters are lifetime unique; resolved reporters do not count toward a new hide cycle.';
comment on table private.moderation_notices is 'Immutable recipient-only in-app decision queue. No external channel consent or delivery is implied; no provider or notification policy is activated.';
comment on column public.replies.is_hidden is 'Moderation visibility only; restore never changes independent send-policy is_blocked.';
commit;
