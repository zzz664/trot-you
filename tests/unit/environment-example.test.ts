// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseServerEnv } from '@/config/env.server';
import { inspectConfiguration } from '@/server/configuration';

describe('committed environment example', () => {
  it('is a valid disabled keyless configuration, not fake operational success', () => {
    const lines = readFileSync(
      new URL('../../.env.example', import.meta.url),
      'utf8',
    ).split('\n');
    const input = Object.fromEntries(
      lines
        .filter((line) => line && !line.startsWith('#'))
        .map((line) => {
          const equals = line.indexOf('=');
          return [line.slice(0, equals), line.slice(equals + 1)];
        }),
    );
    expect(parseServerEnv(input).ok).toBe(true);
    const result = inspectConfiguration(input);
    expect(result).toMatchObject({
      ok: true,
      data: { paymentsMode: 'disabled' },
    });
    if (result.ok)
      expect(
        Object.values(result.data.integrations).every(
          (value) => value.operational === false,
        ),
      ).toBe(true);
  });
});
