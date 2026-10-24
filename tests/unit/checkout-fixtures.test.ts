// @vitest-environment node
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  checkoutFixtures,
  clearFictionalCheckout,
  disableFictionalCheckoutPolicy,
  enableFictionalCheckout,
  expireFictionalCheckout,
  prepareFictionalCheckoutPolicies,
  rotateFictionalCheckoutPolicy,
  storedFictionalCheckout,
} from '../e2e/authenticated/checkout-fixtures';
import { CHECKOUT_INTENT_TTL_MS } from '@/config/checkout';

const exec = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', () => ({ execFileSync: exec }));
const id = 'ba22c942-3bfb-4221-9512-68da4ce23209';
beforeEach(() => {
  vi.clearAllMocks();
  for (const key of ['CI', 'GITHUB_ACTIONS', 'AUTH_LOCAL_E2E'])
    vi.stubEnv(key, 'true');
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://127.0.0.1:3100');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://127.0.0.1:54321');
  vi.stubEnv('DOCKER_HOST', '');
  vi.stubEnv('DOCKER_CONTEXT', '');
  exec.mockImplementation(
    (_command: string, args: string[], options?: { input?: string }) => {
      if (args.at(-1) === 'show') return 'default\n';
      if (args.includes('inspect')) return 'unix:///var/run/docker.sock\n';
      return options?.input?.includes('select jsonb_build_object')
        ? '{"sessions":[],"subscriptions":0,"payments":0}'
        : '';
    },
  );
});
afterEach(() => vi.unstubAllEnvs());

describe('isolated checkout fixture safeguards', () => {
  it.each([
    prepareFictionalCheckoutPolicies,
    enableFictionalCheckout,
    disableFictionalCheckoutPolicy,
    rotateFictionalCheckoutPolicy,
    clearFictionalCheckout,
  ])('uses only a fixed local stack for %s', (operation) => {
    operation();
    const [command, args, options] = exec.mock.calls.at(-1)!;
    expect(command).toBe('docker');
    expect(args).toContain('supabase_db_trot-you');
    expect(args).toContain('--context');
    expect(args).toContain('default');
    expect(options.stdio).toEqual(['pipe', 'pipe', 'pipe']);
    expect(options.input).not.toMatch(
      /disable\s+trigger|session_replication_role|set\s+role/i,
    );
  });
  it.each([
    'CI',
    'GITHUB_ACTIONS',
    'AUTH_LOCAL_E2E',
    'NEXT_PUBLIC_APP_URL',
    'NEXT_PUBLIC_SUPABASE_URL',
    'DOCKER_HOST',
    'DOCKER_CONTEXT',
  ])('rejects nonlocal/inactive %s before any command', (key) => {
    vi.stubEnv(key, 'wrong');
    expect(() => clearFictionalCheckout()).toThrow();
    expect(exec).not.toHaveBeenCalled();
  });
  it.each(['remote', 'tcp://remote.example:2375'])(
    'rejects nonlocal Docker context %s before SQL',
    (value) => {
      exec.mockImplementation((_command: string, args: string[]) =>
        args.at(-1) === 'show'
          ? value === 'remote'
            ? value
            : 'default'
          : value,
      );
      expect(() => clearFictionalCheckout()).toThrow();
      expect(exec.mock.calls.some((call) => call[1].includes('exec'))).toBe(
        false,
      );
    },
  );
  it.each(["' OR true --", 'bad', '00000000-0000-0000-0000-000000000000'])(
    'refuses malformed actor identifiers %s before commands',
    (value) => {
      expect(() => expireFictionalCheckout(value)).toThrow();
      expect(() => storedFictionalCheckout(value)).toThrow();
      expect(exec).not.toHaveBeenCalled();
    },
  );
  it('limits observation/expiry to a generated fictional actor and fixture artist', () => {
    expect(storedFictionalCheckout(id)).toEqual({
      sessions: [],
      subscriptions: 0,
      payments: 0,
    });
    expireFictionalCheckout(id);
    const sql = exec.mock.calls.map((call) => call[2]?.input ?? '').join('\n');
    expect(sql).toContain(checkoutFixtures.artist.id);
    expect(sql).toContain(`user_id='${id}'`);
    expect(sql).toContain('^auth-e2e-[0-9a-f-]{36}@example[.]invalid$');
    expect(sql).not.toMatch(/select[^;]*(nonce_hash|customer_ref|order_id)/i);
    expect(sql).not.toContain('insert into public.payment_events');
  });
  it('removes fixture session FKs before artists without changing immutable policies', () => {
    clearFictionalCheckout();
    const sql = exec.mock.calls.at(-1)![2].input as string;
    expect(sql.indexOf('delete from private.checkout_sessions')).toBeLessThan(
      sql.indexOf('delete from public.artists'),
    );
    expect(sql).toContain(`where artist_id='${checkoutFixtures.artist.id}'`);
    expect(sql).not.toContain('delete from private.checkout_policies');
    expect(sql).not.toContain('truncate');
  });
  it('keeps browser I/O app-local and dispatch/charges unavailable in CI fixtures', () => {
    const source = readFileSync(
      new URL('../e2e/authenticated/checkout.spec.ts', import.meta.url),
      'utf8',
    );
    expect(source).toContain("route.abort('blockedbyclient')");
    expect(source).toContain('expect(externalRequests.get(context)).toBe(0)');
    expect(source).toContain('expect(stored.payments).toBe(0)');
    expect(source).toContain('expect(stored.subscriptions).toBe(0)');
    expect(source).not.toContain('api.tosspayments.com');
    expect(source).not.toContain('open-api.kakaopay.com');
  });
  it('matches the migration technical TTL without treating it as payment validity', () => {
    expect(CHECKOUT_INTENT_TTL_MS).toBe(15 * 60 * 1000);
    const migration = readFileSync(
      new URL(
        '../../supabase/migrations/20261024000013_checkout_sessions.sql',
        import.meta.url,
      ),
      'utf8',
    );
    expect(migration).toContain("at_time+interval '15 minutes'");
  });
});
