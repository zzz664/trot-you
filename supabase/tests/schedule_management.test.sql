begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
set local timezone='UTC';
select no_plan();

select ok((select relrowsecurity from pg_class where oid='private.schedule_admin_operations'::regclass),'operation receipts enable RLS');
select ok((select bool_and(not has_table_privilege(r,'private.schedule_admin_operations','SELECT,INSERT,UPDATE,DELETE,TRUNCATE'))
 from unnest(array['anon','authenticated','service_role'])r),'API roles cannot read or mutate operation receipts');
select ok((select bool_and(prosecdef and 'search_path=""'=any(proconfig)) from pg_proc where pronamespace='public'::regnamespace
 and proname in('schedule_admin_get','schedule_admin_list','schedule_admin_save','schedule_admin_delete','schedule_my_artists')),'new public RPCs pin definer search paths');
select ok((select bool_and(has_function_privilege('authenticated',oid,'EXECUTE') and not has_function_privilege('anon',oid,'EXECUTE')
 and not has_function_privilege('service_role',oid,'EXECUTE')) from pg_proc where pronamespace='public'::regnamespace
 and proname in('schedule_admin_get','schedule_admin_list','schedule_admin_save','schedule_admin_delete','schedule_my_artists')),'new RPCs require authenticated actor, never service impersonation');
select ok((select bool_and(not has_function_privilege(r,oid,'EXECUTE')) from pg_proc cross join unnest(array['anon','authenticated','service_role'])r
 where pronamespace='private'::regnamespace and proname in('schedule_revision','schedule_operation_immutable','schedule_ui_actor','schedule_admin_projection','schedule_parse_input')),'new private helpers cannot be called by API roles');

insert into auth.users(id,email,raw_user_meta_data)
select ('af100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'schedule-management-'||n||'@example.invalid','{}'::jsonb from generate_series(1,6)n;
update public.profiles set call_name='가상일정팬',onboarding_completed_at=clock_timestamp() where id::text like 'af100000-%';
update public.profiles set role='admin' where id in('af100000-0000-4000-8000-000000000001','af100000-0000-4000-8000-000000000002');
update public.profiles set role='artist' where id='af100000-0000-4000-8000-000000000004';
update public.profiles set role='admin',is_restricted=true where id='af100000-0000-4000-8000-000000000005';
update public.profiles set onboarding_completed_at=null where id='af100000-0000-4000-8000-000000000006';
insert into public.artists(id,slug,name,grade,status)
select ('af200000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'schedule-management-'||n,'Fictional schedule artist '||n,'B',
 case when n=6 then 'paused'::public.artist_status else 'active'::public.artist_status end from generate_series(1,6)n;
create temporary table schedule_context(key text primary key,data jsonb);
grant all on schedule_context to authenticated;
create function pg_temp.input(p_patch jsonb default '{}') returns jsonb language sql as $$
 select '{"artist_id":"af200000-0000-4000-8000-000000000001","type":"concert","status":"draft","title":"Fictional concert","description":null,"starts_at":"2028-02-10T10:00:00+09:00","ends_at":null,"place_name":null,"address":null,"lat":null,"lng":null}'::jsonb||p_patch $$;
create function pg_temp.save(p_patch jsonb default '{}',p_id uuid default null,p_revision bigint default null,p_operation uuid default gen_random_uuid(),p_confirmed boolean default true)
returns jsonb language sql as $$select public.schedule_admin_save(p_operation,p_id,p_revision,pg_temp.input(p_patch),p_confirmed)$$;

set local role anon;
select throws_ok($$select public.schedule_admin_list('2028-02-01')$$,'42501',null,'anonymous admin read denied');
select throws_ok($$select public.schedule_my_artists()$$,'42501',null,'anonymous personal artist filter denied');
reset role;
set local role service_role;
select throws_ok($$select public.schedule_admin_list('2028-02-01')$$,'42501',null,'service role admin read denied');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','af100000-0000-4000-8000-000000000003',true);
select throws_ok($$select public.schedule_admin_list('2028-02-01')$$,'42501','CALENDAR_FORBIDDEN','fan cannot list drafts');
select throws_ok($$select pg_temp.save()$$,'42501','CALENDAR_FORBIDDEN','fan cannot create schedule');
select throws_ok($$select public.schedule_admin_get(gen_random_uuid())$$,'42501','CALENDAR_FORBIDDEN','fan cannot read guessed draft');
select throws_ok($$select public.schedule_admin_delete(gen_random_uuid(),gen_random_uuid(),1,true)$$,'42501','CALENDAR_FORBIDDEN','fan cannot delete guessed schedule');
select set_config('request.jwt.claims','{"role":"admin"}',true);
select throws_ok($$select pg_temp.save()$$,'42501','CALENDAR_FORBIDDEN','forged metadata cannot grant admin');
select set_config('request.jwt.claim.sub','af100000-0000-4000-8000-000000000004',true);
select throws_ok($$select pg_temp.save()$$,'42501','CALENDAR_FORBIDDEN','artist cannot edit official schedules');
select set_config('request.jwt.claim.sub','af100000-0000-4000-8000-000000000005',true);
select throws_ok($$select public.schedule_admin_list('2028-02-01')$$,'42501','CALENDAR_FORBIDDEN','restricted admin cannot read drafts');
select throws_ok($$select public.schedule_my_artists()$$,'42501','CALENDAR_FORBIDDEN','restricted profile cannot read personal filter');
select set_config('request.jwt.claim.sub','af100000-0000-4000-8000-000000000006',true);
select throws_ok($$select public.schedule_my_artists()$$,'42501','CALENDAR_FORBIDDEN','incomplete onboarding cannot read personal filter');
select set_config('request.jwt.claim.sub','af100000-0000-4000-8000-000000000001',true);
select is(public.schedule_admin_list('2028-02-01')->'items','[]'::jsonb,'empty month has honest empty items');
select is(public.schedule_admin_list('2028-02-01')->>'page_size','30','technical pagination is bounded');
select throws_ok($$select public.schedule_admin_list('2028-02-02')$$,'22023','CALENDAR_INVALID_MONTH','month requires KST first day');
select throws_ok($$select public.schedule_admin_list('2028-02-01',0)$$,'22023','SCHEDULE_INVALID_INPUT','zero page denied');
select throws_ok($$select public.schedule_admin_list('2028-02-01',1001)$$,'22023','SCHEDULE_INVALID_INPUT','unbounded page denied');
select throws_ok($$select public.schedule_admin_list('2028-02-01',null)$$,'22023','SCHEDULE_INVALID_INPUT','null page denied');
select throws_ok($$select pg_temp.save('{"status":"published"}',p_confirmed=>false)$$,'22023','SCHEDULE_CONFIRMATION_REQUIRED','save requires confirmation');
select throws_ok($$select pg_temp.save('{"status":"published"}',p_confirmed=>null)$$,'22023','SCHEDULE_CONFIRMATION_REQUIRED','null save confirmation denied');
select throws_ok($$select pg_temp.save(p_operation=>null)$$,'22023','SCHEDULE_INVALID_INPUT','operation key required');
select throws_ok($$select pg_temp.save(p_revision=>1)$$,'22023','SCHEDULE_INVALID_INPUT','create cannot provide existing revision');
select throws_ok($$select pg_temp.save(p_id=>gen_random_uuid())$$,'22023','SCHEDULE_INVALID_INPUT','update requires expected revision');
select throws_ok($$select pg_temp.save(p_id=>gen_random_uuid(),p_revision=>0)$$,'22023','SCHEDULE_INVALID_INPUT','zero revision denied');
select throws_ok($$select pg_temp.save(p_id=>gen_random_uuid(),p_revision=>9007199254740991)$$,'22023','SCHEDULE_INVALID_INPUT','revision overflow denied');
select throws_ok(format('select public.schedule_admin_save(gen_random_uuid(),null,null,%L::jsonb,true)',bad),'22023','SCHEDULE_INVALID_INPUT','invalid payload rejected: '||label)
from (values ('[]','array'),('null','json null'),('{}','empty'))v(bad,label);
select throws_ok(format('select pg_temp.save(%L::jsonb)',patch),'22023','SCHEDULE_INVALID_INPUT','invalid field rejected: '||label)
from (values
 ('{"author":"private"}','unknown key'),('{"artist_id":null}','null artist'),('{"artist_id":"not-uuid"}','malformed artist'),
 ('{"type":"invalid"}','unknown type'),('{"status":"invalid"}','unknown status'),('{"title":false}','wrong title type'),
 ('{"title":"   "}','whitespace title'),('{"description":3}','numeric description'),
 ('{"starts_at":"2028-02-10T10:00:00"}','timezone missing'),('{"starts_at":"2028-02-30T10:00:00Z"}','invalid day'),
 ('{"starts_at":"infinity"}','infinity start'),('{"starts_at":"0000-01-01T00:00:00Z"}','year zero'),
 ('{"ends_at":"2028-02-10T00:00:00Z"}','end before start'),('{"ends_at":true}','boolean end'),
 ('{"place_name":" "}','empty place'),('{"address":" "}','empty address'),
 ('{"lat":1}','unpaired coordinate'),('{"lng":1}','unpaired longitude'),('{"lat":"1","lng":1}','numeric string'),
 ('{"lat":91,"lng":1}','latitude range'),('{"lat":1,"lng":181}','longitude range'))v(patch,label);
select throws_ok($$select pg_temp.save(jsonb_build_object('title',repeat('x',1001)))$$,'22023','SCHEDULE_INVALID_INPUT','title storage bound');
select throws_ok($$select pg_temp.save(jsonb_build_object('description',repeat('x',100001)))$$,'22023','SCHEDULE_INVALID_INPUT','description storage bound');
select throws_ok($$select pg_temp.save(jsonb_build_object('place_name',repeat('x',2001)))$$,'22023','SCHEDULE_INVALID_INPUT','place storage bound');
select throws_ok($$select pg_temp.save(jsonb_build_object('address',repeat('x',2001)))$$,'22023','SCHEDULE_INVALID_INPUT','address storage bound');
insert into schedule_context values('first',pg_temp.save(p_operation=>'af600000-0000-4000-8000-000000000001',p_confirmed=>false));
select is((select data->>'revision' from schedule_context where key='first'),'1','created event starts revision one');
select ok(not (select data from schedule_context where key='first') ?| array['created_by','actor_id','email','phone'],'admin event excludes personal identities');
select is((select data->>'artist_status' from schedule_context where key='first'),'active','admin sees operational artist status');
select is(pg_temp.save(p_operation=>'af600000-0000-4000-8000-000000000001'),(select data from schedule_context where key='first'),'same create operation replays identical response');
select is(jsonb_array_length(public.schedule_admin_list('2028-02-01')->'items'),1,'create replay does not duplicate event');
select throws_ok($$select pg_temp.save('{"title":"changed"}',p_operation=>'af600000-0000-4000-8000-000000000001')$$,'23505','SCHEDULE_OPERATION_CONFLICT','same operation cannot be reused with different input');
select is((select count(*) from public.schedule_list('2028-02-01')),0::bigint,'draft stays out of public catalog');
insert into schedule_context values('updated',pg_temp.save('{"status":"published","lat":37.5665,"lng":126.978,"place_name":"Public venue","address":"Public address"}',
 (select (data->>'id')::uuid from schedule_context where key='first'),1,'af600000-0000-4000-8000-000000000002'));
select is((select data->>'revision' from schedule_context where key='updated'),'2','save increments revision');
select is((select count(*) from public.schedule_list('2028-02-01')),1::bigint,'published active artist schedule visible');
select is(public.schedule_admin_get((select (data->>'id')::uuid from schedule_context where key='first')),(select data from schedule_context where key='updated'),'detail returns current event');
select throws_ok($$select pg_temp.save(p_id=>(select (data->>'id')::uuid from schedule_context where key='first'),p_revision=>1)$$,'40001','SCHEDULE_REVISION_CONFLICT','stale edit cannot overwrite');
select throws_ok($$select pg_temp.save('{"artist_id":"af200000-0000-4000-8000-000000000002"}',(select (data->>'id')::uuid from schedule_context where key='first'),2)$$,'22023','SCHEDULE_INVALID_INPUT','event artist identity immutable');
select throws_ok($$select public.schedule_admin_delete(gen_random_uuid(),(select (data->>'id')::uuid from schedule_context where key='first'),1,true)$$,'40001','SCHEDULE_REVISION_CONFLICT','stale delete rejected');
select throws_ok($$select public.schedule_admin_delete(gen_random_uuid(),(select (data->>'id')::uuid from schedule_context where key='first'),2,false)$$,'22023','SCHEDULE_CONFIRMATION_REQUIRED','delete requires confirmation');
select lives_ok($$select public.schedule_update((select (data->>'id')::uuid from schedule_context where key='first'),'concert','Legacy updated','2028-02-10T10:00:00+09:00')$$,'legacy admin update preserved');
select is(public.schedule_admin_get((select (data->>'id')::uuid from schedule_context where key='first'))->>'revision','3','legacy update invalidates new CAS');
select throws_ok($$select pg_temp.save(p_id=>(select (data->>'id')::uuid from schedule_context where key='first'),p_revision=>2)$$,'40001','SCHEDULE_REVISION_CONFLICT','stale editor cannot erase legacy change');
insert into schedule_context values('deleted',public.schedule_admin_delete('af600000-0000-4000-8000-000000000003',(select (data->>'id')::uuid from schedule_context where key='first'),3,true));
select is((select data->>'deleted' from schedule_context where key='deleted'),'true','delete returns explicit result');
select is(public.schedule_admin_delete('af600000-0000-4000-8000-000000000003',(select (data->>'id')::uuid from schedule_context where key='first'),3,true),
 (select data from schedule_context where key='deleted'),'delete replay succeeds without resurrecting event');
select throws_ok($$select public.schedule_admin_get((select (data->>'id')::uuid from schedule_context where key='first'))$$,'42501','SCHEDULE_UNAVAILABLE','deleted detail unavailable');
select throws_ok($$select public.schedule_admin_delete(gen_random_uuid(),(select (data->>'id')::uuid from schedule_context where key='first'),3,true)$$,'42501','SCHEDULE_UNAVAILABLE','new operation cannot delete missing row');
select is((select count(*) from public.calendar_audit_log where target_type='schedule'),4::bigint,'one audit per actual create, two updates, delete; none for replay or rejection');
reset role;
select is((select count(*) from private.schedule_admin_operations),3::bigint,'successful new operations only are retained');
select throws_ok($$update private.schedule_admin_operations set response='{}'$$,'55000','SCHEDULE_OPERATION_IMMUTABLE','even privileged update cannot rewrite receipt');
select throws_ok($$delete from private.schedule_admin_operations$$,'55000','SCHEDULE_OPERATION_IMMUTABLE','even privileged delete cannot erase receipt');
select throws_ok($$truncate private.schedule_admin_operations$$,'55000','SCHEDULE_OPERATION_IMMUTABLE','truncate cannot bypass immutable receipt');
update public.profiles set role='fan' where id='af100000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub','af100000-0000-4000-8000-000000000001',true);
select throws_ok($$select pg_temp.save(p_operation=>'af600000-0000-4000-8000-000000000001')$$,'42501','CALENDAR_FORBIDDEN','revoked administrator cannot replay retained response');
reset role;

-- Month overlap, deterministic pagination and hidden artist rows for admin only.
insert into public.schedules(id,artist_id,type,title,starts_at,ends_at,status,created_by)
select ('af300000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'af200000-0000-4000-8000-000000000006','event','Page fixture '||n,
 '2028-01-31T23:00:00+09:00','2028-02-01T01:00:00+09:00','published','af100000-0000-4000-8000-000000000002' from generate_series(1,31)n;
insert into public.schedules(artist_id,type,title,starts_at,ends_at,status,created_by) values
 ('af200000-0000-4000-8000-000000000001','event','Ends at boundary','2028-01-31T23:00:00+09:00','2028-02-01T00:00:00+09:00','published','af100000-0000-4000-8000-000000000002'),
 ('af200000-0000-4000-8000-000000000001','event','Next month','2028-03-01T00:00:00+09:00',null,'published','af100000-0000-4000-8000-000000000002');
set local role authenticated;
select set_config('request.jwt.claim.sub','af100000-0000-4000-8000-000000000002',true);
select is(jsonb_array_length(public.schedule_admin_list('2028-02-01')->'items'),30,'admin page bounded at thirty');
select is(public.schedule_admin_list('2028-02-01')->>'has_more','true','extra row indicates next page');
select is(public.schedule_admin_list('2028-02-01')->'items'->0->>'id','af300000-0000-4000-8000-000000000001','ties ordered by UUID');
select is(jsonb_array_length(public.schedule_admin_list('2028-02-01',2)->'items'),1,'next page contains remaining overlap');
select is(public.schedule_admin_list('2028-02-01',2)->>'has_more','false','last page does not advertise more');
select is(public.schedule_admin_list('2028-02-01',2)->'items'->0->>'id','af300000-0000-4000-8000-000000000031','page boundary has no duplication');
select is((select count(*) from public.schedule_list('2028-02-01')),0::bigint,'public scope excludes paused artist and nonoverlapping boundaries');
reset role;

insert into public.subscriptions(user_id,artist_id,provider,status,current_period_start,current_period_end,grace_started_at,grace_ends_at,canceled_at,created_at)
select 'af100000-0000-4000-8000-000000000003',('af200000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'toss',
 case n when 1 then 'active'::public.subscription_status when 2 then 'grace'::public.subscription_status when 3 then 'canceled'::public.subscription_status
 when 4 then 'expired'::public.subscription_status when 5 then 'pending'::public.subscription_status else 'active'::public.subscription_status end,
 now()-interval '1 day',now()+interval '1 day',case when n=2 then now()-interval '1 hour' end,case when n=2 then now()+interval '1 hour' end,
 case when n=3 then now()-interval '1 hour' end,now()-interval '2 days' from generate_series(1,6)n;
set local role authenticated;
select set_config('request.jwt.claim.sub','af100000-0000-4000-8000-000000000003',true);
select is(public.schedule_my_artists(),array['af200000-0000-4000-8000-000000000001','af200000-0000-4000-8000-000000000002','af200000-0000-4000-8000-000000000003']::uuid[],
 'my artists contains active access, grace, and paid-through cancellation only, excluding paused artists');
select set_config('request.jwt.claim.sub','af100000-0000-4000-8000-000000000002',true);
select is(public.schedule_my_artists(),'{}'::uuid[],'no subscriptions returns empty not another user artists');
reset role;
update public.subscriptions set current_period_end=now() where artist_id='af200000-0000-4000-8000-000000000003';
set local role authenticated;
select set_config('request.jwt.claim.sub','af100000-0000-4000-8000-000000000003',true);
select is(cardinality(public.schedule_my_artists()),2,'paid-through expiry is reevaluated each read');
reset role;
select * from finish();
rollback;
