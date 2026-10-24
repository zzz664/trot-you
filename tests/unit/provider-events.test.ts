// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PROVIDER_EVENT_BODY_LIMIT_BYTES,
  PROVIDER_EVENT_BODY_TIMEOUT_MS,
  PROVIDER_EVENT_MAX_CHUNKS,
  PROVIDER_EVENT_TRANSMISSION_ID_MAX_LENGTH,
  TOSS_PROVIDER_EVENT_TRANSMISSION_HEADER,
} from '@/config/provider-events';
import { parseTossProviderEvent } from '@/server/adapters/payment/provider-events';
import { readTossProviderEvent } from '@/server/provider-events/security';

const transmission = 'fictional-transmission-1';
const body = {
  eventType: 'PAYMENT_STATUS_CHANGED',
  createdAt: '2026-10-24T12:00:00.123456',
  data: {
    mId: 'fictional-mid',
    orderId: 'a1900000-0000-4000-8000-000000000001',
    paymentKey: 'fictional-payment',
    lastTransactionKey: 'fictional-transaction',
    type: 'BILLING',
    method: '카드',
    currency: 'KRW',
    status: 'DONE',
    totalAmount: 6500,
    balanceAmount: 6500,
    taxFreeAmount: 0,
    taxExemptionAmount: 0,
    card: { number: 'discard-private-card' },
    customerName: 'discard-private-name',
    secret: 'discard-private-secret',
    cancels: [{ cancelReason: 'discard-private-reason' }],
  },
};
const payment = (overrides: Record<string, unknown>) => ({
  ...body,
  data: { ...body.data, ...overrides },
});
function request(
  payload: string | Uint8Array | ReadableStream<Uint8Array> = JSON.stringify(
    body,
  ),
  headers: Record<string, string> = {},
  signal?: AbortSignal,
) {
  return new Request('https://app.example.test/provider-fixture', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      [TOSS_PROVIDER_EVENT_TRANSMISSION_HEADER]: transmission,
      ...headers,
    },
    body: payload,
    duplex: 'half',
    ...(signal ? { signal } : {}),
  } as RequestInit);
}
afterEach(() => vi.useRealTimers());

describe('untrusted Toss notification projection', () => {
  it('projects only a bounded advisory hint, never provider verification or PII', () => {
    const parsed = parseTossProviderEvent(body, transmission);
    expect(parsed).toEqual({
      ok: true,
      data: {
        provider: 'toss',
        trust: 'unverified',
        eventType: 'PAYMENT_STATUS_CHANGED',
        transmissionId: transmission,
        semanticKey: expect.stringMatching(/^[a-f0-9]{64}$/),
        orderId: body.data.orderId,
        providerPaymentId: body.data.paymentKey,
        providerTransactionId: body.data.lastTransactionKey,
        merchantAccount: body.data.mId,
        status: 'DONE',
        totalAmountKrw: 6500,
        balanceAmountKrw: 6500,
        createdAt: body.createdAt,
      },
    });
    expect(JSON.stringify(parsed)).not.toContain('discard-private');
    expect(JSON.stringify(parsed)).not.toContain('card');
    expect(JSON.stringify(parsed)).not.toContain('secret');
  });
  it.each([
    ['DONE', 6500],
    ['CANCELED', 0],
    ['PARTIAL_CANCELED', 3500],
  ])('accepts only supported status/balance shape %s', (status, balance) => {
    expect(
      parseTossProviderEvent(
        payment({ status, balanceAmount: balance }),
        transmission,
      ).ok,
    ).toBe(true);
  });
  it.each([
    'READY',
    'IN_PROGRESS',
    'ABORTED',
    'EXPIRED',
    'WAITING_FOR_DEPOSIT',
    'APPROVED',
    'done',
    '',
  ])('rejects unsupported status %s', (status) => {
    expect(parseTossProviderEvent(payment({ status }), transmission)).toEqual({
      ok: false,
      code: 'INVALID_INPUT',
    });
  });
  it.each([
    'BILLING_DELETED',
    'CANCEL_STATUS_CHANGED',
    'DEPOSIT_CALLBACK',
    'payout.changed',
    'seller.changed',
    'KAKAOPAY_PAYMENT',
  ])(
    'rejects unsupported event %s without retaining its payload',
    (eventType) => {
      expect(
        parseTossProviderEvent(
          { eventType, data: { billingKey: 'private-key', secret: 'private' } },
          transmission,
        ),
      ).toEqual({ ok: false, code: 'UNSUPPORTED_EVENT' });
    },
  );
  it.each([null, undefined, {}, [], 'payment', 1, { eventType: null }])(
    'rejects malformed envelope %#',
    (input) => {
      expect(parseTossProviderEvent(input, transmission)).toEqual({
        ok: false,
        code: 'INVALID_INPUT',
      });
    },
  );
  it.each([
    { type: 'NORMAL' },
    { type: 'KEYIN' },
    { method: '간편결제' },
    { method: '가상계좌' },
    { currency: 'USD' },
    { mId: '' },
    { mId: 'x'.repeat(101) },
    { mId: 'private name' },
    { orderId: 'unallocated-order' },
    { paymentKey: '' },
    { paymentKey: 'private key' },
    { paymentKey: 'x'.repeat(201) },
    { lastTransactionKey: 'with/slash' },
    { lastTransactionKey: undefined },
    { totalAmount: 0 },
    { totalAmount: -1 },
    { totalAmount: 1.1 },
    { totalAmount: 2_147_483_648 },
    { totalAmount: '6500' },
    { balanceAmount: -1 },
    { balanceAmount: 6501 },
    { balanceAmount: 0 },
    { balanceAmount: 6500.1 },
    { taxFreeAmount: 1 },
    { taxExemptionAmount: 1 },
    { status: 'CANCELED', balanceAmount: 1 },
    { status: 'PARTIAL_CANCELED', balanceAmount: 0 },
    { status: 'PARTIAL_CANCELED', balanceAmount: 6500 },
  ])('rejects invalid payment projection %#', (overrides) => {
    expect(parseTossProviderEvent(payment(overrides), transmission)).toEqual({
      ok: false,
      code: 'INVALID_INPUT',
    });
  });
  it('accepts documented nullable transaction identity without inventing one', () => {
    const result = parseTossProviderEvent(
      payment({ lastTransactionKey: null }),
      transmission,
    );
    expect(result.ok && result.data.providerTransactionId).toBeNull();
  });
  it.each([
    '2026-10-24T12:00:00',
    '2026-10-24T12:00:00.123456',
    '2026-10-24T12:00:00Z',
    '2026-10-24T12:00:00+09:00',
  ])(
    'preserves valid createdAt as untrusted opaque metadata %s',
    (createdAt) => {
      const result = parseTossProviderEvent(
        { ...body, createdAt },
        transmission,
      );
      expect(result.ok && result.data.createdAt).toBe(createdAt);
    },
  );
  it.each(['', 'yesterday', '2026-02-30T12:00:00', 'x'.repeat(41), null])(
    'rejects invalid timestamp %#',
    (createdAt) => {
      expect(
        parseTossProviderEvent({ ...body, createdAt }, transmission),
      ).toEqual({ ok: false, code: 'INVALID_INPUT' });
    },
  );
  it.each([
    null,
    '',
    'private identity',
    'first,second',
    'first\nsecond',
    '한글',
    'x'.repeat(PROVIDER_EVENT_TRANSMISSION_ID_MAX_LENGTH + 1),
  ])('rejects absent/unsafe transmission IDs %#', (id) => {
    expect(parseTossProviderEvent(body, id)).toEqual({
      ok: false,
      code: 'INVALID_INPUT',
    });
  });
  it('coalesces redeliveries/spoofable details to the known order/status identity', () => {
    const first = parseTossProviderEvent(body, transmission);
    const second = parseTossProviderEvent(
      {
        ...payment({
          paymentKey: 'other-payment',
          lastTransactionKey: 'other-transaction',
          totalAmount: 7000,
          balanceAmount: 7000,
        }),
        createdAt: '2026-10-25T12:00:00',
      },
      'other-transmission',
    );
    expect(first.ok && second.ok && first.data.semanticKey).toBe(
      second.ok && second.data.semanticKey,
    );
  });
  it.each([
    { mId: 'other-mid' },
    { orderId: 'a1900000-0000-4000-8000-000000000002' },
    { status: 'CANCELED', balanceAmount: 0 },
  ])(
    'isolates the semantic key by authoritative lookup dimensions %#',
    (overrides) => {
      const first = parseTossProviderEvent(body, transmission);
      const second = parseTossProviderEvent(payment(overrides), transmission);
      expect(first.ok && second.ok && first.data.semanticKey).not.toBe(
        second.ok && second.data.semanticKey,
      );
    },
  );
});

describe('bounded incoming provider body', () => {
  it('reads a JSON request and preserves the explicit untrusted label', async () => {
    const result = await readTossProviderEvent(request());
    expect(result.ok && result.data.trust).toBe('unverified');
  });
  it('does not treat a fabricated signature header as authentication', async () => {
    const result = await readTossProviderEvent(
      request(JSON.stringify(body), {
        'tosspayments-webhook-signature': 'v1:fake',
      }),
    );
    expect(result.ok && result.data.trust).toBe('unverified');
  });
  it('accepts a correct byte length and case-insensitive JSON media type', async () => {
    const payload = JSON.stringify(body);
    expect(
      (
        await readTossProviderEvent(
          request(payload, {
            'content-type': 'Application/JSON; charset=utf-8',
            'content-length': String(Buffer.byteLength(payload)),
            'content-encoding': 'identity',
          }),
        )
      ).ok,
    ).toBe(true);
  });
  it.each([
    { 'content-type': 'text/plain' },
    { 'content-type': '' },
    { 'content-encoding': 'gzip' },
    { 'content-encoding': 'br' },
    { 'content-length': '-1' },
    { 'content-length': '1.1' },
    { 'content-length': '2e3' },
    { 'content-length': '9007199254740992' },
    { 'content-length': '1,1' },
    { 'content-length': '0' },
    { [TOSS_PROVIDER_EVENT_TRANSMISSION_HEADER]: '' },
    { [TOSS_PROVIDER_EVENT_TRANSMISSION_HEADER]: 'one,two' },
  ])('rejects unsafe request headers %#', async (headers) => {
    expect(
      await readTossProviderEvent(request(JSON.stringify(body), headers)),
    ).toEqual({ ok: false, code: 'INVALID_INPUT' });
  });
  it('rejects absent transmission ID before consuming the body', async () => {
    const cancel = vi.fn();
    const req = request(new ReadableStream({ cancel }));
    req.headers.delete(TOSS_PROVIDER_EVENT_TRANSMISSION_HEADER);
    expect(await readTossProviderEvent(req)).toEqual({
      ok: false,
      code: 'INVALID_INPUT',
    });
    expect(req.bodyUsed).toBe(false);
  });
  it('rejects an advertised oversized body without buffering it', async () => {
    const req = request(new ReadableStream(), {
      'content-length': String(PROVIDER_EVENT_BODY_LIMIT_BYTES + 1),
    });
    expect(await readTossProviderEvent(req)).toEqual({
      ok: false,
      code: 'PAYLOAD_TOO_LARGE',
    });
    expect(req.bodyUsed).toBe(false);
  });
  it('rejects an oversized actual UTF-8 body even without Content-Length', async () => {
    expect(
      await readTossProviderEvent(
        request('가'.repeat(PROVIDER_EVENT_BODY_LIMIT_BYTES / 2)),
      ),
    ).toEqual({ ok: false, code: 'PAYLOAD_TOO_LARGE' });
  });
  it('accepts exactly the size bound, rejecting one additional byte', async () => {
    const payload = JSON.stringify(body);
    const padded = payload.padEnd(
      PROVIDER_EVENT_BODY_LIMIT_BYTES -
        (Buffer.byteLength(payload) - payload.length),
    );
    expect(Buffer.byteLength(padded)).toBe(PROVIDER_EVENT_BODY_LIMIT_BYTES);
    expect((await readTossProviderEvent(request(padded))).ok).toBe(true);
    expect(await readTossProviderEvent(request(padded + ' '))).toEqual({
      ok: false,
      code: 'PAYLOAD_TOO_LARGE',
    });
  });
  it('counts bytes across chunks and cancels an oversized source', async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(PROVIDER_EVENT_BODY_LIMIT_BYTES));
        controller.enqueue(new Uint8Array(1));
      },
      cancel,
    });
    expect(await readTossProviderEvent(request(stream))).toEqual({
      ok: false,
      code: 'PAYLOAD_TOO_LARGE',
    });
    expect(cancel).toHaveBeenCalledOnce();
  });
  it('accepts exactly the bounded number of chunks including empty chunks', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let index = 1; index < PROVIDER_EVENT_MAX_CHUNKS; index += 1)
          controller.enqueue(new Uint8Array(0));
        controller.enqueue(new TextEncoder().encode(JSON.stringify(body)));
        controller.close();
      },
    });
    expect((await readTossProviderEvent(request(stream))).ok).toBe(true);
  });
  it('bounds an endless immediate empty-chunk stream without relying on the timer', async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    const pull = vi.fn(
      (controller: ReadableStreamDefaultController<Uint8Array>) => {
        controller.enqueue(new Uint8Array(0));
      },
    );
    expect(
      await readTossProviderEvent(
        request(new ReadableStream<Uint8Array>({ pull, cancel })),
      ),
    ).toEqual({ ok: false, code: 'INVALID_INPUT' });
    expect(pull.mock.calls.length).toBeGreaterThan(PROVIDER_EVENT_MAX_CHUNKS);
    expect(pull.mock.calls.length).toBeLessThanOrEqual(
      PROVIDER_EVENT_MAX_CHUNKS + 2,
    );
    expect(cancel).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each(['', 'invalid json', '{}', 'null', '[]', '{'])(
    'rejects malformed body %#',
    async (value) => {
      expect(await readTossProviderEvent(request(value))).toEqual({
        ok: false,
        code: 'INVALID_INPUT',
      });
    },
  );
  it('rejects invalid UTF-8 rather than replacing input bytes', async () => {
    expect(
      await readTossProviderEvent(request(new Uint8Array([0xc3, 0x28]))),
    ).toEqual({ ok: false, code: 'INVALID_INPUT' });
  });
  it('bounds a never-ending body to one second and cancels it', async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    const pending = readTossProviderEvent(
      request(new ReadableStream({ cancel })),
    );
    await vi.advanceTimersByTimeAsync(PROVIDER_EVENT_BODY_TIMEOUT_MS);
    expect(await pending).toEqual({ ok: false, code: 'INVALID_INPUT' });
    expect(cancel).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('bounds a source whose cancel promise never settles', async () => {
    vi.useFakeTimers();
    const pending = readTossProviderEvent(
      request(
        new ReadableStream({
          cancel: () => new Promise(() => undefined),
        }),
      ),
    );
    await vi.advanceTimersByTimeAsync(PROVIDER_EVENT_BODY_TIMEOUT_MS);
    expect(await pending).toEqual({ ok: false, code: 'INVALID_INPUT' });
  });
  it('rejects read failures without exposing an exception', async () => {
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new Error('private failure body with credentials'));
      },
    });
    expect(await readTossProviderEvent(request(stream))).toEqual({
      ok: false,
      code: 'INVALID_INPUT',
    });
  });
  it('rejects an already locked body without throwing out of the boundary', async () => {
    const req = request();
    const reader = req.body?.getReader();
    expect(await readTossProviderEvent(req)).toEqual({
      ok: false,
      code: 'INVALID_INPUT',
    });
    reader?.releaseLock();
  });
  it('rejects an already-aborted request', async () => {
    const controller = new AbortController();
    controller.abort();
    expect(
      await readTossProviderEvent(
        request(JSON.stringify(body), {}, controller.signal),
      ),
    ).toEqual({ ok: false, code: 'INVALID_INPUT' });
  });
  it('cancels a request aborted during the read', async () => {
    const controller = new AbortController();
    const cancel = vi.fn();
    const pending = readTossProviderEvent(
      request(new ReadableStream({ cancel }), {}, controller.signal),
    );
    controller.abort();
    expect(await pending).toEqual({ ok: false, code: 'INVALID_INPUT' });
    expect(cancel).toHaveBeenCalledOnce();
  });
  it('rejects body-less and non-POST requests', async () => {
    for (const method of ['GET', 'HEAD', 'POST']) {
      expect(
        await readTossProviderEvent(
          new Request('https://app.example.test/provider-fixture', {
            method,
            headers: {
              'content-type': 'application/json',
              [TOSS_PROVIDER_EVENT_TRANSMISSION_HEADER]: transmission,
            },
          }),
        ),
      ).toEqual({ ok: false, code: 'INVALID_INPUT' });
    }
  });
});
