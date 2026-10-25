// @vitest-environment node
import {
  createDecipheriv,
  createECDH,
  createHmac,
  createPublicKey,
  verify,
} from 'node:crypto';
import { createServer, request } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WEBPUSH_PROTOCOL as P } from '@/config/webpush-protocol';
import {
  createWebPushChannel,
  isAllowedWebPushEndpoint,
  validateWebPushConfiguration,
  validateWebPushSubscription,
  validP256PublicKey,
  validWebPushSubject,
} from '@/server/adapters/notification/webpush';
import { createWebPushChannelForTests } from '@/server/adapters/notification/testing';
import { encryptWebPushPayload } from '@/server/adapters/notification/crypto';
import { classifyWebPushResponse } from '@/server/adapters/notification/channel';
import { isPublicWebPushAddress } from '@/server/adapters/notification/address';
import type { WebPushHttpRequest } from '@/server/adapters/notification/types';
import {
  PUSH_VECTOR as V,
  SYNTHETIC_PUSH_CONFIGURATION as configuration,
  SYNTHETIC_PUSH_MESSAGE as message,
} from './webpush-adapter-fixtures';

afterEach(() => vi.restoreAllMocks());

describe('Web Push endpoint and key boundary', () => {
  it.each([
    'https://fcm.googleapis.com/wp/opaque',
    'https://fcm.googleapis.com/fcm/send/opaque',
    'https://fcm.googleapis.com:443/wp/opaque',
    'https://updates.push.services.mozilla.com/wpush/v2/opaque',
    'https://web.push.apple.com/Q/opaque',
    'https://region.web.push.apple.com/opaque?token=opaque',
  ])(
    'allows supported opaque endpoint %s without contacting it',
    (endpoint) => {
      expect(isAllowedWebPushEndpoint(endpoint)).toBe(true);
      expect(validateWebPushSubscription({ ...message, endpoint })).toBe(true);
    },
  );

  it.each([
    '',
    'http://fcm.googleapis.com/wp/opaque',
    'https://fcm.googleapis.com:444/wp/opaque',
    'https://fcm.googleapis.com/wp/',
    'https://fcm.googleapis.com/v1/projects/any/messages:send',
    'https://fcm.googleapis.com/preprod/wp/opaque',
    'https://jmt17.google.com/fcm/send/opaque',
    'https://fcm.googleapis.com.evil.invalid/wp/opaque',
    'https://fcm.googleapis.com./wp/opaque',
    'https://evil-fcm.googleapis.com/wp/opaque',
    'https://updates.push.services.mozilla.com/v1/registration/opaque',
    'https://updates-autopush.dev.mozaws.net/wpush/v2/opaque',
    'https://push.apple.com/opaque',
    'https://web.push.apple.com/?token=opaque',
    'https://notpush.apple.com/opaque',
    'https://web.push.apple.com.evil.invalid/opaque',
    'https://-bad.push.apple.com/opaque',
    'https://web..push.apple.com/opaque',
    'https://fcm.googleapis.com@127.0.0.1/wp/opaque',
    'https://127.0.0.1/wp/opaque',
    'https://[::1]/wp/opaque',
    'https://2130706433/wp/opaque',
    'https://fcm.googleapis.com/wp/opaque#fragment',
    'https://fcm.googleapis.com/wp/../other',
    'https://fcm.googleapis.com/wp/%2e%2e/other',
    'https://fcm.googleapis.com/wp/%0aheader',
    'https://fcm.googleapis.com/wp/has space',
    'https://fcm.googleapis.com\\evil.invalid/wp/opaque',
    'https://FCM.GOOGLEAPIS.COM/wp/opaque',
    'https://fcm.googleapis.com/wp/가',
    `https://fcm.googleapis.com/wp/${'a'.repeat(P.endpointMaxLength)}`,
  ])('rejects unsupported/noncanonical endpoint %s', (endpoint) => {
    expect(isAllowedWebPushEndpoint(endpoint)).toBe(false);
  });

  it.each([null, undefined, 1, {}, [], Symbol('endpoint')])(
    'rejects non-string endpoint %s',
    (endpoint) => expect(isAllowedWebPushEndpoint(endpoint)).toBe(false),
  );

  it('validates P-256 curve membership and canonical encodings', () => {
    expect(validP256PublicKey(V.receiverPublic)).toBe(true);
    expect(validP256PublicKey(V.senderPublic)).toBe(true);
    for (const p256dh of [
      V.receiverPublic + '=',
      V.receiverPublic.slice(1),
      'B' + 'A'.repeat(86),
      Buffer.alloc(65).toString('base64url'),
      'A'.repeat(87),
      null,
    ])
      expect(validateWebPushSubscription({ ...message, p256dh })).toBe(false);
    for (const auth of [V.auth + '=', V.auth.slice(1), '!', null])
      expect(validateWebPushSubscription({ ...message, auth })).toBe(false);
    expect(validateWebPushSubscription(null)).toBe(false);
    expect(validateWebPushSubscription([])).toBe(false);
    const throwing = Object.defineProperty({}, 'endpoint', {
      get() {
        throw new Error('untrusted');
      },
    });
    expect(validateWebPushSubscription(throwing)).toBe(false);
  });

  it('requires matching supplied VAPID keys; never generates an account key', () => {
    expect(validateWebPushConfiguration(configuration)).toBe(true);
    for (const changed of [
      { privateKey: V.receiverPrivate },
      { publicKey: V.receiverPublic },
      { privateKey: Buffer.alloc(32).toString('base64url') },
      { privateKey: configuration.privateKey + '=' },
      { publicKey: 'B' + 'A'.repeat(86) },
      { subject: 'javascript:alert(1)' },
      { timeoutMs: 0 },
      { timeoutMs: P.timeoutMaxMs + 1 },
      { timeoutMs: 1.5 },
      { timeoutMs: Number.NaN },
    ]) {
      expect(
        validateWebPushConfiguration({ ...configuration, ...changed }),
      ).toBe(false);
      expect(createWebPushChannel({ ...configuration, ...changed })).toBeNull();
    }
    expect(createWebPushChannel(configuration)).not.toBeNull();
  });

  it.each([
    'mailto:push@example.com',
    'mailto:push+operator@example.com',
    'https://example.com/contact',
  ])('allows a configured contact URI %s', (subject) => {
    expect(validWebPushSubject(subject)).toBe(true);
  });
  it.each([
    'mailto:nobody',
    'mailto:a@b',
    'mailto:a@b.c?body=secret',
    'https://user:pass@example.com/contact',
    'https://127.0.0.1/',
    'http://example.com/contact',
    'https://localhost/',
    'https://example.com/#fragment',
    'mailto:a@b.c\nheader',
    'x'.repeat(513),
  ])('rejects invalid contact URI %s', (subject) => {
    expect(validWebPushSubject(subject)).toBe(false);
  });

  it.each([
    '0.0.0.0',
    '10.1.1.1',
    '100.64.0.1',
    '127.0.0.1',
    '169.254.169.254',
    '172.16.1.1',
    '172.31.255.255',
    '192.0.0.1',
    '192.0.2.1',
    '192.88.99.1',
    '192.168.0.1',
    '198.18.0.1',
    '198.51.100.1',
    '203.0.113.1',
    '224.0.0.1',
    '255.255.255.255',
    '::',
    '::1',
    '::ffff:127.0.0.1',
    '::ffff:8.8.8.8',
    'fc00::1',
    'fe80::1',
    'ff02::1',
    '64:ff9b::a9fe:a9fe',
    '2001:db8::1',
    '2001::1',
    '2002:7f00:1::1',
    '3fff::1',
    'not-an-ip',
  ])('rejects private/special DNS address %s', (address) => {
    expect(isPublicWebPushAddress(address)).toBe(false);
  });
  it.each([
    '8.8.8.8',
    '17.0.0.1',
    '172.32.0.1',
    '2606:4700:4700::1111',
    '2a00:1450::1',
  ])('permits ordinary global address %s', (address) =>
    expect(isPublicWebPushAddress(address)).toBe(true),
  );
});

describe('Web Push RFC protocol', () => {
  it('matches the published RFC8291 Section 5 ciphertext byte for byte', () => {
    const encrypted = encryptWebPushPayload(
      { p256dh: V.receiverPublic, auth: V.auth },
      Buffer.from('When I grow up, I want to be a watermelon'),
      {
        salt: Buffer.from(V.salt, 'base64url'),
        ephemeralPrivateKey: Buffer.from(V.senderPrivate, 'base64url'),
      },
    );
    expect(encrypted.toString('base64url')).toBe(V.ciphertext);
  });

  it('verifies real encrypted wire bytes and ES256 JWT through a controlled loopback receiver', async () => {
    const received: {
      body: Buffer;
      headers: Record<string, string | string[] | undefined>;
    }[] = [];
    const server = createServer((incoming, outgoing) => {
      const chunks: Buffer[] = [];
      incoming.on('data', (chunk: Buffer) => chunks.push(chunk));
      incoming.on('end', () => {
        received.push({
          body: Buffer.concat(chunks),
          headers: incoming.headers,
        });
        outgoing.writeHead(201);
        outgoing.end();
      });
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const address = server.address();
    if (!address || typeof address === 'string')
      throw new Error('loopback unavailable');
    // The only custom transport is test-owned, fixed to an ephemeral loopback
    // listener. Production factory cannot select this transport or endpoint.
    const transport = (input: WebPushHttpRequest) =>
      new Promise<{ kind: 'response'; status: number }>((resolve, reject) => {
        expect(input.endpoint).toBe(message.endpoint);
        const outgoing = request(
          {
            hostname: '127.0.0.1',
            port: address.port,
            path: '/synthetic',
            method: 'POST',
            headers: input.headers,
          },
          (incoming) => {
            incoming.resume();
            resolve({ kind: 'response', status: incoming.statusCode ?? 0 });
          },
        );
        outgoing.on('error', reject);
        outgoing.end(input.body);
      });
    const now = Date.parse('2026-10-25T00:00:00Z');
    const adapter = createWebPushChannelForTests(
      configuration,
      transport,
      () => now,
    );
    try {
      expect(await adapter?.send(message)).toEqual({
        outcome: 'provider_accepted',
      });
      expect(await adapter?.send(message)).toEqual({
        outcome: 'provider_accepted',
      });
      expect(received).toHaveLength(2);
      expect(received[0]?.body.equals(received[1]!.body)).toBe(false);
      for (const item of received) {
        expect(item.headers['content-encoding']).toBe('aes128gcm');
        expect(item.headers['content-type']).toBe('application/octet-stream');
        expect(item.headers['content-length']).toBe(String(item.body.length));
        expect(item.headers.ttl).toBe(String(P.ttlSeconds));
        expect(item.headers.topic).toBe(message.topic);
        expect(item.body.includes(Buffer.from('notificationId'))).toBe(false);
        expect(decryptIndependently(item.body).toString()).toBe(
          message.payload,
        );
        const auth = String(item.headers.authorization);
        const match = /^vapid t=([A-Za-z0-9_.-]+), k=([A-Za-z0-9_-]+)$/.exec(
          auth,
        );
        expect(match?.[2]).toBe(configuration.publicKey);
        const [header, claims, signature] = match![1]!.split('.');
        expect(
          JSON.parse(Buffer.from(header!, 'base64url').toString()),
        ).toEqual({ typ: 'JWT', alg: 'ES256' });
        expect(
          JSON.parse(Buffer.from(claims!, 'base64url').toString()),
        ).toEqual({
          aud: 'https://fcm.googleapis.com',
          sub: configuration.subject,
          exp: now / 1000 + P.vapidLifetimeSeconds,
        });
        const publicBytes = Buffer.from(configuration.publicKey, 'base64url');
        const publicKey = createPublicKey({
          format: 'jwk',
          key: {
            kty: 'EC',
            crv: 'P-256',
            x: publicBytes.subarray(1, 33).toString('base64url'),
            y: publicBytes.subarray(33).toString('base64url'),
          },
        });
        expect(
          verify(
            'sha256',
            Buffer.from(`${header}.${claims}`),
            { key: publicKey, dsaEncoding: 'ieee-p1363' },
            Buffer.from(signature!, 'base64url'),
          ),
        ).toBe(true);
        expect(item.body.subarray(21, 86).toString('base64url')).not.toBe(
          configuration.publicKey,
        );
      }
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it('rejects nonminimal/untrusted payloads and does not invoke transport', async () => {
    const transport = vi
      .fn()
      .mockResolvedValue({ kind: 'response', status: 201 });
    const adapter = createWebPushChannelForTests(configuration, transport)!;
    for (const payload of [
      'invalid json',
      '{}',
      'null',
      '[]',
      JSON.stringify({
        version: 1,
        notificationId: 'not-a-uuid',
        url: '/me/subscriptions',
      }),
      JSON.stringify({
        version: 1,
        notificationId: JSON.parse(message.payload).notificationId,
        url: 'https://evil.invalid',
      }),
      JSON.stringify({
        ...JSON.parse(message.payload),
        body: 'private message',
      }),
      JSON.stringify({ ...JSON.parse(message.payload), userId: 'fan-id' }),
      ' '.repeat(P.payloadMaxBytes + 1),
    ])
      expect(await adapter.send({ ...message, payload })).toEqual({
        outcome: 'permanent_failure',
      });
    for (const topic of ['', 'spaces are invalid', 'x'.repeat(33), 'a\nheader'])
      expect(await adapter.send({ ...message, topic })).toEqual({
        outcome: 'permanent_failure',
      });
    expect(
      await adapter.send({ ...message, endpoint: 'https://127.0.0.1/x' }),
    ).toEqual({ outcome: 'permanent_failure' });
    expect(transport).not.toHaveBeenCalled();
  });

  it('does not retry, retain raw error text, or turn uncertain transport errors into success', async () => {
    const transport = vi
      .fn()
      .mockRejectedValue(new Error('private endpoint auth body'));
    const channel = createWebPushChannelForTests(configuration, transport)!;
    expect(await channel.send(message)).toEqual({ outcome: 'unknown' });
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('canonicalizes payload members rather than encrypting discarded duplicate data', async () => {
    const transport = vi
      .fn()
      .mockResolvedValue({ kind: 'response', status: 201 });
    const channel = createWebPushChannelForTests(configuration, transport)!;
    const notificationId = JSON.parse(message.payload).notificationId;
    const payload = `{"version":1,"notificationId":"${notificationId}","url":"private-discarded-data","url":"/me/subscriptions"}`;
    expect(await channel.send({ ...message, payload })).toEqual({
      outcome: 'provider_accepted',
    });
    const bytes = transport.mock.calls[0]?.[0].body as Buffer;
    expect(decryptIndependently(bytes).toString()).toBe(message.payload);
    expect(
      decryptIndependently(bytes).includes(
        Buffer.from('private-discarded-data'),
      ),
    ).toBe(false);
  });

  it('snapshots validated signing settings rather than following later caller mutation', async () => {
    const mutable = {
      ...configuration,
      subject: configuration.subject as string,
      timeoutMs: 25,
    };
    const transport = vi
      .fn()
      .mockResolvedValue({ kind: 'response', status: 201 });
    const channel = createWebPushChannelForTests(mutable, transport)!;
    mutable.subject = 'mailto:changed@example.invalid';
    mutable.timeoutMs = 99999;
    expect(await channel.send(message)).toEqual({
      outcome: 'provider_accepted',
    });
    const captured = transport.mock.calls[0]?.[0] as WebPushHttpRequest;
    expect(captured.timeoutMs).toBe(25);
    const jwt = captured.headers.authorization!.split('t=')[1]!.split(',')[0]!;
    expect(
      JSON.parse(Buffer.from(jwt.split('.')[1]!, 'base64url').toString()).sub,
    ).toBe(configuration.subject);
  });
});

describe('provider acceptance is not delivery/read', () => {
  it.each([201, 202])('classifies accepted %s', (status) => {
    expect(classifyWebPushResponse(status)).toEqual({
      outcome: 'provider_accepted',
    });
  });
  it.each([404, 410])('classifies dead %s', (status) => {
    expect(classifyWebPushResponse(status)).toEqual({
      outcome: 'dead_endpoint',
    });
  });
  it.each([400, 401, 403, 413, 301, 302, 307, 308])(
    'does not follow/retry permanent status %s',
    (status) => {
      expect(classifyWebPushResponse(status)).toEqual({
        outcome: 'permanent_failure',
      });
    },
  );
  it.each([429, 503])('returns policy-owned retryable %s', (status) => {
    expect(classifyWebPushResponse(status, '10')).toEqual({
      outcome: 'not_sent',
      retryAfterSeconds: 10,
    });
  });
  it.each([0, 200, 204, 408, 425, 500, 502, 504, 599])(
    'keeps unexpected status %s uncertain',
    (status) => {
      expect(classifyWebPushResponse(status)).toEqual({ outcome: 'unknown' });
    },
  );
  it('bounds Retry-After seconds and dates', () => {
    const now = Date.parse('2026-10-25T00:00:00Z');
    expect(classifyWebPushResponse(429, '999999999')).toEqual({
      outcome: 'permanent_failure',
    });
    expect(
      classifyWebPushResponse(503, 'Sun, 25 Oct 2026 00:01:00 GMT', now),
    ).toEqual({ outcome: 'not_sent', retryAfterSeconds: 60 });
    expect(classifyWebPushResponse(503, 'garbage', now)).toEqual({
      outcome: 'not_sent',
    });
    expect(
      classifyWebPushResponse(503, 'Sun, 24 Oct 2026 00:00:00 GMT', now),
    ).toEqual({ outcome: 'not_sent', retryAfterSeconds: 0 });
  });

  it.each(['0', '0000'])('preserves explicit Retry-After zero %s', (header) => {
    expect(classifyWebPushResponse(429, header)).toEqual({
      outcome: 'not_sent',
      retryAfterSeconds: 0,
    });
  });
  it.each([
    '1.5',
    '-1',
    '2026-10-25T00:01:00Z',
    'Sun, 99 Oct 2026 00:01:00 GMT',
  ])('ignores malformed Retry-After %s', (header) => {
    expect(classifyWebPushResponse(429, header)).toEqual({
      outcome: 'not_sent',
    });
  });
  it.each(['Sunday, 25-Oct-26 00:01:00 GMT', 'Sun Oct 25 00:01:00 2026'])(
    'accepts obsolete RFC9110 HTTP-date form %s',
    (header) => {
      expect(
        classifyWebPushResponse(
          503,
          header,
          Date.parse('2026-10-25T00:00:00Z'),
        ),
      ).toEqual({ outcome: 'not_sent', retryAfterSeconds: 60 });
    },
  );
  it.each([
    '86401',
    '9'.repeat(500),
    'Tue, 27 Oct 2026 00:00:00 GMT',
    'Sunday, 25-Oct-60 00:01:00 GMT',
  ])('never retries earlier than unsupported Retry-After %s', (header) => {
    expect(
      classifyWebPushResponse(429, header, Date.parse('2026-10-25T00:00:00Z')),
    ).toEqual({ outcome: 'permanent_failure' });
  });
});

// An independent receiver uses the RFC HMAC extract/expand steps rather than
// the adapter's hkdfSync implementation. Public test fixture, no device network.
function decryptIndependently(body: Buffer) {
  expect(body.readUInt32BE(16)).toBe(4096);
  expect(body[20]).toBe(65);
  const salt = body.subarray(0, 16);
  const sender = body.subarray(21, 86);
  const receiver = createECDH('prime256v1');
  receiver.setPrivateKey(Buffer.from(V.receiverPrivate, 'base64url'));
  const prk = createHmac('sha256', Buffer.from(V.auth, 'base64url'))
    .update(receiver.computeSecret(sender))
    .digest();
  const ikm = createHmac('sha256', prk)
    .update(
      Buffer.concat([
        Buffer.from('WebPush: info\0'),
        receiver.getPublicKey(),
        sender,
        Buffer.from([1]),
      ]),
    )
    .digest();
  const encryptionPrk = createHmac('sha256', salt).update(ikm).digest();
  const key = createHmac('sha256', encryptionPrk)
    .update(Buffer.from('Content-Encoding: aes128gcm\0\x01'))
    .digest()
    .subarray(0, 16);
  const nonce = createHmac('sha256', encryptionPrk)
    .update(Buffer.from('Content-Encoding: nonce\0\x01'))
    .digest()
    .subarray(0, 12);
  const decipher = createDecipheriv('aes-128-gcm', key, nonce);
  decipher.setAuthTag(body.subarray(-16));
  const plaintext = Buffer.concat([
    decipher.update(body.subarray(86, -16)),
    decipher.final(),
  ]);
  expect(plaintext.at(-1)).toBe(2);
  return plaintext.subarray(0, -1);
}
