import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import {
  createCancellationFixtureState,
  cancellationFixtureResponse,
} from './cancellation-local-ci-provider.mjs';
import {
  ENROLLMENT_CI,
  parseReconciliationTestRuntime,
} from '../src/config/enrollment-test-runtime.ts';

const BODY_LIMIT = 16_384;
const FIXTURE_PORT = 3_200;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const createReconciliationFixtureState = createCancellationFixtureState;

// The notification helper returns only an existing fictional Payment object.
// It neither invents a settled result nor increments financial/provider counts.
// A real Toss billing approval does NOT emit this webhook; tests explicitly
// submit an untrusted forged hint to prove it cannot establish financial truth.
export function reconciliationFixtureResponse(state, request) {
  const url = new URL(request.path, ENROLLMENT_CI.providerOrigin);
  if (request.method === 'POST' && url.pathname === '/__fixture/toss-event') {
    assert.equal(url.search, '');
    assert.deepEqual(Object.keys(request.body), ['orderId']);
    assert.match(request.body.orderId, UUID);
    const payment = state.tossOrders.get(request.body.orderId);
    assert.ok(payment);
    return {
      status: 200,
      body: {
        eventType: 'PAYMENT_STATUS_CHANGED',
        createdAt: new Date().toISOString(),
        data: { ...payment },
      },
    };
  }
  if (
    request.method === 'POST' &&
    url.pathname === '/__fixture/scenario' &&
    ['hold-query', 'all-queries-unavailable'].includes(request.body.scenario)
  ) {
    assert.equal(url.search, '');
    assert.deepEqual(Object.keys(request.body), ['scenario']);
    state.scenario = request.body.scenario;
    return { status: 200, body: { ok: true } };
  }
  const query =
    (request.method === 'GET' &&
      url.pathname.startsWith('/toss/v1/payments/')) ||
    (request.method === 'POST' &&
      url.pathname === '/kakaopay/online/v1/payment/order');
  const result = cancellationFixtureResponse(state, request);
  if (query && state.scenario === 'all-queries-unavailable')
    return { status: 503, body: { error: 'FICTIONAL_QUERY_UNAVAILABLE' } };
  return query && state.scenario === 'hold-query'
    ? { ...result, hold: true }
    : result;
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
export function startReconciliationFixtureProvider(input = process.env) {
  assert.equal(parseReconciliationTestRuntime(input).mode, 'ci');
  const state = createReconciliationFixtureState();
  const heldReplies = new Set();
  const server = createServer(async (request, response) => {
    try {
      assert.equal(request.socket.remoteAddress, '127.0.0.1');
      assert.equal(request.headers.host, `127.0.0.1:${FIXTURE_PORT}`);
      assert.ok(
        !request.headers.origin ||
          request.headers.origin === ENROLLMENT_CI.appOrigin,
      );
      const result = reconciliationFixtureResponse(state, {
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
  const server = startReconciliationFixtureProvider();
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.once(signal, () => server.close());
}
