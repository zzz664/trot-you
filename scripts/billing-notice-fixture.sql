-- Fictional disposable-test bootstrap only. Not an operational seed.
insert into auth.users(id,email,raw_user_meta_data) values('c1000000-0000-4000-8000-000000000001','notice-only@example.invalid','{}');
insert into private.onboarding_documents(version,kind,title,body,approved_at,published_at) values
 ('c9000000-0000-4000-8000-000000000001','terms','Fictional terms','Rollback-only terms.',now(),now()),
 ('c9000000-0000-4000-8000-000000000002','privacy','Fictional privacy','Rollback-only privacy.',now(),now());
insert into private.profile_onboarding_policy values(true,'c8000000-0000-4000-8000-000000000001',now(),2,10,
 array['금지단어'],'c9000000-0000-4000-8000-000000000001','c9000000-0000-4000-8000-000000000002',null);
update public.profiles set font_selected_at=now(),call_name='허구안내팬',age_self_attested_at=now(),profile_completed_at=now(),onboarding_completed_at=now()
 where id='c1000000-0000-4000-8000-000000000001';
insert into private.profile_policy_acceptances(user_id,kind,version,accepted_at)
 select 'c1000000-0000-4000-8000-000000000001',kind,version,now() from private.onboarding_documents;
insert into private.checkout_policies values
 ('c7000000-0000-4000-8000-000000000001','허구 갱신 정책','운영에 사용할 수 없는 테스트 전용 명시 승인 정책입니다.',7200,1200,now(),now(),'seoul_monthly_clamped','taxable_krw'),
 ('c7000000-0000-4000-8000-000000000002','허구 통지 정책','운영에 사용할 수 없는 테스트 전용 통지 필수 정책입니다.',7200,1200,now(),now(),'seoul_monthly_clamped','taxable_krw');
insert into private.checkout_policy_current values(true,'c7000000-0000-4000-8000-000000000001');
create temp table notice_cases(label text primary key,sid uuid,descriptor jsonb,approved_at timestamptz,evidence uuid);
grant all on notice_cases to service_role,authenticated;
create function pg_temp.fan() returns uuid language sql as $$select 'c1000000-0000-4000-8000-000000000001'::uuid$$;
create function pg_temp.policy() returns uuid language sql as $$select 'c7000000-0000-4000-8000-000000000001'::uuid$$;
create function pg_temp.sid(label text) returns uuid language sql as $$select sid from notice_cases c where c.label=$1$$;
create function pg_temp.aid(label text) returns uuid language sql as $$select (descriptor->>'attempt_id')::uuid from notice_cases c where c.label=$1$$;
create function pg_temp.lease(label text) returns uuid language sql as $$select (descriptor->>'lease_token')::uuid from notice_cases c where c.label=$1$$;
create function pg_temp.make_case(label text,provider public.payment_provider default 'toss',policy uuid default pg_temp.policy()) returns uuid
language plpgsql as $$declare artist uuid:=gen_random_uuid(); sid uuid:=gen_random_uuid(); mid uuid:=gen_random_uuid(); cid uuid:=gen_random_uuid();
 session uuid:=gen_random_uuid(); event uuid:=gen_random_uuid(); anchor timestamptz:=date_trunc('hour',clock_timestamp())-interval '25 days'; due timestamptz;
begin
 due:=private.enrollment_period_end(anchor,'seoul_monthly_clamped');
 insert into public.artists(id,slug,name,grade,status) values(artist,'notice-'||artist,'허구 갱신 가수','B','active');
 insert into public.subscriptions(id,user_id,artist_id,provider,status,intro_redeemed_at,first_started_at,episode_started_at,current_period_start,current_period_end,next_billing_at)
 values(sid,pg_temp.fan(),artist,provider,'active',anchor,anchor,anchor,anchor,due,due);
 insert into private.payment_mandates(id,subscription_id,provider,environment,merchant_account,provider_customer_ref,secure_credential_ref,consent_version)
 values(mid,sid,provider,'test','fixture-merchant',gen_random_uuid(),cid,policy::text);
 insert into public.payment_events(id,subscription_id,kind,amount_krw,currency,provider,period_start,period_end,occurred_at)
 values(event,sid,'charge',1200,'KRW',provider,anchor,due,anchor);
 insert into private.checkout_sessions(id,user_id,artist_id,provider,environment,idempotency_key,nonce_hash,policy_version,initial_price_krw,
 regular_price_krw,intro_eligible,created_at,expires_at)
 values(session,pg_temp.fan(),artist,provider,'test',gen_random_uuid(),repeat('a',64),policy,1200,7200,true,anchor,anchor+interval '30 minutes');
 insert into private.subscription_enrollments(session_id,user_id,artist_id,subscription_id,mandate_id,credential_ref,auth_session_hash,callback_state_hash,state,stage,payment_event_id)
 values(session,pg_temp.fan(),artist,sid,mid,cid,repeat('b',64),repeat('c',64),'succeeded',case provider when 'toss' then 'charge' else 'approve' end,event);
 insert into private.enrollment_credentials(id,mandate_id,ciphertext)
 values(cid,mid,'{"version":"fixture-v1","iv":"AAAAAAAAAAAAAAAA","tag":"AAAAAAAAAAAAAAAAAAAAAA","ciphertext":"AA"}');
 insert into notice_cases(label,sid,evidence) values(label,sid,gen_random_uuid()); return sid;
end$$;

insert into private.renewal_policies values
 (pg_temp.policy(),259200,86400,3,true,86400,now(),now()),
 ('c7000000-0000-4000-8000-000000000002',259200,86400,3,true,86400,now(),now());
insert into private.billing_notice_policies values
 (pg_temp.policy(),7,0,true,now(),now()),
 ('c7000000-0000-4000-8000-000000000002',7,0,false,now(),now());
create function pg_temp.nid(label text) returns uuid language sql as $$
 select id from private.billing_notices where subscription_id=pg_temp.sid(label)$$;
