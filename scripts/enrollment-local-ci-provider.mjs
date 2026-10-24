import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import {
  ENROLLMENT_CI,
  parseEnrollmentTestRuntime,
} from '../src/config/enrollment-test-runtime.ts';

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SCENARIOS = new Set([
  'success',
  'reject',
  'exchange-response-lost',
  'charge-response-lost',
  'approve-response-lost',
  'ready-response-lost',
  'slow-charge',
]);
const BODY_LIMIT = 16_384;
const SLOW_CHARGE_MS = 1_000;
const FIXTURE_PORT = 3_200;

export function createFixtureState() {
  return {
    scenario: 'success',
    requests: {
      tossIssue: 0,
      tossCharge: 0,
      tossQuery: 0,
      kakaoReady: 0,
      kakaoApprove: 0,
      kakaoQuery: 0,
    },
    charges: { toss: 0, kakao: 0 },
    tossOperations: new Map(),
    tossOrders: new Map(),
    kakaoOrders: new Map(),
  };
}

function callback(value) {
  const url = new URL(value);
  assert.equal(url.origin, ENROLLMENT_CI.appOrigin);
  assert.equal(url.pathname, '/api/checkout/return');
  assert.equal(url.username, '');
  assert.equal(url.password, '');
  assert.equal(url.hash, '');
  return url.href;
}

function identity(body) {
  assert.match(body.partner_order_id, UUID);
  assert.match(body.partner_user_id, UUID);
  assert.equal(body.cid, ENROLLMENT_CI.kakaoCid);
  assert.ok(!body.cid_secret);
}

function amount(value) {
  assert.ok(Number.isSafeInteger(value) && value > 0);
  return value;
}

// This is a deliberately adversarial local HTTP fixture, not a provider mock
// shipped as an integration. Kakao has no artificial order/idempotency dedupe.
export function fixtureResponse(state, request) {
  const { method, path, headers, body } = request;
  const url = new URL(path, ENROLLMENT_CI.providerOrigin);
  const json = (value, status = 200) => ({ status, body: value });
  if (method === 'GET' && url.pathname === '/__fixture/health')
    return json({ ok: true, kind: 'ci-only-fake-provider' });
  if (method === 'POST' && url.pathname === '/__fixture/reset') {
    Object.assign(state, createFixtureState());
    return json({ ok: true });
  }
  if (method === 'POST' && url.pathname === '/__fixture/scenario') {
    assert.deepEqual(Object.keys(body), ['scenario']);
    assert.ok(SCENARIOS.has(body.scenario));
    state.scenario = body.scenario;
    return json({ ok: true });
  }
  if (method === 'GET' && url.pathname === '/__fixture/calls')
    // Counts only. No request bodies, authorization, keys, tokens or identities.
    return json({
      requests: { ...state.requests },
      charges: { ...state.charges },
    });
  if (method === 'GET' && url.pathname === '/__fixture/handoff') {
    const order = state.kakaoOrders.get(url.searchParams.get('tid'));
    assert.ok(order);
    return json({
      approvalUrl: order.approval_url,
      cancelUrl: order.cancel_url,
      failureUrl: order.fail_url,
      pgToken: `ci_pg_${order.tid}`,
    });
  }
  assert.equal(url.search, '');
  if (url.pathname.startsWith('/toss/')) {
    assert.equal(
      headers.authorization,
      `Basic ${Buffer.from(`${ENROLLMENT_CI.tossSecretKey}:`).toString('base64')}`,
    );
    if (method === 'GET') {
      assert.match(url.pathname, /^\/toss\/v1\/payments\/orders\/[a-f0-9-]+$/i);
      state.requests.tossQuery += 1;
      const payment = state.tossOrders.get(url.pathname.split('/').at(-1));
      return payment
        ? json(payment)
        : json(
            { code: 'NOT_FOUND_PAYMENT', message: 'Fictional fixture.' },
            404,
          );
    }
    assert.equal(method, 'POST');
    assert.match(headers['idempotency-key'], UUID);
    const key = `${url.pathname}:${headers['idempotency-key']}`;
    const issued = url.pathname === '/toss/v1/billing/authorizations/issue';
    if (issued) state.requests.tossIssue += 1;
    else state.requests.tossCharge += 1;
    const prior = state.tossOperations.get(key);
    if (prior) {
      assert.deepEqual(prior.input, body);
      return json(prior.output);
    }
    assert.match(body.customerKey, UUID);
    if (issued) {
      assert.equal(body.authKey, `ci_auth_${body.customerKey}`);
      const output = {
        mId: ENROLLMENT_CI.tossMid,
        customerKey: body.customerKey,
        billingKey: `ci_billing_${body.customerKey}`,
        method: '카드',
        authenticatedAt: new Date().toISOString(),
      };
      state.tossOperations.set(key, { input: body, output });
      return state.scenario === 'exchange-response-lost'
        ? { lost: true }
        : json(output);
    }
    assert.equal(
      url.pathname,
      `/toss/v1/billing/ci_billing_${body.customerKey}`,
    );
    assert.match(body.orderId, UUID);
    amount(body.amount);
    assert.equal(body.taxFreeAmount, 0);
    if (state.scenario === 'reject')
      return json(
        { code: 'REJECT_CARD_PAYMENT', message: 'Fictional fixture.' },
        400,
      );
    state.charges.toss += 1;
    const output = {
      mId: ENROLLMENT_CI.tossMid,
      type: 'BILLING',
      orderId: body.orderId,
      status: 'DONE',
      currency: 'KRW',
      totalAmount: body.amount,
      taxFreeAmount: 0,
      taxExemptionAmount: 0,
      balanceAmount: body.amount,
      approvedAt: new Date().toISOString(),
      paymentKey: `ci_payment_${body.orderId}`,
      lastTransactionKey: `ci_transaction_${body.orderId}`,
      method: '카드',
    };
    state.tossOperations.set(key, { input: body, output });
    state.tossOrders.set(body.orderId, output);
    return state.scenario === 'charge-response-lost'
      ? { lost: true }
      : {
          ...json(output),
          delay: state.scenario === 'slow-charge' ? SLOW_CHARGE_MS : 0,
        };
  }
  assert.equal(
    headers.authorization,
    `SECRET_KEY ${ENROLLMENT_CI.kakaoSecretKey}`,
  );
  assert.equal(headers['idempotency-key'], undefined);
  assert.equal(method, 'POST');
  assert.equal(body.cid, ENROLLMENT_CI.kakaoCid);
  if (url.pathname === '/kakaopay/online/v1/payment/ready') {
    state.requests.kakaoReady += 1;
    identity(body);
    amount(body.total_amount);
    assert.equal(body.tax_free_amount, 0);
    const tid = `ci_tid_${state.requests.kakaoReady}`;
    state.kakaoOrders.set(tid, {
      ...body,
      tid,
      approval_url: callback(body.approval_url),
      cancel_url: callback(body.cancel_url),
      fail_url: callback(body.fail_url),
    });
    return state.scenario === 'ready-response-lost'
      ? { lost: true }
      : json({
          tid,
          // Fixture-only marker distinguishes opaque provider URLs for E2E.
          // Production passes returned URLs unchanged and requires no device query.
          next_redirect_mobile_url: `https://online-pay.kakao.com/ci-enrollment?tid=${tid}&device=mobile`,
          next_redirect_pc_url: `https://online-pay.kakao.com/ci-enrollment?tid=${tid}&device=desktop`,
        });
  }
  const order = state.kakaoOrders.get(body.tid);
  assert.ok(order);
  if (url.pathname === '/kakaopay/online/v1/payment/order') {
    state.requests.kakaoQuery += 1;
    if (!order.approval)
      return json({ tid: order.tid, cid: body.cid, status: 'READY' });
    const approval = { ...order.approval };
    delete approval.sid;
    return json({
      ...approval,
      status: 'SUCCESS_PAYMENT',
      canceled_amount: { total: 0 },
      payment_action_details: [
        {
          aid: approval.aid,
          payment_action_type: 'PAYMENT',
          amount: approval.amount.total,
          approved_at: approval.approved_at,
        },
      ],
    });
  }
  assert.equal(url.pathname, '/kakaopay/online/v1/payment/approve');
  state.requests.kakaoApprove += 1;
  identity(body);
  assert.equal(body.partner_order_id, order.partner_order_id);
  assert.equal(body.partner_user_id, order.partner_user_id);
  assert.equal(body.pg_token, `ci_pg_${order.tid}`);
  assert.equal(body.total_amount, order.total_amount);
  if (state.scenario === 'reject')
    return json({ error_code: -701, error_message: 'Fictional fixture.' }, 400);
  state.charges.kakao += 1;
  const output = {
    cid: body.cid,
    tid: order.tid,
    aid: `ci_aid_${state.charges.kakao}`,
    sid: `ci_sid_${order.tid}`,
    partner_order_id: order.partner_order_id,
    partner_user_id: order.partner_user_id,
    payment_method_type: 'CARD',
    amount: { total: order.total_amount, tax_free: 0 },
    approved_at: new Date().toISOString(),
  };
  order.approval = output;
  return state.scenario === 'approve-response-lost'
    ? { lost: true }
    : {
        ...json(output),
        delay: state.scenario === 'slow-charge' ? SLOW_CHARGE_MS : 0,
      };
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

export function startFixtureProvider(input = process.env) {
  assert.equal(parseEnrollmentTestRuntime(input).mode, 'ci');
  const state = createFixtureState();
  const server = createServer(async (request, response) => {
    try {
      assert.equal(request.socket.remoteAddress, '127.0.0.1');
      assert.equal(request.headers.host, `127.0.0.1:${FIXTURE_PORT}`);
      assert.ok(
        !request.headers.origin ||
          request.headers.origin === ENROLLMENT_CI.appOrigin,
      );
      const result = fixtureResponse(state, {
        method: request.method,
        path: request.url,
        headers: request.headers,
        body: await readBody(request),
      });
      if (result.lost) {
        request.socket.destroy();
        return;
      }
      if (result.delay)
        await new Promise((resolve) => setTimeout(resolve, result.delay));
      response.writeHead(result.status, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        'Referrer-Policy': 'no-referrer',
      });
      response.end(JSON.stringify(result.body));
    } catch {
      // Never print assertion inputs: they may contain test callback tokens.
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
  const server = startFixtureProvider();
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.once(signal, () => server.close());
}
