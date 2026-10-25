import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// These static harness checks catch misspelled predecessor table/column names.
// They are not a substitute for the hosted populated-upgrade PostgreSQL gate.
const source = readFileSync('scripts/test-community-posts-upgrade.mjs', 'utf8');
const snapshot = source.slice(
  source.indexOf('const snapshot ='),
  source.indexOf('const ids ='),
);
const predecessor = readdirSync('supabase/migrations')
  .filter((file) => file.endsWith('.sql') && file < '20261025000033')
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
    /jsonb_agg\(to_jsonb\(([a-z]+)\)(?:-'(?:revision|position)')? order by ([^)]+)\) from ((?:public|private)\.[a-z_]+) ([a-z]+)/g,
  ),
].map((match) => ({
  alias: match[1]!,
  sort: match[2]!,
  table: match[3]!,
  relationAlias: match[4]!,
}));

describe('community posts populated-upgrade harness contract', () => {
  it('preserves all board, image, interaction, reward and operational sources', () => {
    expect(relations.map(({ table }) => table)).toEqual([
      'public.posts',
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
    expect([...snapshot.matchAll(/-'position'/g)]).toHaveLength(1);
    expect(
      [...snapshot.matchAll(/-'[a-z_]+'/g)].map((match) => match[0]),
    ).toEqual(["-'revision'", "-'position'"]);
    expect(snapshot).toContain(
      "to_jsonb(i)-'position' order by i.id) from public.post_images i",
    );
    expect(snapshot).toContain(
      "to_jsonb(p)-'revision' order by p.id) from public.posts p",
    );
  });
  it.each(relations)(
    '$table and its deterministic ordering exist before migration 33',
    ({ alias, sort, table, relationAlias }) => {
      expect(alias).toBe(relationAlias);
      const definition = definitions.get(table);
      expect(definition, `${table} must exist at version 32`).toBeDefined();
      for (const column of sort.split(',')) {
        const [columnAlias, name] = column.trim().split('.');
        expect(columnAlias).toBe(alias);
        expect(name).toMatch(/^[a-z_]+$/);
        expect(definition).toMatch(new RegExp(`(?:^|\\n)\\s*${name}\\s+[a-z]`));
      }
    },
  );
  it('uses the exact predecessor, real new RPCs and two complete equality checks', () => {
    expect(source).toContain(
      "['db', 'reset', '--local', '--version', '20261025000032']",
    );
    expect(source).toContain("['migration', 'up', '--local']");
    expect([
      ...source.matchAll(/assert\.deepEqual\(\s*snapshot\(\),\s*before,/g),
    ]).toHaveLength(2);
    expect(source).toContain('before.posts.length, 4');
    expect(source).toContain('before.images.length, 1');
    expect(source).toContain('before.points.length, 5');
    expect(source).toContain('before.notifications.length, 1');
    expect(source).toContain('before.settings.audit.length > 0');
    expect(source).toContain('detail.post.revision, 1');
    expect(source).toContain(
      'select count(*) from public.post_images where position=0;',
    );
    expect(source).toContain('updated.revision, 3');
    expect(source).toContain(
      "public.board_ui_notice('board-upgrade',gen_random_uuid()",
    );
    expect(source).toContain('private.board_uploads');
    expect(source).toContain('private.board_operations');
  });
  it('limits executable database work to disposable local safety-checked harnesses', () => {
    const concurrency = readFileSync(
      'scripts/test-community-posts-concurrency.mjs',
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
