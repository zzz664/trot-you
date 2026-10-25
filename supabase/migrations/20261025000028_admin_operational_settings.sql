-- Typed operational policy editing only. No business policy, legal text,
-- credential, provider, account, role, scheduler or financial activation.
begin;

create table private.admin_display_settings (
  singleton boolean primary key default true check(singleton),
  page_size integer not null check(page_size between 1 and 100)
);
create table private.admin_settings_state (
  group_key text primary key check(group_key in('message','community','display')),
  revision bigint not null check(revision between 0 and 9007199254740991),
  snapshot jsonb check(snapshot is null or jsonb_typeof(snapshot)='object'),
  updated_at timestamptz,
  updated_by uuid references public.profiles(id) on delete restrict
);
create table private.admin_settings_audit (
  id uuid primary key default gen_random_uuid(),
  group_key text not null references private.admin_settings_state(group_key),
  revision bigint not null check(revision between 1 and 9007199254740991),
  actor_id uuid references public.profiles(id) on delete restrict,
  source text not null check(source in('admin','operator')),
  decision_reference uuid,
  operation_id uuid,
  before_value jsonb,
  after_value jsonb,
  created_at timestamptz not null default clock_timestamp(),
  unique(group_key,revision),
  check((source='admin' and actor_id is not null and decision_reference is not null and operation_id is not null)
    or (source='operator' and actor_id is null and decision_reference is null and operation_id is null))
);
create index admin_settings_audit_recent on private.admin_settings_audit(created_at desc,id desc);
create table private.admin_settings_operations (
  actor_id uuid not null references public.profiles(id) on delete restrict,
  operation_id uuid not null,
  request jsonb not null,
  response jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key(actor_id,operation_id)
);
alter table private.admin_display_settings enable row level security;
alter table private.admin_settings_state enable row level security;
alter table private.admin_settings_audit enable row level security;
alter table private.admin_settings_operations enable row level security;
revoke all on private.admin_display_settings,private.admin_settings_state,private.admin_settings_audit,private.admin_settings_operations
  from public,anon,authenticated,service_role;
-- Technical revision slots only, not operational settings or policy approval.
insert into private.admin_settings_state(group_key,revision) values('message',0),('community',0),('display',0);

create function private.admin_settings_immutable() returns trigger
language plpgsql set search_path='' as $$
begin raise exception 'ADMIN_SETTINGS_AUDIT_IMMUTABLE' using errcode='55000'; end;
$$;
create trigger admin_settings_audit_immutable before update or delete on private.admin_settings_audit
  for each row execute function private.admin_settings_immutable();
create trigger admin_settings_audit_no_truncate before truncate on private.admin_settings_audit
  for each statement execute function private.admin_settings_immutable();
create trigger admin_settings_operations_immutable before update or delete on private.admin_settings_operations
  for each row execute function private.admin_settings_immutable();
create trigger admin_settings_operations_no_truncate before truncate on private.admin_settings_operations
  for each statement execute function private.admin_settings_immutable();

-- Explicit numeric projection: never serialize whole policy rows, version
-- labels, moderation patterns, legal references, arbitrary strings or secrets.
create function private.admin_settings_values(p_group text) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare result jsonb;
begin
  case p_group
    when 'message' then
      select jsonb_build_object('history_before_seconds',history_before_seconds,'cancel_window_seconds',cancel_window_seconds,
        'max_text_length',max_text_length,'max_reply_length',max_reply_length,'max_photos',max_photos,
        'max_voice_seconds',max_voice_seconds,'max_video_seconds',max_video_seconds,'preview_max_count',preview_max_count,
        'max_photo_bytes',max_photo_bytes,'max_voice_bytes',max_voice_bytes,'max_video_bytes',max_video_bytes)
      into result from private.message_policy where singleton;
    when 'community' then
      select jsonb_build_object('max_title_length',max_title_length,'max_body_length',max_body_length,'max_comment_length',max_comment_length,
        'max_reason_length',max_reason_length,'max_images',max_images,'max_image_bytes',max_image_bytes,'max_image_long_edge',max_image_long_edge,
        'auto_hide_report_count',auto_hide_report_count,'rate_window_seconds',rate_window_seconds,
        'max_contributions_per_window',max_contributions_per_window,'max_reports_per_window',max_reports_per_window)
      into result from private.community_policy where singleton;
    when 'display' then
      select jsonb_build_object('page_size',page_size) into result from private.admin_display_settings where singleton;
    else raise exception 'ADMIN_SETTINGS_INVALID_INPUT' using errcode='22023';
  end case;
  return result;
end;
$$;
create function private.admin_settings_record_change(p_group text,p_after jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare prior private.admin_settings_state%rowtype; actor uuid; operation uuid; decision uuid; stamp timestamptz:=clock_timestamp();
begin
  select * into strict prior from private.admin_settings_state where group_key=p_group for update;
  -- Only the authenticated RPC has DML capability. A privileged direct writer
  -- is intentionally recorded as operator, never a guessed human identity.
  if current_setting('role',true)='authenticated' then
    actor:=auth.uid();
    operation:=nullif(current_setting('app.admin_settings_operation',true),'')::uuid;
    decision:=nullif(current_setting('app.admin_settings_decision',true),'')::uuid;
    if actor is null or operation is null or decision is null then
      raise exception 'ADMIN_SETTINGS_FORBIDDEN' using errcode='42501'; end if;
  end if;
  update private.admin_settings_state set revision=prior.revision+1,snapshot=p_after,updated_at=stamp,updated_by=actor where group_key=p_group;
  insert into private.admin_settings_audit(group_key,revision,actor_id,source,decision_reference,operation_id,before_value,after_value,created_at)
  values(p_group,prior.revision+1,actor,case when actor is null then 'operator' else 'admin' end,decision,operation,
    case when p_group='display' then coalesce(prior.snapshot,jsonb_build_object('page_size',30)) else prior.snapshot end,
    case when p_group='display' then coalesce(p_after,jsonb_build_object('page_size',30)) else p_after end,stamp);
end;
$$;
create function private.admin_settings_policy_changed() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  perform private.admin_settings_record_change(tg_argv[0],private.admin_settings_values(tg_argv[0]));
  return null;
end;
$$;
-- Preserve source table shape and pre-existing operator provisioning grants.
-- Every external write invalidates CAS, including hidden-field-only changes.
create trigger message_policy_admin_settings after insert or update or delete on private.message_policy
  for each row execute function private.admin_settings_policy_changed('message');
create trigger community_policy_admin_settings after insert or update or delete on private.community_policy
  for each row execute function private.admin_settings_policy_changed('community');
create trigger display_policy_admin_settings after insert or update or delete on private.admin_display_settings
  for each row execute function private.admin_settings_policy_changed('display');
-- TRUNCATE would bypass row-trigger revision/audit evidence and is prohibited.
create trigger message_policy_settings_no_truncate before truncate on private.message_policy
  for each statement execute function private.admin_settings_immutable();
create trigger community_policy_settings_no_truncate before truncate on private.community_policy
  for each statement execute function private.admin_settings_immutable();
create trigger display_policy_settings_no_truncate before truncate on private.admin_display_settings
  for each statement execute function private.admin_settings_immutable();
-- Import existing policy metadata without changing one source value/version.
do $$declare key text; snapshot jsonb;
begin
  foreach key in array array['message','community'] loop
    snapshot:=private.admin_settings_values(key);
    if snapshot is not null then perform private.admin_settings_record_change(key,snapshot); end if;
  end loop;
end;$$;

create function private.admin_settings_actor() returns uuid
language plpgsql security definer set search_path='' as $$
declare actor public.profiles%rowtype;
begin
  if current_setting('transaction_isolation')<>'read committed' then
    raise exception 'ADMIN_SETTINGS_ISOLATION_UNSUPPORTED' using errcode='25001'; end if;
  if current_setting('role',true) is distinct from 'authenticated' then
    raise exception 'ADMIN_SETTINGS_FORBIDDEN' using errcode='42501'; end if;
  select * into actor from public.profiles where id=auth.uid() for update;
  if actor.id is null or actor.role<>'admin' or
    (actor.is_restricted and (actor.restricted_until is null or actor.restricted_until>clock_timestamp())) then
    raise exception 'ADMIN_SETTINGS_FORBIDDEN' using errcode='42501'; end if;
  return actor.id;
end;
$$;
create function private.admin_settings_projection(p_group text) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('key',group_key,'revision',revision,'configured',group_key='display' or snapshot is not null,
    'values',case when group_key='display' then coalesce(snapshot,jsonb_build_object('page_size',30)) else snapshot end,
    'updated_at',updated_at,'updated_by',updated_by) from private.admin_settings_state where group_key=p_group;
$$;
create function private.admin_settings_validate(p_group text,p_values jsonb) returns void
language plpgsql immutable set search_path='' as $$
declare bounds jsonb; item record; number numeric;
begin
  bounds:=case p_group
    when 'message' then '{"history_before_seconds":[0,31536000],"cancel_window_seconds":[0,86400],"max_text_length":[1,100000],"max_reply_length":[1,10000],"max_photos":[1,100],"max_voice_seconds":[1,86400],"max_video_seconds":[1,86400],"preview_max_count":[0,100],"max_photo_bytes":[1,10485760],"max_voice_bytes":[1,20971520],"max_video_bytes":[1,104857600]}'::jsonb
    when 'community' then '{"max_title_length":[1,1000],"max_body_length":[1,100000],"max_comment_length":[1,10000],"max_reason_length":[1,10000],"max_images":[0,100],"max_image_bytes":[1,10485760],"max_image_long_edge":[1,100000],"auto_hide_report_count":[1,100000],"rate_window_seconds":[1,86400],"max_contributions_per_window":[1,10000],"max_reports_per_window":[1,10000]}'::jsonb
    when 'display' then '{"page_size":[1,100]}'::jsonb end;
  if bounds is null or p_values is null or jsonb_typeof(p_values)<>'object' then
    raise exception 'ADMIN_SETTINGS_INVALID_INPUT' using errcode='22023'; end if;
  -- Separate shape validation from set-returning JSON inspection: query
  -- planning must not evaluate object_keys against an array/scalar first.
  if (select count(*) from jsonb_object_keys(p_values))<>(select count(*) from jsonb_object_keys(bounds)) then
    raise exception 'ADMIN_SETTINGS_INVALID_INPUT' using errcode='22023'; end if;
  for item in select key,value from jsonb_each(bounds) loop
    if jsonb_typeof(p_values->item.key) is distinct from 'number' then
      raise exception 'ADMIN_SETTINGS_INVALID_INPUT' using errcode='22023'; end if;
    number:=(p_values->>item.key)::numeric;
    if number<>trunc(number) or number<(item.value->>0)::numeric or number>(item.value->>1)::numeric then
      raise exception 'ADMIN_SETTINGS_INVALID_INPUT' using errcode='22023'; end if;
  end loop;
end;
$$;
create function public.admin_settings_list() returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  perform private.admin_settings_actor();
  select jsonb_build_object('groups',(select jsonb_agg(private.admin_settings_projection(group_key) order by group_key)
    from private.admin_settings_state),
    'audit',coalesce((select jsonb_agg(to_jsonb(a) order by a.created_at desc,a.id desc) from
      (select id,group_key,revision,actor_id,source,decision_reference,operation_id,before_value,after_value,created_at
       from private.admin_settings_audit order by created_at desc,id desc limit 30)a),'[]'::jsonb)) into result;
  return result;
end;
$$;
create function public.admin_settings_save(p_group text,p_operation_id uuid,p_expected_revision bigint,p_values jsonb,
  p_confirmed boolean,p_decision_reference uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid; request jsonb; prior private.admin_settings_operations%rowtype; state private.admin_settings_state%rowtype; result jsonb;
begin
  actor:=private.admin_settings_actor();
  perform private.admin_settings_validate(p_group,p_values);
  if p_operation_id is null or p_decision_reference is null or p_expected_revision is null
    or p_expected_revision not between 0 and 9007199254740990 then
    raise exception 'ADMIN_SETTINGS_INVALID_INPUT' using errcode='22023'; end if;
  if p_confirmed is distinct from true then raise exception 'ADMIN_SETTINGS_CONFIRMATION_REQUIRED' using errcode='22023'; end if;
  request:=jsonb_build_object('group',p_group,'expected_revision',p_expected_revision,'values',p_values,'decision_reference',p_decision_reference);
  select * into prior from private.admin_settings_operations where actor_id=actor and operation_id=p_operation_id;
  if prior.operation_id is not null then
    if prior.request<>request then raise exception 'ADMIN_SETTINGS_OPERATION_CONFLICT' using errcode='23505'; end if;
    return prior.response;
  end if;
  -- Match preview management's actor -> artist -> policy order. Every existing
  -- selected preview remains valid; a reduced cap never silently hides rows.
  if p_group='message' then
    perform 1 from public.artists order by id for share;
    perform 1 from private.message_policy where singleton for update;
  elsif p_group='community' then
    perform 1 from private.community_policy where singleton for update;
  else
    -- Serialize the initial absent-row case against both administrators and
    -- owner provisioning; avoid policy-row/state lock inversion.
    lock table private.admin_display_settings in share row exclusive mode;
    perform 1 from private.admin_display_settings where singleton for update;
  end if;
  select * into strict state from private.admin_settings_state where group_key=p_group for update;
  if state.revision<>p_expected_revision then raise exception 'ADMIN_SETTINGS_REVISION_CONFLICT' using errcode='40001'; end if;
  if p_group<>'display' and state.snapshot is null then raise exception 'ADMIN_SETTINGS_SETUP_NOT_READY' using errcode='55000'; end if;
  if p_group='message' and exists(select 1 from public.messages where is_preview group by artist_id having count(*)>(p_values->>'preview_max_count')::numeric::integer) then
    raise exception 'ADMIN_SETTINGS_PREVIEW_LIMIT_CONFLICT' using errcode='23514'; end if;
  perform set_config('app.admin_settings_operation',p_operation_id::text,true);
  perform set_config('app.admin_settings_decision',p_decision_reference::text,true);
  case p_group
    when 'message' then
      update private.message_policy set version='admin-'||p_operation_id::text,
        history_before_seconds=(p_values->>'history_before_seconds')::numeric::integer,cancel_window_seconds=(p_values->>'cancel_window_seconds')::numeric::integer,
        max_text_length=(p_values->>'max_text_length')::numeric::integer,max_reply_length=(p_values->>'max_reply_length')::numeric::integer,
        max_photos=(p_values->>'max_photos')::numeric::integer,max_voice_seconds=(p_values->>'max_voice_seconds')::numeric::integer,
        max_video_seconds=(p_values->>'max_video_seconds')::numeric::integer,preview_max_count=(p_values->>'preview_max_count')::numeric::integer,
        max_photo_bytes=(p_values->>'max_photo_bytes')::numeric::bigint,max_voice_bytes=(p_values->>'max_voice_bytes')::numeric::bigint,
        max_video_bytes=(p_values->>'max_video_bytes')::numeric::bigint where singleton;
    when 'community' then
      update private.community_policy set version='admin-'||p_operation_id::text,
        max_title_length=(p_values->>'max_title_length')::numeric::integer,max_body_length=(p_values->>'max_body_length')::numeric::integer,
        max_comment_length=(p_values->>'max_comment_length')::numeric::integer,max_reason_length=(p_values->>'max_reason_length')::numeric::integer,
        max_images=(p_values->>'max_images')::numeric::integer,max_image_bytes=(p_values->>'max_image_bytes')::numeric::bigint,
        max_image_long_edge=(p_values->>'max_image_long_edge')::numeric::integer,auto_hide_report_count=(p_values->>'auto_hide_report_count')::numeric::integer,
        rate_window_seconds=(p_values->>'rate_window_seconds')::numeric::integer,max_contributions_per_window=(p_values->>'max_contributions_per_window')::numeric::integer,
        max_reports_per_window=(p_values->>'max_reports_per_window')::numeric::integer where singleton;
    when 'display' then
      insert into private.admin_display_settings(singleton,page_size) values(true,(p_values->>'page_size')::numeric::integer)
      on conflict(singleton) do update set page_size=excluded.page_size;
  end case;
  perform set_config('app.admin_settings_operation','',true);
  perform set_config('app.admin_settings_decision','',true);
  result:=private.admin_settings_projection(p_group);
  insert into private.admin_settings_operations(actor_id,operation_id,request,response) values(actor,p_operation_id,request,result);
  return result;
end;
$$;
create function public.chat_settings() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if current_setting('role',true) is distinct from 'service_role' then
    raise exception 'ADMIN_SETTINGS_FORBIDDEN' using errcode='42501'; end if;
  -- Existing pagination behavior, not a business-policy/authorization fallback.
  return jsonb_build_object('page_size',coalesce((select page_size from private.admin_display_settings where singleton),30));
end;
$$;
revoke all on function private.admin_settings_immutable(),private.admin_settings_values(text),private.admin_settings_record_change(text,jsonb),
  private.admin_settings_policy_changed(),private.admin_settings_actor(),private.admin_settings_projection(text),private.admin_settings_validate(text,jsonb),
  public.admin_settings_list(),public.admin_settings_save(text,uuid,bigint,jsonb,boolean,uuid),public.chat_settings()
  from public,anon,authenticated,service_role;
grant execute on function public.admin_settings_list(),public.admin_settings_save(text,uuid,bigint,jsonb,boolean,uuid) to authenticated;
grant execute on function public.chat_settings() to service_role;
comment on table private.admin_settings_audit is 'Immutable, numeric-only operational change snapshots. Actor UUID and decision UUID identify approved administration without personal details, credentials or arbitrary operator text. Privileged provisioning is labeled operator, not attributed to a guessed human.';
comment on function public.admin_settings_save(text,uuid,bigint,jsonb,boolean,uuid) is 'Authenticated current-admin CAS editor for existing message/community policies and technical chat pagination only. Requires explicit confirmation and opaque decision reference. Cannot create or approve business policy, change moderation data, activate providers, or rewrite money.';
commit;
