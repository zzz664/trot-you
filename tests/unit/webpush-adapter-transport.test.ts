// @vitest-environment node
import { EventEmitter } from 'node:events';
import type { IncomingMessage, RequestOptions } from 'node:http';
import type { RequestOptions as HttpsRequestOptions } from 'node:https';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sendPinnedWebPushRequest } from '@/server/adapters/notification/transport';
import type { WebPushHttpRequest } from '@/server/adapters/notification/types';
import { SYNTHETIC_PUSH_MESSAGE } from './webpush-adapter-fixtures';

const network = vi.hoisted(() => ({ lookup: vi.fn(), request: vi.fn() }));
vi.mock('node:dns/promises', () => ({ lookup: network.lookup }));
vi.mock('node:https', () => ({ request: network.request }));

const input: WebPushHttpRequest = {
  endpoint: SYNTHETIC_PUSH_MESSAGE.endpoint,
  headers: { authorization: 'synthetic-vapid', 'content-length': '1' },
  body: Buffer.from('x'),
  timeoutMs: 25,
};
let outgoing: EventEmitter & {
  end: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
};
let options: HttpsRequestOptions;
let onResponse: (incoming: IncomingMessage) => void;

beforeEach(() => {
  vi.useFakeTimers();
  network.lookup
    .mockReset()
    .mockResolvedValue([{ address: '8.8.8.8', family: 4 }]);
  outgoing = Object.assign(new EventEmitter(), {
    end: vi.fn(),
    destroy: vi.fn(),
  });
  network.request
    .mockReset()
    .mockImplementation(
      (
        _url: URL,
        requestOptions: HttpsRequestOptions,
        response: typeof onResponse,
      ) => {
        options = requestOptions;
        onResponse = response;
        return outgoing;
      },
    );
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

function response(status?: number, retryAfter?: string) {
  const incoming = Object.assign(new EventEmitter(), {
    statusCode: status,
    headers: retryAfter ? { 'retry-after': retryAfter } : {},
    destroy: vi.fn(),
  });
  onResponse(incoming as unknown as IncomingMessage);
  return incoming;
}

describe('production HTTPS Web Push transport', () => {
  it('resolves once, pins an approved public address, preserves TLS hostname and destroys unread body', async () => {
    const result = sendPinnedWebPushRequest(input);
    await vi.advanceTimersByTimeAsync(0);
    expect(network.lookup).toHaveBeenCalledExactlyOnceWith(
      'fcm.googleapis.com',
      { all: true, verbatim: true },
    );
    expect(network.request).toHaveBeenCalledTimes(1);
    expect(network.request.mock.calls[0]?.[0].href).toBe(input.endpoint);
    expect(options).toMatchObject({
      method: 'POST',
      agent: false,
      servername: 'fcm.googleapis.com',
      rejectUnauthorized: true,
      family: 4,
      maxHeaderSize: 8192,
      headers: input.headers,
    });
    const callback = vi.fn();
    const pinnedLookup = options.lookup as NonNullable<
      RequestOptions['lookup']
    >;
    pinnedLookup('different.hostname', {}, callback);
    expect(callback).toHaveBeenCalledWith(null, '8.8.8.8', 4);
    expect(network.lookup).toHaveBeenCalledTimes(1);
    expect(outgoing.end).toHaveBeenCalledWith(input.body);
    const incoming = response(201);
    expect(await result).toEqual({ kind: 'response', status: 201 });
    expect(incoming.destroy).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    expect(options).not.toHaveProperty('checkServerIdentity');
    expect(options).not.toHaveProperty('ca');
  });

  it('supports a public IPv6 pin without IPv4-mapped or private fallback', async () => {
    network.lookup.mockResolvedValue([
      { address: '2606:4700:4700::1111', family: 6 },
    ]);
    const result = sendPinnedWebPushRequest(input);
    await vi.advanceTimersByTimeAsync(0);
    expect(options.family).toBe(6);
    response(201);
    expect(await result).toEqual({ kind: 'response', status: 201 });
  });

  it.each(
    [
      [],
      [{ address: '127.0.0.1', family: 4 }],
      [{ address: '169.254.169.254', family: 4 }],
      [{ address: '10.1.1.1', family: 4 }],
      [{ address: '::ffff:127.0.0.1', family: 6 }],
      [
        { address: '8.8.8.8', family: 4 },
        { address: '192.168.1.1', family: 4 },
      ],
      [
        { address: 'fc00::1', family: 6 },
        { address: '2606:4700::1', family: 6 },
      ],
    ].map((addresses) => ({ addresses })),
  )(
    'never opens a socket for empty/private/mixed DNS results %#',
    async ({ addresses }) => {
      network.lookup.mockResolvedValue(addresses);
      expect(await sendPinnedWebPushRequest(input)).toEqual({
        kind: 'not_sent',
      });
      expect(network.request).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it('blocks unsupported URLs before DNS', async () => {
    expect(
      await sendPinnedWebPushRequest({
        ...input,
        endpoint: 'https://127.0.0.1/metadata',
      }),
    ).toEqual({ kind: 'not_sent' });
    expect(network.lookup).not.toHaveBeenCalled();
    expect(network.request).not.toHaveBeenCalled();
  });

  it.each([0, -1, 4001, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid/unbounded transport deadline %s before DNS',
    async (timeoutMs) => {
      expect(await sendPinnedWebPushRequest({ ...input, timeoutMs })).toEqual({
        kind: 'not_sent',
      });
      expect(network.lookup).not.toHaveBeenCalled();
      expect(network.request).not.toHaveBeenCalled();
    },
  );

  it('classifies DNS rejection without exposing its endpoint/error text', async () => {
    network.lookup.mockRejectedValue(new Error('sensitive endpoint details'));
    expect(await sendPinnedWebPushRequest(input)).toEqual({ kind: 'not_sent' });
    expect(network.request).not.toHaveBeenCalled();
  });

  it('deadline includes DNS and a late resolution can never create a request', async () => {
    let resolveDns!: (addresses: { address: string; family: number }[]) => void;
    network.lookup.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveDns = resolve;
        }),
    );
    const result = sendPinnedWebPushRequest(input);
    await vi.advanceTimersByTimeAsync(input.timeoutMs);
    expect(await result).toEqual({ kind: 'not_sent' });
    resolveDns([{ address: '8.8.8.8', family: 4 }]);
    await vi.advanceTimersByTimeAsync(0);
    expect(network.request).not.toHaveBeenCalled();
  });

  it('checks elapsed time when late DNS resumes before an overdue timer', async () => {
    let resolveDns!: (addresses: { address: string; family: number }[]) => void;
    network.lookup.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveDns = resolve;
        }),
    );
    const result = sendPinnedWebPushRequest(input);
    vi.setSystemTime(Date.now() + input.timeoutMs + 1);
    resolveDns([{ address: '8.8.8.8', family: 4 }]);
    await Promise.resolve();
    expect(await result).toEqual({ kind: 'not_sent' });
    expect(network.request).not.toHaveBeenCalled();
  });

  it('hard-aborts an in-flight request without claiming it was not delivered', async () => {
    const result = sendPinnedWebPushRequest(input);
    await vi.advanceTimersByTimeAsync(input.timeoutMs);
    expect(await result).toEqual({ kind: 'unknown' });
    expect(outgoing.destroy).toHaveBeenCalledTimes(1);
    // A later response cannot replace the first result or trigger retries.
    response(201);
    expect(await result).toEqual({ kind: 'unknown' });
    expect(network.request).toHaveBeenCalledTimes(1);
  });

  it('does not follow redirects or inspect raw provider response content', async () => {
    const result = sendPinnedWebPushRequest(input);
    await vi.advanceTimersByTimeAsync(0);
    const incoming = response(307);
    expect(await result).toEqual({ kind: 'response', status: 307 });
    expect(incoming.destroy).toHaveBeenCalledTimes(1);
    expect(network.request).toHaveBeenCalledTimes(1);
  });

  it('returns only bounded-metadata headers for policy-owned retry', async () => {
    const result = sendPinnedWebPushRequest(input);
    await vi.advanceTimersByTimeAsync(0);
    response(429, '60');
    expect(await result).toEqual({
      kind: 'response',
      status: 429,
      retryAfter: '60',
    });
  });

  it('keeps network/TLS failures uncertain, and never leaks exception text', async () => {
    const result = sendPinnedWebPushRequest(input);
    await vi.advanceTimersByTimeAsync(0);
    outgoing.emit('error', new Error('private response token'));
    expect(await result).toEqual({ kind: 'unknown' });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps a missing HTTP status uncertain', async () => {
    const result = sendPinnedWebPushRequest(input);
    await vi.advanceTimersByTimeAsync(0);
    response();
    expect(await result).toEqual({ kind: 'unknown' });
  });
});
