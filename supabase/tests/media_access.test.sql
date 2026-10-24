begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();

-- Rollback-only fictional identities and Storage metadata test SQL invariants.
-- Real bytes/signing are separately exercised by the local Storage/browser CI.
select is((select count(*) from private.media_uploads),0::bigint,'migration creates no upload or production content');
select ok((select relrowsecurity from pg_class where oid='private.media_uploads'::regclass),'intent registry enables RLS');
select ok((select bool_and(not has_table_privilege(r,'private.media_uploads','SELECT,INSERT,UPDATE,DELETE,TRUNCATE'))
  from unnest(array['anon','authenticated','service_role']) r),'no API role can forge or enumerate upload intents');
select ok((select bool_and(not has_function_privilege(r,p,'EXECUTE')) from unnest(array['anon','authenticated']) r
  cross join unnest(array['public.media_begin_upload(uuid,uuid,text,bigint,uuid)','public.media_resolve_upload(uuid,uuid)',
  'public.media_finalize_upload(uuid,uuid,uuid,integer,integer,integer)','public.media_revoke_upload(uuid,uuid)',
  'public.media_resolve_read(uuid,uuid,boolean)']) p),'only trusted service may supply actor IDs for media RPCs');
select ok((select bool_and(not has_function_privilege(r,p,'EXECUTE')) from unnest(array['anon','authenticated','service_role']) r
  cross join unnest(array['private.media_upload_projection(uuid)','private.media_lock_author(uuid,uuid)']) p),'private helpers cannot leak paths or authorization state');
select ok((select bool_and(prosecdef and 'search_path=""'=any(proconfig)) from pg_proc where oid in (
  'public.media_begin_upload(uuid,uuid,text,bigint,uuid)'::regprocedure,'public.media_resolve_upload(uuid,uuid)'::regprocedure,
  'public.media_finalize_upload(uuid,uuid,uuid,integer,integer,integer)'::regprocedure,'public.media_revoke_upload(uuid,uuid)'::regprocedure,
  'public.media_resolve_read(uuid,uuid,boolean)'::regprocedure)),'all media privilege boundaries pin empty search_path');
select is((select public from storage.buckets where id='media-quarantine'),false,'unverified uploads have no public URL');
select is((select file_size_limit from storage.buckets where id='media-quarantine'),104857600::bigint,'quarantine has a hard technical size ceiling');
select ok((select allowed_mime_types=array['image/jpeg','image/png','image/webp','audio/mpeg','audio/mp4','audio/webm','video/mp4','video/webm']
  from storage.buckets where id='media-quarantine'),'quarantine excludes SVG HTML and executable MIME declarations');
select is((select count(*) from pg_policies where schemaname='storage' and policyname like 'media_quarantine_no_client_%' and permissive='RESTRICTIVE'),5::bigint,
  'quarantine retains restrictive bucket/select/insert/update/delete policies');

insert into auth.users(id,email,raw_user_meta_data)
select ('ed100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'media-access-'||n||'@example.invalid','{}'::jsonb from generate_series(1,6) n;
update public.profiles set role='artist' where id in ('ed100000-0000-4000-8000-000000000001','ed100000-0000-4000-8000-000000000002');
update public.profiles set role='admin' where id='ed100000-0000-4000-8000-000000000003';
update public.profiles set is_restricted=true where id='ed100000-0000-4000-8000-000000000006';
insert into public.artists(id,slug,name,grade,status) values
 ('ed200000-0000-4000-8000-000000000001','media-access-main','허구 미디어 가수','B','active'),
 ('ed200000-0000-4000-8000-000000000002','media-access-other','허구 다른 가수','B','active');
insert into public.artist_members(artist_id,user_id) values
 ('ed200000-0000-4000-8000-000000000001','ed100000-0000-4000-8000-000000000001'),
 ('ed200000-0000-4000-8000-000000000002','ed100000-0000-4000-8000-000000000002');
insert into private.message_policy values(true,'fictional-media-test',604800,300,1000,100,2,180,60,5,1000,2000,3000);
insert into private.onboarding_documents(version,kind,title,body,approved_at,published_at) values
 ('ed900000-0000-4000-8000-000000000001','terms','Fictional terms','Rollback test only.',now(),now()),
 ('ed900000-0000-4000-8000-000000000002','privacy','Fictional privacy','Rollback test only.',now(),now());
insert into private.profile_onboarding_policy values(true,'ed800000-0000-4000-8000-000000000001',now(),2,10,
 array['금지단어'],'ed900000-0000-4000-8000-000000000001','ed900000-0000-4000-8000-000000000002',null);
set local role authenticated;
select set_config('request.jwt.claim.sub','ed100000-0000-4000-8000-000000000004',true);
select public.onboarding_save_font('large');
select public.onboarding_save_name('허구미디어팬');
select public.onboarding_complete_profile(true,true,'ed900000-0000-4000-8000-000000000001',true,'ed900000-0000-4000-8000-000000000002');
reset role;
create temporary table media_context(key text primary key,id uuid,data jsonb);
grant all on media_context to service_role,authenticated;
set local role service_role;
insert into media_context(key,id) values
 ('photo',public.messaging_save_draft('ed100000-0000-4000-8000-000000000001','ed200000-0000-4000-8000-000000000001',null,'photo',null)),
 ('voice',public.messaging_save_draft('ed100000-0000-4000-8000-000000000001','ed200000-0000-4000-8000-000000000001',null,'voice',null)),
 ('video',public.messaging_save_draft('ed100000-0000-4000-8000-000000000001','ed200000-0000-4000-8000-000000000001',null,'video',null)),
 ('text',public.messaging_save_draft('ed100000-0000-4000-8000-000000000001','ed200000-0000-4000-8000-000000000001',null,'text','허구 메시지'));
select throws_ok($$select public.media_begin_upload('ed100000-0000-4000-8000-000000000004',(select id from media_context where key='photo'),'image/png',100,gen_random_uuid())$$,
 '42501','MESSAGE_AUTHOR_FORBIDDEN','fan cannot obtain an artist upload');
select throws_ok($$select public.media_begin_upload('ed100000-0000-4000-8000-000000000002',(select id from media_context where key='photo'),'image/png',100,gen_random_uuid())$$,
 '42501','MESSAGE_AUTHOR_FORBIDDEN','other artist cannot upload to a foreign resource');
select throws_ok($$select public.media_begin_upload('ed100000-0000-4000-8000-000000000001',gen_random_uuid(),'image/png',100,gen_random_uuid())$$,
 '42501','MEDIA_FORBIDDEN','missing resource does not disclose object paths');
select throws_ok($$select public.media_begin_upload('ed100000-0000-4000-8000-000000000001',(select id from media_context where key='text'),'image/png',100,gen_random_uuid())$$,
 '55000','MEDIA_DRAFT_REQUIRED','text messages cannot reserve media');
select throws_ok($$select public.media_begin_upload('ed100000-0000-4000-8000-000000000001',(select id from media_context where key='photo'),'image/svg+xml',100,gen_random_uuid())$$,
 '23514','MEDIA_TYPE_INVALID','SVG cannot be authorized using a forged declared MIME');
select throws_ok($$select public.media_begin_upload('ed100000-0000-4000-8000-000000000001',(select id from media_context where key='photo'),'text/html',100,gen_random_uuid())$$,
 '23514','MEDIA_TYPE_INVALID','HTML cannot be uploaded as message content');
select throws_ok($$select public.media_begin_upload('ed100000-0000-4000-8000-000000000001',(select id from media_context where key='photo'),'video/mp4',100,gen_random_uuid())$$,
 '23514','MEDIA_TYPE_INVALID','allowed MIME still must match resource kind');
select throws_ok($$select public.media_begin_upload('ed100000-0000-4000-8000-000000000001',(select id from media_context where key='photo'),'image/png',0,gen_random_uuid())$$,
 '23514','MEDIA_LIMIT_EXCEEDED','empty content cannot reserve an upload');
select throws_ok($$select public.media_begin_upload('ed100000-0000-4000-8000-000000000001',(select id from media_context where key='photo'),'image/png',1001,gen_random_uuid())$$,
 '23514','MEDIA_LIMIT_EXCEEDED','configured photo cap is enforced before signing');
select throws_ok($$select public.media_begin_upload('ed100000-0000-4000-8000-000000000001',(select id from media_context where key='photo'),'image/png',100,null)$$,
 '22023','MEDIA_INPUT_INVALID','begin requires an explicit idempotency key');
insert into media_context(key,data) values('upload',public.media_begin_upload('ed100000-0000-4000-8000-000000000001',
 (select id from media_context where key='photo'),'image/png',1000,'ed300000-0000-4000-8000-000000000001'));
update media_context set id=(data->>'upload_id')::uuid where key='upload';
select is(public.media_begin_upload('ed100000-0000-4000-8000-000000000001',(select id from media_context where key='photo'),'image/png',1000,
 'ed300000-0000-4000-8000-000000000001'),(select data from media_context where key='upload'),'same payload retry preserves reservation and generated paths');
select throws_ok($$select public.media_begin_upload('ed100000-0000-4000-8000-000000000001',(select id from media_context where key='photo'),'image/png',999,
 'ed300000-0000-4000-8000-000000000001')$$,'23514','MEDIA_UPLOAD_CONFLICT','idempotency key cannot change declared source size');
select ok((select data->>'quarantine_path'='ed200000-0000-4000-8000-000000000001/'||(data->>'message_id')||'/'||(data->>'upload_id')||'.png' from media_context where key='upload'),
 'quarantine prefix is generated from authorized artist/message/intent only');
select ok((select data->>'object_path'='ed200000-0000-4000-8000-000000000001/'||(data->>'message_id')||'/'||(data->>'media_id')||'.png' from media_context where key='upload'),
 'final path uses separate generated media identity not quarantine identity');
select ok((select (data->>'expires_at')::timestamptz>clock_timestamp() and (data->>'expires_at')::timestamptz<=clock_timestamp()+interval '10 minutes'
 from media_context where key='upload'),'reservation expiry is server bounded to ten minutes');
select is((select data->>'max_bytes' from media_context where key='upload'),'1000','projection exposes current configured byte ceiling');
select is((select data->>'max_count' from media_context where key='upload'),'2','projection exposes current configured file count');
select is((select data->>'max_duration_ms' from media_context where key='upload'),null,'photo has no invented duration');
select throws_ok($$select public.media_resolve_upload('ed100000-0000-4000-8000-000000000003',(select id from media_context where key='upload'))$$,
 '42501','MEDIA_FORBIDDEN','even an admin cannot reuse another actor upload capability');
insert into media_context(key,data) values('second',public.media_begin_upload('ed100000-0000-4000-8000-000000000001',
 (select id from media_context where key='photo'),'image/jpeg',10,gen_random_uuid()));
update media_context set id=(data->>'upload_id')::uuid where key='second';
select throws_ok($$select public.media_begin_upload('ed100000-0000-4000-8000-000000000001',(select id from media_context where key='photo'),'image/png',10,gen_random_uuid())$$,
 '23514','MEDIA_COUNT_EXCEEDED','pending reservations count against the atomic file limit');
select is(public.media_revoke_upload('ed100000-0000-4000-8000-000000000001',(select id from media_context where key='second')),true,'cancel revokes a pending reservation');
select is(public.media_revoke_upload('ed100000-0000-4000-8000-000000000001',(select id from media_context where key='second')),true,'cancel retry is idempotent');
select throws_ok($$select public.media_resolve_upload('ed100000-0000-4000-8000-000000000001',(select id from media_context where key='second'))$$,
 '42501','MEDIA_UPLOAD_REVOKED','revoked capability cannot finalize even if bytes later arrive');
reset role;
insert into storage.objects(id,bucket_id,name,metadata) values
 ('ed400000-0000-4000-8000-000000000001','media-quarantine',(select data->>'quarantine_path' from media_context where key='upload'),'{"mimetype":"image/png","size":1000}'),
 ('ed400000-0000-4000-8000-000000000002','message-media',(select data->>'object_path' from media_context where key='upload'),'{"mimetype":"image/png","size":900}');
set local role service_role;
select throws_ok($$select public.media_finalize_upload('ed100000-0000-4000-8000-000000000001',(select id from media_context where key='upload'),
 'ed400000-0000-4000-8000-000000000001',10,10,null)$$,'23514','MEDIA_OBJECT_INVALID','quarantine bytes never register directly as readable media');
select throws_ok($$select public.media_finalize_upload('ed100000-0000-4000-8000-000000000001',(select id from media_context where key='upload'),
 gen_random_uuid(),10,10,null)$$,'23514','MEDIA_OBJECT_INVALID','nonexistent final object cannot be registered');
select throws_ok($$select public.media_finalize_upload('ed100000-0000-4000-8000-000000000001',(select id from media_context where key='upload'),
 'ed400000-0000-4000-8000-000000000002',null,10,null)$$,'23514',null,'unverified null dimensions cannot create a photo reference');
select is(public.media_finalize_upload('ed100000-0000-4000-8000-000000000001',(select id from media_context where key='upload'),
 'ed400000-0000-4000-8000-000000000002',10,10,null),(select (data->>'media_id')::uuid from media_context where key='upload'),
 'sanitized final bytes may differ from source size while obeying configured cap');
select is(public.media_finalize_upload('ed100000-0000-4000-8000-000000000001',(select id from media_context where key='upload'),
 'ed400000-0000-4000-8000-000000000002',10,10,null),(select (data->>'media_id')::uuid from media_context where key='upload'),'same verified completion is idempotent');
select throws_ok($$select public.media_finalize_upload('ed100000-0000-4000-8000-000000000001',(select id from media_context where key='upload'),
 'ed400000-0000-4000-8000-000000000002',11,10,null)$$,'23514','MEDIA_UPLOAD_CONFLICT','completion replay cannot rewrite verified dimensions');
select is(public.media_revoke_upload('ed100000-0000-4000-8000-000000000001',(select id from media_context where key='upload')),false,
 'upload cancellation cannot delete already registered media');
select is(public.media_resolve_upload('ed100000-0000-4000-8000-000000000001',(select id from media_context where key='upload'))->>'state','completed',
 'completion state is explicit for network retry');
select lives_ok($$select public.media_resolve_read('ed100000-0000-4000-8000-000000000001',(select (data->>'media_id')::uuid from media_context where key='upload'),false)$$,
 'current artist member can inspect its own registered draft');
select lives_ok($$select public.media_resolve_read('ed100000-0000-4000-8000-000000000003',(select (data->>'media_id')::uuid from media_context where key='upload'),false)$$,
 'current unrestricted admin can inspect a registered draft');
select throws_ok($$select public.media_resolve_read('ed100000-0000-4000-8000-000000000002',(select (data->>'media_id')::uuid from media_context where key='upload'),false)$$,
 '42501','MEDIA_FORBIDDEN','unrelated artist receives no path');
select throws_ok($$select public.media_resolve_read('ed100000-0000-4000-8000-000000000004',(select (data->>'media_id')::uuid from media_context where key='upload'),true)$$,
 '42501','MEDIA_FORBIDDEN','preview mode never reveals drafts');
select public.messaging_schedule('ed100000-0000-4000-8000-000000000001',(select id from media_context where key='photo'),clock_timestamp());
select public.messaging_dispatch((select id from media_context where key='photo'));
select public.messaging_set_previews('ed100000-0000-4000-8000-000000000003','ed200000-0000-4000-8000-000000000001',array[(select id from media_context where key='photo')]);
select lives_ok($$select public.media_resolve_read('ed100000-0000-4000-8000-000000000004',(select (data->>'media_id')::uuid from media_context where key='upload'),true)$$,
 'profile-ready onboarding fan can read a selected preview without subscription or full install completion');
select throws_ok($$select public.media_resolve_read('ed100000-0000-4000-8000-000000000005',(select (data->>'media_id')::uuid from media_context where key='upload'),true)$$,
 '55000','DISCOVERY_PROFILE_REQUIRED','preview exception still requires verified onboarding profile');
select throws_ok($$select public.media_resolve_read('ed100000-0000-4000-8000-000000000006',(select (data->>'media_id')::uuid from media_context where key='upload'),true)$$,
 '42501','DISCOVERY_FORBIDDEN','restricted fan cannot use preview bypass');
select throws_ok($$select public.media_resolve_read('ed100000-0000-4000-8000-000000000004',(select (data->>'media_id')::uuid from media_context where key='upload'),false)$$,
 '42501','MEDIA_FORBIDDEN','non-preview read requires actual paid access');
select public.messaging_set_previews('ed100000-0000-4000-8000-000000000003','ed200000-0000-4000-8000-000000000001',array[]::uuid[]);
select throws_ok($$select public.media_resolve_read('ed100000-0000-4000-8000-000000000004',(select (data->>'media_id')::uuid from media_context where key='upload'),true)$$,
 '42501','MEDIA_FORBIDDEN','removed preview permission denies newly requested URLs');
reset role;
update public.profiles set onboarding_completed_at=clock_timestamp() where id='ed100000-0000-4000-8000-000000000004';
insert into public.subscriptions(id,user_id,artist_id,provider,status,first_started_at,episode_started_at,current_period_start,current_period_end)
 values('ed500000-0000-4000-8000-000000000001','ed100000-0000-4000-8000-000000000004','ed200000-0000-4000-8000-000000000001','toss','active',
 now()-interval '1 day',now()-interval '1 day',now()-interval '1 day',clock_timestamp()+interval '20 seconds');
set local role service_role;
insert into media_context(key,data) values('read',public.media_resolve_read('ed100000-0000-4000-8000-000000000004',
 (select (data->>'media_id')::uuid from media_context where key='upload'),false));
select ok((select (data->>'access_expires_at')::timestamptz<=clock_timestamp()+interval '60 seconds' from media_context where key='read'),
 'every read capability has a sixty-second maximum lifetime');
select is((select (data->>'access_expires_at')::timestamptz from media_context where key='read'),
 (select current_period_end from public.subscriptions where id='ed500000-0000-4000-8000-000000000001'),'read lifetime cannot cross the paid entitlement boundary');
select is((select data->>'byte_size' from media_context where key='read'),'900','read exposes actual registered verified bytes not original source size');
select ok((select not(data ?| array['actor_id','author_id','call_name','request_id','quarantine_path']) from media_context where key='read'),
 'read projection excludes identities and quarantine capabilities');
reset role;
update public.subscriptions set status='canceled',canceled_at=clock_timestamp() where id='ed500000-0000-4000-8000-000000000001';
set local role service_role;
select lives_ok($$select public.media_resolve_read('ed100000-0000-4000-8000-000000000004',(select (data->>'media_id')::uuid from media_context where key='upload'),false)$$,
 'canceled subscription preserves already-paid current-period access');
reset role;
update public.subscriptions set status='expired',current_period_end=now()-interval '1 second' where id='ed500000-0000-4000-8000-000000000001';
set local role service_role;
select throws_ok($$select public.media_resolve_read('ed100000-0000-4000-8000-000000000004',(select (data->>'media_id')::uuid from media_context where key='upload'),false)$$,
 '42501','MEDIA_FORBIDDEN','expired subscription cannot mint new media URLs');
reset role;
update public.subscriptions set status='grace',canceled_at=null,grace_started_at=now()-interval '1 second',grace_ends_at=clock_timestamp()+interval '20 seconds'
 where id='ed500000-0000-4000-8000-000000000001';
set local role service_role;
select is((public.media_resolve_read('ed100000-0000-4000-8000-000000000004',(select (data->>'media_id')::uuid from media_context where key='upload'),false)->>'access_expires_at')::timestamptz,
 (select grace_ends_at from public.subscriptions where id='ed500000-0000-4000-8000-000000000001'),'grace access is capped at its exact paid grace deadline');
reset role;
update public.messages set scheduled_at=now()-interval '9 days',sent_at=now()-interval '9 days' where id=(select id from media_context where key='photo');
set local role service_role;
select throws_ok($$select public.media_resolve_read('ed100000-0000-4000-8000-000000000004',(select (data->>'media_id')::uuid from media_context where key='upload'),false)$$,
 '42501','MEDIA_FORBIDDEN','paid membership does not bypass the episode history boundary');
reset role;
update public.messages set sent_at=now()-interval '8 days' where id=(select id from media_context where key='photo');
set local role service_role;
select lives_ok($$select public.media_resolve_read('ed100000-0000-4000-8000-000000000004',(select (data->>'media_id')::uuid from media_context where key='upload'),false)$$,
 'exact history boundary remains inclusive');
reset role;
update public.profiles set is_restricted=true where id='ed100000-0000-4000-8000-000000000004';
set local role service_role;
select throws_ok($$select public.media_resolve_read('ed100000-0000-4000-8000-000000000004',(select (data->>'media_id')::uuid from media_context where key='upload'),false)$$,
 '42501','MEDIA_FORBIDDEN','current restriction revokes paid media signing');
reset role;
update public.profiles set is_restricted=false where id='ed100000-0000-4000-8000-000000000004';
update public.artists set status='paused' where id='ed200000-0000-4000-8000-000000000001';
set local role service_role;
select throws_ok($$select public.media_resolve_read('ed100000-0000-4000-8000-000000000004',(select (data->>'media_id')::uuid from media_context where key='upload'),false)$$,
 '42501','MEDIA_FORBIDDEN','paused artist cannot issue new URLs');
reset role;
update public.artists set status='active' where id='ed200000-0000-4000-8000-000000000001';
update storage.objects set metadata='{"mimetype":"image/png","size":"900"}' where id='ed400000-0000-4000-8000-000000000002';
set local role service_role;
select throws_ok($$select public.media_resolve_read('ed100000-0000-4000-8000-000000000004',(select (data->>'media_id')::uuid from media_context where key='upload'),false)$$,
 '23514','MEDIA_OBJECT_INVALID','changed or string-typed blob metadata invalidates read projection');
reset role;
update storage.objects set metadata='{"mimetype":"image/png","size":900}' where id='ed400000-0000-4000-8000-000000000002';
set local role service_role;
insert into media_context(key,data) values('expired',public.media_begin_upload('ed100000-0000-4000-8000-000000000001',
 (select id from media_context where key='voice'),'audio/mpeg',2000,gen_random_uuid()));
update media_context set id=(data->>'upload_id')::uuid where key='expired';
select is((select data->>'max_duration_ms' from media_context where key='expired'),'180000','voice duration limit is derived from current policy');
select throws_ok($$select public.media_begin_upload('ed100000-0000-4000-8000-000000000001',(select id from media_context where key='voice'),'audio/mpeg',100,gen_random_uuid())$$,
 '23514','MEDIA_COUNT_EXCEEDED','voice resource allows only one reserved file');
reset role;
update private.media_uploads set created_at=now()-interval '20 minutes',expires_at=now()-interval '10 minutes' where id=(select id from media_context where key='expired');
set local role service_role;
select throws_ok($$select public.media_resolve_upload('ed100000-0000-4000-8000-000000000001',(select id from media_context where key='expired'))$$,
 '55000','MEDIA_UPLOAD_EXPIRED','late quarantine uploads cannot renew an expired finalization capability');
select lives_ok($$select public.media_begin_upload('ed100000-0000-4000-8000-000000000001',(select id from media_context where key='voice'),'audio/mpeg',100,gen_random_uuid())$$,
 'expired reservation no longer occupies the resource count');
reset role;
delete from public.artist_members where artist_id='ed200000-0000-4000-8000-000000000001' and user_id='ed100000-0000-4000-8000-000000000001';
set local role service_role;
select throws_ok($$select public.media_resolve_upload('ed100000-0000-4000-8000-000000000001',(select id from media_context where key='upload'))$$,
 '42501','MESSAGE_AUTHOR_FORBIDDEN','membership removal blocks even completed upload replay');
select throws_ok($$select public.media_resolve_read('ed100000-0000-4000-8000-000000000001',(select (data->>'media_id')::uuid from media_context where key='upload'),false)$$,
 '42501','MEDIA_FORBIDDEN','membership removal blocks author signing');
reset role;
-- Add deliberately broad permissive policies to demonstrate restrictive defense
-- survives future unrelated storage grants. These DDL changes roll back.
create policy media_test_broad_read on storage.objects for select to authenticated using(true);
create policy media_test_broad_insert on storage.objects for insert to authenticated with check(true);
create policy media_test_broad_update on storage.objects for update to authenticated using(true) with check(true);
create policy media_test_broad_delete on storage.objects for delete to authenticated using(true);
set local role authenticated;
select is((select count(*) from storage.objects where bucket_id in ('media-quarantine','message-media')),0::bigint,
 'direct storage listing cannot expose quarantine or final private objects');
select throws_ok($$insert into storage.objects(bucket_id,name,metadata) values('media-quarantine','forged','{}')$$,'42501',null,
 'broad future grant does not authorize direct quarantine insertion');
select throws_ok($$insert into storage.objects(bucket_id,name,metadata) values('message-media','forged','{}')$$,'42501',null,
 'broad future grant does not authorize direct final insertion');
with changed as (update storage.objects set name='changed' where bucket_id='media-quarantine' returning id)
select is((select count(*) from changed),0::bigint,
 'direct quarantine overwrite remains impossible');
select throws_ok($$delete from storage.objects where bucket_id='message-media'$$,
 '42501','Direct deletion from storage tables is not allowed. Use the Storage API instead.',
 'direct final deletion is denied by the Storage API-only guard');
reset role;
select * from finish();
rollback;
