begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
set local timezone='UTC';
select no_plan();

select is((select count(*) from private.admin_display_settings),0::bigint,'migration does not persist even the technical fallback as operator choice');
select is((select count(*) from private.message_policy),0::bigint,'migration activates no message policy');
select is((select count(*) from private.community_policy),0::bigint,'migration activates no community policy');
select is((select count(*) from private.admin_settings_audit),0::bigint,'empty installation has no fabricated operator audit');
select is((select count(*) from private.admin_settings_state where revision=0 and snapshot is null),3::bigint,'three empty revision slots are technical metadata only');
select ok((select bool_and(relrowsecurity) from pg_class where oid in('private.admin_display_settings'::regclass,'private.admin_settings_state'::regclass,
 'private.admin_settings_audit'::regclass,'private.admin_settings_operations'::regclass)),'all settings storage enables RLS');
select ok((select bool_and(not has_table_privilege(r,t,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')) from unnest(array['anon','authenticated','service_role'])r
 cross join unnest(array['private.admin_display_settings','private.admin_settings_state','private.admin_settings_audit','private.admin_settings_operations'])t),
 'API roles cannot bypass the audited RPCs or read private metadata');
select ok((select bool_and(prosecdef and 'search_path=""'=any(proconfig)) from pg_proc where oid in(
 'public.admin_settings_list()'::regprocedure,'public.admin_settings_save(text,uuid,bigint,jsonb,boolean,uuid)'::regprocedure,'public.chat_settings()'::regprocedure)),
 'all public settings RPCs use pinned definer paths');
select ok((select bool_and(has_function_privilege('authenticated',oid,'EXECUTE') and not has_function_privilege('anon',oid,'EXECUTE')
 and not has_function_privilege('service_role',oid,'EXECUTE')) from pg_proc where pronamespace='public'::regnamespace and proname like 'admin_settings_%'),
 'settings management requires an authenticated administrator, not a service actor');
select ok((select bool_and(not has_function_privilege(r,oid,'EXECUTE')) from pg_proc cross join unnest(array['anon','authenticated','service_role'])r
 where pronamespace='private'::regnamespace and proname like 'admin_settings_%'),'private settings helpers cannot be invoked through API roles');
select ok(has_function_privilege('service_role','public.chat_settings()','EXECUTE') and not has_function_privilege('authenticated','public.chat_settings()','EXECUTE'),
 'pagination getter is a narrow service-only projection');

insert into auth.users(id,email,raw_user_meta_data)
select ('ae100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'settings-fixture-'||n||'@example.invalid','{}'::jsonb from generate_series(1,5)n;
update public.profiles set role='admin' where id in('ae100000-0000-4000-8000-000000000001','ae100000-0000-4000-8000-000000000002');
update public.profiles set role='artist' where id='ae100000-0000-4000-8000-000000000004';
update public.profiles set role='admin',is_restricted=true where id='ae100000-0000-4000-8000-000000000005';
create temporary table settings_context(key text primary key,data jsonb);
grant all on settings_context to authenticated,service_role;
create function pg_temp.group_value(p_group text) returns jsonb language sql as $$
 select item from jsonb_array_elements(public.admin_settings_list()->'groups')item where item->>'key'=p_group$$;
create function pg_temp.save(p_group text,p_values jsonb,p_revision bigint,p_operation uuid default gen_random_uuid(),p_confirmed boolean default true,p_decision uuid default 'ae700000-0000-4000-8000-000000000001')
returns jsonb language sql as $$select public.admin_settings_save(p_group,p_operation,p_revision,p_values,p_confirmed,p_decision)$$;

set local role anon;
select throws_ok('select public.admin_settings_list()','42501',null,'anonymous cannot enumerate settings');
reset role;
set local role service_role;
select is(public.chat_settings(),' {"page_size":30}'::jsonb,'missing display row preserves prior technical pagination');
select throws_ok('select public.admin_settings_list()','42501',null,'service role cannot use interactive admin management');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','ae100000-0000-4000-8000-000000000003',true);
select throws_ok('select public.admin_settings_list()','42501','ADMIN_SETTINGS_FORBIDDEN','fan cannot read administrative configuration');
select set_config('request.jwt.claim.sub','ae100000-0000-4000-8000-000000000004',true);
select throws_ok('select public.admin_settings_list()','42501','ADMIN_SETTINGS_FORBIDDEN','artist cannot read administrative configuration');
select set_config('request.jwt.claim.sub','ae100000-0000-4000-8000-000000000005',true);
select throws_ok('select public.admin_settings_list()','42501','ADMIN_SETTINGS_FORBIDDEN','restricted administrator cannot read settings');
select set_config('request.jwt.claim.sub','ae100000-0000-4000-8000-000000000001',true);
select is(pg_temp.group_value('message')->>'configured','false','missing business policy is unavailable not defaulted');
select is(pg_temp.group_value('message')->'values','null'::jsonb,'missing values do not masquerade as approved defaults');
select is(pg_temp.group_value('display')->'values','{"page_size":30}'::jsonb,'technical compatibility default is explicitly visible');
select is(pg_temp.group_value('display')->>'revision','0','unconfigured display starts at revision zero');
select throws_ok($$select pg_temp.save('display','{"page_size":31}',0,gen_random_uuid(),false)$$,'22023','ADMIN_SETTINGS_CONFIRMATION_REQUIRED','confirmation must be explicit');
select throws_ok($$select pg_temp.save('display','{"page_size":31}',0,gen_random_uuid(),null)$$,'22023','ADMIN_SETTINGS_CONFIRMATION_REQUIRED','null is not confirmation');
select throws_ok($$select pg_temp.save('display','{"page_size":31}',0,gen_random_uuid(),true,null)$$,'22023','ADMIN_SETTINGS_INVALID_INPUT','change requires opaque decision reference');
select throws_ok($$select pg_temp.save('display','{"page_size":31}',null)$$,'22023','ADMIN_SETTINGS_INVALID_INPUT','CAS revision required');
select throws_ok($$select pg_temp.save('display','{"page_size":31}',-1)$$,'22023','ADMIN_SETTINGS_INVALID_INPUT','negative revision denied');
select throws_ok($$select pg_temp.save('display','{"page_size":31}',9007199254740991)$$,'22023','ADMIN_SETTINGS_INVALID_INPUT','unrepresentable next revision denied');
select throws_ok($$select pg_temp.save('display','{"page_size":31}',0,null)$$,'22023','ADMIN_SETTINGS_INVALID_INPUT','operation id required');
select throws_ok($$select pg_temp.save('billing','{"price_krw":1}',0)$$,'22023','ADMIN_SETTINGS_INVALID_INPUT','money group cannot enter editor');
select throws_ok($$select pg_temp.save('display','{"page_size":31,"secret":"do-not-echo"}',0)$$,'22023','ADMIN_SETTINGS_INVALID_INPUT','unknown keys rejected without echo');
select throws_ok($$select pg_temp.save('display','{"secret":31}',0)$$,'22023','ADMIN_SETTINGS_INVALID_INPUT','same-length unknown object rejected');
select throws_ok($$select pg_temp.save('display','{}',0)$$,'22023','ADMIN_SETTINGS_INVALID_INPUT','missing fields rejected');
select throws_ok($$select pg_temp.save('display','[]',0)$$,'22023','ADMIN_SETTINGS_INVALID_INPUT','arrays rejected');
select throws_ok($$select pg_temp.save('display','null',0)$$,'22023','ADMIN_SETTINGS_INVALID_INPUT','JSON null rejected');
select throws_ok($$select pg_temp.save('display',null,0)$$,'22023','ADMIN_SETTINGS_INVALID_INPUT','SQL null rejected');
select throws_ok($$select pg_temp.save('display','{"page_size":"31"}',0)$$,'22023','ADMIN_SETTINGS_INVALID_INPUT','numeric strings not coerced');
select throws_ok($$select pg_temp.save('display','{"page_size":true}',0)$$,'22023','ADMIN_SETTINGS_INVALID_INPUT','booleans not coerced');
select throws_ok($$select pg_temp.save('display','{"page_size":31.5}',0)$$,'22023','ADMIN_SETTINGS_INVALID_INPUT','fractional integers rejected');
select throws_ok($$select pg_temp.save('display','{"page_size":0}',0)$$,'22023','ADMIN_SETTINGS_INVALID_INPUT','page size lower bound');
select throws_ok($$select pg_temp.save('display','{"page_size":101}',0)$$,'22023','ADMIN_SETTINGS_INVALID_INPUT','page size upper bound');
insert into settings_context values('display',pg_temp.save('display','{"page_size":40}',0,'ae600000-0000-4000-8000-000000000001'));
select is((select data->>'revision' from settings_context where key='display'),'1','first explicit display edit increments revision');
select is(pg_temp.save('display','{"page_size":40}',0,'ae600000-0000-4000-8000-000000000001'),
 (select data from settings_context where key='display'),'same operation replays accepted snapshot');
select throws_ok($$select pg_temp.save('display','{"page_size":41}',0,'ae600000-0000-4000-8000-000000000001')$$,
 '23505','ADMIN_SETTINGS_OPERATION_CONFLICT','operation reuse with new values rejected');
select throws_ok($$select pg_temp.save('display','{"page_size":41}',0)$$,'40001','ADMIN_SETTINGS_REVISION_CONFLICT','stale edit cannot overwrite');
select is(pg_temp.group_value('display')->'values','{"page_size":40}'::jsonb,'stale attempts do not write');
select is(jsonb_array_length(public.admin_settings_list()->'audit'),1,'replays and rejected attempts do not add audit rows');
select is(public.admin_settings_list()->'audit'->0->>'actor_id','ae100000-0000-4000-8000-000000000001','audit identifies actor UUID without personal details');
select is(public.admin_settings_list()->'audit'->0->>'decision_reference','ae700000-0000-4000-8000-000000000001','audit preserves opaque approved-decision reference');
select is(public.admin_settings_list()->'audit'->0->'before_value','{"page_size":30}'::jsonb,'initial edit audits actual compatibility value');
select is(public.admin_settings_list()->'audit'->0->'after_value','{"page_size":40}'::jsonb,'audit records changed typed value');
select ok(public.admin_settings_list()->'audit'->0 ? 'created_at','audit carries timestamp');
reset role;
set local role service_role;
select is(public.chat_settings(),' {"page_size":40}'::jsonb,'runtime consumer reads newly configured page size');
reset role;
select is((select count(*) from private.admin_settings_audit),1::bigint,'only accepted edit was audited');
select throws_ok('update private.admin_settings_audit set revision=100','55000','ADMIN_SETTINGS_AUDIT_IMMUTABLE','audit cannot be rewritten even by owner');
select throws_ok('delete from private.admin_settings_audit','55000','ADMIN_SETTINGS_AUDIT_IMMUTABLE','audit cannot be deleted');
select throws_ok('truncate private.admin_settings_audit','55000','ADMIN_SETTINGS_AUDIT_IMMUTABLE','audit cannot be truncated');
select throws_ok('truncate private.admin_settings_operations','55000','ADMIN_SETTINGS_AUDIT_IMMUTABLE','replay evidence cannot be truncated');

-- Compatibility: existing full-row positional provisioning and role grants
-- stay valid; only safe numeric fields enter the administrative projection.
insert into private.message_policy values(true,'private-version-do-not-echo',604800,300,1000,100,10,180,60,5,10485760,20971520,104857600);
insert into private.community_policy values(true,'private-community-version',100,1000,100,100,3,10485760,1600,3,60,10,5,
 array['private-term-do-not-echo'],array['private-pattern-do-not-echo']);
select is((select revision from private.admin_settings_state where group_key='message'),1::bigint,'operator creation establishes revision without changing table shape');
select is((select source from private.admin_settings_audit where group_key='message'),'operator','privileged provisioning is not falsely attributed to an admin');
set local role authenticated;
select set_config('request.jwt.claim.sub','ae100000-0000-4000-8000-000000000001',true);
select ok(public.admin_settings_list()::text not like '%do-not-echo%','raw labels and moderation values are absent from every projection/audit');
insert into settings_context values('message',pg_temp.group_value('message')->'values'),('community',pg_temp.group_value('community')->'values');
select throws_ok($$select pg_temp.save('message',(select data from settings_context where key='message')||'{"max_text_length":0}',1)$$,
 '22023','ADMIN_SETTINGS_INVALID_INPUT','message lower bound validated');
select throws_ok($$select pg_temp.save('message',(select data from settings_context where key='message')||'{"history_before_seconds":31536001}',1)$$,
 '22023','ADMIN_SETTINGS_INVALID_INPUT','history upper bound validated');
select throws_ok($$select pg_temp.save('message',(select data from settings_context where key='message')||'{"max_photo_bytes":10485761}',1)$$,
 '22023','ADMIN_SETTINGS_INVALID_INPUT','media ceiling validated without inspecting any media bytes');
select throws_ok($$select pg_temp.save('community',(select data from settings_context where key='community')||'{"forbidden_terms":[]}',1)$$,
 '22023','ADMIN_SETTINGS_INVALID_INPUT','moderation dataset not editable through numeric form');
select throws_ok($$select pg_temp.save('community',(select data from settings_context where key='community')||'{"max_images":-1}',1)$$,
 '22023','ADMIN_SETTINGS_INVALID_INPUT','community zero-cap boundary enforced');
select lives_ok($$select pg_temp.save('message',(select data from settings_context where key='message')||'{"history_before_seconds":0,"cancel_window_seconds":0,"max_text_length":1500}',1)$$,
 'explicitly confirmed new access/cancellation bounds accepted');
select lives_ok($$select pg_temp.save('community',(select data from settings_context where key='community')||'{"max_images":0,"max_body_length":2000}',1)$$,
 'community actual operational bounds can change');
reset role;
select is((select max_text_length from private.message_policy),1500,'edit writes actual message policy consumer field');
select is((select max_body_length from private.community_policy),2000,'edit writes actual community consumer field');
select is((select forbidden_terms from private.community_policy),array['private-term-do-not-echo'],'forbidden terms untouched');
select is((select forbidden_patterns from private.community_policy),array['private-pattern-do-not-echo'],'forbidden patterns untouched');
select matches((select version from private.message_policy),'^admin-','new safe policy version generated from operation UUID');
update private.community_policy set forbidden_terms=array['private-changed-term'];
set local role authenticated;
select throws_ok($$select pg_temp.save('community',(select data from settings_context where key='community'),2)$$,
 '40001','ADMIN_SETTINGS_REVISION_CONFLICT','even hidden-field operator change invalidates stale CAS');
reset role;
select ok((select bool_and(actor_id is null) from private.admin_settings_audit where source='operator'),'operator changes never guess identity from lingering JWT');

-- Preview cap cannot conceal already selected rows. No media parsing/upload.
insert into public.artists(id,slug,name,grade,status) values('ae200000-0000-4000-8000-000000000001','settings-preview','허구 설정 가수','B','active');
insert into public.messages(id,artist_id,author_id,type,body,status,scheduled_at,sent_at,is_preview,preview_order)
select ('ae300000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'ae200000-0000-4000-8000-000000000001','ae100000-0000-4000-8000-000000000001',
 'text','허구 맛보기','sent',now()-interval '1 minute',now()-interval '1 minute',true,n from generate_series(1,2)n;
set local role authenticated;
select throws_ok($$select pg_temp.save('message',(pg_temp.group_value('message')->'values')||'{"preview_max_count":1}',2)$$,
 '23514','ADMIN_SETTINGS_PREVIEW_LIMIT_CONFLICT','lower cap cannot silently remove selected previews');
select lives_ok($$select pg_temp.save('message',(pg_temp.group_value('message')->'values')||'{"preview_max_count":2}',2)$$,
 'exact existing selected count is allowed');
reset role;
select is((select count(*) from public.messages where is_preview),2::bigint,'configuration does not rewrite curated preview selection');
select throws_ok('truncate private.message_policy','55000','ADMIN_SETTINGS_AUDIT_IMMUTABLE','source truncation cannot bypass revision evidence');
select throws_ok('truncate private.community_policy','55000','ADMIN_SETTINGS_AUDIT_IMMUTABLE','community truncation cannot bypass evidence');
delete from private.message_policy;
set local role authenticated;
select is(pg_temp.group_value('message')->>'configured','false','withdrawn policy becomes unavailable');
select throws_ok($$select pg_temp.save('message',(select data from settings_context where key='message'),4)$$,
 '55000','ADMIN_SETTINGS_SETUP_NOT_READY','save cannot recreate or activate missing business policy');
reset role;
update public.profiles set role='fan' where id='ae100000-0000-4000-8000-000000000001';
set local role authenticated;
select throws_ok($$select pg_temp.save('display','{"page_size":40}',0,'ae600000-0000-4000-8000-000000000001')$$,
 '42501','ADMIN_SETTINGS_FORBIDDEN','operation replay rechecks current role instead of granting former admin access');
reset role;

-- Every editable numeric field is checked at both exact bounds and outside.
create temporary table setting_bounds(group_key text,key text,lo bigint,hi bigint);
insert into setting_bounds values
 ('message','history_before_seconds',0,31536000),('message','cancel_window_seconds',0,86400),('message','max_text_length',1,100000),
 ('message','max_reply_length',1,10000),('message','max_photos',1,100),('message','max_voice_seconds',1,86400),
 ('message','max_video_seconds',1,86400),('message','preview_max_count',0,100),('message','max_photo_bytes',1,10485760),
 ('message','max_voice_bytes',1,20971520),('message','max_video_bytes',1,104857600),
 ('community','max_title_length',1,1000),('community','max_body_length',1,100000),('community','max_comment_length',1,10000),
 ('community','max_reason_length',1,10000),('community','max_images',0,100),('community','max_image_bytes',1,10485760),
 ('community','max_image_long_edge',1,100000),('community','auto_hide_report_count',1,100000),('community','rate_window_seconds',1,86400),
 ('community','max_contributions_per_window',1,10000),('community','max_reports_per_window',1,10000),('display','page_size',1,100);
create function pg_temp.base(p_group text) returns jsonb language sql as $$
 select case when p_group='display' then '{"page_size":30}'::jsonb else (select data from settings_context where key=p_group) end$$;
select lives_ok(format('select private.admin_settings_validate(%L,%L::jsonb)',group_key,pg_temp.base(group_key)||jsonb_build_object(key,lo)),group_key||'.'||key||' exact lower boundary') from setting_bounds;
select lives_ok(format('select private.admin_settings_validate(%L,%L::jsonb)',group_key,pg_temp.base(group_key)||jsonb_build_object(key,hi)),group_key||'.'||key||' exact upper boundary') from setting_bounds;
select throws_ok(format('select private.admin_settings_validate(%L,%L::jsonb)',group_key,pg_temp.base(group_key)||jsonb_build_object(key,lo-1)),
 '22023','ADMIN_SETTINGS_INVALID_INPUT',group_key||'.'||key||' below boundary') from setting_bounds;
select throws_ok(format('select private.admin_settings_validate(%L,%L::jsonb)',group_key,pg_temp.base(group_key)||jsonb_build_object(key,hi+1)),
 '22023','ADMIN_SETTINGS_INVALID_INPUT',group_key||'.'||key||' above boundary') from setting_bounds;
select throws_ok(format('select private.admin_settings_validate(%L,%L::jsonb)',group_key,pg_temp.base(group_key)||jsonb_build_object(key,lo+0.5)),
 '22023','ADMIN_SETTINGS_INVALID_INPUT',group_key||'.'||key||' fractional integer') from setting_bounds;
set local role authenticated;
select set_config('request.jwt.claim.sub','ae100000-0000-4000-8000-000000000002',true);
select is(pg_temp.save('display','{"page_size":30.0}',1)->'values','{"page_size":30}'::jsonb,'integral JSON decimal normalizes safely to database integer');
reset role;

-- No financial policy/table was touched by any successful or rejected change.
select is((select count(*) from private.checkout_policies)+(select count(*) from private.renewal_policies)+(select count(*) from private.refund_policies)
 +(select count(*) from private.billing_notice_policies)+(select count(*) from private.settlement_policies)+(select count(*) from public.payment_events),
 0::bigint,'editor does not synthesize or approve any commercial policy or money');
select * from finish();
rollback;
