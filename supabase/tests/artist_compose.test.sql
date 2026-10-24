begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
set local timezone='UTC';
select no_plan();
select is((select count(*) from private.artist_compose_drafts),0::bigint,'migration does not create artist content');
select is((select count(*) from private.artist_compose_operations),0::bigint,'migration does not create operations');
select ok((select bool_and(relrowsecurity) from pg_class where oid in('private.artist_compose_drafts'::regclass,'private.artist_compose_operations'::regclass)),
 'private ownership and operation registries have RLS');
select ok((select bool_and(not has_table_privilege(role,relation,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'))
 from unnest(array['anon','authenticated','service_role']) role cross join unnest(array['private.artist_compose_drafts','private.artist_compose_operations']) relation),
 'API roles cannot forge or enumerate private authoring state');
select ok((select bool_and(prosecdef and 'search_path=""'=any(proconfig)) from pg_proc where oid in(
 'public.artist_compose_artists(text)'::regprocedure,'public.artist_compose_context(text,uuid,timestamptz,uuid)'::regprocedure,
 'public.artist_compose_save(text,uuid,uuid,bigint,public.message_type,text,uuid[])'::regprocedure,
 'public.artist_compose_remove_media(text,uuid,uuid,bigint,uuid)'::regprocedure)), 'all authoring RPCs pin definer search paths');
select ok((select bool_and(has_function_privilege('authenticated',fn,'EXECUTE')
 and not has_function_privilege('anon',fn,'EXECUTE') and not has_function_privilege('service_role',fn,'EXECUTE'))
 from unnest(array['public.artist_compose_artists(text)','public.artist_compose_context(text,uuid,timestamptz,uuid)',
 'public.artist_compose_save(text,uuid,uuid,bigint,public.message_type,text,uuid[])',
 'public.artist_compose_remove_media(text,uuid,uuid,bigint,uuid)']) fn), 'only authenticated subject-bound callers may invoke authoring RPCs');
select ok((select bool_and(not(proargnames && array['p_actor_id','p_owner_id','p_user_id','p_role','p_status','p_scheduled_at']))
 from pg_proc where oid in('public.artist_compose_save(text,uuid,uuid,bigint,public.message_type,text,uuid[])'::regprocedure,
 'public.artist_compose_remove_media(text,uuid,uuid,bigint,uuid)'::regprocedure)), 'callers cannot choose actors, roles or sending state');
select ok((select bool_and(not has_function_privilege('authenticated',fn,'EXECUTE')) from unnest(array[
 'private.artist_compose_actor()','private.artist_compose_artist(uuid,text)','private.artist_compose_policy()',
 'private.artist_compose_projection(uuid)','private.artist_compose_lock_draft(uuid,uuid,uuid)','private.artist_compose_media_changed()']) fn),
 'internal projections and mutators are not API capabilities');

insert into auth.users(id,email,raw_user_meta_data)
select ('f8100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'compose-fixture-'||n||'@example.invalid','{}'::jsonb from generate_series(1,5) n;
update public.profiles set role='artist' where id in('f8100000-0000-4000-8000-000000000001','f8100000-0000-4000-8000-000000000002','f8100000-0000-4000-8000-000000000003');
update public.profiles set role='admin' where id='f8100000-0000-4000-8000-000000000005';
insert into public.artists(id,slug,name,grade,status,agency_name) values
 ('f8200000-0000-4000-8000-000000000001','compose-first','허구 작성 가수','B','active','PRIVATE AGENCY'),
 ('f8200000-0000-4000-8000-000000000002','compose-second','허구 다른 가수','B','active',null),
 ('f8200000-0000-4000-8000-000000000003','compose-paused','허구 중지 가수','B','paused',null);
insert into public.artist_members(artist_id,user_id) values
 ('f8200000-0000-4000-8000-000000000001','f8100000-0000-4000-8000-000000000001'),
 ('f8200000-0000-4000-8000-000000000002','f8100000-0000-4000-8000-000000000001'),
 ('f8200000-0000-4000-8000-000000000003','f8100000-0000-4000-8000-000000000001'),
 ('f8200000-0000-4000-8000-000000000001','f8100000-0000-4000-8000-000000000002'),
 ('f8200000-0000-4000-8000-000000000002','f8100000-0000-4000-8000-000000000003');
create temporary table compose_context(key text primary key,data jsonb);
grant all on compose_context to authenticated,service_role;
set local role authenticated;
select set_config('request.jwt.claim.sub','f8100000-0000-4000-8000-000000000001',true);
select is(jsonb_array_length(public.artist_compose_artists()->'artists'),2,'menu contains only active memberships');
select is(public.artist_compose_artists()->'artists'->0->>'slug','compose-first','catalog is stable slug order');
select is(jsonb_array_length(public.artist_compose_artists('compose-first')->'artists'),1,'catalog cursor advances');
select is((select string_agg(k,',' order by k) from jsonb_object_keys(public.artist_compose_artists()->'artists'->0) k),'id,name,slug','catalog omits agency and artist account data');
select throws_ok($$select public.artist_compose_context('compose-first')$$,'55000','COMPOSE_SETUP_NOT_READY','missing operating policy fails closed');
select throws_ok($$select public.artist_compose_artists('/invalid')$$,'22023','COMPOSE_INVALID_INPUT','catalog rejects invalid cursor');
select throws_ok($$select public.artist_compose_context('../invalid')$$,'22023','COMPOSE_INVALID_INPUT','slug syntax is validated');
select throws_ok($$select public.artist_compose_context('compose-paused')$$,'P0002','COMPOSE_NOT_FOUND','paused artist is not an authoring target');
reset role;
insert into private.message_policy values(true,'fictional-compose-policy',604800,300,1000,100,2,180,60,5,1000,2000,3000);
set local role authenticated;
select throws_ok($$select public.artist_compose_context('compose-first')$$,'55000','COMPOSE_SETUP_NOT_READY','missing approved sample name policy also fails closed');
reset role;
insert into private.profile_onboarding_policy values(true,'f8800000-0000-4000-8000-000000000001',now(),2,10,array['금지단어'],null,null,null);
set local role authenticated;
select is(public.artist_compose_context('compose-first')->'drafts','[]'::jsonb,'new artist has no fabricated drafts');
select is(public.artist_compose_context('compose-first')->'policy',
 '{"max_text_length":1000,"max_photo_count":2,"max_voice_seconds":180,"max_video_seconds":60,"photo_max_bytes":1000,"voice_max_bytes":2000,"video_max_bytes":3000,"call_name_min_length":2,"call_name_max_length":10}'::jsonb,
 'UI limits come from the actual private snapshots');
select throws_ok($$select public.artist_compose_context('compose-first',null,now(),null)$$,'22023','COMPOSE_INVALID_INPUT','cursor components must travel together');
select throws_ok($$select public.artist_compose_context('compose-first',null,'infinity','f8400000-0000-4000-8000-000000000001')$$,'22023','COMPOSE_INVALID_INPUT','infinite cursor is rejected');
insert into compose_context values('created',public.artist_compose_save('compose-first','f8400000-0000-4000-8000-000000000001',
 'f8700000-0000-4000-8000-000000000001',0,'text','  안녕 {이름}  ','{}'));
select is((select data->>'body' from compose_context where key='created'),'  안녕 {이름}  ','draft preserves exact template and whitespace');
select is((select (data->>'revision')::bigint from compose_context where key='created'),1::bigint,'create starts revision one');
select is((select data->'pending_upload_ids' from compose_context where key='created'),'[]'::jsonb,'text draft has no upload capabilities');
select is((select string_agg(k,',' order by k) from jsonb_object_keys((select data from compose_context where key='created')) k),
 'body,id,kind,media,pending_upload_ids,revision,updated_at','draft omits owner, storage paths and provider secrets');
select is(public.artist_compose_save('compose-first','f8400000-0000-4000-8000-000000000001','f8700000-0000-4000-8000-000000000001',0,'text','  안녕 {이름}  ','{}'),
 (select data from compose_context where key='created'),'same create retry returns the accepted snapshot');
select throws_ok($$select public.artist_compose_save('compose-first','f8400000-0000-4000-8000-000000000001','f8700000-0000-4000-8000-000000000001',0,'text','변경','{}')$$,
 '23505','COMPOSE_OPERATION_CONFLICT','idempotency key is bound to exact original content');
select throws_ok($$select public.artist_compose_save('compose-first','f8400000-0000-4000-8000-000000000001',gen_random_uuid(),0,'text','변경','{}')$$,
 '40001','COMPOSE_REVISION_CONFLICT','a second create cannot overwrite the first');
select is((public.artist_compose_save('compose-first','f8400000-0000-4000-8000-000000000001','f8700000-0000-4000-8000-000000000002',1,'text','새로운 {이름}','{}')->>'revision')::bigint,
 2::bigint,'accepted edit advances the revision');
select is(public.artist_compose_save('compose-first','f8400000-0000-4000-8000-000000000001','f8700000-0000-4000-8000-000000000001',0,'text','  안녕 {이름}  ','{}'),
 (select data from compose_context where key='created'),'late replay returns old accepted snapshot without mutation');
select is(public.artist_compose_context('compose-first','f8400000-0000-4000-8000-000000000001')->'selected_draft'->>'body','새로운 {이름}','refresh keeps the newer content after old retry');
select throws_ok($$select public.artist_compose_save('compose-first','f8400000-0000-4000-8000-000000000001',gen_random_uuid(),1,'text','stale','{}')$$,
 '40001','COMPOSE_REVISION_CONFLICT','stale tab cannot overwrite a newer edit');
select throws_ok($$select public.artist_compose_save('compose-second','f8400000-0000-4000-8000-000000000001',gen_random_uuid(),2,'text','wrong artist','{}')$$,
 'P0002','COMPOSE_NOT_FOUND','owned ID is still bound to its original artist');
select throws_ok($$select public.artist_compose_save('compose-first',gen_random_uuid(),gen_random_uuid(),1,'text','missing','{}')$$,
 'P0002','COMPOSE_NOT_FOUND','positive revision cannot create a missing draft');
select throws_ok($$select public.artist_compose_save('compose-first',gen_random_uuid(),gen_random_uuid(),0,'text',null,'{}')$$,
 '23514','COMPOSE_CONTENT_INVALID','text needs actual content');
select throws_ok($$select public.artist_compose_save('compose-first',gen_random_uuid(),gen_random_uuid(),0,'text',E' \t\n ','{}')$$,
 '23514','COMPOSE_CONTENT_INVALID','whitespace-only text is not accepted');
select throws_ok($$select public.artist_compose_save('compose-first',gen_random_uuid(),gen_random_uuid(),0,'text',U&'\00A0\FEFF\3000','{}')$$,
 '23514','COMPOSE_CONTENT_INVALID','ECMAScript Unicode whitespace is not accepted as content');
select lives_ok($$select public.artist_compose_save('compose-first',gen_random_uuid(),gen_random_uuid(),0,'voice')$$,
 'omitted nullable caption and exact empty media defaults support genuine generated optional arguments');
select throws_ok($$select public.artist_compose_save('compose-first',gen_random_uuid(),gen_random_uuid(),0,'text',repeat('가',1001),'{}')$$,
 '23514','COMPOSE_TOO_LONG','actual policy length is enforced');
select throws_ok($$select public.artist_compose_save('compose-first',gen_random_uuid(),gen_random_uuid(),0,'text',U&'bad\0001control','{}')$$,
 '23514','COMPOSE_CONTENT_INVALID','direct RPC control characters are rejected');
select lives_ok($$select public.artist_compose_save('compose-first',gen_random_uuid(),gen_random_uuid(),0,'text',E'line one\nline two\tend','{}')$$,
 'line breaks and tab remain intentional plain text');
select lives_ok($$select public.artist_compose_save('compose-first',gen_random_uuid(),gen_random_uuid(),0,'text',repeat('😀',1000),'{}')$$,
 'Unicode scalar count permits policy-length emoji text');
select throws_ok($$select public.artist_compose_save('compose-first',gen_random_uuid(),gen_random_uuid(),0,'text','x',null)$$,
 '22023','COMPOSE_INVALID_INPUT','media binding array is mandatory');
select throws_ok($$select public.artist_compose_save('compose-first',gen_random_uuid(),gen_random_uuid(),0,'text','x',array[null]::uuid[])$$,
 '22023','COMPOSE_INVALID_INPUT','media IDs cannot contain null');
select throws_ok($$select public.artist_compose_save('compose-first',gen_random_uuid(),gen_random_uuid(),0,'text','x',array['f8500000-0000-4000-8000-000000000001','f8500000-0000-4000-8000-000000000001']::uuid[])$$,
 '22023','COMPOSE_INVALID_INPUT','duplicate media IDs are not accepted');
select throws_ok($$select public.artist_compose_save('compose-first',gen_random_uuid(),gen_random_uuid(),0,'photo',null,array[gen_random_uuid()])$$,
 '23514','COMPOSE_MEDIA_CONFLICT','create cannot attach arbitrary foreign media');
select throws_ok($$select public.artist_compose_save('compose-first',null,gen_random_uuid(),0,'text','x','{}')$$,
 '22023','COMPOSE_INVALID_INPUT','message UUID is required for stable retry');
select throws_ok($$select public.artist_compose_save('compose-first',gen_random_uuid(),null,0,'text','x','{}')$$,
 '22023','COMPOSE_INVALID_INPUT','operation UUID is required');
select throws_ok($$select public.artist_compose_save('compose-first',gen_random_uuid(),gen_random_uuid(),-1,'text','x','{}')$$,
 '22023','COMPOSE_INVALID_INPUT','negative revision is rejected');
select set_config('request.jwt.claim.sub','f8100000-0000-4000-8000-000000000002',true);
select is(public.artist_compose_context('compose-first')->'drafts','[]'::jsonb,'teammate does not receive another author draft list');
select throws_ok($$select public.artist_compose_context('compose-first','f8400000-0000-4000-8000-000000000001')$$,
 'P0002','COMPOSE_NOT_FOUND','teammate cannot open another author draft');
select is((select count(*) from public.messages where id='f8400000-0000-4000-8000-000000000001'),0::bigint,'raw message RLS also protects new owned drafts');
select throws_ok($$select public.artist_compose_save('compose-first','f8400000-0000-4000-8000-000000000001',gen_random_uuid(),2,'text','stolen','{}')$$,
 'P0002','COMPOSE_NOT_FOUND','teammate cannot save another author draft');
select set_config('request.jwt.claim.sub','f8100000-0000-4000-8000-000000000003',true);
select throws_ok($$select public.artist_compose_context('compose-first')$$,'42501','COMPOSE_FORBIDDEN','unassigned artist cannot author this artist');
select set_config('request.jwt.claim.sub','f8100000-0000-4000-8000-000000000004',true);
select throws_ok($$select public.artist_compose_artists()$$,'42501','COMPOSE_FORBIDDEN','fan cannot enter artist menu');
select set_config('request.jwt.claim.sub','f8100000-0000-4000-8000-000000000005',true);
select throws_ok($$select public.artist_compose_artists()$$,'42501','COMPOSE_FORBIDDEN','admin is not silently treated as an artist account');
reset role;
set local role service_role;
select throws_ok($$select public.messaging_save_draft('f8100000-0000-4000-8000-000000000001','f8200000-0000-4000-8000-000000000001',
 'f8400000-0000-4000-8000-000000000001','text','legacy overwrite')$$,'42501','COMPOSE_MANAGED_DRAFT','legacy API cannot bypass optimistic authoring revisions');
insert into compose_context values('legacy',jsonb_build_object('id',public.messaging_save_draft('f8100000-0000-4000-8000-000000000001',
 'f8200000-0000-4000-8000-000000000001',null,'text','legacy test')));
select lives_ok($$select public.messaging_save_draft('f8100000-0000-4000-8000-000000000002','f8200000-0000-4000-8000-000000000001',
 (select (data->>'id')::uuid from compose_context where key='legacy'),'text','legacy collaboration')$$,'existing legacy collaboration remains compatible');
reset role;

-- Normal existing media API contract using rollback-only Storage metadata. No
-- payload parsing or security probe is performed by this authoring test suite.
set local role authenticated;
select set_config('request.jwt.claim.sub','f8100000-0000-4000-8000-000000000001',true);
select public.artist_compose_save('compose-first','f8400000-0000-4000-8000-000000000002','f8700000-0000-4000-8000-000000000003',0,'photo',null,'{}');
reset role;
set local role service_role;
select throws_ok($$select public.media_begin_upload('f8100000-0000-4000-8000-000000000002','f8400000-0000-4000-8000-000000000002','image/png',100,gen_random_uuid())$$,
 '42501','MEDIA_FORBIDDEN','teammate cannot upload into new owned draft');
insert into compose_context values('upload',public.media_begin_upload('f8100000-0000-4000-8000-000000000001','f8400000-0000-4000-8000-000000000002',
 'image/png',100,'f8600000-0000-4000-8000-000000000001'));
reset role;
set local role authenticated;
select is(public.artist_compose_context('compose-first','f8400000-0000-4000-8000-000000000002')->'selected_draft'->'pending_upload_ids',
 (select jsonb_build_array(data->'upload_id') from compose_context where key='upload'),'refresh discovers only own unfinished upload IDs');
select throws_ok($$select public.artist_compose_save('compose-first','f8400000-0000-4000-8000-000000000002',gen_random_uuid(),1,'text','changed kind','{}')$$,
 '23514','COMPOSE_MEDIA_CONFLICT','pending upload prevents type race');
reset role;
insert into storage.objects(id,bucket_id,name,metadata)
select 'f8500000-0000-4000-8000-000000000001','message-media',data->>'object_path','{"mimetype":"image/png","size":100}'::jsonb from compose_context where key='upload';
set local role service_role;
select public.media_finalize_upload('f8100000-0000-4000-8000-000000000001',(select (data->>'upload_id')::uuid from compose_context where key='upload'),
 'f8500000-0000-4000-8000-000000000001',10,10,null);
select throws_ok($$select public.media_resolve_read('f8100000-0000-4000-8000-000000000002',(select (data->>'media_id')::uuid from compose_context where key='upload'),false)$$,
 '42501','MEDIA_FORBIDDEN','teammate cannot sign another author draft media');
reset role;
set local role authenticated;
select is((public.artist_compose_context('compose-first','f8400000-0000-4000-8000-000000000002')->'selected_draft'->>'revision')::bigint,2::bigint,
 'verified media association advances optimistic revision');
select is(public.artist_compose_context('compose-first','f8400000-0000-4000-8000-000000000002')->'selected_draft'->'pending_upload_ids','[]'::jsonb,
 'completed uploads disappear from pending recovery');
select is((select string_agg(k,',' order by k) from jsonb_object_keys(public.artist_compose_context('compose-first','f8400000-0000-4000-8000-000000000002')->'selected_draft'->'media'->0) k),
 'duration_ms,height,id,kind,width','media projection never exposes Storage metadata or filenames');
select throws_ok($$select public.artist_compose_save('compose-first','f8400000-0000-4000-8000-000000000002',gen_random_uuid(),1,'photo','stale','{}')$$,
 '40001','COMPOSE_REVISION_CONFLICT','save cannot ignore newly finalized media');
select throws_ok($$select public.artist_compose_save('compose-first','f8400000-0000-4000-8000-000000000002',gen_random_uuid(),2,'photo','stale list','{}')$$,
 '23514','COMPOSE_MEDIA_CONFLICT','even current revision must bind exact media IDs');
insert into compose_context values('removed',public.artist_compose_remove_media('compose-first','f8400000-0000-4000-8000-000000000002',
 (select (data->>'media_id')::uuid from compose_context where key='upload'),2,'f8700000-0000-4000-8000-000000000004'));
select is((select (data->>'revision')::bigint from compose_context where key='removed'),3::bigint,'logical removal advances revision');
select is((select data->'media' from compose_context where key='removed'),'[]'::jsonb,'removed media no longer belongs to current draft');
select is(public.artist_compose_remove_media('compose-first','f8400000-0000-4000-8000-000000000002',
 (select (data->>'media_id')::uuid from compose_context where key='upload'),2,'f8700000-0000-4000-8000-000000000004'),
 (select data from compose_context where key='removed'),'lost remove response is safely replayable');
select throws_ok($$select public.artist_compose_remove_media('compose-first','f8400000-0000-4000-8000-000000000002',gen_random_uuid(),3,gen_random_uuid())$$,
 '23514','COMPOSE_MEDIA_CONFLICT','remove cannot select foreign or nonexistent media');
select lives_ok($$select public.artist_compose_save('compose-first','f8400000-0000-4000-8000-000000000002',gen_random_uuid(),3,'text','new type after explicit removal','{}')$$,
 'type can change after explicit removal and no pending intent');
reset role;
select is((select count(*) from storage.objects where id='f8500000-0000-4000-8000-000000000001'),1::bigint,'removing attachment never deletes registered final bytes');
set local role service_role;
select throws_ok($$select public.media_resolve_upload('f8100000-0000-4000-8000-000000000001',(select (data->>'upload_id')::uuid from compose_context where key='upload'))$$,
 '42501','MEDIA_UPLOAD_REVOKED','removed completed intent cannot be resurrected');
reset role;

-- Current authority and current policy apply even to accepted-operation replay.
update public.profiles set is_restricted=true where id='f8100000-0000-4000-8000-000000000001';
set local role authenticated;
select throws_ok($$select public.artist_compose_save('compose-first','f8400000-0000-4000-8000-000000000001','f8700000-0000-4000-8000-000000000001',0,'text','  안녕 {이름}  ','{}')$$,
 '42501','COMPOSE_FORBIDDEN','restriction prevents replay content disclosure');
reset role;
update public.profiles set is_restricted=false where id='f8100000-0000-4000-8000-000000000001';
delete from public.artist_members where artist_id='f8200000-0000-4000-8000-000000000001' and user_id='f8100000-0000-4000-8000-000000000001';
set local role authenticated;
select throws_ok($$select public.artist_compose_context('compose-first')$$,'42501','COMPOSE_FORBIDDEN','membership loss invalidates current page');
reset role;
insert into public.artist_members(artist_id,user_id) values('f8200000-0000-4000-8000-000000000001','f8100000-0000-4000-8000-000000000001');
update private.profile_onboarding_policy set name_approved_at=null;
set local role authenticated;
select throws_ok($$select public.artist_compose_context('compose-first')$$,'55000','COMPOSE_SETUP_NOT_READY','policy withdrawal blocks context');
reset role;
update private.profile_onboarding_policy set name_approved_at=now();

-- Keyset paging is bounded, selected drafts are not limited to the newest page.
insert into public.messages(id,artist_id,author_id,type,body)
select ('f8410000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'f8200000-0000-4000-8000-000000000002',
 'f8100000-0000-4000-8000-000000000001','text','허구 페이지 '||n from generate_series(1,35) n;
insert into private.artist_compose_drafts(message_id,owner_id,artist_id,updated_at)
select id,author_id,artist_id,now()-interval '1 day'+make_interval(secs=>(right(id::text,12)::integer))
 from public.messages where id::text like 'f8410000-%';
set local role authenticated;
insert into compose_context values('page',public.artist_compose_context('compose-second','f8410000-0000-4000-8000-000000000001'));
select is(jsonb_array_length((select data->'drafts' from compose_context where key='page')),30,'draft page returns at most thirty rows');
select is((select (data->>'has_more')::boolean from compose_context where key='page'),true,'extra candidate signals another page');
select is((select data->'selected_draft'->>'id' from compose_context where key='page'),'f8410000-0000-4000-8000-000000000001','exact selected draft remains accessible outside recent page');
select is(jsonb_array_length(public.artist_compose_context('compose-second',null,
 (select (data->'drafts'->29->>'updated_at')::timestamptz from compose_context where key='page'),
 (select (data->'drafts'->29->>'id')::uuid from compose_context where key='page'))->'drafts'),5,'full timestamp and ID keyset retrieves remaining drafts');
reset role;
select is((select count(*) from public.messages where status<>'draft'),0::bigint,'authoring never schedules or dispatches a message');
select is((select count(*) from private.notification_jobs),0::bigint,'draft authoring does not enqueue outbound notifications');
select * from finish();
rollback;
