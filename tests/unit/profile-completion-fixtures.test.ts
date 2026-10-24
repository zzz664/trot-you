// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { setFictionalCompletion } from '../e2e/authenticated/profile-completion-fixtures';

const exec = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', () => ({ execFileSync: exec }));
const id = 'a1100000-0000-4000-8000-000000000001';
const date = '2026-10-24T00:00:00.000Z';
beforeEach(() => {
  vi.clearAllMocks();
  for (const key of ['CI', 'GITHUB_ACTIONS', 'AUTH_LOCAL_E2E'])
    vi.stubEnv(key, 'true');
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://127.0.0.1:3100');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://127.0.0.1:54321');
  vi.stubEnv('DOCKER_HOST', '');
  vi.stubEnv('DOCKER_CONTEXT', '');
  exec.mockImplementation((_command: string, args: string[]) => {
    if (args.at(-1) === 'show') return 'default\n';
    if (args.includes('inspect')) return 'unix:///var/run/docker.sock\n';
    return '';
  });
});
afterEach(() => vi.unstubAllEnvs());

describe('owner-only completion fixture setup', () => {
  it.each([date, null])(
    'sets only completion for a generated fictional user: %s',
    (completedAt) => {
      setFictionalCompletion(id, completedAt);
      const [command, args, options] = exec.mock.calls.at(-1)!;
      expect(command).toBe('docker');
      expect(args).toContain('supabase_db_trot-you');
      expect(args).toContain('postgres');
      expect(options.stdio).toEqual(['pipe', 'pipe', 'pipe']);
      expect(options.input).toContain(`where p.id='${id}'::uuid`);
      expect(options.input).toContain(
        '^auth-e2e-[0-9a-f-]{36}@example[.]invalid$',
      );
      expect(options.input).toContain('changed <> 1');
      expect(options.input).toContain(
        `onboarding_completed_at=${completedAt === null ? 'null' : `'${date}'::timestamptz`}`,
      );
      expect(options.input).not.toMatch(
        /disable\s+trigger|session_replication_role|set\s+role/i,
      );
    },
  );
  it.each([
    'CI',
    'GITHUB_ACTIONS',
    'AUTH_LOCAL_E2E',
    'NEXT_PUBLIC_APP_URL',
    'NEXT_PUBLIC_SUPABASE_URL',
    'DOCKER_HOST',
    'DOCKER_CONTEXT',
  ])('refuses unsafe environment %s before Docker execution', (key) => {
    vi.stubEnv(key, 'wrong');
    expect(() => setFictionalCompletion(id, date)).toThrow();
    expect(exec).not.toHaveBeenCalled();
  });
  it.each([
    ["' OR true --", date],
    [id, "2026-10-24';select 1;--"],
    [id, '2026-99-24T00:00:00.000Z'],
  ])(
    'rejects malformed caller values before Docker execution',
    (actor, completed) => {
      expect(() => setFictionalCompletion(actor, completed)).toThrow();
      expect(exec).not.toHaveBeenCalled();
    },
  );
  it.each(['remote', 'tcp://remote:2375'])(
    'refuses a nonlocal Docker context %s',
    (value) => {
      exec.mockImplementation((_command: string, args: string[]) =>
        args.at(-1) === 'show'
          ? value === 'remote'
            ? value
            : 'default'
          : value,
      );
      expect(() => setFictionalCompletion(id, date)).toThrow();
      expect(exec.mock.calls.some((call) => call[1].includes('exec'))).toBe(
        false,
      );
    },
  );
  it('keeps ordinary profile fixture writes on the actual application role API', () => {
    const source = readFileSync(
      new URL('../e2e/authenticated/fixtures.ts', import.meta.url),
      'utf8',
    );
    expect(source).toContain(
      'onboarding_completed_at: completedAt, ...ordinary',
    );
    expect(source).toContain('.update(ordinary)');
    expect(source).toContain('setFictionalCompletion(id, completedAt)');
    expect(source).not.toContain('.update(fields)');
  });
});
