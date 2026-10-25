// Disposable SQL fixture only, called behind the strict local-CI guard. No
// policy is approved and no billing worker/provider/credential flow runs.
export function subscriptionSourceSql(artistId: string, emptyId: string) {
  return `
  create temporary table fixture_context(anchor timestamptz);
  insert into fixture_context values(date_trunc('day',clock_timestamp() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul');
  insert into public.artists(id,slug,name,grade,status,display_order) values
    ('${artistId}','ci-subscriptions-${artistId}','허구 구독 집계 가수','B','active',0),
    ('${emptyId}','ci-subscriptions-${emptyId}','허구 구독 없는 가수','B','paused',0);
  insert into public.artists(slug,name,grade,status,display_order)
    select 'ci-subscriptions-page-'||gen_random_uuid(),'허구 페이지 가수 '||n,'B','draft',100+n from generate_series(1,21)n;

  create function pg_temp.fixture_charge(sid uuid,mid uuid,starts timestamptz,ends timestamptz,initial boolean,paid boolean,attempt_state text default 'success')
  returns void language plpgsql as $$
  declare obligation uuid:=gen_random_uuid(); attempt uuid:=gen_random_uuid(); event uuid:=gen_random_uuid();
  begin
    insert into private.billing_obligations(id,subscription_id,mandate_id,period_start,period_end,amount_krw,is_initial,is_intro,price_version,grace_seconds,retry_seconds,max_retries,state,next_attempt_at)
      values(obligation,sid,mid,starts,ends,1000,initial,false,'fictional-private-payment-version',259200,86400,3,case when paid then 'settled' else 'open' end,starts);
    insert into private.payment_attempts(id,obligation_id,ordinal,state,outcome_evidence_ref,created_at,finished_at)
      values(attempt,obligation,1,attempt_state::private.payment_attempt_state,case when attempt_state='failed' then gen_random_uuid() else null end,starts,case when paid or attempt_state='failed' then starts else null end);
    if paid then
      insert into public.payment_events(id,subscription_id,kind,amount_krw,provider,period_start,period_end,occurred_at,recorded_at)
        values(event,sid,'charge',1000,'toss',starts,ends,starts,starts);
      insert into private.payment_event_verifications(event_id,attempt_id,provider,environment,merchant_account,provider_action_id,evidence_ref)
        values(event,attempt,'toss','test','fictional-private-payment-merchant','fictional-private-payment-action-'||attempt,gen_random_uuid());
    end if;
  end;$$;

  do $$declare i integer; fan uuid; sid uuid; mid uuid; anchor timestamptz; starts timestamptz; ends timestamptz;
  begin
    select c.anchor into anchor from fixture_context c;
    for i in 1..8 loop
      fan:=gen_random_uuid();sid:=gen_random_uuid();mid:=gen_random_uuid();
      insert into auth.users(id,email,raw_user_meta_data) values(fan,'admin-subscriptions-data-'||fan||'@example.invalid','{}');
      update public.profiles set call_name='fictional-private-fan',onboarding_completed_at=anchor where id=fan;
      starts:=anchor-case when i in(1,6) then interval '5 days' when i in(5,8) then interval '70 days' else interval '32 days' end;
      ends:=starts+interval '30 days';
      insert into public.subscriptions(id,user_id,artist_id,provider,status,first_started_at,episode_started_at,current_period_start,current_period_end,next_billing_at)
        values(sid,fan,'${artistId}','toss',case when i=4 then 'pending'::public.subscription_status else 'active'::public.subscription_status end,
          case when i=4 then null else starts end,case when i=4 then null else starts end,
          case when i=4 then null else starts end,case when i=4 then null else ends end,
          case when i=4 then null else ends end);
      insert into private.payment_mandates(id,subscription_id,provider,environment,merchant_account,provider_customer_ref,secure_credential_ref,consent_version)
        values(mid,sid,'toss','test','fictional-private-payment-merchant',gen_random_uuid(),gen_random_uuid(),'fictional-private-payment-consent');
      if i=4 then
        perform pg_temp.fixture_charge(sid,mid,anchor-interval '1 day',anchor+interval '29 days',true,false,'unknown');
      else
        perform pg_temp.fixture_charge(sid,mid,starts,ends,true,true);
      end if;
      if i=2 then
        perform pg_temp.fixture_charge(sid,mid,ends,ends+interval '30 days',false,true);
        update public.subscriptions set current_period_start=ends,current_period_end=ends+interval '30 days',next_billing_at=ends+interval '30 days' where id=sid;
      elsif i=3 then
        perform pg_temp.fixture_charge(sid,mid,ends,ends+interval '30 days',false,false,'failed');
        update public.subscriptions set status='grace',grace_started_at=ends,grace_ends_at=anchor+interval '2 days' where id=sid;
      elsif i=5 then
        update public.subscriptions set status='expired',next_billing_at=null where id=sid;
      elsif i in(6,8) then
        update public.subscriptions set status='canceled',next_billing_at=null,canceled_at=case when i=6 then anchor-interval '1 day' else anchor-interval '50 days' end where id=sid;
      elsif i=7 then
        perform pg_temp.fixture_charge(sid,mid,ends,ends+interval '30 days',false,false,'unknown');
      end if;
    end loop;
  end;$$;
  select jsonb_build_object('from',((anchor at time zone 'Asia/Seoul')::date-6)::text,'to',(anchor at time zone 'Asia/Seoul')::date::text) from fixture_context;
  `;
}
