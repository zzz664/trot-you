import { describe, expect, it, vi } from 'vitest';
import type { LogEvent } from '@/config/logging';
import { createLogger, redactLogMetadata } from '@/server/logging/logger';

describe('server-only safe logging', () => {
  it('preserves only necessary typed operational diagnostics', () => {
    expect(
      redactLogMetadata({
        provider: 'toss_card_billing',
        mode: 'test',
        outcome: 'unknown',
        errorCode: 'INTERNAL',
        statusCode: 503,
        durationMs: 1200,
        attemptCount: 2,
      }),
    ).toEqual({
      provider: 'toss_card_billing',
      mode: 'test',
      outcome: 'unknown',
      errorCode: 'INTERNAL',
      statusCode: 503,
      durationMs: 1200,
      attemptCount: 2,
      redacted: false,
    });
  });

  it('drops all unknown keys, nested data and sensitive spelling variants', () => {
    const secret = 'SENSITIVE_VALUE_MUST_NOT_LEAK';
    const input = {
      provider: 'kakaopay_subscription',
      Authorization: `SECRET_KEY ${secret}`,
      authorization: secret,
      headers: { Authorization: secret, Cookie: secret },
      billingKey: secret,
      billing_key: secret,
      SID: secret,
      sid: secret,
      pg_token: secret,
      authKey: secret,
      customerKey: secret,
      partner_user_id: secret,
      apiKey: secret,
      SUPABASE_SERVICE_ROLE_KEY: secret,
      name: secret,
      phone: secret,
      email: secret,
      userId: secret,
      message: secret,
      stack: secret,
      url: `https://example.test/callback?pg_token=${secret}`,
      request: { body: secret },
      providerPayload: { sid: secret },
      unexpected: { deeper: [{ token: secret }] },
    };
    const redacted = redactLogMetadata(input);
    expect(redacted).toEqual({
      provider: 'kakaopay_subscription',
      redacted: true,
    });
    expect(JSON.stringify(redacted)).not.toContain(secret);
    expect(input.SID).toBe(secret);
  });

  it('does not let allowlisted property names carry untrusted text', () => {
    const secret = 'arbitrary-secret-token';
    expect(
      redactLogMetadata({
        provider: secret,
        mode: secret,
        outcome: secret,
        errorCode: secret,
        statusCode: secret,
        durationMs: secret,
        attemptCount: secret,
      }),
    ).toEqual({ redacted: true });
  });

  it.each([-1, 1.2, Number.NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid numeric diagnostics (%s)',
    (value) => {
      expect(
        redactLogMetadata({ durationMs: value, attemptCount: value }),
      ).toEqual({ redacted: true });
    },
  );

  it.each([0, 99, 600])('rejects non-HTTP status codes (%s)', (statusCode) => {
    expect(redactLogMetadata({ statusCode })).toEqual({ redacted: true });
  });

  it('does not read error messages, stacks, causes or arbitrary names', () => {
    const error = new Error('secret message', { cause: 'secret cause' });
    error.name = 'secret name';
    error.stack = 'secret stack';
    expect(redactLogMetadata(error)).toEqual({
      errorType: 'exception',
      redacted: true,
    });
    expect(redactLogMetadata({ error })).toEqual({
      errorType: 'exception',
      redacted: true,
    });
    expect(redactLogMetadata({ error: 'secret thrown string' })).toEqual({
      errorType: 'unknown',
      redacted: true,
    });
  });

  it('does not invoke getters or toJSON and safely discards cycles', () => {
    const getter = vi.fn(() => {
      throw new Error('getter secret');
    });
    const toJSON = vi.fn(() => ({ token: 'serialized secret' }));
    const cyclic: Record<string, unknown> = { toJSON };
    cyclic.self = cyclic;
    Object.defineProperty(cyclic, 'provider', {
      get: getter,
      enumerable: true,
    });
    expect(redactLogMetadata(cyclic)).toEqual({ redacted: true });
    expect(getter).not.toHaveBeenCalled();
    expect(toJSON).not.toHaveBeenCalled();
  });

  it('ignores inherited fields, symbol fields and prototype keys', () => {
    const inherited = Object.create({
      mode: 'live',
      secret: 'inherited secret',
    });
    inherited.provider = 'supabase';
    inherited[Symbol('secret key')] = 'symbol secret';
    Object.defineProperty(inherited, '__proto__', {
      value: 'prototype secret',
    });
    expect(redactLogMetadata(inherited)).toEqual({
      provider: 'supabase',
      redacted: true,
    });
    expect(redactLogMetadata({ errorCode: 'constructor' })).toEqual({
      redacted: true,
    });
  });

  it('does not throw for hostile or revoked proxies', () => {
    const hostile = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error('secret trap');
        },
      },
    );
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    for (const input of [hostile, revoked.proxy]) {
      expect(redactLogMetadata(input)).toEqual({ redacted: true });
    }
  });

  it.each([null, 'free text secret', ['secret'], 42, true])(
    'redacts non-object input (%s)',
    (input) => {
      expect(redactLogMetadata(input)).toEqual({ redacted: true });
    },
  );

  it('sends only JSON-safe sanitized data to the injected sink', () => {
    const sink = vi.fn();
    const logger = createLogger(sink);
    expect(
      logger.warn('integration.unavailable', {
        mode: 'disabled',
        error: new Error('secret exception'),
        headers: { Authorization: 'secret auth' },
      }),
    ).toBe(true);
    const [line, level] = sink.mock.calls[0]!;
    expect(level).toBe('warn');
    expect(JSON.parse(line)).toEqual({
      timestamp: expect.any(String),
      level: 'warn',
      event: 'integration.unavailable',
      mode: 'disabled',
      errorType: 'exception',
      redacted: true,
    });
    expect(line).not.toContain('secret');
  });

  it('replaces malicious event identifiers instead of logging them', () => {
    const sink = vi.fn();
    const logger = createLogger(sink);
    logger.info('secret\nforged event' as LogEvent);
    expect(JSON.parse(sink.mock.calls[0]![0])).toMatchObject({
      event: 'log.input_rejected',
      redacted: true,
    });
    expect(sink.mock.calls[0]![0]).not.toContain('secret');
  });

  it('reports sink failure without throwing or logging its secret exception', () => {
    const sink = vi.fn(() => {
      throw new Error('sink secret');
    });
    expect(createLogger(sink).error('operation.failed')).toBe(false);
    expect(sink).toHaveBeenCalledOnce();
  });
});
