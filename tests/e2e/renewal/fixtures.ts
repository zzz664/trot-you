import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { APIRequestContext } from '@playwright/test';
import {
  localSql as enrollmentSql,
  preparePolicies,
  activatePolicies,
  type Identity,
} from '../enrollment/fixtures';
import { RENEWAL_CI } from '../../../src/config/enrollment-test-runtime';
import { checkoutFixtures } from '../authenticated/checkout-fixtures';
import { routes } from '../../../src/config/routes';
export * from '../enrollment/fixtures';

function localSql(sql: string) {
  assert.equal(process.env.RENEWAL_LOCAL_E2E, 'true');
  assert.equal(process.env.PAYMENTS_RENEWALS_ENABLED, 'true');
  assert.equal(process.env.RENEWAL_CRON_SECRET, RENEWAL_CI.cronSecret);
  return enrollmentSql(sql);
}
function uuid(value: string) {
  assert.match(
    value,
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );
  return value;
}
const actorPredicate = (
  actor: Identity,
) => `s.user_id='${uuid(actor.id)}' and s.artist_id='${uuid(actor.artist.id)}'
  and exists(select 1 from auth.users u where u.id=s.user_id
    and u.email ~ '^enrollment-e2e-[0-9a-f-]{36}@example[.]invalid$')`;

export function prepareRenewalPolicies() {
  preparePolicies();
  localSql(`insert into private.renewal_policies(
    checkout_policy_version,grace_seconds,retry_seconds,max_retries,
    notice_required,notice_lead_seconds,approved_at,published_at)
    values('${checkoutFixtures.policy}',259200,86400,3,false,0,clock_timestamp(),clock_timestamp())
    on conflict(checkout_policy_version) do nothing;`);
}

export function activateRenewalPolicies() {
  activatePolicies();
}

export function retirePreviousRenewalFixtures() {
  const prior =
    localSql(`select s.id from public.subscriptions s join auth.users u on u.id=s.user_id
    where u.email ~ '^enrollment-e2e-[0-9a-f-]{36}@example[.]invalid$';`)
      .split('\n')
      .filter(Boolean)
      .map(uuid);
  if (prior.length)
    localSql(`begin; set local role service_role;
    ${prior.map((id) => `select public.cancel_subscription('${id}'); select public.billing_expire_subscription('${id}');`).join('\n')}
    commit;`);
  // Retain uncertain financial work honestly, but move its fixture-only query
  // clock outside this test horizon so another test cannot observe its traffic.
  localSql(`update private.renewal_attempts r set next_query_at=clock_timestamp()+interval '100 years'
    from private.payment_attempts a,private.billing_obligations o,public.subscriptions s,auth.users u
    where r.attempt_id=a.id and a.obligation_id=o.id and o.subscription_id=s.id and s.user_id=u.id
      and u.email ~ '^enrollment-e2e-[0-9a-f-]{36}@example[.]invalid$';`);
}

export function advanceRecoveryClock(actor: Identity) {
  localSql(`update private.renewal_attempts r set next_query_at=clock_timestamp()-interval '1 second'
    from private.payment_attempts a,private.billing_obligations o,public.subscriptions s
    where r.attempt_id=a.id and a.obligation_id=o.id and o.subscription_id=s.id and ${actorPredicate(actor)};`);
}

// Synthetic scheduling chronology ONLY in the disposable, fixed local CI stack.
// Enrollment/vault/provider registration use the real flow. Retained immutable
// payment events and verifications are never edited or disabled. Moving only the
// fictional subscription clock avoids waiting a calendar month in a browser test.
export function makeRenewalDue(actor: Identity) {
  localSql(`do $$ declare due timestamptz := date_trunc('milliseconds',clock_timestamp())-interval '1 minute'; begin
    update public.subscriptions s set
      episode_started_at=due-interval '4 years',
      first_started_at=due-interval '4 years',
      current_period_start=due-interval '1 month',current_period_end=due,
      next_billing_at=due
    where ${actorPredicate(actor)} and s.status='active';
  end $$;`);
  return renewalSnapshot(actor);
}

export function advanceRetryClock(actor: Identity) {
  localSql(`begin;
    update private.billing_obligations o set next_attempt_at=clock_timestamp()-interval '1 second'
      from public.subscriptions s where o.subscription_id=s.id and ${actorPredicate(actor)} and not o.is_initial and o.state='open';
    update public.subscriptions s set next_billing_at=clock_timestamp()-interval '1 second'
      where ${actorPredicate(actor)} and s.status='grace' and s.next_billing_at is not null;
    commit;`);
}

export function expireGraceClock(actor: Identity) {
  localSql(`update public.subscriptions s set grace_ends_at=clock_timestamp()-interval '1 second'
    where ${actorPredicate(actor)} and s.status='grace';`);
}

export function expirePaidClock(actor: Identity) {
  localSql(`update public.subscriptions s set current_period_start=least(current_period_start,clock_timestamp()-interval '1 day'),current_period_end=clock_timestamp()-interval '1 second'
    where ${actorPredicate(actor)} and s.status='canceled';`);
}

export function expireDispatchLease(actor: Identity) {
  localSql(`update private.payment_attempts a set lease_expires_at=clock_timestamp()-interval '1 second'
    from private.billing_obligations o,public.subscriptions s
    where a.obligation_id=o.id and o.subscription_id=s.id and ${actorPredicate(actor)}
      and not o.is_initial and a.state='inflight';`);
}

export function useUnconfiguredRenewalPolicy() {
  const version = randomUUID();
  localSql(`insert into private.checkout_policies(version,title,body,regular_price_krw,intro_price_krw,
    approved_at,published_at,billing_period_calendar,payment_tax_basis)
    values('${version}','허구 미설정 갱신 약관','격리 CI 전용: 갱신 정책 미설정 차단 점검.',6500,1000,
      clock_timestamp(),clock_timestamp(),'utc_monthly_clamped','taxable_krw');
    update private.checkout_policy_current set policy_version='${version}' where singleton;`);
  return version;
}

export async function invokeRenewals(request: APIRequestContext) {
  const response = await request.post(routes.chargeRenewals, {
    headers: { Authorization: `Bearer ${RENEWAL_CI.cronSecret}` },
  });
  return response;
}

export function renewalSnapshot(actor: Identity) {
  return JSON.parse(
    localSql(`select jsonb_build_object(
    'subscription',(select jsonb_build_object('id',s.id,'status',s.status,
      'introUsed',s.intro_redeemed_at is not null,'episode',s.episode_started_at,
      'periodStart',s.current_period_start,'periodEnd',s.current_period_end,
      'graceStart',s.grace_started_at,'graceEnd',s.grace_ends_at,'nextBilling',s.next_billing_at)
      from public.subscriptions s where ${actorPredicate(actor)}),
    'events',(select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'amount',e.amount_krw,
      'start',e.period_start,'end',e.period_end) order by e.recorded_at,e.id),'[]'::jsonb)
      from public.payment_events e join public.subscriptions s on s.id=e.subscription_id where ${actorPredicate(actor)}),
    'recovery',(select coalesce(jsonb_agg(jsonb_build_object('queries',r.query_attempts,'paymentKnown',r.provider_payment_id is not null)),'[]'::jsonb)
      from private.renewal_attempts r join private.payment_attempts a on a.id=r.attempt_id
      join private.billing_obligations o on o.id=a.obligation_id join public.subscriptions s on s.id=o.subscription_id
      where ${actorPredicate(actor)}),
    'attempts',(select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'state',a.state,'ordinal',a.ordinal)
      order by a.ordinal),'[]'::jsonb) from private.payment_attempts a
      join private.billing_obligations o on o.id=a.obligation_id join public.subscriptions s on s.id=o.subscription_id
      where ${actorPredicate(actor)} and not o.is_initial),
    'obligations',(select coalesce(jsonb_agg(jsonb_build_object('id',o.id,'amount',o.amount_krw,'intro',o.is_intro,
      'state',o.state,'start',o.period_start,'end',o.period_end,'retrySeconds',o.retry_seconds,
      'graceSeconds',o.grace_seconds,'maxRetries',o.max_retries,'nextAttempt',o.next_attempt_at)),'[]'::jsonb)
      from private.billing_obligations o join public.subscriptions s on s.id=o.subscription_id
      where ${actorPredicate(actor)} and not o.is_initial));`),
  ) as {
    subscription: {
      id: string;
      status: string;
      introUsed: boolean;
      episode: string;
      periodStart: string;
      periodEnd: string;
      graceStart: string | null;
      graceEnd: string | null;
      nextBilling: string | null;
    };
    events: { id: string; amount: number; start: string; end: string }[];
    recovery: { queries: number; paymentKnown: boolean }[];
    attempts: { id: string; state: string; ordinal: number }[];
    obligations: {
      id: string;
      amount: number;
      intro: boolean;
      state: string;
      start: string;
      end: string;
      retrySeconds: number;
      graceSeconds: number;
      maxRetries: number;
      nextAttempt: string;
    }[];
  };
}

export function useNoticeRequiredPolicy() {
  const version = useUnconfiguredRenewalPolicy();
  localSql(`insert into private.renewal_policies(
    checkout_policy_version,grace_seconds,retry_seconds,max_retries,
    notice_required,notice_lead_seconds,approved_at,published_at)
    values('${version}',259200,86400,3,true,86400,clock_timestamp(),clock_timestamp());`);
  return version;
}

export function recordFictionalDeliveredNotice(
  actor: Identity,
  policy: string,
) {
  const current = renewalSnapshot(actor).subscription;
  localSql(`begin; set local role service_role;
    select public.renewal_record_notice('${uuid(current.id)}','${current.periodEnd}'::timestamptz,
      '${uuid(policy)}',6500,'${current.periodEnd}'::timestamptz-interval '1 day','${randomUUID()}');
    commit;`);
}
