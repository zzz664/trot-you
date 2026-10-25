begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
set local timezone='UTC';
select no_plan();

-- Mirrored byte-for-byte JSON cases are checked by the unit contract test.
-- This file executes actual PostgreSQL timezone conversion, not a JS emulator.
create temporary table schedule_timezone_cases(data jsonb not null);
insert into schedule_timezone_cases values($schedule_timezone$
{
  "timeZone": "Asia/Seoul",
  "forms": [
    {
      "label": "earliest-unrepresentable",
      "date": "0001-01-01",
      "time": "00:00",
      "utc": null
    },
    {
      "label": "earliest-representable",
      "date": "0001-01-01",
      "time": "09:00",
      "utc": "0001-01-01T00:32:08.000Z"
    },
    {
      "label": "local-mean-time",
      "date": "1900-01-01",
      "time": "00:00",
      "utc": "1899-12-31T15:32:08.000Z"
    },
    {
      "label": "before-1908-gap",
      "date": "1908-03-31",
      "time": "23:59",
      "utc": "1908-03-31T15:31:08.000Z"
    },
    {
      "label": "1908-gap-midnight",
      "date": "1908-04-01",
      "time": "00:00",
      "utc": null
    },
    {
      "label": "1908-gap-minute",
      "date": "1908-04-01",
      "time": "00:01",
      "utc": null
    },
    {
      "label": "after-1908-gap",
      "date": "1908-04-01",
      "time": "00:03",
      "utc": "1908-03-31T15:33:00.000Z"
    },
    {
      "label": "1988-before-gap",
      "date": "1988-05-08",
      "time": "01:59",
      "utc": "1988-05-07T16:59:00.000Z"
    },
    {
      "label": "1988-gap-start",
      "date": "1988-05-08",
      "time": "02:00",
      "utc": null
    },
    {
      "label": "1988-gap-middle",
      "date": "1988-05-08",
      "time": "02:30",
      "utc": null
    },
    {
      "label": "1988-after-gap",
      "date": "1988-05-08",
      "time": "03:00",
      "utc": "1988-05-07T17:00:00.000Z"
    },
    {
      "label": "1988-fold-later-standard",
      "date": "1988-10-09",
      "time": "02:30",
      "utc": "1988-10-08T17:30:00.000Z"
    },
    {
      "label": "1988-after-fold",
      "date": "1988-10-09",
      "time": "03:00",
      "utc": "1988-10-08T18:00:00.000Z"
    },
    {
      "label": "modern",
      "date": "2026-10-25",
      "time": "18:30",
      "utc": "2026-10-25T09:30:00.000Z"
    },
    {
      "label": "leap-day",
      "date": "2028-02-29",
      "time": "23:59",
      "utc": "2028-02-29T14:59:00.000Z"
    },
    {
      "label": "last-local-minute",
      "date": "9999-12-31",
      "time": "23:59",
      "utc": "9999-12-31T14:59:00.000Z"
    }
  ],
  "instants": [
    {
      "label": "earliest-utc",
      "utc": "0001-01-01T00:00:00.000Z",
      "date": "0001-01-01",
      "time": "08:27",
      "month": "0001-01"
    },
    {
      "label": "lmt",
      "utc": "1900-01-01T00:00:00.000Z",
      "date": "1900-01-01",
      "time": "08:27",
      "month": "1900-01"
    },
    {
      "label": "1908-before",
      "utc": "1908-03-31T15:32:07.000Z",
      "date": "1908-03-31",
      "time": "23:59",
      "month": "1908-03"
    },
    {
      "label": "1908-after",
      "utc": "1908-03-31T15:32:08.000Z",
      "date": "1908-04-01",
      "time": "00:02",
      "month": "1908-04"
    },
    {
      "label": "1988-gap-before",
      "utc": "1988-05-07T16:59:59.000Z",
      "date": "1988-05-08",
      "time": "01:59",
      "month": "1988-05"
    },
    {
      "label": "1988-gap-after",
      "utc": "1988-05-07T17:00:00.000Z",
      "date": "1988-05-08",
      "time": "03:00",
      "month": "1988-05"
    },
    {
      "label": "1988-fold-early",
      "utc": "1988-10-08T16:30:00.000Z",
      "date": "1988-10-09",
      "time": "02:30",
      "month": "1988-10"
    },
    {
      "label": "1988-fold-late",
      "utc": "1988-10-08T17:30:00.000Z",
      "date": "1988-10-09",
      "time": "02:30",
      "month": "1988-10"
    },
    {
      "label": "modern-boundary-before",
      "utc": "2026-10-31T14:59:59.000Z",
      "date": "2026-10-31",
      "time": "23:59",
      "month": "2026-10"
    },
    {
      "label": "modern-boundary-at",
      "utc": "2026-10-31T15:00:00.000Z",
      "date": "2026-11-01",
      "time": "00:00",
      "month": "2026-11"
    },
    {
      "label": "leap-boundary",
      "utc": "2028-02-29T15:00:00.000Z",
      "date": "2028-03-01",
      "time": "00:00",
      "month": "2028-03"
    },
    {
      "label": "upper-local-boundary-before",
      "utc": "9999-12-31T14:59:59.000Z",
      "date": "9999-12-31",
      "time": "23:59",
      "month": "9999-12"
    }
  ],
  "dayStarts": [
    {
      "date": "0001-01-01",
      "utc": "0000-12-31T15:32:08.000Z"
    },
    {
      "date": "1900-01-01",
      "utc": "1899-12-31T15:32:08.000Z"
    },
    {
      "date": "1908-03-31",
      "utc": "1908-03-30T15:32:08.000Z"
    },
    {
      "date": "1908-04-01",
      "utc": "1908-03-31T15:32:08.000Z"
    },
    {
      "date": "1908-04-02",
      "utc": "1908-04-01T15:30:00.000Z"
    },
    {
      "date": "1988-05-08",
      "utc": "1988-05-07T15:00:00.000Z"
    },
    {
      "date": "1988-05-09",
      "utc": "1988-05-08T14:00:00.000Z"
    },
    {
      "date": "1988-10-09",
      "utc": "1988-10-08T14:00:00.000Z"
    },
    {
      "date": "1988-10-10",
      "utc": "1988-10-09T15:00:00.000Z"
    },
    {
      "date": "2026-11-01",
      "utc": "2026-10-31T15:00:00.000Z"
    },
    {
      "date": "2028-02-29",
      "utc": "2028-02-28T15:00:00.000Z"
    },
    {
      "date": "2028-03-01",
      "utc": "2028-02-29T15:00:00.000Z"
    },
    {
      "date": "9999-12-31",
      "utc": "9999-12-30T15:00:00.000Z"
    }
  ],
  "months": [
    {
      "month": "0001-01",
      "start": "0000-12-31T15:32:08.000Z",
      "end": "0001-01-31T15:32:08.000Z"
    },
    {
      "month": "1900-01",
      "start": "1899-12-31T15:32:08.000Z",
      "end": "1900-01-31T15:32:08.000Z"
    },
    {
      "month": "1908-04",
      "start": "1908-03-31T15:32:08.000Z",
      "end": "1908-04-30T15:30:00.000Z"
    },
    {
      "month": "1988-05",
      "start": "1988-04-30T15:00:00.000Z",
      "end": "1988-05-31T14:00:00.000Z"
    },
    {
      "month": "1988-10",
      "start": "1988-09-30T14:00:00.000Z",
      "end": "1988-10-31T15:00:00.000Z"
    },
    {
      "month": "2026-11",
      "start": "2026-10-31T15:00:00.000Z",
      "end": "2026-11-30T15:00:00.000Z"
    },
    {
      "month": "2028-02",
      "start": "2028-01-31T15:00:00.000Z",
      "end": "2028-02-29T15:00:00.000Z"
    },
    {
      "month": "9999-12",
      "start": "9999-11-30T15:00:00.000Z",
      "end": "9999-12-31T15:00:00.000Z"
    }
  ]
}
$schedule_timezone$::jsonb);
create function pg_temp.expected_utc(p_value text) returns timestamptz language sql immutable as $$
  select case when left(p_value,5)='0000-' then
    (replace(replace('0001'||substr(p_value,5),'T',' '),'Z','+00')||' BC')::timestamptz
    else p_value::timestamptz end;
$$;
select is(((item->>'date')||'T'||(item->>'time'))::timestamp at time zone 'Asia/Seoul',
 pg_temp.expected_utc(item->>'utc'),'IANA form conversion: '||(item->>'label'))
from schedule_timezone_cases,jsonb_array_elements(data->'forms')item where item->>'utc' is not null;
select ok(case when item->>'date'='0001-01-01' then
 (((item->>'date')||'T'||(item->>'time'))::timestamp at time zone 'Asia/Seoul')<timestamptz '0001-01-01 00:00:00+00'
 else ((((item->>'date')||'T'||(item->>'time'))::timestamp at time zone 'Asia/Seoul') at time zone 'Asia/Seoul')
 <> ((item->>'date')||'T'||(item->>'time'))::timestamp end,
 'Unrepresentable UTC or nonexistent local form time: '||(item->>'label'))
from schedule_timezone_cases,jsonb_array_elements(data->'forms')item where item->>'utc' is null;
select is(to_char((item->>'utc')::timestamptz at time zone 'Asia/Seoul','YYYY-MM-DD'),item->>'date',
 'IANA display date: '||(item->>'label')) from schedule_timezone_cases,jsonb_array_elements(data->'instants')item;
select is(to_char((item->>'utc')::timestamptz at time zone 'Asia/Seoul','HH24:MI'),item->>'time',
 'IANA display minute: '||(item->>'label')) from schedule_timezone_cases,jsonb_array_elements(data->'instants')item;
select is(to_char((item->>'utc')::timestamptz at time zone 'Asia/Seoul','YYYY-MM'),item->>'month',
 'IANA current month: '||(item->>'label')) from schedule_timezone_cases,jsonb_array_elements(data->'instants')item;
select is((item->>'date')::date::timestamp at time zone 'Asia/Seoul',pg_temp.expected_utc(item->>'utc'),
 'Calendar day starts normalize gaps/folds using PostgreSQL: '||(item->>'date'))
from schedule_timezone_cases,jsonb_array_elements(data->'dayStarts')item;
select is(lower(private.calendar_month_bounds((item->>'month'||'-01')::date)),pg_temp.expected_utc(item->>'start'),
 'Actual schedule RPC month lower bound: '||(item->>'month'))
from schedule_timezone_cases,jsonb_array_elements(data->'months')item;
select is(upper(private.calendar_month_bounds((item->>'month'||'-01')::date)),pg_temp.expected_utc(item->>'end'),
 'Actual schedule RPC month upper bound: '||(item->>'month'))
from schedule_timezone_cases,jsonb_array_elements(data->'months')item;
select is(extract(epoch from ((timestamp '1908-04-02' at time zone 'Asia/Seoul')-(timestamp '1908-04-01' at time zone 'Asia/Seoul'))),
 86272::numeric,'1908 midnight offset gap makes calendar day shorter by 128 seconds');
select is(extract(epoch from ((timestamp '1988-05-09' at time zone 'Asia/Seoul')-(timestamp '1988-05-08' at time zone 'Asia/Seoul'))),
 82800::numeric,'1988 spring DST calendar day lasts23hours');
select is(extract(epoch from ((timestamp '1988-10-10' at time zone 'Asia/Seoul')-(timestamp '1988-10-09' at time zone 'Asia/Seoul'))),
 90000::numeric,'1988 autumn DST calendar day lasts25hours');

-- Actual schedule_list overlap behavior at historical month boundaries remains
-- unchanged; the UI now uses these same IANA boundaries rather than fixed+09.
insert into auth.users(id,email,raw_user_meta_data) values
 ('af900000-0000-4000-8000-000000000001','schedule-timezone@example.invalid','{}');
update public.profiles set role='admin' where id='af900000-0000-4000-8000-000000000001';
insert into public.artists(id,slug,name,grade,status) values
 ('af900000-0000-4000-8000-000000000002','schedule-timezone','Fictional timezone artist','B','active');
insert into public.schedules(id,artist_id,type,status,title,starts_at,ends_at,created_by) values
 ('af900000-0000-4000-8000-000000000003','af900000-0000-4000-8000-000000000002','event','published','Ends exactly at historical month start','1908-03-31T15:31:00Z','1908-03-31T15:32:08Z','af900000-0000-4000-8000-000000000001'),
 ('af900000-0000-4000-8000-000000000004','af900000-0000-4000-8000-000000000002','event','published','Overlaps historical month by one second','1908-03-31T15:31:00Z','1908-03-31T15:32:09Z','af900000-0000-4000-8000-000000000001'),
 ('af900000-0000-4000-8000-000000000005','af900000-0000-4000-8000-000000000002','event','published','Begins exactly at historical month start','1908-03-31T15:32:08Z',null,'af900000-0000-4000-8000-000000000001');
select is((select array_agg(id order by id) from public.schedule_list('1908-04-01')),
 array['af900000-0000-4000-8000-000000000004','af900000-0000-4000-8000-000000000005']::uuid[],
 'Actual historical month list is half-open and includes boundary-spanning events once');
select lives_ok($$select private.schedule_parse_input('{"artist_id":"af900000-0000-4000-8000-000000000002","type":"event","status":"draft","title":"Earliest UTC instant","description":null,"starts_at":"0001-01-01T00:00:00Z","ends_at":null,"place_name":null,"address":null,"lat":null,"lng":null}')$$,
 'New UI input accepts earliest four-digit AD UTC instant');
select throws_ok($$select private.schedule_parse_input('{"artist_id":"af900000-0000-4000-8000-000000000002","type":"event","status":"draft","title":"BC transport rejected","description":null,"starts_at":"0001-01-01T00:00:00+08:00","ends_at":null,"place_name":null,"address":null,"lat":null,"lng":null}')$$,
 '22023','SCHEDULE_INVALID_INPUT','New UI input cannot serialize BC/year-zero UTC as a four-digit AD timestamp');
select lives_ok($$select private.schedule_parse_input('{"artist_id":"af900000-0000-4000-8000-000000000002","type":"event","status":"draft","title":"Last local minute","description":null,"starts_at":"9999-12-31T14:59:00Z","ends_at":"9999-12-31T15:00:00Z","place_name":null,"address":null,"lat":null,"lng":null}')$$,
 'New UI accepts final local minute and the existing inclusive end boundary');
select throws_ok($$select private.schedule_parse_input('{"artist_id":"af900000-0000-4000-8000-000000000002","type":"event","status":"draft","title":"Out of local range","description":null,"starts_at":"9999-12-31T15:00:00Z","ends_at":null,"place_name":null,"address":null,"lat":null,"lng":null}')$$,
 '22023','SCHEDULE_INVALID_INPUT','New UI retains existing exclusive start boundary at local year10000');
-- Exact microsecond intervals must not be collapsed to JavaScript milliseconds.
insert into public.schedules(id,artist_id,type,status,title,starts_at,ends_at,created_by) values
 ('af900000-0000-4000-8000-000000000006','af900000-0000-4000-8000-000000000002','event','published','One microsecond beyond month boundary','2026-10-31T14:59:59.999999Z','2026-10-31T15:00:00.000001Z','af900000-0000-4000-8000-000000000001'),
 ('af900000-0000-4000-8000-000000000007','af900000-0000-4000-8000-000000000002','event','published','Ends exactly at month boundary','2026-10-31T14:59:59.999999Z','2026-10-31T15:00:00.000000Z','af900000-0000-4000-8000-000000000001');
select is((select array_agg(id order by id) from public.schedule_list('2026-11-01')),
 array['af900000-0000-4000-8000-000000000006']::uuid[],
 'Public month overlap preserves microsecond excess and excludes exact end boundary');
select lives_ok($$select private.schedule_parse_input('{"artist_id":"af900000-0000-4000-8000-000000000002","type":"event","status":"draft","title":"Microsecond interval","description":null,"starts_at":"2026-10-31T15:00:00.000001Z","ends_at":"2026-10-31T15:00:00.000002Z","place_name":null,"address":null,"lat":null,"lng":null}')$$,
 'New UI input retains a valid one-microsecond interval');
select throws_ok($$select private.schedule_parse_input('{"artist_id":"af900000-0000-4000-8000-000000000002","type":"event","status":"draft","title":"Excess precision","description":null,"starts_at":"2026-10-31T15:00:00.0000001Z","ends_at":null,"place_name":null,"address":null,"lat":null,"lng":null}')$$,
 '22023','SCHEDULE_INVALID_INPUT','New UI rejects unsupported precision instead of silent PostgreSQL rounding');
select throws_ok($$select private.schedule_parse_input('{"artist_id":"af900000-0000-4000-8000-000000000002","type":"event","status":"draft","title":"One microsecond out of range","description":null,"starts_at":"9999-12-31T14:59:59.999999Z","ends_at":"9999-12-31T15:00:00.000001Z","place_name":null,"address":null,"lat":null,"lng":null}')$$,
 '22023','SCHEDULE_INVALID_INPUT','New UI retains inclusive upper end bound at microsecond precision');
select * from finish();
rollback;
