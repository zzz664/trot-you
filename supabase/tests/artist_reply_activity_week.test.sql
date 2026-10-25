begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
-- Owner-only historical fixtures exercise exact week/as-of boundaries. No
-- public RPC accepts this arbitrary clock, policy or artist identifier.
insert into auth.users(id,email,raw_user_meta_data) values('ad100000-0000-4000-8000-000000000001','activity-week@example.invalid','{}');
update public.profiles set role='artist',call_name='가상 가수',onboarding_completed_at=now() where id='ad100000-0000-4000-8000-000000000001';
insert into public.artists(id,slug,name,grade,status) values('ad200000-0000-4000-8000-000000000001','activity-week','가상 주간 가수','B','active');
insert into public.messages(id,artist_id,author_id,type,body,status,scheduled_at,sent_at,canceled_at) values
 ('ad400000-0000-4000-8000-000000000001','ad200000-0000-4000-8000-000000000001','ad100000-0000-4000-8000-000000000001','text','직전 주','sent','2026-09-27T14:59:59Z','2026-09-27T14:59:59Z',null),
 ('ad400000-0000-4000-8000-000000000002','ad200000-0000-4000-8000-000000000001','ad100000-0000-4000-8000-000000000001','text','월요일 경계','sent','2026-09-27T15:00:00Z','2026-09-27T15:00:00Z',null),
 ('ad400000-0000-4000-8000-000000000003','ad200000-0000-4000-8000-000000000001','ad100000-0000-4000-8000-000000000001','photo',null,'sent','2026-09-30T15:00:00Z','2026-09-30T15:00:00Z',null),
 ('ad400000-0000-4000-8000-000000000004','ad200000-0000-4000-8000-000000000001','ad100000-0000-4000-8000-000000000001','voice',null,'sent','2026-10-01T03:00:00Z','2026-10-01T03:00:00Z',null),
 ('ad400000-0000-4000-8000-000000000005','ad200000-0000-4000-8000-000000000001','ad100000-0000-4000-8000-000000000001','video',null,'sent','2026-10-01T03:00:00.000001Z','2026-10-01T03:00:00.000001Z',null),
 ('ad400000-0000-4000-8000-000000000006','ad200000-0000-4000-8000-000000000001','ad100000-0000-4000-8000-000000000001','text','다음 월요일','sent','2026-10-04T15:00:00Z','2026-10-04T15:00:00Z',null),
 ('ad400000-0000-4000-8000-000000000007','ad200000-0000-4000-8000-000000000001','ad100000-0000-4000-8000-000000000001','photo',null,'canceled','2026-09-29T15:00:00Z','2026-09-29T15:00:00Z','2026-09-30T15:00:00Z'),
 ('ad400000-0000-4000-8000-000000000008','ad200000-0000-4000-8000-000000000001','ad100000-0000-4000-8000-000000000001','photo',null,'scheduled','2026-09-29T15:00:00Z',null,null),
 ('ad400000-0000-4000-8000-000000000009','ad200000-0000-4000-8000-000000000001','ad100000-0000-4000-8000-000000000001','photo',null,'draft',null,null,null);
select is(private.artist_reply_activity_week('ad200000-0000-4000-8000-000000000001','2026-10-01T03:00:00Z')->>'week_start','2026-09-28','week starts Monday in KST even across month');
select is(private.artist_reply_activity_week('ad200000-0000-4000-8000-000000000001','2026-10-01T03:00:00Z')->>'week_end','2026-10-05','week end is exclusive next Monday');
select is(private.artist_reply_activity_week('ad200000-0000-4000-8000-000000000001','2026-10-01T03:00:00Z')->>'message_count','3','all sent message kinds through exact as-of count; future/draft/scheduled/canceled excluded');
select is(private.artist_reply_activity_week('ad200000-0000-4000-8000-000000000001','2026-10-01T03:00:00Z')->>'photo_count','1','photo messages count once regardless of attachments');
select is(private.artist_reply_activity_week('ad200000-0000-4000-8000-000000000001','2026-10-04T14:59:59.999999Z')->>'message_count','4','current week upper boundary is exclusive');
select is(private.artist_reply_activity_week('ad200000-0000-4000-8000-000000000001','2026-10-04T15:00:00Z')->>'message_count','1','next Monday begins a new week');
select is(private.artist_reply_activity_week('ad200000-0000-4000-8000-000000000001','2026-09-27T15:00:00Z')->>'message_count','1','exact Monday lower boundary is included');
select is(private.artist_reply_activity_week('ad200000-0000-4000-8000-000000000001','2026-09-27T14:59:59Z')->>'week_start','2026-09-21','instant before Monday remains previous week');
set local timezone='America/Los_Angeles';
select is(private.artist_reply_activity_week('ad200000-0000-4000-8000-000000000001','2026-10-01T03:00:00Z')->>'message_count','3','session timezone never changes KST source counts');
select is(private.artist_reply_activity_week('ad200000-0000-4000-8000-000000000001','2026-10-01T03:00:00Z')->>'week_start','2026-09-28','session timezone never changes calendar anchor');
set local timezone='UTC';
insert into private.settlement_policies(artist_id,month,enabled,contract_from,contract_until,base_rate,performance_rate,vat_rate,pg_fee_rate,
 activity_enabled,weekly_message_min,weekly_photo_min) values
 ('ad200000-0000-4000-8000-000000000001','2026-09-01',true,'2026-09-28','2026-10-05',0.3,0.4,0.1,0.03,true,3,2);
select is(private.artist_reply_activity_week('ad200000-0000-4000-8000-000000000001','2026-10-01T03:00:00Z')->>'requirements_ready','false','cross-month week needs every covered monthly policy');
insert into private.settlement_policies(artist_id,month,enabled,contract_from,contract_until,base_rate,performance_rate,vat_rate,pg_fee_rate,
 activity_enabled,weekly_message_min,weekly_photo_min) values
 ('ad200000-0000-4000-8000-000000000001','2026-10-01',true,'2026-09-28','2026-10-05',0.3,0.4,0.1,0.03,true,3,2);
select is(private.artist_reply_activity_week('ad200000-0000-4000-8000-000000000001','2026-10-01T03:00:00Z')->>'requirements_ready','true','consistent enabled requirements cover a full cross-month week');
select is(private.artist_reply_activity_week('ad200000-0000-4000-8000-000000000001','2026-10-01T03:00:00Z')->>'weekly_message_min','3','approved message minimum is projected');
select is(private.artist_reply_activity_week('ad200000-0000-4000-8000-000000000001','2026-10-01T03:00:00Z')->>'weekly_photo_min','2','approved photo minimum is projected');
select is((select string_agg(k,',' order by k) from jsonb_object_keys(private.artist_reply_activity_week(
 'ad200000-0000-4000-8000-000000000001','2026-10-01T03:00:00Z')) k),
 'message_count,photo_count,requirements_ready,week_end,week_start,weekly_message_min,weekly_photo_min','activity has no revenue, rates, contract dates, settlement or subscriber fields');
update private.settlement_policies set weekly_message_min=4 where month='2026-10-01';
select is(private.artist_reply_activity_week('ad200000-0000-4000-8000-000000000001','2026-10-01T03:00:00Z')->>'requirements_ready','false','midweek policy difference is unavailable, not guessed weighted contract');
select is(private.artist_reply_activity_week('ad200000-0000-4000-8000-000000000001','2026-10-01T03:00:00Z')->'weekly_message_min','null'::jsonb,'inconsistent contract does not expose misleading minimum');
update private.settlement_policies set weekly_message_min=3,enabled=false where month='2026-10-01';
select is(private.artist_reply_activity_week('ad200000-0000-4000-8000-000000000001','2026-10-01T03:00:00Z')->>'requirements_ready','false','disabled policy is not an approved dashboard requirement');
update private.settlement_policies set enabled=true,contract_until='2026-10-04' where month='2026-10-01';
select is(private.artist_reply_activity_week('ad200000-0000-4000-8000-000000000001','2026-10-01T03:00:00Z')->>'requirements_ready','false','contract end is exclusive; missing final day fails closed');
update private.settlement_policies set contract_until='2026-10-05',contract_from='2026-10-02' where month='2026-10-01';
select is(private.artist_reply_activity_week('ad200000-0000-4000-8000-000000000001','2026-10-01T03:00:00Z')->>'requirements_ready','false','midweek contract start does not invent prorated minima');
update private.settlement_policies set contract_from='2026-09-28',activity_enabled=false,weekly_message_min=null,weekly_photo_min=null where month='2026-10-01';
select is(private.artist_reply_activity_week('ad200000-0000-4000-8000-000000000001','2026-10-01T03:00:00Z')->>'requirements_ready','false','activity-disabled settlement is not treated as zero weekly goal');
select is(private.artist_reply_activity_week('ad200000-0000-4000-8000-000000000001','2026-10-01T03:00:00Z')->>'message_count','3','policy unavailable never hides factual source activity');
select is((select count(*) from public.settlements),0::bigint,'dashboard threshold reads never create a report');
select * from finish();
rollback;
