begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

-- Fictional rollback-only fixtures. SQL lifecycle/DTO checks are not proof of
-- real Auth, blob verification, personalization, moderation or delivery.
create temporary table message_test_context (key text primary key, id uuid, stamp timestamptz);
grant all on message_test_context to authenticated, service_role;
insert into auth.users(id, email, raw_user_meta_data)
select ('81000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  'message-lifecycle-' || n || '@example.invalid', '{}'::jsonb
from unnest(array[1,2,3,4,5,11,12,13,14,15,16]) n;
update public.profiles set call_name = '안전한이름', nickname = '노출금지닉네임', phone = '010-0000-0000',
  onboarding_completed_at = now() where id <> '81000000-0000-4000-8000-000000000015';
update public.profiles set role = 'artist' where id in
  ('81000000-0000-4000-8000-000000000011', '81000000-0000-4000-8000-000000000012');
update public.profiles set role = 'admin' where id = '81000000-0000-4000-8000-000000000013';
update public.profiles set is_restricted = true where id = '81000000-0000-4000-8000-000000000014';
update public.profiles set is_restricted = true, restricted_until = now() - interval '1 second'
  where id = '81000000-0000-4000-8000-000000000016';
insert into public.artists(id, slug, name, grade, status) values
  ('82000000-0000-4000-8000-000000000001', 'message-main', '가상 메시지 가수', 'B', 'active'),
  ('82000000-0000-4000-8000-000000000002', 'message-other', '가상 다른 가수', 'B', 'active'),
  ('82000000-0000-4000-8000-000000000003', 'message-paused', '가상 중지 가수', 'B', 'paused');
insert into public.artist_members(artist_id, user_id) values
  ('82000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000011'),
  ('82000000-0000-4000-8000-000000000003', '81000000-0000-4000-8000-000000000011'),
  ('82000000-0000-4000-8000-000000000002', '81000000-0000-4000-8000-000000000012');
insert into public.subscriptions(id, user_id, artist_id, provider, status,
  first_started_at, episode_started_at, current_period_start, current_period_end,
  canceled_at, grace_started_at, grace_ends_at)
select ('83000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  ('81000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  '82000000-0000-4000-8000-000000000001', 'toss',
  (case n when 3 then 'canceled' when 4 then 'grace' when 5 then 'expired' else 'active' end)::public.subscription_status,
  now() - interval '100 days', now() - interval '1 day', now() - interval '1 day',
  case when n in (4,5) then now() - interval '1 hour' else now() + interval '29 days' end,
  case when n = 3 then now() - interval '1 hour' end,
  case when n = 4 then now() - interval '1 hour' end,
  case when n = 4 then now() + interval '1 day' end
from unnest(array[1,3,4,5,11,13,14,15,16]) n;

-- Reply writes now share current legal/name readiness and explicit moderation.
-- Fictional compatibility policy remains rollback-only, never a migration seed.
insert into private.onboarding_documents(version,kind,title,body,approved_at,published_at) values
 ('89000000-0000-4000-8000-000000000001','terms','Fixture terms','Rollback only.',now(),now()),
 ('89000000-0000-4000-8000-000000000002','privacy','Fixture privacy','Rollback only.',now(),now());
insert into private.profile_onboarding_policy values(true,'88000000-0000-4000-8000-000000000001',now(),2,10,
 array['금지단어'],'89000000-0000-4000-8000-000000000001','89000000-0000-4000-8000-000000000002',null);
update public.profiles set font_selected_at=now(),profile_completed_at=now(),age_self_attested_at=now()
 where onboarding_completed_at is not null;
insert into private.profile_policy_acceptances(user_id,kind,version,accepted_at)
 select p.id,d.kind,d.version,now() from public.profiles p cross join private.onboarding_documents d
 where p.onboarding_completed_at is not null;
insert into private.reply_policy values(true,'fictional-compatibility',now(),60,100,
 array['금지단어'],array['phone','account','url']);

set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select throws_ok($$select public.messaging_save_draft('81000000-0000-4000-8000-000000000011',
  '82000000-0000-4000-8000-000000000001', null, 'text', '안녕하세요')$$,
  '55000', 'MESSAGE_POLICY_REQUIRED', 'authoring fails closed before trusted policy provisioning');
select throws_ok($$select * from public.messaging_list_messages('81000000-0000-4000-8000-000000000001',
  '82000000-0000-4000-8000-000000000001', false, 30)$$,
  '55000', 'MESSAGE_POLICY_REQUIRED', 'reading has no silent document-default policy');
insert into private.message_policy(version, history_before_seconds, cancel_window_seconds, max_text_length,
  max_reply_length, max_photos, max_voice_seconds, max_video_seconds, preview_max_count,
  max_photo_bytes, max_voice_bytes, max_video_bytes)
values ('fixture-not-operational-v1', 604800, 300, 1000, 100, 10, 180, 60, 5, 10485760, 20971520, 104857600);

select throws_ok($$select public.messaging_save_draft('81000000-0000-4000-8000-000000000001',
  '82000000-0000-4000-8000-000000000001', null, 'text', '팬의 위조')$$,
  '42501', 'MESSAGE_AUTHOR_FORBIDDEN', 'fan cannot author through trusted service primitive');
select throws_ok($$select public.messaging_save_draft('81000000-0000-4000-8000-000000000012',
  '82000000-0000-4000-8000-000000000001', null, 'text', '다른 가수')$$,
  '42501', 'MESSAGE_AUTHOR_FORBIDDEN', 'unrelated artist cannot author another artist message');
select throws_ok($$select public.messaging_save_draft('81000000-0000-4000-8000-000000000011',
  '82000000-0000-4000-8000-000000000001', null, null, '유형 없음')$$,
  '23514', 'MESSAGE_CONTENT_INVALID', 'message type is required');
select throws_ok($$select public.messaging_save_draft('81000000-0000-4000-8000-000000000011',
  '82000000-0000-4000-8000-000000000001', null, 'text', null)$$,
  '23514', 'MESSAGE_CONTENT_INVALID', 'text requires body');
select throws_ok($$select public.messaging_save_draft('81000000-0000-4000-8000-000000000011',
  '82000000-0000-4000-8000-000000000001', null, 'text', '   ')$$,
  '23514', 'MESSAGE_CONTENT_INVALID', 'whitespace-only body is not content');
select throws_ok($$select public.messaging_save_draft('81000000-0000-4000-8000-000000000011',
  '82000000-0000-4000-8000-000000000001', null, 'text', repeat('가', 1001))$$,
  '23514', 'MESSAGE_CONTENT_INVALID', 'configured text bound counts characters');
insert into message_test_context(key, id) values ('draft', public.messaging_save_draft(
  '81000000-0000-4000-8000-000000000011', '82000000-0000-4000-8000-000000000001', null, 'text', '안녕 {이름}'));
select is((select status::text from public.messages where id = (select id from message_test_context where key = 'draft')),
  'draft', 'save creates a draft, never a sent message');
select is(public.messaging_save_draft('81000000-0000-4000-8000-000000000011',
  '82000000-0000-4000-8000-000000000001', (select id from message_test_context where key = 'draft'), 'text', repeat('가', 1000)),
  (select id from message_test_context where key = 'draft'), 'editing an owned draft preserves identity at exact length limit');
select lives_ok($$select public.messaging_save_draft('81000000-0000-4000-8000-000000000013',
  '82000000-0000-4000-8000-000000000001', (select id from message_test_context where key = 'draft'), 'text', '관리자 수정')$$,
  'authorized admin can edit a draft');
select is((select author_id from public.messages where id = (select id from message_test_context where key = 'draft')),
  '81000000-0000-4000-8000-000000000011'::uuid, 'editing does not replace original author');
select throws_ok($$select public.messaging_save_draft('81000000-0000-4000-8000-000000000012',
  '82000000-0000-4000-8000-000000000002', (select id from message_test_context where key = 'draft'), 'text', '이동 위조')$$,
  'P0002', 'MESSAGE_NOT_FOUND', 'owned artist argument cannot move another artist message');
select throws_ok($$select public.messaging_schedule('81000000-0000-4000-8000-000000000011',
  (select id from message_test_context where key = 'draft'), 'infinity')$$,
  '23514', 'MESSAGE_SCHEDULE_INVALID', 'nonfinite schedule is rejected');
select throws_ok($$select public.messaging_schedule('81000000-0000-4000-8000-000000000011',
  (select id from message_test_context where key = 'draft'), null)$$,
  '23514', 'MESSAGE_SCHEDULE_INVALID', 'schedule time is required');
select lives_ok($$select public.messaging_schedule('81000000-0000-4000-8000-000000000011',
  (select id from message_test_context where key = 'draft'), now() + interval '1 day')$$,
  'member schedules a validated text draft');
select is(public.messaging_dispatch((select id from message_test_context where key = 'draft')),
  false, 'dispatch cannot send a future schedule early');
select throws_ok($$select public.messaging_save_draft('81000000-0000-4000-8000-000000000011',
  '82000000-0000-4000-8000-000000000001', (select id from message_test_context where key = 'draft'), 'text', '발송 우회')$$,
  '55000', 'MESSAGE_NOT_DRAFT', 'scheduled content is immutable through draft save');
select throws_ok($$select public.messaging_schedule('81000000-0000-4000-8000-000000000011',
  (select id from message_test_context where key = 'draft'), now())$$,
  '55000', 'MESSAGE_NOT_DRAFT', 'rescheduling cannot bypass status transitions');
select lives_ok($$select public.messaging_cancel('81000000-0000-4000-8000-000000000011',
  (select id from message_test_context where key = 'draft'))$$, 'scheduled message can be canceled before send');
select lives_ok($$select public.messaging_cancel('81000000-0000-4000-8000-000000000011',
  (select id from message_test_context where key = 'draft'))$$, 'authorized cancellation replay is idempotent');
select is(public.messaging_dispatch((select id from message_test_context where key = 'draft')),
  false, 'canceled scheduled message never dispatches');

insert into message_test_context(key, id) values ('immediate', public.messaging_save_draft(
  '81000000-0000-4000-8000-000000000011', '82000000-0000-4000-8000-000000000001', null, 'text', '즉시 발송'));
select lives_ok($$select public.messaging_schedule('81000000-0000-4000-8000-000000000011',
  (select id from message_test_context where key = 'immediate'), now() - interval '100 days')$$,
  'past schedule request means due now, not backdated delivery');
select ok((select scheduled_at >= now() from public.messages where id =
  (select id from message_test_context where key = 'immediate')), 'schedule cannot backdate message history');
select is(public.messaging_dispatch((select id from message_test_context where key = 'immediate')),
  true, 'due scheduled text transitions to sent');
select is(public.messaging_dispatch((select id from message_test_context where key = 'immediate')),
  false, 'repeated dispatch does not resend or restamp sent message');
select ok(exists (select 1 from public.messaging_list_messages('81000000-0000-4000-8000-000000000001',
  '82000000-0000-4000-8000-000000000001', false, 100) where id =
  (select id from message_test_context where key = 'immediate')),
  'freshly dispatched message is visible in a subsequent statement within the same transaction');
select ok((select sent_at >= scheduled_at and status = 'sent' from public.messages where id =
  (select id from message_test_context where key = 'immediate')), 'sent timestamp is authoritative and after schedule');
select lives_ok($$select public.messaging_cancel('81000000-0000-4000-8000-000000000011',
  (select id from message_test_context where key = 'immediate'))$$, 'sent message cancels inside configured window');
insert into message_test_context(key, id) values ('photo-empty', public.messaging_save_draft(
  '81000000-0000-4000-8000-000000000011', '82000000-0000-4000-8000-000000000001', null, 'photo', null));
select throws_ok($$select public.messaging_schedule('81000000-0000-4000-8000-000000000011',
  (select id from message_test_context where key = 'photo-empty'), now())$$,
  '23514', 'MESSAGE_MEDIA_REQUIRED', 'media message cannot schedule without registered assets');
select lives_ok($$select public.messaging_cancel('81000000-0000-4000-8000-000000000011',
  (select id from message_test_context where key = 'photo-empty'))$$, 'incomplete draft may be canceled safely');
insert into message_test_context(key, id) values ('paused-draft', public.messaging_save_draft(
  '81000000-0000-4000-8000-000000000011', '82000000-0000-4000-8000-000000000003', null, 'text', '중지 가수 초안'));
select throws_ok($$select public.messaging_schedule('81000000-0000-4000-8000-000000000011',
  (select id from message_test_context where key = 'paused-draft'), now())$$,
  '42501', 'MESSAGE_ARTIST_UNAVAILABLE', 'paused artist cannot schedule publication');

reset role;
-- Deterministic clock fixtures for visibility windows; no production mutation path.
insert into public.messages(id, artist_id, author_id, type, body, status, scheduled_at, sent_at, canceled_at)
select ('84000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  case n when 7 then '82000000-0000-4000-8000-000000000002'::uuid
    when 8 then '82000000-0000-4000-8000-000000000003'::uuid else '82000000-0000-4000-8000-000000000001'::uuid end,
  case n when 7 then '81000000-0000-4000-8000-000000000012'::uuid else '81000000-0000-4000-8000-000000000011'::uuid end,
  'text', 'fixture-' || n || ' {이름}',
  (case n when 4 then 'draft' when 5 then 'scheduled' when 6 then 'canceled' else 'sent' end)::public.message_status,
  case n when 4 then null when 5 then now() + interval '1 day' else now() - interval '30 days' end,
  case n when 2 then now() - interval '8 days' when 3 then now() - interval '8 days 1 microsecond'
    when 4 then null when 5 then null when 9 then now() + interval '1 day' when 10 then now() - interval '20 days'
    when 11 then now() - interval '2 minutes' else now() - interval '1 minute' end,
  case n when 6 then now() end
from generate_series(1, 11) n;
set local role service_role;
select is((select count(*) from public.messaging_list_messages('81000000-0000-4000-8000-000000000001',
  '82000000-0000-4000-8000-000000000001', false, 100)), 3::bigint,
  'paid fan receives only sent in-window messages, not drafts, scheduled, canceled, old or future rows');
select ok(exists (select 1 from public.messaging_list_messages('81000000-0000-4000-8000-000000000001',
  '82000000-0000-4000-8000-000000000001', false, 100) where id = '84000000-0000-4000-8000-000000000002'),
  'history cutoff is inclusive at current episode minus configured history');
select is((select count(*) from public.messaging_list_messages('81000000-0000-4000-8000-000000000001',
  '82000000-0000-4000-8000-000000000002', false, 100)), 0::bigint, 'other artist subscription is not inferred');
select is((select count(*) from public.messaging_list_messages('81000000-0000-4000-8000-000000000002',
  '82000000-0000-4000-8000-000000000001', false, 100)), 0::bigint, 'unsubscribed fan receives no paid content');
select is((select count(*) from public.messaging_list_messages('81000000-0000-4000-8000-000000000003',
  '82000000-0000-4000-8000-000000000001', false, 100)), 3::bigint, 'canceled subscriber retains still-paid access');
select is((select count(*) from public.messaging_list_messages('81000000-0000-4000-8000-000000000004',
  '82000000-0000-4000-8000-000000000001', false, 100)), 3::bigint, 'grace access uses grace end after paid period expires');
select is((select count(*) from public.messaging_list_messages('81000000-0000-4000-8000-000000000005',
  '82000000-0000-4000-8000-000000000001', false, 100)), 0::bigint, 'expired subscription cannot read');
select is((select count(*) from public.messaging_list_messages('81000000-0000-4000-8000-000000000014',
  '82000000-0000-4000-8000-000000000001', false, 100)), 0::bigint, 'restricted fan cannot read despite paid subscription');
select is((select count(*) from public.messaging_list_messages('81000000-0000-4000-8000-000000000015',
  '82000000-0000-4000-8000-000000000001', false, 100)), 0::bigint, 'incomplete onboarding cannot read message DTO');
select is((select count(*) from public.messaging_list_messages('81000000-0000-4000-8000-000000000016',
  '82000000-0000-4000-8000-000000000001', false, 100)), 3::bigint, 'elapsed temporary restriction restores authorized reading');
select is((select count(*) from public.messaging_list_messages('81000000-0000-4000-8000-000000000011',
  '82000000-0000-4000-8000-000000000001', false, 100)), 0::bigint, 'artist with subscription is not a fan-reader actor');
select is((select count(*) from public.messaging_list_messages('81000000-0000-4000-8000-000000000013',
  '82000000-0000-4000-8000-000000000001', false, 100)), 0::bigint, 'admin cannot impersonate fan-read entitlement');
select is((select count(*) from public.messaging_list_messages('81000000-0000-4000-8000-000000000001',
  '82000000-0000-4000-8000-000000000001', false, 1)), 1::bigint, 'message page honors bounded limit');
select is((select count(*) from public.messaging_list_messages('81000000-0000-4000-8000-000000000001',
  '82000000-0000-4000-8000-000000000001', false, 100, now() - interval '1 minute',
  '84000000-0000-4000-8000-000000000001')), 2::bigint, 'cursor excludes prior boundary row and returns older rows');
select throws_ok($$select * from public.messaging_list_messages('81000000-0000-4000-8000-000000000001',
  '82000000-0000-4000-8000-000000000001', false, 101)$$, '23514', 'MESSAGE_PAGE_INVALID', 'page limit cannot exceed technical ceiling');
select throws_ok($$select * from public.messaging_list_messages('81000000-0000-4000-8000-000000000001',
  '82000000-0000-4000-8000-000000000001', false, 30, now(), null)$$,
  '23514', 'MESSAGE_PAGE_INVALID', 'partial cursor is invalid');
select throws_ok($$select * from public.messaging_list_messages('81000000-0000-4000-8000-000000000001',
  '82000000-0000-4000-8000-000000000001', null, 30)$$,
  '23514', 'MESSAGE_PAGE_INVALID', 'null audience does not implicitly expose content');

select throws_ok($$select public.messaging_set_previews('81000000-0000-4000-8000-000000000011',
  '82000000-0000-4000-8000-000000000001', array['84000000-0000-4000-8000-000000000001'::uuid])$$,
  '42501', 'MESSAGE_ADMIN_REQUIRED', 'artist cannot make paid content into public previews');
select throws_ok($$select public.messaging_set_previews('81000000-0000-4000-8000-000000000013',
  '82000000-0000-4000-8000-000000000001', array['84000000-0000-4000-8000-000000000004'::uuid])$$,
  '23514', 'MESSAGE_PREVIEWS_INVALID', 'draft cannot be selected as preview');
select throws_ok($$select public.messaging_set_previews('81000000-0000-4000-8000-000000000013',
  '82000000-0000-4000-8000-000000000001', array['84000000-0000-4000-8000-000000000007'::uuid])$$,
  '23514', 'MESSAGE_PREVIEWS_INVALID', 'preview selection cannot cross artist');
select throws_ok($$select public.messaging_set_previews('81000000-0000-4000-8000-000000000013',
  '82000000-0000-4000-8000-000000000001', array['84000000-0000-4000-8000-000000000001'::uuid,
  '84000000-0000-4000-8000-000000000001'::uuid])$$,
  '23514', 'MESSAGE_PREVIEWS_INVALID', 'duplicate preview IDs fail atomically');
select throws_ok($$select public.messaging_set_previews('81000000-0000-4000-8000-000000000013',
  '82000000-0000-4000-8000-000000000001', null)$$,
  '23514', 'MESSAGE_PREVIEWS_INVALID', 'null preview list cannot silently clear selection');
select throws_ok($$select public.messaging_set_previews('81000000-0000-4000-8000-000000000013',
  '82000000-0000-4000-8000-000000000001', array['84000000-0000-4000-8000-000000000001'::uuid,
  '84000000-0000-4000-8000-000000000002'::uuid, '84000000-0000-4000-8000-000000000003'::uuid,
  '84000000-0000-4000-8000-000000000009'::uuid, '84000000-0000-4000-8000-000000000010'::uuid,
  '84000000-0000-4000-8000-000000000011'::uuid])$$,
  '23514', 'MESSAGE_PREVIEWS_INVALID', 'preview count honors configured maximum');
select lives_ok($$select public.messaging_set_previews('81000000-0000-4000-8000-000000000013',
  '82000000-0000-4000-8000-000000000001', array['84000000-0000-4000-8000-000000000010'::uuid,
  '84000000-0000-4000-8000-000000000001'::uuid])$$, 'admin selects sent same-artist previews');
select is((select preview_order from public.messages where id = '84000000-0000-4000-8000-000000000010'),
  1::smallint, 'preview ordinal follows explicit admin selection');
select is((select count(*) from public.messaging_list_messages('81000000-0000-4000-8000-000000000002',
  '82000000-0000-4000-8000-000000000001', true, 100)), 2::bigint,
  'onboarded non-subscriber sees only curated sent previews, including intentionally old previews');
select is((select count(*) from public.messaging_list_messages('81000000-0000-4000-8000-000000000014',
  '82000000-0000-4000-8000-000000000001', true, 100)), 0::bigint, 'preview is not a restricted-user bypass');
select ok((select bool_and(media = '[]'::jsonb) from public.messaging_list_messages(
  '81000000-0000-4000-8000-000000000002', '82000000-0000-4000-8000-000000000001', true, 100)),
  'text preview DTO has explicit empty media descriptors');
select is((select string_agg(k, ',' order by k) from jsonb_object_keys((select to_jsonb(m) from
  public.messaging_list_messages('81000000-0000-4000-8000-000000000002',
  '82000000-0000-4000-8000-000000000001', true, 1) m)) k),
  'artist_id,body_template,id,media,sent_at,type', 'message DTO exposes no author identity, schedule, internal flags or paths');
select is((select array_agg(id) from public.messaging_list_messages('81000000-0000-4000-8000-000000000002',
  '82000000-0000-4000-8000-000000000001', true, 100)),
  array['84000000-0000-4000-8000-000000000010'::uuid, '84000000-0000-4000-8000-000000000001'::uuid],
  'preview order follows admin curation even when opposite to descending sent time');
select throws_ok($$select * from public.messaging_list_messages('81000000-0000-4000-8000-000000000002',
  '82000000-0000-4000-8000-000000000001', true, 100, now() - interval '1 minute',
  '84000000-0000-4000-8000-000000000001')$$,
  '23514', 'MESSAGE_PAGE_INVALID', 'timestamp cursor cannot bypass curated preview order or maximum');
update private.message_policy set preview_max_count = 1;
select is((select count(*) from public.messaging_list_messages('81000000-0000-4000-8000-000000000002',
  '82000000-0000-4000-8000-000000000001', true, 100)), 1::bigint,
  'lower preview policy immediately caps existing selection without recuration');
select is((select id from public.messaging_list_messages('81000000-0000-4000-8000-000000000002',
  '82000000-0000-4000-8000-000000000001', true, 100)), '84000000-0000-4000-8000-000000000010'::uuid,
  'lowered preview cap preserves curated first message, not newest message');
update private.message_policy set preview_max_count = 0;
select is((select count(*) from public.messaging_list_messages('81000000-0000-4000-8000-000000000002',
  '82000000-0000-4000-8000-000000000001', true, 100)), 0::bigint,
  'zero preview policy immediately hides all existing previews');
update private.message_policy set preview_max_count = 5;

-- PostgREST-equivalent direct table queries must fail closed regardless of the
-- server DTO's paid/preview authorization. All lifecycle states exist above.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"81000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is((select count(*) from public.messages), 0::bigint,
  'paid fan direct raw SELECT sees zero rows across sent, preview, draft, scheduled, canceled and future fixtures');
select is((select count(*) from public.messages where is_preview), 0::bigint,
  'paid fan direct raw preview SELECT cannot bypass server personalization');
select is((select count(*) from public.messages where status in ('draft', 'scheduled', 'canceled')), 0::bigint,
  'paid fan direct raw status-filtered SELECT cannot expose private lifecycle states');
select is((select count(*) from public.messages where sent_at < now() - interval '8 days' or sent_at > now()), 0::bigint,
  'paid fan direct raw timestamp-filtered SELECT cannot expose old or future content');
select set_config('request.jwt.claims', '{"sub":"81000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select is((select count(*) from public.messages), 0::bigint,
  'non-subscriber direct raw SELECT remains empty even when safe preview DTO is available');
reset role;
select throws_ok($$update public.messages set is_preview = true, preview_order = null
  where id = '84000000-0000-4000-8000-000000000010'$$,
  '23514', null, 'owner fixture cannot create preview with NULL ordinal through SQL three-valued CHECK semantics');
update public.artists set status = 'paused' where id = '82000000-0000-4000-8000-000000000001';
set local role service_role;
select is((select count(*) from public.messaging_list_messages('81000000-0000-4000-8000-000000000001',
  '82000000-0000-4000-8000-000000000001', false, 100)), 0::bigint, 'artist pause removes paid DTO access');
select is((select count(*) from public.messaging_list_messages('81000000-0000-4000-8000-000000000002',
  '82000000-0000-4000-8000-000000000001', true, 100)), 0::bigint, 'artist pause removes preview DTO access');
reset role;
update public.artists set status = 'active' where id = '82000000-0000-4000-8000-000000000001';
update public.subscriptions set current_period_end = now() where id = '83000000-0000-4000-8000-000000000003';
update public.subscriptions set grace_ends_at = now() where id = '83000000-0000-4000-8000-000000000004';
set local role service_role;
select is((select count(*) from public.messaging_list_messages('81000000-0000-4000-8000-000000000003',
  '82000000-0000-4000-8000-000000000001', false, 100)), 0::bigint, 'canceled paid end is an exclusive access boundary');
select is((select count(*) from public.messaging_list_messages('81000000-0000-4000-8000-000000000004',
  '82000000-0000-4000-8000-000000000001', false, 100)), 0::bigint, 'grace end is exclusive without requiring expiry worker');
reset role;
update public.subscriptions set current_period_end = now() + interval '29 days' where id = '83000000-0000-4000-8000-000000000003';
update public.subscriptions set grace_ends_at = now() + interval '1 day' where id = '83000000-0000-4000-8000-000000000004';
update public.subscriptions set episode_started_at = now() where id = '83000000-0000-4000-8000-000000000001';
set local role service_role;
select is((select count(*) from public.messaging_list_messages('81000000-0000-4000-8000-000000000001',
  '82000000-0000-4000-8000-000000000001', false, 100)), 2::bigint, 'resubscription episode resets history rather than lifetime first start');
reset role;
update public.subscriptions set episode_started_at = now() - interval '1 day' where id = '83000000-0000-4000-8000-000000000001';

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"81000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
insert into message_test_context(key, stamp) values ('first-read', public.mark_message_read('84000000-0000-4000-8000-000000000001'));
select is(public.mark_message_read('84000000-0000-4000-8000-000000000001'),
  (select stamp from message_test_context where key = 'first-read'), 'repeated read mark preserves original timestamp');
select is((select count(*) from public.message_reads), 1::bigint, 'repeated read creates one own receipt');
select throws_ok($$select public.mark_message_read('84000000-0000-4000-8000-000000000004')$$,
  '42501', 'MESSAGE_NOT_VISIBLE', 'draft cannot be marked read');
select throws_ok($$select public.mark_message_read('84000000-0000-4000-8000-000000000005')$$,
  '42501', 'MESSAGE_NOT_VISIBLE', 'scheduled content cannot be marked read');
select throws_ok($$select public.mark_message_read('84000000-0000-4000-8000-000000000006')$$,
  '42501', 'MESSAGE_NOT_VISIBLE', 'canceled content cannot be newly marked read');
select throws_ok($$select public.mark_message_read('84000000-0000-4000-8000-000000000003')$$,
  '42501', 'MESSAGE_NOT_VISIBLE', 'too-old content cannot be marked read');
select throws_ok($$select public.mark_message_read('84000000-0000-4000-8000-000000000010')$$,
  '42501', 'MESSAGE_NOT_VISIBLE', 'old preview exception does not bypass paid-read history window');
select throws_ok($$select public.mark_message_read('84000000-0000-4000-8000-000000000007')$$,
  '42501', 'MESSAGE_NOT_VISIBLE', 'other artist content cannot be marked read');
select throws_ok($$select public.mark_message_read('84000000-0000-4000-8000-999999999999')$$,
  '42501', 'MESSAGE_NOT_VISIBLE', 'nonexistent message cannot create orphan receipt');
select set_config('request.jwt.claims', '{"sub":"81000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select throws_ok($$select public.mark_message_read('84000000-0000-4000-8000-000000000001')$$,
  '42501', 'MESSAGE_NOT_VISIBLE', 'non-subscriber preview view is not paid-read evidence');
select is((select count(*) from public.message_reads), 0::bigint, 'other fan cannot read receipt identities');
select set_config('request.jwt.claims', '{"sub":"81000000-0000-4000-8000-000000000014","role":"authenticated"}', true);
select throws_ok($$select public.mark_message_read('84000000-0000-4000-8000-000000000001')$$,
  '42501', 'MESSAGE_NOT_VISIBLE', 'restricted paid fan cannot mark read');
select set_config('request.jwt.claims', '{"sub":"81000000-0000-4000-8000-000000000011","role":"authenticated"}', true);
select throws_ok($$select public.mark_message_read('84000000-0000-4000-8000-000000000001')$$,
  '42501', 'MESSAGE_NOT_VISIBLE', 'artist cannot generate fan-read evidence');
select is((select count(*) from public.message_reads), 0::bigint, 'artist cannot enumerate fan receipt identities');

set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select throws_ok($$select public.messaging_cancel('81000000-0000-4000-8000-000000000011',
  '84000000-0000-4000-8000-000000000010')$$,
  '55000', 'CANCEL_WINDOW_PASSED', 'sent cancellation beyond window is denied');
select lives_ok($$select public.messaging_cancel('81000000-0000-4000-8000-000000000011',
  '84000000-0000-4000-8000-000000000001')$$, 'visible recently-sent preview can be canceled by member');
select ok((select status = 'canceled' and not is_preview and preview_order is null from public.messages
  where id = '84000000-0000-4000-8000-000000000001'), 'cancel atomically removes preview status');
select is((select count(*) from public.message_reads where message_id = '84000000-0000-4000-8000-000000000001'),
  1::bigint, 'cancel retains historical read evidence');
select is((select count(*) from public.messaging_list_messages('81000000-0000-4000-8000-000000000002',
  '82000000-0000-4000-8000-000000000001', true, 100)), 1::bigint, 'canceled preview immediately disappears from DTO');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"81000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select throws_ok($$select public.mark_message_read('84000000-0000-4000-8000-000000000001')$$,
  '42501', 'MESSAGE_NOT_VISIBLE', 'canceled repeat read is denied even when historical receipt exists');
select is((select read_at from public.message_reads where message_id = '84000000-0000-4000-8000-000000000001'),
  (select stamp from message_test_context where key = 'first-read'), 'historical own receipt stays unchanged after cancel');

set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select throws_ok($$select public.messaging_create_reply('81000000-0000-4000-8000-000000000002',
  '82000000-0000-4000-8000-000000000001', '비구독 답장')$$,
  '42501', 'REPLY_SUBSCRIPTION_REQUIRED', 'non-subscriber cannot reply');
select throws_ok($$select public.messaging_create_reply('81000000-0000-4000-8000-000000000001',
  '82000000-0000-4000-8000-000000000002', '다른 가수 답장')$$,
  '42501', 'REPLY_SUBSCRIPTION_REQUIRED', 'reply requires the relevant artist subscription');
select throws_ok($$select public.messaging_create_reply('81000000-0000-4000-8000-000000000011',
  '82000000-0000-4000-8000-000000000001', '가수 답장')$$,
  '42501', 'REPLY_FORBIDDEN', 'subscribed artist is not allowed to reply as fan');
select throws_ok($$select public.messaging_create_reply('81000000-0000-4000-8000-000000000013',
  '82000000-0000-4000-8000-000000000001', '관리자 답장')$$,
  '42501', 'REPLY_FORBIDDEN', 'admin is not allowed to reply as fan');
select throws_ok($$select public.messaging_create_reply('81000000-0000-4000-8000-000000000014',
  '82000000-0000-4000-8000-000000000001', '제한 답장')$$,
  '42501', 'REPLY_FORBIDDEN', 'restricted fan cannot reply');
select throws_ok($$select public.messaging_create_reply('81000000-0000-4000-8000-000000000015',
  '82000000-0000-4000-8000-000000000001', '미완료 답장')$$,
  '42501', 'REPLY_FORBIDDEN', 'incomplete onboarding cannot reply');
select throws_ok($$select public.messaging_create_reply('81000000-0000-4000-8000-000000000001',
  '82000000-0000-4000-8000-000000000003', '중지 답장')$$,
  '42501', 'REPLY_FORBIDDEN', 'paused artist cannot receive replies');
select throws_ok($$select public.messaging_create_reply('81000000-0000-4000-8000-000000000001',
  '82000000-0000-4000-8000-000000000001', null)$$,
  '23514', 'REPLY_CONTENT_INVALID', 'reply text is required');
select throws_ok($$select public.messaging_create_reply('81000000-0000-4000-8000-000000000001',
  '82000000-0000-4000-8000-000000000001', '   ')$$,
  '23514', 'REPLY_CONTENT_INVALID', 'blank reply fails structural check');
select throws_ok($$select public.messaging_create_reply('81000000-0000-4000-8000-000000000001',
  '82000000-0000-4000-8000-000000000001', repeat('가', 101))$$,
  '23514', 'REPLY_CONTENT_INVALID', 'reply length is rechecked at trusted database boundary');
insert into message_test_context(key, id) values ('reply', public.messaging_create_reply(
  '81000000-0000-4000-8000-000000000001', '82000000-0000-4000-8000-000000000001', repeat('가', 100)));
select is((select subscription_id from public.replies where id = (select id from message_test_context where key = 'reply')),
  '83000000-0000-4000-8000-000000000001'::uuid, 'reply links the actual relevant subscription');
select lives_ok($$select public.messaging_create_reply('81000000-0000-4000-8000-000000000003',
  '82000000-0000-4000-8000-000000000001', '해지 후 유료기간 답장')$$, 'canceled but paid fan may reply');
select lives_ok($$select public.messaging_create_reply('81000000-0000-4000-8000-000000000004',
  '82000000-0000-4000-8000-000000000001', '유예 답장')$$, 'fan in live grace may reply');
select throws_ok($$select public.messaging_create_reply('81000000-0000-4000-8000-000000000005',
  '82000000-0000-4000-8000-000000000001', '만료 답장')$$,
  '42501', 'REPLY_SUBSCRIPTION_REQUIRED', 'expired fan may not reply');
select is((select count(*) from public.messaging_list_replies('81000000-0000-4000-8000-000000000011',
  '82000000-0000-4000-8000-000000000001', 100)), 3::bigint, 'member sees relevant unblocked reply DTOs');
select is((select string_agg(k, ',' order by k) from jsonb_object_keys((select to_jsonb(r) from
  public.messaging_list_replies('81000000-0000-4000-8000-000000000011',
  '82000000-0000-4000-8000-000000000001', 1) r)) k),
  'body,call_name,created_at,id', 'reply DTO has only safe calling name and no user identity, phone, nickname or subscription');
select is((select call_name from public.messaging_list_replies('81000000-0000-4000-8000-000000000011',
  '82000000-0000-4000-8000-000000000001', 1)), '안전한이름', 'reply feed uses calling name only');
select throws_ok($$select * from public.messaging_list_replies('81000000-0000-4000-8000-000000000012',
  '82000000-0000-4000-8000-000000000001', 100)$$,
  '42501', 'MESSAGE_AUTHOR_FORBIDDEN', 'unrelated artist cannot read reply feed');
select throws_ok($$select * from public.messaging_list_replies('81000000-0000-4000-8000-000000000001',
  '82000000-0000-4000-8000-000000000001', 100)$$,
  '42501', 'MESSAGE_AUTHOR_FORBIDDEN', 'fan cannot read artist reply feed');
select throws_ok($$select * from public.messaging_list_replies('81000000-0000-4000-8000-000000000011',
  '82000000-0000-4000-8000-000000000001', 0)$$,
  '23514', 'MESSAGE_PAGE_INVALID', 'reply feed page size is bounded');
reset role;
update public.replies set is_blocked = true where id = (select id from message_test_context where key = 'reply');
set local role service_role;
select is((select count(*) from public.messaging_list_replies('81000000-0000-4000-8000-000000000011',
  '82000000-0000-4000-8000-000000000001', 100)), 2::bigint, 'blocked replies disappear from artist feed');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"81000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select throws_ok($$select * from public.replies$$,'42501',null,'fan cannot bypass redacted own reply DTO');
select is((select replies->0->'body' from public.fan_reply_page('message-main')),'null'::jsonb,'own blocked reply keeps status without raw body');
select set_config('request.jwt.claims', '{"sub":"81000000-0000-4000-8000-000000000011","role":"authenticated"}', true);
select throws_ok($$select * from public.replies$$,'42501',null,'artist raw reply table cannot leak user IDs');
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
insert into message_test_context(key, id) values ('revoked-due', public.messaging_save_draft(
  '81000000-0000-4000-8000-000000000011', '82000000-0000-4000-8000-000000000001', null, 'text', '권한 확인 발송'));
select public.messaging_schedule('81000000-0000-4000-8000-000000000011',
  (select id from message_test_context where key = 'revoked-due'), now());
reset role;
update public.artists set status = 'paused' where id = '82000000-0000-4000-8000-000000000001';
set local role service_role;
select throws_ok($$select public.messaging_dispatch((select id from message_test_context where key = 'revoked-due'))$$,
  '42501', 'MESSAGE_ARTIST_UNAVAILABLE', 'dispatch rechecks artist status rather than trusting scheduling authorization');
reset role;
update public.artists set status = 'active' where id = '82000000-0000-4000-8000-000000000001';
update public.profiles set is_restricted = true where id = '81000000-0000-4000-8000-000000000011';
set local role service_role;
select throws_ok($$select public.messaging_save_draft('81000000-0000-4000-8000-000000000011',
  '82000000-0000-4000-8000-000000000001', null, 'text', '제한된 작성')$$,
  '42501', 'MESSAGE_AUTHOR_FORBIDDEN', 'artist restriction removes authoring capability');
select throws_ok($$select * from public.messaging_list_replies('81000000-0000-4000-8000-000000000011',
  '82000000-0000-4000-8000-000000000001', 100)$$,
  '42501', 'MESSAGE_AUTHOR_FORBIDDEN', 'artist restriction removes reply feed capability');
select throws_ok($$select public.messaging_dispatch((select id from message_test_context where key = 'revoked-due'))$$,
  '42501', 'MESSAGE_AUTHOR_FORBIDDEN', 'dispatch rechecks author restrictions after scheduling');
reset role;
update public.profiles set is_restricted = false where id = '81000000-0000-4000-8000-000000000011';
delete from public.artist_members where user_id = '81000000-0000-4000-8000-000000000011'
  and artist_id = '82000000-0000-4000-8000-000000000001';
set local role service_role;
select throws_ok($$select public.messaging_cancel('81000000-0000-4000-8000-000000000011',
  '84000000-0000-4000-8000-000000000001')$$,
  '42501', 'MESSAGE_AUTHOR_FORBIDDEN', 'revoked membership cannot replay cancellation or regain ownership');
select throws_ok($$select public.messaging_dispatch((select id from message_test_context where key = 'revoked-due'))$$,
  '42501', 'MESSAGE_AUTHOR_FORBIDDEN', 'dispatch rechecks membership after scheduling');
select is((select status::text from public.messages where id = (select id from message_test_context where key = 'revoked-due')),
  'scheduled', 'rejected dispatch keeps unsent content private rather than marking success');

reset role;
select * from finish();
rollback;
