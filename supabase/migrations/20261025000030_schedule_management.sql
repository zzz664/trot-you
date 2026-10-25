-- Schedule UI contracts only: public event data, own subscription filter, and
-- audited administrative CAS/idempotency. No notices, policy or external I/O.
begin;
alter table public.schedules add column revision bigint not null default 1
  check(revision between 1 and 9007199254740991);
create function private.schedule_revision() returns trigger
language plpgsql set search_path='' as $$
begin
  if new.artist_id<>old.artist_id then raise exception 'SCHEDULE_INVALID_INPUT' using errcode='22023'; end if;
  new.revision:=old.revision+1;
  return new;
end;
$$;
create trigger schedule_revision before update on public.schedules
  for each row execute function private.schedule_revision();
-- Legacy schedule RPCs remain compatible, but any such update invalidates new
-- administrative forms. New application writes exclusively use the CAS RPCs.
create table private.schedule_admin_operations (
  actor_id uuid not null references public.profiles(id) on delete restrict,
  operation_id uuid not null,
  request jsonb not null check(jsonb_typeof(request)='object'),
  response jsonb not null check(jsonb_typeof(response)='object'),
  created_at timestamptz not null default clock_timestamp(),
  primary key(actor_id,operation_id)
);
alter table private.schedule_admin_operations enable row level security;
revoke all on private.schedule_admin_operations from public,anon,authenticated,service_role;
create function private.schedule_operation_immutable() returns trigger
language plpgsql set search_path='' as $$
begin raise exception 'SCHEDULE_OPERATION_IMMUTABLE' using errcode='55000'; end;
$$;
create trigger schedule_operation_immutable before update or delete on private.schedule_admin_operations
  for each row execute function private.schedule_operation_immutable();
create trigger schedule_operation_no_truncate before truncate on private.schedule_admin_operations
  for each statement execute function private.schedule_operation_immutable();

create function private.schedule_ui_actor(p_admin boolean,p_write boolean default false) returns uuid
language plpgsql security definer set search_path='' as $$
declare actor public.profiles%rowtype;
begin
  if current_setting('transaction_isolation')<>'read committed' then
    raise exception 'SCHEDULE_ISOLATION_UNSUPPORTED' using errcode='25001'; end if;
  if current_setting('role',true) is distinct from 'authenticated' then
    raise exception 'CALENDAR_FORBIDDEN' using errcode='42501'; end if;
  if p_write then select * into actor from public.profiles where id=auth.uid() for update;
  else select * into actor from public.profiles where id=auth.uid() for share; end if;
  if actor.id is null or (p_admin and actor.role<>'admin')
    or (actor.role='fan' and actor.onboarding_completed_at is null)
    or (actor.is_restricted and (actor.restricted_until is null or actor.restricted_until>clock_timestamp())) then
    raise exception 'CALENDAR_FORBIDDEN' using errcode='42501'; end if;
  return actor.id;
end;
$$;
create function private.schedule_admin_projection(p_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('id',s.id,'artist_id',s.artist_id,'artist_slug',a.slug,'artist_name',a.name,
    'artist_status',a.status,'type',s.type,'status',s.status,'title',s.title,'description',s.description,
    'starts_at',s.starts_at,'ends_at',s.ends_at,'place_name',s.place_name,'address',s.address,
    'lat',s.lat,'lng',s.lng,'created_at',s.created_at,'updated_at',s.updated_at,'revision',s.revision)
  from public.schedules s join public.artists a on a.id=s.artist_id where s.id=p_id;
$$;
create function public.schedule_admin_get(p_schedule_id uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare result jsonb;
begin
  perform private.schedule_ui_actor(true);
  result:=private.schedule_admin_projection(p_schedule_id);
  if result is null then raise exception 'SCHEDULE_UNAVAILABLE' using errcode='42501'; end if;
  return result;
end;
$$;
create function public.schedule_admin_list(p_month date,p_page integer default 1) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare bounds tstzrange; result jsonb;
begin
  perform private.schedule_ui_actor(true);
  bounds:=private.calendar_month_bounds(p_month);
  if p_page is null or p_page not between 1 and 1000 then raise exception 'SCHEDULE_INVALID_INPUT' using errcode='22023'; end if;
  with page as materialized (
    select s.id,s.starts_at from public.schedules s where s.starts_at<upper(bounds)
      and ((s.ends_at is null and s.starts_at>=lower(bounds)) or s.ends_at>lower(bounds))
    order by s.starts_at,s.id offset (p_page-1)*30 limit 31
  ), visible as (select * from page order by starts_at,id limit 30)
  select jsonb_build_object('month',to_char(p_month,'YYYY-MM-DD'),'page',p_page,'page_size',30,
    'has_more',(select count(*)>30 from page),
    'items',coalesce((select jsonb_agg(private.schedule_admin_projection(id) order by starts_at,id) from visible),'[]'::jsonb)) into result;
  return result;
end;
$$;
create function public.schedule_my_artists() returns uuid[]
language plpgsql volatile security definer set search_path='' as $$
declare actor uuid; stamp timestamptz;
begin
  actor:=private.schedule_ui_actor(false);
  stamp:=clock_timestamp();
  return coalesce((select array_agg(a.id order by a.id) from public.artists a where a.status='active'
    and private.has_subscription_access(actor,a.id,stamp)),'{}'::uuid[]);
end;
$$;

create function private.schedule_parse_input(p_input jsonb) returns public.schedules
language plpgsql set search_path='' as $$
declare parsed public.schedules%rowtype; key text;
begin
  if p_input is null or jsonb_typeof(p_input)<>'object' then
    raise exception 'SCHEDULE_INVALID_INPUT' using errcode='22023'; end if;
  -- Exact public payload: no caller-supplied author, revision or stored URL.
  if (select count(*) from jsonb_object_keys(p_input))<>11 or not p_input ?& array[
    'artist_id','type','status','title','description','starts_at','ends_at','place_name','address','lat','lng'] then
    raise exception 'SCHEDULE_INVALID_INPUT' using errcode='22023'; end if;
  foreach key in array array['artist_id','type','status','title','starts_at'] loop
    if jsonb_typeof(p_input->key)<>'string' then raise exception 'SCHEDULE_INVALID_INPUT' using errcode='22023'; end if;
  end loop;
  foreach key in array array['description','ends_at','place_name','address'] loop
    if jsonb_typeof(p_input->key) not in('string','null') then raise exception 'SCHEDULE_INVALID_INPUT' using errcode='22023'; end if;
  end loop;
  foreach key in array array['lat','lng'] loop
    if jsonb_typeof(p_input->key) not in('number','null') then raise exception 'SCHEDULE_INVALID_INPUT' using errcode='22023'; end if;
  end loop;
  if p_input->>'starts_at' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$'
    or (p_input->>'ends_at' is not null and p_input->>'ends_at' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$') then
    raise exception 'SCHEDULE_INVALID_INPUT' using errcode='22023'; end if;
  select * into parsed from jsonb_populate_record(null::public.schedules,p_input);
  if parsed.title !~ '[^[:space:]]' or length(parsed.title)>1000 or length(parsed.description)>100000
    or (parsed.place_name is not null and (parsed.place_name !~ '[^[:space:]]' or length(parsed.place_name)>2000))
    or (parsed.address is not null and (parsed.address !~ '[^[:space:]]' or length(parsed.address)>2000))
    or not isfinite(parsed.starts_at) or parsed.starts_at<(timestamp '0001-01-01' at time zone 'Asia/Seoul')
    or parsed.starts_at>=(timestamp '10000-01-01' at time zone 'Asia/Seoul')
    or (parsed.ends_at is not null and (not isfinite(parsed.ends_at) or parsed.ends_at<=parsed.starts_at
      or parsed.ends_at>(timestamp '10000-01-01' at time zone 'Asia/Seoul')))
    or (parsed.lat is null)<>(parsed.lng is null)
    or (parsed.lat is not null and not (parsed.lat between -90 and 90 and parsed.lng between -180 and 180)) then
    raise exception 'SCHEDULE_INVALID_INPUT' using errcode='22023'; end if;
  return parsed;
exception when invalid_text_representation or datetime_field_overflow or invalid_datetime_format or numeric_value_out_of_range then
  raise exception 'SCHEDULE_INVALID_INPUT' using errcode='22023';
end;
$$;
create function public.schedule_admin_save(p_operation_id uuid,p_schedule_id uuid default null,p_expected_revision bigint default null,p_input jsonb default null,p_confirmed boolean default false) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare actor uuid; input public.schedules%rowtype; prior public.schedules%rowtype; event_id uuid;
  request_value jsonb; prior_operation private.schedule_admin_operations%rowtype; result jsonb;
begin
  actor:=private.schedule_ui_actor(true,true);
  if p_operation_id is null or (p_schedule_id is null)<>(p_expected_revision is null)
    or (p_expected_revision is not null and p_expected_revision not between 1 and 9007199254740990) then
    raise exception 'SCHEDULE_INVALID_INPUT' using errcode='22023'; end if;
  input:=private.schedule_parse_input(p_input);
  if input.status='published' and p_confirmed is distinct from true then
    raise exception 'SCHEDULE_CONFIRMATION_REQUIRED' using errcode='22023'; end if;
  request_value:=jsonb_build_object('action','save','id',p_schedule_id,'revision',p_expected_revision,'input',p_input);
  select * into prior_operation from private.schedule_admin_operations where actor_id=actor and operation_id=p_operation_id;
  if found then
    if prior_operation.request<>request_value then raise exception 'SCHEDULE_OPERATION_CONFLICT' using errcode='23505'; end if;
    return prior_operation.response;
  end if;
  if p_schedule_id is null then
    event_id:=public.schedule_create(input.artist_id,input.type,input.title,input.starts_at,input.ends_at,input.description,
      input.place_name,input.address,input.lat,input.lng,input.status);
  else
    prior:=private.lock_schedule(p_schedule_id);
    if prior.artist_id<>input.artist_id then raise exception 'SCHEDULE_INVALID_INPUT' using errcode='22023'; end if;
    if prior.revision<>p_expected_revision then raise exception 'SCHEDULE_REVISION_CONFLICT' using errcode='40001'; end if;
    event_id:=public.schedule_update(p_schedule_id,input.type,input.title,input.starts_at,input.ends_at,input.description,
      input.place_name,input.address,input.lat,input.lng,input.status);
  end if;
  result:=private.schedule_admin_projection(event_id);
  insert into private.schedule_admin_operations(actor_id,operation_id,request,response) values(actor,p_operation_id,request_value,result);
  return result;
end;
$$;
create function public.schedule_admin_delete(p_operation_id uuid,p_schedule_id uuid,p_expected_revision bigint,p_confirmed boolean) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare actor uuid; prior public.schedules%rowtype; request_value jsonb; prior_operation private.schedule_admin_operations%rowtype; result jsonb;
begin
  actor:=private.schedule_ui_actor(true,true);
  if p_confirmed is distinct from true then raise exception 'SCHEDULE_CONFIRMATION_REQUIRED' using errcode='22023'; end if;
  if p_operation_id is null or p_schedule_id is null or p_expected_revision is null or p_expected_revision not between 1 and 9007199254740991 then
    raise exception 'SCHEDULE_INVALID_INPUT' using errcode='22023'; end if;
  request_value:=jsonb_build_object('action','delete','id',p_schedule_id,'revision',p_expected_revision);
  select * into prior_operation from private.schedule_admin_operations where actor_id=actor and operation_id=p_operation_id;
  if found then
    if prior_operation.request<>request_value then raise exception 'SCHEDULE_OPERATION_CONFLICT' using errcode='23505'; end if;
    return prior_operation.response;
  end if;
  prior:=private.lock_schedule(p_schedule_id);
  if prior.revision<>p_expected_revision then raise exception 'SCHEDULE_REVISION_CONFLICT' using errcode='40001'; end if;
  perform public.schedule_delete(p_schedule_id);
  result:=jsonb_build_object('id',p_schedule_id,'deleted',true);
  insert into private.schedule_admin_operations(actor_id,operation_id,request,response) values(actor,p_operation_id,request_value,result);
  return result;
end;
$$;

do $$declare fn regprocedure; begin
  for fn in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where (n.nspname='public' and p.proname in('schedule_admin_get','schedule_admin_list','schedule_admin_save','schedule_admin_delete','schedule_my_artists'))
      or (n.nspname='private' and p.proname in('schedule_revision','schedule_operation_immutable','schedule_ui_actor','schedule_admin_projection','schedule_parse_input'))
  loop execute format('revoke all on function %s from public,anon,authenticated,service_role',fn); end loop;
end;$$;
grant execute on function public.schedule_admin_get(uuid),public.schedule_admin_list(date,integer),public.schedule_my_artists(),
  public.schedule_admin_save(uuid,uuid,bigint,jsonb,boolean),public.schedule_admin_delete(uuid,uuid,bigint,boolean) to authenticated;
commit;
