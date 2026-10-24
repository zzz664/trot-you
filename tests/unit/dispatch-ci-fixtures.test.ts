// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DISPATCH_FIXTURE_CALL_NAME,
  dispatchProfileFixtureSql,
} from '../e2e/dispatch/profile-fixture';

const actor = 'c5200000-0000-4000-8000-000000000001';

describe('artist dispatch fictional profile initialization', () => {
  it('constructs a single completed-artist update with the required non-null name', () => {
    const sql = dispatchProfileFixtureSql(actor, 'artist');
    expect(sql)
      .toBe(`update public.profiles set role='artist',call_name='허구팬',onboarding_completed_at=clock_timestamp()
    where id='${actor}' and exists(select 1 from auth.users where id='${actor}' and email ~ '^dispatch-e2e-[0-9a-f-]{36}@example[.]invalid$');`);
    expect(DISPATCH_FIXTURE_CALL_NAME.trim()).toBe(DISPATCH_FIXTURE_CALL_NAME);
    expect(
      Array.from(DISPATCH_FIXTURE_CALL_NAME).length,
    ).toBeGreaterThanOrEqual(2);
    expect(Array.from(DISPATCH_FIXTURE_CALL_NAME).length).toBeLessThanOrEqual(
      10,
    );
    expect(DISPATCH_FIXTURE_CALL_NAME).not.toMatch(/[\u0000-\u001f\u007f']/);
  });

  it('leaves newly created fans incomplete for the actual onboarding RPC flow', () => {
    expect(dispatchProfileFixtureSql(actor, 'fan')).toBeNull();
  });

  it.each([
    null,
    undefined,
    '',
    'not-a-uuid',
    "'; update public.profiles set role='admin';--",
    'c5200000-0000-1000-8000-000000000001',
  ])('rejects an invalid actor before producing SQL: %s', (value) => {
    expect(() => dispatchProfileFixtureSql(value, 'artist')).toThrow();
  });

  it.each([
    null,
    undefined,
    '',
    'admin',
    'service_role',
    "artist',call_name=null--",
  ])('does not accept another fixture role: %s', (role) => {
    expect(() => dispatchProfileFixtureSql(actor, role)).toThrow();
  });

  it('wires the pure initializer into the guarded fixture executor rather than an unconditional completion update', () => {
    const source = readFileSync(
      new URL('../e2e/dispatch/fixtures.ts', import.meta.url),
      'utf8',
    );
    expect(source).toContain(
      'const profileSetup = dispatchProfileFixtureSql(id, role);',
    );
    expect(source).toContain(
      'if (profileSetup !== null) localSql(profileSetup);',
    );
    expect(source).not.toContain('onboarding_completed_at=clock_timestamp()');
  });
});

describe('dispatch fictional time-travel guards', () => {
  const source = readFileSync(
    new URL('../e2e/dispatch/fixtures.ts', import.meta.url),
    'utf8',
  );
  it('ages both due clocks atomically for the exact fictional message and artist', () => {
    const helper = source
      .split('export function makeScheduledDue')[1]
      ?.split('export function closeCancelWindow')[0];
    expect(helper).toBeDefined();
    expect(helper).toContain('`begin;');
    expect(helper).toContain(
      'update public.messages set scheduled_at=statement_timestamp()',
    );
    expect(helper).toContain(
      'update private.artist_dispatch_submissions set next_attempt_at=statement_timestamp()',
    );
    expect(helper).toContain("where message_id='${uuid(messageId)}'");
    expect(helper).toContain(
      "m.artist_id='${uuid(world.artist.id)}' and m.status='scheduled'",
    );
    expect(helper).toContain('commit;`');
    expect(helper).not.toMatch(/status\s*=\s*'sent'/);
  });
  it('uses one stable timestamp when aging the cancellation boundary', () => {
    const helper = source
      .split('export function closeCancelWindow')[1]
      ?.split('export function ageDispatchRateWindow')[0];
    expect(helper).toContain(
      "sent_at=statement_timestamp()-interval '10 minutes',scheduled_at=statement_timestamp()-interval '10 minutes'",
    );
    expect(helper).not.toContain('clock_timestamp()');
  });
});
