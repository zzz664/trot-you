begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

-- Fictional rollback-only editorial data. This suite never contacts a map,
-- notification channel, hosted database, real audience or calendar provider.
create temporary table calendar_test_context(key text primary key,id uuid);
grant all on calendar_test_context to authenticated,anon;
insert into auth.users(id,email,raw_user_meta_data)
select ('a5000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid,
 'calendar-lifecycle-' || n || '@example.invalid','{}'::jsonb from generate_series(1,5) n;
update public.profiles set call_name='가상 일정 사용자',onboarding_completed_at=now()
 where id::text like 'a5000000-%';
update public.profiles set role='admin' where id='a5000000-0000-4000-8000-000000000001';
update public.profiles set role='artist' where id='a5000000-0000-4000-8000-000000000004';
insert into public.artists(id,slug,name,grade,status) values
 ('a6000000-0000-4000-8000-000000000001','calendar-lifecycle-main','가상 일정 가수','B','active'),
 ('a6000000-0000-4000-8000-000000000002','calendar-lifecycle-boundaries','가상 시간 경계 가수','B','active'),
 ('a6000000-0000-4000-8000-000000000003','calendar-lifecycle-paused','가상 중지 가수','B','paused');
insert into public.artist_members(artist_id,user_id) values
 ('a6000000-0000-4000-8000-000000000001','a5000000-0000-4000-8000-000000000004');
select is((select count(*) from public.schedules),0::bigint,'migration and seed create no real or fictional schedules');
select is((select count(*) from public.content_calendar),0::bigint,'editorial calendar is not silently seeded');
select is((select count(*) from public.schedule_notification_optouts),0::bigint,'no user preference is seeded');
select is((select count(*) from public.calendar_audit_log),0::bigint,'migration does not invent administrator actions');

select set_config('request.jwt.claim.sub','a5000000-0000-4000-8000-000000000001',true);
set local role authenticated;
insert into calendar_test_context values('event',public.schedule_create(
 'a6000000-0000-4000-8000-000000000001','concert','가상 첫 공연','2028-02-10 19:00+09'));
select is((select status::text from public.schedules where id=(select id from calendar_test_context where key='event')),
 'draft','official event defaults to draft until administrator explicitly publishes');
select is((select count(*) from public.schedule_catalog),0::bigint,'new draft is not public');
select is((select count(*) from public.calendar_audit_log where target_type='schedule' and action='create'),1::bigint,
 'create records one administrator audit event');
select is((select actor_id from public.calendar_audit_log where target_type='schedule' and action='create'),auth.uid(),
 'audit actor comes from authenticated identity, not request author input');
select is(public.schedule_update((select id from calendar_test_context where key='event'),
 'festival','가상 봄 축제','2028-02-11 19:00+09','2028-02-11 21:00+09','안전한 가상 설명',
 '가상 공연장','가상 주소',37.5665,126.9780,'published'),
 (select id from calendar_test_context where key='event'),'schedule update preserves canonical UUID');
select is((select title from public.schedule_get((select id from calendar_test_context where key='event'))),
 '가상 봄 축제','published updated title is available through safe detail API');
select is((select type::text from public.schedule_get((select id from calendar_test_context where key='event'))),
 'festival','all documented event types can be persisted');
select is((select starts_at from public.schedule_get((select id from calendar_test_context where key='event'))),
 '2028-02-11 10:00+00'::timestamptz,'KST input is stored as an absolute timestamp');
select is((select lat from public.schedule_get((select id from calendar_test_context where key='event'))),
 37.5665::double precision,'finite map latitude is preserved without arbitrary URL storage');
select is((select lng from public.schedule_get((select id from calendar_test_context where key='event'))),
 126.9780::double precision,'finite map longitude is preserved');
select is((select before_data->>'title' from public.calendar_audit_log where target_type='schedule' and action='update'),
 '가상 첫 공연','schedule update audit retains previous title');
select is((select after_data->>'title' from public.calendar_audit_log where target_type='schedule' and action='update'),
 '가상 봄 축제','schedule update audit retains changed title');

-- Database structural validation is independent of UI/server form validation.
select throws_ok($$select public.schedule_create('a6000000-0000-4000-8000-000000000001','event','  ','2028-02-20 00:00Z')$$,
 null::text,null::text,'whitespace-only schedule title is rejected');
select throws_ok($$select public.schedule_create('a6000000-0000-4000-8000-000000000001','event',E'\t\n','2028-02-20 00:00Z')$$,
 null::text,null::text,'tab/newline-only title cannot bypass whitespace validation');
select throws_ok($$select public.schedule_create('a6000000-0000-4000-8000-000000000001','event',null,'2028-02-20 00:00Z')$$,
 null::text,null::text,'NULL schedule title is rejected');
select throws_ok($$select public.schedule_create('a6000000-0000-4000-8000-000000000001','event',repeat('x',1001),'2028-02-20 00:00Z')$$,
 null::text,null::text,'structural title safety ceiling cannot be exceeded');
select throws_ok($$select public.schedule_create('a6000000-0000-4000-8000-000000000001',null,'제목','2028-02-20 00:00Z')$$,
 null::text,null::text,'event type is required');
select throws_ok($$select public.schedule_create('a6000000-0000-4000-8000-000000000001','event','제목',null)$$,
 null::text,null::text,'event start is required');
select throws_ok($$select public.schedule_create('a6000000-0000-4000-8000-000000000001','event','제목','infinity')$$,
 null::text,null::text,'infinite event start is rejected');
select throws_ok($$select public.schedule_create('a6000000-0000-4000-8000-000000000001','event','제목','12000-01-01 00:00Z')$$,
 '23514',null,'event outside supported ISO year range is rejected');
select throws_ok($$select public.schedule_create('a6000000-0000-4000-8000-000000000001','event','제목','0001-01-01 00:00:00+00 BC')$$,
 '23514',null,'BC event start is rejected');
select throws_ok($$select public.schedule_create('a6000000-0000-4000-8000-000000000001','event','제목','-infinity')$$,
 null::text,null::text,'negative infinite event start is rejected');
select throws_ok($$select public.schedule_create('a6000000-0000-4000-8000-000000000001','event','제목','2028-02-20 00:00Z','infinity')$$,
 null::text,null::text,'infinite event end is rejected');
select throws_ok($$select public.schedule_create('a6000000-0000-4000-8000-000000000001','event','제목','2028-02-20 00:00Z','2028-02-20 00:00Z')$$,
 null::text,null::text,'zero-duration interval is rejected instead of silently becoming a point');
select throws_ok($$select public.schedule_create('a6000000-0000-4000-8000-000000000001','event','제목','2028-02-20 00:00Z','2028-02-19 23:59Z')$$,
 null::text,null::text,'reversed interval is rejected');
select throws_ok($$select public.schedule_create('a6000000-0000-4000-8000-000000000001','event','제목','2028-02-20 00:00Z',p_lat=>37.5)$$,
 null::text,null::text,'a single coordinate without its pair is rejected');
select throws_ok($$select public.schedule_create('a6000000-0000-4000-8000-000000000001','event','제목','2028-02-20 00:00Z',p_lng=>127.0)$$,
 null::text,null::text,'longitude alone is rejected');
select throws_ok($$select public.schedule_create('a6000000-0000-4000-8000-000000000001','event','제목','2028-02-20 00:00Z',p_lat=>90.1,p_lng=>127.0)$$,
 null::text,null::text,'out-of-range latitude is rejected');
select throws_ok($$select public.schedule_create('a6000000-0000-4000-8000-000000000001','event','제목','2028-02-20 00:00Z',p_lat=>37.5,p_lng=>-180.1)$$,
 null::text,null::text,'out-of-range longitude is rejected');
select throws_ok($$select public.schedule_create('a6000000-0000-4000-8000-000000000001','event','제목','2028-02-20 00:00Z',p_lat=>'NaN'::float8,p_lng=>127.0)$$,
 null::text,null::text,'NaN latitude is rejected');
select throws_ok($$select public.schedule_create('a6000000-0000-4000-8000-000000000001','event','제목','2028-02-20 00:00Z',p_lat=>37.5,p_lng=>'Infinity'::float8)$$,
 null::text,null::text,'infinite longitude is rejected');
select throws_ok($$select public.schedule_create('a6000000-0000-4000-8000-000000000001','event','제목','2028-02-20 00:00Z',p_place_name=>' ')$$,
 null::text,null::text,'blank present venue is rejected');
select throws_ok($$select public.schedule_create('a6000000-0000-4000-8000-000000000001','event','제목','2028-02-20 00:00Z',p_place_name=>E'\t\n')$$,
 null::text,null::text,'tab/newline-only venue cannot bypass whitespace validation');
select throws_ok($$select public.schedule_create('a6000000-0000-4000-8000-000000000001','event','제목','2028-02-20 00:00Z',p_address=>' ')$$,
 null::text,null::text,'blank present address is rejected');
select throws_ok($$select public.schedule_create('a6000000-0000-4000-8000-000000000099','event','제목','2028-02-20 00:00Z')$$,
 '42501',null,'nonexistent artist cannot receive an event');
select throws_ok($$select public.schedule_update('a7000000-0000-4000-8000-000000000099','event','제목','2028-02-20 00:00Z')$$,
 '42501',null,'missing update does not silently recreate an event');
select is((select count(id) from public.schedules),1::bigint,'rejected writes leave no partially created schedules');
select is((select count(*) from public.calendar_audit_log),2::bigint,'rejected writes leave no false successful audit entries');

-- Desired-state preference, not a race-prone toggle; no user_id argument.
select set_config('request.jwt.claim.sub','a5000000-0000-4000-8000-000000000002',true);
select is(public.schedule_get_notification((select id from calendar_test_context where key='event')),true,
 'absence of optout means per-event preference enabled, not proof of delivery');
select is(public.schedule_set_notification((select id from calendar_test_context where key='event'),false),false,
 'user can opt out of a public event');
select is(public.schedule_set_notification((select id from calendar_test_context where key='event'),false),false,
 'same desired-state optout is idempotent');
select is((select count(*) from public.schedule_notification_optouts),1::bigint,'duplicate optout stores exactly one row');
select is(public.schedule_get_notification((select id from calendar_test_context where key='event')),false,
 'preference getter reflects stored optout');
select throws_ok($$select public.schedule_set_notification((select id from calendar_test_context where key='event'),null)$$,
 null::text,null::text,'NULL desired preference cannot silently toggle');
select set_config('request.jwt.claim.sub','a5000000-0000-4000-8000-000000000003',true);
select is(public.schedule_get_notification((select id from calendar_test_context where key='event')),true,
 'another user does not inherit first user optout');
select is((select count(*) from public.schedule_notification_optouts),0::bigint,'another user cannot inspect optout owner');
select is(public.schedule_set_notification((select id from calendar_test_context where key='event'),false),false,
 'second identity stores independent optout');
select set_config('request.jwt.claim.sub','a5000000-0000-4000-8000-000000000002',true);
select is(public.schedule_set_notification((select id from calendar_test_context where key='event'),true),true,
 'explicit enable removes own optout');
select is(public.schedule_set_notification((select id from calendar_test_context where key='event'),true),true,
 'repeated enable remains enabled');
select is((select count(*) from public.schedule_notification_optouts),0::bigint,'enable removed own row only');
reset role;
select is((select count(*) from public.schedule_notification_optouts),1::bigint,'enabling one user never deletes another user optout');
delete from auth.users where id='a5000000-0000-4000-8000-000000000003';
select is((select count(*) from public.schedule_notification_optouts),0::bigint,'account deletion cascades its event optout');

-- Month fixtures isolate exact KST half-open boundaries and stable tie ordering.
insert into public.schedules(id,artist_id,type,title,starts_at,ends_at,status,created_by) values
 ('a7000000-0000-4000-8000-000000000001','a6000000-0000-4000-8000-000000000002','event','이전 월 끝','2028-01-31 14:00Z','2028-01-31 15:00Z','published','a5000000-0000-4000-8000-000000000001'),
 ('a7000000-0000-4000-8000-000000000002','a6000000-0000-4000-8000-000000000002','event','월 경계 진행 중','2028-01-31 14:00Z','2028-01-31 15:00:00.000001Z','published','a5000000-0000-4000-8000-000000000001'),
 ('a7000000-0000-4000-8000-000000000003','a6000000-0000-4000-8000-000000000002','event','월 시작','2028-01-31 15:00Z',null,'published','a5000000-0000-4000-8000-000000000001'),
 ('a7000000-0000-4000-8000-000000000004','a6000000-0000-4000-8000-000000000002','event','윤일 마지막','2028-02-29 14:59:59.999999Z',null,'published','a5000000-0000-4000-8000-000000000001'),
 ('a7000000-0000-4000-8000-000000000005','a6000000-0000-4000-8000-000000000002','event','다음 월 시작','2028-02-29 15:00Z',null,'published','a5000000-0000-4000-8000-000000000001'),
 ('a7000000-0000-4000-8000-000000000006','a6000000-0000-4000-8000-000000000002','event','동시 일정 A','2028-02-15 01:00Z',null,'published','a5000000-0000-4000-8000-000000000001'),
 ('a7000000-0000-4000-8000-000000000007','a6000000-0000-4000-8000-000000000002','event','동시 일정 B','2028-02-15 01:00Z',null,'published','a5000000-0000-4000-8000-000000000001'),
 ('a7000000-0000-4000-8000-000000000008','a6000000-0000-4000-8000-000000000002','event','이전 월 순간','2028-01-31 14:59:59.999999Z',null,'published','a5000000-0000-4000-8000-000000000001'),
 ('a7000000-0000-4000-8000-000000000009','a6000000-0000-4000-8000-000000000002','event','DST 세션 검증','2028-03-12 09:59:59Z',null,'published','a5000000-0000-4000-8000-000000000001');
set local role anon;
set local timezone='UTC';
select is((select count(*) from public.schedule_list('2028-02-01',array['a6000000-0000-4000-8000-000000000002']::uuid[])),5::bigint,
 'KST leap month includes overlapping and starting events, excludes exclusive endpoints');
select is((select string_agg(id::text,',') from public.schedule_list('2028-02-01',
 array['a6000000-0000-4000-8000-000000000002']::uuid[])),
 'a7000000-0000-4000-8000-000000000002,a7000000-0000-4000-8000-000000000003,a7000000-0000-4000-8000-000000000006,a7000000-0000-4000-8000-000000000007,a7000000-0000-4000-8000-000000000004',
 'list uses deterministic absolute start and UUID tie ordering');
select is((select count(*) from public.schedule_list('2028-02-01',array[]::uuid[])),0::bigint,
 'empty artist filter intentionally selects no artists');
select is((select count(*) from public.schedule_list('2028-02-01',array['a6000000-0000-4000-8000-000000000099']::uuid[])),0::bigint,
 'unmatched artist filter cannot broaden scope');
select is((select count(*) from public.schedule_list('2028-02-01',array['a6000000-0000-4000-8000-000000000002','a6000000-0000-4000-8000-000000000002']::uuid[])),5::bigint,
 'duplicate artist filter does not duplicate rows');
select is((select count(*) from public.schedule_list('2028-02-01',p_limit=>1)),1::bigint,'list enforces requested page size');
select is((select id from public.schedule_list('2028-02-01',array['a6000000-0000-4000-8000-000000000002']::uuid[],
 '2028-02-15 01:00Z','a7000000-0000-4000-8000-000000000006',1)),
 'a7000000-0000-4000-8000-000000000007'::uuid,'cursor resumes within same timestamp without skipping UUID tie');
select is((select count(*) from public.schedule_list('2028-02-01',array['a6000000-0000-4000-8000-000000000002']::uuid[],
 '2028-02-29 14:59:59.999999Z','a7000000-0000-4000-8000-000000000004')),0::bigint,'last cursor yields empty next page');
set local timezone='America/Los_Angeles';
select is((select count(*) from public.schedule_list('2028-02-01',array['a6000000-0000-4000-8000-000000000002']::uuid[])),5::bigint,
 'session zone cannot shift the KST month bounds');
select is((select count(*) from public.schedule_list('2028-03-01',array['a6000000-0000-4000-8000-000000000002']::uuid[])),2::bigint,
 'session DST transition does not change KST membership');
set local timezone='Asia/Seoul';
select is((select count(*) from public.schedule_list('2028-02-01',array['a6000000-0000-4000-8000-000000000002']::uuid[])),5::bigint,
 'native KST session matches UTC and DST-observing sessions');
select is((select count(*) from public.schedule_list('0001-01-01')),0::bigint,'first supported ISO month has finite usable bounds');
select is((select count(*) from public.schedule_list('9999-12-01')),0::bigint,'last supported ISO month computes finite next-year exclusive bound');
select throws_ok($$select * from public.schedule_list('12000-01-01')$$,'22023',null,'month outside supported year range is rejected');
select throws_ok($$select * from public.schedule_list('0001-01-01 BC')$$,'22023',null,'BC month is rejected');
select throws_ok($$select * from public.schedule_list('2028-02-01',array[
 ['a6000000-0000-4000-8000-000000000001','a6000000-0000-4000-8000-000000000002'],
 ['a6000000-0000-4000-8000-000000000001','a6000000-0000-4000-8000-000000000002']]::uuid[])$$,
 '22023',null,'multidimensional artist filter is rejected explicitly');
select throws_ok($$select * from public.schedule_list(null)$$,null::text,null::text,'month is required');
select throws_ok($$select * from public.schedule_list('infinity')$$,null::text,null::text,'infinite month is rejected');
select throws_ok($$select * from public.schedule_list('-infinity')$$,null::text,null::text,'negative infinite month is rejected');
select throws_ok($$select * from public.schedule_list('2028-02-02')$$,null::text,null::text,'month must be an unambiguous first-of-month date');
select throws_ok($$select * from public.schedule_list('2028-02-01',p_limit=>0)$$,null::text,null::text,'zero page size is rejected');
select throws_ok($$select * from public.schedule_list('2028-02-01',p_limit=>101)$$,null::text,null::text,'page size cannot exceed structural safety maximum');
select throws_ok($$select * from public.schedule_list('2028-02-01',p_limit=>null)$$,null::text,null::text,'NULL limit cannot remove bound');
select throws_ok($$select * from public.schedule_list('2028-02-01',p_after_starts_at=>'2028-02-15 01:00Z')$$,
 null::text,null::text,'timestamp-only cursor is rejected');
select throws_ok($$select * from public.schedule_list('2028-02-01',p_after_id=>'a7000000-0000-4000-8000-000000000006')$$,
 null::text,null::text,'UUID-only cursor is rejected');
select throws_ok($$select * from public.schedule_list('2028-02-01',p_after_starts_at=>'infinity',p_after_id=>'a7000000-0000-4000-8000-000000000006')$$,
 null::text,null::text,'infinite cursor timestamp is rejected');
reset role;

select set_config('request.jwt.claim.sub','a5000000-0000-4000-8000-000000000001',true);
set local role authenticated;
insert into calendar_test_context values('content',public.content_calendar_upsert(
 'a6000000-0000-4000-8000-000000000001','2028-02-29','윤일의 주제','첫 예문'));
select is(public.content_calendar_upsert('a6000000-0000-4000-8000-000000000001','2028-02-29','수정된 주제','수정 예문'),
 (select id from calendar_test_context where key='content'),'same artist/date upsert preserves unique editorial identity');
select is((select count(id) from public.content_calendar where artist_id='a6000000-0000-4000-8000-000000000001'),1::bigint,
 'calendar upsert does not duplicate artist/day');
select is((select topic from public.content_calendar_list('a6000000-0000-4000-8000-000000000001','2028-02-01')),
 '수정된 주제','calendar month read returns latest topic');
select is((select count(*) from public.content_calendar_list('a6000000-0000-4000-8000-000000000001','2028-03-01')),0::bigint,
 'date-based editorial month excludes previous leap day');
select is((select count(*) from public.calendar_audit_log where target_type='content_calendar' and action='create'),1::bigint,
 'calendar creation is audited once');
select is((select before_data->>'topic' from public.calendar_audit_log where target_type='content_calendar' and action='update'),
 '윤일의 주제','calendar update captures prior topic');
select is((select after_data->>'topic' from public.calendar_audit_log where target_type='content_calendar' and action='update'),
 '수정된 주제','calendar update captures changed topic');
select throws_ok($$select public.content_calendar_upsert('a6000000-0000-4000-8000-000000000001','2028-03-01',' ')$$,
 null::text,null::text,'blank editorial topic is rejected');
select throws_ok($$select public.content_calendar_upsert('a6000000-0000-4000-8000-000000000001','2028-03-01',E'\t\n')$$,
 null::text,null::text,'tab/newline-only editorial topic is rejected');
select throws_ok($$select public.content_calendar_upsert('a6000000-0000-4000-8000-000000000001','2028-03-01',repeat('x',1001))$$,
 null::text,null::text,'oversized editorial topic is rejected');
select throws_ok($$select public.content_calendar_upsert('a6000000-0000-4000-8000-000000000001','infinity','제목')$$,
 null::text,null::text,'infinite editorial date is rejected');
select throws_ok($$select public.content_calendar_upsert('a6000000-0000-4000-8000-000000000001','12000-01-01','제목')$$,
 '23514',null,'editorial date outside supported ISO year range is rejected');
select throws_ok($$select public.content_calendar_upsert('a6000000-0000-4000-8000-000000000001','0001-01-01 BC','제목')$$,
 '23514',null,'BC editorial date is rejected');
select throws_ok($$select public.content_calendar_upsert('a6000000-0000-4000-8000-000000000001',null,'제목')$$,
 null::text,null::text,'editorial date is required');
select throws_ok($$select public.content_calendar_upsert('a6000000-0000-4000-8000-000000000099','2028-03-01','제목')$$,
 '42501',null,'unknown artist cannot acquire editorial row');
select throws_ok($$select * from public.content_calendar_list('a6000000-0000-4000-8000-000000000001','2028-02-02')$$,
 null::text,null::text,'editorial monthly list uses same unambiguous month contract');
select lives_ok($$select public.content_calendar_delete((select id from calendar_test_context where key='content'))$$,
 'administrator can delete editorial entry');
select is((select count(id) from public.content_calendar),0::bigint,'deleted editorial entry no longer reads');
select is((select before_data->>'topic' from public.calendar_audit_log where target_type='content_calendar' and action='delete'),
 '수정된 주제','deleted editorial entry remains traceable in protected audit');

-- Unpublishing hides preferences until the event is public again; deletion then
-- removes preferences atomically rather than leaving orphan subscriptions.
select set_config('request.jwt.claim.sub','a5000000-0000-4000-8000-000000000002',true);
select is(public.schedule_set_notification((select id from calendar_test_context where key='event'),false),false,
 'fan creates optout before administrator event changes');
select set_config('request.jwt.claim.sub','a5000000-0000-4000-8000-000000000001',true);
select lives_ok($$select public.schedule_update((select id from calendar_test_context where key='event'),
 'festival','가상 봄 축제','2028-02-11 19:00+09',p_status=>'draft')$$,'administrator may unpublish event');
select set_config('request.jwt.claim.sub','a5000000-0000-4000-8000-000000000002',true);
select throws_ok($$select public.schedule_get_notification((select id from calendar_test_context where key='event'))$$,
 '42501',null,'unpublished event does not expose its private preference lookup');
select throws_ok($$select public.schedule_set_notification((select id from calendar_test_context where key='event'),true)$$,
 '42501',null,'unpublished event cannot be manipulated through preference API');
select set_config('request.jwt.claim.sub','a5000000-0000-4000-8000-000000000001',true);
select lives_ok($$select public.schedule_delete((select id from calendar_test_context where key='event'))$$,
 'administrator can delete draft and its retained optouts');
select is((select count(id) from public.schedules where id=(select id from calendar_test_context where key='event')),0::bigint,
 'schedule delete physically removes target identity');
select is((select count(*) from public.calendar_audit_log where target_type='schedule' and action='delete'
 and target_id=(select id from calendar_test_context where key='event')),1::bigint,'schedule deletion retains protected audit');
select throws_ok($$select * from public.schedule_get((select id from calendar_test_context where key='event'))$$,
 '42501','SCHEDULE_UNAVAILABLE','deleted UUID cannot be read');
select throws_ok($$select public.schedule_update((select id from calendar_test_context where key='event'),
 'event','복구 시도','2028-02-20 00:00Z')$$,'42501',null,'stale update cannot recreate deleted identity');
reset role;
select is((select count(*) from public.schedule_notification_optouts),0::bigint,'event deletion cascades all retained optouts');
select * from finish();
rollback;
