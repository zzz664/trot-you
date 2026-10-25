begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
set local timezone='UTC';
select no_plan();

select ok((select bool_and(prosecdef and 'search_path=""'=any(proconfig)) from pg_proc where oid in(
 'public.artist_reply_activity_artists(text)'::regprocedure,'public.artist_reply_activity_context(text,uuid,timestamptz,uuid)'::regprocedure,
 'public.artist_reply_activity_messages(text,timestamptz,uuid)'::regprocedure)),'read RPCs have pinned definer paths');
select ok((select bool_and(has_function_privilege('authenticated',fn,'EXECUTE') and not has_function_privilege('anon',fn,'EXECUTE')
 and not has_function_privilege('service_role',fn,'EXECUTE')) from unnest(array['public.artist_reply_activity_artists(text)',
 'public.artist_reply_activity_context(text,uuid,timestamptz,uuid)','public.artist_reply_activity_messages(text,timestamptz,uuid)']) fn),
 'only actual authenticated subjects receive artist read grants');
select ok((select bool_and(not has_function_privilege(role,fn,'EXECUTE')) from unnest(array['anon','authenticated','service_role']) role
 cross join unnest(array['private.artist_reply_activity_actor()','private.artist_reply_activity_artist(uuid,text)',
 'private.artist_reply_fan_visible(uuid,timestamptz)','private.artist_reply_activity_week(uuid,timestamptz)']) fn),
 'private actor and arbitrary-time helpers are not client RPCs');
select ok(not has_table_privilege('authenticated','public.replies','SELECT'),'raw replies stay inaccessible');
select ok(not has_table_privilege('authenticated','private.settlement_policies','SELECT'),'weekly projection does not grant raw financial policy access');
select is((select count(*) from private.settlement_policies),0::bigint,'migration never activates invented contract minima');

insert into auth.users(id,email,raw_user_meta_data)
select ('ac100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'artist-activity-'||n||'@example.invalid','{}'::jsonb from generate_series(1,9) n;
update public.profiles set call_name='가상 팬',nickname='비공개 별명',phone='010-0000-0000',onboarding_completed_at=now()
 where id::text like 'ac100000-%';
update public.profiles set role='artist' where id in('ac100000-0000-4000-8000-000000000001','ac100000-0000-4000-8000-000000000002');
update public.profiles set role='admin' where id='ac100000-0000-4000-8000-000000000009';
update public.profiles set is_restricted=true where id='ac100000-0000-4000-8000-000000000005';
update public.profiles set is_restricted=true,restricted_until=now()-interval '1 second' where id='ac100000-0000-4000-8000-000000000006';
update public.profiles set onboarding_completed_at=null,call_name=null where id='ac100000-0000-4000-8000-000000000007';
insert into public.artists(id,slug,name,grade,status) values
 ('ac200000-0000-4000-8000-000000000001','activity-main','가상 활동 가수','B','active'),
 ('ac200000-0000-4000-8000-000000000002','activity-other','가상 다른 가수','B','active'),
 ('ac200000-0000-4000-8000-000000000003','activity-paused','가상 중지 가수','B','paused');
insert into public.artist_members(artist_id,user_id) values
 ('ac200000-0000-4000-8000-000000000001','ac100000-0000-4000-8000-000000000001'),
 ('ac200000-0000-4000-8000-000000000001','ac100000-0000-4000-8000-000000000002'),
 ('ac200000-0000-4000-8000-000000000003','ac100000-0000-4000-8000-000000000001');
insert into public.subscriptions(id,user_id,artist_id,provider,status,first_started_at,episode_started_at,current_period_start,current_period_end)
select ('ac300000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,('ac100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 'ac200000-0000-4000-8000-000000000001','toss','expired',now()-interval '2 days',now()-interval '2 days',now()-interval '2 days',now()-interval '1 day'
 from generate_series(3,8) n;
insert into public.messages(id,artist_id,author_id,type,body,status,scheduled_at,sent_at)
select ('ac400000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'ac200000-0000-4000-8000-000000000001',
 case when n%2=0 then 'ac100000-0000-4000-8000-000000000002'::uuid else 'ac100000-0000-4000-8000-000000000001'::uuid end,
 'text','가상 메시지 비공개 본문','sent',now()-interval '1 minute',now()-interval '1 minute' from generate_series(1,35) n;
insert into public.messages(id,artist_id,author_id,type,body,status,scheduled_at,sent_at) values
 ('ac400000-0000-4000-8000-000000000099','ac200000-0000-4000-8000-000000000002','ac100000-0000-4000-8000-000000000001',
 'text','다른 가수 본문','sent',now()-interval '1 minute',now()-interval '1 minute');
insert into public.replies(id,user_id,artist_id,subscription_id,body,message_id,created_at)
select ('ac500000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'ac100000-0000-4000-8000-000000000003',
 'ac200000-0000-4000-8000-000000000001','ac300000-0000-4000-8000-000000000003','가상 답장 '||n,
 case when n%2=0 then 'ac400000-0000-4000-8000-000000000001'::uuid end,now()-interval '30 seconds' from generate_series(1,35) n;
insert into public.replies(id,user_id,artist_id,subscription_id,body,is_blocked,created_at)
select ('ac500000-0000-4000-8000-'||lpad((n+100)::text,12,'0'))::uuid,('ac100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 'ac200000-0000-4000-8000-000000000001',('ac300000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 '가상 필터 답장 '||n,n=4,now()-interval '1 minute' from generate_series(4,8) n;
update public.profiles set role='artist' where id='ac100000-0000-4000-8000-000000000008';
create temporary table activity_results(key text primary key,data jsonb);
grant all on activity_results to authenticated,service_role;

set local role authenticated;
select set_config('request.jwt.claim.sub','ac100000-0000-4000-8000-000000000001',true);
select is(jsonb_array_length(public.artist_reply_activity_artists()->'artists'),1,'catalog only contains active assigned artists');
select is(public.artist_reply_activity_artists('activity-main')->'artists','[]'::jsonb,'catalog cursor is strict slug ordering');
select throws_ok($$select public.artist_reply_activity_artists('INVALID')$$,'22023','ARTIST_REPLY_INVALID_INPUT','catalog rejects invalid slug cursor');
select throws_ok($$select public.artist_reply_activity_context('activity-other')$$,'42501','ARTIST_REPLY_FORBIDDEN','other artist access is denied');
select throws_ok($$select public.artist_reply_activity_context('activity-paused')$$,'P0002','ARTIST_REPLY_NOT_FOUND','paused assignment is not a readable artist');
select throws_ok($$select public.artist_reply_activity_context('no-such-artist')$$,'P0002','ARTIST_REPLY_NOT_FOUND','missing artist fails closed');
select throws_ok($$select public.artist_reply_activity_context('INVALID')$$,'22023','ARTIST_REPLY_INVALID_INPUT','invalid slug fails validation');
select throws_ok($$select public.artist_reply_activity_context('activity-main',null,now(),null)$$,'22023','ARTIST_REPLY_INVALID_INPUT','reply cursor cannot omit UUID');
select throws_ok($$select public.artist_reply_activity_context('activity-main',null,null,gen_random_uuid())$$,'22023','ARTIST_REPLY_INVALID_INPUT','reply cursor cannot omit instant');
select throws_ok($$select public.artist_reply_activity_context('activity-main',null,'infinity',gen_random_uuid())$$,'22023','ARTIST_REPLY_INVALID_INPUT','reply cursor rejects infinity');
select throws_ok($$select public.artist_reply_activity_messages('activity-main',now(),null)$$,'22023','ARTIST_REPLY_INVALID_INPUT','message cursor requires UUID');
select throws_ok($$select public.artist_reply_activity_messages('activity-main','infinity',gen_random_uuid())$$,'22023','ARTIST_REPLY_INVALID_INPUT','message cursor rejects infinity');
select throws_ok($$select public.artist_reply_activity_context('activity-main','ac400000-0000-4000-8000-000000000099')$$,'P0002','ARTIST_REPLY_NOT_FOUND','foreign message filter never escapes artist boundary');
insert into activity_results values('first',public.artist_reply_activity_context('activity-main'));
select is(jsonb_array_length((select data->'replies' from activity_results where key='first')),30,'reply page is bounded to thirty visible items');
select is((select data->>'has_more' from activity_results where key='first'),'true','visible sentinel establishes more replies');
select is((select data->'replies'->0->>'id' from activity_results where key='first'),'ac500000-0000-4000-8000-000000000035','equal timestamps sort by descending UUID');
select is((select data->'replies'->29->>'id' from activity_results where key='first'),'ac500000-0000-4000-8000-000000000006','last visible cursor keeps exact tie breaker');
select is((select string_agg(k,',' order by k) from jsonb_object_keys((select data->'replies'->0 from activity_results where key='first')) k),
 'body,call_name,created_at,id,message_id','reply DTO has no fan UUID, nickname, phone, email, subscription or operation identifier');
select ok(not (select data::text from activity_results where key='first') ~ 'ac100000|ac300000|비공개 별명|010-0000|example.invalid','full response contains no private fan fields');
select is((select data->'activity'->>'requirements_ready' from activity_results where key='first'),'false','missing approved contract does not invent document defaults');
select is((select data->'activity'->'weekly_message_min' from activity_results where key='first'),'null'::jsonb,'missing message threshold is null not zero');
select is((select data->'activity'->'weekly_photo_min' from activity_results where key='first'),'null'::jsonb,'missing photo threshold is null not zero');
insert into activity_results select 'second',public.artist_reply_activity_context('activity-main',null,
 (data->'replies'->29->>'created_at')::timestamptz,(data->'replies'->29->>'id')::uuid) from activity_results where key='first';
select is(jsonb_array_length((select data->'replies' from activity_results where key='second')),6,'next page contains remaining five plus expired-restriction fan only');
select is((select data->>'has_more' from activity_results where key='second'),'false','final page has no phantom next page');
select is((select data->'replies'->5->>'id' from activity_results where key='second'),'ac500000-0000-4000-8000-000000000106','blocked/restricted/unonboarded/nonfan profiles omitted including calling names');
select is(jsonb_array_length(public.artist_reply_activity_context('activity-main','ac400000-0000-4000-8000-000000000001')->'replies'),17,'message filter includes only linked replies');
select is(public.artist_reply_activity_context('activity-main','ac400000-0000-4000-8000-000000000001')->'selected_message'->>'id',
 'ac400000-0000-4000-8000-000000000001','selected filter is returned independently of message options page');
insert into activity_results values('messages',public.artist_reply_activity_messages('activity-main'));
select is(jsonb_array_length((select data->'messages' from activity_results where key='messages')),30,'message selector is separately paginated');
select is((select data->>'has_more' from activity_results where key='messages'),'true','message options have sentinel pagination');
select is((select string_agg(k,',' order by k) from jsonb_object_keys((select data->'messages'->0 from activity_results where key='messages')) k),
 'id,kind,sent_at','message options expose no unnecessary raw template/media/author fields');
select is(jsonb_array_length(public.artist_reply_activity_messages('activity-main',now()-interval '1 minute','ac400000-0000-4000-8000-000000000006')->'messages'),5,
 'message cursor paginates exact tied timestamp without repeats');
select set_config('request.jwt.claim.sub','ac100000-0000-4000-8000-000000000002',true);
select is(jsonb_array_length(public.artist_reply_activity_context('activity-main')->'replies'),30,'assigned teammate may read artist-wide received replies');
select set_config('request.jwt.claim.sub','ac100000-0000-4000-8000-000000000003',true);
select throws_ok($$select public.artist_reply_activity_context('activity-main')$$,'42501','ARTIST_REPLY_FORBIDDEN','fan cannot enter artist read mode');
select set_config('request.jwt.claim.sub','ac100000-0000-4000-8000-000000000009',true);
select throws_ok($$select public.artist_reply_activity_context('activity-main')$$,'42501','ARTIST_REPLY_FORBIDDEN','admin cannot impersonate artist dashboard role');
reset role;

-- Physical deletion cannot return a tombstone with a fan identity. The schema
-- intentionally has no guessed soft-delete state and retains financial FKs.
delete from public.replies where id='ac500000-0000-4000-8000-000000000001';
update public.messages set status='canceled',canceled_at=now() where id='ac400000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub','ac100000-0000-4000-8000-000000000001',true);
select throws_ok($$select public.artist_reply_activity_context('activity-main','ac400000-0000-4000-8000-000000000001')$$,'P0002','ARTIST_REPLY_NOT_FOUND','canceled filter is unavailable rather than a stale content link');
select is(public.artist_reply_activity_context('activity-main')->'replies'->1->'message_id','null'::jsonb,'received reply survives cancellation without pointing to unavailable message');
select ok(not exists(select 1 from jsonb_array_elements(public.artist_reply_activity_context('activity-main',null,
 now()-interval '30 seconds','ac500000-0000-4000-8000-000000000006')->'replies') r where r->>'id'='ac500000-0000-4000-8000-000000000001'),
 'physically deleted reply disappears on fresh page');
reset role;
update public.profiles set is_restricted=true where id='ac100000-0000-4000-8000-000000000001';
set local role authenticated;
select throws_ok($$select public.artist_reply_activity_context('activity-main')$$,'42501','ARTIST_REPLY_FORBIDDEN','artist restriction blocks already-known cursor/filter paths');
reset role;
update public.profiles set is_restricted=false where id='ac100000-0000-4000-8000-000000000001';
delete from public.artist_members where user_id='ac100000-0000-4000-8000-000000000001' and artist_id='ac200000-0000-4000-8000-000000000001';
set local role authenticated;
select throws_ok($$select public.artist_reply_activity_context('activity-main')$$,'42501','ARTIST_REPLY_FORBIDDEN','membership removal revokes reply access');
reset role;
insert into public.artist_members values('ac200000-0000-4000-8000-000000000001','ac100000-0000-4000-8000-000000000001',false);
update public.profiles set onboarding_completed_at=null where id='ac100000-0000-4000-8000-000000000001';
set local role authenticated;
select throws_ok($$select public.artist_reply_activity_artists()$$,'42501','ARTIST_REPLY_FORBIDDEN','unonboarded artist cannot enumerate assignments');
reset role;
update public.profiles set onboarding_completed_at=now() where id='ac100000-0000-4000-8000-000000000001';
set local role service_role;
select is((select count(*) from public.messaging_list_replies('ac100000-0000-4000-8000-000000000001','ac200000-0000-4000-8000-000000000001',100)),35::bigint,
 'legacy service-only ABI aligns with visibility: thirty-four retained plus expired restriction');
select is((select string_agg(k,',' order by k) from jsonb_object_keys((select to_jsonb(r) from public.messaging_list_replies(
 'ac100000-0000-4000-8000-000000000001','ac200000-0000-4000-8000-000000000001',1) r)) k),'body,call_name,created_at,id',
 'legacy ABI retains exactly its original safe fields');
reset role;
select is((select count(*) from public.payment_events),0::bigint,'artist reads create no payment ledger effects');
select is((select count(*) from private.notification_jobs),0::bigint,'received-reply reads send no notifications');
select is((select count(*) from public.settlements),0::bigint,'source dashboard never calculates or changes settlements');

select * from finish();
rollback;
