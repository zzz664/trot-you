import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// These static harness checks catch misspelled predecessor table/column names.
// They are not a substitute for the hosted populated-upgrade PostgreSQL gate.
const source = readFileSync(
  'scripts/test-community-interactions-upgrade.mjs',
  'utf8',
);
const snapshot = source.slice(
  source.indexOf('const snapshot ='),
  source.indexOf('const ids ='),
);
const predecessor = readdirSync('supabase/migrations')
  .filter((file) => file.endsWith('.sql') && file < '20261025000034')
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
    /jsonb_agg\(to_jsonb\(([a-z]+)\)(?:-'revision')? order by ([^)]+)\) from ((?:public|private)\.[a-z_]+) ([a-z]+)/g,
  ),
].map((match) => ({
  alias: match[1]!,
  sort: match[2]!,
  table: match[3]!,
  relationAlias: match[4]!,
}));

describe('community interactions populated-upgrade harness contract', () => {
  it('preserves all board, image, interaction, reward and operational sources', () => {
    expect(relations.map(({ table }) => table)).toEqual([
      'public.posts',
      'private.board_operations',
      'private.board_uploads',
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
    expect([...snapshot.matchAll(/-'revision'/g)]).toHaveLength(1);
    expect(
      [...snapshot.matchAll(/-'[a-z_]+'/g)].map((match) => match[0]),
    ).toEqual(["-'revision'"]);
    expect(snapshot).toContain(
      "to_jsonb(c)-'revision' order by c.id) from public.comments c",
    );
    expect(snapshot).toContain(
      'to_jsonb(p) order by p.id) from public.posts p',
    );
    expect(snapshot).toContain(
      'to_jsonb(i) order by i.id) from public.post_images i',
    );
  });
  it.each(relations)(
    '$table and its deterministic ordering exist before migration 34',
    ({ alias, sort, table, relationAlias }) => {
      expect(alias).toBe(relationAlias);
      const definition = definitions.get(table);
      expect(definition, `${table} must exist at version 33`).toBeDefined();
      for (const column of sort.split(',')) {
        const [columnAlias, name] = column.trim().split('.');
        expect(columnAlias).toBe(alias);
        expect(name).toMatch(/^[a-z_]+$/);
        expect(definition).toMatch(new RegExp(`(?:^|\\n)\\s*${name}\\s+[a-z]`));
      }
    },
  );
  it('uses the exact predecessor, populated prior app state and real interaction RPCs', () => {
    expect(source).toContain(
      "['db', 'reset', '--local', '--version', '20261025000033']",
    );
    expect(source).toContain("['migration', 'up', '--local']");
    expect([
      ...source.matchAll(/assert\.deepEqual\(\s*snapshot\(\),\s*before,/g),
    ]).toHaveLength(2);
    for (const [key, count] of Object.entries({
      posts: 5,
      comments: 3,
      images: 1,
      likes: 1,
      reports: 1,
      points: 8,
      notifications: 1,
      board_operations: 1,
      board_uploads: 1,
    }))
      expect(source).toContain(`before.${key}.length, ${count}`);
    expect(source).toContain('before.settings.audit.length > 0');
    expect(source).toContain("before.board_uploads[0].state, 'revoked'");
    expect(source).toContain('interactions.comments[0].revision, 1');
    expect(source).toContain(
      'select count(*) from public.comments where revision=1;',
    );
    expect(source).toContain('edited.revision, 3');
    for (const name of [
      'interactions',
      'update_comment',
      'delete_comment',
      'set_like',
    ])
      expect(source).toContain(`public.community_ui_${name}(`);
    expect(source).toContain(
      "'Preserved application body','{}'::uuid[],false,false",
    );
  });
  it('uses valid profile names and wall-clock onboarding after actual creation', () => {
    const concurrency = readFileSync(
      'scripts/test-community-interactions-concurrency.mjs',
      'utf8',
    );
    for (const script of [source, concurrency]) {
      expect(script).toContain('onboarding_completed_at=clock_timestamp()');
      expect(script).not.toContain('onboarding_completed_at=now()');
      expect(script).toMatch(/call_name='[^']{2,10}'/u);
      expect(script).not.toMatch(/insert into public\.profiles/);
    }
  });
  it('exercises serial counter, receipt, visibility and current-authority races', () => {
    const concurrency = readFileSync(
      'scripts/test-community-interactions-concurrency.mjs',
      'utf8',
    );
    for (const scenario of [
      'duplicate-create',
      'changed-create',
      'duplicate-comment-identity',
      'two-comment-authors',
      'duplicate-edit',
      'stale-edit',
      'legacy-edit',
      'duplicate-delete',
      'edit-before-delete',
      'comment-hidden-before-read',
      'duplicate-like',
      'two-likers',
      'like-before-unlike',
      'like-payload-conflict',
      'cross-action-receipt',
      'policy-removal-before-read',
    ])
      expect(concurrency).toContain(`'${scenario}'`);
    expect(concurrency).toMatch(
      /\[\s*'read',\s*'create',\s*'edit',\s*'delete',\s*'like',\s*'replay',?\s*\]/,
    );
    expect(concurrency).toContain("['restricted', 'onboarding', 'artist']");
    expect(concurrency).toContain("['create', 'edit']");
    expect(concurrency).toContain('const expectedCases = 44');
    expect(concurrency).toContain('completedCases,');
    expect(concurrency).toContain('expectedCases,');
    expect(concurrency).toContain('actual_likes');
    expect(concurrency).toContain('visible_comments');
    expect(concurrency).toContain('private.point_ledger where comment_id=');
    expect(concurrency).toContain("'Fictional body','{}'::uuid[],false,false");
  });
  it('limits executable database work to disposable local safety-checked harnesses', () => {
    const concurrency = readFileSync(
      'scripts/test-community-interactions-concurrency.mjs',
      'utf8',
    );
    for (const script of [source, concurrency]) {
      expect(script).toContain("const docker = ['--context', 'default']");
      expect(script).toContain(".startsWith('unix://')");
      expect(script).toContain(
        '!process.env.DOCKER_HOST && !process.env.DOCKER_CONTEXT',
      );
      expect(script).toContain("['db', 'reset', '--local']");
      expect(script).not.toMatch(/SUPABASE_SERVICE_ROLE|DATABASE_URL|--db-url/);
    }
    expect(concurrency).toContain(
      'activityLockQuery(waiting.pid, blocking.pid)',
    );
    expect(concurrency).toContain('select pg_backend_pid()');
    expect(concurrency).toContain(
      'deadlock detected|lock timeout|statement timeout',
    );
  });
});
