// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  COMPOSE_FIXTURE_CALL_NAME,
  composeProfileFixtureSql,
} from '../e2e/compose/profile-fixture';

const actor = 'c5200000-0000-4000-8000-000000000001';

describe('artist compose fictional profile initialization', () => {
  it('constructs a single completed-artist update with the required non-null name', () => {
    const sql = composeProfileFixtureSql(actor, 'artist');
    expect(sql)
      .toBe(`update public.profiles set role='artist',call_name='허구팬',onboarding_completed_at=clock_timestamp()
    where id='${actor}' and exists(select 1 from auth.users where id='${actor}' and email ~ '^compose-e2e-[0-9a-f-]{36}@example[.]invalid$');`);
    expect(COMPOSE_FIXTURE_CALL_NAME.trim()).toBe(COMPOSE_FIXTURE_CALL_NAME);
    expect(Array.from(COMPOSE_FIXTURE_CALL_NAME).length).toBeGreaterThanOrEqual(
      2,
    );
    expect(Array.from(COMPOSE_FIXTURE_CALL_NAME).length).toBeLessThanOrEqual(
      10,
    );
    expect(COMPOSE_FIXTURE_CALL_NAME).not.toMatch(/[\u0000-\u001f\u007f']/);
  });

  it('leaves newly created fans incomplete for the actual onboarding RPC flow', () => {
    expect(composeProfileFixtureSql(actor, 'fan')).toBeNull();
  });

  it.each([
    null,
    undefined,
    '',
    'not-a-uuid',
    "'; update public.profiles set role='admin';--",
    'c5200000-0000-1000-8000-000000000001',
  ])('rejects an invalid actor before producing SQL: %s', (value) => {
    expect(() => composeProfileFixtureSql(value, 'artist')).toThrow();
  });

  it.each([
    null,
    undefined,
    '',
    'admin',
    'service_role',
    "artist',call_name=null--",
  ])('does not accept another fixture role: %s', (role) => {
    expect(() => composeProfileFixtureSql(actor, role)).toThrow();
  });

  it('wires the pure initializer into the guarded fixture executor rather than an unconditional completion update', () => {
    const source = readFileSync(
      new URL('../e2e/compose/fixtures.ts', import.meta.url),
      'utf8',
    );
    expect(source).toContain(
      'const profileSetup = composeProfileFixtureSql(id, role);',
    );
    expect(source).toContain(
      'if (profileSetup !== null) localSql(profileSetup);',
    );
    expect(source).not.toContain('onboarding_completed_at=clock_timestamp()');
  });
});
