import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createFixtureState,
  fixtureResponse,
} from './enrollment-local-ci-provider.mjs';
import { ENROLLMENT_CI } from '../src/config/enrollment-test-runtime.ts';

const customer = 'da230000-0000-4000-8000-000000000001';
const order = 'da230000-0000-4000-8000-000000000002';
const headers = {
  authorization: `SECRET_KEY ${ENROLLMENT_CI.kakaoSecretKey}`,
};
function request(
  state,
  path,
  body = {},
  method = 'POST',
  requestHeaders = headers,
) {
  return fixtureResponse(state, {
    path,
    method,
    headers: requestHeaders,
    body,
  });
}
function registered(state) {
  const ready = request(state, '/kakaopay/online/v1/payment/ready', {
    cid: ENROLLMENT_CI.kakaoCid,
    partner_order_id: order,
    partner_user_id: customer,
    total_amount: 1000,
    tax_free_amount: 0,
    approval_url: `${ENROLLMENT_CI.appOrigin}/api/checkout/return?outcome=success`,
    cancel_url: `${ENROLLMENT_CI.appOrigin}/api/checkout/return?outcome=cancel`,
    fail_url: `${ENROLLMENT_CI.appOrigin}/api/checkout/return?outcome=failure`,
  }).body;
  return request(state, '/kakaopay/online/v1/payment/approve', {
    cid: ENROLLMENT_CI.kakaoCid,
    tid: ready.tid,
    partner_order_id: order,
    partner_user_id: customer,
    total_amount: 1000,
    pg_token: `ci_pg_${ready.tid}`,
  }).body.sid;
}
function subscription(state, sid, overrides = {}) {
  return request(state, '/kakaopay/online/v1/payment/subscription', {
    cid: ENROLLMENT_CI.kakaoCid,
    sid,
    partner_order_id: order,
    partner_user_id: customer,
    item_name: 'Fictional subscription renewal',
    quantity: 1,
    total_amount: 6500,
    tax_free_amount: 0,
    ...overrides,
  });
}

test('renewal fixture requires the original enrolled SID/customer binding', () => {
  const state = createFixtureState();
  const sid = registered(state);
  assert.throws(() => subscription(state, 'unknown_sid'));
  assert.throws(() =>
    subscription(state, sid, {
      partner_user_id: 'da230000-0000-4000-8000-000000000099',
    }),
  );
  const result = subscription(state, sid).body;
  assert.equal(result.amount.total, 6500);
  assert.equal(result.partner_order_id, order);
  assert.equal(result.sid, sid);
  assert.equal(state.charges.kakao, 2);
});

test('Kakao renewal duplicates are distinct charges, not hidden by mock idempotency', () => {
  const state = createFixtureState();
  const sid = registered(state);
  const first = subscription(state, sid).body;
  const duplicate = subscription(state, sid).body;
  assert.notEqual(first.tid, duplicate.tid);
  assert.notEqual(first.aid, duplicate.aid);
  assert.equal(state.requests.kakaoSubscription, 2);
  assert.equal(state.charges.kakao, 3);
});

test('lost Kakao renewal response exposes no TID and creates only fixture evidence', () => {
  const state = createFixtureState();
  const sid = registered(state);
  state.scenario = 'subscription-response-lost';
  assert.deepEqual(subscription(state, sid), { lost: true });
  assert.equal(state.kakaoOrders.size, 2);
  assert.equal(state.requests.kakaoSubscription, 1);
  assert.equal(state.charges.kakao, 2);
  assert.throws(() =>
    request(state, '/kakaopay/online/v1/payment/order', {
      cid: ENROLLMENT_CI.kakaoCid,
      partner_order_id: order,
    }),
  );
  assert.throws(() =>
    request(state, '/kakaopay/online/v1/payment/manage/subscription/status', {
      cid: ENROLLMENT_CI.kakaoCid,
      sid,
    }),
  );
});

test('Kakao order query with known renewal TID never returns SID', () => {
  const state = createFixtureState();
  const sid = registered(state);
  const approved = subscription(state, sid).body;
  const queried = request(state, '/kakaopay/online/v1/payment/order', {
    cid: ENROLLMENT_CI.kakaoCid,
    tid: approved.tid,
  }).body;
  assert.equal(queried.sid, undefined);
  assert.equal(queried.status, 'SUCCESS_PAYMENT');
  assert.equal(queried.payment_action_details[0].aid, approved.aid);
});

test('response barrier is explicit, deterministic and adds no timer', () => {
  const state = createFixtureState();
  const sid = registered(state);
  state.scenario = 'hold-charge';
  const held = subscription(state, sid);
  assert.equal(held.hold, true);
  assert.equal(held.delay, undefined);
  assert.equal(state.charges.kakao, 2);
  assert.equal(
    request(state, '/__fixture/release', {}, 'POST', {}).release,
    true,
  );
});

test('renewal fixture permits no invented Kakao idempotency header', () => {
  const state = createFixtureState();
  const sid = registered(state);
  assert.throws(() =>
    request(
      state,
      '/kakaopay/online/v1/payment/subscription',
      {
        cid: ENROLLMENT_CI.kakaoCid,
        sid,
      },
      'POST',
      { ...headers, 'idempotency-key': order },
    ),
  );
});

test('renewal counters disclose no mandate, customer or payment identity', () => {
  const state = createFixtureState();
  const sid = registered(state);
  subscription(state, sid);
  const observed = request(state, '/__fixture/calls', {}, 'GET', {}).body;
  assert.equal(observed.requests.kakaoSubscription, 1);
  for (const forbidden of [sid, customer, order, 'ci_tid_', 'ci_aid_'])
    assert.ok(!JSON.stringify(observed).includes(forbidden));
});
