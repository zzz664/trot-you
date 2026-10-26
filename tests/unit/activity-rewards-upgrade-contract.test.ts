import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Structural guards supplement real hosted pgTAP/races/upgrade execution; they
// do not claim that SQL has run or that an operational policy is approved.
const source = readFileSync(
  'scripts/test-activity-rewards-upgrade.mjs',
  'utf8',
);
const concurrency = readFileSync(
  'scripts/test-activity-rewards-concurrency.mjs',
  'utf8',
);
const migration = readFileSync(
  'supabase/migrations/20261026000037_activity_rewards.sql',
  'utf8',
);
const snapshot = source.slice(
  source.indexOf('const snapshot ='),
  source.indexOf('const ids ='),
);
const predecessor = readdirSync('supabase/migrations')
  .filter((file) => file.endsWith('.sql') && file < '20261026000037')
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

describe('activity reward immutable database and real integration harness contracts', () => {
  it('snapshots complete predecessor relations including ledger and already-existing attendance receipts', () => {
    expect(snapshot).not.toMatch(/-'[a-z_]+'/);
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
      'private.point_attendance_operations',
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
    expect(snapshot).not.toContain('point_activity_outcomes');
  });
  it.each(relations)(
    '$table sort columns exist in the actual migration 36 predecessor',
    ({ alias, sort, table, relationAlias }) => {
      expect(alias).toBe(relationAlias);
      const definition = definitions.get(table);
      expect(definition, `${table} exists before migration 37`).toBeDefined();
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
  it('performs a populated 36-to-37 upgrade and compares all old fields separately from additive storage', () => {
    expect(source).toContain(
      "['db', 'reset', '--local', '--version', '20261026000036']",
    );
    expect(source).toContain("['migration', 'up', '--local']");
    expect([
      ...source.matchAll(/assert\.deepEqual\(\s*snapshot\(\),\s*before,/g),
    ]).toHaveLength(3);
    for (const [key, count] of Object.entries({
      posts: 7,
      comments: 4,
      replies: 2,
      reports: 3,
      points: 14,
      subscriptions: 1,
      messages: 1,
      images: 1,
      likes: 1,
      notifications: 1,
      board_operations: 2,
      board_uploads: 1,
      moderation_operations: 2,
      attendance_operations: 1,
    }))
      expect(source).toContain(`before.${key}.length, ${count}`);
    expect(source).toContain('before.moderation_notices.length > 0');
    expect(source).toContain('before.settings.audit.length > 0');
    expect(source).toContain('deletedReply.is_hidden, true');
    expect(source).toContain('deletedReply.deleted_at');
    expect(source).toContain('deletedReply.report_count, 1');
    expect(source).toContain('deletedReply.revision > 1');
    expect(source).toContain(
      "select count(*) from pg_attribute where attrelid='private.point_activity_outcomes'::regclass",
    );
    expect(source).toContain(
      'select count(*) from private.point_activity_outcomes;',
    );
    expect(source).toContain(
      'select count(*) from private.point_attendance_operations;',
    );
    expect(source).toContain(
      'after.points.filter((entry) => oldEntryIds.has(entry.id))',
    );
    expect(source).toContain('before.points,');
    expect(source).toContain('after[key],');
    expect(source).toContain('before[key],');
  });
  it('proves legacy zeros remain unknown and new atomic outcomes distinguish awarded/capped/configured zero', () => {
    expect(source).toContain('post_id === legacyZero');
    expect(source).toContain('post_id === legacyCapped');
    expect(source).toContain("entry.outcome === 'legacy'");
    for (const outcome of ['awarded', 'daily_cap', 'zero_amount'])
      expect(source).toContain(`outcome: '${outcome}'`);
    expect(source).toContain('page.share.configured, false');
    expect(source).toContain('page.missions.configured, false');
    expect(source).toContain('page.grade.configured, false');
    expect(source).toContain(
      'page.contribution_policy.deleted_content_treatment',
    );
    expect(source).toContain('current.next_cursor.created_at');
    expect(source).toContain('current.next_cursor.id');
    expect(source).toContain('priorReceipt,');
    expect(source).toContain('ownAdmin.entries,');
  });
  it('keeps the old ledger schema and append implementation while adding only immutable decision metadata', () => {
    expect(migration).not.toMatch(
      /alter table private\.point_ledger|(?:insert into|update|delete from) private\.point_(?:ledger|policy)\b/,
    );
    expect(migration).not.toContain(
      'create or replace function private.append_point_entry',
    );
    expect(migration).toContain('entry_id_value:=private.append_point_entry(');
    expect(migration).toContain(
      'insert into private.point_activity_outcomes(entry_id,outcome) values(entry_id_value,outcome_value);',
    );
    expect(migration).toContain(
      'entry_id uuid primary key references private.point_ledger(id) on delete restrict',
    );
    expect(migration).toContain(
      'before update or delete on private.point_activity_outcomes',
    );
    expect(migration).toContain(
      'before truncate on private.point_activity_outcomes',
    );
    expect(migration).toContain("coalesce(o.outcome,'legacy')");
    expect(migration).toContain(
      'actor:=private.board_actor(auth.uid(),false);',
    );
    expect(
      migration.indexOf(
        'day:=private.point_kst_date(clock_timestamp());',
        migration.indexOf('create function public.point_ui_activity'),
      ),
    ).toBeGreaterThan(
      migration.indexOf(
        'from private.point_policy where singleton for share;',
        migration.indexOf('create function public.point_ui_activity'),
      ),
    );
  });
  it('uses only fictional chronological profiles and disposable default local Docker', () => {
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
    '`duplicate-${kind}-operation`',
    '`${kind}-daily-cap`',
    "'independent-action-caps'",
    '`${kind}-rollback-before-retry`',
    "'policy-deleted-before-post'",
    "'policy-changed-before-comment'",
    "'restriction-before-post'",
    "'hidden-parent-before-comment'",
    '`balance-limit-before-${kind}`',
    "'post-before-activity'",
    "'activity-before-comment'",
    "'policy-update-before-activity'",
    "'policy-delete-before-activity'",
    "'restriction-before-activity'",
  ])('executes real independently blocked operations for %s', (scenario) => {
    expect(concurrency).toContain(scenario);
  });
  it('requires all 18 actual races and checks every committed source has new metadata, never tolerating lock errors', () => {
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
    expect(concurrency).toContain(
      "finalize === 'commit' || finalize === 'rollback'",
    );
    expect(concurrency).toContain("['daily_cap', 'awarded']");
    expect(concurrency).toContain(
      "where l.reason in('post','comment') and o.entry_id is null;",
    );
    expect(concurrency).toContain('ledger_count: expected.length');
    expect(concurrency).toContain('outcome_count: expected.length');
    expect(concurrency).toContain('orphaned: 0');
    expect([
      ...concurrency.matchAll(/await assertOutcomes\(db, f, \['awarded'\]\);/g),
    ]).toHaveLength(2);
    expect(concurrency).toContain(
      "await assertOutcomes(db, f, ['daily_cap', 'awarded']);",
    );
    expect(concurrency).toContain('private.community_rate_limits');
  });
});
