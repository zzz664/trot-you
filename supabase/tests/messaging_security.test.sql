begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

-- Fictional rollback-only metadata, never actual Storage uploads or real assets.
insert into auth.users(id, email, raw_user_meta_data) values
 ('81000000-0000-4000-8000-000000000001', 'message-fan@example.invalid', '{}'),
 ('81000000-0000-4000-8000-000000000002', 'message-artist@example.invalid', '{}'),
 ('81000000-0000-4000-8000-000000000003', 'message-other-artist@example.invalid', '{}'),
 ('81000000-0000-4000-8000-000000000004', 'message-admin@example.invalid', '{}');
update public.profiles set role = 'artist' where id in ('81000000-0000-4000-8000-000000000002','81000000-0000-4000-8000-000000000003');
update public.profiles set role = 'admin' where id = '81000000-0000-4000-8000-000000000004';
insert into public.artists(id,slug,name,grade,status) values
 ('82000000-0000-4000-8000-000000000001','media-security-one','보안가수','B','active'),
 ('82000000-0000-4000-8000-000000000002','media-security-two','다른가수','C','active');
insert into public.artist_members(artist_id,user_id) values
 ('82000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000002'),
 ('82000000-0000-4000-8000-000000000002','81000000-0000-4000-8000-000000000003');
insert into public.messages(id,artist_id,author_id,type,body) values
 ('83000000-0000-4000-8000-000000000001','82000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000002','photo','사진'),
 ('83000000-0000-4000-8000-000000000002','82000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000002','voice',null),
 ('83000000-0000-4000-8000-000000000003','82000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000002','video',null),
 ('83000000-0000-4000-8000-000000000004','82000000-0000-4000-8000-000000000002','81000000-0000-4000-8000-000000000003','text','다른 가수 비밀');

select ok((select bool_and(c.relrowsecurity) from pg_class c where c.oid in
 ('private.message_policy'::regclass,'public.messages'::regclass,'public.message_media'::regclass,
  'public.message_reads'::regclass,'public.replies'::regclass)), 'all new base tables enable RLS');
select ok((select bool_and(not has_table_privilege(r,t,'INSERT,UPDATE,DELETE,TRUNCATE'))
 from unnest(array['anon','authenticated','service_role']) r cross join unnest(array[
 'public.messages','public.message_media','public.message_reads','public.replies']) t),
 'all application roles lack direct message/reply/read/media mutation');
select ok((select bool_and(not has_table_privilege(r,'private.message_policy','SELECT,INSERT,UPDATE,DELETE'))
 from unnest(array['anon','authenticated']) r), 'clients cannot inspect or choose authorization policy');
select ok((select bool_and(not has_function_privilege(r,p.oid,'EXECUTE')) from pg_proc p
 join pg_namespace n on n.oid=p.pronamespace cross join unnest(array['anon','authenticated']) r
 where n.nspname='public' and p.proname like 'messaging\_%' escape '\'), 'every service messaging RPC denies clients');
select ok((select bool_and(has_function_privilege('service_role',p.oid,'EXECUTE')) from pg_proc p
 join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'messaging\_%' escape '\'),
 'service RPC allowlist is explicit');
select ok((select bool_and(p.prosecdef and 'search_path=""'=any(p.proconfig)) from pg_proc p
 join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and
 (p.proname like 'messaging\_%' escape '\' or p.proname in ('mark_message_read','has_active_access'))),
 'all new privilege crossing functions pin empty search path');
select ok(not has_function_privilege('authenticated','private.has_subscription_access(uuid,uuid,timestamptz)','EXECUTE'),
 'shared predicate cannot become an arbitrary-user subscription oracle');
select ok(not has_function_privilege('anon','public.mark_message_read(uuid)','EXECUTE'), 'anonymous caller cannot mark reads');
select ok(not has_function_privilege('service_role','public.mark_message_read(uuid)','EXECUTE'), 'read marker requires actual authenticated caller');
select is((select count(*) from private.message_policy),0::bigint,'no operational policy is seeded');
set local role service_role;
select throws_ok($$select public.messaging_save_draft('81000000-0000-4000-8000-000000000002','82000000-0000-4000-8000-000000000001',null,'text','내용')$$,
 '55000','MESSAGE_POLICY_REQUIRED','missing policy fails closed');
reset role;
insert into private.message_policy values(true,'fixture-v1',604800,300,1000,100,10,180,60,5,10485760,20971520,104857600);
select throws_ok($$update private.message_policy set history_before_seconds=-1$$,'23514',null,'negative history policy rejected');
select throws_ok($$update private.message_policy set cancel_window_seconds=2147483647$$,'23514',null,'unbounded cancellation policy rejected');
select throws_ok($$update private.message_policy set max_photo_bytes=10485761$$,'23514',null,'photo policy cannot exceed storage safety ceiling');

select set_config('request.jwt.claim.sub','81000000-0000-4000-8000-000000000001',true);
set local role authenticated;
select is((select count(*) from public.messages),0::bigint,'direct PostgREST-equivalent fan SELECT reveals no raw templates or lifecycle states');
select is((select count(*) from public.message_media),0::bigint,'fan cannot read raw private media metadata');
select is((select count(*) from public.replies),0::bigint,'fan cannot see other reply rows');
select throws_ok($$select public.messaging_list_messages('81000000-0000-4000-8000-000000000001','82000000-0000-4000-8000-000000000001',true,30)$$,
 '42501',null,'fan cannot bypass server personalization through read RPC');
select throws_ok($$select private.has_subscription_access('81000000-0000-4000-8000-000000000002','82000000-0000-4000-8000-000000000001',now())$$,
 '42501',null,'cross-user access oracle is denied at execution');
select throws_ok($$insert into public.messages(artist_id,author_id,type,body,status,scheduled_at,sent_at) values
 ('82000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000001','text','bypass','sent',now(),now())$$,
 '42501',null,'fan cannot forge a sent message');
select throws_ok($$insert into public.replies(user_id,artist_id,subscription_id,body) values
 ('81000000-0000-4000-8000-000000000001','82000000-0000-4000-8000-000000000001',gen_random_uuid(),'filter bypass')$$,
 '42501',null,'direct reply insert cannot bypass future moderation service');
select throws_ok($$insert into public.message_reads(user_id,message_id) values
 ('81000000-0000-4000-8000-000000000001','83000000-0000-4000-8000-000000000001')$$,
 '42501',null,'direct reads cannot forge refund/read evidence');
select throws_ok($$select public.mark_message_read('83000000-0000-4000-8000-000000000001')$$,
 '42501','MESSAGE_NOT_VISIBLE','draft cannot be marked read');
reset role;
select set_config('request.jwt.claim.sub','81000000-0000-4000-8000-000000000002',true);
set local role authenticated;
select is((select count(*) from public.messages),3::bigint,'artist sees only own artist raw authoring rows');
select throws_ok($$update public.messages set status='sent',scheduled_at=now(),sent_at=now() where id='83000000-0000-4000-8000-000000000001'$$,
 '42501',null,'artist cannot bypass scheduling via direct UPDATE');
select throws_ok($$update public.messages set status='canceled',canceled_at=now() where id='83000000-0000-4000-8000-000000000001'$$,
 '42501',null,'artist cannot bypass cancellation window via direct UPDATE');
select throws_ok($$delete from public.messages where id='83000000-0000-4000-8000-000000000001'$$,
 '42501',null,'artist cannot erase sent evidence or bypass cancellation by delete');
reset role;
select set_config('request.jwt.claim.sub','81000000-0000-4000-8000-000000000004',true);
set local role authenticated;
select is((select count(*) from public.messages),4::bigint,'admin may inspect all authoring rows');
select throws_ok($$update public.messages set is_preview=true where id='83000000-0000-4000-8000-000000000001'$$,
 '42501',null,'admin also cannot bypass preview validation directly');
reset role;
set local role service_role;
select throws_ok($$update public.messages set status='sent'$$,'42501',null,'service also uses lifecycle RPC instead of raw UPDATE');
select throws_ok($$select public.messaging_save_draft('81000000-0000-4000-8000-000000000001','82000000-0000-4000-8000-000000000001',null,'text','fan')$$,
 '42501','MESSAGE_AUTHOR_FORBIDDEN','fan actor cannot be laundered through server authoring RPC');
select throws_ok($$select public.messaging_save_draft('81000000-0000-4000-8000-000000000003','82000000-0000-4000-8000-000000000001',null,'text','other')$$,
 '42501','MESSAGE_AUTHOR_FORBIDDEN','other artist actor cannot author this artist');
reset role;

-- Broad future policies are deliberately installed in this rolled-back test.
-- The message-media restrictive guards must still deny each operation.
create policy fixture_storage_all on storage.objects for all to anon,authenticated using(true) with check(true);
create policy fixture_bucket_all on storage.buckets for all to anon,authenticated using(true) with check(true);
grant select,insert,update,delete on storage.objects,storage.buckets to anon,authenticated;
insert into storage.objects(id,bucket_id,name,metadata) values
 ('85000000-0000-4000-8000-000000000001','message-media',
  '82000000-0000-4000-8000-000000000001/83000000-0000-4000-8000-000000000001/84000000-0000-4000-8000-000000000001.jpg','{"mimetype":"image/jpeg","size":1000}'),
 ('85000000-0000-4000-8000-000000000002','message-media',
  '82000000-0000-4000-8000-000000000001/83000000-0000-4000-8000-000000000002/84000000-0000-4000-8000-000000000002.mp3','{"mimetype":"audio/mpeg","size":1000}'),
 ('85000000-0000-4000-8000-000000000003','message-media',
  '82000000-0000-4000-8000-000000000001/83000000-0000-4000-8000-000000000003/84000000-0000-4000-8000-000000000003.mp4','{"mimetype":"video/mp4","size":1000}');
select is((select public from storage.buckets where id='message-media'),false,'message-media is private');
select is((select file_size_limit from storage.buckets where id='message-media'),104857600::bigint,'bucket has explicit maximum byte size');
select ok((select not ('text/html'=any(allowed_mime_types)) from storage.buckets where id='message-media'),'active content MIME excluded');
set local role anon;
select is((select count(*) from storage.objects where bucket_id='message-media'),0::bigint,'anon cannot select private objects even with permissive policy');
select is((select count(*) from storage.buckets where id='message-media'),0::bigint,'anon cannot inspect or manage private bucket');
select throws_ok($$insert into storage.objects(bucket_id,name,metadata) values('message-media','anon.jpg','{}')$$,
 '42501',null,'anon cannot insert private objects');
with changed as (update storage.objects set name='changed.jpg' where bucket_id='message-media' returning id) select is((select count(*) from changed),0::bigint,'anon cannot rename private object');
with changed as (delete from storage.objects where bucket_id='message-media' returning id) select is((select count(*) from changed),0::bigint,'anon cannot delete private object');
with changed as (update storage.buckets set public=true where id='message-media' returning id) select is((select count(*) from changed),0::bigint,'anon cannot publish private bucket');
reset role;
set local role authenticated;
select is((select count(*) from storage.objects where bucket_id='message-media'),0::bigint,'authenticated admin cannot directly select/sign private objects');
select throws_ok($$insert into storage.objects(bucket_id,name,metadata) values('message-media','admin.jpg','{}')$$,
 '42501',null,'authenticated admin cannot bypass verified upload service');
with changed as (update storage.objects set name='changed.jpg' where bucket_id='message-media' returning id) select is((select count(*) from changed),0::bigint,'authenticated admin cannot overwrite private object');
with changed as (delete from storage.objects where bucket_id='message-media' returning id) select is((select count(*) from changed),0::bigint,'authenticated admin cannot delete private object');
with changed as (update storage.buckets set public=true where id='message-media' returning id) select is((select count(*) from changed),0::bigint,'authenticated admin cannot publish private bucket');
reset role;
select set_config('request.jwt.claim.sub','81000000-0000-4000-8000-000000000002',true);
set local role authenticated;
select is((select count(*) from storage.objects where bucket_id='message-media'),0::bigint,'artist cannot directly list/download any private bytes');
reset role;
select set_config('request.jwt.claim.sub','81000000-0000-4000-8000-000000000001',true);
set local role authenticated;
select is((select count(*) from storage.objects where bucket_id='message-media'),0::bigint,'fan cannot directly list/download any private bytes');
reset role;
set local role service_role;
select is((select count(*) from storage.objects where bucket_id='message-media'),3::bigint,'trusted service can inspect private metadata');
select throws_ok($$select public.messaging_register_media('81000000-0000-4000-8000-000000000003','83000000-0000-4000-8000-000000000001','84000000-0000-4000-8000-000000000001','85000000-0000-4000-8000-000000000001',100,100,null)$$,
 '42501','MESSAGE_AUTHOR_FORBIDDEN','other artist cannot associate uploaded object');
select throws_ok($$select public.messaging_register_media('81000000-0000-4000-8000-000000000002','83000000-0000-4000-8000-000000000001','84000000-0000-4000-8000-000000000002','85000000-0000-4000-8000-000000000002',100,100,null)$$,
 '23514','MEDIA_PATH_OR_METADATA_INVALID','actual object must belong to exact message and media id');
select throws_ok($$select public.messaging_register_media('81000000-0000-4000-8000-000000000002','83000000-0000-4000-8000-000000000001','84000000-0000-4000-8000-000000000001','85000000-0000-4000-8000-000000000099',100,100,null)$$,
 '23514','MEDIA_OBJECT_INVALID','nonexistent object cannot be registered');
select throws_ok($$select public.messaging_register_media('81000000-0000-4000-8000-000000000002','83000000-0000-4000-8000-000000000002','84000000-0000-4000-8000-000000000002','85000000-0000-4000-8000-000000000002',null,null,null)$$,
 '23514',null,'voice metadata requires a nonnull verified duration');
select throws_ok($$select public.messaging_register_media('81000000-0000-4000-8000-000000000002','83000000-0000-4000-8000-000000000003','84000000-0000-4000-8000-000000000003','85000000-0000-4000-8000-000000000003',100,100,null)$$,
 '23514',null,'video metadata requires a nonnull verified duration');
select throws_ok($$select public.messaging_register_media('81000000-0000-4000-8000-000000000002','83000000-0000-4000-8000-000000000002','84000000-0000-4000-8000-000000000002','85000000-0000-4000-8000-000000000002',null,null,180001)$$,
 '23514','MEDIA_LIMIT_EXCEEDED','voice duration above configured maximum fails');
select throws_ok($$select public.messaging_register_media('81000000-0000-4000-8000-000000000002','83000000-0000-4000-8000-000000000001','84000000-0000-4000-8000-000000000001','85000000-0000-4000-8000-000000000001',null,100,null)$$,
 '23514',null,'photo requires verified dimensions');
select is(public.messaging_register_media('81000000-0000-4000-8000-000000000002','83000000-0000-4000-8000-000000000001','84000000-0000-4000-8000-000000000001','85000000-0000-4000-8000-000000000001',100,100,null),
 '84000000-0000-4000-8000-000000000001'::uuid,'valid exact-association photo metadata registers');
select throws_ok($$select public.messaging_register_media('81000000-0000-4000-8000-000000000002','83000000-0000-4000-8000-000000000001','84000000-0000-4000-8000-000000000001','85000000-0000-4000-8000-000000000001',100,100,null)$$,
 '23505',null,'duplicate media/object association is rejected');
reset role;
update storage.objects set metadata='{"mimetype":"audio/mpeg","size":20971521}' where id='85000000-0000-4000-8000-000000000002';
set local role service_role;
select throws_ok($$select public.messaging_register_media('81000000-0000-4000-8000-000000000002','83000000-0000-4000-8000-000000000002','84000000-0000-4000-8000-000000000002','85000000-0000-4000-8000-000000000002',null,null,1000)$$,
 '23514','MEDIA_LIMIT_EXCEEDED','voice per-kind byte limit enforced below bucket cap');
reset role;
update storage.objects set metadata='{"mimetype":"text/html","size":1000}' where id='85000000-0000-4000-8000-000000000002';
set local role service_role;
select throws_ok($$select public.messaging_register_media('81000000-0000-4000-8000-000000000002','83000000-0000-4000-8000-000000000002','84000000-0000-4000-8000-000000000002','85000000-0000-4000-8000-000000000002',null,null,1000)$$,
 '23514','MEDIA_PATH_OR_METADATA_INVALID','unapproved MIME rejected');
reset role;
update storage.objects set metadata='{"mimetype":"image/jpeg","size":1001}' where id='85000000-0000-4000-8000-000000000001';
set local role service_role;
select throws_ok($$select public.messaging_schedule('81000000-0000-4000-8000-000000000002','83000000-0000-4000-8000-000000000001',now())$$,
 '23514','MEDIA_OBJECT_CHANGED','publication rechecks actual associated object metadata');
reset role;
update storage.objects set metadata='{"mimetype":"image/jpeg","size":1000}' where id='85000000-0000-4000-8000-000000000001';
set local role service_role;
select lives_ok($$select public.messaging_schedule('81000000-0000-4000-8000-000000000002','83000000-0000-4000-8000-000000000001',now())$$,
 'valid verified media draft can be scheduled');
select throws_ok($$select public.messaging_register_media('81000000-0000-4000-8000-000000000002','83000000-0000-4000-8000-000000000001','84000000-0000-4000-8000-000000000001','85000000-0000-4000-8000-000000000001',100,100,null)$$,
 '55000','MESSAGE_NOT_MEDIA_DRAFT','published/scheduled media association is immutable');
reset role;
select set_config('request.jwt.claim.sub','81000000-0000-4000-8000-000000000001',true);
set local role authenticated;
select is((select count(*) from public.message_media),0::bigint,'verified metadata still not raw-readable by fan');
reset role;
select throws_ok($$insert into public.message_reads(user_id,message_id) values ('81000000-0000-4000-8000-000000000001','83000000-0000-4000-8000-000000000099')$$,
 '23503',null,'read receipt has a real message foreign key');
select throws_ok($$insert into public.message_media(id,message_id,storage_object_id,bucket_id,object_path,kind,mime_type,byte_size,width,height)
 values(gen_random_uuid(),'83000000-0000-4000-8000-000000000099',gen_random_uuid(),'message-media','invalid','photo','image/jpeg',1,1,1)$$,
 '23503',null,'media cannot outlive actual message/object identity');
-- A populated safe media DTO exposes logical IDs, never bucket/path/object ID.
update public.profiles set call_name='가상팬', onboarding_completed_at=now()
 where id='81000000-0000-4000-8000-000000000001';
insert into public.subscriptions(id,user_id,artist_id,provider,status,first_started_at,episode_started_at,current_period_start,current_period_end)
 values('86000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000001','82000000-0000-4000-8000-000000000001',
 'toss','active',now()-interval '1 day',now()-interval '1 day',now()-interval '1 day',now()+interval '30 days');
set local role service_role;
select is(public.messaging_dispatch('83000000-0000-4000-8000-000000000001'),true,'verified photo can cross actual dispatch boundary');
select is((select string_agg(k,',' order by k) from jsonb_object_keys((select media->0 from
 public.messaging_list_messages('81000000-0000-4000-8000-000000000001','82000000-0000-4000-8000-000000000001',false,30))) k),
 'duration_ms,height,id,kind,width','media DTO has only safe logical media/display fields');
reset role;
set local role authenticated;
select is((select count(*) from public.messages),0::bigint,'paid fan still cannot read even an actual dispatched media template');
select is((select count(*) from public.message_media),0::bigint,'paid fan cannot discover raw paths after actual media dispatch');
reset role;
-- Even an accidentally broadened future EXECUTE grant must not turn editable
-- JWT fields into server-role authority. All changes roll back with the test.
grant execute on function public.messaging_save_draft(uuid,uuid,uuid,public.message_type,text) to authenticated;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"81000000-0000-4000-8000-000000000004","role":"service_role"}',true);
select throws_ok($$select public.messaging_save_draft('81000000-0000-4000-8000-000000000004','82000000-0000-4000-8000-000000000001',null,'text','forged role')$$,
 '42501','MESSAGE_SERVICE_REQUIRED','editable JWT role cannot satisfy actual service-role guard');
reset role;
select * from finish();
rollback;
