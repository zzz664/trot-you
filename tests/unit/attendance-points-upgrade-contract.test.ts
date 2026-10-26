import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Static regression guards complement, never replace, the actual disposable
// PostgreSQL pgTAP, independent-session races and populated-upgrade CI gates.
const source = readFileSync(
  'scripts/test-attendance-points-upgrade.mjs',
  'utf8',
);
const concurrency = readFileSync(
  'scripts/test-attendance-points-concurrency.mjs',
  'utf8',
);
const migration = readFileSync(
  'supabase/migrations/20261026000036_attendance_points.sql',
  'utf8',
);
const snapshot = source.slice(
  source.indexOf('const snapshot ='),
  source.indexOf('const ids ='),
);
const predecessor = readdirSync('supabase/migrations')
  .filter((file) => file.endsWith('.sql') && file < '20261026000036')
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

describe('attendance points immutable database and real integration harness contracts', () => {
  it('preserves complete predecessor rows without dropping fields already introduced by older migrations', () => {
    expect(snapshot).not.toMatch(/-'[a-z_]+'/);
    expect(snapshot).toContain(
      'to_jsonb(r) order by r.id) from public.replies r',
    );
    expect(snapshot).toContain(
      'to_jsonb(p) order by p.id) from private.point_ledger p',
    );
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
      'private.moderation_operations',
      'private.moderation_notices',
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
  });
  it.each(relations)(
    '$table snapshot sort columns exist in migration 35',
    ({ alias, sort, table, relationAlias }) => {
      expect(alias).toBe(relationAlias);
      const definition = definitions.get(table);
      expect(definition, `${table} exists before migration 36`).toBeDefined();
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
  it('uses exact populated predecessor, whole-row comparisons, additive receipt checks and real API reads/writes', () => {
    expect(source).toContain(
      "['db', 'reset', '--local', '--version', '20261026000035']",
    );
    expect(source).toContain("['migration', 'up', '--local']");
    expect([
      ...source.matchAll(/assert\.deepEqual\(\s*snapshot\(\),\s*before,/g),
    ]).toHaveLength(3);
    for (const [key, count] of Object.entries({
      posts: 5,
      comments: 4,
      replies: 2,
      reports: 3,
      points: 12,
      subscriptions: 1,
      messages: 1,
      images: 1,
      likes: 1,
      notifications: 1,
      board_operations: 2,
      board_uploads: 1,
      moderation_operations: 2,
    }))
      expect(source).toContain(`before.${key}.length, ${count}`);
    expect(source).toContain('before.moderation_notices.length > 0');
    expect(source).toContain('before.settings.audit.length > 0');
    expect(source).toContain('deletedReply.is_hidden, true');
    expect(source).toContain('deletedReply.deleted_at');
    expect(source).toContain('deletedReply.report_count, 1');
    expect(source).toContain('deletedReply.revision > 1');
    expect(source).toContain(
      "select count(*) from pg_attribute where attrelid='private.point_attendance_operations'::regclass",
    );
    expect(source).toContain(
      'select count(*) from private.point_attendance_operations;',
    );
    for (const rpc of [
      'point_ui_snapshot',
      'point_ui_check_attendance',
      'point_check_attendance',
      'point_admin_adjust',
      'community_moderation_report',
      'community_moderation_resolve',
    ])
      expect(source).toContain(`public.${rpc}(`);
    expect(source).toContain(
      'after.points.filter((entry) => entry.id !== newcomer.entry_id)',
    );
    expect(source).toContain('before.points,');
    expect(source).toContain('after[key],');
    expect(source).toContain('before[key],');
  });
  it('reuses sole legacy award implementation and does not activate defaults, backfill or rewrite history', () => {
    expect(migration).toContain(
      'entry_id_value:=public.point_check_attendance();',
    );
    expect(migration).not.toMatch(
      /(?:insert into|update|delete from) private\.point_(?:ledger|policy)\b/,
    );
    expect(migration).not.toContain(
      'create or replace function public.point_check_attendance',
    );
    expect(migration).toContain(
      'actor:=private.board_actor(auth.uid(),false,true);',
    );
    expect(migration).toContain(
      'actor:=private.board_actor(auth.uid(),false);',
    );
    expect(
      migration.indexOf('day:=private.point_kst_date(clock_timestamp());'),
    ).toBeGreaterThan(
      migration.indexOf('from private.point_policy where singleton for share;'),
    );
    expect(migration).toContain('primary key(actor_id,operation_id)');
    expect(migration).toContain(
      'before update or delete on private.point_attendance_operations',
    );
    expect(migration).toContain(
      'before truncate on private.point_attendance_operations',
    );
    expect(migration).toContain("'POINT_OPERATION_IMMUTABLE'");
    expect(migration).toContain('p_operation_id uuid)');
    expect(migration).not.toContain('p_day');
    expect(migration).not.toContain('p_amount');
  });
  it('uses safe fictional profiles with chronological onboarding, never production credentials', () => {
    for (const script of [source, concurrency]) {
      expect(script).toContain('onboarding_completed_at=clock_timestamp()');
      expect(script).not.toContain('onboarding_completed_at=now()');
      expect(script).toMatch(/call_name='[^']{2,10}'/u);
      expect(script).not.toMatch(/insert into public\.profiles/);
      expect(script).toContain('@example.invalid');
      expect(script).toContain("const docker = ['--context', 'default']");
      expect(script).toContain(".startsWith('unix://')");
      expect(script).toContain(
        '!process.env.DOCKER_HOST && !process.env.DOCKER_CONTEXT',
      );
      expect(script).toContain("['db', 'reset', '--local']");
      expect(script).not.toMatch(/SUPABASE_SERVICE_ROLE|DATABASE_URL|--db-url/);
    }
  });
  it.each([
    'duplicate-operation',
    'distinct-same-day',
    'raw-before-ui',
    'ui-before-raw',
    'award-before-snapshot',
    'snapshot-before-award',
    'restriction-before-write',
    'restriction-before-snapshot',
    'restriction-before-replay',
    'expired-restriction-after-wait',
    'policy-removed-before-award',
    'policy-changed-before-award',
    'policy-changed-before-snapshot',
    'onboarding-revoked-before-write',
    'correction-before-attendance',
    'attendance-before-correction',
    'rollback-before-retry',
  ])('includes independent PostgreSQL sessions for %s', (scenario) => {
    expect(concurrency).toContain(`'${scenario}'`);
  });
  it('observes backend PID blockers and requires all 17 actual races, never tolerating deadlocks/timeouts', () => {
    expect(concurrency).toContain('const expectedCases = 17');
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
    expect(concurrency).toContain(
      "finalize === 'commit' || finalize === 'rollback'",
    );
  });
});
