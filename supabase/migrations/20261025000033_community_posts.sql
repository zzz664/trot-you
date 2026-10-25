-- Board application boundary and pre-publication verified image reservations.
-- No policy defaults, role changes, moderation UI, rewards or provider traffic.
begin;

alter table public.posts add column revision bigint not null default 1
  check(revision between 1 and 9007199254740991);
alter table public.post_images add column position integer not null default 0 check(position between 0 and 99);
create function private.board_revision() returns trigger language plpgsql set search_path='' as $$
begin new.revision:=old.revision+1; return new; end;
$$;
create trigger board_revision before update on public.posts for each row execute function private.board_revision();

create table private.board_operations (
  actor_id uuid not null references public.profiles(id) on delete restrict,
  operation_id uuid not null,
  request jsonb not null check(jsonb_typeof(request)='object'),
  response jsonb not null check(jsonb_typeof(response)='object'),
  created_at timestamptz not null default clock_timestamp(),
  primary key(actor_id,operation_id)
);
alter table private.board_operations enable row level security;
revoke all on private.board_operations from public,anon,authenticated,service_role;
create function private.board_operation_immutable() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'BOARD_OPERATION_IMMUTABLE' using errcode='55000'; end;
$$;
create trigger board_operation_immutable before update or delete on private.board_operations
  for each row execute function private.board_operation_immutable();
create trigger board_operation_no_truncate before truncate on private.board_operations
  for each statement execute function private.board_operation_immutable();

create table private.board_uploads (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null,
  actor_id uuid not null references public.profiles(id) on delete restrict,
  artist_id uuid not null references public.artists(id) on delete restrict,
  post_id uuid not null,
  image_id uuid not null unique default gen_random_uuid(),
  mime_type text not null check(mime_type in('image/jpeg','image/png','image/webp')),
  byte_size bigint not null check(byte_size between 1 and 10485760),
  quarantine_path text not null unique,
  object_path text not null unique,
  state text not null default 'pending' check(state in('pending','completed','revoked')),
  storage_object_id uuid unique references storage.objects(id) on delete restrict,
  final_byte_size bigint check(final_byte_size between 1 and 10485760),
  width integer check(width between 1 and 100000),
  height integer check(height between 1 and 100000),
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  completed_at timestamptz,
  revoked_at timestamptz,
  attached_at timestamptz,
  unique(actor_id,request_id),
  check(isfinite(created_at) and isfinite(expires_at) and expires_at>created_at),
  check((state='pending' and completed_at is null and revoked_at is null and storage_object_id is null)
    or (state='completed' and completed_at is not null and revoked_at is null and storage_object_id is not null)
    or (state='revoked' and revoked_at is not null)),
  check((storage_object_id is null and final_byte_size is null and width is null and height is null)
    or (storage_object_id is not null and final_byte_size is not null and width is not null and height is not null)),
  check(attached_at is null or state='completed')
);
create index board_uploads_pending_actor_idx on private.board_uploads(actor_id,expires_at) where attached_at is null and state<>'revoked';
alter table private.board_uploads enable row level security;
revoke all on private.board_uploads from public,anon,authenticated,service_role;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('board-quarantine','board-quarantine',false,10485760,array['image/jpeg','image/png','image/webp']);
create policy board_quarantine_no_client_bucket on storage.buckets as restrictive for all to anon,authenticated
  using(id<>'board-quarantine') with check(id<>'board-quarantine');
create policy board_quarantine_no_client_select on storage.objects as restrictive for select to anon,authenticated using(bucket_id<>'board-quarantine');
create policy board_quarantine_no_client_insert on storage.objects as restrictive for insert to anon,authenticated with check(bucket_id<>'board-quarantine');
create policy board_quarantine_no_client_update on storage.objects as restrictive for update to anon,authenticated using(bucket_id<>'board-quarantine') with check(bucket_id<>'board-quarantine');
create policy board_quarantine_no_client_delete on storage.objects as restrictive for delete to anon,authenticated using(bucket_id<>'board-quarantine');

-- READ COMMITTED and a profile lock are required before every fresh authority
-- check. No JWT metadata grants an application role. Writes serialize actor-bound
-- receipts/rate/reservations; reads retain restriction locks until projection.
create function private.board_actor(p_actor_id uuid,p_service boolean,p_write boolean default false,p_admin boolean default false)
returns public.profiles language plpgsql security definer set search_path='' as $$
declare actor public.profiles%rowtype;
begin
  if current_setting('transaction_isolation')<>'read committed' then raise exception 'BOARD_ISOLATION_UNSUPPORTED' using errcode='25001'; end if;
  if current_setting('role',true) is distinct from (case when p_service then 'service_role' else 'authenticated' end)
    or (not p_service and p_actor_id is distinct from auth.uid()) then
    raise exception 'COMMUNITY_FORBIDDEN' using errcode='42501'; end if;
  if p_write then select * into actor from public.profiles where id=p_actor_id for update;
  else select * into actor from public.profiles where id=p_actor_id for share; end if;
  if actor.id is null or (p_admin and actor.role<>'admin') or (actor.role='fan' and actor.onboarding_completed_at is null)
    or (actor.is_restricted and (actor.restricted_until is null or actor.restricted_until>clock_timestamp())) then
    raise exception 'COMMUNITY_FORBIDDEN' using errcode='42501'; end if;
  return actor;
end;
$$;
create function private.board_artist(p_id uuid) returns public.artists
language plpgsql security definer set search_path='' as $$
declare artist public.artists%rowtype;
begin
  select * into artist from public.artists where id=p_id for share;
  if artist.id is null or artist.status<>'active' then raise exception 'COMMUNITY_BOARD_UNAVAILABLE' using errcode='42501'; end if;
  return artist;
end;
$$;
create function private.board_policy() returns private.community_policy
language plpgsql security definer set search_path='' as $$
declare cfg private.community_policy%rowtype;
begin
  select * into cfg from private.community_policy where singleton for share;
  if cfg.singleton is null then raise exception 'COMMUNITY_POLICY_REQUIRED' using errcode='55000'; end if;
  return cfg;
end;
$$;
create function private.board_policy_projection(p_cfg private.community_policy) returns jsonb
language sql immutable set search_path='' as $$
 select jsonb_build_object('max_title_length',p_cfg.max_title_length,'max_body_length',p_cfg.max_body_length,
 'max_images',p_cfg.max_images,'max_image_bytes',p_cfg.max_image_bytes,'max_image_long_edge',p_cfg.max_image_long_edge);
$$;
create function private.board_post_projection(p_id uuid,p_actor uuid,p_detail boolean) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',p.id,'artist_id',p.artist_id,'author',jsonb_build_object('call_name',a.call_name),
 'is_owner',p.user_id=p_actor,'title',p.title,'is_notice',p.is_notice,'is_pinned',p.is_pinned,
 'created_at',p.created_at,'updated_at',p.updated_at,'revision',p.revision,
 'image_count',(select count(*) from public.post_images i where i.post_id=p.id))
 ||case when p_detail then jsonb_build_object('body',p.body,'images',(select coalesce(jsonb_agg(jsonb_build_object(
 'id',i.id,'mime_type',i.mime_type,'byte_size',i.byte_size,'width',i.width,'height',i.height) order by i.position,i.created_at,i.id),'[]'::jsonb)
 from public.post_images i where i.post_id=p.id)) else '{}'::jsonb end
 from public.posts p join public.profiles a on a.id=p.user_id where p.id=p_id;
$$;
create function public.board_ui_list(p_artist_slug text,p_limit integer default 21,p_before_pinned boolean default null,
 p_before_created_at timestamptz default null,p_before_id uuid default null) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare actor public.profiles%rowtype; artist public.artists%rowtype; cfg private.community_policy%rowtype;
 rows jsonb; cursor_value jsonb; artist_id_value uuid;
begin
 actor:=private.board_actor(auth.uid(),false);
 if p_artist_slug is null or p_limit is null or p_limit not between 1 and 100
   or ((p_before_pinned is null)::integer+(p_before_created_at is null)::integer+(p_before_id is null)::integer) not in(0,3)
   or (p_before_created_at is not null and not isfinite(p_before_created_at)) then raise exception 'BOARD_INVALID_INPUT' using errcode='22023'; end if;
 select id into artist_id_value from public.artists where slug=p_artist_slug;
 artist:=private.board_artist(artist_id_value);
 cfg:=private.board_policy();
 -- One statement observes the page and its sentinel; no mixed fresh snapshots.
 with page as materialized(select p.* from public.posts p where p.artist_id=artist.id and not p.is_hidden and p.deleted_at is null
   and (p_before_id is null or (p.is_pinned,p.created_at,p.id)<(p_before_pinned,p_before_created_at,p_before_id))
   order by p.is_pinned desc,p.created_at desc,p.id desc limit p_limit+1),
 shown as materialized(select * from page order by is_pinned desc,created_at desc,id desc limit p_limit)
 select coalesce((select jsonb_agg(private.board_post_projection(s.id,actor.id,false) order by s.is_pinned desc,s.created_at desc,s.id desc) from shown s),'[]'::jsonb),
 case when (select count(*) from page)>p_limit then (select jsonb_build_object('is_pinned',s.is_pinned,'created_at',s.created_at,'id',s.id)
 from shown s order by s.is_pinned,s.created_at,s.id limit 1) end into rows,cursor_value;
 return jsonb_build_object('actor_id',actor.id,'artist',jsonb_build_object('id',artist.id,'slug',artist.slug,'name',artist.name),
 'policy',private.board_policy_projection(cfg),'can_create_notice',actor.role='admin','posts',rows,'next_cursor',cursor_value);
end;
$$;
create function public.board_ui_detail(p_artist_slug text,p_post_id uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare actor public.profiles%rowtype; artist public.artists%rowtype; cfg private.community_policy%rowtype; post public.posts%rowtype; artist_id_value uuid;
begin
 actor:=private.board_actor(auth.uid(),false);
 select id into artist_id_value from public.artists where slug=p_artist_slug;
 artist:=private.board_artist(artist_id_value);
 select * into post from public.posts where id=p_post_id and artist_id=artist.id for share;
 if post.id is null or post.is_hidden or post.deleted_at is not null then raise exception 'COMMUNITY_TARGET_UNAVAILABLE' using errcode='42501'; end if;
 cfg:=private.board_policy();
 return jsonb_build_object('actor_id',actor.id,'artist',jsonb_build_object('id',artist.id,'slug',artist.slug,'name',artist.name),
 'policy',private.board_policy_projection(cfg),'can_create_notice',actor.role='admin','post',private.board_post_projection(post.id,actor.id,true));
end;
$$;

create function private.board_upload_projection(p_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('upload_id',u.id,'image_id',u.image_id,'actor_id',u.actor_id,'artist_id',u.artist_id,'post_id',u.post_id,
 'mime_type',u.mime_type,'byte_size',u.byte_size,'quarantine_path',u.quarantine_path,'object_path',u.object_path,'state',u.state,
 'expires_at',u.expires_at,'max_bytes',c.max_image_bytes,'max_count',c.max_images,'max_long_edge',c.max_image_long_edge)
 from private.board_uploads u cross join private.community_policy c where u.id=p_id and c.singleton;
$$;
create function public.board_media_begin_upload(p_actor_id uuid,p_artist_id uuid,p_post_id uuid,p_mime_type text,p_byte_size bigint,p_request_id uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare cfg private.community_policy%rowtype; upload private.board_uploads%rowtype; extension text; stamp timestamptz;
begin
 perform private.board_actor(p_actor_id,true,true);
 perform private.board_artist(p_artist_id);
 cfg:=private.board_policy();
 if p_request_id is null or p_post_id is null or p_byte_size is null or p_mime_type is null then raise exception 'BOARD_INVALID_INPUT' using errcode='22023'; end if;
 select * into upload from private.board_uploads where actor_id=p_actor_id and request_id=p_request_id for update;
 if upload.id is not null then
   if upload.artist_id<>p_artist_id or upload.post_id<>p_post_id or upload.mime_type<>p_mime_type or upload.byte_size<>p_byte_size then
     raise exception 'BOARD_OPERATION_CONFLICT' using errcode='23505'; end if;
   return public.board_media_resolve_upload(p_actor_id,upload.id);
 end if;
 if exists(select 1 from public.posts where id=p_post_id) then raise exception 'COMMUNITY_TARGET_UNAVAILABLE' using errcode='42501'; end if;
 extension:=case p_mime_type when 'image/jpeg' then 'jpg' when 'image/png' then 'png' when 'image/webp' then 'webp' end;
 if extension is null or p_byte_size<1 or p_byte_size>cfg.max_image_bytes then raise exception 'BOARD_IMAGE_INVALID' using errcode='23514'; end if;
 stamp:=clock_timestamp();
 -- One actor-wide allowance prevents abandoned parallel drafts multiplying an
 -- approved max_images reservation cap; expired/revoked/attached rows do not count.
 if (select count(*) from private.board_uploads where actor_id=p_actor_id and attached_at is null and state<>'revoked' and expires_at>stamp)>=cfg.max_images then
   raise exception 'BOARD_IMAGE_LIMIT' using errcode='23514'; end if;
 upload.id:=gen_random_uuid(); upload.image_id:=gen_random_uuid();
 insert into private.board_uploads(id,request_id,actor_id,artist_id,post_id,image_id,mime_type,byte_size,quarantine_path,object_path,created_at,expires_at)
 values(upload.id,p_request_id,p_actor_id,p_artist_id,p_post_id,upload.image_id,p_mime_type,p_byte_size,
 p_artist_id::text||'/'||p_post_id::text||'/'||upload.id::text||'.'||extension,
 p_artist_id::text||'/'||p_post_id::text||'/'||upload.image_id::text||'.'||extension,stamp,stamp+interval '2 hours');
 return private.board_upload_projection(upload.id);
end;
$$;
create function public.board_media_resolve_upload(p_actor_id uuid,p_upload_id uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare upload private.board_uploads%rowtype; cfg private.community_policy%rowtype;
begin
 perform private.board_actor(p_actor_id,true,true);
 select * into upload from private.board_uploads where id=p_upload_id and actor_id=p_actor_id;
 if upload.id is null then raise exception 'COMMUNITY_FORBIDDEN' using errcode='42501'; end if;
 perform private.board_artist(upload.artist_id);
 cfg:=private.board_policy();
 select * into strict upload from private.board_uploads where id=p_upload_id for update;
 if upload.state='revoked' then raise exception 'BOARD_UPLOAD_REVOKED' using errcode='42501'; end if;
 if upload.byte_size>cfg.max_image_bytes or (upload.final_byte_size is not null and (upload.final_byte_size>cfg.max_image_bytes or greatest(upload.width,upload.height)>cfg.max_image_long_edge)) then
   raise exception 'BOARD_IMAGE_INVALID' using errcode='23514'; end if;
 if upload.attached_at is not null then
   -- Replay may confirm an already completed upload but never regrant authority
   -- over hidden/deleted content or a different owner's committed post.
   perform 1 from public.posts where id=upload.post_id and user_id=p_actor_id and not is_hidden and deleted_at is null;
   if not found then raise exception 'COMMUNITY_TARGET_UNAVAILABLE' using errcode='42501'; end if;
   return private.board_upload_projection(upload.id);
 end if;
 if upload.expires_at<=clock_timestamp() then raise exception 'BOARD_UPLOAD_EXPIRED' using errcode='55000'; end if;
 if exists(select 1 from public.posts where id=upload.post_id) then raise exception 'COMMUNITY_TARGET_UNAVAILABLE' using errcode='42501'; end if;
 return private.board_upload_projection(upload.id);
end;
$$;
create function public.board_media_finalize_upload(p_actor_id uuid,p_upload_id uuid,p_storage_object_id uuid,p_width integer,p_height integer)
returns uuid language plpgsql volatile security definer set search_path='' as $$
declare upload private.board_uploads%rowtype; object storage.objects%rowtype; cfg private.community_policy%rowtype; bytes bigint;
begin
 perform public.board_media_resolve_upload(p_actor_id,p_upload_id);
 select * into strict upload from private.board_uploads where id=p_upload_id;
 if upload.state='completed' then
   if upload.storage_object_id is distinct from p_storage_object_id or upload.width is distinct from p_width or upload.height is distinct from p_height then
     raise exception 'BOARD_OPERATION_CONFLICT' using errcode='23505'; end if;
   return upload.image_id;
 end if;
 cfg:=private.board_policy();
 select * into object from storage.objects where id=p_storage_object_id for share;
 if object.id is null or object.bucket_id<>'board-media' or object.name<>upload.object_path
   or object.metadata->>'mimetype' is distinct from upload.mime_type or jsonb_typeof(object.metadata->'size') is distinct from 'number'
   or coalesce(object.metadata->>'size','') !~ '^[1-9][0-9]{0,7}$'
   or p_width is null or p_height is null or p_width<1 or p_height<1 or greatest(p_width,p_height)>cfg.max_image_long_edge then
   raise exception 'BOARD_IMAGE_INVALID' using errcode='23514'; end if;
 bytes:=(object.metadata->>'size')::bigint;
 if bytes>cfg.max_image_bytes then raise exception 'BOARD_IMAGE_INVALID' using errcode='23514'; end if;
 if upload.expires_at<=clock_timestamp() then raise exception 'BOARD_UPLOAD_EXPIRED' using errcode='55000'; end if;
 update private.board_uploads set state='completed',storage_object_id=object.id,final_byte_size=bytes,width=p_width,height=p_height,completed_at=clock_timestamp() where id=upload.id;
 return upload.image_id;
end;
$$;
create function public.board_media_revoke_upload(p_actor_id uuid,p_upload_id uuid) returns boolean
language plpgsql volatile security definer set search_path='' as $$
declare upload private.board_uploads%rowtype;
begin
 perform private.board_actor(p_actor_id,true,true);
 select * into upload from private.board_uploads where id=p_upload_id and actor_id=p_actor_id;
 if upload.id is null then raise exception 'COMMUNITY_FORBIDDEN' using errcode='42501'; end if;
 perform private.board_artist(upload.artist_id);
 select * into strict upload from private.board_uploads where id=p_upload_id for update;
 if upload.attached_at is not null then return false; end if;
 if upload.state='revoked' then return true; end if;
 update private.board_uploads set state='revoked',revoked_at=clock_timestamp() where id=upload.id;
 return true;
end;
$$;

create function public.board_ui_create(p_artist_slug text,p_operation_id uuid,p_post_id uuid,p_artist_id uuid,p_title text,p_body text,
 p_upload_ids uuid[],p_is_notice boolean,p_is_pinned boolean) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare actor public.profiles%rowtype; cfg private.community_policy%rowtype; request_value jsonb; prior private.board_operations%rowtype;
 upload private.board_uploads%rowtype; object storage.objects%rowtype; upload_id uuid; result jsonb; image_position integer:=0;
begin
 actor:=private.board_actor(auth.uid(),false,true);
 if (private.board_artist(p_artist_id)).slug is distinct from p_artist_slug then raise exception 'COMMUNITY_BOARD_UNAVAILABLE' using errcode='42501'; end if;
 cfg:=private.board_policy();
 if p_operation_id is null or p_post_id is null or p_upload_ids is null or p_is_notice is null or p_is_pinned is null
   or (p_is_pinned and not p_is_notice) or array_position(p_upload_ids,null) is not null
   or cardinality(p_upload_ids)<>(select count(distinct v) from unnest(p_upload_ids)v) then raise exception 'BOARD_INVALID_INPUT' using errcode='22023'; end if;
 if p_is_notice and actor.role<>'admin' then raise exception 'COMMUNITY_FORBIDDEN' using errcode='42501'; end if;
 request_value:=jsonb_build_object('action','create','slug',p_artist_slug,'id',p_post_id,'artist_id',p_artist_id,'title',p_title,'body',p_body,
 'upload_ids',to_jsonb(p_upload_ids),'is_notice',p_is_notice,'is_pinned',p_is_pinned);
 select * into prior from private.board_operations where actor_id=actor.id and operation_id=p_operation_id;
 if prior.operation_id is not null then
   if prior.request<>request_value then raise exception 'BOARD_OPERATION_CONFLICT' using errcode='23505'; end if;
   return prior.response;
 end if;
 if exists(select 1 from public.posts where id=p_post_id or (user_id=actor.id and request_id=p_operation_id)) then raise exception 'BOARD_OPERATION_CONFLICT' using errcode='23505'; end if;
 perform private.validate_community_text(p_title,cfg.max_title_length,cfg);
 perform private.validate_community_text(p_body,cfg.max_body_length,cfg);
 if cardinality(p_upload_ids)>cfg.max_images then raise exception 'BOARD_IMAGE_LIMIT' using errcode='23514'; end if;
 -- Validate every completed reservation and immutable object before publishing
 -- any row. Transaction rollback also rolls back points/rate/event side effects.
 foreach upload_id in array p_upload_ids loop
   select * into upload from private.board_uploads where id=upload_id for update;
   if upload.id is null or upload.actor_id<>actor.id or upload.artist_id<>p_artist_id or upload.post_id<>p_post_id
     or upload.state<>'completed' or upload.attached_at is not null then raise exception 'BOARD_IMAGE_INVALID' using errcode='23514'; end if;
   if upload.expires_at<=clock_timestamp() then raise exception 'BOARD_UPLOAD_EXPIRED' using errcode='55000'; end if;
   if upload.final_byte_size>cfg.max_image_bytes or greatest(upload.width,upload.height)>cfg.max_image_long_edge then raise exception 'BOARD_IMAGE_INVALID' using errcode='23514'; end if;
   select * into object from storage.objects where id=upload.storage_object_id for share;
   if object.id is null or object.bucket_id<>'board-media' or object.name<>upload.object_path
     or object.metadata->>'mimetype' is distinct from upload.mime_type or object.metadata->'size' is distinct from to_jsonb(upload.final_byte_size) then
     raise exception 'BOARD_IMAGE_INVALID' using errcode='23514'; end if;
 end loop;
 perform private.claim_community_rate(actor.id,false,cfg);
 insert into public.posts(id,artist_id,user_id,request_id,title,body,is_notice,is_pinned)
 values(p_post_id,p_artist_id,actor.id,p_operation_id,p_title,p_body,p_is_notice,p_is_pinned);
 foreach upload_id in array p_upload_ids loop
   select * into strict upload from private.board_uploads where id=upload_id;
   insert into public.post_images(id,post_id,storage_object_id,bucket_id,object_path,mime_type,byte_size,width,height,position)
   values(upload.image_id,p_post_id,upload.storage_object_id,'board-media',upload.object_path,upload.mime_type,upload.final_byte_size,upload.width,upload.height,image_position);
   image_position:=image_position+1;
   update private.board_uploads set attached_at=clock_timestamp() where id=upload_id;
 end loop;
 if p_is_notice then insert into public.community_moderation_log(actor_id,target_type,target_id,action,reason)
 values(actor.id,'post',p_post_id,'notice',jsonb_build_object('notice',p_is_notice,'pinned',p_is_pinned)::text); end if;
 result:=jsonb_build_object('id',p_post_id,'artist_id',p_artist_id,'revision',1);
 insert into private.board_operations(actor_id,operation_id,request,response) values(actor.id,p_operation_id,request_value,result);
 return result;
end;
$$;
create function public.board_ui_delete(p_artist_slug text,p_operation_id uuid,p_post_id uuid,p_expected_revision bigint,p_confirmed boolean) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare actor public.profiles%rowtype; post public.posts%rowtype; request_value jsonb; prior private.board_operations%rowtype; result jsonb;
begin
 actor:=private.board_actor(auth.uid(),false,true);
 if p_confirmed is distinct from true then raise exception 'BOARD_CONFIRMATION_REQUIRED' using errcode='22023'; end if;
 if p_operation_id is null or p_post_id is null or p_expected_revision is null or p_expected_revision not between 1 and 9007199254740990 then
 raise exception 'BOARD_INVALID_INPUT' using errcode='22023'; end if;
 select * into post from public.posts where id=p_post_id;
 if (private.board_artist(post.artist_id)).slug is distinct from p_artist_slug then raise exception 'COMMUNITY_BOARD_UNAVAILABLE' using errcode='42501'; end if;
 request_value:=jsonb_build_object('action','delete','slug',p_artist_slug,'id',p_post_id,'revision',p_expected_revision);
 select * into prior from private.board_operations where actor_id=actor.id and operation_id=p_operation_id;
 if prior.operation_id is not null then
   if prior.request<>request_value then raise exception 'BOARD_OPERATION_CONFLICT' using errcode='23505'; end if;
   return prior.response;
 end if;
 select * into strict post from public.posts where id=p_post_id for update;
 if post.user_id<>actor.id or post.deleted_at is not null then raise exception 'COMMUNITY_TARGET_UNAVAILABLE' using errcode='42501'; end if;
 if post.revision<>p_expected_revision then raise exception 'BOARD_REVISION_CONFLICT' using errcode='40001'; end if;
 perform private.community_change_visibility(actor.id,'post',p_post_id,'delete','owner-delete',false);
 result:=jsonb_build_object('id',p_post_id,'deleted',true);
 insert into private.board_operations(actor_id,operation_id,request,response) values(actor.id,p_operation_id,request_value,result);
 return result;
end;
$$;
create function public.board_ui_notice(p_artist_slug text,p_operation_id uuid,p_post_id uuid,p_expected_revision bigint,p_is_notice boolean,p_is_pinned boolean) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare actor public.profiles%rowtype; post public.posts%rowtype; request_value jsonb; prior private.board_operations%rowtype; result jsonb;
begin
 actor:=private.board_actor(auth.uid(),false,true,true);
 if p_operation_id is null or p_post_id is null or p_expected_revision is null or p_expected_revision not between 1 and 9007199254740990
   or p_is_notice is null or p_is_pinned is null or (p_is_pinned and not p_is_notice) then raise exception 'BOARD_INVALID_INPUT' using errcode='22023'; end if;
 select * into post from public.posts where id=p_post_id;
 if (private.board_artist(post.artist_id)).slug is distinct from p_artist_slug then raise exception 'COMMUNITY_BOARD_UNAVAILABLE' using errcode='42501'; end if;
 request_value:=jsonb_build_object('action','notice','slug',p_artist_slug,'id',p_post_id,'revision',p_expected_revision,'is_notice',p_is_notice,'is_pinned',p_is_pinned);
 select * into prior from private.board_operations where actor_id=actor.id and operation_id=p_operation_id;
 if prior.operation_id is not null then
   if prior.request<>request_value then raise exception 'BOARD_OPERATION_CONFLICT' using errcode='23505'; end if;
   return prior.response;
 end if;
 select * into strict post from public.posts where id=p_post_id for update;
 if post.is_hidden or post.deleted_at is not null then raise exception 'COMMUNITY_TARGET_UNAVAILABLE' using errcode='42501'; end if;
 if post.revision<>p_expected_revision then raise exception 'BOARD_REVISION_CONFLICT' using errcode='40001'; end if;
 perform public.community_set_notice(post.id,p_is_notice,p_is_pinned);
 select * into strict post from public.posts where id=p_post_id;
 result:=jsonb_build_object('id',post.id,'artist_id',post.artist_id,'revision',post.revision,'is_notice',post.is_notice,'is_pinned',post.is_pinned);
 insert into private.board_operations(actor_id,operation_id,request,response) values(actor.id,p_operation_id,request_value,result);
 return result;
end;
$$;
create function public.board_media_resolve_read(p_actor_id uuid,p_image_id uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare image public.post_images%rowtype; post public.posts%rowtype; object storage.objects%rowtype;
begin
 perform private.board_actor(p_actor_id,true);
 select * into image from public.post_images where id=p_image_id;
 select * into post from public.posts where id=image.post_id;
 perform private.board_artist(post.artist_id);
 perform private.board_policy();
 select * into post from public.posts where id=image.post_id for share;
 if post.id is null or post.is_hidden or post.deleted_at is not null then raise exception 'COMMUNITY_TARGET_UNAVAILABLE' using errcode='42501'; end if;
 select * into image from public.post_images where id=p_image_id for share;
 select * into object from storage.objects where id=image.storage_object_id for share;
 if image.id is null or object.id is null or object.bucket_id<>'board-media' or object.name<>image.object_path
   or object.metadata->>'mimetype' is distinct from image.mime_type or object.metadata->'size' is distinct from to_jsonb(image.byte_size) then
   raise exception 'BOARD_IMAGE_INVALID' using errcode='23514'; end if;
 return jsonb_build_object('image_id',image.id,'post_id',post.id,'mime_type',image.mime_type,'byte_size',image.byte_size,
 'width',image.width,'height',image.height,'object_path',image.object_path,'bucket_id','board-media','access_expires_at',clock_timestamp()+interval '60 seconds');
end;
$$;

revoke all on function private.board_revision(),private.board_operation_immutable(),private.board_actor(uuid,boolean,boolean,boolean),
 private.board_artist(uuid),private.board_policy(),private.board_policy_projection(private.community_policy),
 private.board_post_projection(uuid,uuid,boolean),private.board_upload_projection(uuid) from public,anon,authenticated,service_role;
revoke all on function public.board_ui_list(text,integer,boolean,timestamptz,uuid),public.board_ui_detail(text,uuid),
 public.board_ui_create(text,uuid,uuid,uuid,text,text,uuid[],boolean,boolean),public.board_ui_delete(text,uuid,uuid,bigint,boolean),
 public.board_ui_notice(text,uuid,uuid,bigint,boolean,boolean),public.board_media_begin_upload(uuid,uuid,uuid,text,bigint,uuid),
 public.board_media_resolve_upload(uuid,uuid),public.board_media_finalize_upload(uuid,uuid,uuid,integer,integer),
 public.board_media_revoke_upload(uuid,uuid),public.board_media_resolve_read(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.board_ui_list(text,integer,boolean,timestamptz,uuid),public.board_ui_detail(text,uuid),
 public.board_ui_create(text,uuid,uuid,uuid,text,text,uuid[],boolean,boolean),public.board_ui_delete(text,uuid,uuid,bigint,boolean),
 public.board_ui_notice(text,uuid,uuid,bigint,boolean,boolean) to authenticated;
grant execute on function public.board_media_begin_upload(uuid,uuid,uuid,text,bigint,uuid),public.board_media_resolve_upload(uuid,uuid),
 public.board_media_finalize_upload(uuid,uuid,uuid,integer,integer),public.board_media_revoke_upload(uuid,uuid),
 public.board_media_resolve_read(uuid,uuid) to service_role;
comment on table private.board_uploads is 'Private pre-publication reservations. Two-hour transport expiry is not an operating policy; actual community limits require an existing approved snapshot.';
comment on table private.board_operations is 'Immutable actor-bound exact-request receipts for explicitly retried uncertain results. Legacy community RPCs remain unchanged and invalidate revision tokens.';
commit;
