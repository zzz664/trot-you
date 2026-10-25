-- Configuration-ready admin artist management. No account creation, email,
-- credentials, operational role grants, policy approvals or financial edits.
begin;

alter table public.artists add column display_order integer not null default 0 check(display_order between 0 and 2147483647);
alter table public.artists add column revision bigint not null default 1 check(revision between 1 and 9007199254740991);
create index artists_management_order on public.artists(display_order,slug,id);
create or replace view public.artist_catalog with(security_barrier=true) as
  select id,slug,name,profile_image_path,intro,display_order from public.artists where status='active';
-- All application admin mutations now use audited, compare-and-set RPCs. No
-- destructive artist deletion or caller-selected profile asset path is exposed.
revoke insert,update,delete on public.artists,public.artist_members from authenticated;

create table private.artist_account_link_policy (
  singleton boolean primary key default true check(singleton),
  enabled boolean not null default false,
  approved_at timestamptz check(approved_at is null or isfinite(approved_at)),
  decision_reference text check(decision_reference is null or (btrim(decision_reference)<>'' and length(decision_reference)<=200)),
  invitation_ttl_hours integer not null check(invitation_ttl_hours between 1 and 168),
  check(not enabled or (approved_at is not null and decision_reference is not null))
);
create table private.artist_account_invitations (
  id uuid primary key default gen_random_uuid(),
  artist_id uuid not null references public.artists(id) on delete restrict,
  target_user_id uuid not null references public.profiles(id) on delete restrict,
  invited_by uuid not null references public.profiles(id) on delete restrict,
  is_manager boolean not null,
  state text not null default 'pending' check(state in('pending','accepted','canceled','declined','expired')),
  revision bigint not null default 1 check(revision between 1 and 9007199254740991),
  expires_at timestamptz not null check(isfinite(expires_at)),
  created_at timestamptz not null default clock_timestamp(),
  responded_at timestamptz,
  check(expires_at>created_at),
  check(target_user_id<>invited_by)
);
create unique index artist_account_one_pending on private.artist_account_invitations(artist_id,target_user_id) where state='pending';
create index artist_account_target_page on private.artist_account_invitations(target_user_id,created_at desc,id desc);
create index artist_account_artist_page on private.artist_account_invitations(artist_id,created_at desc,id desc);
create table private.admin_artist_operations (
  actor_id uuid not null references public.profiles(id) on delete restrict,
  operation_id uuid not null,
  request jsonb not null check(jsonb_typeof(request)='object'),
  response jsonb not null check(jsonb_typeof(response)='object'),
  created_at timestamptz not null default clock_timestamp(),
  primary key(actor_id,operation_id)
);
create table private.admin_artist_audit (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references public.profiles(id) on delete restrict,
  artist_id uuid not null references public.artists(id) on delete restrict,
  action text not null check(action in('create','update','previews','legacy_previews','invite','cancel_invite','accept_invite','decline_invite','unlink')),
  operation_id uuid,
  before_value jsonb,
  after_value jsonb not null,
  created_at timestamptz not null default clock_timestamp()
);
alter table private.artist_account_link_policy enable row level security;
alter table private.artist_account_invitations enable row level security;
alter table private.admin_artist_operations enable row level security;
alter table private.admin_artist_audit enable row level security;
revoke all on private.artist_account_link_policy,private.artist_account_invitations,private.admin_artist_operations,private.admin_artist_audit
  from public,anon,authenticated,service_role;

create function private.admin_artist_audit_immutable() returns trigger
language plpgsql set search_path='' as $$
begin raise exception 'ADMIN_ARTIST_AUDIT_IMMUTABLE' using errcode='55000'; end;
$$;
create trigger admin_artist_audit_immutable before update or delete on private.admin_artist_audit
  for each row execute function private.admin_artist_audit_immutable();
create trigger admin_artist_audit_no_truncate before truncate on private.admin_artist_audit
  for each statement execute function private.admin_artist_audit_immutable();
create table private.admin_bootstrap_audit (
  target_user_id uuid primary key references public.profiles(id) on delete restrict,
  approved_reference text not null check(btrim(approved_reference)<>'' and length(approved_reference)<=200),
  created_at timestamptz not null default clock_timestamp()
);
alter table private.admin_bootstrap_audit enable row level security;
revoke all on private.admin_bootstrap_audit from public,anon,authenticated,service_role;
create trigger admin_bootstrap_audit_immutable before update or delete on private.admin_bootstrap_audit
  for each row execute function private.admin_artist_audit_immutable();
create trigger admin_bootstrap_audit_no_truncate before truncate on private.admin_bootstrap_audit
  for each statement execute function private.admin_artist_audit_immutable();
create function private.admin_artist_revision() returns trigger
language plpgsql set search_path='' as $$
begin new.revision:=old.revision+1; return new; end;
$$;
create trigger artists_management_revision before update on public.artists
  for each row execute function private.admin_artist_revision();
-- Canceling a selected preview also invalidates a stale admin selection form.
create function private.admin_artist_preview_changed() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if (old.is_preview or new.is_preview) and
    (old.status,old.is_preview,old.preview_order) is distinct from (new.status,new.is_preview,new.preview_order) then
    update public.artists set revision=revision where id=new.artist_id;
  end if;
  return null;
end;
$$;
create trigger admin_artist_preview_revision after update of status,is_preview,preview_order on public.messages
  for each row execute function private.admin_artist_preview_changed();

create function private.admin_artist_lock_profiles(p_ids uuid[]) returns void
language plpgsql security definer set search_path='' as $$
begin
  perform 1 from public.profiles where id=any(p_ids) order by id for update;
end;
$$;
create function private.admin_artist_require_admin(p_actor uuid) returns void
language plpgsql security definer set search_path='' as $$
declare p public.profiles%rowtype;
begin
  select * into p from public.profiles where id=p_actor;
  if p.id is null or p.role<>'admin' or (p.is_restricted and (p.restricted_until is null or p.restricted_until>clock_timestamp())) then
    raise exception 'ADMIN_ARTIST_FORBIDDEN' using errcode='42501';
  end if;
end;
$$;
create function private.admin_artist_actor(p_other uuid default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();
begin
  perform private.admin_artist_lock_profiles(array[actor,p_other]);
  perform private.admin_artist_require_admin(actor);
  return actor;
end;
$$;
create function private.admin_artist_policy_ready() returns boolean
language sql volatile security definer set search_path='' as $$
  select exists(select 1 from private.artist_account_link_policy
    where singleton and enabled and approved_at<=clock_timestamp() and decision_reference is not null);
$$;
create function private.admin_artist_lock_policy() returns private.artist_account_link_policy
language plpgsql security definer set search_path='' as $$
declare p private.artist_account_link_policy%rowtype;
begin
  select * into p from private.artist_account_link_policy where singleton for share;
  if not coalesce(p.enabled and p.approved_at<=clock_timestamp() and p.decision_reference is not null,false) then
    raise exception 'ADMIN_ARTIST_SETUP_NOT_READY' using errcode='55000';
  end if;
  return p;
end;
$$;
create function private.admin_artist_target(p_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare p public.profiles%rowtype; u auth.users%rowtype;
begin
  select * into p from public.profiles where id=p_id;
  select * into u from auth.users where id=p_id for share;
  if p.id is null or p.role not in('fan','artist') or p.onboarding_completed_at is null or
    (p.is_restricted and (p.restricted_until is null or p.restricted_until>clock_timestamp())) or
    u.id is null or not ((u.email_confirmed_at is not null and nullif(btrim(u.email),'') is not null) or
      (u.phone_confirmed_at is not null and nullif(btrim(u.phone),'') is not null)) or
    coalesce(u.is_anonymous,false) or u.deleted_at is not null or u.banned_until>clock_timestamp() then
    raise exception 'ADMIN_ARTIST_ACCOUNT_UNAVAILABLE' using errcode='42501';
  end if;
end;
$$;
create function private.admin_artist_projection(p_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('id',a.id,'slug',a.slug,'name',a.name,'intro',a.intro,'status',a.status,'grade',a.grade,
    'agency_name',a.agency_name,'contract_started_at',a.contract_started_at,'contract_ended_at',a.contract_ended_at,
    'display_order',a.display_order,'revision',a.revision,'updated_at',a.updated_at) from public.artists a where a.id=p_id;
$$;
create function private.admin_artist_invitation_projection(p_id uuid) returns jsonb
language sql volatile security definer set search_path='' as $$
  select jsonb_build_object('id',i.id,'artist_id',i.artist_id,'artist_name',a.name,'target_user_id',i.target_user_id,
    'is_manager',i.is_manager,'state',case when i.state='pending' and i.expires_at<=clock_timestamp() then 'expired' else i.state end,
    'revision',i.revision,'expires_at',i.expires_at)
    from private.artist_account_invitations i join public.artists a on a.id=i.artist_id where i.id=p_id;
$$;
create function private.admin_artist_message_projection(p_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('id',m.id,'kind',m.type,'body',m.body,'sent_at',m.sent_at,'is_preview',m.is_preview,'preview_order',m.preview_order,
    'media',coalesce((select jsonb_agg(jsonb_build_object('id',mm.id,'kind',mm.kind,'width',mm.width,'height',mm.height,'duration_ms',mm.duration_ms) order by mm.id)
      from public.message_media mm where mm.message_id=m.id),'[]'::jsonb)) from public.messages m where m.id=p_id;
$$;
create function private.admin_artist_operation(p_actor uuid,p_operation uuid,p_request jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare prior private.admin_artist_operations%rowtype;
begin
  if p_operation is null then raise exception 'ADMIN_ARTIST_INVALID_INPUT' using errcode='22023'; end if;
  select * into prior from private.admin_artist_operations where actor_id=p_actor and operation_id=p_operation;
  if prior.operation_id is not null then
    if prior.request<>p_request then raise exception 'ADMIN_ARTIST_OPERATION_CONFLICT' using errcode='23505'; end if;
    return prior.response;
  end if;
  return null;
end;
$$;
create function private.admin_artist_record(p_actor uuid,p_artist uuid,p_operation uuid,p_request jsonb,p_before jsonb,p_after jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  insert into private.admin_artist_operations(actor_id,operation_id,request,response) values(p_actor,p_operation,p_request,p_after);
  insert into private.admin_artist_audit(actor_id,artist_id,action,operation_id,before_value,after_value)
    values(p_actor,p_artist,p_request->>'action',p_operation,p_before,jsonb_build_object('request',p_request,'response',p_after));
  return p_after;
end;
$$;
create function private.admin_artist_lock(p_id uuid,p_revision bigint default null) returns public.artists
language plpgsql security definer set search_path='' as $$
declare a public.artists%rowtype;
begin
  select * into a from public.artists where id=p_id for update;
  if a.id is null then raise exception 'ADMIN_ARTIST_NOT_FOUND' using errcode='P0002'; end if;
  if p_revision is not null and a.revision<>p_revision then
    raise exception 'ADMIN_ARTIST_REVISION_CONFLICT' using errcode='40001';
  end if;
  return a;
end;
$$;

create function public.admin_artist_list(p_page integer default 1) returns jsonb
language plpgsql security definer set search_path='' as $$
declare rows_json jsonb; total integer;
begin
  perform private.admin_artist_actor();
  if p_page is null or p_page not between 1 and 1000 then raise exception 'ADMIN_ARTIST_INVALID_INPUT' using errcode='22023'; end if;
  with candidates as materialized (select id,display_order,slug from public.artists order by display_order,slug,id offset (p_page-1)*20 limit 21),
    page as(select * from candidates order by display_order,slug,id limit 20)
  select coalesce((select jsonb_agg(private.admin_artist_projection(p.id) order by p.display_order,p.slug,p.id) from page p),'[]'::jsonb),
    (select count(*)::integer from candidates) into rows_json,total;
  return jsonb_build_object('artists',rows_json,'has_more',total>20);
end;
$$;
create function public.admin_artist_detail(p_artist_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a public.artists%rowtype; cfg private.message_policy%rowtype;
begin
  perform private.admin_artist_actor(); a:=private.admin_artist_lock(p_artist_id);
  select * into cfg from private.message_policy where singleton for share;
  return jsonb_build_object('artist',private.admin_artist_projection(a.id),
    'previews',coalesce((select jsonb_agg(private.admin_artist_message_projection(m.id) order by m.preview_order)
      from public.messages m where m.artist_id=a.id and m.status='sent' and m.is_preview),'[]'::jsonb),
    'messages',coalesce((select jsonb_agg(private.admin_artist_message_projection(m.id) order by m.sent_at desc,m.id desc)
      from(select id,sent_at from public.messages where artist_id=a.id and status='sent' and sent_at<=clock_timestamp()
        order by sent_at desc,id desc limit 50)m),'[]'::jsonb),
    'messages_has_more',(select count(*)>50 from public.messages where artist_id=a.id and status='sent' and sent_at<=clock_timestamp()),
    'members',coalesce((select jsonb_agg(to_jsonb(m) order by m.user_id) from
      (select user_id,is_manager from public.artist_members where artist_id=a.id order by user_id limit 50)m),'[]'::jsonb),
    'members_has_more',(select count(*)>50 from public.artist_members where artist_id=a.id),
    'invitations',coalesce((select jsonb_agg(private.admin_artist_invitation_projection(i.id) order by i.created_at desc,i.id desc) from
      (select id,created_at from private.artist_account_invitations where artist_id=a.id order by created_at desc,id desc limit 50)i),'[]'::jsonb),
    'invitations_has_more',(select count(*)>50 from private.artist_account_invitations where artist_id=a.id),
    'account_link_ready',private.admin_artist_policy_ready(),'preview_max_count',coalesce(cfg.preview_max_count,0));
end;
$$;

create function public.admin_artist_save(p_artist_id uuid,p_operation_id uuid,p_expected_revision bigint,p_input jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid; a public.artists%rowtype; req jsonb; prior jsonb; before_value jsonb; started date; ended date; ordering integer;
begin
  actor:=private.admin_artist_actor();
  if p_artist_id is null or p_expected_revision is null or p_expected_revision not between 0 and 9007199254740990 or
    p_input is null or jsonb_typeof(p_input)<>'object' or
    (select array_agg(k order by k) from jsonb_object_keys(p_input)k) is distinct from
      array['agency_name','contract_ended_at','contract_started_at','display_order','grade','intro','name','slug','status']::text[] or
    jsonb_typeof(p_input->'name')<>'string' or jsonb_typeof(p_input->'slug')<>'string' or
    jsonb_typeof(p_input->'status')<>'string' or jsonb_typeof(p_input->'grade')<>'string' or
    jsonb_typeof(p_input->'display_order')<>'number' or (p_input->>'display_order')!~'^[0-9]{1,10}$' or
    jsonb_typeof(p_input->'intro') not in('string','null') or jsonb_typeof(p_input->'agency_name') not in('string','null') or
    jsonb_typeof(p_input->'contract_started_at') not in('string','null') or jsonb_typeof(p_input->'contract_ended_at') not in('string','null') or
    length(p_input->>'slug') not between 1 and 128 or (p_input->>'slug')!~'^[a-z0-9]+(-[a-z0-9]+)*$' or
    length(p_input->>'name') not between 1 and 200 or (p_input->>'name')<>btrim(p_input->>'name') or (p_input->>'name')~'[[:cntrl:]]' or
    length(p_input->>'intro')>5000 or (p_input->>'intro')~U&'[\0001-\0008\000B\000C\000E-\001F\007F]' or
    (p_input->>'agency_name' is not null and (length(p_input->>'agency_name') not between 1 and 200 or
      p_input->>'agency_name'<>btrim(p_input->>'agency_name') or (p_input->>'agency_name')~'[[:cntrl:]]')) or
    (p_input->>'contract_started_at' is not null and (p_input->>'contract_started_at')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$') or
    (p_input->>'contract_ended_at' is not null and (p_input->>'contract_ended_at')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$') or
    (p_input->>'grade') not in('B','C') or (p_input->>'status') not in('draft','active','paused','retired') then
    raise exception 'ADMIN_ARTIST_INVALID_INPUT' using errcode='22023';
  end if;
  begin
    started:=(p_input->>'contract_started_at')::date; ended:=(p_input->>'contract_ended_at')::date; ordering:=(p_input->>'display_order')::integer;
  exception when others then raise exception 'ADMIN_ARTIST_INVALID_INPUT' using errcode='22023'; end;
  if ordering<0 or (started is not null and (not isfinite(started) or started::text<>p_input->>'contract_started_at')) or
    (ended is not null and (not isfinite(ended) or ended::text<>p_input->>'contract_ended_at' or started is null or ended<started)) then
    raise exception 'ADMIN_ARTIST_INVALID_INPUT' using errcode='22023';
  end if;
  req:=jsonb_build_object('action',case when p_expected_revision=0 then 'create' else 'update' end,'artist_id',p_artist_id,
    'expected_revision',p_expected_revision,'input',p_input);
  prior:=private.admin_artist_operation(actor,p_operation_id,req);
  if prior is not null then return prior; end if;
  select * into a from public.artists where id=p_artist_id for update;
  if a.id is null and p_expected_revision<>0 then raise exception 'ADMIN_ARTIST_NOT_FOUND' using errcode='P0002'; end if;
  if a.id is not null and a.revision<>p_expected_revision then raise exception 'ADMIN_ARTIST_REVISION_CONFLICT' using errcode='40001'; end if;
  before_value:=private.admin_artist_projection(p_artist_id);
  begin
    if a.id is null then
      insert into public.artists(id,slug,name,intro,status,grade,agency_name,contract_started_at,contract_ended_at,display_order)
        values(p_artist_id,p_input->>'slug',p_input->>'name',p_input->>'intro',(p_input->>'status')::public.artist_status,
          (p_input->>'grade')::public.artist_grade,p_input->>'agency_name',started,ended,ordering);
    else
      update public.artists set slug=p_input->>'slug',name=p_input->>'name',intro=p_input->>'intro',
        status=(p_input->>'status')::public.artist_status,grade=(p_input->>'grade')::public.artist_grade,
        agency_name=p_input->>'agency_name',contract_started_at=started,contract_ended_at=ended,display_order=ordering where id=a.id;
    end if;
  exception when unique_violation then raise exception 'ADMIN_ARTIST_SLUG_CONFLICT' using errcode='23505'; end;
  -- Pausing/retiring never erases subscriptions, messages or recognized ledger.
  -- Pending link intent cannot silently revive after later reactivation.
  if p_input->>'status'<>'active' then
    with canceled as (update private.artist_account_invitations set state='canceled',revision=revision+1,responded_at=clock_timestamp()
      where artist_id=p_artist_id and state='pending' returning id)
    insert into private.admin_artist_audit(actor_id,artist_id,action,operation_id,before_value,after_value)
      select actor,p_artist_id,'cancel_invite',p_operation_id,jsonb_build_object('invitation_id',id,'state','pending'),
        jsonb_build_object('invitation_id',id,'state','canceled','reason','artist_deactivated') from canceled;
  end if;
  return private.admin_artist_record(actor,p_artist_id,p_operation_id,req,before_value,private.admin_artist_projection(p_artist_id));
end;
$$;

-- Shared legacy/new implementation; the accepted media relationship is reused,
-- no raw path or direct Storage object input is accepted by preview curation.
create function private.admin_artist_apply_previews(p_artist uuid,p_ids uuid[]) returns void
language plpgsql security definer set search_path='' as $$
declare cfg private.message_policy%rowtype;
begin
  select * into cfg from private.message_policy where singleton for share;
  if cfg.singleton is null then raise exception 'MESSAGE_POLICY_REQUIRED' using errcode='55000'; end if;
  if p_ids is null or cardinality(p_ids)>cfg.preview_max_count or array_position(p_ids,null) is not null or
    cardinality(p_ids)<>(select count(distinct id) from unnest(p_ids)id) then
    raise exception 'MESSAGE_PREVIEWS_INVALID' using errcode='23514';
  end if;
  perform 1 from public.messages where artist_id=p_artist order by id for update;
  if exists(select 1 from unnest(p_ids)u(id) where not exists(select 1 from public.messages m
    where m.id=u.id and m.artist_id=p_artist and m.status='sent' and m.sent_at<=clock_timestamp()
      and (m.type='text' or exists(select 1 from public.message_media mm where mm.message_id=m.id)))) then
    raise exception 'MESSAGE_PREVIEWS_INVALID' using errcode='23514';
  end if;
  update public.messages set is_preview=false,preview_order=null where artist_id=p_artist and is_preview;
  update public.messages m set is_preview=true,preview_order=u.ordinality::smallint
    from unnest(p_ids) with ordinality u(id,ordinality) where m.id=u.id and m.artist_id=p_artist;
  update public.artists set revision=revision where id=p_artist;
end;
$$;
create or replace function public.messaging_set_previews(p_actor_id uuid,p_artist_id uuid,p_message_ids uuid[]) returns void
language plpgsql security definer set search_path='' as $$
declare before_value jsonb;
begin
  perform private.require_message_service();
  perform private.require_message_author(p_actor_id,p_artist_id,true);
  if not exists(select 1 from public.profiles where id=p_actor_id and role='admin') then
    raise exception 'MESSAGE_ADMIN_REQUIRED' using errcode='42501';
  end if;
  before_value:=private.admin_artist_projection(p_artist_id);
  perform private.admin_artist_apply_previews(p_artist_id,p_message_ids);
  insert into private.admin_artist_audit(actor_id,artist_id,action,before_value,after_value)
    values(p_actor_id,p_artist_id,'legacy_previews',before_value,
      jsonb_build_object('artist',private.admin_artist_projection(p_artist_id),'message_ids',p_message_ids));
end;
$$;
create function public.admin_artist_previews(p_artist_id uuid,p_operation_id uuid,p_expected_revision bigint,p_message_ids uuid[]) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid; a public.artists%rowtype; req jsonb; prior jsonb; before_value jsonb;
begin
  actor:=private.admin_artist_actor();
  if p_expected_revision is null or p_expected_revision not between 1 and 9007199254740990 then
    raise exception 'ADMIN_ARTIST_INVALID_INPUT' using errcode='22023'; end if;
  a:=private.admin_artist_lock(p_artist_id);
  req:=jsonb_build_object('action','previews','artist_id',p_artist_id,'expected_revision',p_expected_revision,'message_ids',p_message_ids);
  prior:=private.admin_artist_operation(actor,p_operation_id,req);
  if prior is not null then return prior; end if;
  if a.revision<>p_expected_revision then raise exception 'ADMIN_ARTIST_REVISION_CONFLICT' using errcode='40001'; end if;
  before_value:=jsonb_build_object('artist',private.admin_artist_projection(a.id),'message_ids',
    coalesce((select jsonb_agg(id order by preview_order) from public.messages where artist_id=a.id and is_preview),'[]'::jsonb));
  begin perform private.admin_artist_apply_previews(a.id,p_message_ids);
  exception when check_violation then raise exception 'ADMIN_ARTIST_PREVIEWS_INVALID' using errcode='23514';
    when sqlstate '55000' then raise exception 'ADMIN_ARTIST_SETUP_NOT_READY' using errcode='55000'; end;
  return private.admin_artist_record(actor,a.id,p_operation_id,req,before_value,private.admin_artist_projection(a.id));
end;
$$;

create function public.admin_artist_invite(p_artist_id uuid,p_target_user_id uuid,p_is_manager boolean,p_operation_id uuid,p_expected_revision bigint,p_confirmed boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid; a public.artists%rowtype; cfg private.artist_account_link_policy%rowtype; req jsonb; prior jsonb; invitation uuid;
begin
  actor:=private.admin_artist_actor(p_target_user_id);
  if p_target_user_id is null or p_is_manager is null or p_confirmed is distinct from true or
    p_expected_revision is null or p_expected_revision not between 1 and 9007199254740990 then
    raise exception 'ADMIN_ARTIST_INVALID_INPUT' using errcode='22023'; end if;
  perform private.admin_artist_target(p_target_user_id);
  a:=private.admin_artist_lock(p_artist_id);
  if a.status<>'active' then raise exception 'ADMIN_ARTIST_ACCOUNT_UNAVAILABLE' using errcode='42501'; end if;
  cfg:=private.admin_artist_lock_policy();
  req:=jsonb_build_object('action','invite','artist_id',p_artist_id,'target_user_id',p_target_user_id,
    'is_manager',p_is_manager,'expected_revision',p_expected_revision);
  prior:=private.admin_artist_operation(actor,p_operation_id,req);
  if prior is not null then
    -- Replay is a current-state read, never resurrection of canceled/expired intent.
    return private.admin_artist_invitation_projection((prior->>'id')::uuid);
  end if;
  if a.revision<>p_expected_revision then raise exception 'ADMIN_ARTIST_REVISION_CONFLICT' using errcode='40001'; end if;
  if exists(select 1 from public.artist_members where artist_id=a.id and user_id=p_target_user_id) then
    raise exception 'ADMIN_ARTIST_ACCOUNT_UNAVAILABLE' using errcode='42501'; end if;
  update private.artist_account_invitations set state='expired',revision=revision+1 where artist_id=a.id and target_user_id=p_target_user_id
    and state='pending' and expires_at<=clock_timestamp();
  if exists(select 1 from private.artist_account_invitations where artist_id=a.id and target_user_id=p_target_user_id and state='pending') then
    raise exception 'ADMIN_ARTIST_OPERATION_CONFLICT' using errcode='23505'; end if;
  insert into private.artist_account_invitations(artist_id,target_user_id,invited_by,is_manager,expires_at)
    values(a.id,p_target_user_id,actor,p_is_manager,clock_timestamp()+make_interval(hours=>cfg.invitation_ttl_hours)) returning id into invitation;
  update public.artists set revision=revision where id=a.id;
  return private.admin_artist_record(actor,a.id,p_operation_id,req,null,private.admin_artist_invitation_projection(invitation));
end;
$$;
create function public.admin_artist_cancel_invite(p_invitation_id uuid,p_operation_id uuid,p_expected_revision bigint,p_confirmed boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid; i private.artist_account_invitations%rowtype; req jsonb; prior jsonb; before_value jsonb;
begin
  select * into i from private.artist_account_invitations where id=p_invitation_id;
  actor:=private.admin_artist_actor(i.target_user_id);
  if i.id is null then raise exception 'ADMIN_ARTIST_NOT_FOUND' using errcode='P0002'; end if;
  if p_confirmed is distinct from true or p_expected_revision is null or p_expected_revision not between 1 and 9007199254740990 then
    raise exception 'ADMIN_ARTIST_INVALID_INPUT' using errcode='22023'; end if;
  perform private.admin_artist_lock(i.artist_id);
  select * into strict i from private.artist_account_invitations where id=i.id for update;
  req:=jsonb_build_object('action','cancel_invite','invitation_id',p_invitation_id,'expected_revision',p_expected_revision);
  prior:=private.admin_artist_operation(actor,p_operation_id,req);
  if prior is not null then return private.admin_artist_invitation_projection(i.id); end if;
  if i.revision<>p_expected_revision then raise exception 'ADMIN_ARTIST_REVISION_CONFLICT' using errcode='40001'; end if;
  if i.state<>'pending' then raise exception 'ADMIN_ARTIST_INVITATION_CLOSED' using errcode='55000'; end if;
  before_value:=private.admin_artist_invitation_projection(i.id);
  update private.artist_account_invitations set state='canceled',revision=revision+1,responded_at=clock_timestamp() where id=i.id;
  update public.artists set revision=revision where id=i.artist_id;
  return private.admin_artist_record(actor,i.artist_id,p_operation_id,req,before_value,private.admin_artist_invitation_projection(i.id));
end;
$$;
create function public.admin_artist_unlink(p_artist_id uuid,p_target_user_id uuid,p_operation_id uuid,p_expected_revision bigint,p_confirmed boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid; a public.artists%rowtype; req jsonb; prior jsonb; before_value jsonb;
begin
  actor:=private.admin_artist_actor(p_target_user_id);
  if p_target_user_id is null or p_confirmed is distinct from true or p_expected_revision is null or p_expected_revision not between 1 and 9007199254740990 then
    raise exception 'ADMIN_ARTIST_INVALID_INPUT' using errcode='22023'; end if;
  a:=private.admin_artist_lock(p_artist_id);
  req:=jsonb_build_object('action','unlink','artist_id',p_artist_id,'target_user_id',p_target_user_id,'expected_revision',p_expected_revision);
  prior:=private.admin_artist_operation(actor,p_operation_id,req);
  if prior is not null then return prior; end if;
  if a.revision<>p_expected_revision then raise exception 'ADMIN_ARTIST_REVISION_CONFLICT' using errcode='40001'; end if;
  before_value:=private.admin_artist_projection(a.id);
  delete from public.artist_members where artist_id=a.id and user_id=p_target_user_id;
  if not found then raise exception 'ADMIN_ARTIST_NOT_FOUND' using errcode='P0002'; end if;
  update private.artist_account_invitations set state='canceled',revision=revision+1,responded_at=clock_timestamp()
    where artist_id=a.id and target_user_id=p_target_user_id and state='pending';
  -- Do not demote an administrator or rewrite unrelated fan preferences.
  update public.profiles set role='fan' where id=p_target_user_id and role='artist' and
    not exists(select 1 from public.artist_members where user_id=p_target_user_id);
  update public.artists set revision=revision where id=a.id;
  return private.admin_artist_record(actor,a.id,p_operation_id,req,before_value,private.admin_artist_projection(a.id));
end;
$$;
create function public.artist_account_invitations() returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); p public.profiles%rowtype;
begin
  select * into p from public.profiles where id=actor for share;
  if p.id is null or p.role not in('fan','artist') or (p.is_restricted and (p.restricted_until is null or p.restricted_until>clock_timestamp())) then
    raise exception 'ADMIN_ARTIST_FORBIDDEN' using errcode='42501'; end if;
  return jsonb_build_object('invitations',coalesce((select jsonb_agg(private.admin_artist_invitation_projection(i.id) order by i.actionable desc,i.created_at desc,i.id desc)
    from(select id,created_at,(state='pending' and expires_at>clock_timestamp()) as actionable from private.artist_account_invitations
      where target_user_id=actor order by actionable desc,created_at desc,id desc limit 50)i),'[]'::jsonb),
    'has_more',(select count(*)>50 from private.artist_account_invitations where target_user_id=actor),'account_link_ready',private.admin_artist_policy_ready());
end;
$$;
create function public.artist_account_respond(p_invitation_id uuid,p_operation_id uuid,p_expected_revision bigint,p_accept boolean,p_confirmed boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); p public.profiles%rowtype; i private.artist_account_invitations%rowtype;
  a public.artists%rowtype; req jsonb; prior jsonb; before_value jsonb;
begin
  select * into i from private.artist_account_invitations where id=p_invitation_id and target_user_id=actor;
  perform private.admin_artist_lock_profiles(array[actor,i.invited_by]);
  select * into p from public.profiles where id=actor;
  if p.id is null or p.role not in('fan','artist') or (p.is_restricted and (p.restricted_until is null or p.restricted_until>clock_timestamp())) then
    raise exception 'ADMIN_ARTIST_FORBIDDEN' using errcode='42501'; end if;
  if i.id is null then raise exception 'ADMIN_ARTIST_NOT_FOUND' using errcode='P0002'; end if;
  if p_accept is null or p_confirmed is distinct from true or p_expected_revision is null or p_expected_revision not between 1 and 9007199254740990 then
    raise exception 'ADMIN_ARTIST_INVALID_INPUT' using errcode='22023'; end if;
  a:=private.admin_artist_lock(i.artist_id);
  select * into strict i from private.artist_account_invitations where id=i.id for update;
  req:=jsonb_build_object('action',case when p_accept then 'accept_invite' else 'decline_invite' end,'invitation_id',p_invitation_id,'expected_revision',p_expected_revision);
  if p_accept then
    perform private.admin_artist_require_admin(i.invited_by);
    perform private.admin_artist_target(actor);
    perform private.admin_artist_lock_policy();
    if a.status<>'active' then raise exception 'ADMIN_ARTIST_ACCOUNT_UNAVAILABLE' using errcode='42501'; end if;
  end if;
  prior:=private.admin_artist_operation(actor,p_operation_id,req);
  if prior is not null then return private.admin_artist_invitation_projection(i.id); end if;
  if i.revision<>p_expected_revision then raise exception 'ADMIN_ARTIST_REVISION_CONFLICT' using errcode='40001'; end if;
  if i.state<>'pending' then raise exception 'ADMIN_ARTIST_INVITATION_CLOSED' using errcode='55000'; end if;
  if i.expires_at<=clock_timestamp() then raise exception 'ADMIN_ARTIST_INVITATION_EXPIRED' using errcode='55000'; end if;
  before_value:=private.admin_artist_invitation_projection(i.id);
  if p_accept then
    if exists(select 1 from public.artist_members where artist_id=a.id and user_id=actor) then
      raise exception 'ADMIN_ARTIST_ACCOUNT_UNAVAILABLE' using errcode='42501'; end if;
    update public.profiles set role='artist' where id=actor and role='fan';
    insert into public.artist_members(artist_id,user_id,is_manager) values(a.id,actor,i.is_manager);
  end if;
  update private.artist_account_invitations set state=case when p_accept then 'accepted' else 'declined' end,
    revision=revision+1,responded_at=clock_timestamp() where id=i.id;
  update public.artists set revision=revision where id=a.id;
  return private.admin_artist_record(actor,a.id,p_operation_id,req,before_value,private.admin_artist_invitation_projection(i.id));
end;
$$;

revoke all on function private.admin_artist_audit_immutable(),private.admin_artist_revision(),private.admin_artist_preview_changed(),
  private.admin_artist_lock_profiles(uuid[]),private.admin_artist_require_admin(uuid),private.admin_artist_actor(uuid),
  private.admin_artist_policy_ready(),private.admin_artist_lock_policy(),private.admin_artist_target(uuid),
  private.admin_artist_projection(uuid),private.admin_artist_invitation_projection(uuid),private.admin_artist_message_projection(uuid),
  private.admin_artist_operation(uuid,uuid,jsonb),private.admin_artist_record(uuid,uuid,uuid,jsonb,jsonb,jsonb),
  private.admin_artist_lock(uuid,bigint),private.admin_artist_apply_previews(uuid,uuid[])
  from public,anon,authenticated,service_role;
revoke all on function public.admin_artist_list(integer),public.admin_artist_detail(uuid),public.admin_artist_save(uuid,uuid,bigint,jsonb),
  public.admin_artist_previews(uuid,uuid,bigint,uuid[]),public.admin_artist_invite(uuid,uuid,boolean,uuid,bigint,boolean),
  public.admin_artist_cancel_invite(uuid,uuid,bigint,boolean),public.admin_artist_unlink(uuid,uuid,uuid,bigint,boolean),
  public.artist_account_invitations(),public.artist_account_respond(uuid,uuid,bigint,boolean,boolean)
  from public,anon,authenticated,service_role;
grant execute on function public.admin_artist_list(integer),public.admin_artist_detail(uuid),public.admin_artist_save(uuid,uuid,bigint,jsonb),
  public.admin_artist_previews(uuid,uuid,bigint,uuid[]),public.admin_artist_invite(uuid,uuid,boolean,uuid,bigint,boolean),
  public.admin_artist_cancel_invite(uuid,uuid,bigint,boolean),public.admin_artist_unlink(uuid,uuid,uuid,bigint,boolean),
  public.artist_account_invitations(),public.artist_account_respond(uuid,uuid,bigint,boolean,boolean) to authenticated;

commit;
