// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  WEBPUSH_FIXTURE_CALL_NAME,
  webpushProfileFixtureSql,
  webpushCaptureScale,
} from '../e2e/webpush/profile-fixture';

const actor = 'c5200000-0000-4000-8000-000000000001';

describe('web push fictional profile initialization', () => {
  it('constructs a single completed-artist update with the required non-null name', () => {
    const sql = webpushProfileFixtureSql(actor, 'artist');
    expect(sql)
      .toBe(`update public.profiles set role='artist',call_name='허구팬',onboarding_completed_at=clock_timestamp()
    where id='${actor}' and exists(select 1 from auth.users where id='${actor}' and email ~ '^webpush-e2e-[0-9a-f-]{36}@example[.]invalid$');`);
    expect(WEBPUSH_FIXTURE_CALL_NAME.trim()).toBe(WEBPUSH_FIXTURE_CALL_NAME);
    expect(Array.from(WEBPUSH_FIXTURE_CALL_NAME).length).toBeGreaterThanOrEqual(
      2,
    );
    expect(Array.from(WEBPUSH_FIXTURE_CALL_NAME).length).toBeLessThanOrEqual(
      10,
    );
    expect(WEBPUSH_FIXTURE_CALL_NAME).not.toMatch(/[\u0000-\u001f\u007f']/);
  });

  it('leaves newly created fans incomplete for the actual onboarding RPC flow', () => {
    expect(webpushProfileFixtureSql(actor, 'fan')).toBeNull();
  });

  it.each([
    null,
    undefined,
    '',
    'not-a-uuid',
    "'; update public.profiles set role='admin';--",
    'c5200000-0000-1000-8000-000000000001',
  ])('rejects an invalid actor before producing SQL: %s', (value) => {
    expect(() => webpushProfileFixtureSql(value, 'artist')).toThrow();
  });

  it.each([
    null,
    undefined,
    '',
    'admin',
    'service_role',
    "artist',call_name=null--",
  ])('does not accept another fixture role: %s', (role) => {
    expect(() => webpushProfileFixtureSql(actor, role)).toThrow();
  });

  it('wires the pure initializer into the guarded fixture executor rather than an unconditional completion update', () => {
    const source = readFileSync(
      new URL('../e2e/webpush/fixtures.ts', import.meta.url),
      'utf8',
    );
    expect(source).toContain(
      'const profileSetup = webpushProfileFixtureSql(id, role);',
    );
    expect(source).toContain(
      'if (profileSetup !== null) localSql(profileSetup);',
    );
    expect(source).not.toContain('onboarding_completed_at=clock_timestamp()');
  });
});

describe('webpush screenshot scale contract', () => {
  it.each(['normal', 'large', 'xlarge'] as const)(
    'extracts %s for narrow and desktop capture titles',
    (scale) => {
      expect(webpushCaptureScale(`${scale}: empty artist menu`)).toBe(scale);
      expect(webpushCaptureScale(`${scale} 360: feed`)).toBe(scale);
      expect(webpushCaptureScale(`${scale} 1280: feed`)).toBe(scale);
    },
  );
  it.each(['ordinary read', 'normalization test', 'xlargeOther'])(
    'does not invent a scale for %s',
    (title) => {
      expect(webpushCaptureScale(title)).toBeNull();
    },
  );
  it('asserts the actual document scale before every labeled capture and applies it to the switched account', () => {
    const fixture = readFileSync(
      new URL('../e2e/webpush/fixtures.ts', import.meta.url),
      'utf8',
    );
    const cases = readFileSync(
      new URL('../e2e/webpush/webpush.spec.ts', import.meta.url),
      'utf8',
    );
    expect(fixture).toContain('const scale = webpushCaptureScale(info.title);');
    expect(fixture).toMatch(
      /toHaveAttribute\(\s*'data-font-scale',\s*scale,?\s*\)/,
    );
    expect(cases).toContain('setFont(world.other, scale);');
  });
});

describe('synthetic PushManager and real worker compatibility contract', () => {
  it('retains the actual public applicationServerKey and waits for real worker activation', () => {
    const fixture = readFileSync(
      new URL('../e2e/webpush/push-manager.ts', import.meta.url),
      'utf8',
    );
    expect(fixture).toContain('decode(state.applicationServerKey)');
    expect(fixture).toContain(
      'state.applicationServerKey = encode(config.applicationServerKey);',
    );
    expect(fixture).toContain("registration?.active?.state === 'activated'");
    expect(fixture).toContain('!registration.waiting');
    expect(fixture).toContain('!registration.installing');
  });
  it('delegates successful capability negotiation to the real worker and synthesizes only obsolete failure replies', () => {
    const fixture = readFileSync(
      new URL('../e2e/webpush/push-manager.ts', import.meta.url),
      'utf8',
    );
    expect(fixture).toContain('nativePostMessage');
    expect(fixture).toContain('Reflect.apply(');
    expect(fixture).toContain("if (workerMode === 'stale')");
    expect(fixture).toContain('version: 0');
    expect(fixture).not.toContain('version: 1');
    expect(fixture).not.toContain('skipWaiting()');
  });
  it('uses the configured public binding for direct registration and preserves stale-key rejection coverage', () => {
    const source = readFileSync(
      new URL('../e2e/webpush/webpush.spec.ts', import.meta.url),
      'utf8',
    );
    expect(source).toContain(
      'applicationServerKey: WEBPUSH_CI_ENV.VAPID_PUBLIC_KEY',
    );
    expect(source).toContain(
      'applicationServerKey: WEBPUSH_CI_SUBSCRIPTION.keys.p256dh',
    );
    expect(source).toContain('copy.errors.WORKER_UPDATE_REQUIRED');
    expect(source).toContain('copy.renewalNotice');
  });
});
