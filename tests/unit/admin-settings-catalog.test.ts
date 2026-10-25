import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  ADMIN_SETTINGS_CATALOG,
  type AdminSettingsCatalogEntry,
  type AdminSettingsManagement,
} from '@/config/admin-settings-catalog';
import { settingKeys } from '@/config/settings';

const runbook = readFileSync('docs/operations/admin-settings.md', 'utf8');

function entry(key: string): AdminSettingsCatalogEntry {
  const result = ADMIN_SETTINGS_CATALOG.find((item) => item.key === key);
  if (!result) throw new Error(`Missing catalog entry: ${key}`);
  return result;
}

describe('administrative operational settings coverage', () => {
  it('maps every documented key exactly once, without treating drafts as live values', () => {
    const keys = ADMIN_SETTINGS_CATALOG.map((item) => item.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of settingKeys) {
      expect(keys.filter((candidate) => candidate === key)).toEqual([key]);
    }
    expect(
      keys
        .filter((key) => !key.endsWith('.*'))
        .slice()
        .sort(),
    ).toEqual([...settingKeys].sort());
    expectTypeOf<AdminSettingsManagement>().toEqualTypeOf<
      'editor' | 'runbook'
    >();
  });

  it('links every inventory entry to one concrete existing runbook section', () => {
    const headings = [...runbook.matchAll(/^## ([a-z][a-z-]+)$/gm)].map(
      (match) => match[1],
    );
    for (const item of ADMIN_SETTINGS_CATALOG) {
      expect(headings.filter((heading) => heading === item.section)).toEqual([
        item.section,
      ]);
      expect(item.group).toMatch(/^[a-z]+(?:-[a-z]+)*$/);
    }
  });

  it('keeps referenced policy documents reachable in the repository', () => {
    const links = [...runbook.matchAll(/\]\(([^)]+)\)/g)].map(
      (match) => match[1]!,
    );
    for (const link of links) {
      if (link.startsWith('#')) continue;
      const file = link.split('#')[0]!;
      expect(existsSync(resolve('docs/operations', file))).toBe(true);
    }
  });

  it('limits direct editing to actual numeric operational consumers', () => {
    const editable = ADMIN_SETTINGS_CATALOG.filter(
      (item) => item.kind === 'editor',
    );
    expect(new Set(editable.map((item) => item.group))).toEqual(
      new Set(['message', 'community', 'display']),
    );
    expect(entry('message.page_size')).toMatchObject({
      kind: 'editor',
      group: 'display',
      section: 'display-policy',
    });
    expect(entry('media.*')).toMatchObject({
      kind: 'editor',
      section: 'message-policy',
    });
    for (const field of [
      'max_photo_bytes',
      'max_voice_bytes',
      'max_video_bytes',
      'max_image_bytes',
    ]) {
      expect(runbook).toContain(field);
    }
  });

  it('keeps monetary and contractual keys out of the generic numeric editor', () => {
    for (const key of settingKeys.filter(
      (key) =>
        key.startsWith('subscription.') ||
        key.startsWith('settlement.') ||
        key.startsWith('artist.'),
    )) {
      expect(entry(key).kind).toBe('runbook');
    }
    expect(entry('refund.*')).toMatchObject({
      kind: 'runbook',
      section: 'refund-policy',
    });
    for (const table of [
      'checkout_policies',
      'checkout_policy_current',
      'renewal_policies',
      'billing_notice_policies',
      'refund_policies',
      'refund_policy_current',
      'settlement_policies',
    ]) {
      expect(runbook).toContain(table);
    }
  });

  it('gives unresolved and deployment-bound keys honest non-editor paths', () => {
    const expected = {
      'board.grade_thresholds': 'activity-grades',
      'points.share': 'points-policy',
      'schedule.notice_hour_kst': 'schedule-notice-policy',
      'notification.batch_size': 'notification-policy',
      'public.*': 'public-copy-and-legal-policy',
    } as const;
    for (const [key, section] of Object.entries(expected)) {
      expect(entry(key)).toMatchObject({ kind: 'runbook', section });
    }
    expect(runbook).toContain('not implemented');
    expect(runbook).toContain('no runtime');
    expect(runbook).toContain('not a live database setting');
  });

  it('covers scope-specific moderation, rates, consent, and account policy without secrets', () => {
    for (const key of [
      'moderation.forbidden_patterns',
      'moderation.profanity_words',
      'profile.call_name_min',
      'profile.call_name_max',
      'rate.*',
      'analytics.*',
      'artist.account_link.*',
    ]) {
      expect(entry(key).kind).toBe('runbook');
    }
    for (const item of ADMIN_SETTINGS_CATALOG) {
      expect(Object.keys(item).sort()).toEqual([
        'group',
        'key',
        'kind',
        'section',
      ]);
      expect(item.key).not.toMatch(
        /secret|password|credential|token|vapid|vault|cron|provider|^NEXT_PUBLIC_/i,
      );
    }
  });
});
