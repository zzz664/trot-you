import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  BROWSER_JOBS,
  CONDITIONAL_JOBS,
  FEATURE_RULES,
  FULL_RULES,
  classifyPath,
} from './ci-impact-registry.mjs';
import { parseNameStatus, selectImpact } from './ci-impact.mjs';

const selected = (plan) => BROWSER_JOBS.filter((job) => plan.jobs[job]);
const has = (paths, ...jobs) => {
  const plan = selectImpact(paths);
  for (const job of jobs) assert.equal(plan.jobs[`${job}-browser`], true, job);
  return plan;
};

describe('conservative dependency registry', () => {
  it('has one stable job inventory and unique, valid dependency groups', () => {
    assert.equal(BROWSER_JOBS.length, 19);
    assert.equal(new Set(CONDITIONAL_JOBS).size, CONDITIONAL_JOBS.length);
    const rules = [...FULL_RULES, ...FEATURE_RULES];
    assert.equal(new Set(rules.map(({ id }) => id)).size, rules.length);
    for (const rule of rules)
      for (const pattern of rule.patterns) {
        assert.equal(pattern.global, false);
        assert.equal(pattern.sticky, false);
        assert.ok(pattern.source.startsWith('^'));
      }
    const reachable = new Set(FEATURE_RULES.flatMap(({ jobs }) => jobs));
    assert.deepEqual([...reachable].sort(), [...BROWSER_JOBS].sort());
    for (const { jobs } of FEATURE_RULES) {
      assert.ok(jobs.length > 0);
      assert.equal(new Set(jobs).size, jobs.length);
      assert.ok(jobs.every((job) => BROWSER_JOBS.includes(job)));
    }
  });

  for (const path of [
    'supabase/migrations/20261025000031_schedule_notices.sql',
    'supabase/tests/schedule_notices.test.sql',
    'supabase/config.toml',
    'src/server/db/schedule-notice-queue.ts',
    'src/server/db/client.ts',
    'src/server/adapters/notification/channel.ts',
    'src/server/adapters/payment/preparation.ts',
    'src/server/auth/context.ts',
    'src/server/services/auth/access.ts',
    'src/server/settings/registry.ts',
    'src/server/configuration.ts',
    'src/components/ui/MicButton.tsx',
    'src/components/auth/SessionPage.tsx',
    'src/components/schedules/ScheduleEntry.tsx',
    'src/components/admin-settings/AdminSettingsEntry.tsx',
    'src/components/admin-subscriptions/AdminSubscriptionsEntry.tsx',
    'src/components/billing-notices/BillingNoticeEntry.tsx',
    'src/components/webpush/WebPushEntry.tsx',
    'src/components/subscription/SubscriptionEntry.tsx',
    'src/components/admin-artists/AdminArtistsEntry.tsx',
    'src/components/admin/refunds/RefundEntry.tsx',
    'src/components/admin/reconciliation/ReconciliationEntry.tsx',
    'src/app/layout.tsx',
    'src/app/admin/page.tsx',
    'src/app/artist/page.tsx',
    'src/config/env.server.ts',
    'src/config/routes.ts',
    'src/config/admin-settings-catalog.ts',
    'src/config/admin-artists.ts',
    'src/config/media.ts',
    'src/config/message-dispatch.ts',
    'src/config/webpush.ts',
    'src/config/billing-notices.ts',
    'src/config/schedule-notices.ts',
    'src/config/enrollment-provider.ts',
    'src/config/new-shared-schema.ts',
    'src/messages/ko.json',
    'src/worker/sw.ts',
    'src/types/database.ts',
    '.github/workflows/ci.yml',
    'scripts/ci-impact-registry.mjs',
    'scripts/ci-required.mjs',
    'scripts/auth-local-ci.mjs',
    'scripts/activity-race-observer.mjs',
    'scripts/test-dispatch-concurrency.mjs',
    'scripts/test-schedule-notice-upgrade.mjs',
    'tests/e2e/authenticated/onboarding-fixtures.ts',
    'playwright.auth.config.ts',
    'playwright.config.ts',
    'package.json',
    'package-lock.json',
    '.env.example',
    '.nvmrc',
    'next.config.ts',
    'new-unknown-feature.ts',
    'docs/executable.mjs',
  ]) {
    it(`runs full for ${path}`, () => {
      const plan = selectImpact([path]);
      assert.equal(plan.mode, 'full');
      assert.ok(CONDITIONAL_JOBS.every((job) => plan.jobs[job] === true));
    });
  }

  it('selects schedule consumers and retains full DB on a leaf UI/unit change', () => {
    const plan = has(
      [
        'src/components/schedules/SchedulesScreen.tsx',
        'tests/unit/schedules-ui.test.tsx',
        'docs/work-log/schedule-fix.md',
      ],
      'auth',
      'schedules',
      'schedule-notices',
    );
    assert.equal(plan.mode, 'selective');
    assert.equal(selected(plan).length, 3);
    assert.equal(plan.jobs.database, true);
  });

  it('selects two browsers for leaf admin settings instead of all nineteen', () => {
    const plan = has(
      ['src/components/admin-settings/AdminSettingsScreen.tsx'],
      'auth',
      'admin-settings',
    );
    assert.equal(selected(plan).length, 2);
  });

  it('keeps schedule formatting, controls, and view fixtures connected', () => {
    for (const path of [
      'src/components/schedule-notices/ScheduleNoticeControls.tsx',
      'src/lib/schedule-time.ts',
      'src/lib/map-links.ts',
      'src/config/schedule-view.ts',
      'tests/fixtures/schedule-timezone.json',
      'tests/e2e/schedules/screenshot-capture.ts',
    ])
      has([path], 'schedules', 'schedule-notices');
  });

  it('keeps shared notification delivery and all notice consumers connected', () => {
    for (const path of [
      'src/server/services/notification/send-queue.ts',
      'src/config/webpush-protocol.ts',
      'src/worker/webpush.ts',
      'src/client/billing-notices.ts',
    ])
      has(
        [path],
        'webpush',
        'billing-notices',
        'schedule-notices',
        'schedules',
      );
  });

  it('includes the complete payment fixture/configuration dependency chain', () => {
    for (const path of [
      'playwright.enrollment.config.ts',
      'tests/e2e/enrollment/fixtures.ts',
      'tests/e2e/renewal/fixtures.ts',
      'tests/e2e/cancellation/fixtures.ts',
      'scripts/cancellation-local-ci-provider.mjs',
      'src/config/enrollment-test-runtime.ts',
      'src/server/reconciliation/enrollment.ts',
      'src/lib/billing-period.ts',
    ])
      has([path], 'enrollment', 'renewal', 'cancellation', 'reconciliation');
  });

  it('includes indirect speech, reply, composer, media, and preview consumers', () => {
    for (const path of [
      'tests/e2e/replies/fixtures.ts',
      'scripts/reply-local-ci.mjs',
      'tests/e2e/speech/recognition.ts',
      'src/lib/speech-draft.ts',
      'src/components/fan/chat/format.ts',
      'src/components/media/SecureMedia.tsx',
      'src/server/services/message/render.ts',
    ])
      has(
        [path],
        'reply',
        'speech',
        'compose',
        'dispatch',
        'chat',
        'media',
        'auth',
        'admin-artists',
      );
  });

  it('keeps admin artist picker configuration connected to schedules', () => {
    for (const path of ['src/config/admin-artists.ts', 'src/config/media.ts'])
      has(
        [path],
        'admin-artists',
        'admin-subscriptions',
        'schedules',
        'schedule-notices',
        'compose',
      );
  });

  it('unions disjoint groups and is independent of path ordering', () => {
    const paths = [
      'src/client/schedules.ts',
      'src/client/admin-settings.ts',
      'src/client/schedules.ts',
    ];
    const plan = has(
      paths,
      'auth',
      'schedules',
      'schedule-notices',
      'admin-settings',
    );
    assert.equal(selected(plan).length, 4);
    assert.deepEqual(plan, selectImpact([...paths].reverse()));
  });

  it('one unknown file broadens an otherwise selective or documentation PR', () => {
    for (const known of ['docs/readme.md', 'src/client/schedules.ts']) {
      const plan = selectImpact([known, 'src/server/new-feature/index.ts']);
      assert.equal(plan.mode, 'full');
      assert.equal(selected(plan).length, 19);
    }
  });

  it('only explicit nonempty Markdown documentation can skip DB and browsers', () => {
    const plan = selectImpact(['README.md', 'docs/work-log/ci.md']);
    assert.equal(plan.mode, 'docs-only');
    assert.ok(CONDITIONAL_JOBS.every((job) => plan.jobs[job] === false));
    assert.equal(selectImpact([]).mode, 'full');
    assert.equal(selectImpact(['docs/image.png']).mode, 'full');
    assert.equal(classifyPath('README.md.mjs').kind, 'full');
  });

  it('never truncates a large changed-file list into a selective plan', () => {
    const paths = Array.from(
      { length: 1500 },
      (_, index) => `src/components/schedules/${index}-${'x'.repeat(100)}.tsx`,
    );
    const plan = selectImpact(paths);
    assert.equal(plan.reason, 'oversized-plan');
    assert.equal(plan.mode, 'full');
    assert.equal(plan.paths, null);
    assert.equal(plan.pathCount, 1500);
    assert.equal(selected(plan).length, 19);
  });
});

describe('NUL-delimited git diff parsing', () => {
  it('accepts Git zero-padded partial-rename similarity scores', () => {
    assert.deepEqual(
      parseNameStatus(Buffer.from('R050\0old\0new\0C099\0source\0copy\0')),
      [
        { status: 'R050', paths: ['old', 'new'] },
        { status: 'C099', paths: ['source', 'copy'] },
      ],
    );
  });
  it('retains both rename/copy sides and deleted paths without splitting whitespace', () => {
    assert.deepEqual(
      parseNameStatus(
        Buffer.from(
          'R100\0src/old name.ts\0src/새\nname.ts\0C75\0a\0b\0D\0deleted\0M\0$(touch nope)\0T\0link\0',
        ),
      ),
      [
        { status: 'R100', paths: ['src/old name.ts', 'src/새\nname.ts'] },
        { status: 'C75', paths: ['a', 'b'] },
        { status: 'D', paths: ['deleted'] },
        { status: 'M', paths: ['$(touch nope)'] },
        { status: 'T', paths: ['link'] },
      ],
    );
  });
  for (const input of [
    'M\0missing terminator',
    'R100\0old\0',
    'M\0\0',
    'U\0conflict\0',
    'X\0unknown\0',
    'R101\0old\0new\0',
    'M\0/absolute\0',
    'M\0docs/../code.md\0',
  ])
    it(`rejects malformed diff ${JSON.stringify(input)}`, () => {
      assert.throws(() => parseNameStatus(Buffer.from(input)));
    });
  it('rejects invalid UTF-8 instead of silently replacing path bytes', () => {
    assert.throws(() => parseNameStatus(Buffer.from([77, 0, 255, 0])));
  });
});
