begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
set local timezone='UTC';
select no_plan();
select is((select count(*) from private.reply_policy),0::bigint,'no live reply policy is activated');
select ok((select bool_and(p.prosecdef and 'search_path=""'=any(p.proconfig)) from pg_proc p
 where p.oid in('public.fan_reply_send(text,uuid,text,uuid)'::regprocedure,'public.fan_reply_page(text,integer,timestamptz,uuid)'::regprocedure)),
 'self-only reply capabilities have pinned definer search paths');
select ok(has_function_privilege('authenticated','public.fan_reply_send(text,uuid,text,uuid)','EXECUTE'),'actor may submit own reply');
select ok(has_function_privilege('authenticated','public.fan_reply_page(text,integer,timestamptz,uuid)','EXECUTE'),'actor may page own replies');
select ok((select bool_and(not has_function_privilege(r,'public.fan_reply_send(text,uuid,text,uuid)','EXECUTE')
 and not has_function_privilege(r,'public.fan_reply_page(text,integer,timestamptz,uuid)','EXECUTE')) from unnest(array['anon','service_role']) r),
 'neither anonymous nor privileged service can forge authenticated replies');
select ok(not has_function_privilege('authenticated','private.fan_reply_create(uuid,text,uuid,text,uuid)','EXECUTE'),'caller cannot choose another actor');
select ok(not has_table_privilege('authenticated','public.replies','SELECT'),'raw reply bodies are unavailable to browser roles');
select ok(has_table_privilege('service_role','private.reply_policy','SELECT,INSERT,UPDATE'),'trusted settings service may provision an approved snapshot without browser capability');
select ok(not has_table_privilege('authenticated','private.reply_policy','SELECT,INSERT,UPDATE'),'browser cannot read or activate moderation policy');
select ok((select not(proargnames && array['p_actor_id','p_user_id','p_created_at','p_is_blocked']) from pg_proc
 where oid='public.fan_reply_send(text,uuid,text,uuid)'::regprocedure),'self send accepts no actor/time/moderation status');

insert into auth.users(id,email,raw_user_meta_data)
select ('f7100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'reply-fixture-'||n||'@example.invalid','{}'::jsonb from generate_series(1,9) n;
update public.profiles set role='artist' where id='f7100000-0000-4000-8000-000000000009';
insert into public.artists(id,slug,name,intro,grade,status,agency_name) values
 ('f7200000-0000-4000-8000-000000000001','reply-main','허구 대화 가수','허구 소개','B','active','PRIVATE AGENCY'),
 ('f7200000-0000-4000-8000-000000000002','reply-other','허구 다른 가수',null,'B','active',null),
 ('f7200000-0000-4000-8000-000000000003','reply-hidden','허구 숨긴 가수',null,'B','paused',null);
insert into public.artist_members(artist_id,user_id) values('f7200000-0000-4000-8000-000000000001','f7100000-0000-4000-8000-000000000009');
insert into private.onboarding_documents(version,kind,title,body,approved_at,published_at) values
 ('f7900000-0000-4000-8000-000000000001','terms','Fictional terms','Rollback test only.',now(),now()),
 ('f7900000-0000-4000-8000-000000000002','privacy','Fictional privacy','Rollback test only.',now(),now()),
 ('f7900000-0000-4000-8000-000000000003','terms','Fictional replacement','Rollback test only.',now(),now());
insert into private.profile_onboarding_policy values(true,'f7800000-0000-4000-8000-000000000001',now(),2,10,array['금지단어'],
 'f7900000-0000-4000-8000-000000000001','f7900000-0000-4000-8000-000000000002',null);
set local role authenticated;
select set_config('request.jwt.claim.sub','f7100000-0000-4000-8000-000000000001',true);
select public.onboarding_save_font('normal');
select public.onboarding_save_name('허구팬1');
select public.onboarding_complete_profile(true,true,'f7900000-0000-4000-8000-000000000001',true,'f7900000-0000-4000-8000-000000000002');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','f7100000-0000-4000-8000-000000000002',true);
select public.onboarding_save_font('normal');
select public.onboarding_save_name('허구팬2');
select public.onboarding_complete_profile(true,true,'f7900000-0000-4000-8000-000000000001',true,'f7900000-0000-4000-8000-000000000002');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','f7100000-0000-4000-8000-000000000003',true);
select public.onboarding_save_font('normal');
select public.onboarding_save_name('허구팬3');
select public.onboarding_complete_profile(true,true,'f7900000-0000-4000-8000-000000000001',true,'f7900000-0000-4000-8000-000000000002');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','f7100000-0000-4000-8000-000000000004',true);
select public.onboarding_save_font('normal');
select public.onboarding_save_name('허구팬4');
select public.onboarding_complete_profile(true,true,'f7900000-0000-4000-8000-000000000001',true,'f7900000-0000-4000-8000-000000000002');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','f7100000-0000-4000-8000-000000000005',true);
select public.onboarding_save_font('normal');
select public.onboarding_save_name('허구팬5');
select public.onboarding_complete_profile(true,true,'f7900000-0000-4000-8000-000000000001',true,'f7900000-0000-4000-8000-000000000002');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','f7100000-0000-4000-8000-000000000006',true);
select public.onboarding_save_font('normal');
select public.onboarding_save_name('허구팬6');
select public.onboarding_complete_profile(true,true,'f7900000-0000-4000-8000-000000000001',true,'f7900000-0000-4000-8000-000000000002');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','f7100000-0000-4000-8000-000000000007',true);
select public.onboarding_save_font('normal');
select public.onboarding_save_name('허구팬7');
select public.onboarding_complete_profile(true,true,'f7900000-0000-4000-8000-000000000001',true,'f7900000-0000-4000-8000-000000000002');
reset role;
update public.profiles set onboarding_completed_at=clock_timestamp() where id in
 ('f7100000-0000-4000-8000-000000000001','f7100000-0000-4000-8000-000000000002','f7100000-0000-4000-8000-000000000003',
  'f7100000-0000-4000-8000-000000000004','f7100000-0000-4000-8000-000000000005','f7100000-0000-4000-8000-000000000006');
insert into public.subscriptions(id,user_id,artist_id,provider,status,first_started_at,episode_started_at,current_period_start,current_period_end,canceled_at,grace_started_at,grace_ends_at)
select ('f7300000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 ('f7100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'f7200000-0000-4000-8000-000000000001','toss',
 (case n when 3 then 'canceled' when 4 then 'grace' when 5 then 'expired' else 'active' end)::public.subscription_status,
 now()-interval '100 days',now()-interval '1 day',now()-interval '1 day',
 case when n in(4,5) then now()-interval '1 hour' else now()+interval '29 days' end,
 case when n=3 then now()-interval '1 hour' end,
 case when n=4 then now()-interval '1 hour' end,case when n=4 then now()+interval '1 day' end
from unnest(array[1,3,4,5,6,7]) n;
insert into private.message_policy values(true,'fictional-reply-policy',604800,300,1000,100,10,180,60,5,10485760,20971520,104857600);
insert into public.messages(id,artist_id,author_id,type,body,status,scheduled_at,sent_at)
select ('f7400000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 'f7200000-0000-4000-8000-000000000001','f7100000-0000-4000-8000-000000000009','text','안녕 {이름} '||n,'sent',
 now()-interval '1 hour',now()-interval '1 hour' from generate_series(1,5) n;
insert into public.messages(id,artist_id,author_id,type,body,status,scheduled_at,sent_at,is_preview,preview_order,canceled_at) values
 ('f7400000-0000-4000-8000-000000000006','f7200000-0000-4000-8000-000000000001','f7100000-0000-4000-8000-000000000009','text','exact-history-boundary','sent',now()-interval '8 days',now()-interval '8 days',false,null,null),
 ('f7400000-0000-4000-8000-000000000007','f7200000-0000-4000-8000-000000000001','f7100000-0000-4000-8000-000000000009','text','too-old-preview','sent',now()-interval '8 days 1 microsecond',now()-interval '8 days 1 microsecond',true,1,null),
 ('f7400000-0000-4000-8000-000000000008','f7200000-0000-4000-8000-000000000001','f7100000-0000-4000-8000-000000000009','text','PRIVATE-DRAFT','draft',null,null,false,null,null),
 ('f7400000-0000-4000-8000-000000000009','f7200000-0000-4000-8000-000000000001','f7100000-0000-4000-8000-000000000009','text','PRIVATE-SCHEDULED','scheduled',now()+interval '1 day',null,false,null,null),
 ('f7400000-0000-4000-8000-000000000010','f7200000-0000-4000-8000-000000000001','f7100000-0000-4000-8000-000000000009','text','PRIVATE-FUTURE','sent',now()+interval '1 day',now()+interval '1 day',false,null,null),
 ('f7400000-0000-4000-8000-000000000011','f7200000-0000-4000-8000-000000000001','f7100000-0000-4000-8000-000000000009','text','PRIVATE-CANCELED','canceled',now()-interval '1 hour',now()-interval '1 hour',false,null,now()),
 ('f7400000-0000-4000-8000-000000000012','f7200000-0000-4000-8000-000000000002','f7100000-0000-4000-8000-000000000009','text','PRIVATE-OTHER','sent',now()-interval '1 hour',now()-interval '1 hour',false,null,null);

create temporary table reply_context(key text primary key,data jsonb);
grant all on reply_context to authenticated,service_role;
set local role authenticated;
select set_config('request.jwt.claim.sub','f7100000-0000-4000-8000-000000000001',true);
select ok((select not send_ready and max_length=100 and replies='[]'::jsonb and not has_more from public.fan_reply_page('reply-main')),
 'missing send policy preserves empty own feed but disables sending');
select throws_ok($$select * from public.fan_reply_send('reply-main','f7700000-0000-4000-8000-000000000001','정상 답장')$$,
 '55000','REPLY_SETUP_NOT_READY','missing policy never permits send');
reset role;
insert into private.reply_policy values(true,'fictional-reply-policy',now(),60,100,array['금지단어','BadWord'],array['phone','account','url']);
set local role authenticated;
select ok((select send_ready from public.fan_reply_page('reply-main')),'approved fictional policy enables send');
insert into reply_context values('accepted',(select to_jsonb(r) from public.fan_reply_send('reply-main','f7700000-0000-4000-8000-000000000001','  정상 답장  ') r));
select is((select body from public.fan_reply_send('reply-main','f7700000-0000-4000-8000-000000000001','  정상 답장  ')),
 '  정상 답장  ','exact body is retained, not silently trimmed or normalized');
select is((select to_jsonb(r) from public.fan_reply_send('reply-main','f7700000-0000-4000-8000-000000000001','  정상 답장  ') r),
 (select data from reply_context where key='accepted'),'exact replay returns original identity and timestamp');
select throws_ok($$select * from public.fan_reply_send('reply-main','f7700000-0000-4000-8000-000000000001','정상 답장')$$,
 '23505','REPLY_OPERATION_CONFLICT','same key cannot mutate whitespace or content');
select throws_ok($$select * from public.fan_reply_send('reply-main','f7700000-0000-4000-8000-000000000001','  정상 답장  ','f7400000-0000-4000-8000-000000000001')$$,
 '23505','REPLY_OPERATION_CONFLICT','same key cannot change message binding');
select is((select replies->0->>'body' from public.fan_reply_page('reply-main')),'  정상 답장  ','own feed returns accepted plain text');
select is((select string_agg(k,',' order by k) from jsonb_object_keys((select replies->0 from public.fan_reply_page('reply-main'))) k),
 'body,created_at,id,is_blocked,message_id,operation_id','own reply DTO omits user/subscription/artist identities');
reset role;
select is((select count(*) from public.replies),1::bigint,'replays do not insert another row');
select is((select count from private.reply_rate_limits where user_id='f7100000-0000-4000-8000-000000000001'),1,'replays spend quota once');
select is((select subscription_id from public.replies),'f7300000-0000-4000-8000-000000000001'::uuid,'database binds actual actor subscription');
select is((select count(*) from private.point_ledger),0::bigint,'reply creates no points');
select is((select count(*) from public.message_reads),0::bigint,'reply creates no read evidence');
set local role authenticated;
select throws_ok($$select * from public.fan_reply_send('reply-main',gen_random_uuid(),'')$$,'23514','REPLY_CONTENT_INVALID','empty is rejected');
select throws_ok($$select * from public.fan_reply_send('reply-main',gen_random_uuid(),E' \t\n ')$$,'23514','REPLY_CONTENT_INVALID','whitespace is rejected');
select throws_ok($$select * from public.fan_reply_send('reply-main',gen_random_uuid(),repeat('가',101))$$,'23514','REPLY_TOO_LONG','over length is rejected');
select throws_ok($$select * from public.fan_reply_send('reply-main',gen_random_uuid(),U&'숨김\200B문자')$$,'23514','REPLY_CONTENT_INVALID','zero width is rejected');
select throws_ok($$select * from public.fan_reply_send('reply-main',gen_random_uuid(),E'제어\001문자')$$,'23514','REPLY_CONTENT_INVALID','control is rejected');
select throws_ok($$select * from public.fan_reply_send('reply-main',gen_random_uuid(),'금지단어 포함')$$,'23514','REPLY_FORBIDDEN_CONTENT','literal profanity is rejected');
select throws_ok($$select * from public.fan_reply_send('reply-main',gen_random_uuid(),'BaDwOrD')$$,'23514','REPLY_FORBIDDEN_CONTENT','case folded profanity is rejected');
select throws_ok($$select * from public.fan_reply_send('reply-main',gen_random_uuid(),'ＢＡＤＷＯＲＤ')$$,'23514','REPLY_FORBIDDEN_CONTENT','compatibility normalized profanity is rejected');
select throws_ok($$select * from public.fan_reply_send('reply-main',gen_random_uuid(),'전화 010-1234-5678')$$,'23514','REPLY_FORBIDDEN_CONTENT','phone is rejected');
select throws_ok($$select * from public.fan_reply_send('reply-main',gen_random_uuid(),'전화 ０１０－１２３４－５６７８')$$,'23514','REPLY_FORBIDDEN_CONTENT','full width phone is rejected');
select throws_ok($$select * from public.fan_reply_send('reply-main',gen_random_uuid(),'계좌 123-456-789012')$$,'23514','REPLY_FORBIDDEN_CONTENT','account is rejected');
select throws_ok($$select * from public.fan_reply_send('reply-main',gen_random_uuid(),'https://example.invalid')$$,'23514','REPLY_FORBIDDEN_CONTENT','scheme URL is rejected');
select throws_ok($$select * from public.fan_reply_send('reply-main',gen_random_uuid(),'www.example.invalid')$$,'23514','REPLY_FORBIDDEN_CONTENT','www URL is rejected');
select throws_ok($$select * from public.fan_reply_send('reply-main',gen_random_uuid(),U&'\00A0\3000')$$,'23514','REPLY_CONTENT_INVALID','compatibility-only whitespace is not content');
select throws_ok($$select * from public.fan_reply_send('reply-main',gen_random_uuid(),'example.app')$$,'23514','REPLY_FORBIDDEN_CONTENT','generic application domain blocked');
select throws_ok($$select * from public.fan_reply_send('reply-main',gen_random_uuid(),'example.dev')$$,'23514','REPLY_FORBIDDEN_CONTENT','generic development domain blocked');
select throws_ok($$select * from public.fan_reply_send('reply-main',gen_random_uuid(),'example.kr')$$,'23514','REPLY_FORBIDDEN_CONTENT','bare domain is rejected');
select throws_ok($$select * from public.fan_reply_send(null,gen_random_uuid(),'정상')$$,'22023','REPLY_INVALID_INPUT','null slug rejected');
select throws_ok($$select * from public.fan_reply_send('BAD',gen_random_uuid(),'정상')$$,'22023','REPLY_INVALID_INPUT','invalid slug rejected');
select throws_ok($$select * from public.fan_reply_send('reply-main',null,'정상')$$,'22023','REPLY_INVALID_INPUT','null key rejected');
select throws_ok($$select * from public.fan_reply_send('reply-main',gen_random_uuid(),null)$$,'22023','REPLY_INVALID_INPUT','null body rejected');
select throws_ok($$select * from public.fan_reply_send('reply-main',gen_random_uuid(),repeat('가',10001))$$,'22023','REPLY_INVALID_INPUT','structural ceiling rejected');
select throws_ok($$select * from public.fan_reply_send('reply-main',gen_random_uuid(),'정상','f7400000-0000-4000-8000-000000000007')$$,'42501','REPLY_MESSAGE_NOT_VISIBLE','out of paid history preview cannot be reply target');
select throws_ok($$select * from public.fan_reply_send('reply-main',gen_random_uuid(),'정상','f7400000-0000-4000-8000-000000000008')$$,'42501','REPLY_MESSAGE_NOT_VISIBLE','draft cannot be reply target');
select throws_ok($$select * from public.fan_reply_send('reply-main',gen_random_uuid(),'정상','f7400000-0000-4000-8000-000000000009')$$,'42501','REPLY_MESSAGE_NOT_VISIBLE','scheduled cannot be reply target');
select throws_ok($$select * from public.fan_reply_send('reply-main',gen_random_uuid(),'정상','f7400000-0000-4000-8000-000000000010')$$,'42501','REPLY_MESSAGE_NOT_VISIBLE','future sent cannot be reply target');
select throws_ok($$select * from public.fan_reply_send('reply-main',gen_random_uuid(),'정상','f7400000-0000-4000-8000-000000000011')$$,'42501','REPLY_MESSAGE_NOT_VISIBLE','canceled cannot be reply target');
select throws_ok($$select * from public.fan_reply_send('reply-main',gen_random_uuid(),'정상','f7400000-0000-4000-8000-000000000012')$$,'42501','REPLY_MESSAGE_NOT_VISIBLE','other artist cannot be reply target');
select throws_ok($$select * from public.fan_reply_send('reply-hidden',gen_random_uuid(),'정상')$$,'P0002','REPLY_NOT_FOUND','paused artist not available');
insert into reply_context values('bound',(select to_jsonb(r) from public.fan_reply_send('reply-main','f7700000-0000-4000-8000-000000000002','메시지 답장','f7400000-0000-4000-8000-000000000006') r));
select is((select data->>'message_id' from reply_context where key='bound'),'f7400000-0000-4000-8000-000000000006','exact paid history boundary target accepted');
select lives_ok($$select * from public.fan_reply_send('reply-main',gen_random_uuid(),repeat('😀',100))$$,'exact Unicode codepoint limit accepted');
select lives_ok($$select * from public.fan_reply_send('reply-main',gen_random_uuid(),E'여러 줄\n답장')$$,'plain multiline text accepted');
select set_config('request.jwt.claim.sub','f7100000-0000-4000-8000-000000000002',true);
select throws_ok($$select * from public.fan_reply_send('reply-main',gen_random_uuid(),'정상')$$,'42501','REPLY_SUBSCRIPTION_REQUIRED','unsubscribed send denied');
select throws_ok($$select * from public.fan_reply_page('reply-main')$$,'42501','REPLY_SUBSCRIPTION_REQUIRED','unsubscribed page denied');
select set_config('request.jwt.claim.sub','f7100000-0000-4000-8000-000000000005',true);
select throws_ok($$select * from public.fan_reply_send('reply-main',gen_random_uuid(),'정상')$$,'42501','REPLY_SUBSCRIPTION_REQUIRED','expired send denied');
select throws_ok($$select * from public.fan_reply_page('reply-main')$$,'42501','REPLY_SUBSCRIPTION_REQUIRED','expired page denied');
select set_config('request.jwt.claim.sub','f7100000-0000-4000-8000-000000000007',true);
select throws_ok($$select * from public.fan_reply_send('reply-main',gen_random_uuid(),'정상')$$,'55000','REPLY_PROFILE_REQUIRED','onboarding unfinished send denied');
select throws_ok($$select * from public.fan_reply_page('reply-main')$$,'55000','REPLY_PROFILE_REQUIRED','onboarding unfinished page denied');
select set_config('request.jwt.claim.sub','f7100000-0000-4000-8000-000000000008',true);
select throws_ok($$select * from public.fan_reply_send('reply-main',gen_random_uuid(),'정상')$$,'55000','DISCOVERY_PROFILE_REQUIRED','profile incomplete send denied');
select throws_ok($$select * from public.fan_reply_page('reply-main')$$,'55000','DISCOVERY_PROFILE_REQUIRED','profile incomplete page denied');
select set_config('request.jwt.claim.sub','f7100000-0000-4000-8000-000000000009',true);
select throws_ok($$select * from public.fan_reply_send('reply-main',gen_random_uuid(),'정상')$$,'42501','DISCOVERY_FORBIDDEN','artist role send denied');
select throws_ok($$select * from public.fan_reply_page('reply-main')$$,'42501','DISCOVERY_FORBIDDEN','artist role page denied');
select set_config('request.jwt.claim.sub','f7100000-0000-4000-8000-000000000003',true);
select lives_ok($$select * from public.fan_reply_send('reply-main','f7700000-0000-4000-8000-000000000001','다른 팬의 독립 키')$$,'canceled through paid end permits own send and independent same UUID');
select is((select jsonb_array_length(replies) from public.fan_reply_page('reply-main')),1,'canceled through paid end page contains only own row');
select set_config('request.jwt.claim.sub','f7100000-0000-4000-8000-000000000004',true);
select lives_ok($$select * from public.fan_reply_send('reply-main','f7700000-0000-4000-8000-000000000001','다른 팬의 독립 키')$$,'current grace permits own send and independent same UUID');
select is((select jsonb_array_length(replies) from public.fan_reply_page('reply-main')),1,'current grace page contains only own row');
select set_config('request.jwt.claim.sub','f7100000-0000-4000-8000-000000000001',true);
select throws_ok($$select * from public.fan_reply_page('reply-main',0)$$,'22023','REPLY_INVALID_INPUT','zero page rejected');
select throws_ok($$select * from public.fan_reply_page('reply-main',101)$$,'22023','REPLY_INVALID_INPUT','over page rejected');
select throws_ok($$select * from public.fan_reply_page('reply-main',null)$$,'22023','REPLY_INVALID_INPUT','null page rejected');
select throws_ok($$select * from public.fan_reply_page('reply-main',30,now(),null)$$,'22023','REPLY_INVALID_INPUT','half timestamp cursor rejected');
select throws_ok($$select * from public.fan_reply_page('reply-main',30,null,gen_random_uuid())$$,'22023','REPLY_INVALID_INPUT','half UUID cursor rejected');
select throws_ok($$select * from public.fan_reply_page('reply-main',30,'infinity',gen_random_uuid())$$,'22023','REPLY_INVALID_INPUT','infinite cursor rejected');
select throws_ok($$select * from public.fan_reply_page('BAD')$$,'22023','REPLY_INVALID_INPUT','invalid slug rejected');
reset role;
select is((select count from private.reply_rate_limits where user_id='f7100000-0000-4000-8000-000000000001'),4,'invalid/moderated/target failures consumed no quota');

set local role authenticated;
select lives_ok($$select * from public.fan_reply_send('reply-main',gen_random_uuid(),'고마워요.사랑해요')$$,'ordinary Korean sentence punctuation is not mistaken for a bare domain');
reset role;
-- Current privilege changes affect sends and own history, never delete records.
update public.profiles set is_restricted=true where id='f7100000-0000-4000-8000-000000000001';
set local role authenticated;
select throws_ok($$select * from public.fan_reply_send('reply-main','f7700000-0000-4000-8000-000000000001','  정상 답장  ')$$,'42501','DISCOVERY_FORBIDDEN','restriction also denies old accepted operation response');
select throws_ok($$select * from public.fan_reply_page('reply-main')$$,'42501','DISCOVERY_FORBIDDEN','restriction denies retained own page');
reset role;
update public.profiles set restricted_until=clock_timestamp()-interval '1 second' where id='f7100000-0000-4000-8000-000000000001';
set local role authenticated;
select lives_ok($$select * from public.fan_reply_page('reply-main')$$,'expired restriction restores own feed');
reset role;
update private.reply_policy set rate_max_count=1;
set local role authenticated;
select throws_ok($$select * from public.fan_reply_send('reply-main',gen_random_uuid(),'할당량 초과')$$,'P0001','REPLY_RATE_LIMITED','new operation cannot exceed current atomic quota');
select is((select to_jsonb(r) from public.fan_reply_send('reply-main','f7700000-0000-4000-8000-000000000001','  정상 답장  ') r),
 (select data from reply_context where key='accepted'),'replay reconciles accepted write even when quota is exhausted');
reset role;
update private.reply_rate_limits set started_at=clock_timestamp()-interval '61 seconds' where user_id='f7100000-0000-4000-8000-000000000001';
set local role authenticated;
select lives_ok($$select * from public.fan_reply_send('reply-main',gen_random_uuid(),'새 제한 시간')$$,'elapsed fixed window permits a new operation');
reset role;
select is((select count from private.reply_rate_limits where user_id='f7100000-0000-4000-8000-000000000001'),1,'new window resets count atomically');
update private.reply_policy set rate_max_count=100,approved_at=clock_timestamp()+interval '1 day';
set local role authenticated;
select ok((select not send_ready from public.fan_reply_page('reply-main')),'future approval is not send ready');
select throws_ok($$select * from public.fan_reply_send('reply-main',gen_random_uuid(),'정상')$$,'55000','REPLY_SETUP_NOT_READY','future approval cannot send');
reset role;
update private.reply_policy set approved_at=now(),forbidden_terms=array[''];
set local role authenticated;
select ok((select not send_ready from public.fan_reply_page('reply-main')),'malformed operator terms fail readiness');
select throws_ok($$select * from public.fan_reply_send('reply-main',gen_random_uuid(),'정상')$$,'55000','REPLY_SETUP_NOT_READY','malformed operator terms do not allow all content');
reset role;
update private.reply_policy set forbidden_terms=array['금지단어'];
select throws_ok($$update private.reply_policy set forbidden_patterns=array['(a+)+']$$,'23514',null,'arbitrary operator regex is not executable configuration');
select throws_ok($$update private.reply_policy set forbidden_terms=array[]::text[]$$,'23514',null,'empty moderation dataset cannot be approved');
select throws_ok($$update private.reply_policy set rate_max_count=0$$,'23514',null,'zero rate maximum is invalid');
select throws_ok($$update private.reply_policy set rate_window_seconds=3601$$,'23514',null,'unbounded rate window is invalid');
-- Current source cancellation does not rewrite an already accepted immutable reply.
update public.messages set status='canceled',canceled_at=clock_timestamp() where id='f7400000-0000-4000-8000-000000000006';
set local role authenticated;
select is((select to_jsonb(r) from public.fan_reply_send('reply-main','f7700000-0000-4000-8000-000000000002','메시지 답장','f7400000-0000-4000-8000-000000000006') r),
 (select data from reply_context where key='bound'),'lost-response replay survives later target cancellation without new insert');
reset role;
update public.replies set is_blocked=true where operation_id='f7700000-0000-4000-8000-000000000001' and user_id='f7100000-0000-4000-8000-000000000001';
set local role authenticated;
select ok((select is_blocked and body is null from public.fan_reply_send('reply-main','f7700000-0000-4000-8000-000000000001','  정상 답장  ')),'replay of later blocked reply redacts body');
select is((select r->'body' from public.fan_reply_page('reply-main') p,jsonb_array_elements(p.replies) r where r->>'operation_id'='f7700000-0000-4000-8000-000000000001'),
 'null'::jsonb,'own feed redacts blocked body while retaining status');
select throws_ok($$select body from public.replies$$,'42501',null,'raw table cannot bypass blocked redaction');
reset role;
-- Stable old pages include own legacy rows and subscription-episode history.
insert into public.replies(id,user_id,artist_id,subscription_id,body,created_at)
select ('f7800000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'f7100000-0000-4000-8000-000000000001',
 'f7200000-0000-4000-8000-000000000001','f7300000-0000-4000-8000-000000000001','과거 답장 '||n,
 '2020-01-01 00:00:00.123456+00'::timestamptz from generate_series(1,5) n;
insert into public.subscriptions(id,user_id,artist_id,provider,status,first_started_at,episode_started_at,current_period_start,current_period_end)
values('f7300000-0000-4000-8000-000000000099','f7100000-0000-4000-8000-000000000001','f7200000-0000-4000-8000-000000000002','toss','active',now(),now(),now(),now()+interval '1 day');
set local role authenticated;
select throws_ok($$select * from public.fan_reply_send('reply-other','f7700000-0000-4000-8000-000000000001','  정상 답장  ')$$,'23505','REPLY_OPERATION_CONFLICT','operation key is immutable across two subscribed artists');
insert into reply_context values('old-first',(select to_jsonb(p) from public.fan_reply_page('reply-main',2,'2020-01-02','ffffffff-ffff-4fff-8fff-ffffffffffff') p));
select ok((select (data->>'has_more')::boolean and jsonb_array_length(data->'replies')=2 from reply_context where key='old-first'),'bounded lookahead marks old page continuation');
select is((select data->'replies'->0->>'id' from reply_context where key='old-first'),'f7800000-0000-4000-8000-000000000005','equal timestamp ties use UUID descending');
select is((select data->'replies'->1->>'created_at' from reply_context where key='old-first'),'2020-01-01T00:00:00.123456+00:00','cursor preserves database microseconds');
select is((select replies->0->>'id' from public.fan_reply_page('reply-main',2,'2020-01-01 00:00:00.123456+00','f7800000-0000-4000-8000-000000000004')),
 'f7800000-0000-4000-8000-000000000003','strict tuple continuation has neither duplication nor gap');
select ok((select not has_more and jsonb_array_length(replies)=1 from public.fan_reply_page('reply-main',2,'2020-01-01 00:00:00.123456+00','f7800000-0000-4000-8000-000000000002')),
 'last page has final historical reply and no continuation');
select is((select replies->0->'operation_id' from public.fan_reply_page('reply-main',2,'2020-01-02','ffffffff-ffff-4fff-8fff-ffffffffffff')),'null'::jsonb,'legacy retained replies have no invented operation key');
select is((select jsonb_array_length(replies) from public.fan_reply_page('reply-other')),0,'own other artist history is separate');
reset role;
delete from private.reply_policy;
set local role authenticated;
select ok((select not send_ready and jsonb_array_length(replies)>0 from public.fan_reply_page('reply-main')),'removed send policy does not delete or hide retained own text');
select lives_ok($$select * from public.fan_reply_send('reply-main','f7700000-0000-4000-8000-000000000002','메시지 답장','f7400000-0000-4000-8000-000000000006')$$,'accepted operation reconciliation works with missing current send policy');
reset role;
select is((select count(*) from private.point_ledger),0::bigint,'all reply flows leave point ledger untouched');
select is((select count(*) from private.analytics_events where name='reply_sent'),0::bigint,'reply sending does not bypass later consent-aware analytics flow');
select is((select count(*) from public.message_reads),0::bigint,'no reply flow manufactures a read receipt');
select * from finish();
rollback;

