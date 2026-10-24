import assert from 'node:assert/strict';
import type { APIRequestContext } from '@playwright/test';
import {
  localSql as enrollmentSql,
  retirePreviousRenewalFixtures,
  type Identity,
} from '../cancellation/fixtures';
import {
  RECONCILIATION_CI,
  parseReconciliationTestRuntime,
} from '../../../src/config/reconciliation-test-runtime';
import { routes } from '../../../src/config/routes';
export * from '../cancellation/fixtures';

function localSql(sql: string) {
  assert.equal(
    parseReconciliationTestRuntime({ ...process.env, NODE_ENV: 'development' })
      .mode,
    'ci',
  );
  return enrollmentSql(sql);
}
function uuid(value: string) {
  assert.match(
    value,
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );
  return value;
}
const actorPredicate = (actor: Identity) =>
  `s.user_id='${uuid(actor.id)}' and s.artist_id='${uuid(actor.artist.id)}'
  and exists(select 1 from auth.users u where u.id=s.user_id and u.email ~ '^enrollment-e2e-[0-9a-f-]{36}@example[.]invalid$')`;
const subscriptionOfCase = `(select e.subscription_id from private.subscription_enrollments e where e.session_id=c.initial_session_id)
  =s.id or (select o.subscription_id from private.payment_attempts a join private.billing_obligations o on o.id=a.obligation_id where a.id=c.renewal_attempt_id)
  =s.id or (select r.subscription_id from private.refund_requests r where r.id=c.refund_request_id)=s.id`;

export function retirePreviousReconciliationFixtures() {
  retirePreviousRenewalFixtures();
  // Seed remaining uncertain fictional operations without provider I/O, then
  // defer only their test clocks. Retain every case, evidence and ledger row.
  localSql(`begin; set local role service_role; select public.reconciliation_candidates(20); commit;
    update private.payment_reconciliation_cases c set next_query_at=clock_timestamp()+interval '100 years'
    from public.subscriptions s where (${subscriptionOfCase}) and exists(select 1 from auth.users u where u.id=s.user_id
      and u.email ~ '^enrollment-e2e-[0-9a-f-]{36}@example[.]invalid$');
    update private.refund_requests r set next_query_at=clock_timestamp()+interval '100 years'
    from public.subscriptions s where r.subscription_id=s.id and exists(select 1 from auth.users u where u.id=s.user_id
      and u.email ~ '^enrollment-e2e-[0-9a-f-]{36}@example[.]invalid$');`);
}
export function advanceReconciliationClock(actor: Identity) {
  localSql(`update private.payment_reconciliation_cases c set next_query_at=clock_timestamp()-interval '1 second'
    from public.subscriptions s where (${subscriptionOfCase}) and ${actorPredicate(actor)};
    update private.renewal_attempts ra set next_query_at=clock_timestamp()-interval '1 second'
    from private.payment_attempts a,private.billing_obligations o,public.subscriptions s
    where ra.attempt_id=a.id and a.obligation_id=o.id and o.subscription_id=s.id and ${actorPredicate(actor)};
    update private.refund_requests r set next_query_at=clock_timestamp()-interval '1 second'
    from public.subscriptions s where r.subscription_id=s.id and ${actorPredicate(actor)};`);
}
export async function invokeReconciliation(request: APIRequestContext) {
  return request.post(routes.reconcilePayments, {
    headers: { Authorization: `Bearer ${RECONCILIATION_CI.cronSecret}` },
  });
}
export function reconciliationSnapshot(actor: Identity) {
  return JSON.parse(
    localSql(`select jsonb_build_object(
    'sessionId',(select e.session_id from private.subscription_enrollments e join public.subscriptions s on s.id=e.subscription_id where ${actorPredicate(actor)} order by e.created_at desc limit 1),
    'initialOrder',(select e.attempt_id from private.subscription_enrollments e join public.subscriptions s on s.id=e.subscription_id where ${actorPredicate(actor)} order by e.created_at desc limit 1),
    'cases',(select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'kind',c.kind,'state',c.state,'reason',c.reason,'queries',c.query_attempts,'event',c.payment_event_id) order by c.created_at,c.id),'[]'::jsonb)
      from private.payment_reconciliation_cases c join public.subscriptions s on (${subscriptionOfCase}) where ${actorPredicate(actor)}),
    'inbox',(select coalesce(jsonb_agg(jsonb_build_object('status',i.status,'state',i.state,'digest',i.payload_digest) order by i.received_at,i.id),'[]'::jsonb)
      from private.payment_provider_inbox i join private.payment_reconciliation_cases c on c.id=i.case_id join public.subscriptions s on (${subscriptionOfCase}) where ${actorPredicate(actor)}));`),
  ) as {
    sessionId: string;
    initialOrder: string;
    cases: {
      id: string;
      kind: string;
      state: string;
      reason: string | null;
      queries: number;
      event: string | null;
    }[];
    inbox: { status: string; state: string; digest: string }[];
  };
}
