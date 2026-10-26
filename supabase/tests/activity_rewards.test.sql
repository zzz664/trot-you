begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
set local timezone='UTC';
select no_plan();

select ok((select prosecdef and 'search_path=""'=any(proconfig) from pg_proc where oid='public.point_ui_activity(integer,timestamptz,uuid)'::regprocedure),'activity snapshot pins security-definer search path');
select ok(has_function_privilege('authenticated','public.point_ui_activity(integer,timestamptz,uuid)','EXECUTE'),'current authenticated actors can read their activity');
select ok((select bool_and(not has_function_privilege(r,'public.point_ui_activity(integer,timestamptz,uuid)','EXECUTE')) from unnest(array['anon','service_role'])r),'anonymous and service keys cannot impersonate activity readers');
select ok((select bool_and(not has_table_privilege(r,'private.point_activity_outcomes','SELECT,INSERT,UPDATE,DELETE,TRUNCATE')) from unnest(array['anon','authenticated','service_role'])r),'no API role can read or forge outcome metadata');
select ok((select relrowsecurity from pg_class where oid='private.point_activity_outcomes'::regclass),'outcome metadata enables RLS defense in depth');
select ok((select bool_and(not has_function_privilege(r,oid,'EXECUTE')) from pg_proc cross join unnest(array['anon','authenticated','service_role'])r where pronamespace='private'::regnamespace and proname like 'point_activity_%'),'private outcome helpers are not API functions');
select is((select count(*) from private.point_policy),0::bigint,'migration activates no point policy');
select is((select count(*) from private.point_ledger),0::bigint,'migration awards no points');
select is((select count(*) from private.point_activity_outcomes),0::bigint,'migration backfills no speculative decisions');
select is((select count(*) from pg_proc where pronamespace='public'::regnamespace and proname like 'point_%' and (proname like '%share%' or proname like '%mission%' or proname like '%claim%')),0::bigint,'no unverified share or mission claim RPC is introduced');

-- Fictional rollback-only fixtures. No policy or account in any hosted project
-- is read or changed; only the disposable real local Auth schema is exercised.
create function pg_temp.id(n integer) returns uuid language sql immutable as $$select ('d3800000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
insert into auth.users(id,email,raw_user_meta_data) select pg_temp.id(n),'activity-unit-'||n||'@example.invalid','{}'::jsonb from generate_series(1,8)n;
update public.profiles set call_name='가상활동팬',onboarding_completed_at=clock_timestamp() where id::text like 'd3800000-%';
update public.profiles set role='admin' where id=pg_temp.id(3);
update public.profiles set role='artist' where id=pg_temp.id(4);
update public.profiles set is_restricted=true where id=pg_temp.id(5);
update public.profiles set is_restricted=true,restricted_until=clock_timestamp()-interval '1 second' where id=pg_temp.id(6);
update public.profiles set onboarding_completed_at=null where id=pg_temp.id(7);
insert into public.artists(id,slug,name,grade,status) values(pg_temp.id(1001),'activity-unit','Fictional activity artist','B','active');
insert into public.posts(id,artist_id,user_id,request_id,title,body) values
 (pg_temp.id(101),pg_temp.id(1001),pg_temp.id(1),pg_temp.id(10101),'Fictional parent','Fictional body'),
 (pg_temp.id(105),pg_temp.id(1001),pg_temp.id(2),pg_temp.id(10105),'Legacy zero source','Private source body'),
 (pg_temp.id(106),pg_temp.id(1001),pg_temp.id(2),pg_temp.id(10106),'Legacy positive source','Private source body');
insert into private.community_policy(version,max_title_length,max_body_length,max_comment_length,max_reason_length,
 max_images,max_image_bytes,max_image_long_edge,auto_hide_report_count,rate_window_seconds,
 max_contributions_per_window,max_reports_per_window,forbidden_terms,forbidden_patterns)
values('fictional-activity-community',100,1000,100,100,3,10485760,2048,3,60,100,100,array['blockedword'],array[]::text[]);
create temporary table activity_context(key text primary key,data jsonb);
grant all on activity_context to authenticated;
create function pg_temp.create_post(n integer,p_title text default 'Fictional post') returns jsonb language sql as $$
 select public.board_ui_create('activity-unit',pg_temp.id(n+10000),pg_temp.id(n),pg_temp.id(1001),p_title,'Fictional body',array[]::uuid[],false,false)$$;
create function pg_temp.create_comment(n integer,p_post integer default 101) returns jsonb language sql as $$
 select public.community_ui_create_comment('activity-unit',pg_temp.id(n+10000),pg_temp.id(p_post),pg_temp.id(n),'Fictional comment')$$;

set local role anon;
select throws_ok($$select public.point_ui_activity()$$,'42501',null,'anonymous activity read denied');
reset role;
set local role service_role;
select throws_ok($$select public.point_ui_activity()$$,'42501',null,'service key cannot read private user activity');
reset role;
set local role authenticated;
select throws_ok($$select public.point_ui_activity()$$,'42501','COMMUNITY_FORBIDDEN','authenticated role without actor denied');
select set_config('request.jwt.claim.sub',pg_temp.id(1)::text,true);
insert into activity_context values('empty',public.point_ui_activity());
select is((select data->>'actor_id' from activity_context where key='empty'),pg_temp.id(1)::text,'snapshot bound to current actor');
select is((select data->>'kst_date' from activity_context where key='empty'),(clock_timestamp() at time zone 'Asia/Seoul')::date::text,'snapshot day is database KST');
set local timezone='Pacific/Honolulu';
select is(public.point_ui_activity()->>'kst_date',(clock_timestamp() at time zone 'Asia/Seoul')::date::text,'browser or session timezone cannot change activity day');
set local timezone='UTC';
select is((select data->'contribution_policy' from activity_context where key='empty'),'null'::jsonb,'absent policy is not zero or unlimited configuration');
select is((select data->'entries' from activity_context where key='empty'),'[]'::jsonb,'empty contribution history stays empty');
select is((select data->'next_cursor' from activity_context where key='empty'),'null'::jsonb,'empty history has no cursor');
select is(public.point_ui_activity()->'share','{"configured":false,"reason":"verification_unconfigured"}'::jsonb,'share click cannot become a verified reward');
select is(public.point_ui_activity()->'missions','{"configured":false,"reason":"rules_unconfigured"}'::jsonb,'no invented mission rule or completion');
select is(public.point_ui_activity()->'grade','{"configured":false,"reason":"score_definition_unconfigured"}'::jsonb,'no invented activity score or thresholds');
select is((select string_agg(k,',' order by k) from jsonb_object_keys(public.point_ui_activity())k),'actor_id,contribution_policy,entries,grade,kst_date,missions,next_cursor,share','snapshot has only explicit safe DTO fields');
select throws_ok($$select public.point_ui_activity(0)$$,'22023','POINT_PAGE_INVALID','zero page rejected');
select throws_ok($$select public.point_ui_activity(null)$$,'22023','POINT_PAGE_INVALID','null page rejected');
select throws_ok($$select public.point_ui_activity(101)$$,'22023','POINT_PAGE_INVALID','unbounded page rejected');
select throws_ok($$select public.point_ui_activity(1,now(),null)$$,'22023','POINT_PAGE_INVALID','timestamp-only cursor rejected');
select throws_ok($$select public.point_ui_activity(1,null,pg_temp.id(1))$$,'22023','POINT_PAGE_INVALID','id-only cursor rejected');
select throws_ok($$select public.point_ui_activity(1,'infinity',pg_temp.id(1))$$,'22023','POINT_PAGE_INVALID','infinite cursor rejected');
select throws_ok($$select public.point_ui_activity(1,'-infinity',pg_temp.id(1))$$,'22023','POINT_PAGE_INVALID','negative infinite cursor rejected');
insert into activity_context values('unconfigured-create',pg_temp.create_post(200));
reset role;
select is((select count(*) from private.point_ledger),0::bigint,'unconfigured content creates no reward');
select is((select count(*) from private.point_activity_outcomes),0::bigint,'unconfigured content creates no misleading outcome');
insert into private.point_policy(version,attendance_amount,post_amount,comment_amount,post_daily_cap,comment_daily_cap,deleted_content_treatment)
values('fictional-activity-v1',2,17,4,1,1,'retain');
set local role authenticated;
select is(pg_temp.create_post(200),(select data from activity_context where key='unconfigured-create'),'old creation replay retains its response after activation');
select is(public.point_ui_activity()->'entries','[]'::jsonb,'policy activation never backfills unrewarded content');
select is(public.point_ui_activity()->'contribution_policy'->'post','{"amount":17,"daily_cap":1,"used":0,"awarded":0,"remaining":1}'::jsonb,'approved post rule projects exact unused values');
select is(public.point_ui_activity()->'contribution_policy'->>'deleted_content_treatment','retain','only explicitly supported historical retention is represented');
insert into activity_context values('first-post',pg_temp.create_post(201));
select is(public.point_ui_activity()->'entries'->0->>'outcome','awarded','first positive post records exact awarded outcome');
select is(public.point_ui_activity()->'entries'->0->>'amount','17','post credits configured amount only');
select is(pg_temp.create_post(201),(select data from activity_context where key='first-post'),'same operation returns same post receipt');
select throws_ok($$select pg_temp.create_post(201,'Changed replay')$$,'23505','BOARD_OPERATION_CONFLICT','conflicting post replay rejected');
select is(public.point_balance(),17::bigint,'post replay cannot duplicate award');
select lives_ok($$select pg_temp.create_post(202)$$,'cap does not block valid post creation');
select is(public.point_ui_activity()->'entries'->0->>'outcome','daily_cap','second post records cap decision, not generic zero');
select is(public.point_ui_activity()->'entries'->0->>'amount','0','capped post records actual zero award');
select is(public.point_ui_activity()->'contribution_policy'->'post','{"amount":17,"daily_cap":1,"used":2,"awarded":1,"remaining":0}'::jsonb,'recorded creation count and positive reward count are distinct');
insert into activity_context values('first-comment',pg_temp.create_comment(301));
select is(public.point_ui_activity()->'entries'->0->>'reason','comment','comment has distinct contribution reason');
select is(public.point_ui_activity()->'entries'->0->>'outcome','awarded','first comment records positive award');
select is(pg_temp.create_comment(301),(select data from activity_context where key='first-comment'),'same comment operation returns original receipt');
select lives_ok($$select pg_temp.create_comment(302)$$,'cap does not block valid comment creation');
select is(public.point_ui_activity()->'entries'->0->>'outcome','daily_cap','comment cap is recorded explicitly');
select is(public.point_ui_activity()->'contribution_policy'->'comment','{"amount":4,"daily_cap":1,"used":2,"awarded":1,"remaining":0}'::jsonb,'comment cap is separate from post cap');
select is(public.point_balance(),21::bigint,'two actions award exactly once and capped actions add zero');
select is((select string_agg(k,',' order by k) from jsonb_object_keys(public.point_ui_activity()->'entries'->0)k),'amount,created_at,earned_on,id,outcome,reason','entry omits source content, source IDs, actor IDs and private policy');
reset role;
select is((select count(*) from private.point_activity_outcomes),4::bigint,'four persisted contributions have four decisions');
select is((select count(*) from private.point_ledger),4::bigint,'decision insertion uses existing ledger rather than a second balance');
select is((select count(*) from private.point_activity_outcomes o join private.point_ledger l on l.id=o.entry_id where l.reason in('post','comment')),4::bigint,'every decision references its actual persisted contribution');
select throws_ok($$update private.point_activity_outcomes set outcome='awarded'$$,'55000','POINT_ACTIVITY_OUTCOME_IMMUTABLE','outcome metadata cannot be rewritten');
select throws_ok($$delete from private.point_activity_outcomes$$,'55000','POINT_ACTIVITY_OUTCOME_IMMUTABLE','outcome metadata cannot be deleted');
select throws_ok($$truncate private.point_activity_outcomes$$,'55000','POINT_ACTIVITY_OUTCOME_IMMUTABLE','outcome metadata cannot be truncated');
select throws_ok($$update private.point_ledger set amount=99$$,'55000','POINT_LEDGER_IMMUTABLE','existing ledger immutability remains intact');
update private.point_policy set version='fictional-activity-zero',post_amount=0,comment_amount=0,post_daily_cap=null,comment_daily_cap=0;
set local role authenticated;
select lives_ok($$select pg_temp.create_post(203)$$,'explicit zero amount allows content persistence');
select is(public.point_ui_activity()->'entries'->0->>'outcome','zero_amount','configured zero differs from cap exhaustion');
select is(public.point_ui_activity()->'contribution_policy'->'post','{"amount":0,"daily_cap":null,"used":3,"awarded":1,"remaining":null}'::jsonb,'explicit unlimited cap remains null and still counts zero actions');
select lives_ok($$select pg_temp.create_comment(303)$$,'zero cap still allows comment content');
select is(public.point_ui_activity()->'entries'->0->>'outcome','daily_cap','cap decision takes precedence when zero amount and zero cap coincide');
select is(public.point_ui_activity()->'contribution_policy'->'comment'->>'used','3','capped zero comment consumes recorded creation count');
select is(public.point_ui_activity()->'contribution_policy'->'comment'->>'awarded','1','zero comment never counts as positive reward');
select is(public.point_balance(),21::bigint,'zero policy does not recalculate old awarded amounts');
reset role;
select is((select policy_snapshot->>'post_amount' from private.point_ledger where post_id=pg_temp.id(201)),'17','old policy snapshot remains original');
update private.point_policy set version='fictional-activity-restored',post_amount=30,post_daily_cap=4;
set local role authenticated;
select is(public.point_ui_activity()->'contribution_policy'->'post'->>'remaining','1','new cap uses all recorded creations including configured zero');
select lives_ok($$select pg_temp.create_post(204)$$,'next creation under raised cap can earn current policy amount');
select is(public.point_ui_activity()->'entries'->0->>'amount','30','new creation uses newly explicit policy amount');
select is(public.point_ui_activity()->'contribution_policy'->'post'->>'awarded','2','positive reward counter excludes capped and configured zero entries');
select lives_ok($$select public.community_update_post(pg_temp.id(201),'Edited source','Edited body')$$,'rewarded post remains editable');
select lives_ok($$select public.community_update_comment(pg_temp.id(301),'Edited comment')$$,'rewarded comment remains editable');
select lives_ok($$select public.community_ui_set_like('activity-unit',pg_temp.id(19001),pg_temp.id(101),true)$$,'like remains separate from rewarded action');
select is(public.point_balance(),51::bigint,'edits and likes do not mint rewards');
insert into activity_context values('before-visibility',public.point_ui_activity()->'entries');
select lives_ok($$select public.community_delete('post',pg_temp.id(201))$$,'owner soft-deletes rewarded post');
select lives_ok($$select public.community_delete('comment',pg_temp.id(301))$$,'owner soft-deletes rewarded comment');
select set_config('request.jwt.claim.sub',pg_temp.id(3)::text,true);
select lives_ok($$select public.community_moderate('post',pg_temp.id(202),'hide','Fictional moderation')$$,'administrator hides a capped source');
select set_config('request.jwt.claim.sub',pg_temp.id(1)::text,true);
select is(public.point_ui_activity()->'entries',(select data from activity_context where key='before-visibility'),'delete and moderation retain historical award and exact outcome without implicit clawback');
select is(public.point_balance(),51::bigint,'visibility changes never overwrite balance');
select throws_ok($$select pg_temp.create_comment(304,202)$$,'42501','COMMUNITY_TARGET_UNAVAILABLE','hidden parent rejects new comment before award');
select throws_ok($$select pg_temp.create_post(205,'blockedword')$$,'23514',null,'invalid content rejects before award');
select is(jsonb_array_length(public.point_ui_activity()->'entries'),7,'failed source actions produce no misleading decision');
select lives_ok($$select public.point_check_attendance()$$,'legacy attendance still works independently');
select is(jsonb_array_length(public.point_ui_activity()->'entries'),7,'activity history excludes attendance rows');
reset role;
select is((select count(*) from private.point_activity_outcomes),7::bigint,'non-contribution attendance creates no outcome metadata');
select throws_ok($$insert into private.point_activity_outcomes(entry_id,outcome) select id,'awarded' from private.point_ledger where reason='attendance'$$,'23514','POINT_ACTIVITY_OUTCOME_INVALID','outcome cannot be attached to attendance');
select throws_ok($$insert into private.point_activity_outcomes(entry_id,outcome) values(pg_temp.id(99999),'awarded')$$,'23514','POINT_ACTIVITY_OUTCOME_INVALID','outcome cannot exist without ledger entry');
delete from private.point_policy;
set local role authenticated;
select is(public.point_ui_activity()->'contribution_policy','null'::jsonb,'policy removal disables current rule projection');
select is(jsonb_array_length(public.point_ui_activity()->'entries'),7,'policy removal preserves actor-private history');
select lives_ok($$select pg_temp.create_post(206)$$,'policy removal does not disable valid community source');
select is(jsonb_array_length(public.point_ui_activity()->'entries'),7,'creation after policy removal receives no fictional reward');
select set_config('request.jwt.claim.sub',pg_temp.id(2)::text,true);
select is(public.point_ui_activity()->'entries','[]'::jsonb,'other actor cannot see previous caller receipts');
select set_config('request.jwt.claim.sub',pg_temp.id(3)::text,true);
select is(public.point_ui_activity()->'entries','[]'::jsonb,'administrator activity still means only own history');
select set_config('request.jwt.claim.sub',pg_temp.id(4)::text,true);
select is(public.point_ui_activity()->'entries','[]'::jsonb,'artist activity still means only own history');
select set_config('request.jwt.claim.sub',pg_temp.id(5)::text,true);
select throws_ok($$select public.point_ui_activity()$$,'42501','COMMUNITY_FORBIDDEN','current restriction denies private activity read');
select set_config('request.jwt.claim.sub',pg_temp.id(7)::text,true);
select throws_ok($$select public.point_ui_activity()$$,'42501','COMMUNITY_FORBIDDEN','incomplete fan onboarding denies read');
select set_config('request.jwt.claim.sub',pg_temp.id(6)::text,true);
select lives_ok($$select public.point_ui_activity()$$,'expired restriction permits private read');
reset role;

-- Deliberately seed predecessor-shaped ledger rows, never rewrite existing rows.
-- Unknown legacy zero reasons are not inferred from current policy or amount.
insert into private.point_ledger(id,user_id,amount,reason,ref_id,earned_on,policy_version,policy_snapshot,actor_id,post_id,created_at)
values(pg_temp.id(501),pg_temp.id(2),0,'post',pg_temp.id(105)::text,'2020-01-01','fictional-legacy','{}',pg_temp.id(2),pg_temp.id(105),'2020-01-01 00:00:00+00'),
 (pg_temp.id(502),pg_temp.id(2),9,'post',pg_temp.id(106)::text,'2020-01-01','fictional-legacy','{}',pg_temp.id(2),pg_temp.id(106),'2020-01-01 00:00:00+00');
select throws_ok($$insert into private.point_activity_outcomes(entry_id,outcome) values(pg_temp.id(501),'awarded')$$,'23514','POINT_ACTIVITY_OUTCOME_INVALID','positive award classification cannot describe a zero row');
select throws_ok($$insert into private.point_activity_outcomes(entry_id,outcome) values(pg_temp.id(502),'daily_cap')$$,'23514','POINT_ACTIVITY_OUTCOME_INVALID','zero award classification cannot describe positive row');
set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.id(2)::text,true);
select is(public.point_ui_activity()->'entries'->0->>'outcome','legacy','positive legacy row has no fabricated precise metadata');
select is(public.point_ui_activity()->'entries'->1->>'outcome','legacy','zero legacy cause remains explicitly unknown');
select is(public.point_ui_activity()->'entries'->0->>'id',pg_temp.id(502)::text,'tied timestamps order by immutable ID descending');
insert into activity_context values('legacy-page',public.point_ui_activity(1));
select is(jsonb_array_length((select data->'entries' from activity_context where key='legacy-page')),1,'bounded first page contains one entry');
select is((select data->'next_cursor'->>'id' from activity_context where key='legacy-page'),pg_temp.id(502)::text,'cursor comes from last shown row');
select is(public.point_ui_activity(1,'2020-01-01 00:00:00+00',pg_temp.id(502))->'entries'->0->>'id',pg_temp.id(501)::text,'compound exclusive cursor preserves tied legacy row');
select is(public.point_ui_activity(1,'2020-01-01 00:00:00+00',pg_temp.id(502))->'next_cursor','null'::jsonb,'last page has no speculative next cursor');
select is(public.point_ui_activity(1,'2020-01-01 00:00:00+00',pg_temp.id(501))->'entries','[]'::jsonb,'exhausted page empty');
select set_config('request.jwt.claim.sub',pg_temp.id(4)::text,true);
select is(public.point_ui_activity(100,'2020-01-01 00:00:00+00',pg_temp.id(502))->'entries','[]'::jsonb,'foreign cursor cannot leak owner history');
select set_config('request.jwt.claim.sub',pg_temp.id(1)::text,true);
select throws_ok($$select * from private.point_activity_outcomes$$,'42501',null,'owner cannot bypass safe projection');
select throws_ok($$insert into private.point_activity_outcomes values(pg_temp.id(501),'zero_amount')$$,'42501',null,'client cannot manufacture historical outcome');
reset role;

-- Balance overflow rolls back source, ledger, outcome and operation together.
insert into private.point_policy(version,attendance_amount,post_amount,comment_amount,post_daily_cap,comment_daily_cap,deleted_content_treatment)
values('fictional-overflow',0,1,1,null,null,'retain');
insert into private.point_ledger(user_id,amount,reason,ref_id,earned_on,policy_version,policy_snapshot,actor_id)
values(pg_temp.id(8),9007199254740991,'attendance','2020-01-01','2020-01-01','fictional-overflow','{}',pg_temp.id(8));
set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.id(8)::text,true);
select throws_ok($$select pg_temp.create_post(208)$$,'22003','POINT_BALANCE_OUT_OF_RANGE','overflow rejects post and point mutation atomically');
select throws_ok($$select pg_temp.create_comment(308)$$,'22003','POINT_BALANCE_OUT_OF_RANGE','overflow rejects comment and point mutation atomically');
select is(public.point_ui_activity()->'entries','[]'::jsonb,'overflow leaves no misleading activity receipt');
reset role;
select is((select count(*) from public.posts where id=pg_temp.id(208)),0::bigint,'overflow post did not persist');
select is((select count(*) from public.comments where id=pg_temp.id(308)),0::bigint,'overflow comment did not persist');
select is((select count(*) from private.board_operations where actor_id=pg_temp.id(8)),0::bigint,'overflow records no successful operation');
select is((select count(*) from private.point_activity_outcomes),7::bigint,'overflow leaves all existing outcomes unchanged');
-- A failure in the new side-table insert must roll back every earlier effect,
-- not leave content/ledger/counters committed while only its explanation fails.
alter table private.point_activity_outcomes add constraint fictional_outcome_failure check(outcome<>'awarded') not valid;
insert into activity_context values('parent-counter',to_jsonb((select comment_count from public.posts where id=pg_temp.id(101))));
set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.id(1)::text,true);
select throws_ok($$select pg_temp.create_post(209)$$,'23514',null,'outcome persistence failure rolls back complete post transaction');
select throws_ok($$select pg_temp.create_comment(309)$$,'23514',null,'outcome persistence failure rolls back complete comment transaction');
reset role;
select is((select count(*) from public.posts where id=pg_temp.id(209)),0::bigint,'failed outcome leaves no source post');
select is((select count(*) from public.comments where id=pg_temp.id(309)),0::bigint,'failed outcome leaves no source comment');
select is((select count(*) from private.point_ledger where post_id=pg_temp.id(209) or comment_id=pg_temp.id(309)),0::bigint,'failed outcome leaves no phantom ledger credit');
select is((select count(*) from private.board_operations where operation_id in(pg_temp.id(10209),pg_temp.id(10309))),0::bigint,'failed outcome leaves no success operation receipt');
select is(to_jsonb((select comment_count from public.posts where id=pg_temp.id(101))),(select data from activity_context where key='parent-counter'),'failed comment outcome retains parent counter exactly');
select is((select count(*) from private.point_activity_outcomes),7::bigint,'failed outcome leaves predecessor decisions unchanged');
alter table private.point_activity_outcomes drop constraint fictional_outcome_failure;
select * from finish();
rollback;
