import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// These guards inspect test contracts only. Real PostgreSQL execution is a
// separate hosted-CI gate; no structural assertion is an executed database test.
const upgrade = readFileSync(
  'scripts/test-analytics-funnel-upgrade.mjs',
  'utf8',
);
const races = readFileSync(
  'scripts/test-analytics-funnel-concurrency.mjs',
  'utf8',
);
const snapshot = upgrade.slice(
  upgrade.indexOf('const snapshot ='),
  upgrade.indexOf('const ids ='),
);
const predecessor = readdirSync('supabase/migrations')
  .filter((file) => file.endsWith('.sql') && file < '20261026000038')
  .sort()
  .map((file) => readFileSync(`supabase/migrations/${file}`, 'utf8'))
  .join('\n');
const definitions = new Map(
  [
    ...predecessor.matchAll(
      /create table ((?:public|private)\.[a-z_]+)\s*\(([\s\S]+?)\);/g,
    ),
  ].map((match) => [match[1], match[2]]),
);
const relations = [
  ...snapshot.matchAll(
    /jsonb_agg\(to_jsonb\(([a-z]+)\) order by ([^)]+)\) from ((?:public|private)\.[a-z_]+) ([a-z]+)/g,
  ),
].map((match) => ({
  alias: match[1]!,
  sort: match[2]!,
  table: match[3]!,
  relationAlias: match[4]!,
}));

describe('analytics funnel immutable upgrade and independent-session race harness contracts', () => {
  it('snapshots full actual predecessor relations without removing inconvenient columns', () => {
    expect(snapshot).not.toMatch(/-'[a-z_]+'/);
    expect(relations.map(({ table }) => table)).toEqual([
      'private.analytics_events',
      'private.analytics_consents',
      'private.analytics_policy',
      'private.onboarding_documents',
      'public.profiles',
      'public.artists',
      'public.artist_members',
      'public.subscriptions',
      'public.payment_events',
      'private.payment_mandates',
      'private.billing_obligations',
      'private.payment_attempts',
      'private.payment_event_verifications',
      'private.settlement_source_versions',
      'public.messages',
      'public.message_reads',
      'public.replies',
      'public.posts',
      'public.comments',
      'private.board_operations',
      'private.community_rate_limits',
      'private.community_policy',
      'private.point_policy',
      'private.point_ledger',
      'private.point_attendance_operations',
      'private.point_activity_outcomes',
    ]);
    expect(snapshot).not.toContain('analytics_dashboard_coverage');
  });
  it.each(relations)(
    '$table sort columns exist in actual migration 37 storage',
    ({ alias, sort, table, relationAlias }) => {
      expect(alias).toBe(relationAlias);
      const definition = definitions.get(table);
      expect(definition, `${table} exists before migration 38`).toBeDefined();
      for (const column of sort.split(',')) {
        const [columnAlias, name] = column.trim().split('.');
        expect(columnAlias).toBe(alias);
        expect(name).toMatch(/^[a-z_]+$/);
        expect(definition).toMatch(
          new RegExp(`(?:^|[\\n,])\\s*${name}\\s+[a-z]`),
        );
      }
    },
  );
  it('executes a populated 37-to-38 path and preserves every prior field before and after read probes', () => {
    expect(upgrade).toContain(
      "['db', 'reset', '--local', '--version', '20261026000037']",
    );
    expect(upgrade).toContain("['migration', 'up', '--local']");
    expect([
      ...upgrade.matchAll(/assert\.deepEqual\(\s*snapshot\(\),\s*before,/g),
    ]).toHaveLength(3);
    for (const [key, count] of Object.entries({
      events: 17,
      consents: 4,
      analytics_policy: 1,
      documents: 2,
      subscriptions: 1,
      payments: 1,
      mandates: 1,
      obligations: 1,
      attempts: 1,
      verifications: 1,
      messages: 1,
      reads: 1,
      replies: 1,
      posts: 1,
      comments: 1,
      board_operations: 1,
      points: 3,
      attendance_operations: 1,
      activity_outcomes: 2,
    })) {
      expect(upgrade).toContain(`before.${key}.length, ${count}`);
    }
    expect(upgrade).toContain('before.settlement_versions.length > 0');
  });
  it('uses the real financial, point and content boundaries without any provider call', () => {
    for (const rpc of [
      'billing_open_subscription',
      'billing_register_mandate',
      'billing_prepare_obligation',
      'billing_prepare_attempt',
      'billing_claim_attempt',
      'billing_finalize_charge',
      'board_ui_create',
      'community_create_comment',
      'point_ui_check_attendance',
    ])
      expect(upgrade).toContain(`public.${rpc}(`);
    expect(upgrade).toContain('historical STORAGE fixtures');
    expect(upgrade).toContain(
      'not\n  // claims that each underlying operation passed a live ingestion boundary',
    );
    expect(upgrade).not.toMatch(/fetch\(|https:\/\//);
  });
  it('keeps the new coverage marker separate and distinguishes installation from complete history', () => {
    expect(upgrade).toContain(
      'select count(*) from private.analytics_dashboard_coverage;',
    );
    expect(upgrade).toContain(
      'Date.parse(coverage.instrumentation_from) >= Date.parse(startedAt)',
    );
    expect(upgrade).toContain(
      'Date.parse(coverage.instrumentation_from) <= Date.parse(finishedAt)',
    );
    expect(upgrade).toContain('page.coverage.history_complete, false');
    expect(upgrade).toContain(
      "page.coverage.mode, 'current_consent_observations'",
    );
    expect(upgrade).toContain("reason: 'definitions_unapproved'");
    expect(upgrade).toContain('expected_count: 4');
    expect(upgrade).toContain('public.analytics_capture_server(');
    expect(upgrade).toContain('public.analytics_capture_charge(');
    expect(upgrade).toContain('/ANALYTICS_CAPTURE_SOURCE_BEFORE_START/');
  });
  it('tests retained withdrawal, old policy, consent epoch and independent retention exclusions without disclosing row handles', () => {
    expect(upgrade).toContain(
      "'${ids.expired}','${ids.version}',true,clock_timestamp()-interval '40 days'",
    );
    expect(upgrade).toContain(
      "'${ids.expired}',gen_random_uuid(),'voice_input_used','client','comment','${ids.version}',clock_timestamp()-interval '31 days'",
    );
    expect(upgrade).toContain(
      "'${ids.fan}',gen_random_uuid(),'voice_input_used','client','post','${ids.version}',clock_timestamp()-interval '2 days'",
    );
    expect(upgrade).toContain(
      'page.events.every((entry) => entry.event_count === 1)',
    );
    expect(upgrade).toContain("['event_count', 'name']");
    expect(upgrade).toContain("'source_id'");
    expect(upgrade).toContain("'event_key'");
    expect(upgrade).toContain('response.includes(secret)');
    expect(upgrade).toContain(
      'disabled.events.every((entry) => entry.event_count === null)',
    );
    expect(upgrade).toContain(
      'withdrawn.events.every((entry) => entry.event_count === 0)',
    );
  });
  it('compares newly collected rows separately while preserving every historical field and unrelated source', () => {
    expect(upgrade).toContain('after.events.length, before.events.length + 1');
    expect(upgrade).toContain(
      'after.events.filter((entry) => entry.id !== freshId)',
    );
    expect(upgrade).toContain('before.events,');
    expect(upgrade).toContain(
      "Object.keys(before).filter((key) => key !== 'events')",
    );
    expect(upgrade).toContain('after[key],');
    expect(upgrade).toContain('before[key],');
    expect(upgrade).toContain("count(finalPage, 'voice_input_used'), 2");
  });
  it('observes exactly sixteen independent PostgreSQL blocking pairs using actual backend PIDs', () => {
    expect(races).toContain('const expectedCases = 16;');
    expect(races).toContain('public.analytics_capture_server(');
    expect(races).toContain('ANALYTICS_CAPTURE_POLICY_REQUIRED');
    expect([...races.matchAll(/captureSignup\(f\.fan\)/g)]).toHaveLength(3);
    expect([...races.matchAll(/await race\(/g)]).toHaveLength(16);
    expect(races).toContain(
      "this.pid = Number(await this.query('select pg_backend_pid();'))",
    );
    expect(races).toContain('activityLockQuery(waiting.pid, blocking.pid)');
    expect(races).not.toMatch(
      /waiting\.application_name|blocking\.application_name/,
    );
    expect(races).toContain('await waitForBlock(db, second, first);');
    expect(races).toContain('completedCases += 1');
    expect(races).toContain('completedCases,');
    expect(races).toContain('expectedCases,');
    expect(races).toContain(
      '/deadlock detected|lock timeout|statement timeout/',
    );
  });
  it.each([
    'admin-demotion-before-read',
    'admin-restriction-before-read',
    'admin-rollback-before-read',
    'admin-restriction-expiry',
    'policy-disable-before-read',
    'policy-version-before-read',
    'withdraw-before-read',
    'renewed-grant-before-read',
    'fan-restriction-before-read',
    'intake-before-withdraw',
    'withdraw-before-intake',
    'duplicate-intake',
    'policy-disable-before-capture',
    'rollback-intake',
    'read-before-withdraw',
    'read-before-disable',
  ])('retains the focused %s overlap contract', (label) => {
    expect(races).toContain(`'${label}'`);
  });
  it.each([
    ['upgrade', upgrade],
    ['races', races],
  ])(
    '%s is restricted to a fresh disposable default Unix-socket Docker database and reset teardown',
    (_kind, source) => {
      expect(source).toContain(
        '!process.env.DOCKER_HOST && !process.env.DOCKER_CONTEXT',
      );
      expect(source).toContain("['context', 'show']");
      expect(source).toContain("startsWith('unix://')");
      expect(source).toContain('supabase_db_trot-you');
      expect(source).toContain('select count(*) from auth.users');
      expect(source).toContain('shouldReset = true');
      expect(source).toContain("['db', 'reset', '--local']");
      expect(source).toContain('finally {');
      expect(source).not.toMatch(
        /DATABASE_URL|SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY|process\.argv/,
      );
    },
  );
});
