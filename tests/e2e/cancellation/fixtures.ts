import assert from 'node:assert/strict';
import {
  localSql as enrollmentSql,
  prepareRenewalPolicies,
  activateRenewalPolicies,
  type Identity,
} from '../renewal/fixtures';
export * from '../renewal/fixtures';

export const refundFixturePolicy = 'da230000-0000-4000-8000-000000000101';
function localSql(sql: string) {
  assert.equal(process.env.CANCELLATION_LOCAL_E2E, 'true');
  assert.equal(process.env.PAYMENTS_REFUNDS_ENABLED, 'true');
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
  and exists(select 1 from auth.users u where u.id=s.user_id and u.email ~ '^enrollment-e2e-[0-9a-f-]{36}@example[.]invalid$')`;

export function prepareCancellationPolicies() {
  prepareRenewalPolicies();
  // Fictional isolated test authorization, not the draft business proposal or a
  // real approved legal policy. This private disposable stack is destroyed.
  localSql(`insert into private.refund_policies(version,title,body,access_effect,payment_tax_basis,approved_at,published_at)
    values('${refundFixturePolicy}','허구 CI 환불 검토 정책','격리 테스트 전용 정책입니다. 실제 환불 정책 승인을 의미하지 않습니다.',
      'preserve_paid_access','taxable_krw',clock_timestamp(),clock_timestamp()) on conflict(version) do nothing;`);
}
export function activateCancellationPolicies() {
  activateRenewalPolicies();
  localSql(`insert into private.refund_policy_current(singleton,version) values(true,'${refundFixturePolicy}')
    on conflict(singleton) do update set version=excluded.version;`);
}
export function removeRefundPolicy() {
  localSql('delete from private.refund_policy_current where singleton;');
}
export function setActorRole(actor: Identity, role: 'fan' | 'admin') {
  assert.ok(['fan', 'admin'].includes(role));
  localSql(`update public.profiles p set role='${role}' where p.id='${uuid(actor.id)}'
    and exists(select 1 from auth.users u where u.id=p.id and u.email ~ '^enrollment-e2e-[0-9a-f-]{36}@example[.]invalid$');`);
}
export function restrictActor(actor: Identity) {
  localSql(`update public.profiles p set is_restricted=true,restricted_until=null where p.id='${uuid(actor.id)}'
    and exists(select 1 from auth.users u where u.id=p.id and u.email ~ '^enrollment-e2e-[0-9a-f-]{36}@example[.]invalid$');`);
}
export function advanceRefundRecoveryClock(actor: Identity) {
  localSql(`update private.refund_requests r set next_query_at=clock_timestamp()-interval '1 second'
    from public.subscriptions s where r.subscription_id=s.id and ${actorPredicate(actor)} and r.state='unknown';`);
}
export function expireRefundLease(actor: Identity) {
  localSql(`update private.refund_requests r set lease_expires_at=clock_timestamp()-interval '1 second'
    from public.subscriptions s where r.subscription_id=s.id and ${actorPredicate(actor)} and r.state='inflight';`);
}
export function cancellationSnapshot(actor: Identity) {
  return JSON.parse(
    localSql(`select jsonb_build_object(
    'subscription',(select jsonb_build_object('id',s.id,'status',s.status,'periodEnd',s.current_period_end,'nextBilling',s.next_billing_at,'canceledAt',s.canceled_at)
      from public.subscriptions s where ${actorPredicate(actor)}),
    'events',(select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'kind',e.kind,'amount',e.amount_krw,'original',e.original_event_id) order by e.recorded_at,e.id),'[]'::jsonb)
      from public.payment_events e join public.subscriptions s on s.id=e.subscription_id where ${actorPredicate(actor)}),
    'requests',(select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'state',r.state,'amount',r.amount_krw,'queries',r.query_attempts,'event',r.payment_event_id)
      order by r.requested_at,r.id),'[]'::jsonb) from private.refund_requests r join public.subscriptions s on s.id=r.subscription_id where ${actorPredicate(actor)}),
    'decisions',(select count(*) from private.refund_decisions d join private.refund_requests r on r.id=d.request_id
      join public.subscriptions s on s.id=r.subscription_id where ${actorPredicate(actor)}));`),
  ) as {
    subscription: {
      id: string;
      status: string;
      periodEnd: string;
      nextBilling: string | null;
      canceledAt: string | null;
    };
    events: {
      id: string;
      kind: 'charge' | 'refund';
      amount: number;
      original: string | null;
    }[];
    requests: {
      id: string;
      state: string;
      amount: number;
      queries: number;
      event: string | null;
    }[];
    decisions: number;
  };
}
export async function hasPaidAccess(actor: Identity) {
  const client = await actor.actorClient();
  const result = await client.rpc('has_active_access', {
    p_artist_id: actor.artist.id,
  });
  assert.equal(result.error, null);
  return result.data;
}
