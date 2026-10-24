begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

-- This is executed by pg_prove on actual local Supabase PostgreSQL, not parsed SQL.
-- All users/data below are fictional and rolled back; no mail/invites/passwords.
select is((select count(*) from auth.users), 0::bigint, 'local seed creates no auth accounts');
select is((select count(*) from public.artists), 2::bigint, 'local seed has two fictional artists');
select is((select count(*) from public.artist_catalog), 1::bigint, 'only the active seed artist is public');
select is((select count(*) from public.artist_members), 0::bigint, 'seed grants no memberships');
select is((select count(*) from public.profiles), 0::bigint, 'seed provisions no profiles/admins');

-- Remove local artist seeds inside this rolled-back transaction for exact counts.
delete from public.artists;
insert into auth.users (id, email, raw_user_meta_data) values
  ('10000000-0000-4000-8000-000000000001', 'fan-one@example.invalid',
   '{"name":"가상 팬 하나","age_range":"50~59","gender":"unspecified","role":"admin","font_scale":"xlarge","is_restricted":false,"onboarding_completed_at":"2026-01-01T00:00:00Z","kakao_channel_added":true}'),
  ('10000000-0000-4000-8000-000000000002', 'fan-two@example.invalid',
   '{"name":[],"age_range":{},"gender":false}'),
  ('20000000-0000-4000-8000-000000000001', 'artist-one@example.invalid', '{}'),
  ('20000000-0000-4000-8000-000000000002', 'artist-two@example.invalid', '{}'),
  ('90000000-0000-4000-8000-000000000001', 'admin@example.invalid', '{}');

select is((select count(*) from public.profiles), 5::bigint, 'auth insert creates exactly one profile each');
select is((select role::text from public.profiles where id = '10000000-0000-4000-8000-000000000001'), 'fan', 'metadata cannot grant admin');
select is((select font_scale::text from public.profiles where id = '10000000-0000-4000-8000-000000000001'), 'large', 'font defaults large, metadata cannot override');
select is((select onboarding_completed_at from public.profiles where id = '10000000-0000-4000-8000-000000000001'), null::timestamptz, 'metadata cannot complete onboarding');
select is((select kakao_channel_added from public.profiles where id = '10000000-0000-4000-8000-000000000001'), false, 'metadata cannot attest channel addition');
select is((select nickname from public.profiles where id = '10000000-0000-4000-8000-000000000001'), '가상 팬 하나', 'display string metadata copied');
select is((select nickname from public.profiles where id = '10000000-0000-4000-8000-000000000002'), null::text, 'malformed metadata becomes null without breaking signup');
select is((select age_range from public.profiles where id = '10000000-0000-4000-8000-000000000002'), null::text, 'object age metadata is ignored');
select is((select gender from public.profiles where id = '10000000-0000-4000-8000-000000000002'), null::text, 'boolean gender metadata is ignored');

-- Operator setup is restricted to the transaction fixtures, never in seed.sql.
update public.profiles set role = 'artist' where id in
  ('20000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002');
update public.profiles set role = 'admin' where id = '90000000-0000-4000-8000-000000000001';
insert into public.artists (id, slug, name, grade, status, agency_name, contract_started_at, contract_ended_at) values
  ('30000000-0000-4000-8000-000000000001', 'test-active', '가상 공개', 'B', 'active', '비공개 계약 상대', '2026-01-01', '2026-12-31'),
  ('30000000-0000-4000-8000-000000000002', 'test-draft', '가상 초안', 'C', 'draft', null, null, null),
  ('30000000-0000-4000-8000-000000000003', 'test-paused', '가상 정지', 'B', 'paused', null, null, null),
  ('30000000-0000-4000-8000-000000000004', 'test-retired', '가상 은퇴', 'C', 'retired', null, null, null);
insert into public.artist_members (artist_id, user_id, is_manager) values
  ('30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', false),
  ('30000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', true),
  ('30000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000002', false);

-- Catalog/ACL assertions detect grant regressions as well as happy-path policies.
select ok((select bool_and(relrowsecurity) from pg_class where oid in
  ('public.profiles'::regclass, 'public.artists'::regclass, 'public.artist_members'::regclass)), 'RLS enabled on every base table');
select ok(not (select rolbypassrls or rolsuper from pg_roles where rolname = 'authenticated'), 'authenticated is not a bypass role');
select ok(not (select rolbypassrls or rolsuper from pg_roles where rolname = 'anon'), 'anon is not a bypass role');
select ok(not has_table_privilege('authenticated', 'public.profiles', 'UPDATE'), 'no broad profile UPDATE privilege');
select ok(not has_column_privilege('authenticated', 'public.profiles', 'call_name', 'UPDATE'), 'calling name requires validated server write');
select ok(has_column_privilege('authenticated', 'public.profiles', 'font_scale', 'UPDATE'), 'font scale explicitly writable');
select ok(not has_column_privilege('authenticated', 'public.profiles', 'role', 'UPDATE'), 'role is not directly writable');
select ok(not has_column_privilege('authenticated', 'public.profiles', 'onboarding_completed_at', 'UPDATE'), 'onboarding is not directly writable');
select ok(not has_function_privilege('anon', 'public.set_profile_role(uuid, public.user_role)', 'EXECUTE'), 'anon cannot execute admin RPC');
select ok(not has_function_privilege('service_role', 'public.set_profile_role(uuid, public.user_role)', 'EXECUTE'), 'server provisioning is separate from user-admin RPC');
select ok(not has_function_privilege('authenticated', 'private.handle_new_user()', 'EXECUTE'), 'profile trigger not callable');
select ok(not has_function_privilege('anon', 'private.current_user_role()', 'EXECUTE'), 'role helper not anonymous');
select ok((select bool_and('search_path=""' = any(proconfig)) from pg_proc where oid in
  ('private.handle_new_user()'::regprocedure, 'private.clear_revoked_artist_memberships()'::regprocedure, 'private.current_user_role()'::regprocedure,
   'private.is_artist_member(uuid)'::regprocedure, 'public.set_profile_role(uuid, public.user_role)'::regprocedure)), 'all privilege-crossing functions pin empty search_path');
select is(
  (select string_agg(column_name::text, ',' order by ordinal_position) from information_schema.columns
   where table_schema = 'public' and table_name = 'artist_catalog') collate "C",
  'id,slug,name,profile_image_path,intro'::text collate "C",
  'catalog is an explicit safe-column projection');

-- Anonymous: public catalog only. No user identifier or private contract leakage.
set local role anon;
select set_config('request.jwt.claims', '{}', true);
select is((select count(*) from public.artist_catalog), 1::bigint, 'anon sees only active catalog row');
select is((select slug from public.artist_catalog), 'test-active', 'anon sees intended active row');
select throws_ok('select * from public.profiles', '42501', null, 'anon cannot read profiles');
select throws_ok('select * from public.artists', '42501', null, 'anon cannot read raw artist contracts');
select throws_ok('select * from public.artist_members', '42501', null, 'anon cannot enumerate memberships');
select throws_ok($$update public.artist_catalog set name = 'Forged'$$, '42501', null, 'anon cannot update catalog view');
select throws_ok($$select public.set_profile_role('10000000-0000-4000-8000-000000000001', 'admin')$$, '42501', null, 'anon cannot promote an account');
reset role;

-- Fan: only own profile, never protected fields or another row.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated","user_metadata":{"role":"admin"}}', true);
select is(private.current_user_role()::text, 'fan', 'role helper reads DB, not forged user metadata');
select is((select count(*) from public.profiles), 1::bigint, 'fan sees own profile only');
select is((select id from public.profiles), '10000000-0000-4000-8000-000000000001'::uuid, 'fan sees correct profile');
select is((select count(*) from public.artists), 0::bigint, 'fan cannot read raw artist data');
select is((select count(*) from public.artist_catalog), 1::bigint, 'fan can read public active projection');
select is((select count(*) from public.artist_members), 0::bigint, 'fan cannot read memberships');
select is(private.is_artist_member('30000000-0000-4000-8000-000000000002'), false, 'fan cannot claim artist membership');
select lives_ok($$update public.profiles set font_scale = 'xlarge' where id = auth.uid()$$, 'fan updates own font preference');
select throws_ok($$update public.profiles set call_name = '반가운팬' where id = auth.uid()$$, '42501', null, 'calling-name changes cannot bypass later server validation');
select is((select font_scale::text from public.profiles), 'xlarge', 'own font update persisted');
with changed as (update public.profiles set font_scale = 'normal' where id = '10000000-0000-4000-8000-000000000002' returning id) select is((select count(*) from changed), 0::bigint, 'fan cannot update another fan');
select throws_ok($$update public.profiles set role = 'admin' where id = auth.uid()$$, '42501', null, 'fan cannot self-promote by UPDATE');
select throws_ok($$insert into public.profiles (id, role) values (auth.uid(), 'admin') on conflict (id) do update set role = excluded.role$$, '42501', null, 'fan cannot self-promote by UPSERT');
select throws_ok($$update public.profiles set is_restricted = false where id = auth.uid()$$, '42501', null, 'fan cannot clear restriction');
select throws_ok($$update public.profiles set restricted_until = null where id = auth.uid()$$, '42501', null, 'fan cannot change restriction expiry');
select throws_ok($$update public.profiles set onboarding_completed_at = now() where id = auth.uid()$$, '42501', null, 'fan cannot self-attest onboarding');
select throws_ok($$update public.profiles set phone = 'not-verified' where id = auth.uid()$$, '42501', null, 'phone writes require later server validation');
select throws_ok($$update public.profiles set age_range = '50~59' where id = auth.uid()$$, '42501', null, 'provider demographics not writable through profiles');
select throws_ok($$update public.profiles set kakao_channel_added = true where id = auth.uid()$$, '42501', null, 'channel verification cannot be self-attested');
select throws_ok($$update public.profiles set updated_at = '2000-01-01' where id = auth.uid()$$, '42501', null, 'fan cannot forge timestamps');
select throws_ok($$update public.profiles set id = '10000000-0000-4000-8000-000000000002' where id = auth.uid()$$, '42501', null, 'fan cannot move row ownership');
select throws_ok('delete from public.profiles where id = auth.uid()', '42501', null, 'profile deletion is server/auth-only');
select throws_ok($$select public.set_profile_role(auth.uid(), 'admin')$$, '42501', 'FORBIDDEN', 'fan cannot use admin RPC');
select throws_ok($$insert into public.artist_members (artist_id, user_id) values ('30000000-0000-4000-8000-000000000001', auth.uid())$$, '42501', null, 'fan cannot grant artist membership');
select throws_ok($$insert into public.artists (slug, name, grade) values ('unauthorized', 'Bad', 'B')$$, '42501', null, 'fan cannot create an artist');
with changed as (update public.artists set status = 'active' returning id) select is((select count(*) from changed), 0::bigint, 'fan cannot publish hidden artist');
with changed as (delete from public.artists returning id) select is((select count(*) from changed), 0::bigint, 'fan cannot delete artist');
select throws_ok($$update public.profiles set font_scale = 'tiny' where id = auth.uid()$$, '22P02', null, 'unknown font enum rejected');
reset role;

-- Other fan also sees only itself, and verifies the rejected cross-write.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select is((select count(*) from public.profiles), 1::bigint, 'other fan sees one profile');
select is((select font_scale::text from public.profiles), 'large', 'cross-user update did not change other fan');
select is((select count(*) from public.profiles where id = '10000000-0000-4000-8000-000000000001'), 0::bigint, 'other fan cannot read first fan');
with changed as (update public.profiles set font_scale = 'normal' where id = '10000000-0000-4000-8000-000000000001' returning id) select is((select count(*) from changed), 0::bigint, 'other fan cannot mutate first fan');
reset role;

-- Artist/manager: own bindings and raw artist rows, never fan PII or other artist.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is(private.current_user_role()::text, 'artist', 'artist database role recognized');
select is((select count(*) from public.profiles), 1::bigint, 'artist sees own profile only, not fan PII');
select is((select count(*) from public.profiles where id = '10000000-0000-4000-8000-000000000001'), 0::bigint, 'artist cannot select fan name/phone/demographics');
select is((select count(*) from public.artist_members), 2::bigint, 'artist sees only own memberships');
select is((select count(*) from public.artists), 2::bigint, 'artist sees active and draft own artists');
select is(private.is_artist_member('30000000-0000-4000-8000-000000000002'), true, 'manager binding authorizes own artist');
select is(private.is_artist_member('30000000-0000-4000-8000-000000000003'), false, 'other artist membership denied');
select is((select count(*) from public.artists where id = '30000000-0000-4000-8000-000000000003'), 0::bigint, 'artist cannot see other paused artist');
with changed as (update public.artists set name = 'Forged' where id = '30000000-0000-4000-8000-000000000002' returning id) select is((select count(*) from changed), 0::bigint, 'artist cannot change administrator-managed artist profile');
with changed as (delete from public.artist_members where user_id = auth.uid() returning artist_id) select is((select count(*) from changed), 0::bigint, 'artist cannot remove membership bindings');
with changed as (update public.artist_members set is_manager = false where user_id = auth.uid() returning artist_id) select is((select count(*) from changed), 0::bigint, 'artist cannot change manager privilege');
select throws_ok($$insert into public.artist_members (artist_id, user_id) values ('30000000-0000-4000-8000-000000000003', auth.uid())$$, '42501', null, 'artist cannot bind itself to another artist');
select throws_ok($$select public.set_profile_role(auth.uid(), 'admin')$$, '42501', 'FORBIDDEN', 'artist cannot elevate via admin RPC');
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select is((select count(*) from public.artists), 1::bigint, 'other artist sees only own paused artist');
select is((select slug from public.artists), 'test-paused', 'other artist sees correct private row');
select is((select count(*) from public.artist_members), 1::bigint, 'other artist cannot enumerate first artist bindings');
select is((select count(*) from public.artist_catalog), 1::bigint, 'other artist still sees public catalog');
reset role;

-- No valid subject is fail-closed even when the database role is authenticated.
set local role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated"}', true);
select is(private.current_user_role(), null::public.user_role, 'missing subject has no application role');
select is((select count(*) from public.profiles), 0::bigint, 'missing subject cannot read a profile');
select is((select count(*) from public.artists), 0::bigint, 'missing subject cannot read private artists');
select throws_ok($$select public.set_profile_role('10000000-0000-4000-8000-000000000001', 'admin')$$, '42501', 'FORBIDDEN', 'missing subject cannot call privileged RPC');
reset role;

-- Admin authorization is real DB data, with a narrowly privileged role RPC.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"90000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is(private.current_user_role()::text, 'admin', 'authorized admin database role recognized');
select is((select count(*) from public.profiles), 5::bigint, 'admin can read profiles');
select is((select count(*) from public.artists), 4::bigint, 'admin can read all artist states');
select is((select count(*) from public.artist_members), 3::bigint, 'admin can read memberships');
select throws_ok($$update public.profiles set role = 'admin' where id = '10000000-0000-4000-8000-000000000002'$$, '42501', null, 'even admin uses explicit role RPC, not broad UPDATE');
select lives_ok($$select public.set_profile_role('10000000-0000-4000-8000-000000000002', 'artist')$$, 'admin can assign artist role');
select is((select role::text from public.profiles where id = '10000000-0000-4000-8000-000000000002'), 'artist', 'authorized role change persisted');
select throws_ok($$select public.set_profile_role('ffffffff-ffff-4fff-8fff-ffffffffffff', 'fan')$$, 'P0002', 'PROFILE_NOT_FOUND', 'missing profile yields explicit error');
select throws_ok($$select public.set_profile_role('10000000-0000-4000-8000-000000000002', null)$$, '22004', 'ROLE_REQUIRED', 'null role rejected');
select lives_ok($$insert into public.artists (id, slug, name, grade) values ('30000000-0000-4000-8000-000000000005', 'admin-created', '관리자 가상', 'B')$$, 'admin creates artist');
select lives_ok($$update public.artists set status = 'active' where slug = 'admin-created'$$, 'admin publishes artist');
select lives_ok($$insert into public.artist_members (artist_id, user_id, is_manager) values ('30000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000002', true)$$, 'admin grants manager membership');
select lives_ok($$select public.set_profile_role('10000000-0000-4000-8000-000000000002', 'fan')$$, 'admin revokes artist role');
select is((select count(*) from public.artist_members where user_id = '10000000-0000-4000-8000-000000000002'), 0::bigint, 'role revocation clears old bindings');
select lives_ok($$delete from public.artists where slug = 'admin-created'$$, 'admin deletes artist');
select throws_ok($$insert into public.artists (slug, name, grade) values ('Bad Slug', 'Invalid', 'B')$$, '23514', null, 'artist slug format enforced');
select throws_ok($$insert into public.artists (slug, name, grade) values ('test-active', 'Duplicate', 'B')$$, '23505', null, 'artist slug uniqueness enforced');
select throws_ok($$insert into public.artists (slug, name, grade, contract_started_at, contract_ended_at) values ('bad-dates', 'Invalid', 'B', '2026-12-31', '2026-01-01')$$, '23514', null, 'contract dates cannot be reversed');
select throws_ok($$insert into public.artist_members (artist_id, user_id) values ('30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001')$$, '23505', null, 'duplicate membership rejected');
select throws_ok($$insert into public.artist_members (artist_id, user_id) values ('ffffffff-ffff-4fff-8fff-ffffffffffff', '20000000-0000-4000-8000-000000000001')$$, '23503', null, 'membership requires existing artist');
select throws_ok($$insert into public.artist_members (artist_id, user_id) values ('30000000-0000-4000-8000-000000000001', 'ffffffff-ffff-4fff-8fff-ffffffffffff')$$, '23503', null, 'membership requires existing profile');
reset role;

-- Ordinary trusted-server writes remain possible; full completion now requires its validated RPC.
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select is((select count(*) from public.profiles), 5::bigint, 'server role can provision across profiles');
select throws_ok($$update public.profiles set call_name = '' where id = '10000000-0000-4000-8000-000000000001'$$, '23514', null, 'empty calling name rejected');
select throws_ok($$update public.profiles set call_name = '  ' where id = '10000000-0000-4000-8000-000000000001'$$, '23514', null, 'blank calling name rejected');
select throws_ok($$update public.profiles set call_name = E'line\nbreak' where id = '10000000-0000-4000-8000-000000000001'$$, '23514', null, 'control characters rejected');
select throws_ok($$update public.profiles set call_name = '서버확인', onboarding_completed_at = statement_timestamp() where id = '10000000-0000-4000-8000-000000000002'$$, '42501', 'ONBOARDING_COMPLETION_RPC_REQUIRED', 'server cannot bypass the validated completion RPC');
select throws_ok($$update public.profiles set onboarding_completed_at = now() where id = '20000000-0000-4000-8000-000000000001'$$, '42501', 'ONBOARDING_COMPLETION_RPC_REQUIRED', 'server cannot record incomplete onboarding through raw table writes');
select throws_ok($$update public.profiles set restricted_until = now() + interval '1 day' where id = '10000000-0000-4000-8000-000000000001'$$, '23514', null, 'restriction expiry requires restriction flag');
select throws_ok($$update public.artists set id = '30000000-0000-4000-8000-000000000006' where slug = 'test-active'$$, '23514', 'IMMUTABLE_ID', 'artist IDs cannot be rewritten');
select lives_ok($$update public.profiles set created_at = '2000-01-01', updated_at = '2000-01-01' where id = '10000000-0000-4000-8000-000000000001'$$, 'timestamp trigger accepts update but overrides forged timestamps');
select ok((select created_at > '2000-01-01' and updated_at >= created_at from public.profiles where id = '10000000-0000-4000-8000-000000000001'), 'created_at preserved and updated_at maintained by database');
select lives_ok($$update public.profiles set is_restricted = true where id = '20000000-0000-4000-8000-000000000001'$$, 'server can restrict artist');
select lives_ok($$update public.profiles set is_restricted = true, restricted_until = now() + interval '1 day' where id = '90000000-0000-4000-8000-000000000001'$$, 'server can restrict admin');
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is(private.current_user_role(), null::public.user_role, 'restricted artist has no elevated role');
select is(private.is_artist_member('30000000-0000-4000-8000-000000000002'), false, 'restriction disables membership capability');
select is((select count(*) from public.artists), 0::bigint, 'restricted artist cannot read private artists');
select is((select count(*) from public.profiles), 1::bigint, 'restricted user may still read own profile');
select throws_ok($$update public.profiles set is_restricted = false where id = auth.uid()$$, '42501', null, 'restricted artist cannot lift own restriction');
select set_config('request.jwt.claims', '{"sub":"90000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is(private.current_user_role(), null::public.user_role, 'restricted admin loses role capability');
select is((select count(*) from public.profiles), 1::bigint, 'restricted admin cannot read other profiles');
select throws_ok($$select public.set_profile_role('10000000-0000-4000-8000-000000000001', 'admin')$$, '42501', 'FORBIDDEN', 'restricted admin cannot change roles');
reset role;

update public.profiles set restricted_until = now() - interval '1 second'
where id = '90000000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"90000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is(private.current_user_role()::text, 'admin', 'expired timed restriction restores capability');
reset role;

-- Server demotion uses the same cleanup trigger as the admin RPC.
set local role service_role;
update public.profiles set role = 'fan', is_restricted = false
where id = '20000000-0000-4000-8000-000000000001';
select is((select count(*) from public.artist_members where user_id = '20000000-0000-4000-8000-000000000001'), 0::bigint, 'server role demotion clears bindings too');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is(private.is_artist_member('30000000-0000-4000-8000-000000000002'), false, 'demoted artist has no membership capability');
select is((select count(*) from public.artists), 0::bigint, 'demoted user loses private artist visibility');
reset role;

set local role service_role;
update public.profiles set role = 'artist' where id = '20000000-0000-4000-8000-000000000001';
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is(private.is_artist_member('30000000-0000-4000-8000-000000000002'), false, 'server re-promotion cannot resurrect revoked membership');
reset role;

-- FK lifecycle and failure atomicity, still inside the rollback transaction.
select throws_ok($$insert into public.profiles (id) values ('ffffffff-ffff-4fff-8fff-ffffffffffff')$$, '23503', null, 'profile requires auth identity');
delete from auth.users where id = '20000000-0000-4000-8000-000000000002';
select is((select count(*) from public.profiles where id = '20000000-0000-4000-8000-000000000002'), 0::bigint, 'auth deletion cascades to profile');
select is((select count(*) from public.artist_members where user_id = '20000000-0000-4000-8000-000000000002'), 0::bigint, 'profile deletion cascades to memberships');
insert into public.artist_members (artist_id, user_id)
values ('30000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001');
select is((select count(*) from public.artist_members where artist_id = '30000000-0000-4000-8000-000000000002'), 1::bigint, 'artist cascade has a real binding before deletion');
delete from public.artists where id = '30000000-0000-4000-8000-000000000002';
select is((select count(*) from public.artist_members where artist_id = '30000000-0000-4000-8000-000000000002'), 0::bigint, 'artist deletion cascades to memberships');
select is((select role::text from public.profiles where id = '10000000-0000-4000-8000-000000000001'), 'fan', 'all rejected escalation attempts left fan role unchanged');
select * from finish();
rollback;
