begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
set local timezone='UTC';
select no_plan();

select ok((select prosecdef and 'search_path=""'=any(proconfig) from pg_proc where oid='public.admin_analytics_dashboard(date,date)'::regprocedure),'dashboard pins security-definer empty search path');
select ok(has_function_privilege('authenticated','public.admin_analytics_dashboard(date,date)','EXECUTE'),'authenticated caller can enter current-admin boundary');
select ok((select bool_and(not has_function_privilege(r,'public.admin_analytics_dashboard(date,date)','EXECUTE')) from unnest(array['anon','service_role'])r),'anonymous and service credentials cannot impersonate dashboard admin');
select ok((select bool_and(not has_function_privilege(r,oid,'EXECUTE')) from pg_proc cross join unnest(array['anon','authenticated','service_role'])r where pronamespace='private'::regnamespace and proname like 'analytics_dashboard_%'),'private dashboard helpers are not executable by app roles');
select ok((select relrowsecurity from pg_class where oid='private.analytics_dashboard_coverage'::regclass),'coverage enables row security');
select ok((select bool_and(not has_table_privilege(r,'private.analytics_dashboard_coverage','SELECT,INSERT,UPDATE,DELETE,TRUNCATE')) from unnest(array['anon','authenticated','service_role'])r),'no application role reads or changes coverage storage');
select is((select count(*) from private.analytics_dashboard_coverage),1::bigint,'installation records exactly one coverage marker');
select ok((select isfinite(instrumentation_from) and instrumentation_from<=clock_timestamp() from private.analytics_dashboard_coverage),'coverage marker is finite migration time');
select throws_ok($$update private.analytics_dashboard_coverage set instrumentation_from=now()$$,'55000','ANALYTICS_DASHBOARD_COVERAGE_IMMUTABLE','coverage cannot be rewritten as a later complete-history promise');
select throws_ok($$delete from private.analytics_dashboard_coverage$$,'55000','ANALYTICS_DASHBOARD_COVERAGE_IMMUTABLE','coverage cannot be deleted');
select throws_ok($$truncate private.analytics_dashboard_coverage$$,'55000','ANALYTICS_DASHBOARD_COVERAGE_IMMUTABLE','coverage cannot be truncated');
select is((select count(*) from private.analytics_policy),0::bigint,'migration activates no analytics policy');
select is((select count(*) from private.analytics_consents),0::bigint,'migration grants no real user consent');
select is((select count(*) from private.analytics_events),0::bigint,'migration backfills no events');

-- Synthetic rollback-only source-free aggregate fixtures. They test projection,
-- never claim to be ingestion proof (legacy lifecycle tests exercise real RPCs).
create function pg_temp.id(n integer) returns uuid language sql immutable as $$select ('d3900000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
create function pg_temp.day() returns date language sql stable as $$select (now() at time zone 'Asia/Seoul')::date-1$$;
create function pg_temp.dashboard() returns jsonb language sql as $$select public.admin_analytics_dashboard(pg_temp.day(),pg_temp.day())$$;
create function pg_temp.total(j jsonb) returns bigint language sql immutable as $$select sum((e->>'event_count')::bigint)::bigint from jsonb_array_elements(j->'events')e$$;
create temporary table funnel_context(key text primary key,data jsonb);
grant all on funnel_context to authenticated,service_role;
insert into auth.users(id,email,raw_user_meta_data) select pg_temp.id(n),'funnel-unit-'||n||'@example.invalid','{}'::jsonb from generate_series(1,9)n;
update public.profiles set call_name='Private fictional analytics name',onboarding_completed_at=clock_timestamp() where id::text like 'd3900000-%';
update public.profiles set role='admin' where id=pg_temp.id(3);
update public.profiles set role='artist' where id=pg_temp.id(4);
update public.profiles set is_restricted=true where id=pg_temp.id(5);
update public.profiles set is_restricted=true,restricted_until=clock_timestamp()-interval '1 second' where id=pg_temp.id(6);
update public.profiles set onboarding_completed_at=null where id=pg_temp.id(7);

set local role anon;
select throws_ok($$select pg_temp.dashboard()$$,'42501',null,'anonymous dashboard blocked');
reset role;
set local role service_role;
select throws_ok($$select pg_temp.dashboard()$$,'42501',null,'service role dashboard blocked');
reset role;
set local role authenticated;
select throws_ok($$select pg_temp.dashboard()$$,'42501','ANALYTICS_DASHBOARD_FORBIDDEN','authenticated role without subject blocked');
select set_config('request.jwt.claim.sub',pg_temp.id(1)::text,true);
select throws_ok($$select pg_temp.dashboard()$$,'42501','ANALYTICS_DASHBOARD_FORBIDDEN','fan dashboard blocked');
select set_config('request.jwt.claim.sub',pg_temp.id(4)::text,true);
select throws_ok($$select pg_temp.dashboard()$$,'42501','ANALYTICS_DASHBOARD_FORBIDDEN','artist dashboard blocked');
select set_config('request.jwt.claim.sub',pg_temp.id(3)::text,true);
insert into funnel_context values('missing',pg_temp.dashboard());
select is((select data->>'actor_id' from funnel_context where key='missing'),pg_temp.id(3)::text,'only requester identity is returned');
select is((select data->'collection' from funnel_context where key='missing'),'{"status":"unconfigured","retention_days":null}'::jsonb,'missing policy is unavailable not false zero');
select is(jsonb_array_length((select data->'events' from funnel_context where key='missing')),13,'unconfigured response still names exactly13 documented events');
select ok((select bool_and(e->'event_count'='null'::jsonb) from funnel_context,jsonb_array_elements(data->'events')e where key='missing'),'unconfigured event counts are null');
select is((select data->'daily' from funnel_context where key='missing'),'[]'::jsonb,'unconfigured daily series is absent');
select is((select data->'business_metrics' from funnel_context where key='missing'),'{"configured":false,"reason":"definitions_unapproved","expected_count":4}'::jsonb,'four business metrics remain explicitly unavailable');
select is((select data->'coverage'->>'history_complete' from funnel_context where key='missing'),'false','coverage never claims historical completeness');
select is((select data->'coverage'->>'mode' from funnel_context where key='missing'),'current_consent_observations','count semantics explicit in DTO');
select is((select string_agg(k,',' order by k) from jsonb_object_keys(pg_temp.dashboard())k),'actor_id,as_of,business_metrics,collection,coverage,daily,events,from,time_zone,to,window_end,window_start','top-level fields exclude raw identity or property dimensions');
select is((select string_agg(k,',' order by k) from jsonb_object_keys(pg_temp.dashboard()->'events'->0)k),'event_count,name','event row has only safe name and count');
select throws_ok($$select public.admin_analytics_dashboard(null,pg_temp.day())$$,'22023','ANALYTICS_DASHBOARD_INVALID_INPUT','null from rejected');
select throws_ok($$select public.admin_analytics_dashboard(pg_temp.day(),null)$$,'22023','ANALYTICS_DASHBOARD_INVALID_INPUT','null to rejected');
select throws_ok($$select public.admin_analytics_dashboard('-infinity',pg_temp.day())$$,'22023','ANALYTICS_DASHBOARD_INVALID_INPUT','nonfinite from rejected');
select throws_ok($$select public.admin_analytics_dashboard(pg_temp.day(),'infinity')$$,'22023','ANALYTICS_DASHBOARD_INVALID_INPUT','nonfinite to rejected');
select throws_ok($$select public.admin_analytics_dashboard('1999-12-31','2000-01-01')$$,'22023','ANALYTICS_DASHBOARD_INVALID_INPUT','unsupported historic floor rejected');
select throws_ok($$select public.admin_analytics_dashboard(pg_temp.day(),pg_temp.day()-1)$$,'22023','ANALYTICS_DASHBOARD_INVALID_INPUT','reversed window rejected');
select throws_ok($$select public.admin_analytics_dashboard(pg_temp.day(),pg_temp.day()+2)$$,'22023','ANALYTICS_DASHBOARD_INVALID_INPUT','future KST day rejected');
select throws_ok($$select public.admin_analytics_dashboard(pg_temp.day()-366,pg_temp.day())$$,'22023','ANALYTICS_DASHBOARD_INVALID_INPUT','367 inclusive days rejected');
select lives_ok($$select public.admin_analytics_dashboard(pg_temp.day()-365,pg_temp.day())$$,'366 inclusive days accepted');
reset role;
insert into private.analytics_policy(consent_version,enabled,retention_days) values(pg_temp.id(301),true,30);
set local role authenticated;
select is(pg_temp.dashboard()->'collection'->>'status','unconfigured','bare policy row is not an approved readable consent document');
reset role;
insert into private.onboarding_documents(version,kind,title,body) values(pg_temp.id(301),'analytics','Fictional draft','Private draft not approved');
set local role authenticated;
select is(pg_temp.dashboard()->'collection'->>'status','unconfigured','draft policy document remains unavailable');
reset role;
update private.onboarding_documents set approved_at=now(),published_at=now()+interval '1 day' where version=pg_temp.id(301);
set local role authenticated;
select is(pg_temp.dashboard()->'collection'->>'status','unconfigured','approved but future publication remains unavailable');
reset role;
insert into private.onboarding_documents(version,kind,title,body,approved_at,published_at) values
(pg_temp.id(302),'analytics','Fictional published','Fictional testing only',now(),now()),
(pg_temp.id(303),'analytics','Fictional next version','Fictional testing only',now(),now());
update private.analytics_policy set consent_version=pg_temp.id(302);
set local role authenticated;
insert into funnel_context values('empty',pg_temp.dashboard());
select is((select data->'collection' from funnel_context where key='empty'),'{"status":"enabled","retention_days":30}'::jsonb,'approved enabled policy has explicit active horizon');
select is(pg_temp.total((select data from funnel_context where key='empty')),0::bigint,'enabled no-observation dataset is genuine zero');
select is((select data->'daily' from funnel_context where key='empty'),'[]'::jsonb,'empty enabled dataset has no fabricated daily rows');
reset role;
insert into private.analytics_consents(user_id,consent_version,granted,granted_at,updated_at)
 select pg_temp.id(n),pg_temp.id(302),true,clock_timestamp()-interval '40 days',clock_timestamp() from generate_series(1,9)n where n<>8;
insert into private.analytics_events(user_id,event_key,name,origin,source_id,font_scale,voice_context,consent_version,occurred_at,recorded_at)
 select pg_temp.id(1),pg_temp.id(1000+n.position::integer),n.name,
 case when n.name in('message_open','voice_input_used') then 'client' when n.name in('subscribe_complete','renew') then 'verified_charge' else 'server' end,
 case when n.name not in('signup_complete','font_size_selected','voice_input_used') then pg_temp.id(2000+n.position::integer) end,
 case when n.name='font_size_selected' then 'large'::public.font_scale end,
 case when n.name='voice_input_used' then 'reply'::public.analytics_voice_context end,pg_temp.id(302),
 (pg_temp.day()::timestamp+interval '12 hours') at time zone 'Asia/Seoul',
 (pg_temp.day()::timestamp+interval '12 hours') at time zone 'Asia/Seoul'
 from unnest(enum_range(null::public.analytics_event_name)) with ordinality n(name,position);
set local role authenticated;
insert into funnel_context values('all13',pg_temp.dashboard());
select is(pg_temp.total((select data from funnel_context where key='all13')),13::bigint,'all13 accepted event families project exact totals');
select is(jsonb_array_length((select data->'daily' from funnel_context where key='all13')),13,'all13 positive event buckets are shown');
select ok((select bool_and((e->>'event_count')::int=1) from funnel_context,jsonb_array_elements(data->'events')e where key='all13'),'each synthetic event family counts once');
select is((select count(distinct e->>'name') from funnel_context,jsonb_array_elements(data->'events')e where key='all13'),13::bigint,'event totals contain no duplicate names');
select is((select string_agg(k,',' order by k) from jsonb_object_keys(pg_temp.dashboard()->'daily'->0)k),'day_kst,event_count,name','daily rows have no person/source dimensions');
select ok(not (pg_temp.dashboard()::text like '%Private fictional%' or pg_temp.dashboard()::text like '%@example.invalid%' or pg_temp.dashboard()::text like '%'||pg_temp.id(1)::text||'%' or pg_temp.dashboard()::text like '%'||pg_temp.id(2001)::text||'%'),'projection leaks neither fan ID/source ID nor private text');
select is((pg_temp.dashboard()->>'window_start')::timestamptz,pg_temp.day()::timestamp at time zone 'Asia/Seoul','window starts at exact KST midnight');
select is((pg_temp.dashboard()->>'window_end')::timestamptz,(pg_temp.day()+1)::timestamp at time zone 'Asia/Seoul','inclusive to becomes next KST midnight');
select is(pg_temp.dashboard()->>'time_zone','Asia/Seoul','timezone explicit');
set local timezone='America/Los_Angeles';
select is(pg_temp.dashboard()->'events',(select data->'events' from funnel_context where key='all13'),'session timezone cannot shift event buckets');
select is(pg_temp.dashboard()->'daily',(select data->'daily' from funnel_context where key='all13'),'session timezone cannot shift KST day keys');
reset role;
set local timezone='UTC';
-- Boundaries plus ineligible actor/consent cases remain stored but excluded.
insert into private.analytics_events(user_id,event_key,name,origin,voice_context,consent_version,occurred_at,recorded_at)
 select pg_temp.id(1),pg_temp.id(3000+n),'voice_input_used','client','reply',pg_temp.id(302),stamp,stamp
 from (values(1,pg_temp.day()::timestamp at time zone 'Asia/Seoul'),
 (2,(pg_temp.day()+1)::timestamp at time zone 'Asia/Seoul'),
 (3,(pg_temp.day()::timestamp at time zone 'Asia/Seoul')-interval '1 microsecond'),
 (4,(pg_temp.day()::timestamp at time zone 'Asia/Seoul')+interval '1 microsecond'),
 (5,clock_timestamp()-interval '31 days'))v(n,stamp);
insert into private.analytics_events(user_id,event_key,name,origin,voice_context,consent_version,occurred_at,recorded_at)
 select pg_temp.id(n),pg_temp.id(4000+n),'voice_input_used','client','reply',pg_temp.id(302),
 (pg_temp.day()::timestamp+interval '12 hours') at time zone 'Asia/Seoul',
 (pg_temp.day()::timestamp+interval '12 hours') at time zone 'Asia/Seoul'
 from generate_series(2,9)n;
update private.analytics_consents set granted=false where user_id=pg_temp.id(2);
update private.analytics_consents set consent_version=pg_temp.id(303) where user_id=pg_temp.id(9);
set local role authenticated;
select is(pg_temp.total(pg_temp.dashboard()),16::bigint,'start/after-start plus expired restriction count, exact next midnight and all ineligible rows excluded');
select is(pg_temp.total(public.admin_analytics_dashboard(pg_temp.day()-32,pg_temp.day())),17::bigint,'earlier boundary enters wider window but expired recorded horizon remains excluded');
reset role;
update private.analytics_consents set granted=false where user_id=pg_temp.id(1);
set local role authenticated;
select is(pg_temp.total(pg_temp.dashboard()),1::bigint,'withdrawal excludes all retained user observations immediately');
reset role;
select is((select count(*) from private.analytics_events where user_id=pg_temp.id(1)),18::bigint,'withdrawal does not falsely claim historical erasure');
update private.analytics_consents set granted=true,granted_at=clock_timestamp(),updated_at=clock_timestamp() where user_id=pg_temp.id(1);
set local role authenticated;
select is(pg_temp.total(pg_temp.dashboard()),1::bigint,'new grant does not resurrect the old consent epoch');
reset role;
update private.analytics_policy set enabled=false;
set local role authenticated;
select is(pg_temp.dashboard()->'collection'->>'status','disabled','approved operator disablement distinct from unconfigured');
select ok((select bool_and(e->'event_count'='null'::jsonb) from jsonb_array_elements(pg_temp.dashboard()->'events')e),'disabled counts unavailable rather than fake zero');
select is(pg_temp.dashboard()->'daily','[]'::jsonb,'disabled series absent');
reset role;
update private.analytics_policy set enabled=true,consent_version=pg_temp.id(303);
set local role authenticated;
select is(pg_temp.total(pg_temp.dashboard()),0::bigint,'policy rotation never counts old-version event even where consent current');
reset role;
update public.profiles set is_restricted=true where id=pg_temp.id(3);
set local role authenticated;
select throws_ok($$select pg_temp.dashboard()$$,'42501','ANALYTICS_DASHBOARD_FORBIDDEN','admin restriction immediately revokes dashboard');
reset role;
update public.profiles set restricted_until=clock_timestamp()-interval '1 second' where id=pg_temp.id(3);
set local role authenticated;
select lives_ok($$select pg_temp.dashboard()$$,'expired admin restriction no longer blocks dashboard');
reset role;
update public.profiles set role='fan' where id=pg_temp.id(3);
set local role authenticated;
select throws_ok($$select pg_temp.dashboard()$$,'42501','ANALYTICS_DASHBOARD_FORBIDDEN','admin demotion immediately revokes dashboard');
reset role;
select * from finish();
rollback;
