-- Private editorial planning only. No messages, schedules, notifications,
-- contract policies, grades, provider calls or publishing are created here.
begin;

alter table public.content_calendar add column revision bigint not null default 1
  check (revision between 1 and 9007199254740991);
create function private.content_calendar_revision() returns trigger
language plpgsql set search_path='' as $$
begin new.revision:=old.revision+1; return new; end;
$$;
create trigger content_calendar_revision before update on public.content_calendar
  for each row execute function private.content_calendar_revision();
-- Legacy authenticated CRUD remains compatible. Every legacy/operator update
-- invalidates a newly loaded CAS form, including updates outside this UI.
create table private.content_calendar_operations (
  actor_id uuid not null references public.profiles(id) on delete restrict,
  operation_id uuid not null,
  request jsonb not null check (jsonb_typeof(request)='object'),
  response jsonb not null check (jsonb_typeof(response)='object'),
  created_at timestamptz not null default clock_timestamp(),
  primary key(actor_id,operation_id)
);
alter table private.content_calendar_operations enable row level security;
revoke all on private.content_calendar_operations from public,anon,authenticated,service_role;
create function private.content_calendar_operation_immutable() returns trigger
language plpgsql set search_path='' as $$
begin raise exception 'CONTENT_CALENDAR_OPERATION_IMMUTABLE' using errcode='55000'; end;
$$;
create trigger content_calendar_operation_immutable before update or delete on private.content_calendar_operations
  for each row execute function private.content_calendar_operation_immutable();
create trigger content_calendar_operation_no_truncate before truncate on private.content_calendar_operations
  for each statement execute function private.content_calendar_operation_immutable();

create function private.content_calendar_projection(p_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('id',c.id,'artist_id',c.artist_id,'date',c.date,'topic',c.topic,
    'example_text',c.example_text,'created_at',c.created_at,'updated_at',c.updated_at,'revision',c.revision)
  from public.content_calendar c where c.id=p_id;
$$;
create function private.content_calendar_month_entries(p_artist_id uuid,p_month date) returns jsonb
language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(private.content_calendar_projection(c.id) order by c.date,c.id),'[]'::jsonb)
  from public.content_calendar c where c.artist_id=p_artist_id and c.date>=p_month
    and c.date<(p_month+interval '1 month')::date;
$$;

create function public.content_calendar_artist_context(p_artist_slug text,p_month date) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare actor uuid; artist public.artists%rowtype; stamp timestamptz;
begin
  actor:=private.artist_reply_activity_actor();
  artist:=private.artist_reply_activity_artist(actor,p_artist_slug);
  perform private.calendar_month_bounds(p_month);
  -- Locks use the established profile -> artist -> membership order. Compute the
  -- clock only after waiting, and use one current source snapshot for all data.
  stamp:=clock_timestamp();
  return jsonb_build_object('artist',jsonb_build_object('id',artist.id,'slug',artist.slug,'name',artist.name),
    'month',to_char(p_month,'YYYY-MM-DD'),'server_now',stamp,
    'entries',private.content_calendar_month_entries(artist.id,p_month),
    'activity',private.artist_reply_activity_week(artist.id,stamp));
end;
$$;
create function public.content_calendar_admin_list(p_artist_id uuid,p_month date) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare artist public.artists%rowtype; stamp timestamptz;
begin
  perform private.schedule_ui_actor(true);
  select * into artist from public.artists where id=p_artist_id for share;
  if artist.id is null then raise exception 'CALENDAR_ARTIST_UNAVAILABLE' using errcode='42501'; end if;
  perform private.calendar_month_bounds(p_month);
  stamp:=clock_timestamp();
  return jsonb_build_object('artist',jsonb_build_object('id',artist.id,'slug',artist.slug,'name',artist.name,'status',artist.status),
    'month',to_char(p_month,'YYYY-MM-DD'),'server_now',stamp,
    'entries',private.content_calendar_month_entries(artist.id,p_month),
    'activity',private.artist_reply_activity_week(artist.id,stamp));
end;
$$;

create function private.content_calendar_parse_input(p_input jsonb) returns public.content_calendar
language plpgsql set search_path='' as $$
declare parsed public.content_calendar%rowtype; key text;
begin
  if p_input is null or jsonb_typeof(p_input)<>'object' then
    raise exception 'CONTENT_CALENDAR_INVALID_INPUT' using errcode='22023'; end if;
  if (select count(*) from jsonb_object_keys(p_input))<>4
    or not p_input ?& array['artist_id','date','topic','example_text'] then
    raise exception 'CONTENT_CALENDAR_INVALID_INPUT' using errcode='22023'; end if;
  foreach key in array array['artist_id','date','topic'] loop
    if jsonb_typeof(p_input->key)<>'string' then
      raise exception 'CONTENT_CALENDAR_INVALID_INPUT' using errcode='22023'; end if;
  end loop;
  if jsonb_typeof(p_input->'example_text') not in('string','null')
    or p_input->>'date' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    raise exception 'CONTENT_CALENDAR_INVALID_INPUT' using errcode='22023'; end if;
  select * into parsed from jsonb_populate_record(null::public.content_calendar,p_input);
  parsed.topic:=regexp_replace(parsed.topic,'^[[:space:]]+|[[:space:]]+$','','g');
  if parsed.topic ~ '[[:cntrl:]]' or regexp_replace(parsed.example_text,E'[\n\r\t]','','g') ~ '[[:cntrl:]]'
    or parsed.date is null or not isfinite(parsed.date) or parsed.date not between date '0001-01-01' and date '9999-12-31'
    or parsed.topic !~ '[^[:space:]]' or length(parsed.topic)>1000 or length(parsed.example_text)>100000 then
    raise exception 'CONTENT_CALENDAR_INVALID_INPUT' using errcode='22023'; end if;
  return parsed;
exception when invalid_text_representation or datetime_field_overflow or invalid_datetime_format or numeric_value_out_of_range then
  raise exception 'CONTENT_CALENDAR_INVALID_INPUT' using errcode='22023';
end;
$$;

create function public.content_calendar_admin_save(p_operation_id uuid,p_entry_id uuid default null,
  p_expected_revision bigint default null,p_input jsonb default null) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare actor uuid; input public.content_calendar%rowtype; prior public.content_calendar%rowtype;
  entry public.content_calendar%rowtype; request_value jsonb; prior_operation private.content_calendar_operations%rowtype; result jsonb;
begin
  actor:=private.schedule_ui_actor(true,true);
  if p_operation_id is null or (p_entry_id is null)<>(p_expected_revision is null)
    or (p_expected_revision is not null and p_expected_revision not between 1 and 9007199254740990) then
    raise exception 'CONTENT_CALENDAR_INVALID_INPUT' using errcode='22023'; end if;
  input:=private.content_calendar_parse_input(p_input);
  request_value:=jsonb_build_object('action','save','id',p_entry_id,'revision',p_expected_revision,'input',p_input);
  select * into prior_operation from private.content_calendar_operations where actor_id=actor and operation_id=p_operation_id;
  if found then
    if prior_operation.request<>request_value then raise exception 'CONTENT_CALENDAR_OPERATION_CONFLICT' using errcode='23505'; end if;
    return prior_operation.response;
  end if;
  -- The artist row also serializes an absent date slot and all legacy upserts.
  perform 1 from public.artists where id=input.artist_id for update;
  if not found then raise exception 'CALENDAR_ARTIST_UNAVAILABLE' using errcode='42501'; end if;
  if p_entry_id is null then
    if exists(select 1 from public.content_calendar where artist_id=input.artist_id and date=input.date) then
      raise exception 'CONTENT_CALENDAR_DATE_CONFLICT' using errcode='23505'; end if;
    insert into public.content_calendar(artist_id,date,topic,example_text,created_by)
      values(input.artist_id,input.date,input.topic,input.example_text,actor) returning * into entry;
    insert into public.calendar_audit_log(actor_id,target_type,target_id,action,after_data)
      values(actor,'content_calendar',entry.id,'create',to_jsonb(entry));
  else
    select * into prior from public.content_calendar where id=p_entry_id for update;
    if prior.id is null then raise exception 'CONTENT_CALENDAR_ENTRY_UNAVAILABLE' using errcode='42501'; end if;
    if prior.artist_id<>input.artist_id or prior.date<>input.date then
      raise exception 'CONTENT_CALENDAR_INVALID_INPUT' using errcode='22023'; end if;
    if prior.revision<>p_expected_revision then raise exception 'CONTENT_CALENDAR_REVISION_CONFLICT' using errcode='40001'; end if;
    if prior.topic is not distinct from input.topic and prior.example_text is not distinct from input.example_text then
      entry:=prior;
    else
      update public.content_calendar set topic=input.topic,example_text=input.example_text where id=p_entry_id returning * into entry;
      insert into public.calendar_audit_log(actor_id,target_type,target_id,action,before_data,after_data)
        values(actor,'content_calendar',entry.id,'update',to_jsonb(prior),to_jsonb(entry));
    end if;
  end if;
  result:=private.content_calendar_projection(entry.id);
  insert into private.content_calendar_operations(actor_id,operation_id,request,response) values(actor,p_operation_id,request_value,result);
  return result;
end;
$$;
create function public.content_calendar_admin_delete(p_operation_id uuid,p_entry_id uuid,
  p_expected_revision bigint,p_confirmed boolean) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare actor uuid; prior public.content_calendar%rowtype; artist uuid; request_value jsonb;
  prior_operation private.content_calendar_operations%rowtype; result jsonb;
begin
  actor:=private.schedule_ui_actor(true,true);
  if p_confirmed is distinct from true then raise exception 'CONTENT_CALENDAR_CONFIRMATION_REQUIRED' using errcode='22023'; end if;
  if p_operation_id is null or p_entry_id is null or p_expected_revision is null
    or p_expected_revision not between 1 and 9007199254740991 then
    raise exception 'CONTENT_CALENDAR_INVALID_INPUT' using errcode='22023'; end if;
  request_value:=jsonb_build_object('action','delete','id',p_entry_id,'revision',p_expected_revision);
  select * into prior_operation from private.content_calendar_operations where actor_id=actor and operation_id=p_operation_id;
  if found then
    if prior_operation.request<>request_value then raise exception 'CONTENT_CALENDAR_OPERATION_CONFLICT' using errcode='23505'; end if;
    return prior_operation.response;
  end if;
  select artist_id into artist from public.content_calendar where id=p_entry_id;
  if artist is null then raise exception 'CONTENT_CALENDAR_ENTRY_UNAVAILABLE' using errcode='42501'; end if;
  perform 1 from public.artists where id=artist for update;
  select * into prior from public.content_calendar where id=p_entry_id for update;
  if prior.id is null then raise exception 'CONTENT_CALENDAR_ENTRY_UNAVAILABLE' using errcode='42501'; end if;
  if prior.revision<>p_expected_revision then raise exception 'CONTENT_CALENDAR_REVISION_CONFLICT' using errcode='40001'; end if;
  insert into public.calendar_audit_log(actor_id,target_type,target_id,action,before_data)
    values(actor,'content_calendar',prior.id,'delete',to_jsonb(prior));
  delete from public.content_calendar where id=p_entry_id;
  result:=jsonb_build_object('id',p_entry_id,'deleted',true);
  insert into private.content_calendar_operations(actor_id,operation_id,request,response) values(actor,p_operation_id,request_value,result);
  return result;
end;
$$;

do $$declare fn regprocedure; begin
  for fn in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where (n.nspname='public' and p.proname in('content_calendar_artist_context','content_calendar_admin_list',
      'content_calendar_admin_save','content_calendar_admin_delete'))
    or (n.nspname='private' and p.proname in('content_calendar_revision','content_calendar_operation_immutable',
      'content_calendar_projection','content_calendar_month_entries','content_calendar_parse_input'))
  loop execute format('revoke all on function %s from public,anon,authenticated,service_role',fn); end loop;
end;$$;
grant execute on function public.content_calendar_artist_context(text,date),public.content_calendar_admin_list(uuid,date),
  public.content_calendar_admin_save(uuid,uuid,bigint,jsonb),public.content_calendar_admin_delete(uuid,uuid,bigint,boolean)
  to authenticated;
commit;
