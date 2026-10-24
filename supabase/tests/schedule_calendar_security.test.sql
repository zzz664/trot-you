begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

-- Fictional rollback-only role fixtures. These tests verify database grants/RLS,
-- not signed JWT validation, a hosted API, real events or notification delivery.
insert into auth.users(id,email,raw_user_meta_data)
select ('a1000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid,
  'calendar-security-' || n || '@example.invalid','{}'::jsonb
from generate_series(1,9) n;
update public.profiles set call_name='가상 일정 사용자',phone='010-0000-0000',
  onboarding_completed_at=now() where id::text like 'a1000000-%';
update public.profiles set role='artist' where id in
 ('a1000000-0000-4000-8000-000000000003','a1000000-0000-4000-8000-000000000004');
update public.profiles set role='admin' where id in
 ('a1000000-0000-4000-8000-000000000005','a1000000-0000-4000-8000-000000000008');
update public.profiles set is_restricted=true,restricted_until=now()+interval '1 day' where id in
 ('a1000000-0000-4000-8000-000000000006','a1000000-0000-4000-8000-000000000008');
update public.profiles set onboarding_completed_at=null where id='a1000000-0000-4000-8000-000000000007';
insert into public.artists(id,slug,name,grade,status) values
 ('a2000000-0000-4000-8000-000000000001','calendar-security-active','가상 공개 가수','B','active'),
 ('a2000000-0000-4000-8000-000000000002','calendar-security-other','가상 다른 가수','B','active'),
 ('a2000000-0000-4000-8000-000000000003','calendar-security-paused','가상 중지 가수','B','paused'),
 ('a2000000-0000-4000-8000-000000000004','calendar-security-draft','가상 초안 가수','B','draft'),
 ('a2000000-0000-4000-8000-000000000005','calendar-security-retired','가상 은퇴 가수','B','retired');
insert into public.artist_members(artist_id,user_id,is_manager) values
 ('a2000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000003',true),
 ('a2000000-0000-4000-8000-000000000002','a1000000-0000-4000-8000-000000000004',false),
 ('a2000000-0000-4000-8000-000000000003','a1000000-0000-4000-8000-000000000003',true),
 ('a2000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000009',true);
insert into public.schedules(id,artist_id,type,title,starts_at,status,created_by) values
 ('a3000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000001','concert','공개 일정','2028-02-15 10:00+09','published','a1000000-0000-4000-8000-000000000005'),
 ('a3000000-0000-4000-8000-000000000002','a2000000-0000-4000-8000-000000000001','broadcast','비공개 초안','2028-02-16 10:00+09','draft','a1000000-0000-4000-8000-000000000005'),
 ('a3000000-0000-4000-8000-000000000003','a2000000-0000-4000-8000-000000000003','event','중지 가수 일정','2028-02-17 10:00+09','published','a1000000-0000-4000-8000-000000000005'),
 ('a3000000-0000-4000-8000-000000000004','a2000000-0000-4000-8000-000000000004','festival','초안 가수 일정','2028-02-18 10:00+09','published','a1000000-0000-4000-8000-000000000005'),
 ('a3000000-0000-4000-8000-000000000005','a2000000-0000-4000-8000-000000000005','event','은퇴 가수 일정','2028-02-19 10:00+09','published','a1000000-0000-4000-8000-000000000005');
insert into public.content_calendar(id,artist_id,date,topic,example_text,created_by) values
 ('a4000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000001','2028-02-15','소속 가수 기획','비공개 예문','a1000000-0000-4000-8000-000000000005'),
 ('a4000000-0000-4000-8000-000000000002','a2000000-0000-4000-8000-000000000002','2028-02-15','다른 가수 기획','다른 예문','a1000000-0000-4000-8000-000000000005'),
 ('a4000000-0000-4000-8000-000000000003','a2000000-0000-4000-8000-000000000003','2028-02-15','중지 가수 기획',null,'a1000000-0000-4000-8000-000000000005');
insert into public.schedule_notification_optouts(user_id,schedule_id) values
 ('a1000000-0000-4000-8000-000000000001','a3000000-0000-4000-8000-000000000001'),
 ('a1000000-0000-4000-8000-000000000002','a3000000-0000-4000-8000-000000000001');

select ok((select bool_and(relrowsecurity) from pg_class where oid in
 ('public.schedules'::regclass,'public.content_calendar'::regclass,
  'public.schedule_notification_optouts'::regclass,'public.calendar_audit_log'::regclass)),
 'all schedule/calendar base tables enable RLS');
select ok((select bool_and(not has_table_privilege(r,t,'INSERT,UPDATE,DELETE,TRUNCATE'))
 from unnest(array['anon','authenticated','service_role']) r cross join unnest(array[
 'public.schedules','public.content_calendar','public.schedule_notification_optouts','public.calendar_audit_log']) t),
 'all application roles must use identity-bound RPCs instead of direct mutations');
select ok((select bool_and(not has_table_privilege(r,'public.schedule_catalog','INSERT,UPDATE,DELETE,TRUNCATE'))
 from unnest(array['anon','authenticated','service_role']) r),
 'public event projection has no mutation grants regardless of view updatability');
select ok((select bool_and(not has_function_privilege(r,'private.calendar_actor_allowed(uuid,timestamptz)','EXECUTE'))
 from unnest(array['anon','authenticated','service_role']) r),
 'arbitrary-identity authorization helper is not exposed as a profile-state oracle');
select ok(not has_column_privilege('authenticated','public.schedules','created_by','SELECT'),
 'schedule creator identity is not part of client raw-table grants');
select ok(not has_column_privilege('authenticated','public.content_calendar','created_by','SELECT'),
 'calendar creator identity is not part of client raw-table grants');
select is((select string_agg(column_name::text,',' order by ordinal_position) from information_schema.columns
 where table_schema='public' and table_name='schedule_catalog') collate "C",
 'id,artist_id,artist_slug,artist_name,type,title,description,starts_at,ends_at,place_name,address,lat,lng,created_at,updated_at'::text collate "C",
 'public schedule projection explicitly excludes author, email and private artist fields');
select ok((select bool_and('search_path=""'=any(p.proconfig)) from pg_proc p
 join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
 and (p.proname like 'schedule\_%' escape '\' or p.proname like 'content_calendar\_%' escape '\')),
 'all public schedule/calendar RPCs pin an empty search_path');
select ok((select bool_and(not has_function_privilege('service_role',p.oid,'EXECUTE')) from pg_proc p
 join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
 and p.proname in ('schedule_create','schedule_update','schedule_delete','schedule_set_notification',
 'content_calendar_upsert','content_calendar_delete')),
 'service role cannot silently impersonate a user administrator or preference owner');
select ok((select bool_and(not has_function_privilege('anon',p.oid,'EXECUTE')) from pg_proc p
 join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
 and p.proname in ('schedule_create','schedule_update','schedule_delete','schedule_set_notification',
 'schedule_get_notification','content_calendar_list','content_calendar_upsert','content_calendar_delete')),
 'anonymous callers receive public event reads only');

set local role anon;
select is((select count(*) from public.schedule_catalog),1::bigint,'anonymous catalog excludes drafts and every inactive artist state');
select is((select artist_slug from public.schedule_get('a3000000-0000-4000-8000-000000000001')),
 'calendar-security-active','public detail carries canonical artist slug and UUID');
select is((select count(*) from public.schedule_list('2028-02-01')),1::bigint,'anonymous monthly list has the same public visibility boundary');
select throws_ok($$select id from public.schedules$$,'42501',null,'anonymous callers cannot inspect raw schedule rows');
select throws_ok($$select id from public.content_calendar$$,'42501',null,'anonymous callers cannot inspect private editorial calendar');
select throws_ok($$select * from public.calendar_audit_log$$,'42501',null,'anonymous callers cannot inspect administrator audit identities');
select throws_ok($$select public.schedule_set_notification('a3000000-0000-4000-8000-000000000001',false)$$,
 '42501',null,'anonymous optout is forbidden');
select throws_ok($$select public.schedule_get_notification('a3000000-0000-4000-8000-000000000001')$$,
 '42501',null,'anonymous preference lookup is forbidden');
select throws_ok($$select public.schedule_create('a2000000-0000-4000-8000-000000000001','concert','위조','2028-02-20 00:00Z')$$,
 '42501',null,'anonymous schedule creation is forbidden');
select throws_ok($$update public.schedule_catalog set title='위조'$$,'55000',null,'public catalog cannot be mutated');
select throws_ok($$select * from public.schedule_get('a3000000-0000-4000-8000-000000000002')$$,
 '42501','SCHEDULE_UNAVAILABLE','event draft is unavailable by guessed UUID');
select throws_ok($$select * from public.schedule_get('a3000000-0000-4000-8000-000000000003')$$,
 '42501','SCHEDULE_UNAVAILABLE','paused artist event is unavailable by guessed UUID');
select throws_ok($$select * from public.schedule_get('a3000000-0000-4000-8000-000000000099')$$,
 '42501','SCHEDULE_UNAVAILABLE','missing event uses the same unavailable response');
reset role;

select set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000001',true);
set local role authenticated;
select is((select count(id) from public.schedules),0::bigint,'ordinary fan cannot read raw administrator rows');
select is((select count(id) from public.content_calendar),0::bigint,'ordinary fan cannot read editorial topics');
select is((select count(*) from public.schedule_notification_optouts),1::bigint,'fan sees only own optout row');
select is((select count(*) from public.calendar_audit_log),0::bigint,'fan cannot enumerate audit records');
select throws_ok($$select created_by from public.schedules$$,'42501',null,'fan cannot select hidden author UUID');
select throws_ok($$select * from public.content_calendar_list('a2000000-0000-4000-8000-000000000001','2028-02-01')$$,
 '42501',null,'fan cannot call artist calendar API');
select throws_ok($$insert into public.schedule_notification_optouts(user_id,schedule_id) values
 ('a1000000-0000-4000-8000-000000000002','a3000000-0000-4000-8000-000000000001')$$,
 '42501',null,'caller cannot directly forge another identity optout');
select throws_ok($$update public.schedules set title='위조',status='published'$$,'42501',null,'caller cannot publish or edit through direct SQL');
select throws_ok($$delete from public.content_calendar$$,'42501',null,'caller cannot bypass calendar delete RPC');
select throws_ok($$insert into public.calendar_audit_log(actor_id,target_type,target_id,action)
 values(auth.uid(),'schedule','a3000000-0000-4000-8000-000000000001','delete')$$,
 '42501',null,'caller cannot manufacture administrator audit evidence');
select set_config('request.jwt.claims','{"role":"admin","user_role":"admin"}',true);
select throws_ok($$select public.schedule_create('a2000000-0000-4000-8000-000000000001','event','위조','2028-02-20 00:00Z')$$,
 '42501',null,'forged JWT role metadata cannot authorize schedule creation');
select throws_ok($$select public.schedule_update('a3000000-0000-4000-8000-000000000001','event','위조','2028-02-20 00:00Z')$$,
 '42501',null,'fan cannot update official schedule');
select throws_ok($$select public.schedule_delete('a3000000-0000-4000-8000-000000000001')$$,
 '42501',null,'fan cannot delete official schedule');
select throws_ok($$select public.content_calendar_upsert('a2000000-0000-4000-8000-000000000001','2028-02-20','위조')$$,
 '42501',null,'fan cannot author editorial calendar');
select throws_ok($$select public.content_calendar_delete('a4000000-0000-4000-8000-000000000001')$$,
 '42501',null,'fan cannot delete editorial calendar');
select throws_ok($$select public.schedule_set_notification('a3000000-0000-4000-8000-000000000002',false)$$,
 '42501',null,'draft cannot receive an optout');
select throws_ok($$select public.schedule_set_notification('a3000000-0000-4000-8000-000000000003',false)$$,
 '42501',null,'inactive artist event cannot receive an optout');
select throws_ok($$select public.schedule_set_notification('a3000000-0000-4000-8000-000000000099',false)$$,
 '42501',null,'missing event cannot create orphan preference');

select set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000003',true);
select is((select count(id) from public.content_calendar),1::bigint,'artist manager sees only affiliated active calendar');
select is((select topic from public.content_calendar_list('a2000000-0000-4000-8000-000000000001','2028-02-01')),
 '소속 가수 기획','affiliated artist may read private topic and example');
select throws_ok($$select created_by from public.content_calendar$$,'42501',null,'artist calendar read does not disclose private author identity');
select throws_ok($$select * from public.content_calendar_list('a2000000-0000-4000-8000-000000000002','2028-02-01')$$,
 '42501',null,'artist cannot inspect another artist calendar');
select throws_ok($$select * from public.content_calendar_list('a2000000-0000-4000-8000-000000000003','2028-02-01')$$,
 '42501',null,'membership cannot expose inactive artist calendar');
select throws_ok($$select public.content_calendar_upsert('a2000000-0000-4000-8000-000000000001','2028-02-20','위조')$$,
 '42501',null,'manager membership is not editorial write permission');
select throws_ok($$select public.content_calendar_delete('a4000000-0000-4000-8000-000000000001')$$,
 '42501',null,'manager cannot delete own artist editorial calendar');
select throws_ok($$select public.schedule_update('a3000000-0000-4000-8000-000000000001','event','위조','2028-02-20 00:00Z')$$,
 '42501',null,'artist cannot edit official events even for affiliated artist');
select is((select count(*) from public.profiles where id='a1000000-0000-4000-8000-000000000001'),0::bigint,
 'calendar membership does not expose fan phone or email');

select set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000004',true);
select is((select count(id) from public.content_calendar),1::bigint,'nonmanager artist can read own editorial calendar');
select is((select topic from public.content_calendar_list('a2000000-0000-4000-8000-000000000002','2028-02-01')),
 '다른 가수 기획','artist reader does not require manager bit');
select set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000009',true);
select is((select count(id) from public.content_calendar),0::bigint,'stale membership without artist profile role grants no access');
select throws_ok($$select * from public.content_calendar_list('a2000000-0000-4000-8000-000000000001','2028-02-01')$$,
 '42501',null,'fan role with forged membership cannot call artist calendar API');

select set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000006',true);
select is((select count(*) from public.schedule_catalog),1::bigint,'restriction does not make public event metadata confidential');
select throws_ok($$select public.schedule_set_notification('a3000000-0000-4000-8000-000000000001',false)$$,
 '42501',null,'restricted identity cannot mutate preferences');
select throws_ok($$select public.schedule_get_notification('a3000000-0000-4000-8000-000000000001')$$,
 '42501',null,'restricted identity cannot read private preferences');
select set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000007',true);
select throws_ok($$select public.schedule_set_notification('a3000000-0000-4000-8000-000000000001',false)$$,
 '42501',null,'fan must finish onboarding before storing preference');
select set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000008',true);
select is((select count(id) from public.schedules),0::bigint,'restricted administrator loses raw schedule access');
select is((select count(id) from public.content_calendar),0::bigint,'restricted administrator loses private calendar access');
select throws_ok($$select public.schedule_create('a2000000-0000-4000-8000-000000000001','event','위조','2028-02-20 00:00Z')$$,
 '42501',null,'restricted administrator cannot author official schedule');
select throws_ok($$select public.content_calendar_upsert('a2000000-0000-4000-8000-000000000001','2028-02-20','위조')$$,
 '42501',null,'restricted administrator cannot author editorial calendar');

select set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000005',true);
select is((select count(id) from public.schedules),5::bigint,'active administrator can manage raw drafts and inactive artist events');
select is((select count(id) from public.content_calendar),3::bigint,'administrator can read all editorial calendars');
select is((select count(*) from public.content_calendar_list('a2000000-0000-4000-8000-000000000003','2028-02-01')),1::bigint,
 'administrator may inspect an inactive artist calendar');
select is((select count(*) from public.schedule_catalog),1::bigint,'public projection stays public even for administrator');
select throws_ok($$select * from public.schedule_get('a3000000-0000-4000-8000-000000000002')$$,
 '42501','SCHEDULE_UNAVAILABLE','public detail API does not become a draft leak for administrator caller');
select throws_ok($$select created_by from public.schedules$$,'42501',null,'client administrator uses audit instead of private creator column');
select throws_ok($$update public.schedules set status='published'$$,'42501',null,'administrator direct update cannot bypass auditing');
select throws_ok($$delete from public.calendar_audit_log$$,'42501',null,'administrator cannot erase audit records');
reset role;
set local role service_role;
select throws_ok($$select public.schedule_delete('a3000000-0000-4000-8000-000000000001')$$,
 '42501',null,'service role bypassrls does not grant user-admin mutation RPC');
select throws_ok($$insert into public.schedule_notification_optouts(user_id,schedule_id) values
 ('a1000000-0000-4000-8000-000000000003','a3000000-0000-4000-8000-000000000001')$$,
 '42501',null,'service role cannot bypass preference identity boundary through direct insert');
reset role;
select set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000099',true);
set local role authenticated;
select throws_ok($$select public.schedule_set_notification('a3000000-0000-4000-8000-000000000001',false)$$,
 '42501',null,'authenticated JWT without live profile cannot store preference');
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claims','{}',true);
select throws_ok($$select public.content_calendar_upsert('a2000000-0000-4000-8000-000000000001','2028-02-20','위조')$$,
 '42501',null,'authenticated database role alone does not supply administrator identity');
reset role;
select * from finish();
rollback;
