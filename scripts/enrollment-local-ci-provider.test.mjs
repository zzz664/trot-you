import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createFixtureState,
  fixtureResponse,
  startFixtureProvider,
} from './enrollment-local-ci-provider.mjs';
import { ENROLLMENT_CI } from '../src/config/enrollment-test-runtime.ts';

const customer = 'da220000-0000-4000-8000-000000000001';
const order = 'da220000-0000-4000-8000-000000000002';
const operation = 'da220000-0000-4000-8000-000000000003';
const tossHeaders = {
  authorization: `Basic ${Buffer.from(`${ENROLLMENT_CI.tossSecretKey}:`).toString('base64')}`,
  'idempotency-key': operation,
};
const kakaoHeaders = {
  authorization: `SECRET_KEY ${ENROLLMENT_CI.kakaoSecretKey}`,
};
function request(state, path, body = {}, headers = {}, method = 'POST') {
  return fixtureResponse(state, { path, method, headers, body });
}
function ready(state) {
  return request(
    state,
    '/kakaopay/online/v1/payment/ready',
    {
      cid: ENROLLMENT_CI.kakaoCid,
      partner_order_id: order,
      partner_user_id: customer,
      total_amount: 1000,
      tax_free_amount: 0,
      approval_url: `${ENROLLMENT_CI.appOrigin}/api/checkout/return?outcome=success`,
      cancel_url: `${ENROLLMENT_CI.appOrigin}/api/checkout/return?outcome=cancel`,
      fail_url: `${ENROLLMENT_CI.appOrigin}/api/checkout/return?outcome=failure`,
    },
    kakaoHeaders,
  );
}
function approve(state, tid = 'ci_tid_1') {
  return request(
    state,
    '/kakaopay/online/v1/payment/approve',
    {
      cid: ENROLLMENT_CI.kakaoCid,
      tid,
      partner_order_id: order,
      partner_user_id: customer,
      total_amount: 1000,
      pg_token: `ci_pg_${tid}`,
    },
    kakaoHeaders,
  );
}
function tossCharge(state) {
  return request(
    state,
    `/toss/v1/billing/ci_billing_${customer}`,
    {
      customerKey: customer,
      orderId: order,
      amount: 1000,
      taxFreeAmount: 0,
    },
    tossHeaders,
  );
}

test('refuses ordinary and production runtime before opening a listener', () => {
  assert.throws(() => startFixtureProvider({}));
  assert.throws(() =>
    startFixtureProvider({
      ENROLLMENT_LOCAL_E2E: 'true',
      NODE_ENV: 'production',
    }),
  );
});
test('Toss fixture persists exact request-bound idempotency result', () => {
  const state = createFixtureState();
  assert.deepEqual(tossCharge(state).body, tossCharge(state).body);
  assert.equal(state.requests.tossCharge, 2);
  assert.equal(state.charges.toss, 1);
  assert.throws(() =>
    request(
      state,
      `/toss/v1/billing/ci_billing_${customer}`,
      {
        customerKey: customer,
        orderId: order,
        amount: 6500,
      },
      tossHeaders,
    ),
  );
});
test('lost Toss charge response has queryable result without another charge', () => {
  const state = createFixtureState();
  state.scenario = 'charge-response-lost';
  assert.deepEqual(tossCharge(state), { lost: true });
  const queried = request(
    state,
    `/toss/v1/payments/orders/${order}`,
    {},
    tossHeaders,
    'GET',
  );
  assert.equal(queried.body.status, 'DONE');
  assert.equal(queried.body.orderId, order);
  assert.equal(state.charges.toss, 1);
});
test('lost Toss issuance does not masquerade as successful receipt', () => {
  const state = createFixtureState();
  state.scenario = 'exchange-response-lost';
  assert.deepEqual(
    request(
      state,
      '/toss/v1/billing/authorizations/issue',
      {
        customerKey: customer,
        authKey: `ci_auth_${customer}`,
      },
      tossHeaders,
    ),
    { lost: true },
  );
  assert.equal(state.charges.toss, 0);
});
test('Kakao fixture provides distinct opaque device handoffs without changing production protocol', () => {
  const response = ready(createFixtureState()).body;
  const mobile = new URL(response.next_redirect_mobile_url);
  const desktop = new URL(response.next_redirect_pc_url);
  assert.notEqual(mobile.href, desktop.href);
  assert.equal(mobile.origin, 'https://online-pay.kakao.com');
  assert.equal(desktop.origin, mobile.origin);
  assert.equal(mobile.searchParams.get('device'), 'mobile');
  assert.equal(desktop.searchParams.get('device'), 'desktop');
  assert.equal(mobile.searchParams.get('tid'), desktop.searchParams.get('tid'));
});
test('Kakao fixture deliberately does not deduplicate merchant IDs', () => {
  const state = createFixtureState();
  ready(state);
  const first = approve(state);
  const second = approve(state);
  assert.notEqual(first.body.aid, second.body.aid);
  assert.equal(state.requests.kakaoApprove, 2);
  assert.equal(state.charges.kakao, 2);
});
test('lost Kakao approve can query charge but cannot recover SID', () => {
  const state = createFixtureState();
  ready(state);
  state.scenario = 'approve-response-lost';
  assert.deepEqual(approve(state), { lost: true });
  const queried = request(
    state,
    '/kakaopay/online/v1/payment/order',
    {
      cid: ENROLLMENT_CI.kakaoCid,
      tid: 'ci_tid_1',
    },
    kakaoHeaders,
  );
  assert.equal(queried.body.status, 'SUCCESS_PAYMENT');
  assert.equal(queried.body.sid, undefined);
  assert.equal(queried.body.payment_action_details[0].amount, 1000);
  assert.equal(state.requests.kakaoApprove, 1);
});
test('lost ready response preserves unknown TID but returns none to caller', () => {
  const state = createFixtureState();
  state.scenario = 'ready-response-lost';
  assert.deepEqual(ready(state), { lost: true });
  assert.equal(state.kakaoOrders.size, 1);
  assert.equal(state.charges.kakao, 0);
});
test('Kakao rejects invented idempotency headers', () => {
  const state = createFixtureState();
  assert.throws(() =>
    request(
      state,
      '/kakaopay/online/v1/payment/ready',
      {},
      {
        ...kakaoHeaders,
        'idempotency-key': operation,
      },
    ),
  );
});
test('declines create neither fixture charge nor success', () => {
  const state = createFixtureState();
  ready(state);
  state.scenario = 'reject';
  assert.equal(tossCharge(state).status, 400);
  assert.equal(approve(state).status, 400);
  assert.deepEqual(state.charges, { toss: 0, kakao: 0 });
});
test('observation exposes counters only, not tokens, identities or credentials', () => {
  const state = createFixtureState();
  tossCharge(state);
  ready(state);
  approve(state);
  const calls = request(state, '/__fixture/calls', {}, {}, 'GET');
  assert.deepEqual(Object.keys(calls.body).sort(), ['charges', 'requests']);
  for (const secret of [
    customer,
    order,
    'ci_sid',
    'ci_billing',
    'ci_pg',
    'authorization',
  ])
    assert.ok(!JSON.stringify(calls).includes(secret));
});
test('provider handoff contains the prevalidated local callback URLs', () => {
  const state = createFixtureState();
  ready(state);
  const result = request(
    state,
    '/__fixture/handoff?tid=ci_tid_1',
    {},
    {},
    'GET',
  );
  assert.equal(result.body.pgToken, 'ci_pg_ci_tid_1');
  assert.equal(
    new URL(result.body.approvalUrl).origin,
    ENROLLMENT_CI.appOrigin,
  );
  assert.deepEqual(Object.keys(result.body).sort(), [
    'approvalUrl',
    'cancelUrl',
    'failureUrl',
    'pgToken',
  ]);
});
test('control fixture reset does not retain prior state', () => {
  const state = createFixtureState();
  tossCharge(state);
  ready(state);
  request(state, '/__fixture/reset');
  assert.deepEqual(state.charges, { toss: 0, kakao: 0 });
  assert.equal(state.kakaoOrders.size, 0);
  assert.equal(state.tossOrders.size, 0);
});
