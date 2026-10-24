begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

-- All users, policy snapshots and Storage metadata are fictional and rolled back.
-- Registering metadata is not an upload, MIME sniff or actual image-byte probe.
insert into auth.users(id,email,raw_user_meta_data) values
 ('a1000000-0000-4000-8000-000000000001','community-policy-author@example.invalid','{}'),
 ('a1000000-0000-4000-8000-000000000002','community-policy-other@example.invalid','{}'),
 ('a1000000-0000-4000-8000-000000000003','community-policy-admin@example.invalid','{}');
update public.profiles set call_name='가상 이름',onboarding_completed_at=now();
update public.profiles set role='admin' where id='a1000000-0000-4000-8000-000000000003';
insert into public.artists(id,slug,name,grade,status) values
 ('a2000000-0000-4000-8000-000000000001','community-policy','가상 정책 가수','B','active');
insert into private.community_policy(version,max_title_length,max_body_length,max_comment_length,max_reason_length,
  max_images,max_image_bytes,max_image_long_edge,auto_hide_report_count,rate_window_seconds,
  max_contributions_per_window,max_reports_per_window,forbidden_terms,forbidden_patterns)
values ('fictional-policy-v1',10,100,20,20,3,1000,2048,3,60,2,1,array['blockedword'],array['[0-9]{3}-[0-9]{4}-[0-9]{4}']);
select throws_ok($$update private.community_policy set auto_hide_report_count=0$$,'23514',null,
  'auto-hide threshold must be a positive typed integer');
select throws_ok($$update private.community_policy set max_images=-1$$,'23514',null,
  'image count policy cannot be negative');
select throws_ok($$update private.community_policy set max_image_bytes=10485761$$,'23514',null,
  'image bytes policy cannot exceed the technical storage ceiling');
select throws_ok($$update private.community_policy set max_body_length=null$$,'23502',null,
  'policy snapshot cannot omit required content bounds');
select throws_ok($$update private.community_policy set forbidden_terms=array[null]::text[]$$,'23514',null,
  'null forbidden term cannot produce an ambiguous allow result');
select throws_ok($$update private.community_policy set rate_window_seconds=0$$,'23514',null,
  'rate window must be positive');
select throws_ok($$update private.community_policy set max_reports_per_window=0$$,'23514',null,
  'report quota must be positive');
select ok(not has_function_privilege('authenticated',
  'private.community_actor_allowed(uuid,timestamptz)','EXECUTE'),
  'arbitrary actor restriction predicate is not an account-status oracle');
select ok(not has_function_privilege('authenticated','private.get_community_policy()','EXECUTE'),
  'private policy helper cannot leak moderation settings');
select ok((select bool_and(provolatile='s') from pg_proc where oid in (
  'private.get_community_policy()'::regprocedure,
  'private.community_can_read_post(uuid)'::regprocedure,
  'private.community_can_read_comment(uuid)'::regprocedure)),
  'read-only policy and RLS helpers remain STABLE');
select ok((select bool_and(relrowsecurity) from pg_class where oid in (
  'private.community_rate_limits'::regclass,'public.post_images'::regclass,
  'public.community_moderation_log'::regclass)), 'rate, media and audit tables enable RLS');
select ok((select bool_and(not has_table_privilege(r,t,'INSERT,UPDATE,DELETE,TRUNCATE'))
  from unnest(array['anon','authenticated','service_role']) r cross join unnest(array[
  'private.community_rate_limits','public.post_images','public.community_moderation_log']) t),
  'clients and service cannot forge rate state, verified images or moderation audit');

create temporary table community_policy_context(key text primary key,id uuid);
grant all on community_policy_context to authenticated,service_role;
select set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000001',true);
set local role authenticated;
select throws_ok($$select public.community_create_post('a2000000-0000-4000-8000-000000000001',null,'제목','내용')$$,
  '22004','COMMUNITY_REQUEST_REQUIRED','creation requires an explicit idempotency key');
select throws_ok($$select public.community_create_post('a2000000-0000-4000-8000-000000000001',gen_random_uuid(),'   ','내용')$$,
  '23514','COMMUNITY_CONTENT_INVALID','whitespace title is rejected');
select throws_ok($$select public.community_create_post('a2000000-0000-4000-8000-000000000001',gen_random_uuid(),repeat('가',11),'내용')$$,
  '23514','COMMUNITY_CONTENT_INVALID','configured title limit counts characters');
select throws_ok($$select public.community_create_post('a2000000-0000-4000-8000-000000000001',gen_random_uuid(),'제목',repeat('가',101))$$,
  '23514','COMMUNITY_CONTENT_INVALID','configured body limit is enforced');
select throws_ok($$select public.community_create_post('a2000000-0000-4000-8000-000000000001',gen_random_uuid(),'제목','BLOCKEDWORD')$$,
  '23514','COMMUNITY_CONTENT_BLOCKED','configured forbidden terms are case-insensitive');
select throws_ok($$select public.community_create_post('a2000000-0000-4000-8000-000000000001',gen_random_uuid(),'제목','010-1234-5678')$$,
  '23514','COMMUNITY_CONTENT_BLOCKED','configured sensitive-content pattern is enforced in the database');
insert into community_policy_context values('post',public.community_create_post(
  'a2000000-0000-4000-8000-000000000001','a3000000-0000-4000-8000-000000000001',repeat('가',10),repeat('나',100)));
select is(public.community_create_post('a2000000-0000-4000-8000-000000000001',
  'a3000000-0000-4000-8000-000000000001',repeat('가',10),repeat('나',100)),
  (select id from community_policy_context where key='post'),'exact-limit payload and idempotent replay succeed');
select throws_ok($$select public.community_create_comment((select id from community_policy_context where key='post'),
  gen_random_uuid(),repeat('가',21))$$,'23514','COMMUNITY_CONTENT_INVALID','comment policy limit is enforced');
select lives_ok($$select public.community_create_comment((select id from community_policy_context where key='post'),
  'a3000000-0000-4000-8000-000000000002',repeat('가',20))$$,'exact-limit comment is the second allowed contribution');
select throws_ok($$select public.community_create_post('a2000000-0000-4000-8000-000000000001',
  gen_random_uuid(),'세 번째','내용')$$,'54000','COMMUNITY_RATE_LIMITED','post and comment share the atomic contribution quota');
select is(public.community_create_post('a2000000-0000-4000-8000-000000000001',
  'a3000000-0000-4000-8000-000000000001',repeat('가',10),repeat('나',100)),
  (select id from community_policy_context where key='post'),'valid replay does not consume or exceed rate quota');
reset role;
select is((select contributions from private.community_rate_limits where user_id='a1000000-0000-4000-8000-000000000001'),2,
  'failed validation and retries do not consume contribution quota');
update private.community_rate_limits set started_at=now()-interval '61 seconds'
  where user_id='a1000000-0000-4000-8000-000000000001';
set local role authenticated;
insert into community_policy_context values('second',public.community_create_post(
  'a2000000-0000-4000-8000-000000000001','a3000000-0000-4000-8000-000000000003','새 창','내용'));
reset role;
select is((select contributions from private.community_rate_limits where user_id='a1000000-0000-4000-8000-000000000001'),1,
  'expired rate window restarts atomically at one contribution');
select set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000002',true);
set local role authenticated;
select throws_ok($$select public.community_report('post',(select id from community_policy_context where key='post'),repeat('가',21))$$,
  '23514','COMMUNITY_CONTENT_INVALID','report reason is policy bounded');
insert into community_policy_context values('report',public.community_report('post',
  (select id from community_policy_context where key='post'),'가상 신고 사유'));
select is(public.community_report('post',(select id from community_policy_context where key='post'),'재시도 사유'),
  (select id from community_policy_context where key='report'),'report retry preserves original identity and reason');
select throws_ok($$select public.community_report('post',(select id from community_policy_context where key='second'),'다른 신고')$$,
  '54000','COMMUNITY_RATE_LIMITED','new target report consumes separate atomic report quota');
reset role;
select is((select reports from private.community_rate_limits where user_id='a1000000-0000-4000-8000-000000000002'),1,
  'duplicate reports and invalid reasons consume no extra report quota');
select is((select reason from public.reports where id=(select id from community_policy_context where key='report')),
  '가상 신고 사유','a duplicate report cannot rewrite original evidence');

-- Canonical resource-bound Storage paths, not user-supplied arbitrary URLs.
insert into storage.objects(id,bucket_id,name,metadata)
select ('a5000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'board-media',
  'a2000000-0000-4000-8000-000000000001/'||(select id::text from community_policy_context where key='post')||
  '/a4000000-0000-4000-8000-'||lpad(n::text,12,'0')||'.jpg',
  '{"mimetype":"image/jpeg","size":1000}'::jsonb
from generate_series(1,4) n;
select is((select public from storage.buckets where id='board-media'),false,'board images are never placed in a public bucket');
select is((select file_size_limit from storage.buckets where id='board-media'),10485760::bigint,'board bucket has a technical byte ceiling');
select ok((select allowed_mime_types=array['image/jpeg','image/png','image/webp'] from storage.buckets where id='board-media'),
  'board image MIME allowlist excludes active content');
select ok(not has_function_privilege('authenticated',
  'public.community_register_image(uuid,uuid,uuid,uuid,integer,integer)','EXECUTE'),
  'authenticated owners cannot bypass the future trusted byte verifier');
set local role service_role;
select throws_ok($$select public.community_register_image('a1000000-0000-4000-8000-000000000002',
  (select id from community_policy_context where key='post'),'a4000000-0000-4000-8000-000000000001',
  'a5000000-0000-4000-8000-000000000001',100,100)$$,'42501','COMMUNITY_TARGET_UNAVAILABLE',
  'service registration still verifies actual content author');
select throws_ok($$select public.community_register_image('a1000000-0000-4000-8000-000000000001',
  (select id from community_policy_context where key='post'),'a4000000-0000-4000-8000-000000000099',
  'a5000000-0000-4000-8000-000000000001',100,100)$$,'23514','COMMUNITY_IMAGE_INVALID',
  'object path must bind exactly the requested image identity');
select throws_ok($$select public.community_register_image('a1000000-0000-4000-8000-000000000001',
  (select id from community_policy_context where key='post'),'a4000000-0000-4000-8000-000000000001',
  'a5000000-0000-4000-8000-000000000099',100,100)$$,'23514','COMMUNITY_IMAGE_INVALID',
  'missing Storage object cannot be registered');
select throws_ok($$select public.community_register_image('a1000000-0000-4000-8000-000000000001',
  (select id from community_policy_context where key='post'),'a4000000-0000-4000-8000-000000000001',
  'a5000000-0000-4000-8000-000000000001',null,100)$$,'23514','COMMUNITY_IMAGE_INVALID',
  'image registration requires verified nonnull dimensions');
select throws_ok($$select public.community_register_image('a1000000-0000-4000-8000-000000000001',
  (select id from community_policy_context where key='post'),'a4000000-0000-4000-8000-000000000001',
  'a5000000-0000-4000-8000-000000000001',2049,100)$$,'23514','COMMUNITY_IMAGE_INVALID',
  'image dimensions cannot exceed configured long edge');
select is(public.community_register_image('a1000000-0000-4000-8000-000000000001',
  (select id from community_policy_context where key='post'),'a4000000-0000-4000-8000-000000000001',
  'a5000000-0000-4000-8000-000000000001',2048,100),
  'a4000000-0000-4000-8000-000000000001'::uuid,'exact-bound resource-associated metadata registers');
select is(public.community_register_image('a1000000-0000-4000-8000-000000000001',
  (select id from community_policy_context where key='post'),'a4000000-0000-4000-8000-000000000001',
  'a5000000-0000-4000-8000-000000000001',2048,100),
  'a4000000-0000-4000-8000-000000000001'::uuid,'same verified image registration is idempotent');
select throws_ok($$select public.community_register_image('a1000000-0000-4000-8000-000000000001',
  (select id from community_policy_context where key='post'),'a4000000-0000-4000-8000-000000000001',
  'a5000000-0000-4000-8000-000000000001',100,100)$$,'23514','COMMUNITY_IDEMPOTENCY_CONFLICT',
  'image retry cannot silently change verified dimensions');
reset role;
update storage.objects set metadata='{"mimetype":"image/jpeg","size":"1000"}' where id='a5000000-0000-4000-8000-000000000002';
set local role service_role;
select throws_ok($$select public.community_register_image('a1000000-0000-4000-8000-000000000001',
  (select id from community_policy_context where key='post'),'a4000000-0000-4000-8000-000000000002',
  'a5000000-0000-4000-8000-000000000002',100,100)$$,'23514','COMMUNITY_IMAGE_INVALID','string bytes cannot masquerade as numeric metadata');
reset role;
update storage.objects set metadata='{"mimetype":"image/jpeg","size":1001}' where id='a5000000-0000-4000-8000-000000000002';
set local role service_role;
select throws_ok($$select public.community_register_image('a1000000-0000-4000-8000-000000000001',
  (select id from community_policy_context where key='post'),'a4000000-0000-4000-8000-000000000002',
  'a5000000-0000-4000-8000-000000000002',100,100)$$,'23514','COMMUNITY_IMAGE_INVALID','image byte size obeys policy below bucket ceiling');
reset role;
update storage.objects set metadata='{"mimetype":"image/jpeg","size":-1}' where id='a5000000-0000-4000-8000-000000000002';
set local role service_role;
select throws_ok($$select public.community_register_image('a1000000-0000-4000-8000-000000000001',
  (select id from community_policy_context where key='post'),'a4000000-0000-4000-8000-000000000002',
  'a5000000-0000-4000-8000-000000000002',100,100)$$,'23514','COMMUNITY_IMAGE_INVALID','negative byte size is rejected');
reset role;
update storage.objects set metadata='{"mimetype":"image/jpeg","size":1.5}' where id='a5000000-0000-4000-8000-000000000002';
set local role service_role;
select throws_ok($$select public.community_register_image('a1000000-0000-4000-8000-000000000001',
  (select id from community_policy_context where key='post'),'a4000000-0000-4000-8000-000000000002',
  'a5000000-0000-4000-8000-000000000002',100,100)$$,'23514','COMMUNITY_IMAGE_INVALID','fractional byte metadata is rejected');
reset role;
update storage.objects set metadata='{"mimetype":"text/html","size":1000}' where id='a5000000-0000-4000-8000-000000000002';
set local role service_role;
select throws_ok($$select public.community_register_image('a1000000-0000-4000-8000-000000000001',
  (select id from community_policy_context where key='post'),'a4000000-0000-4000-8000-000000000002',
  'a5000000-0000-4000-8000-000000000002',100,100)$$,'23514','COMMUNITY_IMAGE_INVALID','active content MIME is rejected');
reset role;
update storage.objects set metadata='{"mimetype":"image/png","size":1000}' where id='a5000000-0000-4000-8000-000000000002';
set local role service_role;
select throws_ok($$select public.community_register_image('a1000000-0000-4000-8000-000000000001',
  (select id from community_policy_context where key='post'),'a4000000-0000-4000-8000-000000000002',
  'a5000000-0000-4000-8000-000000000002',100,100)$$,'23514','COMMUNITY_IMAGE_INVALID','MIME and path extension must agree');
reset role;
update storage.objects set metadata='{"mimetype":"image/jpeg","size":1000}' where id='a5000000-0000-4000-8000-000000000002';
set local role service_role;
select lives_ok($$select public.community_register_image('a1000000-0000-4000-8000-000000000001',
  (select id from community_policy_context where key='post'),'a4000000-0000-4000-8000-000000000002',
  'a5000000-0000-4000-8000-000000000002',100,100)$$,'second image registers after verified metadata is valid');
select lives_ok($$select public.community_register_image('a1000000-0000-4000-8000-000000000001',
  (select id from community_policy_context where key='post'),'a4000000-0000-4000-8000-000000000003',
  'a5000000-0000-4000-8000-000000000003',100,100)$$,'third image registers at configured count boundary');
select throws_ok($$select public.community_register_image('a1000000-0000-4000-8000-000000000001',
  (select id from community_policy_context where key='post'),'a4000000-0000-4000-8000-000000000004',
  'a5000000-0000-4000-8000-000000000004',100,100)$$,'23514','COMMUNITY_IMAGE_LIMIT','fourth image exceeds configured count');
select is((select count(*) from public.post_images),3::bigint,'duplicate metadata and failed registrations allocate no extra image rows');
reset role;
select set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000002',true);
set local role authenticated;
select is((select count(id) from public.post_images),3::bigint,'authorized board reader can see safe image descriptors');
select throws_ok($$select object_path from public.post_images$$,'42501',null,'raw object paths remain server-only');
select throws_ok($$select bucket_id,storage_object_id from public.post_images$$,'42501',null,'raw bucket and object identities remain server-only');
select is((select count(*) from public.community_moderation_log),0::bigint,'ordinary callers cannot read internal moderation reasons');
reset role;
update public.posts set is_hidden=true where id=(select id from community_policy_context where key='post');
set local role authenticated;
select is((select count(id) from public.post_images),0::bigint,'hidden parent hides its image descriptors from another fan');
select set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000001',true);
select is((select count(id) from public.post_images),3::bigint,'owner retains safe metadata of own hidden content');
reset role;
set local role service_role;
select throws_ok($$select public.community_register_image('a1000000-0000-4000-8000-000000000001',
  (select id from community_policy_context where key='post'),'a4000000-0000-4000-8000-000000000001',
  'a5000000-0000-4000-8000-000000000001',2048,100)$$,'42501','COMMUNITY_TARGET_UNAVAILABLE','hidden content cannot receive image registration retries');
reset role;
update public.posts set is_hidden=false where id=(select id from community_policy_context where key='post');
select set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000003',true);
set local role authenticated;
select lives_ok($$select public.community_set_notice((select id from community_policy_context where key='post'),true,true)$$,
  'administrator promotion creates an authoritative notice');
select is((select count(*) from public.community_moderation_log where action='notice'),1::bigint,'notice transition creates accountable admin audit evidence');
select set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000001',true);
select throws_ok($$select public.community_update_post((select id from community_policy_context where key='post'),'변조 공지','변조 내용')$$,
  '42501',null,'original fan owner cannot edit a promoted administrator notice');
reset role;
set local role service_role;
select throws_ok($$select public.community_register_image('a1000000-0000-4000-8000-000000000001',
  (select id from community_policy_context where key='post'),'a4000000-0000-4000-8000-000000000001',
  'a5000000-0000-4000-8000-000000000001',2048,100)$$,'42501',null,
  'trusted image service cannot append owner-controlled media to a promoted notice');
reset role;

-- Broader future Storage policies must not weaken this bucket exclusion.
create policy community_fixture_storage_all on storage.objects for all to anon,authenticated using(true) with check(true);
create policy community_fixture_bucket_all on storage.buckets for all to anon,authenticated using(true) with check(true);
grant select,insert,update,delete on storage.objects,storage.buckets to anon,authenticated;
select ok(exists (select 1 from pg_policy where polrelid='storage.objects'::regclass
  and polname='board_media_no_client_delete' and polcmd='d' and not polpermissive and cardinality(polroles)=2
  and polroles @> array[(select oid from pg_roles where rolname='anon'),
    (select oid from pg_roles where rolname='authenticated')]::oid[]
  and pg_get_expr(polqual,polrelid)='(bucket_id <> ''board-media''::text)'),
  'object DELETE RLS independently retains the exact restrictive board bucket exclusion');
set local role anon;
select is((select count(*) from storage.objects where bucket_id='board-media'),0::bigint,'anonymous caller cannot list private board objects despite broad permissive policy');
select is((select count(*) from storage.buckets where id='board-media'),0::bigint,'anonymous caller cannot inspect board bucket configuration');
select throws_ok($$insert into storage.objects(bucket_id,name,metadata) values('board-media','anon.jpg','{}')$$,
  '42501',null,'anonymous caller cannot bypass verified uploads');
with changed as(update storage.objects set name='renamed.jpg' where bucket_id='board-media' returning id)
  select is((select count(*) from changed),0::bigint,'anonymous caller cannot overwrite board objects');
-- The real Supabase Storage BEFORE DELETE statement trigger rejects even a
-- zero-row delete. Do not disable it or enable the internal API bypass in tests.
select throws_ok($$delete from storage.objects where bucket_id='board-media'$$,
  '42501','Direct deletion from storage tables is not allowed. Use the Storage API instead.',
  'real Storage statement guard denies direct anonymous object deletion');
reset role;
select set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000003',true);
set local role authenticated;
select is((select count(*) from storage.objects where bucket_id='board-media'),0::bigint,'even authenticated admin cannot list/sign raw private board objects');
select throws_ok($$insert into storage.objects(bucket_id,name,metadata) values('board-media','admin.jpg','{}')$$,
  '42501',null,'authenticated admin cannot bypass verified upload service');
with changed as(update storage.buckets set public=true where id='board-media' returning id)
  select is((select count(*) from changed),0::bigint,'authenticated admin cannot publish private board bucket');
select throws_ok($$delete from storage.objects where bucket_id='board-media'$$,
  '42501','Direct deletion from storage tables is not allowed. Use the Storage API instead.',
  'real Storage statement guard denies direct authenticated object deletion');
reset role;
-- Even a future accidental grant cannot turn editable JWT role strings into a
-- trusted upload verifier. The role guard inspects actual SET ROLE context.
grant execute on function public.community_register_image(uuid,uuid,uuid,uuid,integer,integer) to authenticated;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role authenticated;
select throws_ok($$select public.community_register_image('a1000000-0000-4000-8000-000000000001',
  (select id from community_policy_context where key='post'),'a4000000-0000-4000-8000-000000000001',
  'a5000000-0000-4000-8000-000000000001',2048,100)$$,'42501','COMMUNITY_SERVICE_REQUIRED',
  'forged service JWT metadata does not become image verification authority');
reset role;
select * from finish();
rollback;
