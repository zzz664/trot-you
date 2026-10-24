begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();

-- Fictional rollback-only context, including current policy/legal readiness.
select ok((select bool_and(p.prosecdef and 'search_path=""'=any(p.proconfig)) from pg_proc p
 where p.oid in ('public.fan_chat_page(uuid,text,integer,timestamptz,uuid)'::regprocedure,
 'public.fan_chat_mark_read(text,uuid)'::regprocedure)),'chat privilege boundaries pin empty search_path');
select ok(has_function_privilege('service_role','public.fan_chat_page(uuid,text,integer,timestamptz,uuid)','EXECUTE'),'server may obtain raw renderer input');
select ok(not has_function_privilege('service_role','public.fan_chat_mark_read(text,uuid)','EXECUTE'),'service cannot forge browser read evidence');
select ok(has_function_privilege('authenticated','public.fan_chat_mark_read(text,uuid)','EXECUTE'),'signed-in actor may mark their own paid reads');
select ok((select bool_and(not has_function_privilege(r,'public.fan_chat_page(uuid,text,integer,timestamptz,uuid)','EXECUTE')) from unnest(array['anon','authenticated']) r),'browser roles cannot fetch raw chat templates');
select ok(not has_function_privilege('anon','public.fan_chat_mark_read(text,uuid)','EXECUTE'),'anonymous cannot create reading evidence');
select ok((select not (proargnames && array['p_actor_id','p_user_id','p_read_at','p_read_count']) from pg_proc where oid='public.fan_chat_mark_read(text,uuid)'::regprocedure),'read endpoint accepts no actor, timestamp or count');
select is((select count(*) from private.message_policy),0::bigint,'migration activates no message policy');

insert into auth.users(id,email,raw_user_meta_data)
select ('f6100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'chat-fixture-'||n||'@example.invalid','{}'::jsonb from generate_series(1,9) n;
update public.profiles set role='artist' where id='f6100000-0000-4000-8000-000000000009';
insert into public.artists(id,slug,name,intro,grade,status,agency_name) values
 ('f6200000-0000-4000-8000-000000000001','chat-main','허구 대화 가수','허구 소개','B','active','PRIVATE AGENCY'),
 ('f6200000-0000-4000-8000-000000000002','chat-other','허구 다른 가수',null,'B','active',null),
 ('f6200000-0000-4000-8000-000000000003','chat-hidden','허구 숨긴 가수',null,'B','paused',null);
insert into public.artist_members(artist_id,user_id) values('f6200000-0000-4000-8000-000000000001','f6100000-0000-4000-8000-000000000009');
insert into private.onboarding_documents(version,kind,title,body,approved_at,published_at) values
 ('f6900000-0000-4000-8000-000000000001','terms','Fictional terms','Rollback test only.',now(),now()),
 ('f6900000-0000-4000-8000-000000000002','privacy','Fictional privacy','Rollback test only.',now(),now()),
 ('f6900000-0000-4000-8000-000000000003','terms','Fictional replacement','Rollback test only.',now(),now());
insert into private.profile_onboarding_policy values(true,'f6800000-0000-4000-8000-000000000001',now(),2,10,array['금지단어'],
 'f6900000-0000-4000-8000-000000000001','f6900000-0000-4000-8000-000000000002',null);
set local role authenticated;
select set_config('request.jwt.claim.sub','f6100000-0000-4000-8000-000000000001',true);
select public.onboarding_save_font('normal');
select public.onboarding_save_name('허구팬1');
select public.onboarding_complete_profile(true,true,'f6900000-0000-4000-8000-000000000001',true,'f6900000-0000-4000-8000-000000000002');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','f6100000-0000-4000-8000-000000000002',true);
select public.onboarding_save_font('normal');
select public.onboarding_save_name('허구팬2');
select public.onboarding_complete_profile(true,true,'f6900000-0000-4000-8000-000000000001',true,'f6900000-0000-4000-8000-000000000002');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','f6100000-0000-4000-8000-000000000003',true);
select public.onboarding_save_font('normal');
select public.onboarding_save_name('허구팬3');
select public.onboarding_complete_profile(true,true,'f6900000-0000-4000-8000-000000000001',true,'f6900000-0000-4000-8000-000000000002');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','f6100000-0000-4000-8000-000000000004',true);
select public.onboarding_save_font('normal');
select public.onboarding_save_name('허구팬4');
select public.onboarding_complete_profile(true,true,'f6900000-0000-4000-8000-000000000001',true,'f6900000-0000-4000-8000-000000000002');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','f6100000-0000-4000-8000-000000000005',true);
select public.onboarding_save_font('normal');
select public.onboarding_save_name('허구팬5');
select public.onboarding_complete_profile(true,true,'f6900000-0000-4000-8000-000000000001',true,'f6900000-0000-4000-8000-000000000002');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','f6100000-0000-4000-8000-000000000006',true);
select public.onboarding_save_font('normal');
select public.onboarding_save_name('허구팬6');
select public.onboarding_complete_profile(true,true,'f6900000-0000-4000-8000-000000000001',true,'f6900000-0000-4000-8000-000000000002');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','f6100000-0000-4000-8000-000000000007',true);
select public.onboarding_save_font('normal');
select public.onboarding_save_name('허구팬7');
select public.onboarding_complete_profile(true,true,'f6900000-0000-4000-8000-000000000001',true,'f6900000-0000-4000-8000-000000000002');
reset role;
update public.profiles set onboarding_completed_at=clock_timestamp() where id in
 ('f6100000-0000-4000-8000-000000000001','f6100000-0000-4000-8000-000000000002','f6100000-0000-4000-8000-000000000003',
  'f6100000-0000-4000-8000-000000000004','f6100000-0000-4000-8000-000000000005','f6100000-0000-4000-8000-000000000006');
insert into public.subscriptions(id,user_id,artist_id,provider,status,first_started_at,episode_started_at,current_period_start,current_period_end,canceled_at,grace_started_at,grace_ends_at)
select ('f6300000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 ('f6100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'f6200000-0000-4000-8000-000000000001','toss',
 (case n when 3 then 'canceled' when 4 then 'grace' when 5 then 'expired' else 'active' end)::public.subscription_status,
 now()-interval '100 days',now()-interval '1 day',now()-interval '1 day',
 case when n in(4,5) then now()-interval '1 hour' else now()+interval '29 days' end,
 case when n=3 then now()-interval '1 hour' end,
 case when n=4 then now()-interval '1 hour' end,case when n=4 then now()+interval '1 day' end
from unnest(array[1,3,4,5,6,7]) n;
set local role service_role;
select throws_ok($$select * from public.fan_chat_page('f6100000-0000-4000-8000-000000000001','chat-main')$$,'55000','MESSAGE_POLICY_REQUIRED','missing message policy fails closed');
reset role;
insert into private.message_policy values(true,'fictional-chat-policy',604800,300,1000,100,10,180,60,5,10485760,20971520,104857600);
insert into public.messages(id,artist_id,author_id,type,body,status,scheduled_at,sent_at)
select ('f6400000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 'f6200000-0000-4000-8000-000000000001','f6100000-0000-4000-8000-000000000009','text','안녕 {이름} '||n,'sent',
 now()-interval '1 hour',now()-interval '1 hour' from generate_series(1,5) n;
insert into public.messages(id,artist_id,author_id,type,body,status,scheduled_at,sent_at,is_preview,preview_order,canceled_at) values
 ('f6400000-0000-4000-8000-000000000006','f6200000-0000-4000-8000-000000000001','f6100000-0000-4000-8000-000000000009','text','exact-history-boundary','sent',now()-interval '8 days',now()-interval '8 days',false,null,null),
 ('f6400000-0000-4000-8000-000000000007','f6200000-0000-4000-8000-000000000001','f6100000-0000-4000-8000-000000000009','text','too-old-preview','sent',now()-interval '8 days 1 microsecond',now()-interval '8 days 1 microsecond',true,1,null),
 ('f6400000-0000-4000-8000-000000000008','f6200000-0000-4000-8000-000000000001','f6100000-0000-4000-8000-000000000009','text','PRIVATE-DRAFT','draft',null,null,false,null,null),
 ('f6400000-0000-4000-8000-000000000009','f6200000-0000-4000-8000-000000000001','f6100000-0000-4000-8000-000000000009','text','PRIVATE-SCHEDULED','scheduled',now()+interval '1 day',null,false,null,null),
 ('f6400000-0000-4000-8000-000000000010','f6200000-0000-4000-8000-000000000001','f6100000-0000-4000-8000-000000000009','text','PRIVATE-FUTURE','sent',now()+interval '1 day',now()+interval '1 day',false,null,null),
 ('f6400000-0000-4000-8000-000000000011','f6200000-0000-4000-8000-000000000001','f6100000-0000-4000-8000-000000000009','text','PRIVATE-CANCELED','canceled',now()-interval '1 hour',now()-interval '1 hour',false,null,now()),
 ('f6400000-0000-4000-8000-000000000012','f6200000-0000-4000-8000-000000000002','f6100000-0000-4000-8000-000000000009','text','PRIVATE-OTHER','sent',now()-interval '1 hour',now()-interval '1 hour',false,null,null);
-- Safe media DTO metadata only; signing and byte access remain the accepted
-- media service's responsibility and are not changed by this migration.
update public.messages set type='photo' where id='f6400000-0000-4000-8000-000000000003';
insert into storage.objects(id,bucket_id,name,metadata) values
 ('f6500000-0000-4000-8000-000000000001','message-media','chat-fixture/photo.webp','{"mimetype":"image/webp","size":128}');
insert into public.message_media(id,message_id,storage_object_id,bucket_id,object_path,kind,mime_type,byte_size,width,height) values
 ('f6600000-0000-4000-8000-000000000001','f6400000-0000-4000-8000-000000000003','f6500000-0000-4000-8000-000000000001',
 'message-media','chat-fixture/photo.webp','photo','image/webp',128,640,480);
create temporary table chat_context(key text primary key,data jsonb);
grant all on chat_context to authenticated,service_role;
set local role service_role;
select is((select count(*) from public.fan_chat_page('f6100000-0000-4000-8000-000000000001','chat-main')),1::bigint,'authorized page has one context');
select is((select artist_slug from public.fan_chat_page('f6100000-0000-4000-8000-000000000001','chat-main')),'chat-main','context identifies the requested artist');
select is((select call_name from public.fan_chat_page('f6100000-0000-4000-8000-000000000001','chat-main')),'허구팬1','server renderer gets current validated calling name');
select is((select jsonb_array_length(messages) from public.fan_chat_page('f6100000-0000-4000-8000-000000000001','chat-main')),6,'visible list excludes too old, canceled, future, draft, scheduled and other artist');
select ok((select has_access and not has_more and read_count=0 from public.fan_chat_page('f6100000-0000-4000-8000-000000000001','chat-main')),'first full page is unread without creating evidence');
select is((select messages->0->>'body_template' from public.fan_chat_page('f6100000-0000-4000-8000-000000000001','chat-main')),'안녕 {이름} 5','template remains literal until canonical application personalization');
select is((select messages->2->'media'->0 from public.fan_chat_page('f6100000-0000-4000-8000-000000000001','chat-main')),
 '{"id":"f6600000-0000-4000-8000-000000000001","kind":"photo","width":640,"height":480,"duration_ms":null}'::jsonb,
 'chat media references are safe metadata with no signing authority');
select is((select messages->0->'media' from public.fan_chat_page('f6100000-0000-4000-8000-000000000001','chat-main')),'[]'::jsonb,'text with no attachment has explicit empty media');
select is((select messages->5->>'body_template' from public.fan_chat_page('f6100000-0000-4000-8000-000000000001','chat-main')),'exact-history-boundary','inclusive history cutoff keeps exact boundary');
select ok((select not (to_jsonb(p)::text ~ 'PRIVATE|agency|author_id|user_id|object_path|bucket|storage_object|mime_type|byte_size') from public.fan_chat_page('f6100000-0000-4000-8000-000000000001','chat-main') p),'projection omits private fields and inaccessible content');
insert into chat_context select 'first',to_jsonb(p) from public.fan_chat_page('f6100000-0000-4000-8000-000000000001','chat-main',2) p;
select ok((select (data->>'has_more')::boolean and jsonb_array_length(data->'messages')=2 from chat_context where key='first'),'bounded page has lookahead without extra returned content');
insert into chat_context select 'second',to_jsonb(p) from public.fan_chat_page('f6100000-0000-4000-8000-000000000001','chat-main',2,
 (select (data->'messages'->1->>'sent_at')::timestamptz from chat_context where key='first'),
 (select (data->'messages'->1->>'id')::uuid from chat_context where key='first')) p;
select is((select data->'messages'->0->>'id' from chat_context where key='second'),'f6400000-0000-4000-8000-000000000003','UUID tie-break advances same-timestamp messages without repeats');
select is((select data->'messages'->1->>'id' from chat_context where key='second'),'f6400000-0000-4000-8000-000000000002','second tied row retained');
insert into chat_context select 'last',to_jsonb(p) from public.fan_chat_page('f6100000-0000-4000-8000-000000000001','chat-main',2,
 (select (data->'messages'->1->>'sent_at')::timestamptz from chat_context where key='second'),
 (select (data->'messages'->1->>'id')::uuid from chat_context where key='second')) p;
select ok((select not (data->>'has_more')::boolean and jsonb_array_length(data->'messages')=2 from chat_context where key='last'),'exactly full final page has no invented next cursor');
select is((select messages from public.fan_chat_page('f6100000-0000-4000-8000-000000000001','chat-main',2,
 (select (data->'messages'->1->>'sent_at')::timestamptz from chat_context where key='last'),
 (select (data->'messages'->1->>'id')::uuid from chat_context where key='last'))),'[]'::jsonb,'exhausted page is explicit empty');
select ok((select not has_access and messages='[]'::jsonb and read_count=0 and not has_more from public.fan_chat_page('f6100000-0000-4000-8000-000000000002','chat-main')),'no subscription exposes no paid history or count');
select ok((select not has_access and messages='[]'::jsonb and read_count=0 and not has_more from public.fan_chat_page('f6100000-0000-4000-8000-000000000005','chat-main')),'expired subscription exposes no paid history or count');
select ok((select has_access and jsonb_array_length(messages)=6 from public.fan_chat_page('f6100000-0000-4000-8000-000000000003','chat-main')),'canceled still-paid retains paid history');
select ok((select has_access and jsonb_array_length(messages)=6 from public.fan_chat_page('f6100000-0000-4000-8000-000000000004','chat-main')),'unexpired grace retains paid history');
select throws_ok($$select * from public.fan_chat_page(null,'chat-main')$$,'42501','DISCOVERY_FORBIDDEN','missing actor cannot read chat');
select throws_ok($$select * from public.fan_chat_page('f6100000-0000-4000-8000-000000000007','chat-main')$$,'55000','CHAT_PROFILE_REQUIRED','unfinished full onboarding cannot read chat');
select throws_ok($$select * from public.fan_chat_page('f6100000-0000-4000-8000-000000000008','chat-main')$$,'55000','DISCOVERY_PROFILE_REQUIRED','missing profile cannot read chat');
select throws_ok($$select * from public.fan_chat_page('f6100000-0000-4000-8000-000000000009','chat-main')$$,'42501','DISCOVERY_FORBIDDEN','artist role cannot read chat');
select throws_ok($$select * from public.fan_chat_page('f6100000-0000-4000-8000-000000000001',null)$$,'22023','CHAT_INVALID_INPUT','invalid slug fails validation');
select throws_ok($$select * from public.fan_chat_page('f6100000-0000-4000-8000-000000000001','')$$,'22023','CHAT_INVALID_INPUT','invalid slug fails validation');
select throws_ok($$select * from public.fan_chat_page('f6100000-0000-4000-8000-000000000001','../chat-main')$$,'22023','CHAT_INVALID_INPUT','invalid slug fails validation');
select throws_ok($$select * from public.fan_chat_page('f6100000-0000-4000-8000-000000000001',repeat('a',129))$$,'22023','CHAT_INVALID_INPUT','invalid slug fails validation');
select throws_ok($$select * from public.fan_chat_page('f6100000-0000-4000-8000-000000000001','chat-missing')$$,'P0002','CHAT_NOT_FOUND','inactive and missing artist share not-found behavior');
select throws_ok($$select * from public.fan_chat_page('f6100000-0000-4000-8000-000000000001','chat-hidden')$$,'P0002','CHAT_NOT_FOUND','inactive and missing artist share not-found behavior');
select throws_ok($$select * from public.fan_chat_page('f6100000-0000-4000-8000-000000000001','chat-main',null)$$,'22023','CHAT_INVALID_INPUT','invalid limit/cursor is rejected');
select throws_ok($$select * from public.fan_chat_page('f6100000-0000-4000-8000-000000000001','chat-main',0)$$,'22023','CHAT_INVALID_INPUT','invalid limit/cursor is rejected');
select throws_ok($$select * from public.fan_chat_page('f6100000-0000-4000-8000-000000000001','chat-main',101)$$,'22023','CHAT_INVALID_INPUT','invalid limit/cursor is rejected');
select throws_ok($$select * from public.fan_chat_page('f6100000-0000-4000-8000-000000000001','chat-main',-1)$$,'22023','CHAT_INVALID_INPUT','invalid limit/cursor is rejected');
select throws_ok($$select * from public.fan_chat_page('f6100000-0000-4000-8000-000000000001','chat-main',2,now(),null)$$,'22023','CHAT_INVALID_INPUT','invalid limit/cursor is rejected');
select throws_ok($$select * from public.fan_chat_page('f6100000-0000-4000-8000-000000000001','chat-main',2,null,'f6400000-0000-4000-8000-000000000001')$$,'22023','CHAT_INVALID_INPUT','invalid limit/cursor is rejected');
select throws_ok($$select * from public.fan_chat_page('f6100000-0000-4000-8000-000000000001','chat-main',2,'infinity','f6400000-0000-4000-8000-000000000001')$$,'22023','CHAT_INVALID_INPUT','invalid limit/cursor is rejected');
reset role;
select is((select count(*) from public.message_reads),0::bigint,'GET projection never invents read evidence');
set local role authenticated;
select set_config('request.jwt.claim.sub','f6100000-0000-4000-8000-000000000001',true);
select is((select count(*) from public.messages),0::bigint,'fan direct raw message select remains empty');
select throws_ok($$select * from public.fan_chat_page('f6100000-0000-4000-8000-000000000001','chat-main')$$,'42501',null,'fan cannot call service-only template RPC');
insert into chat_context select 'read',to_jsonb(r) from public.fan_chat_mark_read('chat-main','f6400000-0000-4000-8000-000000000005') r;
select is((select (data->>'read_count')::bigint from chat_context where key='read'),1::bigint,'first paid visible read counts once');
select is((select read_at from public.fan_chat_mark_read('chat-main','f6400000-0000-4000-8000-000000000005')),
 (select (data->>'read_at')::timestamptz from chat_context where key='read'),'repeated mark preserves first authoritative timestamp');
select is((select read_count from public.fan_chat_mark_read('chat-main','f6400000-0000-4000-8000-000000000005')),1::bigint,'repeated mark never inflates count');
select is((select read_count from public.fan_chat_mark_read('chat-main','f6400000-0000-4000-8000-000000000004')),2::bigint,'different message increments personal visible count');
select is((select count(*) from public.message_reads),2::bigint,'owner sees only their own immutable evidence');
select throws_ok($$select * from public.fan_chat_mark_read('chat-other','f6400000-0000-4000-8000-000000000005')$$,'42501','MESSAGE_NOT_VISIBLE','message is bound to URL artist');
select throws_ok($$select * from public.fan_chat_mark_read('chat-main','f6400000-0000-4000-8000-000000000007')$$,'42501','MESSAGE_NOT_VISIBLE','inaccessible message 7 creates no evidence');
select throws_ok($$select * from public.fan_chat_mark_read('chat-main','f6400000-0000-4000-8000-000000000008')$$,'42501','MESSAGE_NOT_VISIBLE','inaccessible message 8 creates no evidence');
select throws_ok($$select * from public.fan_chat_mark_read('chat-main','f6400000-0000-4000-8000-000000000009')$$,'42501','MESSAGE_NOT_VISIBLE','inaccessible message 9 creates no evidence');
select throws_ok($$select * from public.fan_chat_mark_read('chat-main','f6400000-0000-4000-8000-000000000010')$$,'42501','MESSAGE_NOT_VISIBLE','inaccessible message 10 creates no evidence');
select throws_ok($$select * from public.fan_chat_mark_read('chat-main','f6400000-0000-4000-8000-000000000011')$$,'42501','MESSAGE_NOT_VISIBLE','inaccessible message 11 creates no evidence');
select throws_ok($$select * from public.fan_chat_mark_read('chat-main','f6400000-0000-4000-8000-000000000012')$$,'42501','MESSAGE_NOT_VISIBLE','inaccessible message 12 creates no evidence');
select throws_ok($$select * from public.fan_chat_mark_read(null,'f6400000-0000-4000-8000-000000000005')$$,'22023','CHAT_INVALID_INPUT','invalid read handle rejected');
select throws_ok($$select * from public.fan_chat_mark_read('../chat-main','f6400000-0000-4000-8000-000000000005')$$,'22023','CHAT_INVALID_INPUT','invalid read handle rejected');
select throws_ok($$select * from public.fan_chat_mark_read('chat-main',null)$$,'22023','CHAT_INVALID_INPUT','invalid read handle rejected');
select set_config('request.jwt.claim.sub','f6100000-0000-4000-8000-000000000002',true);
select throws_ok($$select * from public.fan_chat_mark_read('chat-main','f6400000-0000-4000-8000-000000000005')$$,'42501','MESSAGE_NOT_VISIBLE','unsubscribed fan cannot borrow other fan evidence');
select is((select count(*) from public.message_reads),0::bigint,'other fan cannot enumerate paid receipts');
select set_config('request.jwt.claim.sub','',true);
select throws_ok($$select * from public.fan_chat_mark_read('chat-main','f6400000-0000-4000-8000-000000000005')$$,'42501','DISCOVERY_FORBIDDEN','missing session cannot create read');
reset role;
set local role service_role;
select is((select read_count from public.fan_chat_page('f6100000-0000-4000-8000-000000000001','chat-main')),2::bigint,'page count agrees with receipt writes');
select is((select messages->0->>'read_at' from public.fan_chat_page('f6100000-0000-4000-8000-000000000001','chat-main')),
 (select data->>'read_at' from chat_context where key='read'),'message DTO carries the exact personal read timestamp');
select ok((select messages->2->'read_at'='null'::jsonb from public.fan_chat_page('f6100000-0000-4000-8000-000000000001','chat-main')),'unread message is explicitly null');
select is((select read_count from public.fan_chat_page('f6100000-0000-4000-8000-000000000006','chat-main')),0::bigint,'another subscriber has independent count');
reset role;
update public.messages set status='canceled',canceled_at=clock_timestamp() where id='f6400000-0000-4000-8000-000000000005';
set local role service_role;
select is((select read_count from public.fan_chat_page('f6100000-0000-4000-8000-000000000001','chat-main')),1::bigint,'canceled content is excluded from visible read count');
reset role;
select is((select count(*) from public.message_reads),2::bigint,'cancellation preserves historical refund evidence');
set local role authenticated;
select set_config('request.jwt.claim.sub','f6100000-0000-4000-8000-000000000001',true);
select throws_ok($$select * from public.fan_chat_mark_read('chat-main','f6400000-0000-4000-8000-000000000005')$$,'42501','MESSAGE_NOT_VISIBLE','retry revalidates cancellation despite historical read');
reset role;
update public.profiles set is_restricted=true where id='f6100000-0000-4000-8000-000000000001';
set local role service_role;
select throws_ok($$select * from public.fan_chat_page('f6100000-0000-4000-8000-000000000001','chat-main')$$,'42501','DISCOVERY_FORBIDDEN','restriction denies current page');
reset role;
set local role authenticated;
select throws_ok($$select * from public.fan_chat_mark_read('chat-main','f6400000-0000-4000-8000-000000000004')$$,'42501','DISCOVERY_FORBIDDEN','restriction denies repeat read');
reset role;
update public.profiles set restricted_until=now()-interval '1 second' where id='f6100000-0000-4000-8000-000000000001';
set local role service_role;
select ok((select has_access from public.fan_chat_page('f6100000-0000-4000-8000-000000000001','chat-main')),'expired restriction restores current access');
reset role;
update private.profile_onboarding_policy set terms_version='f6900000-0000-4000-8000-000000000003';
set local role service_role;
select throws_ok($$select * from public.fan_chat_page('f6100000-0000-4000-8000-000000000001','chat-main')$$,'55000','DISCOVERY_PROFILE_REQUIRED','stale current legal consent invalidates chat');
reset role;
set local role authenticated;
select throws_ok($$select * from public.fan_chat_mark_read('chat-main','f6400000-0000-4000-8000-000000000004')$$,'55000','DISCOVERY_PROFILE_REQUIRED','stale current consent invalidates read evidence');
reset role;
update private.profile_onboarding_policy set terms_version='f6900000-0000-4000-8000-000000000001';
update public.subscriptions set current_period_end=clock_timestamp()-interval '1 second' where user_id='f6100000-0000-4000-8000-000000000001';
set local role service_role;
select ok((select not has_access and messages='[]'::jsonb and read_count=0 from public.fan_chat_page('f6100000-0000-4000-8000-000000000001','chat-main')),'past paid boundary returns gated context and zero visible count');
reset role;
set local role authenticated;
select throws_ok($$select * from public.fan_chat_mark_read('chat-main','f6400000-0000-4000-8000-000000000004')$$,'42501','MESSAGE_NOT_VISIBLE','read replay after expiry fails closed');
reset role;
update public.subscriptions set grace_ends_at=clock_timestamp()-interval '1 second' where user_id='f6100000-0000-4000-8000-000000000004';
set local role service_role;
select ok((select not has_access from public.fan_chat_page('f6100000-0000-4000-8000-000000000004','chat-main')),'expired grace grants no access');
reset role;
-- A new episode never revives the old historical episode merely because the
-- same subscription row is reused. Personal receipts remain historical only.
update public.subscriptions set current_period_start=now()-interval '1 minute',current_period_end=now()+interval '1 day',episode_started_at=now()
 where user_id='f6100000-0000-4000-8000-000000000001';
update private.message_policy set history_before_seconds=0;
set local role service_role;
select ok((select has_access and messages='[]'::jsonb and read_count=0 and not has_more from public.fan_chat_page('f6100000-0000-4000-8000-000000000001','chat-main')),'new episode zero history is authorized empty, not old-content revival');
reset role;
-- Distinct microseconds in the same millisecond must remain separate cursor
-- positions, and the UUID is used only after the complete instant ties.
update private.message_policy set history_before_seconds=604800;
update public.messages set sent_at=date_trunc('milliseconds',now())-interval '1 second'+interval '2 microseconds'
 where id='f6400000-0000-4000-8000-000000000001';
update public.messages set sent_at=date_trunc('milliseconds',now())-interval '1 second'+interval '1 microsecond'
 where id='f6400000-0000-4000-8000-000000000002';
set local role service_role;
insert into chat_context select 'microsecond',to_jsonb(p) from public.fan_chat_page('f6100000-0000-4000-8000-000000000001','chat-main',1) p;
select is((select data->'messages'->0->>'id' from chat_context where key='microsecond'),'f6400000-0000-4000-8000-000000000001','full instant sorts before larger UUID');
select is((select messages->0->>'id' from public.fan_chat_page('f6100000-0000-4000-8000-000000000001','chat-main',1,
 (select (data->'messages'->0->>'sent_at')::timestamptz from chat_context where key='microsecond'),
 (select (data->'messages'->0->>'id')::uuid from chat_context where key='microsecond'))),'f6400000-0000-4000-8000-000000000002',
 'cursor retains the next message one microsecond earlier');
reset role;
select is((select count(*) from public.message_reads),2::bigint,'all read tests preserve one row per actually read message');
select is((select count(*) from public.replies),0::bigint,'viewing never creates a reply');
select is((select count(*) from public.payment_events),0::bigint,'viewing never creates a payment');
select is((select count(*) from private.analytics_events),0::bigint,'viewing does not invent telemetry consent or events');
select * from finish();
rollback;
