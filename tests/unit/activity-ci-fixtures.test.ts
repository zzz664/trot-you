// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ACTIVITY_FIXTURE_CALL_NAME,
  activityProfileFixtureSql,
  activityCaptureScale,
} from '../e2e/activity/profile-fixture';

const actor = 'c5200000-0000-4000-8000-000000000001';

describe('artist reply activity fictional profile initialization', () => {
  it('constructs a single completed-artist update with the required non-null name', () => {
    const sql = activityProfileFixtureSql(actor, 'artist');
    expect(sql)
      .toBe(`update public.profiles set role='artist',call_name='허구팬',onboarding_completed_at=clock_timestamp()
    where id='${actor}' and exists(select 1 from auth.users where id='${actor}' and email ~ '^activity-e2e-[0-9a-f-]{36}@example[.]invalid$');`);
    expect(ACTIVITY_FIXTURE_CALL_NAME.trim()).toBe(ACTIVITY_FIXTURE_CALL_NAME);
    expect(
      Array.from(ACTIVITY_FIXTURE_CALL_NAME).length,
    ).toBeGreaterThanOrEqual(2);
    expect(Array.from(ACTIVITY_FIXTURE_CALL_NAME).length).toBeLessThanOrEqual(
      10,
    );
    expect(ACTIVITY_FIXTURE_CALL_NAME).not.toMatch(/[\u0000-\u001f\u007f']/);
  });

  it('leaves newly created fans incomplete for the actual onboarding RPC flow', () => {
    expect(activityProfileFixtureSql(actor, 'fan')).toBeNull();
  });

  it.each([
    null,
    undefined,
    '',
    'not-a-uuid',
    "'; update public.profiles set role='admin';--",
    'c5200000-0000-1000-8000-000000000001',
  ])('rejects an invalid actor before producing SQL: %s', (value) => {
    expect(() => activityProfileFixtureSql(value, 'artist')).toThrow();
  });

  it.each([
    null,
    undefined,
    '',
    'admin',
    'service_role',
    "artist',call_name=null--",
  ])('does not accept another fixture role: %s', (role) => {
    expect(() => activityProfileFixtureSql(actor, role)).toThrow();
  });

  it('wires the pure initializer into the guarded fixture executor rather than an unconditional completion update', () => {
    const source = readFileSync(
      new URL('../e2e/activity/fixtures.ts', import.meta.url),
      'utf8',
    );
    expect(source).toContain(
      'const profileSetup = activityProfileFixtureSql(id, role);',
    );
    expect(source).toContain(
      'if (profileSetup !== null) localSql(profileSetup);',
    );
    expect(source).not.toContain('onboarding_completed_at=clock_timestamp()');
  });
});

describe('activity screenshot scale contract', () => {
  it.each(['normal', 'large', 'xlarge'] as const)(
    'extracts %s for narrow and desktop capture titles',
    (scale) => {
      expect(activityCaptureScale(`${scale}: empty artist menu`)).toBe(scale);
      expect(activityCaptureScale(`${scale} 360: feed`)).toBe(scale);
      expect(activityCaptureScale(`${scale} 1280: feed`)).toBe(scale);
    },
  );
  it.each(['ordinary read', 'normalization test', 'xlargeOther'])(
    'does not invent a scale for %s',
    (title) => {
      expect(activityCaptureScale(title)).toBeNull();
    },
  );
  it('asserts the actual document scale before every labeled capture and applies it to the switched account', () => {
    const fixture = readFileSync(
      new URL('../e2e/activity/fixtures.ts', import.meta.url),
      'utf8',
    );
    const cases = readFileSync(
      new URL('../e2e/activity/artist-reply-activity.spec.ts', import.meta.url),
      'utf8',
    );
    expect(fixture).toContain(
      'const scale = activityCaptureScale(info.title);',
    );
    expect(fixture).toMatch(
      /toHaveAttribute\(\s*'data-font-scale',\s*scale,?\s*\)/,
    );
    expect(cases).toContain('setFont(world.outsider, scale);');
  });
});
