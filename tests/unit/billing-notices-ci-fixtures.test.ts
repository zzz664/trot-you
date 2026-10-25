// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { billingNoticeCaptureScale } from '../e2e/billing-notices/profile-fixture';
import {
  BILLING_NOTICE_CI,
  billingNoticePolicySql,
  billingNoticeSourceSql,
  fixtureUuid,
} from '../e2e/billing-notices/source-fixture';
const actor = 'c6300000-0000-4000-8000-000000000001';
const artist = 'c6300000-0000-4000-8000-000000000002';
const subscription = 'c6300000-0000-4000-8000-000000000003';

describe('billing notice fictional source contract', () => {
  it.each([true, false])(
    'makes explicit immutable fictional policy with mandatory choice %s and no external evidence',
    (mandatory) => {
      const sql = billingNoticePolicySql(mandatory);
      expect(sql).toContain(
        mandatory
          ? BILLING_NOTICE_CI.mandatoryPolicy
          : BILLING_NOTICE_CI.optionalPolicy,
      );
      expect(sql).toContain('seoul_monthly_clamped');
      expect(sql).toContain(`7,0,${mandatory}`);
      expect(sql).not.toMatch(
        /renewal_notice_receipts|notification_jobs|billing_notices\(/,
      );
    },
  );
  it('uses fictional Auth account boundary and a month-end-safe future anniversary', () => {
    const sql = billingNoticeSourceSql(actor, artist, subscription, true);
    expect(sql).toContain(
      "email ~ '^billing-notices-e2e-[0-9a-f-]{36}@example[.]invalid$'",
    );
    expect(sql).toContain("interval '25 days'");
    expect(sql).toContain(
      "private.enrollment_period_end(anchor,'seoul_monthly_clamped')",
    );
    expect(sql).toContain("'test','fictional-notice-ci-merchant'");
    expect(sql).not.toMatch(
      /disable trigger|session_replication_role|renewal_notice_receipts|billing_notice_create|http|fetch|billing_claim/,
    );
  });
  it.each([
    null,
    undefined,
    '',
    "';delete from auth.users;--",
    'c6300000-0000-1000-8000-000000000001',
  ])('rejects unsafe identity %# before constructing SQL', (value) => {
    expect(() => fixtureUuid(value)).toThrow();
  });
  it('rejects malformed user, artist, subscription or policy selectors', () => {
    expect(() =>
      billingNoticeSourceSql('wrong', artist, subscription, true),
    ).toThrow();
    expect(() =>
      billingNoticeSourceSql(actor, 'wrong', subscription, true),
    ).toThrow();
    expect(() =>
      billingNoticeSourceSql(actor, artist, 'wrong', true),
    ).toThrow();
    expect(() => billingNoticePolicySql('yes' as unknown as boolean)).toThrow();
  });
});
describe('billing notice real capture scale guard', () => {
  it.each(['normal', 'large', 'xlarge'])(
    'extracts actual expected %s from narrow/desktop titles',
    (scale) => {
      expect(billingNoticeCaptureScale(`${scale} 360: initial`)).toBe(scale);
      expect(billingNoticeCaptureScale(`${scale} 1280: initial`)).toBe(scale);
      expect(billingNoticeCaptureScale(`${scale}: error`)).toBe(scale);
    },
  );
  it('does not infer scale for unlabeled correctness cases', () => {
    expect(billingNoticeCaptureScale('worker safety')).toBeNull();
    expect(billingNoticeCaptureScale('normalization')).toBeNull();
  });
  it('every labeled screenshot verifies HTML scale and switched account receives its own scale', () => {
    const fixture = readFileSync(
      new URL('../e2e/billing-notices/fixtures.ts', import.meta.url),
      'utf8',
    );
    const spec = readFileSync(
      new URL(
        '../e2e/billing-notices/billing-notices.spec.ts',
        import.meta.url,
      ),
      'utf8',
    );
    expect(fixture).toContain(
      'const scale = billingNoticeCaptureScale(info.title);',
    );
    expect(fixture).toMatch(
      /toHaveAttribute\(\s*'data-font-scale',\s*scale,?\s*\)/,
    );
    expect(fixture).toMatch(/toHaveCSS\(\s*'font-size'/);
    expect(fixture).toContain("normal: '18px'");
    expect(fixture).toContain("large: '21px'");
    expect(fixture).toContain("xlarge: '25px'");
    expect(spec).toContain('setFont(world.other, scale);');
    expect(spec).toContain("await screenshot(page, info, 'notice-initial');");
  });
});
