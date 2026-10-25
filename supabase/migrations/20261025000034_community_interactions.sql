-- Feature 35: visible-post comments and desired like state. No operating policy
-- defaults, moderation UI, reward-policy approval or new reward mechanism.
begin;

alter table public.comments add column revision bigint not null default 1
  check(revision between 1 and 9007199254740991);
create trigger board_comment_revision before update on public.comments
  for each row execute function private.board_revision();

-- Match the existing actor -> artist -> post -> comment lock order. A SHARE
-- parent lock keeps the complete read page/counters stable against all community
-- RPC writes; UPDATE serializes counter changes with existing moderation paths.
create function private.community_ui_post(p_artist_slug text,p_post_id uuid,p_write boolean)
returns public.posts language plpgsql security definer set search_path='' as $$
declare artist_id_value uuid; artist public.artists%rowtype; post public.posts%rowtype;
begin
 select id into artist_id_value from public.artists where slug=p_artist_slug;
 artist:=private.board_artist(artist_id_value);
 if p_write then
   select * into post from public.posts where id=p_post_id and artist_id=artist.id for update;
 else
   select * into post from public.posts where id=p_post_id and artist_id=artist.id for share;
 end if;
 if post.id is null or post.is_hidden or post.deleted_at is not null then
   raise exception 'COMMUNITY_TARGET_UNAVAILABLE' using errcode='42501'; end if;
 return post;
end;
$$;
create function private.community_ui_comment_projection(p_id uuid,p_actor uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',c.id,'post_id',c.post_id,'author',jsonb_build_object('call_name',a.call_name),
 'is_owner',c.user_id=p_actor,'body',c.body,'created_at',c.created_at,'updated_at',c.updated_at,'revision',c.revision)
 from public.comments c join public.profiles a on a.id=c.user_id where c.id=p_id;
$$;

create function public.community_ui_interactions(p_artist_slug text,p_post_id uuid,p_limit integer default 21,
 p_after_created_at timestamptz default null,p_after_id uuid default null) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare actor public.profiles%rowtype; post public.posts%rowtype; cfg private.community_policy%rowtype;
 rows jsonb; cursor_value jsonb;
begin
 actor:=private.board_actor(auth.uid(),false);
 if p_post_id is null or p_limit is null or p_limit not between 1 and 100
   or (p_after_created_at is null)<>(p_after_id is null)
   or (p_after_created_at is not null and not isfinite(p_after_created_at)) then
   raise exception 'BOARD_INVALID_INPUT' using errcode='22023'; end if;
 post:=private.community_ui_post(p_artist_slug,p_post_id,false);
 cfg:=private.board_policy();
 with page as materialized(select c.* from public.comments c where c.post_id=post.id and not c.is_hidden and c.deleted_at is null
   and (p_after_id is null or (c.created_at,c.id)>(p_after_created_at,p_after_id))
   order by c.created_at,c.id limit p_limit+1),
 shown as materialized(select * from page order by created_at,id limit p_limit)
 select coalesce((select jsonb_agg(private.community_ui_comment_projection(s.id,actor.id) order by s.created_at,s.id) from shown s),'[]'::jsonb),
 case when (select count(*) from page)>p_limit then (select jsonb_build_object('created_at',s.created_at,'id',s.id)
 from shown s order by s.created_at desc,s.id desc limit 1) end into rows,cursor_value;
 return jsonb_build_object('actor_id',actor.id,'post_id',post.id,'policy',jsonb_build_object('max_comment_length',cfg.max_comment_length),
 'like_count',post.like_count,'comment_count',post.comment_count,'liked',exists(select 1 from public.post_likes where post_id=post.id and user_id=actor.id),
 'comments',rows,'next_cursor',cursor_value);
end;
$$;

create function public.community_ui_create_comment(p_artist_slug text,p_operation_id uuid,p_post_id uuid,p_comment_id uuid,p_body text)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare actor public.profiles%rowtype; post public.posts%rowtype; cfg private.community_policy%rowtype;
 request_value jsonb; prior private.board_operations%rowtype; comment_value public.comments%rowtype; result jsonb;
begin
 actor:=private.board_actor(auth.uid(),false,true);
 if p_operation_id is null or p_post_id is null or p_comment_id is null then raise exception 'BOARD_INVALID_INPUT' using errcode='22023'; end if;
 post:=private.community_ui_post(p_artist_slug,p_post_id,true);
 cfg:=private.board_policy();
 request_value:=jsonb_build_object('action','comment_create','slug',p_artist_slug,'post_id',p_post_id,'id',p_comment_id,'body',p_body);
 select * into prior from private.board_operations where actor_id=actor.id and operation_id=p_operation_id;
 if prior.operation_id is not null then
   if prior.request<>request_value then raise exception 'BOARD_OPERATION_CONFLICT' using errcode='23505'; end if;
   select * into comment_value from public.comments where id=p_comment_id and post_id=post.id for update;
   if comment_value.id is null or comment_value.user_id<>actor.id or comment_value.is_hidden or comment_value.deleted_at is not null then
     raise exception 'COMMUNITY_TARGET_UNAVAILABLE' using errcode='42501'; end if;
   return prior.response;
 end if;
 if exists(select 1 from public.comments where id=p_comment_id or (user_id=actor.id and request_id=p_operation_id)) then
   raise exception 'BOARD_OPERATION_CONFLICT' using errcode='23505'; end if;
 perform private.validate_community_text(p_body,cfg.max_comment_length,cfg);
 perform private.claim_community_rate(actor.id,false,cfg);
 insert into public.comments(id,post_id,user_id,request_id,body) values(p_comment_id,post.id,actor.id,p_operation_id,p_body);
 -- Preserve existing creation/reward triggers and the same single parent counter
 -- increment as the legacy RPC. All retries return before either side effect.
 update public.posts set comment_count=comment_count+1 where id=post.id;
 result:=jsonb_build_object('id',p_comment_id,'post_id',post.id,'revision',1);
 insert into private.board_operations(actor_id,operation_id,request,response) values(actor.id,p_operation_id,request_value,result);
 return result;
end;
$$;

create function public.community_ui_update_comment(p_artist_slug text,p_operation_id uuid,p_post_id uuid,p_comment_id uuid,
 p_expected_revision bigint,p_body text) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare actor public.profiles%rowtype; post public.posts%rowtype; cfg private.community_policy%rowtype;
 request_value jsonb; prior private.board_operations%rowtype; comment_value public.comments%rowtype; result jsonb;
begin
 actor:=private.board_actor(auth.uid(),false,true);
 if p_operation_id is null or p_post_id is null or p_comment_id is null or p_expected_revision is null
   or p_expected_revision not between 1 and 9007199254740990 then raise exception 'BOARD_INVALID_INPUT' using errcode='22023'; end if;
 post:=private.community_ui_post(p_artist_slug,p_post_id,true);
 select * into comment_value from public.comments where id=p_comment_id and post_id=post.id for update;
 if comment_value.id is null or comment_value.user_id<>actor.id or comment_value.is_hidden or comment_value.deleted_at is not null then
   raise exception 'COMMUNITY_TARGET_UNAVAILABLE' using errcode='42501'; end if;
 cfg:=private.board_policy();
 request_value:=jsonb_build_object('action','comment_update','slug',p_artist_slug,'post_id',p_post_id,'id',p_comment_id,'revision',p_expected_revision,'body',p_body);
 select * into prior from private.board_operations where actor_id=actor.id and operation_id=p_operation_id;
 if prior.operation_id is not null then
   if prior.request<>request_value then raise exception 'BOARD_OPERATION_CONFLICT' using errcode='23505'; end if;
   return prior.response;
 end if;
 if comment_value.revision<>p_expected_revision then raise exception 'BOARD_REVISION_CONFLICT' using errcode='40001'; end if;
 perform private.validate_community_text(p_body,cfg.max_comment_length,cfg);
 if comment_value.body<>p_body then
   perform private.claim_community_rate(actor.id,false,cfg);
   update public.comments set body=p_body where id=comment_value.id returning * into comment_value;
 end if;
 result:=jsonb_build_object('id',comment_value.id,'post_id',post.id,'revision',comment_value.revision);
 insert into private.board_operations(actor_id,operation_id,request,response) values(actor.id,p_operation_id,request_value,result);
 return result;
end;
$$;

create function public.community_ui_delete_comment(p_artist_slug text,p_operation_id uuid,p_post_id uuid,p_comment_id uuid,
 p_expected_revision bigint,p_confirmed boolean) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare actor public.profiles%rowtype; post public.posts%rowtype;
 request_value jsonb; prior private.board_operations%rowtype; comment_value public.comments%rowtype; result jsonb;
begin
 actor:=private.board_actor(auth.uid(),false,true);
 if p_confirmed is distinct from true then raise exception 'BOARD_CONFIRMATION_REQUIRED' using errcode='22023'; end if;
 if p_operation_id is null or p_post_id is null or p_comment_id is null or p_expected_revision is null
   or p_expected_revision not between 1 and 9007199254740990 then raise exception 'BOARD_INVALID_INPUT' using errcode='22023'; end if;
 post:=private.community_ui_post(p_artist_slug,p_post_id,true);
 select * into comment_value from public.comments where id=p_comment_id and post_id=post.id for update;
 if comment_value.id is null or comment_value.user_id<>actor.id then raise exception 'COMMUNITY_TARGET_UNAVAILABLE' using errcode='42501'; end if;
 perform private.board_policy();
 request_value:=jsonb_build_object('action','comment_delete','slug',p_artist_slug,'post_id',p_post_id,'id',p_comment_id,'revision',p_expected_revision);
 select * into prior from private.board_operations where actor_id=actor.id and operation_id=p_operation_id;
 if prior.operation_id is not null then
   if prior.request<>request_value then raise exception 'BOARD_OPERATION_CONFLICT' using errcode='23505'; end if;
   -- A confirmed deletion may recover only its immutable receipt, not a body.
   -- Current actor, artist, parent and policy were revalidated above.
   return prior.response;
 end if;
 if comment_value.is_hidden or comment_value.deleted_at is not null then raise exception 'COMMUNITY_TARGET_UNAVAILABLE' using errcode='42501'; end if;
 if comment_value.revision<>p_expected_revision then raise exception 'BOARD_REVISION_CONFLICT' using errcode='40001'; end if;
 perform private.community_change_visibility(actor.id,'comment',comment_value.id,'delete','owner-delete',false);
 result:=jsonb_build_object('id',comment_value.id,'post_id',post.id,'deleted',true);
 insert into private.board_operations(actor_id,operation_id,request,response) values(actor.id,p_operation_id,request_value,result);
 return result;
end;
$$;

create function public.community_ui_set_like(p_artist_slug text,p_operation_id uuid,p_post_id uuid,p_liked boolean) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare actor public.profiles%rowtype; post public.posts%rowtype;
 request_value jsonb; prior private.board_operations%rowtype; result jsonb; changed integer;
begin
 actor:=private.board_actor(auth.uid(),false,true);
 if p_operation_id is null or p_post_id is null or p_liked is null then raise exception 'BOARD_INVALID_INPUT' using errcode='22023'; end if;
 post:=private.community_ui_post(p_artist_slug,p_post_id,true);
 perform private.board_policy();
 request_value:=jsonb_build_object('action','like','slug',p_artist_slug,'post_id',p_post_id,'liked',p_liked);
 select * into prior from private.board_operations where actor_id=actor.id and operation_id=p_operation_id;
 if prior.operation_id is not null then
   if prior.request<>request_value then raise exception 'BOARD_OPERATION_CONFLICT' using errcode='23505'; end if;
   return prior.response;
 end if;
 if p_liked then
   insert into public.post_likes(post_id,user_id) values(post.id,actor.id) on conflict do nothing;
   get diagnostics changed=row_count;
 else
   delete from public.post_likes where post_id=post.id and user_id=actor.id;
   get diagnostics changed=row_count;
 end if;
 if changed>0 then update public.posts set like_count=like_count+(case when p_liked then changed else -changed end) where id=post.id; end if;
 result:=jsonb_build_object('post_id',post.id,'liked',p_liked);
 insert into private.board_operations(actor_id,operation_id,request,response) values(actor.id,p_operation_id,request_value,result);
 return result;
end;
$$;

revoke all on function private.community_ui_post(text,uuid,boolean),private.community_ui_comment_projection(uuid,uuid)
 from public,anon,authenticated,service_role;
revoke all on function public.community_ui_interactions(text,uuid,integer,timestamptz,uuid),
 public.community_ui_create_comment(text,uuid,uuid,uuid,text),public.community_ui_update_comment(text,uuid,uuid,uuid,bigint,text),
 public.community_ui_delete_comment(text,uuid,uuid,uuid,bigint,boolean),public.community_ui_set_like(text,uuid,uuid,boolean)
 from public,anon,authenticated,service_role;
grant execute on function public.community_ui_interactions(text,uuid,integer,timestamptz,uuid),
 public.community_ui_create_comment(text,uuid,uuid,uuid,text),public.community_ui_update_comment(text,uuid,uuid,uuid,bigint,text),
 public.community_ui_delete_comment(text,uuid,uuid,uuid,bigint,boolean),public.community_ui_set_like(text,uuid,uuid,boolean)
 to authenticated;
comment on column public.comments.revision is 'CAS token invalidated by every comment update, including existing edit, report, restore and delete paths.';
commit;
