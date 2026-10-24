// @vitest-environment node
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const directories: string[] = [];
const generator = resolve('scripts/generate-database-types.mjs');
const original = '// existing type output must survive failed regeneration\n';
// A tool-output fixture only, not the application Database type.
const generated = 'export type Database = { public: { Tables: {} } };\n';

function fixture(cliBody: string, formatterBody = 'process.exit(0);') {
  const cwd = mkdtempSync(join(tmpdir(), 'trot-you-typegen-'));
  directories.push(cwd);
  mkdirSync(join(cwd, 'node_modules/.bin'), { recursive: true });
  mkdirSync(join(cwd, 'src/types'), { recursive: true });
  const target = join(cwd, 'src/types/database.ts');
  writeFileSync(target, original);
  for (const [name, body] of [
    ['supabase', cliBody],
    ['prettier', formatterBody],
  ]) {
    const executable = join(cwd, 'node_modules/.bin', name!);
    writeFileSync(executable, `#!${process.execPath}\n${body}\n`);
    chmodSync(executable, 0o755);
  }
  return { cwd, target };
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('database type-generation wrapper', () => {
  it('only requests the local public schema and atomically replaces successful output', () => {
    const { cwd, target } = fixture(`
      require('node:fs').writeFileSync('arguments.json', JSON.stringify(process.argv.slice(2)));
      process.stdout.write(${JSON.stringify(generated)});
    `);
    const result = spawnSync(process.execPath, [generator], { cwd });
    expect(result.status).toBe(0);
    expect(
      JSON.parse(readFileSync(join(cwd, 'arguments.json'), 'utf8')),
    ).toEqual(['gen', 'types', 'typescript', '--local', '--schema', 'public']);
    expect(readFileSync(target, 'utf8')).toBe(generated);
    expect(existsSync(`${target}.tmp`)).toBe(false);
  });

  it('preserves the old file when the database/CLI fails', () => {
    const { cwd, target } = fixture(
      "process.stdout.write('partial'); process.exit(1);",
    );
    const result = spawnSync(process.execPath, [generator], { cwd });
    expect(result.status).not.toBe(0);
    expect(readFileSync(target, 'utf8')).toBe(original);
    expect(existsSync(`${target}.tmp`)).toBe(false);
  });

  it('rejects successful CLI output that is not a generated Database type', () => {
    const { cwd, target } = fixture(
      "process.stdout.write('not database types');",
    );
    const result = spawnSync(process.execPath, [generator], { cwd });
    expect(result.status).not.toBe(0);
    expect(readFileSync(target, 'utf8')).toBe(original);
  });

  it('preserves the old file and removes partial output when formatting fails', () => {
    const { cwd, target } = fixture(
      `process.stdout.write(${JSON.stringify(generated)});`,
      'process.exit(1);',
    );
    const result = spawnSync(process.execPath, [generator], { cwd });
    expect(result.status).not.toBe(0);
    expect(readFileSync(target, 'utf8')).toBe(original);
    expect(existsSync(`${target}.tmp`)).toBe(false);
  });
});
