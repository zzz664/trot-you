begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
set local timezone='UTC';
select no_plan();

select is((select count(*) from private.artist_account_link_policy),0::bigint,'migration does not approve an onboarding method');
select is((select count(*) from private.artist_account_invitations),0::bigint,'migration issues no invitations');
select is((select count(*) from private.admin_artist_audit),0::bigint,'migration performs no admin action');
select is((select count(*) from private.admin_bootstrap_audit),0::bigint,'migration bootstraps no administrator');
select ok((select bool_and(relrowsecurity) from pg_class where oid in('private.artist_account_link_policy'::regclass,
 'private.artist_account_invitations'::regclass,'private.admin_artist_operations'::regclass,'private.admin_artist_audit'::regclass,'private.admin_bootstrap_audit'::regclass)),
 'new private registries all enable RLS');
select ok((select bool_and(not has_table_privilege(r,t,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'))
 from unnest(array['anon','authenticated','service_role'])r cross join unnest(array['private.artist_account_link_policy','private.artist_account_invitations',
 'private.admin_artist_operations','private.admin_artist_audit','private.admin_bootstrap_audit'])t),'private state has no API table capabilities');
select ok(not has_table_privilege('authenticated','public.artists','INSERT,UPDATE,DELETE'),'even admin cannot bypass audited artist RPCs');
select ok(not has_table_privilege('authenticated','public.artist_members','INSERT,UPDATE,DELETE'),'even admin cannot bypass recipient confirmation for membership');
select ok((select bool_and(prosecdef and 'search_path=""'=any(proconfig)) from pg_proc where pronamespace='public'::regnamespace
 and (proname like 'admin_artist_%' or proname in('artist_account_invitations','artist_account_respond'))),'all admin RPCs have pinned definer paths');
select ok((select bool_and(has_function_privilege('authenticated',oid,'EXECUTE') and not has_function_privilege('anon',oid,'EXECUTE')
 and not has_function_privilege('service_role',oid,'EXECUTE')) from pg_proc where pronamespace='public'::regnamespace
 and (proname like 'admin_artist_%' or proname in('artist_account_invitations','artist_account_respond'))),'RPCs require an authenticated actor, not caller-supplied user or service actor');
select ok((select bool_and(not has_function_privilege('authenticated',oid,'EXECUTE')) from pg_proc where pronamespace='private'::regnamespace and proname like 'admin_artist_%'),
 'private arbitrary actor helpers cannot be called by browsers');

-- Fictional isolated identities. Owner-only fixture setup is rolled back.
insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data)
select ('ad100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'admin-artist-fixture-'||n||'@example.invalid',
 case when n=5 then null else now() end,'{}'::jsonb from generate_series(1,8)n;
update public.profiles set role='admin' where id in('ad100000-0000-4000-8000-000000000001','ad100000-0000-4000-8000-000000000002');
update public.profiles set call_name='가상 계정',onboarding_completed_at=clock_timestamp() where id<>'ad100000-0000-4000-8000-000000000008' and id::text like 'ad100000%';
update public.profiles set is_restricted=true where id='ad100000-0000-4000-8000-000000000006';
insert into public.artists(id,slug,name,grade,status,profile_image_path) values
 ('ad200000-0000-4000-8000-000000000001','admin-artist-main','허구 관리 가수','B','active','existing-approved-asset-preserved'),
 ('ad200000-0000-4000-8000-000000000002','admin-artist-other','허구 다른 가수','C','active',null),
 ('ad200000-0000-4000-8000-000000000003','admin-artist-paused','허구 중지 가수','C','paused',null);
create temporary table admin_context(key text primary key,data jsonb);
grant all on admin_context to authenticated,service_role;
create function pg_temp.input(p_name text default '허구 관리 가수',p_status text default 'active',p_slug text default 'admin-artist-main') returns jsonb
language sql as $$select jsonb_build_object('slug',p_slug,'name',p_name,'intro','가상 소개','grade','B','status',p_status,
 'agency_name',null,'contract_started_at',null,'contract_ended_at',null,'display_order',0)$$;

set local role anon;
select throws_ok('select public.admin_artist_list()','42501',null,'anonymous cannot enumerate administration');
select throws_ok('select public.artist_account_invitations()','42501',null,'anonymous cannot read invitations');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','ad100000-0000-4000-8000-000000000003',true);
select throws_ok('select public.admin_artist_list()','42501','ADMIN_ARTIST_FORBIDDEN','fan cannot enumerate artists under admin DTO');
select throws_ok($$select public.admin_artist_detail('ad200000-0000-4000-8000-000000000001')$$,'42501','ADMIN_ARTIST_FORBIDDEN','fan cannot read contracts or members');
select is(public.artist_account_invitations()->'invitations','[]'::jsonb,'fan invitation inbox is empty not fabricated');
select is(public.artist_account_invitations()->>'account_link_ready','false','missing onboarding method is honestly unavailable');
select set_config('request.jwt.claim.sub','ad100000-0000-4000-8000-000000000001',true);
select is(public.admin_artist_list()->>'has_more','false','admin list has reliable terminal sentinel');
select throws_ok('select public.admin_artist_list(0)','22023','ADMIN_ARTIST_INVALID_INPUT','invalid list page rejected');
select throws_ok('select public.admin_artist_list(1001)','22023','ADMIN_ARTIST_INVALID_INPUT','list offset is bounded');
select throws_ok($$select public.admin_artist_detail('ad200000-0000-4000-8000-000000000099')$$,'P0002','ADMIN_ARTIST_NOT_FOUND','missing artist is explicit');
select is(public.admin_artist_detail('ad200000-0000-4000-8000-000000000001')->>'preview_max_count','0','missing message policy does not invent preview cap');
select ok(not(public.admin_artist_detail('ad200000-0000-4000-8000-000000000001')::text like '%existing-approved-asset%'),'artist DTO omits raw asset paths');
select throws_ok($$select public.admin_artist_save('ad200000-0000-4000-8000-000000000001',gen_random_uuid(),1,pg_temp.input()||'{"monthly_price":1}')$$,
 '22023','ADMIN_ARTIST_INVALID_INPUT','financial policy field cannot enter artist update');
select throws_ok($$select public.admin_artist_save('ad200000-0000-4000-8000-000000000001',gen_random_uuid(),1,pg_temp.input()||'{"profile_image_path":"arbitrary"}')$$,
 '22023','ADMIN_ARTIST_INVALID_INPUT','arbitrary profile asset path is not accepted');
select throws_ok($$select public.admin_artist_save('ad200000-0000-4000-8000-000000000001',gen_random_uuid(),1,pg_temp.input() - 'intro')$$,
 '22023','ADMIN_ARTIST_INVALID_INPUT','partial update cannot accidentally erase nullable fields');
select throws_ok($$select public.admin_artist_save('ad200000-0000-4000-8000-000000000001',gen_random_uuid(),1,pg_temp.input()||'{"contract_ended_at":"2026-01-01"}')$$,
 '22023','ADMIN_ARTIST_INVALID_INPUT','end date needs a start date');
select throws_ok($$select public.admin_artist_save('ad200000-0000-4000-8000-000000000001',gen_random_uuid(),1,pg_temp.input()||'{"display_order":2147483648}')$$,
 '22023','ADMIN_ARTIST_INVALID_INPUT','out-of-range ordering is rejected');
select throws_ok($$select public.admin_artist_save('ad200000-0000-4000-8000-000000000001',gen_random_uuid(),1,pg_temp.input()||'{"name":""}')$$,
 '22023','ADMIN_ARTIST_INVALID_INPUT','empty artist name rejected');
select throws_ok($$select public.admin_artist_save('ad200000-0000-4000-8000-000000000001',gen_random_uuid(),1,pg_temp.input()||'{"slug":"Bad/Slug"}')$$,
 '22023','ADMIN_ARTIST_INVALID_INPUT','unsafe slug rejected');
insert into admin_context values('saved',public.admin_artist_save('ad200000-0000-4000-8000-000000000001',
 'ad700000-0000-4000-8000-000000000001',1,pg_temp.input('허구 수정 가수')));
select is((select data->>'revision' from admin_context where key='saved'),'2','profile edit increments revision');
select is(public.admin_artist_save('ad200000-0000-4000-8000-000000000001','ad700000-0000-4000-8000-000000000001',1,pg_temp.input('허구 수정 가수')),
 (select data from admin_context where key='saved'),'identical operation replay returns accepted snapshot');
select throws_ok($$select public.admin_artist_save('ad200000-0000-4000-8000-000000000001','ad700000-0000-4000-8000-000000000001',1,pg_temp.input('다른 본문'))$$,
 '23505','ADMIN_ARTIST_OPERATION_CONFLICT','operation UUID reuse with new payload rejected');
select throws_ok($$select public.admin_artist_save('ad200000-0000-4000-8000-000000000001',gen_random_uuid(),1,pg_temp.input())$$,
 '40001','ADMIN_ARTIST_REVISION_CONFLICT','stale profile form cannot overwrite accepted edit');
select throws_ok($$select public.admin_artist_save('ad200000-0000-4000-8000-000000000099',gen_random_uuid(),1,pg_temp.input())$$,
 'P0002','ADMIN_ARTIST_NOT_FOUND','unknown update cannot create implicitly');
insert into admin_context values('created',public.admin_artist_save('ad200000-0000-4000-8000-000000000004',
 'ad700000-0000-4000-8000-000000000002',0,pg_temp.input('허구 새 가수','draft','admin-artist-new')));
select is((select data->>'revision' from admin_context where key='created'),'1','explicit create begins revision one');
select throws_ok($$select public.admin_artist_save('ad200000-0000-4000-8000-000000000005',gen_random_uuid(),0,pg_temp.input())$$,
 '23505','ADMIN_ARTIST_SLUG_CONFLICT','duplicate slug has stable business error');
reset role;
select is((select profile_image_path from public.artists where id='ad200000-0000-4000-8000-000000000001'),'existing-approved-asset-preserved','edits preserve existing profile assets');
select is((select count(*) from private.admin_artist_audit),2::bigint,'replay writes no duplicate audit');
select throws_ok('update private.admin_artist_audit set action=''unlink''','55000','ADMIN_ARTIST_AUDIT_IMMUTABLE','even owner cannot rewrite audit row');
select throws_ok('delete from private.admin_artist_audit','55000','ADMIN_ARTIST_AUDIT_IMMUTABLE','audit cannot be deleted');
select throws_ok('truncate private.admin_artist_audit','55000','ADMIN_ARTIST_AUDIT_IMMUTABLE','audit cannot be truncated');

insert into private.message_policy values(true,'fictional-admin-preview',604800,300,1000,100,10,180,60,2,10485760,20971520,104857600);
insert into public.messages(id,artist_id,author_id,type,body,status,scheduled_at,sent_at) values
 ('ad400000-0000-4000-8000-000000000001','ad200000-0000-4000-8000-000000000001','ad100000-0000-4000-8000-000000000001','text','안녕 {이름}','sent',now()-interval '1 minute',now()-interval '1 minute'),
 ('ad400000-0000-4000-8000-000000000002','ad200000-0000-4000-8000-000000000001','ad100000-0000-4000-8000-000000000001','text','두 번째 가상 글','sent',now()-interval '2 minutes',now()-interval '2 minutes'),
 ('ad400000-0000-4000-8000-000000000003','ad200000-0000-4000-8000-000000000002','ad100000-0000-4000-8000-000000000001','text','다른 가수 글','sent',now()-interval '1 minute',now()-interval '1 minute'),
 ('ad400000-0000-4000-8000-000000000004','ad200000-0000-4000-8000-000000000001','ad100000-0000-4000-8000-000000000001','photo',null,'sent',now()-interval '1 minute',now()-interval '1 minute');
set local role authenticated;
select throws_ok($$select public.admin_artist_previews('ad200000-0000-4000-8000-000000000001',gen_random_uuid(),2,array['ad400000-0000-4000-8000-000000000003']::uuid[])$$,
 '23514','ADMIN_ARTIST_PREVIEWS_INVALID','preview ownership cannot cross artists');
select throws_ok($$select public.admin_artist_previews('ad200000-0000-4000-8000-000000000001',gen_random_uuid(),2,array['ad400000-0000-4000-8000-000000000004']::uuid[])$$,
 '23514','ADMIN_ARTIST_PREVIEWS_INVALID','unaccepted media cannot be promoted to preview');
select throws_ok($$select public.admin_artist_previews('ad200000-0000-4000-8000-000000000001',gen_random_uuid(),2,array['ad400000-0000-4000-8000-000000000001','ad400000-0000-4000-8000-000000000001']::uuid[])$$,
 '23514','ADMIN_ARTIST_PREVIEWS_INVALID','duplicate previews rejected');
insert into admin_context values('previews',public.admin_artist_previews('ad200000-0000-4000-8000-000000000001','ad700000-0000-4000-8000-000000000003',2,
 array['ad400000-0000-4000-8000-000000000002','ad400000-0000-4000-8000-000000000001']::uuid[]));
select is(public.admin_artist_detail('ad200000-0000-4000-8000-000000000001')->'previews'->0->>'id','ad400000-0000-4000-8000-000000000002','curated preview ordering is explicit');
select is(public.admin_artist_previews('ad200000-0000-4000-8000-000000000001','ad700000-0000-4000-8000-000000000003',2,
 array['ad400000-0000-4000-8000-000000000002','ad400000-0000-4000-8000-000000000001']::uuid[]),(select data from admin_context where key='previews'),'preview retries do not reapply selection');
reset role;
select ok((select after_value->'request' ? 'message_ids' from private.admin_artist_audit where operation_id='ad700000-0000-4000-8000-000000000003'),'audit preserves exact selected IDs');
update public.messages set status='canceled',is_preview=false,preview_order=null,canceled_at=clock_timestamp() where id='ad400000-0000-4000-8000-000000000001';
select ok((select revision>(select (data->>'revision')::bigint from admin_context where key='previews') from public.artists where id='ad200000-0000-4000-8000-000000000001'),'canceling selected message invalidates stale curation revision');
set local role authenticated;
select throws_ok($$select public.admin_artist_previews('ad200000-0000-4000-8000-000000000001',gen_random_uuid(),
 (select (data->>'revision')::bigint from admin_context where key='previews'),'{}')$$,'40001','ADMIN_ARTIST_REVISION_CONFLICT','canceled message cannot be silently resurrected by stale form');
select throws_ok($$select public.admin_artist_invite('ad200000-0000-4000-8000-000000000001','ad100000-0000-4000-8000-000000000003',false,gen_random_uuid(),
 (public.admin_artist_detail('ad200000-0000-4000-8000-000000000001')->'artist'->>'revision')::bigint,true)$$,'55000','ADMIN_ARTIST_SETUP_NOT_READY','account linkage requires separately approved method');
reset role;
insert into private.artist_account_link_policy values(true,true,now(),'fictional-ci-existing-account-consent',48);
set local role authenticated;
select throws_ok($$select public.admin_artist_invite('ad200000-0000-4000-8000-000000000001','ad100000-0000-4000-8000-000000000005',false,gen_random_uuid(),1,true)$$,
 '42501','ADMIN_ARTIST_ACCOUNT_UNAVAILABLE','unverified auth identity rejected');
select throws_ok($$select public.admin_artist_invite('ad200000-0000-4000-8000-000000000001','ad100000-0000-4000-8000-000000000002',false,gen_random_uuid(),1,true)$$,
 '42501','ADMIN_ARTIST_ACCOUNT_UNAVAILABLE','admin target cannot be reassigned or promoted');
select throws_ok($$select public.admin_artist_invite('ad200000-0000-4000-8000-000000000001','ad100000-0000-4000-8000-000000000006',false,gen_random_uuid(),1,true)$$,
 '42501','ADMIN_ARTIST_ACCOUNT_UNAVAILABLE','restricted identity rejected');
select throws_ok($$select public.admin_artist_invite('ad200000-0000-4000-8000-000000000001','ad100000-0000-4000-8000-000000000008',false,gen_random_uuid(),1,true)$$,
 '42501','ADMIN_ARTIST_ACCOUNT_UNAVAILABLE','incomplete onboarding cannot receive artist access');
select throws_ok($$select public.admin_artist_invite('ad200000-0000-4000-8000-000000000003','ad100000-0000-4000-8000-000000000003',false,gen_random_uuid(),1,true)$$,
 '42501','ADMIN_ARTIST_ACCOUNT_UNAVAILABLE','paused artist cannot receive new account access');
select throws_ok($$select public.admin_artist_invite('ad200000-0000-4000-8000-000000000001','ad100000-0000-4000-8000-000000000003',false,gen_random_uuid(),1,false)$$,
 '22023','ADMIN_ARTIST_INVALID_INPUT','admin must explicitly confirm exact identity action');
insert into admin_context select 'invite',public.admin_artist_invite('ad200000-0000-4000-8000-000000000001','ad100000-0000-4000-8000-000000000003',true,
 'ad700000-0000-4000-8000-000000000004',(public.admin_artist_detail('ad200000-0000-4000-8000-000000000001')->'artist'->>'revision')::bigint,true);
select is((select data->>'state' from admin_context where key='invite'),'pending','admin issues only pending intent');
reset role;
select is((select role::text from public.profiles where id='ad100000-0000-4000-8000-000000000003'),'fan','issuing invitation grants no persistent access');
select is((select count(*) from public.artist_members where user_id='ad100000-0000-4000-8000-000000000003'),0::bigint,'pending invite adds no membership');
set local role authenticated;
select set_config('request.jwt.claim.sub','ad100000-0000-4000-8000-000000000004',true);
select is(public.artist_account_invitations()->'invitations','[]'::jsonb,'other user cannot enumerate recipient invitation');
select throws_ok($$select public.artist_account_respond((select (data->>'id')::uuid from admin_context where key='invite'),gen_random_uuid(),1,true,true)$$,
 'P0002','ADMIN_ARTIST_NOT_FOUND','other user cannot accept invitation even with ID');
select set_config('request.jwt.claim.sub','ad100000-0000-4000-8000-000000000003',true);
select is(jsonb_array_length(public.artist_account_invitations()->'invitations'),1,'intended recipient sees in-app invitation');
select throws_ok($$select public.artist_account_respond((select (data->>'id')::uuid from admin_context where key='invite'),gen_random_uuid(),1,true,false)$$,
 '22023','ADMIN_ARTIST_INVALID_INPUT','recipient confirmation is distinct from administrative issue');
insert into admin_context select 'accepted',public.artist_account_respond((data->>'id')::uuid,'ad700000-0000-4000-8000-000000000005',1,true,true) from admin_context where key='invite';
select is((select data->>'state' from admin_context where key='accepted'),'accepted','verified recipient can accept approved active artist binding');
select is(public.artist_account_respond((select (data->>'id')::uuid from admin_context where key='invite'),'ad700000-0000-4000-8000-000000000005',1,true,true),
 (select data from admin_context where key='accepted'),'acceptance response replay is idempotent');
select throws_ok($$select public.artist_account_respond((select (data->>'id')::uuid from admin_context where key='invite'),gen_random_uuid(),2,true,true)$$,
 '55000','ADMIN_ARTIST_INVITATION_CLOSED','second new acceptance cannot replay role grant');
reset role;
select is((select role::text from public.profiles where id='ad100000-0000-4000-8000-000000000003'),'artist','accepted identity gets artist role only');
select is((select count(*) from public.artist_members where user_id='ad100000-0000-4000-8000-000000000003'),1::bigint,'acceptance produces exactly one membership');
select is((select is_manager from public.artist_members where user_id='ad100000-0000-4000-8000-000000000003'),true,'confirmed manager assignment is preserved');
select is((select count(*) from private.admin_artist_audit where action='accept_invite'),1::bigint,'acceptance replay has one audit');
update private.artist_account_link_policy set enabled=false;
set local role authenticated;
select set_config('request.jwt.claim.sub','ad100000-0000-4000-8000-000000000001',true);
insert into admin_context select 'unlinked',public.admin_artist_unlink('ad200000-0000-4000-8000-000000000001','ad100000-0000-4000-8000-000000000003',
 'ad700000-0000-4000-8000-000000000006',(public.admin_artist_detail('ad200000-0000-4000-8000-000000000001')->'artist'->>'revision')::bigint,true);
reset role;
select is((select role::text from public.profiles where id='ad100000-0000-4000-8000-000000000003'),'fan','unlink last membership removes artist role');
select is((select count(*) from public.artist_members where user_id='ad100000-0000-4000-8000-000000000003'),0::bigint,'unlink remains possible after policy withdrawal');
update private.artist_account_link_policy set enabled=true;
set local role authenticated;
select set_config('request.jwt.claim.sub','ad100000-0000-4000-8000-000000000003',true);
select is(public.artist_account_respond((select (data->>'id')::uuid from admin_context where key='invite'),'ad700000-0000-4000-8000-000000000005',1,true,true)->>'state',
 'accepted','old acceptance replay reports outcome without reapplying access');
reset role;
select is((select count(*) from public.artist_members where user_id='ad100000-0000-4000-8000-000000000003'),0::bigint,'accepted replay after unlink never restores membership');
set local role authenticated;
select set_config('request.jwt.claim.sub','ad100000-0000-4000-8000-000000000001',true);
insert into admin_context select 'cancelable',public.admin_artist_invite('ad200000-0000-4000-8000-000000000001','ad100000-0000-4000-8000-000000000004',false,
 'ad700000-0000-4000-8000-000000000007',(public.admin_artist_detail('ad200000-0000-4000-8000-000000000001')->'artist'->>'revision')::bigint,true);
reset role;
update private.artist_account_link_policy set enabled=false;
set local role authenticated;
insert into admin_context select 'canceled',public.admin_artist_cancel_invite((data->>'id')::uuid,'ad700000-0000-4000-8000-000000000008',1,true) from admin_context where key='cancelable';
select is((select data->>'state' from admin_context where key='canceled'),'canceled','admin cancellation stays available while config is off');
reset role;
update private.artist_account_link_policy set enabled=true;
set local role authenticated;
select set_config('request.jwt.claim.sub','ad100000-0000-4000-8000-000000000004',true);
select throws_ok($$select public.artist_account_respond((select (data->>'id')::uuid from admin_context where key='cancelable'),gen_random_uuid(),2,true,true)$$,
 '55000','ADMIN_ARTIST_INVITATION_CLOSED','canceled invite cannot grant access');
select set_config('request.jwt.claim.sub','ad100000-0000-4000-8000-000000000001',true);
insert into admin_context select 'expiring',public.admin_artist_invite('ad200000-0000-4000-8000-000000000001','ad100000-0000-4000-8000-000000000004',false,
 'ad700000-0000-4000-8000-000000000009',(public.admin_artist_detail('ad200000-0000-4000-8000-000000000001')->'artist'->>'revision')::bigint,true);
reset role;
update private.artist_account_invitations set created_at=now()-interval '3 days',expires_at=now()-interval '1 day'
 where id=(select (data->>'id')::uuid from admin_context where key='expiring');
set local role authenticated;
select set_config('request.jwt.claim.sub','ad100000-0000-4000-8000-000000000004',true);
select is(public.artist_account_invitations()->'invitations'->0->>'state','canceled','inbox newest-first does not hide closed audit state');
select throws_ok($$select public.artist_account_respond((select (data->>'id')::uuid from admin_context where key='expiring'),gen_random_uuid(),1,true,true)$$,
 '55000','ADMIN_ARTIST_INVITATION_EXPIRED','elapsed invite fails at mutation boundary');
select set_config('request.jwt.claim.sub','ad100000-0000-4000-8000-000000000001',true);
-- A fictional verified ledger lifecycle exists before deactivation. No network,
-- provider or real charge: these are disposable DB contract fixtures only.
reset role;
create temporary table admin_billing(key text primary key,id uuid,data jsonb);
grant all on admin_billing to service_role;
set local role service_role;
insert into admin_billing(key,id) values('subscription',public.billing_open_subscription(
 'ad100000-0000-4000-8000-000000000007','ad200000-0000-4000-8000-000000000001','toss'));
insert into admin_billing(key,id) select 'mandate',public.billing_register_mandate(id,'test','fictional-admin-merchant',
 'ad800000-0000-4000-8000-000000000001','ad800000-0000-4000-8000-000000000002','fictional-admin-consent') from admin_billing where key='subscription';
insert into admin_billing(key,id) select 'obligation',public.billing_prepare_obligation(id,now()-interval '1 day',now()+interval '29 days',1000,true,
 'fictional-admin-price',259200,86400,3) from admin_billing where key='subscription';
insert into admin_billing(key,id) select 'attempt',public.billing_prepare_attempt(id) from admin_billing where key='obligation';
insert into admin_billing(key,data) select 'claim',public.billing_claim_attempt(id,120) from admin_billing where key='attempt';
insert into admin_billing(key,id) select 'charge',public.billing_finalize_charge(id,'fictional-admin-charge',1000,'KRW',now(),
 'ad800000-0000-4000-8000-000000000003') from admin_billing where key='attempt';
reset role;
insert into admin_billing(key,data) select 'original_subscription',to_jsonb(s) from public.subscriptions s where id=(select id from admin_billing where key='subscription');
insert into admin_billing(key,data) select 'original_charge',to_jsonb(e) from public.payment_events e where id=(select id from admin_billing where key='charge');
set local role authenticated;
insert into admin_context select 'deactivation',public.admin_artist_invite('ad200000-0000-4000-8000-000000000001','ad100000-0000-4000-8000-000000000004',false,
 'ad700000-0000-4000-8000-000000000010',(public.admin_artist_detail('ad200000-0000-4000-8000-000000000001')->'artist'->>'revision')::bigint,true);
insert into admin_context select 'paused',public.admin_artist_save('ad200000-0000-4000-8000-000000000001','ad700000-0000-4000-8000-000000000011',
 (public.admin_artist_detail('ad200000-0000-4000-8000-000000000001')->'artist'->>'revision')::bigint,pg_temp.input('허구 중지','paused'));
select is(public.admin_artist_detail('ad200000-0000-4000-8000-000000000001')->'invitations'->0->>'state','canceled','deactivation cancels pending account intents');
reset role;
select is((select count(*) from public.messages where artist_id='ad200000-0000-4000-8000-000000000001'),3::bigint,'deactivation preserves message and cancellation history');
select is((select to_jsonb(s) from public.subscriptions s where id=(select id from admin_billing where key='subscription')),
 (select data from admin_billing where key='original_subscription'),'deactivation does not delete or rewrite paid subscription history');
select is((select to_jsonb(e) from public.payment_events e where id=(select id from admin_billing where key='charge')),
 (select data from admin_billing where key='original_charge'),'deactivation preserves immutable recognized financial record byte-for-byte');

select is((select count(*) from public.artist_catalog where id='ad200000-0000-4000-8000-000000000001'),0::bigint,'deactivated artist disappears from public catalog');
update public.profiles set role='fan' where id='ad100000-0000-4000-8000-000000000001';
set local role authenticated;
select throws_ok('select public.admin_artist_list()','42501','ADMIN_ARTIST_FORBIDDEN','role loss takes effect despite old authenticated session');
select throws_ok($$select public.admin_artist_save('ad200000-0000-4000-8000-000000000001','ad700000-0000-4000-8000-000000000001',1,pg_temp.input('허구 수정 가수'))$$,
 '42501','ADMIN_ARTIST_FORBIDDEN','replaying old successful operation cannot bypass current admin role');
select set_config('request.jwt.claim.sub','ad100000-0000-4000-8000-000000000004',true);
select throws_ok($$select public.artist_account_respond((select (data->>'id')::uuid from admin_context where key='deactivation'),gen_random_uuid(),1,true,true)$$,
 '42501','ADMIN_ARTIST_FORBIDDEN','inviter role revocation blocks recipient acceptance');
reset role;

select * from finish();
rollback;
