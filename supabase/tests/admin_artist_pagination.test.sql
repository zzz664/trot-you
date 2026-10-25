begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
set local timezone='UTC';
select no_plan();

-- Fictional owner fixtures only; no invitation delivery or actual access grant.
insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data)
select ('ae100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'admin-page-'||n||'@example.invalid',now(),'{}'::jsonb
 from unnest(array[1,2]||array(select generate_series(10,60)))n;
update public.profiles set role='admin' where id='ae100000-0000-4000-8000-000000000001';
update public.profiles set role='artist' where id::text like 'ae100000%' and id not in('ae100000-0000-4000-8000-000000000001','ae100000-0000-4000-8000-000000000002');
insert into public.artists(id,slug,name,grade,status) values('ae200000-0000-4000-8000-000000000001','admin-page-main','허구 페이지 가수','B','active');
insert into public.artist_members(artist_id,user_id)
 select 'ae200000-0000-4000-8000-000000000001',id from public.profiles where id::text like 'ae100000%' and role='artist';
insert into public.messages(id,artist_id,author_id,type,body,status,scheduled_at,sent_at,is_preview,preview_order)
select ('ae400000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'ae200000-0000-4000-8000-000000000001','ae100000-0000-4000-8000-000000000001',
 'text','허구 페이지 글 '||n,'sent',now()-make_interval(mins=>n),now()-make_interval(mins=>n),n=51,case when n=51 then 1 end from generate_series(1,51)n;
insert into private.artist_account_invitations(id,artist_id,target_user_id,invited_by,is_manager,state,created_at,expires_at)
select ('ae500000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'ae200000-0000-4000-8000-000000000001',
 'ae100000-0000-4000-8000-000000000002','ae100000-0000-4000-8000-000000000001',false,case when n=51 then 'pending' else 'canceled' end,
 now()-make_interval(mins=>n),now()+interval '1 day' from generate_series(1,51)n;
create temporary table admin_pages(key text primary key,data jsonb);
grant all on admin_pages to authenticated;

select ok(has_function_privilege('authenticated','public.admin_artist_detail_page(uuid,integer)','EXECUTE') and
 not has_function_privilege('anon','public.admin_artist_detail_page(uuid,integer)','EXECUTE') and
 not has_function_privilege('service_role','public.admin_artist_detail_page(uuid,integer)','EXECUTE'),'admin pagination remains actor-authenticated only');
select ok(has_function_privilege('authenticated','public.artist_account_invitations_page(integer)','EXECUTE') and
 not has_function_privilege('anon','public.artist_account_invitations_page(integer)','EXECUTE') and
 not has_function_privilege('service_role','public.artist_account_invitations_page(integer)','EXECUTE'),'recipient pagination has no privileged impersonation argument');
set local role authenticated;
select set_config('request.jwt.claim.sub','ae100000-0000-4000-8000-000000000001',true);
insert into admin_pages values('first',public.admin_artist_detail_page('ae200000-0000-4000-8000-000000000001',1)),
 ('second',public.admin_artist_detail_page('ae200000-0000-4000-8000-000000000001',2));
select is(public.admin_artist_detail('ae200000-0000-4000-8000-000000000001'),(select data from admin_pages where key='first'),'legacy detail wrapper keeps exact first-page DTO');
select is(jsonb_array_length((select data->'messages' from admin_pages where key='first')),50,'candidate message page is bounded');
select is(jsonb_array_length((select data->'messages' from admin_pages where key='second')),1,'older unselected candidates remain reachable');
select is((select data->'messages'->0->>'id' from admin_pages where key='second'),'ae400000-0000-4000-8000-000000000051','message offset preserves sent-at and UUID ordering');
select is((select data->'previews' from admin_pages where key='first'),(select data->'previews' from admin_pages where key='second'),'selected previews remain complete on every page');
select is((select data->'previews'->0->>'id' from admin_pages where key='first'),'ae400000-0000-4000-8000-000000000051','older selected preview is visible even before its candidate page');
select is(jsonb_array_length((select data->'members' from admin_pages where key='first')),50,'member page is bounded');
select is(jsonb_array_length((select data->'members' from admin_pages where key='second')),1,'older member remains manageable');
select is((select data->'members'->0->>'user_id' from admin_pages where key='second'),'ae100000-0000-4000-8000-000000000060','member order is deterministic');
select is(jsonb_array_length((select data->'invitations' from admin_pages where key='second')),1,'older admin invitation remains cancelable');
select ok((select (data->>'messages_has_more')::boolean and (data->>'members_has_more')::boolean and (data->>'invitations_has_more')::boolean from admin_pages where key='first'),
 'each sublist exposes its first-page continuation');
select ok((select not(data->>'messages_has_more')::boolean and not(data->>'members_has_more')::boolean and not(data->>'invitations_has_more')::boolean from admin_pages where key='second'),
 'terminal shared page does not advertise phantom rows');
select throws_ok($$select public.admin_artist_detail_page('ae200000-0000-4000-8000-000000000001',0)$$,'22023','ADMIN_ARTIST_INVALID_INPUT','admin page zero rejected');
select throws_ok($$select public.admin_artist_detail_page('ae200000-0000-4000-8000-000000000001',1001)$$,'22023','ADMIN_ARTIST_INVALID_INPUT','admin page upper bound enforced');
select set_config('request.jwt.claim.sub','ae100000-0000-4000-8000-000000000002',true);
select throws_ok($$select public.admin_artist_detail_page('ae200000-0000-4000-8000-000000000001',2)$$,'42501','ADMIN_ARTIST_FORBIDDEN','new pagination endpoint does not weaken admin gate');
insert into admin_pages values('recipient_first',public.artist_account_invitations_page(1)),('recipient_second',public.artist_account_invitations_page(2));
select is(public.artist_account_invitations_page(1)->>'user_id','ae100000-0000-4000-8000-000000000002','recipient identity comes from current authenticated RPC, never a cached page prop');
select is(public.artist_account_invitations(),(select data from admin_pages where key='recipient_first'),'legacy recipient wrapper keeps exact first-page DTO');
select is((select data->'invitations'->0->>'id' from admin_pages where key='recipient_first'),'ae500000-0000-4000-8000-000000000051','old actionable invitation sorts before historical responses');
select is(jsonb_array_length((select data->'invitations' from admin_pages where key='recipient_first')),50,'recipient first page is bounded');
select is(jsonb_array_length((select data->'invitations' from admin_pages where key='recipient_second')),1,'recipient can reach history beyond first fifty');
select is((select data->'invitations'->0->>'id' from admin_pages where key='recipient_second'),'ae500000-0000-4000-8000-000000000050','recipient continuation is deterministic after actionable priority');
select is(public.artist_account_invitations_page(3)->'invitations','[]'::jsonb,'later empty recipient page is explicit');
select is(public.artist_account_invitations_page(3)->>'has_more','false','empty recipient page has no false continuation');
select throws_ok('select public.artist_account_invitations_page(null)','22023','ADMIN_ARTIST_INVALID_INPUT','recipient null page rejected');
select throws_ok('select public.artist_account_invitations_page(1001)','22023','ADMIN_ARTIST_INVALID_INPUT','recipient page upper bound enforced');
select set_config('request.jwt.claim.sub','ae100000-0000-4000-8000-000000000010',true);
select is(public.artist_account_invitations_page(2)->'invitations','[]'::jsonb,'recipient pagination never enumerates another user history');
reset role;
select * from finish();
rollback;
