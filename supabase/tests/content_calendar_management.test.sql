begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
set local timezone='UTC';
select no_plan();

select ok((select relrowsecurity from pg_class where oid='private.content_calendar_operations'::regclass),'content operation receipts enable RLS');
select ok((select bool_and(not has_table_privilege(r,'private.content_calendar_operations','SELECT,INSERT,UPDATE,DELETE,TRUNCATE'))
 from unnest(array['anon','authenticated','service_role'])r),'API roles cannot inspect or change content receipts');
select ok((select count(*)=4 and bool_and(prosecdef and 'search_path=""'=any(proconfig)) from pg_proc where pronamespace='public'::regnamespace
 and proname in('content_calendar_artist_context','content_calendar_admin_list','content_calendar_admin_save','content_calendar_admin_delete')),'four content RPCs pin owner-rights search paths');
select ok((select bool_and(has_function_privilege('authenticated',oid,'EXECUTE') and not has_function_privilege('anon',oid,'EXECUTE')
 and not has_function_privilege('service_role',oid,'EXECUTE')) from pg_proc where pronamespace='public'::regnamespace
 and proname in('content_calendar_artist_context','content_calendar_admin_list','content_calendar_admin_save','content_calendar_admin_delete')),'new RPCs never permit anon or service impersonation');
select ok((select bool_and(not has_function_privilege(r,oid,'EXECUTE')) from pg_proc cross join unnest(array['anon','authenticated','service_role'])r
 where pronamespace='private'::regnamespace and proname in('content_calendar_revision','content_calendar_operation_immutable',
 'content_calendar_projection','content_calendar_month_entries','content_calendar_parse_input')),'private content helpers are not API RPCs');
select ok(not has_column_privilege('authenticated','public.content_calendar','revision','SELECT'),'CAS metadata requires authenticated safe projection');
select is((select count(*) from private.settlement_policies),0::bigint,'no contract target is invented by calendar migration');
select is((select count(*) from public.content_calendar),0::bigint,'migration creates no editorial content');

insert into auth.users(id,email,raw_user_meta_data)
select ('b1100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'content-calendar-'||n||'@example.invalid','{}'::jsonb from generate_series(1,7)n;
update public.profiles set call_name='가상계획팬',onboarding_completed_at=clock_timestamp() where id::text like 'b1100000-%';
update public.profiles set role='admin' where id in('b1100000-0000-4000-8000-000000000001','b1100000-0000-4000-8000-000000000002');
update public.profiles set role='artist' where id in('b1100000-0000-4000-8000-000000000004','b1100000-0000-4000-8000-000000000006');
update public.profiles set role='admin',is_restricted=true where id='b1100000-0000-4000-8000-000000000005';
update public.profiles set onboarding_completed_at=null where id='b1100000-0000-4000-8000-000000000006';
insert into public.artists(id,slug,name,grade,status)
select ('b1200000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'content-calendar-'||n,'Fictional editorial artist '||n,'B',
 case when n=3 then 'paused'::public.artist_status else 'active'::public.artist_status end from generate_series(1,3)n;
insert into public.artist_members(artist_id,user_id) values
 ('b1200000-0000-4000-8000-000000000001','b1100000-0000-4000-8000-000000000004'),
 ('b1200000-0000-4000-8000-000000000003','b1100000-0000-4000-8000-000000000004'),
 ('b1200000-0000-4000-8000-000000000001','b1100000-0000-4000-8000-000000000006'),
 ('b1200000-0000-4000-8000-000000000001','b1100000-0000-4000-8000-000000000007');
create temporary table content_context(key text primary key,data jsonb);
grant all on content_context to authenticated;
create function pg_temp.input(p_patch jsonb default '{}') returns jsonb language sql as $$
 select '{"artist_id":"b1200000-0000-4000-8000-000000000001","date":"2028-02-29","topic":"Fictional editorial topic","example_text":null}'::jsonb||p_patch $$;
create function pg_temp.save(p_patch jsonb default '{}',p_id uuid default null,p_revision bigint default null,p_operation uuid default gen_random_uuid())
returns jsonb language sql as $$select public.content_calendar_admin_save(p_operation,p_id,p_revision,pg_temp.input(p_patch))$$;

set local role anon;
select throws_ok($$select public.content_calendar_admin_list('b1200000-0000-4000-8000-000000000001','2028-02-01')$$,'42501',null,'anonymous admin read denied');
select throws_ok($$select public.content_calendar_artist_context('content-calendar-1','2028-02-01')$$,'42501',null,'anonymous artist read denied');
select throws_ok($$select pg_temp.save()$$,'42501',null,'anonymous writes denied');
reset role;
set local role service_role;
select throws_ok($$select public.content_calendar_admin_list('b1200000-0000-4000-8000-000000000001','2028-02-01')$$,'42501',null,'service role calendar read denied');
select throws_ok($$select pg_temp.save()$$,'42501',null,'service role cannot author editorial content');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','b1100000-0000-4000-8000-000000000003',true);
select throws_ok($$select pg_temp.save()$$,'42501','CALENDAR_FORBIDDEN','fan cannot write editorial content');
select throws_ok($$select public.content_calendar_admin_list('b1200000-0000-4000-8000-000000000001','2028-02-01')$$,'42501','CALENDAR_FORBIDDEN','fan cannot inspect admin calendar');
select throws_ok($$select public.content_calendar_artist_context('content-calendar-1','2028-02-01')$$,'42501','ARTIST_REPLY_FORBIDDEN','fan cannot inspect artist calendar');
select set_config('request.jwt.claims','{"role":"admin"}',true);
select throws_ok($$select pg_temp.save()$$,'42501','CALENDAR_FORBIDDEN','forged JWT metadata does not grant administrator role');
select set_config('request.jwt.claim.sub','b1100000-0000-4000-8000-000000000005',true);
select throws_ok($$select pg_temp.save()$$,'42501','CALENDAR_FORBIDDEN','restricted administrator write denied');
select throws_ok($$select public.content_calendar_admin_list('b1200000-0000-4000-8000-000000000001','2028-02-01')$$,'42501','CALENDAR_FORBIDDEN','restricted administrator read denied');
select set_config('request.jwt.claim.sub','b1100000-0000-4000-8000-000000000006',true);
select throws_ok($$select public.content_calendar_artist_context('content-calendar-1','2028-02-01')$$,'42501','ARTIST_REPLY_FORBIDDEN','artist onboarding must be complete');
select set_config('request.jwt.claim.sub','b1100000-0000-4000-8000-000000000007',true);
select throws_ok($$select public.content_calendar_artist_context('content-calendar-1','2028-02-01')$$,'42501','ARTIST_REPLY_FORBIDDEN','stale membership without artist role cannot grant read');
select set_config('request.jwt.claim.sub','b1100000-0000-4000-8000-000000000004',true);
select throws_ok($$select pg_temp.save()$$,'42501','CALENDAR_FORBIDDEN','artist member cannot write editorial content');
select throws_ok($$select public.content_calendar_admin_delete(gen_random_uuid(),gen_random_uuid(),1,true)$$,'42501','CALENDAR_FORBIDDEN','artist member cannot delete editorial content');
select throws_ok($$select public.content_calendar_artist_context('content-calendar-2','2028-02-01')$$,'42501','ARTIST_REPLY_FORBIDDEN','other artist editorial calendar is private');
select throws_ok($$select public.content_calendar_artist_context('content-calendar-3','2028-02-01')$$,'P0002','ARTIST_REPLY_NOT_FOUND','paused artist unavailable to artist member');
select throws_ok($$select public.content_calendar_artist_context('Content Calendar','2028-02-01')$$,'22023','ARTIST_REPLY_INVALID_INPUT','malformed artist slug denied');
select is(public.content_calendar_artist_context('content-calendar-1','2028-02-01')->'entries','[]'::jsonb,'artist sees honest empty editorial month');
select is(public.content_calendar_artist_context('content-calendar-1','2028-02-01')->'activity'->>'requirements_ready','false','unapproved contract comparison is explicitly unavailable');
select ok(not (public.content_calendar_artist_context('content-calendar-1','2028-02-01')->'artist') ? 'status','artist DTO has no operational status');
select set_config('request.jwt.claim.sub','b1100000-0000-4000-8000-000000000001',true);
select is(public.content_calendar_admin_list('b1200000-0000-4000-8000-000000000003','2028-02-01')->'artist'->>'status','paused','administrator can plan for paused artist');
select throws_ok($$select public.content_calendar_admin_list(gen_random_uuid(),'2028-02-01')$$,'42501','CALENDAR_ARTIST_UNAVAILABLE','unknown artist unavailable');
select throws_ok(format('select public.content_calendar_admin_list(%L,%L::date)','b1200000-0000-4000-8000-000000000001',month),'22023','CALENDAR_INVALID_MONTH','invalid month denied: '||coalesce(month,'null'))
 from (values(null::text),('2028-02-02'),('infinity'),('-infinity'),('0001-01-01 BC'),('10000-01-01'))v(month);
select lives_ok($$select public.content_calendar_admin_list('b1200000-0000-4000-8000-000000000001','0001-01-01')$$,'lowest four-digit month allowed');
select lives_ok($$select public.content_calendar_admin_list('b1200000-0000-4000-8000-000000000001','9999-12-01')$$,'highest four-digit month allowed');
select throws_ok($$select pg_temp.save(p_operation=>null)$$,'22023','CONTENT_CALENDAR_INVALID_INPUT','operation key required');
select throws_ok($$select pg_temp.save(p_revision=>1)$$,'22023','CONTENT_CALENDAR_INVALID_INPUT','create cannot claim a revision');
select throws_ok($$select pg_temp.save(p_id=>gen_random_uuid())$$,'22023','CONTENT_CALENDAR_INVALID_INPUT','update requires a loaded revision');
select throws_ok(format('select pg_temp.save(p_id=>gen_random_uuid(),p_revision=>%s)',revision),'22023','CONTENT_CALENDAR_INVALID_INPUT','invalid revision denied: '||revision)
 from (values(0::bigint),(-1::bigint),(9007199254740991::bigint))v(revision);
select throws_ok(format('select public.content_calendar_admin_save(gen_random_uuid(),null,null,%L::jsonb)',bad),'22023','CONTENT_CALENDAR_INVALID_INPUT','invalid payload denied: '||label)
 from (values('[]','array'),('null','JSON null'),('{}','empty'))v(bad,label);
select throws_ok(format('select pg_temp.save(%L::jsonb)',patch),'22023','CONTENT_CALENDAR_INVALID_INPUT','invalid input denied: '||label)
 from (values('{"created_by":"forged"}','author key'),('{"revision":2}','revision key'),('{"artist_id":null}','null artist'),('{"artist_id":"wrong"}','malformed artist'),
 ('{"date":null}','null date'),('{"date":"2028-02-30"}','nonexistent day'),('{"date":"2027-02-29"}','nonleap day'),
 ('{"date":"infinity"}','infinite date'),('{"date":"2028-2-01"}','unpadded date'),('{"date":"0000-01-01"}','year zero'),('{"date":"10000-01-01"}','five-digit year'),
 ('{"topic":null}','null topic'),('{"topic":false}','boolean topic'),('{"topic":"   "}','blank topic'),('{"topic":"one\ntwo"}','control in topic'),
 ('{"example_text":1}','numeric example'),('{"example_text":"bad\u0001text"}','control in example'))v(patch,label);
select throws_ok($$select pg_temp.save(jsonb_build_object('topic',repeat('x',1001)))$$,'22023','CONTENT_CALENDAR_INVALID_INPUT','topic storage maximum enforced');
select throws_ok($$select pg_temp.save(jsonb_build_object('example_text',repeat('x',100001)))$$,'22023','CONTENT_CALENDAR_INVALID_INPUT','example storage maximum enforced');
select throws_ok($$select pg_temp.save(jsonb_build_object('artist_id',gen_random_uuid()))$$,'42501','CALENDAR_ARTIST_UNAVAILABLE','unknown artist cannot receive a topic');
insert into content_context values('first',pg_temp.save(p_operation=>'b1600000-0000-4000-8000-000000000001'));
select is((select data->>'revision' from content_context where key='first'),'1','new editorial entry starts at revision one');
select ok(not (select data from content_context where key='first') ?| array['created_by','actor_id','email','phone'],'entry projection excludes private author/contact identity');
select is(pg_temp.save(p_operation=>'b1600000-0000-4000-8000-000000000001'),(select data from content_context where key='first'),'same operation replays exact accepted response');
select is((select count(*) from public.calendar_audit_log where target_type='content_calendar'),1::bigint,'create replay adds no audit');
select throws_ok($$select pg_temp.save('{"topic":"changed"}',p_operation=>'b1600000-0000-4000-8000-000000000001')$$,'23505','CONTENT_CALENDAR_OPERATION_CONFLICT','operation key cannot change payload');
select throws_ok($$select pg_temp.save()$$,'23505','CONTENT_CALENDAR_DATE_CONFLICT','new operation cannot silently overwrite occupied date');
insert into content_context values('noop',pg_temp.save(p_id=>(select (data->>'id')::uuid from content_context where key='first'),p_revision=>1));
select is((select data from content_context where key='noop'),(select data from content_context where key='first'),'no-op save preserves revision, timestamps and exact entry');
select is((select count(*) from public.calendar_audit_log where target_type='content_calendar'),1::bigint,'no-op edit creates no fake change audit');
insert into content_context values('updated',pg_temp.save('{"topic":"  Updated topic  ","example_text":"Line one\nLine two\tTab\rReturn"}',
 (select (data->>'id')::uuid from content_context where key='first'),1,'b1600000-0000-4000-8000-000000000002'));
select is((select data->>'topic' from content_context where key='updated'),'Updated topic','new topic trims surrounding whitespace');
select is((select data->>'revision' from content_context where key='updated'),'2','actual edit increments revision');
select is(pg_temp.save('{"topic":"  Updated topic  ","example_text":"Line one\nLine two\tTab\rReturn"}',
 (select (data->>'id')::uuid from content_context where key='first'),1,'b1600000-0000-4000-8000-000000000002'),
 (select data from content_context where key='updated'),'edit replay bypasses stale form only for exact accepted operation');
select throws_ok($$select pg_temp.save(p_id=>(select (data->>'id')::uuid from content_context where key='first'),p_revision=>1)$$,'40001','CONTENT_CALENDAR_REVISION_CONFLICT','stale edit cannot overwrite newer topic');
select throws_ok($$select pg_temp.save('{"date":"2028-02-28"}',(select (data->>'id')::uuid from content_context where key='first'),2)$$,'22023','CONTENT_CALENDAR_INVALID_INPUT','existing date identity is fixed');
select throws_ok($$select pg_temp.save('{"artist_id":"b1200000-0000-4000-8000-000000000002"}',(select (data->>'id')::uuid from content_context where key='first'),2)$$,'22023','CONTENT_CALENDAR_INVALID_INPUT','existing artist identity is fixed');
select throws_ok($$select pg_temp.save(p_id=>gen_random_uuid(),p_revision=>1)$$,'42501','CONTENT_CALENDAR_ENTRY_UNAVAILABLE','missing edit cannot create a replacement entry');
select is(public.content_calendar_admin_list('b1200000-0000-4000-8000-000000000001','2028-02-01')->'entries'->0,(select data from content_context where key='updated'),'month projects latest entry revision');
select is(public.content_calendar_admin_list('b1200000-0000-4000-8000-000000000001','2028-03-01')->'entries','[]'::jsonb,'next month excludes leap-day topic');
select lives_ok($$select public.content_calendar_upsert('b1200000-0000-4000-8000-000000000001','2028-02-29','Legacy edited topic',E'Legacy\ttext')$$,'legacy writer remains compatible');
select is(public.content_calendar_admin_list('b1200000-0000-4000-8000-000000000001','2028-02-01')->'entries'->0->>'revision','3','legacy edit invalidates new CAS');
select throws_ok($$select pg_temp.save(p_id=>(select (data->>'id')::uuid from content_context where key='first'),p_revision=>2)$$,'40001','CONTENT_CALENDAR_REVISION_CONFLICT','legacy change cannot be erased by stale new form');
select throws_ok($$select public.content_calendar_admin_delete(gen_random_uuid(),(select (data->>'id')::uuid from content_context where key='first'),2,true)$$,'40001','CONTENT_CALENDAR_REVISION_CONFLICT','stale deletion cannot erase new topic');
select throws_ok($$select public.content_calendar_admin_delete(gen_random_uuid(),(select (data->>'id')::uuid from content_context where key='first'),3,false)$$,'22023','CONTENT_CALENDAR_CONFIRMATION_REQUIRED','delete requires explicit confirmation');
select throws_ok($$select public.content_calendar_admin_delete(gen_random_uuid(),(select (data->>'id')::uuid from content_context where key='first'),3,null)$$,'22023','CONTENT_CALENDAR_CONFIRMATION_REQUIRED','null confirmation is not consent');
insert into content_context values('deleted',public.content_calendar_admin_delete('b1600000-0000-4000-8000-000000000003',(select (data->>'id')::uuid from content_context where key='first'),3,true));
select is((select data->>'deleted' from content_context where key='deleted'),'true','confirmed deletion has explicit result');
select is(public.content_calendar_admin_delete('b1600000-0000-4000-8000-000000000003',(select (data->>'id')::uuid from content_context where key='first'),3,true),
 (select data from content_context where key='deleted'),'delete replay works without resurrecting removed topic');
select throws_ok($$select public.content_calendar_admin_delete(gen_random_uuid(),(select (data->>'id')::uuid from content_context where key='first'),3,true)$$,'42501','CONTENT_CALENDAR_ENTRY_UNAVAILABLE','new delete cannot act on already removed row');
select is((select count(*) from public.calendar_audit_log where target_type='content_calendar'),4::bigint,'audit has only create, edit, legacy edit and deletion');
select is(public.content_calendar_admin_list('b1200000-0000-4000-8000-000000000001','2028-02-01')->'entries','[]'::jsonb,'removed entry disappears from month');
select is(pg_temp.save(p_operation=>'b1600000-0000-4000-8000-000000000001'),(select data from content_context where key='first'),'old create receipt does not recreate deleted content');
select is(public.content_calendar_admin_list('b1200000-0000-4000-8000-000000000001','2028-02-01')->'entries','[]'::jsonb,'replayed create does not resurrect row');
reset role;
select is((select count(*) from private.content_calendar_operations),4::bigint,'only accepted create, no-op, edit and delete receipts remain');
select throws_ok($$update private.content_calendar_operations set response='{}'$$,'55000','CONTENT_CALENDAR_OPERATION_IMMUTABLE','privileged update cannot alter immutable receipt');
select throws_ok($$delete from private.content_calendar_operations$$,'55000','CONTENT_CALENDAR_OPERATION_IMMUTABLE','privileged delete cannot erase receipt');
select throws_ok($$truncate private.content_calendar_operations$$,'55000','CONTENT_CALENDAR_OPERATION_IMMUTABLE','truncate cannot erase receipts');
update public.profiles set role='fan' where id='b1100000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub','b1100000-0000-4000-8000-000000000001',true);
select throws_ok($$select pg_temp.save(p_operation=>'b1600000-0000-4000-8000-000000000001')$$,'42501','CALENDAR_FORBIDDEN','revoked administrator cannot replay accepted data');
reset role;

-- Existing unusual-but-valid text is not rewritten or dropped on read.
insert into public.content_calendar(artist_id,date,topic,example_text,created_by)
select 'b1200000-0000-4000-8000-000000000001',date '2028-02-01'+n,E' Legacy\n topic ',E'Legacy\001example',
 'b1100000-0000-4000-8000-000000000002' from generate_series(0,28)n;
insert into public.content_calendar(artist_id,date,topic,created_by) values
 ('b1200000-0000-4000-8000-000000000001','2028-01-31','Prior boundary','b1100000-0000-4000-8000-000000000002'),
 ('b1200000-0000-4000-8000-000000000001','2028-03-01','Following boundary','b1100000-0000-4000-8000-000000000002'),
 ('b1200000-0000-4000-8000-000000000002','2028-02-01','Other artist','b1100000-0000-4000-8000-000000000002');
insert into public.messages(artist_id,author_id,type,body,status,scheduled_at,sent_at)
 values('b1200000-0000-4000-8000-000000000001','b1100000-0000-4000-8000-000000000004','text','Private source body','sent',clock_timestamp(),clock_timestamp());
set local role authenticated;
select set_config('request.jwt.claim.sub','b1100000-0000-4000-8000-000000000004',true);
insert into content_context values('artist',public.content_calendar_artist_context('content-calendar-1','2028-02-01'));
select is(jsonb_array_length((select data->'entries' from content_context where key='artist')),29,'artist month includes every leap-month date once');
select is((select data->'entries'->0->>'date' from content_context where key='artist'),'2028-02-01','month order starts with first date');
select is((select data->'entries'->28->>'date' from content_context where key='artist'),'2028-02-29','month order ends with leap date');
select is((select data->'entries'->0->>'topic' from content_context where key='artist'),E' Legacy\n topic ','legacy topic whitespace is preserved');
select is((select data->'entries'->0->>'example_text' from content_context where key='artist'),E'Legacy\001example','legacy valid example is preserved exactly');
select is((select data->'activity'->>'message_count' from content_context where key='artist'),'1','current-week source count is integrated independently of requested calendar month');
select is((select data->'activity'->>'photo_count' from content_context where key='artist'),'0','source photo count remains separate');
select ok(not (select data from content_context where key='artist') ?| array['replies','messages','policy','created_by','actor_id'],'calendar DTO includes no fan data or raw policy');
select is((select data->'activity'->'weekly_message_min' from content_context where key='artist'),'null'::jsonb,'missing approved minimum stays null');
reset role;
update public.profiles set is_restricted=true where id='b1100000-0000-4000-8000-000000000004';
set local role authenticated;
select set_config('request.jwt.claim.sub','b1100000-0000-4000-8000-000000000004',true);
select throws_ok($$select public.content_calendar_artist_context('content-calendar-1','2028-02-01')$$,'42501','ARTIST_REPLY_FORBIDDEN','later restriction revokes artist calendar read');
reset role;
select is((select count(*) from private.notification_jobs),0::bigint,'editorial writes do not enqueue notifications');
select is((select count(*) from public.schedules),0::bigint,'editorial writes do not create public event schedules');
select * from finish();
rollback;
