import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createReconciliationFixtureState,
  reconciliationFixtureResponse,
  startReconciliationFixtureProvider,
} from './reconciliation-local-ci-provider.mjs';
import {
  ENROLLMENT_CI,
  RECONCILIATION_CI,
} from '../src/config/enrollment-test-runtime.ts';

const customer = 'da240000-0000-4000-8000-000000000001';
const order = 'da240000-0000-4000-8000-000000000002';
const headers = {
  authorization: `Basic ${Buffer.from(`${ENROLLMENT_CI.tossSecretKey}:`).toString('base64')}`,
  'idempotency-key': order,
};
function request(state, path, body = {}, method = 'POST') {
  return reconciliationFixtureResponse(state, { path, method, headers, body });
}
function charge(state) {
  return request(state, `/toss/v1/billing/ci_billing_${customer}`, {
    customerKey: customer,
    orderId: order,
    amount: 1000,
    taxFreeAmount: 0,
  });
}

test('fixture rejects ordinary, production, token-only and partial runtimes before binding socket', () => {
  for (const input of [
    {},
    { RECONCILIATION_LOCAL_E2E: 'true' },
    { RECONCILIATION_CRON_SECRET: RECONCILIATION_CI.cronSecret },
    { RECONCILIATION_LOCAL_E2E: 'true', NODE_ENV: 'production' },
  ])
    assert.throws(() => startReconciliationFixtureProvider(input));
});
test('untrusted hint is projected from a retained fictional payment, not a new charge', () => {
  const state = createReconciliationFixtureState();
  const result = charge(state);
  const hint = request(state, '/__fixture/toss-event', { orderId: order });
  assert.equal(hint.body.eventType, 'PAYMENT_STATUS_CHANGED');
  assert.deepEqual(hint.body.data, result.body);
  assert.equal(state.charges.toss, 1);
  assert.equal(state.requests.tossQuery, 0);
});
test('hint helper refuses unknown order, caller data and callback query injection', () => {
  const state = createReconciliationFixtureState();
  assert.throws(() =>
    request(state, '/__fixture/toss-event', { orderId: order }),
  );
  charge(state);
  assert.throws(() =>
    request(state, '/__fixture/toss-event', { orderId: order, amount: 1 }),
  );
  assert.throws(() =>
    request(state, '/__fixture/toss-event?amount=1', { orderId: order }),
  );
});
test('lost response remains queryable once without another provider charge', () => {
  const state = createReconciliationFixtureState();
  state.scenario = 'charge-response-lost';
  assert.deepEqual(charge(state), { lost: true });
  const payment = request(
    state,
    `/toss/v1/payments/orders/${order}`,
    {},
    'GET',
  );
  assert.equal(payment.body.orderId, order);
  assert.equal(payment.body.totalAmount, 1000);
  assert.equal(state.charges.toss, 1);
  assert.equal(state.requests.tossQuery, 1);
});
test('held and unavailable query scenarios preserve counts and payment identity', () => {
  const state = createReconciliationFixtureState();
  charge(state);
  request(state, '/__fixture/scenario', { scenario: 'hold-query' });
  assert.equal(
    request(state, `/toss/v1/payments/orders/${order}`, {}, 'GET').hold,
    true,
  );
  assert.equal(request(state, '/__fixture/release').release, true);
  request(state, '/__fixture/scenario', {
    scenario: 'all-queries-unavailable',
  });
  assert.equal(
    request(state, `/toss/v1/payments/orders/${order}`, {}, 'GET').status,
    503,
  );
  assert.equal(state.charges.toss, 1);
  assert.equal(state.requests.tossQuery, 2);
});
test('fixture reset preserves no previous payment or refund state', () => {
  const state = createReconciliationFixtureState();
  charge(state);
  request(state, '/__fixture/reset');
  assert.equal(state.tossOrders.size, 0);
  assert.equal(state.refundOperations.size, 0);
  assert.deepEqual(state.refunds, { toss: 0, kakao: 0 });
  assert.throws(() =>
    request(state, '/__fixture/toss-event', { orderId: order }),
  );
});
