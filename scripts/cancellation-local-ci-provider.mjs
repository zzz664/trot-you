import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import {
  createFixtureState,
  fixtureResponse,
} from './enrollment-local-ci-provider.mjs';
import {
  ENROLLMENT_CI,
  parseCancellationTestRuntime,
} from '../src/config/enrollment-test-runtime.ts';

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MARKER = /^trot-you[.]refund[.]v1:([0-9a-f-]{36})$/i;
const BODY_LIMIT = 16_384;
const FIXTURE_PORT = 3_200;
const SCENARIOS = new Set([
  'success',
  'refund-response-lost',
  'refund-reject',
  'hold-refund',
  'refund-query-unavailable',
]);

export function createCancellationFixtureState() {
  return {
    ...createFixtureState(),
    refunds: { toss: 0, kakao: 0 },
    refundRequests: {
      tossCancel: 0,
      tossQuery: 0,
      kakaoCancel: 0,
      kakaoQuery: 0,
    },
    refundOperations: new Map(),
  };
}
function amount(value) {
  assert.ok(Number.isSafeInteger(value) && value > 0);
  return value;
}
function marker(value) {
  const match = MARKER.exec(value);
  assert.ok(match);
  assert.match(match[1], UUID);
  return match[1];
}
function kakaoProjection(order) {
  const original = order.approval;
  assert.ok(original);
  const canceled = (order.refundActions ?? []).reduce(
    (sum, action) => sum + action.amount,
    0,
  );
  return {
    cid: original.cid,
    tid: original.tid,
    partner_order_id: original.partner_order_id,
    partner_user_id: original.partner_user_id,
    payment_method_type: original.payment_method_type,
    status:
      canceled === original.amount.total
        ? 'CANCEL_PAYMENT'
        : canceled
          ? 'PART_CANCEL_PAYMENT'
          : 'SUCCESS_PAYMENT',
    amount: { total: original.amount.total, tax_free: 0 },
    canceled_amount: { total: canceled, tax_free: 0 },
    cancel_available_amount: {
      total: original.amount.total - canceled,
      tax_free: 0,
    },
    approved_at: original.approved_at,
  };
}

// Pure request/response fixture shared by offline node tests and loopback CI.
// No request path can contact an external payment service.
export function cancellationFixtureResponse(state, request) {
  const { method, path, headers, body } = request;
  const url = new URL(path, ENROLLMENT_CI.providerOrigin);
  const json = (value, status = 200) => ({ status, body: value });
  if (method === 'POST' && url.pathname === '/__fixture/reset') {
    Object.assign(state, createCancellationFixtureState());
    return json({ ok: true });
  }
  if (
    method === 'POST' &&
    url.pathname === '/__fixture/scenario' &&
    SCENARIOS.has(body.scenario)
  ) {
    assert.deepEqual(Object.keys(body), ['scenario']);
    state.scenario = body.scenario;
    return json({ ok: true });
  }
  if (method === 'GET' && url.pathname === '/__fixture/calls')
    return json({
      requests: { ...state.requests },
      charges: { ...state.charges },
      refundRequests: { ...state.refundRequests },
      refunds: { ...state.refunds },
    });
  const tossCancel = /^\/toss\/v1\/payments\/([A-Za-z0-9_-]+)\/cancel$/.exec(
    url.pathname,
  );
  const tossQuery = /^\/toss\/v1\/payments\/([A-Za-z0-9_-]+)$/.exec(
    url.pathname,
  );
  if ((tossCancel && method === 'POST') || (tossQuery && method === 'GET')) {
    assert.equal(url.search, '');
    assert.equal(
      headers.authorization,
      `Basic ${Buffer.from(`${ENROLLMENT_CI.tossSecretKey}:`).toString('base64')}`,
    );
    const key = (tossCancel ?? tossQuery)[1];
    const payment = [...state.tossOrders.values()].find(
      (value) => value.paymentKey === key,
    );
    assert.ok(payment);
    if (tossQuery) {
      state.refundRequests.tossQuery += 1;
      return state.scenario === 'refund-query-unavailable'
        ? json(
            { code: 'NOT_FOUND_PAYMENT', message: 'Fictional fixture.' },
            404,
          )
        : json(payment);
    }
    state.refundRequests.tossCancel += 1;
    assert.match(headers['idempotency-key'], UUID);
    assert.equal(marker(body.cancelReason), headers['idempotency-key']);
    assert.deepEqual(Object.keys(body).sort(), [
      'cancelAmount',
      'cancelReason',
      'currency',
      'refundableAmount',
      'taxFreeAmount',
    ]);
    assert.equal(body.currency, 'KRW');
    assert.equal(body.taxFreeAmount, 0);
    const operation = `${key}:${headers['idempotency-key']}`;
    const prior = state.refundOperations.get(operation);
    if (prior) {
      assert.deepEqual(body, prior.input);
      return json(prior.output);
    }
    assert.equal(body.refundableAmount, payment.balanceAmount);
    assert.ok(amount(body.cancelAmount) <= payment.balanceAmount);
    if (state.scenario === 'refund-reject')
      return json(
        { code: 'INVALID_REFUND_AMOUNT', message: 'Fictional fixture.' },
        400,
      );
    const action = {
      transactionKey: `ci_cancel_${randomUUID()}`,
      cancelReason: body.cancelReason,
      cancelAmount: body.cancelAmount,
      taxFreeAmount: 0,
      taxExemptionAmount: 0,
      refundableAmount: payment.balanceAmount - body.cancelAmount,
      canceledAt: new Date().toISOString(),
      cancelStatus: 'DONE',
    };
    const output = {
      ...payment,
      balanceAmount: action.refundableAmount,
      status: action.refundableAmount ? 'PARTIAL_CANCELED' : 'CANCELED',
      lastTransactionKey: action.transactionKey,
      cancels: [...(payment.cancels ?? []), action],
    };
    state.tossOrders.set(payment.orderId, output);
    state.refundOperations.set(operation, { input: body, output });
    state.refunds.toss += 1;
    return state.scenario === 'refund-response-lost'
      ? { lost: true }
      : { ...json(output), hold: state.scenario === 'hold-refund' };
  }
  const kakaoCancel = url.pathname === '/kakaopay/online/v1/payment/cancel';
  const kakaoQuery = url.pathname === '/kakaopay/online/v1/payment/order';
  if (
    kakaoCancel ||
    (kakaoQuery && state.kakaoOrders.get(body.tid)?.refundActions)
  ) {
    assert.equal(method, 'POST');
    assert.equal(url.search, '');
    assert.equal(
      headers.authorization,
      `SECRET_KEY ${ENROLLMENT_CI.kakaoSecretKey}`,
    );
    assert.equal(headers['idempotency-key'], undefined);
    assert.equal(body.cid, ENROLLMENT_CI.kakaoCid);
    assert.ok(!body.cid_secret);
    const order = state.kakaoOrders.get(body.tid);
    assert.ok(order?.approval);
    if (kakaoQuery) {
      state.refundRequests.kakaoQuery += 1;
      assert.deepEqual(Object.keys(body).sort(), ['cid', 'tid']);
      return state.scenario === 'refund-query-unavailable'
        ? json({ error_code: -1, error_message: 'Fictional fixture.' }, 503)
        : json({
            ...kakaoProjection(order),
            payment_action_details: [
              {
                aid: order.approval.aid,
                payment_action_type: 'PAYMENT',
                amount: order.approval.amount.total,
                approved_at: order.approval.approved_at,
              },
              ...order.refundActions,
            ],
          });
    }
    state.refundRequests.kakaoCancel += 1;
    marker(body.payload);
    assert.deepEqual(Object.keys(body).sort(), [
      'cancel_amount',
      'cancel_available_amount',
      'cancel_tax_free_amount',
      'cid',
      'payload',
      'tid',
    ]);
    assert.equal(body.cancel_tax_free_amount, 0);
    const before = kakaoProjection(order);
    assert.equal(
      body.cancel_available_amount,
      before.cancel_available_amount.total,
    );
    assert.ok(
      amount(body.cancel_amount) <= before.cancel_available_amount.total,
    );
    if (state.scenario === 'refund-reject')
      return json({ error_code: -1, error_message: 'Fictional fixture.' }, 400);
    // Deliberately NO merchant payload deduplication: a repeated dispatch must
    // remain visible rather than granting undocumented provider idempotency.
    const action = {
      aid: `ci_cancel_${randomUUID()}`,
      payment_action_type: 'CANCEL',
      amount: body.cancel_amount,
      approved_at: new Date().toISOString(),
      payload: body.payload,
    };
    order.refundActions = [...(order.refundActions ?? []), action];
    state.refunds.kakao += 1;
    const output = {
      ...kakaoProjection(order),
      aid: action.aid,
      payload: action.payload,
      approved_cancel_amount: { total: action.amount, tax_free: 0 },
      canceled_at: action.approved_at,
    };
    return state.scenario === 'refund-response-lost'
      ? { lost: true }
      : { ...json(output), hold: state.scenario === 'hold-refund' };
  }
  return fixtureResponse(state, request);
}

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    assert.ok(size <= BODY_LIMIT);
    chunks.push(chunk);
  }
  return size ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
}
export function startCancellationFixtureProvider(input = process.env) {
  assert.equal(parseCancellationTestRuntime(input).mode, 'ci');
  const state = createCancellationFixtureState();
  const heldReplies = new Set();
  const server = createServer(async (request, response) => {
    try {
      assert.equal(request.socket.remoteAddress, '127.0.0.1');
      assert.equal(request.headers.host, `127.0.0.1:${FIXTURE_PORT}`);
      assert.ok(
        !request.headers.origin ||
          request.headers.origin === ENROLLMENT_CI.appOrigin,
      );
      const result = cancellationFixtureResponse(state, {
        method: request.method,
        path: request.url,
        headers: request.headers,
        body: await readBody(request),
      });
      if (result.release) {
        for (const release of heldReplies) release();
        heldReplies.clear();
      }
      if (result.hold)
        await new Promise((resolve) => {
          const release = () => {
            heldReplies.delete(release);
            resolve();
          };
          heldReplies.add(release);
          response.once('close', release);
        });
      if (result.lost) {
        request.socket.destroy();
        return;
      }
      response.writeHead(result.status, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        'Referrer-Policy': 'no-referrer',
      });
      response.end(JSON.stringify(result.body));
    } catch {
      response.writeHead(400, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ error: 'FIXTURE_REQUEST_REJECTED' }));
    }
  });
  server.listen(FIXTURE_PORT, '127.0.0.1');
  return server;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const server = startCancellationFixtureProvider();
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.once(signal, () => server.close());
}
