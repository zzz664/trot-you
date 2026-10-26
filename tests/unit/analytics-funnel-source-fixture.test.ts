// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { analyticsSourceSql } from '../e2e/analytics-funnel/source-fixture';
const actor = 'e1000000-0000-4000-8000-000000000001';
const policy = 'e9000000-0000-4000-8000-000000000001';
describe('explicitly synthetic analytics display history', () => {
  it('accepts only UUID handles before assembling local SQL', () => {
    for (const bad of [
      "'; select secret; --",
      '',
      'not-a-uuid',
      '00000000-0000-0000-0000-000000000000',
    ]) {
      expect(() => analyticsSourceSql(bad, policy)).toThrow(
        'Synthetic analytics fixture UUID required.',
      );
      expect(() => analyticsSourceSql(actor, bad)).toThrow(
        'Synthetic analytics fixture UUID required.',
      );
    }
  });
  it('uses the real thirteen-name enum with one signup and increasing display counts', () => {
    const sql = analyticsSourceSql(actor, policy);
    expect(sql).toContain('enum_range(null::public.analytics_event_name)');
    expect(sql).toContain('generate_series(1,n.ordinal::integer)');
    expect(sql).toContain(
      "('signup_complete','font_size_selected','voice_input_used')",
    );
    expect(sql).toContain(
      "('subscribe_complete','renew') then 'verified_charge'",
    );
  });
  it('isolates retained rows by a fresh consent version and honest earlier fictional epoch', () => {
    const sql = analyticsSourceSql(actor, policy);
    expect(sql).toContain(
      `values('${actor}','${policy}',true,clock_timestamp()-interval '3 days',clock_timestamp())`,
    );
    expect(sql).toContain('consent_version=excluded.consent_version');
    expect(sql).toContain("at time zone 'Asia/Seoul'");
    expect(sql).toContain(
      'Fictional disposable test data; not an approved operating policy.',
    );
  });
  it('never disables protections, edits immutable business evidence or contacts a provider', () => {
    const sql = analyticsSourceSql(actor, policy);
    expect(sql).not.toMatch(
      /disable trigger|session_replication_role|payment_events|payment_attempts|point_ledger|http|billing_finalize/i,
    );
    expect(sql).not.toMatch(
      /update private\.analytics_events|delete from private\.analytics_events/i,
    );
  });
});
