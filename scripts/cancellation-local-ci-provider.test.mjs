import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createCancellationFixtureState,
  cancellationFixtureResponse,
  startCancellationFixtureProvider,
} from './cancellation-local-ci-provider.mjs';
import { ENROLLMENT_CI } from '../src/config/enrollment-test-runtime.ts';

const customer = 'da230000-0000-4000-8000-000000000001';
const order = 'da230000-0000-4000-8000-000000000002';
const attempt = 'da230000-0000-4000-8000-000000000003';
const second = 'da230000-0000-4000-8000-000000000004';
const tossHeaders = {
  authorization: `Basic ${Buffer.from(`${ENROLLMENT_CI.tossSecretKey}:`).toString('base64')}`,
  'idempotency-key': attempt,
};
const kakaoHeaders = {
  authorization: `SECRET_KEY ${ENROLLMENT_CI.kakaoSecretKey}`,
};
function request(state, path, body = {}, headers = {}, method = 'POST') {
  return cancellationFixtureResponse(state, { path, method, headers, body });
}
function chargeToss(state) {
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
  ).body;
}
function chargeKakao(state) {
  const ready = request(
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
  ).body;
  return request(
    state,
    '/kakaopay/online/v1/payment/approve',
    {
      cid: ENROLLMENT_CI.kakaoCid,
      tid: ready.tid,
      partner_order_id: order,
      partner_user_id: customer,
      total_amount: 1000,
      pg_token: `ci_pg_${ready.tid}`,
    },
    kakaoHeaders,
  ).body;
}
function refundToss(state, amount = 1000, remaining = 1000, id = attempt) {
  return request(
    state,
    `/toss/v1/payments/ci_payment_${order}/cancel`,
    {
      cancelReason: `trot-you.refund.v1:${id}`,
      cancelAmount: amount,
      currency: 'KRW',
      taxFreeAmount: 0,
      refundableAmount: remaining,
    },
    { ...tossHeaders, 'idempotency-key': id },
  );
}
function refundKakao(
  state,
  tid,
  amount = 1000,
  remaining = 1000,
  id = attempt,
) {
  return request(
    state,
    '/kakaopay/online/v1/payment/cancel',
    {
      cid: ENROLLMENT_CI.kakaoCid,
      tid,
      cancel_amount: amount,
      cancel_tax_free_amount: 0,
      cancel_available_amount: remaining,
      payload: `trot-you.refund.v1:${id}`,
    },
    kakaoHeaders,
  );
}

test('refund fixture cannot start in ordinary, production or partial runtime', () => {
  for (const input of [
    {},
    { CANCELLATION_LOCAL_E2E: 'true' },
    { CANCELLATION_LOCAL_E2E: 'true', NODE_ENV: 'production' },
  ])
    assert.throws(() => startCancellationFixtureProvider(input));
});
test('Toss cancel uses exact request-bound idempotency and immutable action', () => {
  const state = createCancellationFixtureState();
  chargeToss(state);
  const first = refundToss(state);
  assert.deepEqual(first.body, refundToss(state).body);
  assert.equal(first.body.status, 'CANCELED');
  assert.equal(first.body.cancels[0].cancelStatus, 'DONE');
  assert.equal(state.refunds.toss, 1);
  assert.equal(state.refundRequests.tossCancel, 2);
  assert.throws(() => refundToss(state, 500));
});
test('Toss response loss leaves queryable exact action without another refund', () => {
  const state = createCancellationFixtureState();
  chargeToss(state);
  state.scenario = 'refund-response-lost';
  assert.deepEqual(refundToss(state), { lost: true });
  const queried = request(
    state,
    `/toss/v1/payments/ci_payment_${order}`,
    {},
    tossHeaders,
    'GET',
  );
  assert.equal(queried.body.balanceAmount, 0);
  assert.equal(
    queried.body.cancels[0].cancelReason,
    `trot-you.refund.v1:${attempt}`,
  );
  assert.equal(state.refunds.toss, 1);
});
test('Toss partial refunds preserve cumulative amounts and unique actions', () => {
  const state = createCancellationFixtureState();
  chargeToss(state);
  const first = refundToss(state, 400).body;
  const secondResult = refundToss(state, 600, 600, second).body;
  assert.equal(first.status, 'PARTIAL_CANCELED');
  assert.equal(first.balanceAmount, 600);
  assert.equal(secondResult.cancels.length, 2);
  assert.notEqual(
    secondResult.cancels[0].transactionKey,
    secondResult.cancels[1].transactionKey,
  );
  assert.equal(secondResult.balanceAmount, 0);
});
test('Kakao response loss query identifies cancellation payload and original payment separately', () => {
  const state = createCancellationFixtureState();
  const initial = chargeKakao(state);
  state.scenario = 'refund-response-lost';
  assert.deepEqual(refundKakao(state, initial.tid), { lost: true });
  const query = request(
    state,
    '/kakaopay/online/v1/payment/order',
    { cid: ENROLLMENT_CI.kakaoCid, tid: initial.tid },
    kakaoHeaders,
  ).body;
  assert.equal(query.status, 'CANCEL_PAYMENT');
  assert.equal(query.canceled_amount.total, 1000);
  assert.equal(query.cancel_available_amount.total, 0);
  assert.equal(query.payment_action_details[0].aid, initial.aid);
  assert.equal(
    query.payment_action_details[1].payload,
    `trot-you.refund.v1:${attempt}`,
  );
  assert.equal(state.refunds.kakao, 1);
});
test('Kakao deliberately does not invent payload deduplication', () => {
  const state = createCancellationFixtureState();
  const initial = chargeKakao(state);
  const first = refundKakao(state, initial.tid, 200).body;
  const repeated = refundKakao(state, initial.tid, 200, 800).body;
  assert.notEqual(first.aid, repeated.aid);
  assert.equal(repeated.canceled_amount.total, 400);
  assert.equal(state.refunds.kakao, 2);
});
test('Kakao unknown or incorrect remaining balance never produces a success', () => {
  const state = createCancellationFixtureState();
  const initial = chargeKakao(state);
  assert.throws(() => refundKakao(state, 'ci_tid_not_found'));
  assert.throws(() => refundKakao(state, initial.tid, 1001));
  assert.throws(() => refundKakao(state, initial.tid, 1000, 999));
  assert.equal(state.refunds.kakao, 0);
});
test('Toss incorrect remaining balance or missing marker cannot refund', () => {
  const state = createCancellationFixtureState();
  chargeToss(state);
  assert.throws(() => refundToss(state, 1000, 999));
  assert.throws(() =>
    request(
      state,
      `/toss/v1/payments/ci_payment_${order}/cancel`,
      {
        cancelReason: 'user text',
        cancelAmount: 1000,
        currency: 'KRW',
        taxFreeAmount: 0,
        refundableAmount: 1000,
      },
      tossHeaders,
    ),
  );
  assert.equal(state.refunds.toss, 0);
});
test('rejected requests produce zero refunds while preserving original charges', () => {
  const state = createCancellationFixtureState();
  chargeToss(state);
  const initial = chargeKakao(state);
  state.scenario = 'refund-reject';
  assert.equal(refundToss(state).status, 400);
  assert.equal(refundKakao(state, initial.tid).status, 400);
  assert.deepEqual(state.refunds, { toss: 0, kakao: 0 });
  assert.deepEqual(state.charges, { toss: 1, kakao: 1 });
});
test('held reply is an explicit barrier with no duplicate financial operation', () => {
  const state = createCancellationFixtureState();
  chargeToss(state);
  state.scenario = 'hold-refund';
  assert.equal(refundToss(state).hold, true);
  assert.equal(state.refunds.toss, 1);
  assert.equal(request(state, '/__fixture/release').release, true);
});
test('observer counters expose no tokens, actor identities, keys or cancellation markers', () => {
  const state = createCancellationFixtureState();
  chargeToss(state);
  const initial = chargeKakao(state);
  refundToss(state);
  refundKakao(state, initial.tid);
  const observed = request(state, '/__fixture/calls', {}, {}, 'GET');
  assert.deepEqual(observed.body.refunds, { toss: 1, kakao: 1 });
  assert.deepEqual(Object.keys(observed.body).sort(), [
    'charges',
    'refundRequests',
    'refunds',
    'requests',
  ]);
  for (const value of [
    attempt,
    customer,
    order,
    'ci_cancel_',
    'ci_sid_',
    'authorization',
  ])
    assert.ok(!JSON.stringify(observed).includes(value));
});
test('reset clears counters and query state but cannot reuse cancellation identities', () => {
  const state = createCancellationFixtureState();
  chargeToss(state);
  const previous = refundToss(state).body.cancels[0].transactionKey;
  request(state, '/__fixture/reset');
  assert.deepEqual(state.refunds, { toss: 0, kakao: 0 });
  assert.equal(state.refundOperations.size, 0);
  chargeToss(state);
  assert.notEqual(refundToss(state).body.cancels[0].transactionKey, previous);
});
test('Kakao rejects invented idempotency and unauthorized headers', () => {
  const state = createCancellationFixtureState();
  const initial = chargeKakao(state);
  const body = {
    cid: ENROLLMENT_CI.kakaoCid,
    tid: initial.tid,
    cancel_amount: 1000,
    cancel_tax_free_amount: 0,
    cancel_available_amount: 1000,
    payload: `trot-you.refund.v1:${attempt}`,
  };
  for (const headers of [
    { ...kakaoHeaders, 'idempotency-key': attempt },
    { authorization: 'SECRET_KEY real-key' },
  ])
    assert.throws(() =>
      request(state, '/kakaopay/online/v1/payment/cancel', body, headers),
    );
});
