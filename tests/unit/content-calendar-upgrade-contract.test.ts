import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Static fixture-contract checks, not a substitute for the real populated DB
// upgrade gate. Catch nonexistent table/ordering assumptions before that late gate.
const source = readFileSync(
  'scripts/test-content-calendar-upgrade.mjs',
  'utf8',
);
const snapshot = source.slice(
  source.indexOf('const snapshot ='),
  source.indexOf('let shouldReset ='),
);
const predecessor = readdirSync('supabase/migrations')
  .filter((file) => file.endsWith('.sql') && file < '20261025000032')
  .sort()
  .map((file) => readFileSync(`supabase/migrations/${file}`, 'utf8'))
  .join('\n');
const tableDefinitions = new Map(
  [
    ...predecessor.matchAll(
      /create table ((?:public|private)\.[a-z_]+)\s*\(([\s\S]+?)\n\);/g,
    ),
  ].map((match) => [match[1], match[2]]),
);
const snapshots = [
  ...snapshot.matchAll(
    /jsonb_agg\(to_jsonb\(([a-z]+)\)(?:-'revision')? order by ([^)]+)\) from ((?:public|private)\.[a-z_]+) ([a-z]+)/g,
  ),
].map((match) => ({
  alias: match[1]!,
  sort: match[2]!,
  table: match[3]!,
  relationAlias: match[4]!,
}));

const expectedRelations = [
  'public.content_calendar',
  'public.calendar_audit_log',
  'public.profiles',
  'public.artists',
  'public.artist_members',
  'public.schedules',
  'private.admin_settings_state',
  'private.admin_display_settings',
  'private.admin_settings_audit',
  'private.admin_settings_operations',
  'private.message_policy',
  'private.community_policy',
  'private.settlement_policies',
  'private.notification_jobs',
];

describe('content calendar populated upgrade fixture contract', () => {
  it('snapshots the actual typed settings sources, not a design-document app_settings table', () => {
    expect(snapshots.map(({ table }) => table)).toEqual(expectedRelations);
    expect(snapshot).not.toContain('app_settings');
  });

  it.each(snapshots)(
    '$table and every stable ordering column exist before migration 32',
    ({ table, alias, relationAlias, sort }) => {
      expect(alias).toBe(relationAlias);
      const definition = tableDefinitions.get(table);
      expect(
        definition,
        `${table} must already exist at version 31`,
      ).toBeDefined();
      for (const column of sort.split(',')) {
        const [columnAlias, name] = column.trim().split('.');
        expect(columnAlias).toBe(alias);
        expect(name).toMatch(/^[a-z_]+$/);
        expect(definition).toMatch(new RegExp(`(?:^|\\n)\\s*${name}\\s+[a-z]`));
      }
    },
  );

  it('populates real settings and retains both full equality checks', () => {
    expect(source).toContain(
      'insert into private.admin_display_settings(singleton,page_size) values(true,23)',
    );
    expect(source).toContain('before.settings.display[0].page_size, 23');
    expect(source).toContain('before.settings.audit.length > 0');
    expect([
      ...source.matchAll(/assert\.deepEqual\(\s*snapshot\(\),\s*before,/g),
    ]).toHaveLength(2);
    expect([...snapshot.matchAll(/-'revision'/g)]).toHaveLength(1);
    expect(snapshot).toContain("to_jsonb(c)-'revision'");
  });

  it('keeps the predecessor boundary and post-upgrade CAS checks', () => {
    expect(source).toContain(
      "['db', 'reset', '--local', '--version', '20261025000031']",
    );
    expect(source).toContain("['migration', 'up', '--local']");
    expect(source).toContain('month.entries[0].revision, 1');
    expect(source).toContain('updated.revision, 3');
    expect(source).toContain('private.content_calendar_operations');
  });
});
