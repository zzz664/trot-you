import { execFileSync } from 'node:child_process';
import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

// Only the local CLI-managed database is supported here. No remote URL, project
// reference or credential is read. Do not replace the target with partial output
// if the CLI fails (unlike shell redirection directly into the committed file).
const target = resolve('src/types/database.ts');
const temporary = `${target}.tmp`;
const executable = (name) =>
  resolve(
    'node_modules',
    '.bin',
    process.platform === 'win32' ? `${name}.cmd` : name,
  );

try {
  const generated = execFileSync(
    executable('supabase'),
    ['gen', 'types', 'typescript', '--local', '--schema', 'public'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] },
  );
  if (!generated.includes('export type Database =')) {
    throw new Error(
      'Supabase CLI did not produce a Database type. Target unchanged.',
    );
  }
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(temporary, generated);
  execFileSync(
    executable('prettier'),
    ['--parser', 'typescript', '--write', temporary],
    {
      stdio: 'inherit',
    },
  );
  renameSync(temporary, target);
} finally {
  rmSync(temporary, { force: true });
}
