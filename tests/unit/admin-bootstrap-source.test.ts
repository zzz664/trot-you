// @vitest-environment node
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const helper = readFileSync('scripts/admin-bootstrap.sql', 'utf8');
const fixture = readFileSync('supabase/tests/admin_bootstrap.test.sql', 'utf8');
const begin = '-- BEGIN MANUAL BOOTSTRAP SOURCE (byte-checked by unit test)\n';
const end = '\n-- END MANUAL BOOTSTRAP SOURCE';

it('real rollback-scoped database fixture executes the exact manual helper source', () => {
  const start = fixture.indexOf(begin);
  const stop = fixture.indexOf(end, start);
  expect(start).toBeGreaterThan(-1);
  expect(stop).toBeGreaterThan(start);
  expect(fixture.slice(start + begin.length, stop)).toBe(helper.trimEnd());
  expect(
    fixture.trimStart().startsWith('-- Isolated fictional CI fixture'),
  ).toBe(true);
  expect(fixture.trimEnd().endsWith('rollback;')).toBe(true);
});

it('loading the operator file only defines an invoker-rights session helper', () => {
  expect(helper).toContain('function pg_temp.bootstrap_initial_admin(');
  expect(helper).not.toMatch(/security\s+definer/i);
  expect(helper).not.toMatch(
    /(?:select|perform)\s+pg_temp\.bootstrap_initial_admin/i,
  );
  expect(helper).not.toMatch(/(?:insert\s+into|update)\s+auth\.users/i);
  expect(helper).not.toMatch(/(?:grant\s+execute|commit\s*;)/i);
  expect(helper).toContain(
    "session_user <> 'postgres' or current_user <> 'postgres'",
  );
  expect(helper).toContain(
    "p_confirmation is distinct from ('CONFIRM INITIAL ADMIN ' || p_user_id::text)",
  );
});
