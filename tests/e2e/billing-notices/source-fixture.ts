import assert from 'node:assert/strict';

export const BILLING_NOTICE_CI = {
  mandatoryPolicy: 'c7300000-0000-4000-8000-000000000001',
  optionalPolicy: 'c7300000-0000-4000-8000-000000000002',
} as const;
export function fixtureUuid(value: unknown): asserts value is string {
  assert.ok(typeof value === 'string');
  assert.match(
    value,
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );
}
export function billingNoticePolicySql(mandatory: boolean) {
  assert.equal(typeof mandatory, 'boolean');
  const version = mandatory
    ? BILLING_NOTICE_CI.mandatoryPolicy
    : BILLING_NOTICE_CI.optionalPolicy;
  return `insert into private.checkout_policies(version,title,body,regular_price_krw,intro_price_krw,approved_at,published_at,billing_period_calendar,payment_tax_basis)
    values('${version}','허구 결제 예정 안내 정책','격리 CI의 허구 자료이며 실제 약관이나 승인된 운영 정책이 아닙니다.',7200,1200,clock_timestamp(),clock_timestamp(),'seoul_monthly_clamped','taxable_krw') on conflict(version) do nothing;
    insert into private.renewal_policies(checkout_policy_version,grace_seconds,retry_seconds,max_retries,notice_required,notice_lead_seconds,approved_at,published_at)
    values('${version}',259200,86400,3,true,86400,clock_timestamp(),clock_timestamp()) on conflict(checkout_policy_version) do nothing;
    insert into private.billing_notice_policies(checkout_policy_version,days_before,hour_kst,mandatory_inapp,approved_at,published_at)
    values('${version}',7,0,${mandatory},clock_timestamp(),clock_timestamp()) on conflict(checkout_policy_version) do nothing;
    insert into private.checkout_policy_current(singleton,policy_version) values(true,'${version}')
    on conflict(singleton) do update set policy_version=excluded.policy_version;`;
}
export function billingNoticeSourceSql(
  user: string,
  artist: string,
  subscription: string,
  mandatory: boolean,
) {
  [user, artist, subscription].forEach(fixtureUuid);
  assert.equal(typeof mandatory, 'boolean');
  const version = mandatory
    ? BILLING_NOTICE_CI.mandatoryPolicy
    : BILLING_NOTICE_CI.optionalPolicy;
  // Historical source fixtures, not evidence of provider enrollment or payment.
  // A 25-day-old monthly anniversary is 3..6 days ahead in every month, inside
  // the explicit fictional seven-KST-calendar-day notice window.
  return `do $$ declare mid uuid:=gen_random_uuid(); cid uuid:=gen_random_uuid(); session uuid:=gen_random_uuid(); event uuid:=gen_random_uuid();
    anchor timestamptz:=date_trunc('hour',clock_timestamp())-interval '25 days'; due timestamptz;
    begin
    if not exists(select 1 from auth.users where id='${user}' and email ~ '^billing-notices-e2e-[0-9a-f-]{36}@example[.]invalid$')
      then raise exception 'FIXTURE_IDENTITY_REQUIRED'; end if;
    due:=private.enrollment_period_end(anchor,'seoul_monthly_clamped');
    insert into public.subscriptions(id,user_id,artist_id,provider,status,intro_redeemed_at,first_started_at,episode_started_at,current_period_start,current_period_end,next_billing_at)
      values('${subscription}','${user}','${artist}','toss','active',anchor,anchor,anchor,anchor,due,due);
    insert into private.payment_mandates(id,subscription_id,provider,environment,merchant_account,provider_customer_ref,secure_credential_ref,consent_version)
      values(mid,'${subscription}','toss','test','fictional-notice-ci-merchant',gen_random_uuid(),cid,'${version}');
    insert into public.payment_events(id,subscription_id,kind,amount_krw,currency,provider,period_start,period_end,occurred_at)
      values(event,'${subscription}','charge',1200,'KRW','toss',anchor,due,anchor);
    insert into private.checkout_sessions(id,user_id,artist_id,provider,environment,idempotency_key,nonce_hash,policy_version,initial_price_krw,
      regular_price_krw,intro_eligible,created_at,expires_at)
      values(session,'${user}','${artist}','toss','test',gen_random_uuid(),repeat('a',64),'${version}',1200,7200,true,anchor,anchor+interval '30 minutes');
    insert into private.subscription_enrollments(session_id,user_id,artist_id,subscription_id,mandate_id,credential_ref,auth_session_hash,callback_state_hash,state,stage,payment_event_id)
      values(session,'${user}','${artist}','${subscription}',mid,cid,repeat('b',64),repeat('c',64),'succeeded','charge',event);
    insert into private.enrollment_credentials(id,mandate_id,ciphertext)
      values(cid,mid,'{"version":"fixture-v1","iv":"AAAAAAAAAAAAAAAA","tag":"AAAAAAAAAAAAAAAAAAAAAA","ciphertext":"AA"}');
    end $$;`;
}
