begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
-- 1,000 wholly fictional session-bound recipients. No push endpoint is fetched;
-- the drain below records proven test non-sends, never fabricated acceptance.
create temporary table webpush_bulk_context(key text primary key,id uuid,token uuid);
create temporary table webpush_bulk_drain(batch integer,examined integer,prepared integer,skipped integer);
grant all on webpush_bulk_context,webpush_bulk_drain to service_role;
insert into auth.users(id,email,raw_user_meta_data)
select ('ff100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'webpush-bulk-'||n||'@example.invalid','{}'::jsonb from generate_series(1,1001) n;
update public.profiles set call_name='가상 알림 팬',onboarding_completed_at=now() where id::text like 'ff100000-%';
update public.profiles set role='artist' where id='ff100000-0000-4000-8000-000000001001';
insert into auth.sessions(id,user_id,created_at,updated_at)
select ('ff110000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 ('ff100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,now(),now() from generate_series(1,1000) n;
insert into public.artists(id,slug,name,grade,status) values
 ('ff200000-0000-4000-8000-000000000001','webpush-bulk-fixture','가상 대량 알림 가수','B','active');
insert into public.artist_members(artist_id,user_id) values
 ('ff200000-0000-4000-8000-000000000001','ff100000-0000-4000-8000-000000001001');
insert into public.subscriptions(id,user_id,artist_id,provider,status,first_started_at,episode_started_at,current_period_start,current_period_end)
select ('ff300000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,('ff100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 'ff200000-0000-4000-8000-000000000001','toss','active',now()-interval '1 day',now()-interval '1 day',now()-interval '1 day',now()+interval '1 day'
 from generate_series(1,1000) n;
insert into private.message_policy(version,history_before_seconds,cancel_window_seconds,max_text_length,max_reply_length,
 max_photos,max_voice_seconds,max_video_seconds,preview_max_count,max_photo_bytes,max_voice_bytes,max_video_bytes)
values('fictional-webpush-bulk-message',604800,300,1000,100,10,180,60,5,10485760,20971520,104857600);
-- One allowed attempt means the SQL-only non-send drain terminates each row.
insert into private.notification_policy(version,consent_version,webpush_enabled,max_attempts,retry_seconds,lease_seconds,schedule_lead_seconds)
values('fictional-webpush-bulk','fictional-bulk-consent',true,1,10,30,86400);
set local role service_role;
select count(public.webpush_register_device(('ff100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 ('ff110000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'https://push.example.invalid/bulk-'||n,
 repeat('B',87),repeat('A',22),'fictional-bulk-consent')) from generate_series(1,1000) n;
insert into webpush_bulk_context(key,id) values('message',public.messaging_save_draft('ff100000-0000-4000-8000-000000001001',
 'ff200000-0000-4000-8000-000000000001',null,'text','가상 대량 발행 원문'));
select public.messaging_schedule('ff100000-0000-4000-8000-000000001001',(select id from webpush_bulk_context where key='message'),now());
select is(public.messaging_dispatch((select id from webpush_bulk_context where key='message')),true,'real message publication creates the bulk outbox transactionally');
select is(public.notification_enqueue('message',(select id from webpush_bulk_context where key='message')),0,'source replay deduplicates all 1000 recipient/device identities');
select is((select count(*) from public.webpush_list_due(100)),100::bigint,'first worker page stays bounded at 100 even with 1000 queued recipients');
reset role;
select is((select count(*) from private.notification_jobs where source_id=(select id from webpush_bulk_context where key='message')),1000::bigint,'exactly 1000 eligible session-bound recipients have one message outbox row');
select is((select count(distinct user_id) from private.notification_jobs where source_id=(select id from webpush_bulk_context where key='message')),1000::bigint,'bulk fan-out does not collapse distinct recipient ownership');
select is((select count(*) from private.push_subscriptions where auth_session_id is not null),1000::bigint,'all bulk devices are bound through real registration RPCs');
insert into webpush_bulk_context(key,id) select 'revoked',id from private.notification_jobs
 where source_id=(select id from webpush_bulk_context where key='message') and user_id='ff100000-0000-4000-8000-000000000001';
set local role service_role;
update webpush_bulk_context set token=c.lease_token from public.notification_claim((select id from webpush_bulk_context where key='revoked')) c where key='revoked';
select public.webpush_revoke_device('ff100000-0000-4000-8000-000000000001','ff110000-0000-4000-8000-000000000001','https://push.example.invalid/bulk-1');
select is((select count(*) from public.webpush_prepare_delivery((select id from webpush_bulk_context where key='revoked'),(select token from webpush_bulk_context where key='revoked'))),0::bigint,'opt-out after bulk enqueue and claim blocks final send authorization');
reset role;
update public.profiles set is_restricted=true where id='ff100000-0000-4000-8000-000000000002';
-- Rollback-only helper: exercise the real bounded list/claim/prepare/complete
-- functions, but never invoke an adapter. This is no performance or SLA proof.
create function pg_temp.drain_webpush_batch() returns table(examined integer,prepared integer,skipped integer)
language plpgsql security definer set search_path='' as $$
declare candidate record; leased record; ready_count integer;
begin
  examined:=0; prepared:=0; skipped:=0;
  for candidate in select id from public.webpush_list_due(100) loop
    examined:=examined+1;
    select * into leased from public.notification_claim(candidate.id);
    if not found then skipped:=skipped+1; continue; end if;
    select count(*) into ready_count from public.webpush_prepare_delivery(leased.job_id,leased.lease_token);
    if ready_count=1 then
      prepared:=prepared+1;
      -- No network was started: this is truthful synthetic non-send evidence.
      perform public.webpush_complete(leased.job_id,leased.lease_token,'not_sent',gen_random_uuid());
    else skipped:=skipped+1; end if;
  end loop;
  return next;
end;
$$;
grant execute on function pg_temp.drain_webpush_batch() to service_role;
set local role service_role;
do $$ declare batch integer; begin
  for batch in 1..11 loop
    insert into pg_temp.webpush_bulk_drain select batch,b.* from pg_temp.drain_webpush_batch() b;
  end loop;
end; $$;
select is((select count(*) from public.webpush_list_due(100)),0::bigint,'bounded pages drain all current bulk work without an unbounded listing');
select is((select count(*) from public.webpush_list_uncertain(100)),0::bigint,'SQL-only non-send drain leaves no ambiguous provider operation');
select is(public.notification_enqueue('message',(select id from webpush_bulk_context where key='message')),0,'recovery enqueue never resurrects completed or canceled source identities');
reset role;
select is((select sum(examined) from webpush_bulk_drain),999::bigint,'drain examines the remaining 999 queued identities once');
select is((select max(examined) from webpush_bulk_drain),100,'every drain iteration respects the 100-row page ceiling');
select is((select sum(prepared) from webpush_bulk_drain),998::bigint,'998 still-eligible recipients reach final authorization, without a provider call');
select is((select sum(skipped) from webpush_bulk_drain),1::bigint,'current recipient restriction is rejected during claim after enqueue');
select is((select count(*) from private.notification_jobs where state='canceled'),2::bigint,'revoked and newly ineligible recipients are both canceled');
select is((select count(*) from private.notification_jobs where state='failed'),998::bigint,'single-attempt test non-sends end at the explicit budget');
select is((select count(*) from private.notification_jobs where provider_accepted_at is not null),0::bigint,'bulk database checks fabricate no provider acceptance or device receipt');
select is((select count(*) from private.notification_attempts where delivery_prepared_at is not null),998::bigint,'only eligible recipients consume preparation capability');
select * from finish();
rollback;
