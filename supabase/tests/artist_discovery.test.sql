begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();

-- Entirely fictional local fixtures, rolled back. No real artist or policy text.
select is((select count(*) from private.artist_interests),0::bigint,'migration selects no artist on behalf of a person');
select ok((select relrowsecurity from pg_class where oid='private.artist_interests'::regclass),'interest table has RLS');
select ok((select bool_and(not has_table_privilege(r,'private.artist_interests','SELECT,INSERT,UPDATE,DELETE,TRUNCATE'))
 from unnest(array['anon','authenticated','service_role']) r),'no application role can forge or enumerate private interest');
select ok((select bool_and(p.prosecdef and 'search_path=""'=any(p.proconfig)) from pg_proc p
 join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') and p.proname like 'discovery\_%' escape '\'),
 'every discovery privilege boundary pins empty search_path');
select ok((select bool_and(not has_function_privilege(r,'private.discovery_require_actor(uuid)','EXECUTE'))
 from unnest(array['anon','authenticated','service_role']) r),'private authorization helper is not callable by application roles');
select ok(not has_function_privilege('authenticated','public.discovery_preview(uuid,text)','EXECUTE'),'authenticated callers cannot obtain raw preview templates');
select ok(not has_function_privilege('anon','public.discovery_preview(uuid,text)','EXECUTE'),'anonymous callers cannot obtain preview templates');
select ok(has_function_privilege('service_role','public.discovery_preview(uuid,text)','EXECUTE'),'only trusted server has preview DTO capability');
select ok(not has_function_privilege('service_role','public.discovery_get_interest()','EXECUTE'),'service role cannot impersonate self-service interest reads');
select ok(not has_function_privilege('service_role','public.discovery_select_artist(text)','EXECUTE'),'service role cannot impersonate self-service choice');
select ok((select bool_and(not (coalesce(p.proargnames,array[]::text[]) && array['p_user_id','p_actor_id','p_selected_at','p_artist_id']))
 from pg_proc p where p.oid in ('public.discovery_get_interest()'::regprocedure,'public.discovery_select_artist(text)'::regprocedure)),
 'preference endpoints accept no actor, timestamp or internal artist identity');

insert into auth.users(id,email,raw_user_meta_data) values
 ('e1000000-0000-4000-8000-000000000001','discovery-one@example.invalid','{}'),
 ('e1000000-0000-4000-8000-000000000002','discovery-two@example.invalid','{}'),
 ('e1000000-0000-4000-8000-000000000003','discovery-incomplete@example.invalid','{}'),
 ('e1000000-0000-4000-8000-000000000004','discovery-author@example.invalid','{}');
update public.profiles set role='artist' where id='e1000000-0000-4000-8000-000000000004';
insert into public.artists(id,slug,name,intro,grade,status,agency_name,profile_image_path) values
 ('e2000000-0000-4000-8000-000000000001','discovery-one','허구 가수 하나','허구 소개 하나','B','active','PRIVATE CONTRACT','private/artist-one.jpg'),
 ('e2000000-0000-4000-8000-000000000002','discovery-two','허구 가수 둘',null,'C','active','PRIVATE AGENCY',null),
 ('e2000000-0000-4000-8000-000000000003','discovery-hidden','숨긴 허구 가수','숨긴 소개','B','draft',null,null),
 ('e2000000-0000-4000-8000-000000000004','discovery-paused','중지 허구 가수',null,'B','paused',null,null),
 ('e2000000-0000-4000-8000-000000000005','discovery-retired','은퇴 허구 가수',null,'B','retired',null,null);
create temporary table discovery_stamps(key text primary key,stamp timestamptz);
grant all on discovery_stamps to authenticated;
set local role anon;
select throws_ok('select * from public.discovery_get_interest()','42501',null,'anonymous cannot read an interest');
select throws_ok($$select public.discovery_select_artist('discovery-one')$$,'42501',null,'anonymous cannot select an interest');
select is((select count(*) from public.artist_catalog where slug like 'discovery-%'),2::bigint,'anonymous catalog includes active artists only');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','',true);
select throws_ok('select * from public.discovery_get_interest()','42501','DISCOVERY_FORBIDDEN','missing subject is forbidden');
select throws_ok($$select public.discovery_select_artist('discovery-one')$$,'42501','DISCOVERY_FORBIDDEN','missing subject cannot choose');
select set_config('request.jwt.claim.sub','e1000000-0000-4000-8000-000000000003',true);
select throws_ok('select * from public.discovery_get_interest()','55000','DISCOVERY_PROFILE_REQUIRED','profile stage cannot be skipped by reading interest');
select throws_ok($$select public.discovery_select_artist('discovery-one')$$,'55000','DISCOVERY_PROFILE_REQUIRED','profile stage cannot be skipped by choosing');
select throws_ok($$select * from public.discovery_preview('e1000000-0000-4000-8000-000000000001','discovery-one')$$,'42501',null,'direct RPC cannot spoof another actor for templates');
reset role;
insert into private.onboarding_documents(version,kind,title,body,approved_at,published_at) values
 ('e9000000-0000-4000-8000-000000000001','terms','Fictional terms','Only a rollback test fixture, not legal terms.',now(),now()),
 ('e9000000-0000-4000-8000-000000000002','privacy','Fictional privacy','Only a rollback test fixture, not a privacy policy.',now(),now()),
 ('e9000000-0000-4000-8000-000000000003','terms','Fictional changed terms','Only a rollback policy rotation fixture.',now(),now());
insert into private.profile_onboarding_policy values(true,'e8000000-0000-4000-8000-000000000001',now(),2,10,
 array['금지단어'],'e9000000-0000-4000-8000-000000000001','e9000000-0000-4000-8000-000000000002',null);
set local role authenticated;
select set_config('request.jwt.claim.sub','e1000000-0000-4000-8000-000000000001',true);
select public.onboarding_save_font('large');
select public.onboarding_save_name('허구팬하나');
select public.onboarding_complete_profile(true,true,'e9000000-0000-4000-8000-000000000001',true,'e9000000-0000-4000-8000-000000000002');
select set_config('request.jwt.claim.sub','e1000000-0000-4000-8000-000000000002',true);
select public.onboarding_save_font('normal');
select public.onboarding_save_name('허구팬둘');
select public.onboarding_complete_profile(true,true,'e9000000-0000-4000-8000-000000000001',true,'e9000000-0000-4000-8000-000000000002');
select set_config('request.jwt.claim.sub','e1000000-0000-4000-8000-000000000001',true);
select is((select count(*) from public.discovery_get_interest()),1::bigint,'empty state has one safe row');
select ok((select selected_slug is null and selected_name is null and selected_at is null from public.discovery_get_interest()),'no choice is explicit and does not invent completion');
select throws_ok($$select public.discovery_select_artist(null)$$,'22023','DISCOVERY_INVALID_INPUT','null is not a skip operation');
select throws_ok($$select public.discovery_select_artist('')$$,'22023','DISCOVERY_INVALID_INPUT','empty is not a skip operation');
select throws_ok($$select public.discovery_select_artist('../discovery-one')$$,'22023','DISCOVERY_INVALID_INPUT','path input is invalid');
select throws_ok($$select public.discovery_select_artist(repeat('a',129))$$,'22023','DISCOVERY_INVALID_INPUT','unbounded slug is invalid');
select throws_ok($$select public.discovery_select_artist('discovery-missing')$$,'P0002','DISCOVERY_NOT_FOUND','missing choice is not found');
select throws_ok($$select public.discovery_select_artist('discovery-hidden')$$,'P0002','DISCOVERY_NOT_FOUND','draft choice does not leak hidden existence');
select throws_ok($$select public.discovery_select_artist('discovery-paused')$$,'P0002','DISCOVERY_NOT_FOUND','paused choice does not leak hidden existence');
select throws_ok($$select public.discovery_select_artist('discovery-retired')$$,'P0002','DISCOVERY_NOT_FOUND','retired choice does not leak hidden existence');
select lives_ok($$select public.discovery_select_artist('discovery-one')$$,'ready actor can choose an active artist before full onboarding');
select is((select selected_slug from public.discovery_get_interest()),'discovery-one','selection survives a separate state read');
select is((select selected_name from public.discovery_get_interest()),'허구 가수 하나','interest projects current public name');
insert into discovery_stamps values('first',(select selected_at from public.discovery_get_interest()));
select lives_ok($$select public.discovery_select_artist('discovery-one')$$,'repeated selection is idempotent');
select is((select selected_at from public.discovery_get_interest()),(select stamp from discovery_stamps where key='first'),'retry preserves original selection timestamp');
select is(public.has_active_access('e2000000-0000-4000-8000-000000000001'),false,'interest does not grant paid access');
select is((select count(*) from public.messages),0::bigint,'fan cannot select raw messages');
select set_config('request.jwt.claim.sub','e1000000-0000-4000-8000-000000000002',true);
select is((select selected_slug from public.discovery_get_interest()),null::text,'second actor cannot borrow first actor selection');
select lives_ok($$select public.discovery_select_artist('discovery-two')$$,'second actor has independent choice');
select set_config('request.jwt.claim.sub','e1000000-0000-4000-8000-000000000001',true);
select is((select selected_slug from public.discovery_get_interest()),'discovery-one','second actor cannot overwrite first preference');
select lives_ok($$select public.discovery_select_artist('discovery-two')$$,'back navigation can replace the first interest');
select is((select selected_slug from public.discovery_get_interest()),'discovery-two','latest explicit choice is durable');
select throws_ok($$insert into private.artist_interests values(auth.uid(),'e2000000-0000-4000-8000-000000000003',now())$$,'42501',null,'direct insert cannot choose inactive or spoof completion');
reset role;
select is((select count(*) from private.artist_interests),2::bigint,'one private interest row per actor');
select is((select count(*) from public.subscriptions),0::bigint,'discovery creates no subscription');
select is((select count(*) from public.payment_events),0::bigint,'discovery creates no charge or payment event');
select is((select count(*) from public.profiles where onboarding_completed_at is not null),0::bigint,'selection never prematurely completes installation/signup');
update public.artists set status='paused' where slug='discovery-two';
set local role authenticated;
select ok((select selected_slug is null and selected_name is null and selected_at is null from public.discovery_get_interest()),'inactive saved choice does not reveal metadata or advance install');
select throws_ok($$select public.discovery_select_artist('discovery-two')$$,'P0002','DISCOVERY_NOT_FOUND','retry revalidates current artist activity');
reset role;
select is((select count(*) from private.artist_interests),2::bigint,'inactive interest remains private durable evidence, not visible choice');
update public.artists set status='active' where slug='discovery-two';

-- Trusted preview DTO: all authorization applies even to an empty list.
set local role service_role;
select throws_ok($$select * from public.discovery_preview(null,'discovery-one')$$,'42501','DISCOVERY_FORBIDDEN','server must provide a real verified actor');
select throws_ok($$select * from public.discovery_preview('e1000000-0000-4000-8000-000000000003','discovery-one')$$,'55000','DISCOVERY_PROFILE_REQUIRED','preview cannot skip mandatory profile stage');
select throws_ok($$select * from public.discovery_preview('e1000000-0000-4000-8000-000000000004','discovery-one')$$,'42501','DISCOVERY_FORBIDDEN','artist role cannot impersonate a fan preview');
select throws_ok($$select * from public.discovery_preview('e1000000-0000-4000-8000-000000000001','discovery-hidden')$$,'P0002','DISCOVERY_NOT_FOUND','hidden preview is indistinguishable from missing');
select throws_ok($$select * from public.discovery_preview('e1000000-0000-4000-8000-000000000001','discovery-one')$$,'55000','DISCOVERY_SETUP_NOT_READY','missing message policy does not use invented preview defaults');
reset role;
insert into private.message_policy values(true,'fictional-discovery-policy',604800,300,1000,100,10,180,60,5,10485760,20971520,104857600);
set local role service_role;
select is((select messages from public.discovery_preview('e1000000-0000-4000-8000-000000000001','discovery-one')),'[]'::jsonb,'authorized artist with no preview returns empty messages');
select is((select call_name from public.discovery_preview('e1000000-0000-4000-8000-000000000001','discovery-one')),'허구팬하나','empty preview context still uses validated caller name');
reset role;
insert into public.messages(id,artist_id,author_id,type,body,status,is_preview,preview_order,scheduled_at,sent_at) values
 ('e3000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000004','text','{이름} 님, 허구 첫 인사','sent',true,2,now()-interval '2 days',now()-interval '2 days'),
 ('e3000000-0000-4000-8000-000000000002','e2000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000004','photo','허구 사진 {이름}','sent',true,1,now()-interval '1 day',now()-interval '1 day'),
 ('e3000000-0000-4000-8000-000000000003','e2000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000004','text','PRIVATE PAID ONLY','sent',false,null,now()-interval '1 day',now()-interval '1 day'),
 ('e3000000-0000-4000-8000-000000000004','e2000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000004','text','PRIVATE DRAFT','draft',false,null,null,null),
 ('e3000000-0000-4000-8000-000000000005','e2000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000004','text','PRIVATE SCHEDULED','scheduled',false,null,now()+interval '1 day',null),
 ('e3000000-0000-4000-8000-000000000006','e2000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000004','text','PRIVATE FUTURE SENT','sent',true,3,now()+interval '1 day',now()+interval '1 day'),
 ('e3000000-0000-4000-8000-000000000007','e2000000-0000-4000-8000-000000000002','e1000000-0000-4000-8000-000000000004','text','OTHER ARTIST PREVIEW','sent',true,1,now()-interval '1 day',now()-interval '1 day');
insert into storage.objects(id,bucket_id,name,metadata) values
 ('e5000000-0000-4000-8000-000000000001','message-media','private/discovery/photo.jpg','{"mimetype":"image/jpeg","size":128}');
insert into public.message_media(id,message_id,storage_object_id,bucket_id,object_path,kind,mime_type,byte_size,width,height) values
 ('e4000000-0000-4000-8000-000000000001','e3000000-0000-4000-8000-000000000002','e5000000-0000-4000-8000-000000000001','message-media','private/discovery/photo.jpg','photo','image/jpeg',128,640,480);
set local role service_role;
select is((select jsonb_array_length(messages) from public.discovery_preview('e1000000-0000-4000-8000-000000000001','discovery-one')),2,'only current sent selected previews are returned');
select is((select messages->0->>'id' from public.discovery_preview('e1000000-0000-4000-8000-000000000001','discovery-one')),'e3000000-0000-4000-8000-000000000002','admin-selected preview order is respected');
select is((select messages->1->>'body_template' from public.discovery_preview('e1000000-0000-4000-8000-000000000001','discovery-one')),'{이름} 님, 허구 첫 인사','raw template is server-only canonical renderer input');
select is((select call_name from public.discovery_preview('e1000000-0000-4000-8000-000000000002','discovery-one')),'허구팬둘','second actor context uses its own validated calling name');
select ok((select not (to_jsonb(p)::text ~ 'PRIVATE|private/|agency|contract|author_id|artist_id|user_id|profile_image|storage_object|bucket|object_path|mime_type|byte_size')
 from public.discovery_preview('e1000000-0000-4000-8000-000000000001','discovery-one') p),'trusted DTO excludes private artist, author, storage and non-preview data');
select is((select messages->0->'media'->0 from public.discovery_preview('e1000000-0000-4000-8000-000000000001','discovery-one')),
 '{"id":"e4000000-0000-4000-8000-000000000001","kind":"photo","width":640,"height":480,"duration_ms":null}'::jsonb,
 'media metadata is minimal and contains no usable raw URL/path');
reset role;
update private.message_policy set preview_max_count=1;
set local role service_role;
select is((select jsonb_array_length(messages) from public.discovery_preview('e1000000-0000-4000-8000-000000000001','discovery-one')),1,'current configured preview cap immediately applies');
reset role;
update private.message_policy set preview_max_count=0;
set local role service_role;
select is((select messages from public.discovery_preview('e1000000-0000-4000-8000-000000000001','discovery-one')),'[]'::jsonb,'zero configured previews grants no content');
reset role;
update private.message_policy set preview_max_count=5;
update public.messages set status='canceled',is_preview=false,preview_order=null,canceled_at=clock_timestamp()
 where id='e3000000-0000-4000-8000-000000000001';
set local role service_role;
select is((select jsonb_array_length(messages) from public.discovery_preview('e1000000-0000-4000-8000-000000000001','discovery-one')),1,'canceled preview immediately disappears');
reset role;
set local role authenticated;
select is((select count(*) from public.messages),0::bigint,'direct fan SELECT still reveals no raw templates after preview exists');
select is((select count(*) from public.message_media),0::bigint,'direct fan SELECT still reveals no raw media paths');
select throws_ok($$select public.mark_message_read('e3000000-0000-4000-8000-000000000002')$$,'42501','MESSAGE_NOT_VISIBLE','preview interest cannot create a paid read receipt');
reset role;

-- Current readiness, not historic stage timestamps, controls every operation.
update private.profile_onboarding_policy set terms_version='e9000000-0000-4000-8000-000000000003';
set local role authenticated;
select throws_ok('select * from public.discovery_get_interest()','55000','DISCOVERY_PROFILE_REQUIRED','changed mandatory policy invalidates effective artist-stage readiness');
select throws_ok($$select public.discovery_select_artist('discovery-one')$$,'55000','DISCOVERY_PROFILE_REQUIRED','stale consent cannot change interest');
reset role;
set local role service_role;
select throws_ok($$select * from public.discovery_preview('e1000000-0000-4000-8000-000000000001','discovery-one')$$,'55000','DISCOVERY_PROFILE_REQUIRED','stale mandatory consent cannot read previews');
reset role;
update private.profile_onboarding_policy set terms_version='e9000000-0000-4000-8000-000000000001',privacy_version=null;
set local role authenticated;
select throws_ok('select * from public.discovery_get_interest()','55000','DISCOVERY_SETUP_NOT_READY','missing legal policy fails closed instead of advancing');
reset role;
update private.profile_onboarding_policy set privacy_version='e9000000-0000-4000-8000-000000000002',name_approved_at=clock_timestamp()+interval '1 day';
set local role service_role;
select throws_ok($$select * from public.discovery_preview('e1000000-0000-4000-8000-000000000001','discovery-one')$$,'55000','DISCOVERY_SETUP_NOT_READY','future name-policy approval cannot authorize preview');
reset role;
update private.profile_onboarding_policy set name_approved_at=now(),profanity_words=array['허구팬하나'];
set local role authenticated;
select throws_ok('select * from public.discovery_get_interest()','55000','DISCOVERY_PROFILE_REQUIRED','saved calling name is revalidated after moderation-policy rotation');
reset role;
set local role service_role;
select throws_ok($$select * from public.discovery_preview('e1000000-0000-4000-8000-000000000001','discovery-one')$$,'55000','DISCOVERY_PROFILE_REQUIRED','preview cannot personalize with a now-forbidden name');
reset role;
update private.profile_onboarding_policy set profanity_words=array['금지단어'];
update public.profiles set is_restricted=true where id='e1000000-0000-4000-8000-000000000001';
set local role authenticated;
select throws_ok('select * from public.discovery_get_interest()','42501','DISCOVERY_FORBIDDEN','restricted fan cannot read saved choice');
select throws_ok($$select public.discovery_select_artist('discovery-one')$$,'42501','DISCOVERY_FORBIDDEN','restricted fan cannot update saved choice');
reset role;
set local role service_role;
select throws_ok($$select * from public.discovery_preview('e1000000-0000-4000-8000-000000000001','discovery-one')$$,'42501','DISCOVERY_FORBIDDEN','restricted fan cannot read previews');
reset role;
update public.profiles set restricted_until=now()-interval '1 second' where id='e1000000-0000-4000-8000-000000000001';
set local role authenticated;
select lives_ok('select * from public.discovery_get_interest()','expired restriction restores readiness without deleting interest');
reset role;
update public.profiles set role='admin' where id='e1000000-0000-4000-8000-000000000001';
set local role authenticated;
select throws_ok('select * from public.discovery_get_interest()','42501','DISCOVERY_FORBIDDEN','admin role is not a fan preference bypass');
reset role;
update public.profiles set role='fan',is_restricted=false,restricted_until=null,
 onboarding_completed_at=clock_timestamp() where id='e1000000-0000-4000-8000-000000000001';
set local role authenticated;
select lives_ok('select * from public.discovery_get_interest()','completed fan retains its own ordinary interest preference');
select throws_ok($$select public.discovery_select_artist('discovery-one')$$,'42501','DISCOVERY_FORBIDDEN','onboarding selection cannot edit a completed signup');
reset role;
update public.artists set status='paused' where slug='discovery-one';
set local role service_role;
select throws_ok($$select * from public.discovery_preview('e1000000-0000-4000-8000-000000000001','discovery-one')$$,'P0002','DISCOVERY_NOT_FOUND','paused artist preview is unavailable even after full onboarding');
reset role;
select is((select count(*) from public.subscriptions),0::bigint,'all discovery operations leave subscription ledger untouched');
select is((select count(*) from public.message_reads),0::bigint,'discovery creates no paid reading evidence');
select is((select count(*) from private.analytics_events),0::bigint,'discovery does not invent unapproved telemetry consent/events');
select * from finish();
rollback;
