begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

-- Fictional rollback-only fixtures. Direct role/JWT SQL proves database grants
-- and RLS, not JWT signature verification, HTTP endpoints or uploaded images.
insert into auth.users(id, email, raw_user_meta_data)
select ('91000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  'community-security-' || n || '@example.invalid', '{}'::jsonb
from generate_series(1, 8) n;
update public.profiles set call_name = '가상 이름', nickname = '비공개 별명',
  phone = '010-0000-0000', onboarding_completed_at = now();
update public.profiles set role = 'artist' where id = '91000000-0000-4000-8000-000000000006';
update public.profiles set role = 'admin' where id = '91000000-0000-4000-8000-000000000007';
update public.profiles set is_restricted = true, restricted_until = now() + interval '1 day'
  where id = '91000000-0000-4000-8000-000000000008';
insert into public.artists(id, slug, name, grade, status) values
 ('92000000-0000-4000-8000-000000000001','community-security-active','가상 게시판 가수','B','active'),
 ('92000000-0000-4000-8000-000000000002','community-security-paused','가상 중지 가수','B','paused');

select is((select count(*) from private.community_policy), 0::bigint,
  'community policy is not silently seeded with draft document defaults');
select ok((select bool_and(c.relrowsecurity) from pg_class c where c.oid in (
  'private.community_policy'::regclass, 'public.posts'::regclass,
  'public.comments'::regclass, 'public.post_likes'::regclass, 'public.reports'::regclass)),
  'all community policy and base tables enable RLS');
select ok((select bool_and(not has_table_privilege(r,t,'INSERT,UPDATE,DELETE,TRUNCATE'))
  from unnest(array['anon','authenticated','service_role']) r cross join unnest(array[
  'public.posts','public.comments','public.post_likes','public.reports']) t),
  'application roles cannot forge content authors, pins, report rows or counters directly');
select ok((select bool_and(not has_table_privilege(r,'private.community_policy','SELECT,INSERT,UPDATE,DELETE'))
  from unnest(array['anon','authenticated']) r), 'clients cannot inspect or replace policy snapshots');
select ok((select bool_and(not has_function_privilege('anon',p.oid,'EXECUTE')) from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
  and p.proname like 'community\_%' escape '\'), 'anonymous callers cannot execute community RPCs');
select ok((select bool_and(p.prosecdef and 'search_path=""'=any(p.proconfig)) from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
  and p.proname like 'community\_%' escape '\'), 'community privilege-crossing RPCs pin empty search_path');
select ok((select bool_and(provolatile='v') from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname like 'community\_%' escape '\'
  and p.proname not like '%list%' and p.proname not like '%get%'),
  'community mutation functions retain VOLATILE for row locks and fresh authorization clocks');

insert into public.posts(id,artist_id,user_id,request_id,title,body,is_hidden,deleted_at) values
 ('97000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000001','98000000-0000-4000-8000-000000000001','공개 글','공개 내용',false,null),
 ('97000000-0000-4000-8000-000000000002','92000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000001','98000000-0000-4000-8000-000000000002','숨긴 글','숨긴 내용',true,null),
 ('97000000-0000-4000-8000-000000000003','92000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000001','98000000-0000-4000-8000-000000000003','삭제 글','삭제 내용',false,now()),
 ('97000000-0000-4000-8000-000000000004','92000000-0000-4000-8000-000000000002','91000000-0000-4000-8000-000000000001','98000000-0000-4000-8000-000000000004','중지 글','중지 내용',false,null);
insert into public.comments(id,post_id,user_id,request_id,body,is_hidden,deleted_at) values
 ('99000000-0000-4000-8000-000000000001','97000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000002','9a000000-0000-4000-8000-000000000001','보이는 댓글',false,null),
 ('99000000-0000-4000-8000-000000000002','97000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000002','9a000000-0000-4000-8000-000000000002','숨긴 댓글',true,null),
 ('99000000-0000-4000-8000-000000000003','97000000-0000-4000-8000-000000000002','91000000-0000-4000-8000-000000000002','9a000000-0000-4000-8000-000000000003','숨긴 글 댓글',false,null),
 ('99000000-0000-4000-8000-000000000004','97000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000002','9a000000-0000-4000-8000-000000000004','삭제 댓글',false,now());
insert into public.post_likes(post_id,user_id) values
 ('97000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000002');
insert into public.reports(target_type,target_id,reporter_id,reason) values
 ('post','97000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000002','비공개 신고 이유');
insert into private.community_policy(version,max_title_length,max_body_length,max_comment_length,max_reason_length,
  max_images,max_image_bytes,max_image_long_edge,auto_hide_report_count,rate_window_seconds,
  max_contributions_per_window,max_reports_per_window,forbidden_terms,forbidden_patterns)
values ('fictional-test-policy-v1',100,1000,100,100,3,10485760,2048,3,60,100,100,array['blockedword'],array['[0-9]{3}-[0-9]{4}-[0-9]{4}']);

set local role anon;
select throws_ok($$select * from public.posts$$,'42501',null,'anonymous callers cannot read community posts');
select throws_ok($$select * from public.comments$$,'42501',null,'anonymous callers cannot read community comments');
select throws_ok($$select * from public.reports$$,'42501',null,'anonymous callers cannot inspect reports');
select throws_ok($$select public.community_create_post('92000000-0000-4000-8000-000000000001',
  gen_random_uuid(),'익명','익명 내용')$$,'42501',null,'anonymous callers cannot create a post');
reset role;
select set_config('request.jwt.claim.sub','91000000-0000-4000-8000-000000000003',true);
set local role authenticated;
select is((select count(*) from public.posts),1::bigint,
  'unrelated fan sees only visible content on active boards');
select is((select count(*) from public.comments),1::bigint,
  'unrelated fan cannot read hidden, deleted, or hidden-parent comments');
select is((select count(*) from public.post_likes),0::bigint,'fan cannot enumerate other fan likes');
select is((select count(*) from public.reports),0::bigint,'fan cannot read other reporter evidence');
select is((select count(*) from public.profiles),1::bigint,'community does not weaken private profile RLS');
select is((select count(*) from public.profiles where id='91000000-0000-4000-8000-000000000001'),0::bigint,
  'reading a post never grants access to the author phone or other private profile data');
select throws_ok($$insert into public.posts(artist_id,user_id,request_id,title,body,is_pinned,is_notice,report_count)
  values ('92000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000007',gen_random_uuid(),
  '관리자 위조','위조 내용',true,true,100)$$,'42501',null,'direct insert cannot forge an admin author, pin or report count');
select throws_ok($$update public.posts set user_id='91000000-0000-4000-8000-000000000003',
  is_hidden=false,like_count=100,comment_count=100,report_count=0$$,'42501',null,
  'direct update cannot seize content or forge visibility and counters');
select throws_ok($$delete from public.posts$$,'42501',null,'direct physical deletion is denied');
select throws_ok($$insert into public.comments(post_id,user_id,request_id,body) values
  ('97000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000007',gen_random_uuid(),'위조 댓글')$$,
  '42501',null,'direct insert cannot forge comment identity');
select throws_ok($$insert into public.post_likes(post_id,user_id) values
  ('97000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000007')$$,
  '42501',null,'direct insert cannot like as somebody else');
select throws_ok($$insert into public.reports(target_type,target_id,reporter_id,reason,status,resolved_by,resolved_at)
  values ('post','97000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000007',
  '위조 신고','restored','91000000-0000-4000-8000-000000000007',now())$$,
  '42501',null,'direct insert cannot forge reporter or resolution identity');
select throws_ok($$update public.profiles set is_restricted=false,restricted_until=null$$,
  '42501',null,'profile grants cannot bypass administrator restriction RPC');
select set_config('request.jwt.claims','{"role":"admin","user_role":"admin"}',true);
select throws_ok($$select public.community_set_notice('97000000-0000-4000-8000-000000000001',true,true)$$,
  '42501',null,'forged JWT metadata role does not grant notice or pin permission');
select throws_ok($$select public.community_moderate('post','97000000-0000-4000-8000-000000000001','hide','위조 관리자')$$,
  '42501',null,'forged JWT metadata role does not grant moderation permission');
select throws_ok($$select public.community_restrict_user('91000000-0000-4000-8000-000000000001',true,
  now()+interval '1 day','위조 제한')$$,'42501',null,'forged metadata cannot restrict another user');
select throws_ok($$select public.community_set_like('97000000-0000-4000-8000-000000000002',true)$$,
  '42501',null,'hidden post cannot be liked by unrelated fan');
select throws_ok($$select public.community_report('post','97000000-0000-4000-8000-000000000003','삭제 글 신고')$$,
  '42501',null,'deleted post cannot receive an unrelated report');
select throws_ok($$select public.community_create_post('92000000-0000-4000-8000-000000000002',
  gen_random_uuid(),'중지 게시판','우회 내용')$$,'42501',null,'paused artist board rejects content creation');
select throws_ok($$select public.community_report('comment','99000000-0000-4000-8000-000000000003','숨긴 부모')$$,
  '42501',null,'comment reports validate visibility of their parent post');

select set_config('request.jwt.claim.sub','91000000-0000-4000-8000-000000000001',true);
select is((select count(*) from public.posts),3::bigint,'owner can inspect own hidden and deleted active-board content');
select is((select count(*) from public.comments),1::bigint,'post author does not gain private moderation access to other comments');
select is((select count(*) from public.reports),0::bigint,'post author cannot identify confidential reporters');
select set_config('request.jwt.claim.sub','91000000-0000-4000-8000-000000000002',true);
select is((select count(*) from public.comments),4::bigint,'comment author retains own hidden/deleted history');
select is((select count(*) from public.post_likes),1::bigint,'caller can read own like history');
select is((select count(*) from public.reports),1::bigint,'reporter can read own report state');
select set_config('request.jwt.claim.sub','91000000-0000-4000-8000-000000000006',true);
select is((select count(*) from public.posts),1::bigint,'artist role alone grants no community moderation privilege');
select is((select count(*) from public.reports),0::bigint,'artist cannot enumerate reporter identities');

select set_config('request.jwt.claim.sub','91000000-0000-4000-8000-000000000008',true);
select is((select count(*) from public.posts),0::bigint,'active restriction denies board reads');
select is((select count(*) from public.comments),0::bigint,'active restriction denies comment reads');
select is((select count(*) from public.post_likes),0::bigint,'active restriction denies like reads');
select is((select count(*) from public.reports),0::bigint,'active restriction denies reporter reads');
select throws_ok($$select public.community_create_post('92000000-0000-4000-8000-000000000001',
  gen_random_uuid(),'제한 우회','내용')$$,'42501',null,'active restriction denies content writes');
select throws_ok($$select public.community_set_like('97000000-0000-4000-8000-000000000001',true)$$,
  '42501',null,'active restriction denies likes');
select throws_ok($$select public.community_report('post','97000000-0000-4000-8000-000000000001','제한 우회')$$,
  '42501',null,'active restriction denies reports');
reset role;
update public.profiles set restricted_until=now()-interval '1 second'
  where id='91000000-0000-4000-8000-000000000008';
set local role authenticated;
select is((select count(*) from public.posts),1::bigint,'expired restriction automatically restores ordinary read access');
select lives_ok($$select public.community_set_like('97000000-0000-4000-8000-000000000001',true)$$,
  'expired restriction automatically restores authorized interaction');

select set_config('request.jwt.claim.sub','91000000-0000-4000-8000-000000000007',true);
select is((select count(*) from public.posts),4::bigint,'administrator can inspect inactive-board and moderated posts');
select is((select count(*) from public.comments),4::bigint,'administrator can inspect moderated comments');
select is((select count(*) from public.reports),1::bigint,'administrator can inspect reports for moderation');
select throws_ok($$update public.posts set is_pinned=true$$,'42501',null,
  'authenticated admin still cannot bypass notice RPC');
select throws_ok($$select public.community_restrict_user('91000000-0000-4000-8000-000000000003',true,
  null,'무기한 제한')$$,'23514',null,'temporary restriction cannot silently become permanent');
select throws_ok($$select public.community_restrict_user('91000000-0000-4000-8000-000000000003',true,
  'infinity','무한 제한')$$,'23514',null,'restriction rejects non-finite expiry');
select throws_ok($$select public.community_restrict_user('91000000-0000-4000-8000-000000000003',true,
  now()-interval '1 second','지난 제한')$$,'23514',null,'restriction rejects already expired deadlines');
select throws_ok($$select public.community_restrict_user('91000000-0000-4000-8000-000000000007',true,
  now()+interval '1 day','자기 제한')$$,'42501',null,'administrator cannot lock out its own administrator account');
select lives_ok($$select public.community_restrict_user('91000000-0000-4000-8000-000000000003',true,
  now()+interval '1 day','가상 운영 제한')$$,'administrator can impose finite temporary restriction');
select is((select is_restricted and restricted_until is not null from public.profiles
  where id='91000000-0000-4000-8000-000000000003'),true,'restriction updates authoritative profile state');
select lives_ok($$select public.community_restrict_user('91000000-0000-4000-8000-000000000003',false,null,'가상 해제')$$,
  'administrator can explicitly release a restriction');
select is((select not is_restricted and restricted_until is null from public.profiles
  where id='91000000-0000-4000-8000-000000000003'),true,'restriction release clears both flags atomically');
reset role;
set local role service_role;
select throws_ok($$delete from public.posts$$,'42501',null,'service role cannot physically delete community evidence');
select throws_ok($$update public.posts set report_count=100$$,'42501',null,
  'service role cannot bypass atomic report counter handling');
reset role;
update public.profiles set onboarding_completed_at=null where id='91000000-0000-4000-8000-000000000005';
select set_config('request.jwt.claim.sub','91000000-0000-4000-8000-000000000005',true);
set local role authenticated;
select is((select count(*) from public.posts),0::bigint,'fan without completed onboarding cannot read the board');
select is((select count(*) from public.comments),0::bigint,'fan without completed onboarding cannot read comments');
select throws_ok($$select public.community_create_post('92000000-0000-4000-8000-000000000001',
  gen_random_uuid(),'온보딩 우회','내용')$$,'42501',null,'unonboarded fan cannot create posts');
select throws_ok($$select public.community_create_comment('97000000-0000-4000-8000-000000000001',
  gen_random_uuid(),'온보딩 우회')$$,'42501',null,'unonboarded fan cannot create comments');
select throws_ok($$select public.community_set_like('97000000-0000-4000-8000-000000000001',true)$$,
  '42501',null,'unonboarded fan cannot like posts');
select throws_ok($$select public.community_report('post','97000000-0000-4000-8000-000000000001','온보딩 우회')$$,
  '42501',null,'unonboarded fan cannot report content');
reset role;
select * from finish();
rollback;
