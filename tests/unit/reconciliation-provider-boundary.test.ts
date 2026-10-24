// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { parseServerEnv } from '@/config/env.server';
import { parsePreparationEnvironment } from '@/server/adapters/payment/preparation';

describe('provider configuration remains independent of worker-only flags', () => {
  it.each([false, true])(
    'normalizes transformed reconciliation flag%s before provider revalidation',
    (enabled) => {
      const parsed = parseServerEnv({
        PAYMENTS_RECONCILIATION_ENABLED: String(enabled),
        RECONCILIATION_CRON_SECRET:
          'fictional_unique_recovery_secret_000000000',
      });
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) throw new Error('fixture');
      const provider = parsePreparationEnvironment(parsed.data);
      expect(provider.ok).toBe(true);
      if (!provider.ok) throw new Error('fixture');
      expect(provider.data.PAYMENTS_RECONCILIATION_ENABLED).toBe(false);
      expect(provider.data.RECONCILIATION_CRON_SECRET).toBeUndefined();
    },
  );
  it('still rejects malformed provider origin/mode/key relationships', () => {
    const parsed = parseServerEnv({});
    if (!parsed.ok) throw new Error('fixture');
    expect(
      parsePreparationEnvironment({
        ...parsed.data,
        PAYMENTS_MODE: 'live',
        TOSS_SECRET_KEY: 'test_sk_fixture',
      }).ok,
    ).toBe(false);
  });
});
