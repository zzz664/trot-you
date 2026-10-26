import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Static guardrails for actual disposable PostgreSQL harnesses, not substitute
// evidence for the hosted concurrency and populated-upgrade integration gates.
const source = readFileSync(
  'scripts/test-community-moderation-upgrade.mjs',
  'utf8',
);
const concurrency = readFileSync(
  'scripts/test-community-moderation-concurrency.mjs',
  'utf8',
);
const snapshot = source.slice(
  source.indexOf('const snapshot ='),
  source.indexOf('const ids ='),
);
const predecessor = readdirSync('supabase/migrations')
  .filter((file) => file.endsWith('.sql') && file < '20261026000035')
  .sort()
  .map((file) => readFileSync(`supabase/migrations/${file}`, 'utf8'))
  .join('\n');
const definitions = new Map(
  [
    ...predecessor.matchAll(
      /create table ((?:public|private)\.[a-z_]+)\s*\(([\s\S]+?)\n\);/g,
    ),
  ].map((match) => [match[1], match[2]]),
);
const relations = [
  ...snapshot.matchAll(
    /jsonb_agg\(to_jsonb\(([a-z]+)\)(?:-'[a-z_]+')* order by ([^)]+)\) from ((?:public|private)\.[a-z_]+) ([a-z]+)/g,
  ),
].map((match) => ({
  alias: match[1]!,
  sort: match[2]!,
  table: match[3]!,
  relationAlias: match[4]!,
}));

describe('community moderation populated-upgrade and real-race harness contracts', () => {
  it('compares actual predecessor state instead of fabricated schema', () => {
    expect(relations.map(({ table }) => table)).toEqual([
      'public.posts',
      'private.board_operations',
      'private.board_uploads',
      'public.replies',
      'public.subscriptions',
      'public.messages',
      'public.comments',
      'public.post_images',
      'public.post_likes',
      'public.reports',
      'public.community_moderation_log',
      'private.community_rate_limits',
      'private.point_ledger',
      'private.point_policy',
      'public.profiles',
      'public.artists',
      'public.artist_members',
      'public.content_calendar',
      'public.calendar_audit_log',
      'public.schedules',
      'private.admin_settings_state',
      'private.admin_display_settings',
      'private.admin_settings_audit',
      'private.admin_settings_operations',
      'private.message_policy',
      'private.community_policy',
      'private.settlement_policies',
      'private.notification_policy',
      'private.notification_preferences',
      'private.push_subscriptions',
      'private.notification_jobs',
    ]);
    expect(snapshot).toContain('from storage.objects o');
    expect(snapshot).not.toContain('app_settings');
    expect(
      [...snapshot.matchAll(/-'[a-z_]+'/g)].map((match) => match[0]),
    ).toEqual([
      "-'revision'",
      "-'report_count'",
      "-'is_hidden'",
      "-'deleted_at'",
    ]);
    expect(snapshot).toContain(
      "to_jsonb(r)-'revision'-'report_count'-'is_hidden'-'deleted_at' order by r.id) from public.replies r",
    );
    expect(snapshot).toContain(
      'to_jsonb(c) order by c.id) from public.comments c',
    );
    expect(snapshot).toContain(
      'to_jsonb(p) order by p.id) from public.profiles p',
    );
  });
  it.each(relations)(
    '$table deterministic ordering exists before migration 35',
    ({ alias, sort, table, relationAlias }) => {
      expect(alias).toBe(relationAlias);
      const definition = definitions.get(table);
      expect(definition, `${table} exists at version 34`).toBeDefined();
      for (const column of sort.split(',')) {
        const [columnAlias, name] = column.trim().split('.');
        expect(columnAlias).toBe(alias);
        expect(name).toMatch(/^[a-z_]+$/);
        expect(definition).toMatch(new RegExp(`(?:^|\\n)\\s*${name}\\s+[a-z]`));
      }
    },
  );
  it('uses the exact predecessor and compares every original field before/after migration and reads', () => {
    expect(source).toContain(
      "['db', 'reset', '--local', '--version', '20261025000034']",
    );
    expect(source).toContain("['migration', 'up', '--local']");
    expect([
      ...source.matchAll(/assert\.deepEqual\(\s*snapshot\(\),\s*before,/g),
    ]).toHaveLength(2);
    for (const [key, count] of Object.entries({
      posts: 5,
      comments: 4,
      replies: 2,
      subscriptions: 1,
      messages: 1,
      images: 1,
      likes: 1,
      reports: 2,
      points: 9,
      notifications: 1,
      board_operations: 2,
      board_uploads: 1,
    }))
      expect(source).toContain(`before.${key}.length, ${count}`);
    expect(source).toContain('before.settings.audit.length > 0');
    expect(source).toContain(
      'select count(*) from public.replies where revision=1 and report_count=0 and not is_hidden and deleted_at is null;',
    );
    expect(source).toContain(
      'select count(*) from private.moderation_operations;',
    );
    expect(source).toContain(
      'select count(*) from private.moderation_notices;',
    );
    expect(source).toContain(
      'select is_blocked and not is_hidden and deleted_at is null',
    );
    expect(source).toContain(
      'select is_hidden and deleted_at is not null and not is_blocked',
    );
    for (const name of ['context', 'queue', 'report', 'resolve', 'notices'])
      expect(source).toContain(`public.community_moderation_${name}(`);
    expect(source).toContain('public.artist_reply_activity_context(');
  });
  it('keeps original notifications, operational policies and rewards intact after real moderation', () => {
    for (const key of [
      'notifications',
      'notification_policy',
      'notification_preferences',
      'push',
      'point_policy',
      'points',
      'settings',
      'board_operations',
      'board_uploads',
      'subscriptions',
      'messages',
    ])
      expect(source).toContain(`'${key}'`);
    expect(source).toContain('after[key]');
    expect(source).toContain('before[key]');
    expect(source).toContain(
      'Content owner cannot read confidential reporter notices.',
    );
    expect(source).toContain(
      'Exact operation replay returns the immutable receipt.',
    );
  });
  it('uses safe fictional profile creation and chronological onboarding', () => {
    for (const script of [source, concurrency]) {
      expect(script).toContain('onboarding_completed_at=clock_timestamp()');
      expect(script).not.toContain('onboarding_completed_at=now()');
      expect(script).toMatch(/call_name='[^']{2,10}'/u);
      expect(script).not.toMatch(/insert into public\.profiles/);
      expect(script).toContain('@example.invalid');
    }
  });
  it.each([
    'duplicate-report',
    'changed-report',
    'distinct-threshold',
    'duplicate-resolution',
    'stale-resolution',
    'report-before-resolution',
    'resolution-before-report',
    'delete-before-report',
    'duplicate-reply-report',
    'membership-before-reply-report',
    'restriction-before-report',
    'expired-restriction-after-wait',
    'duplicate-restriction',
    'stale-restriction',
    'role-revoked-before-queue',
    'restriction-before-notices',
    'policy-removed-before-report',
    'hide-before-context',
  ])('includes independent PostgreSQL sessions for %s', (scenario) => {
    expect(concurrency).toContain(`'${scenario}'`);
  });
  it('asserts every race executed and observes actual backend blockers', () => {
    expect(concurrency).toContain('const expectedCases = 18');
    expect(concurrency).toContain('completedCases,');
    expect(concurrency).toContain('expectedCases,');
    expect(concurrency).toContain(
      'activityLockQuery(waiting.pid, blocking.pid)',
    );
    expect(concurrency).toContain('select pg_backend_pid()');
    expect(concurrency).toContain(
      'deadlock detected|lock timeout|statement timeout',
    );
    expect(concurrency).toContain('select pg_sleep(1.1);');
    expect(concurrency).toContain('count(distinct reporter_id)');
  });
  it('can target only disposable safety-checked local Docker', () => {
    for (const script of [source, concurrency]) {
      expect(script).toContain("const docker = ['--context', 'default']");
      expect(script).toContain(".startsWith('unix://')");
      expect(script).toContain(
        '!process.env.DOCKER_HOST && !process.env.DOCKER_CONTEXT',
      );
      expect(script).toContain("['db', 'reset', '--local']");
      expect(script).not.toMatch(/SUPABASE_SERVICE_ROLE|DATABASE_URL|--db-url/);
    }
  });
});
