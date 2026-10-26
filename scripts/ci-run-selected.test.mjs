import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  symlinkSync,
  rmSync,
  readFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  BROWSER_CONFIGS,
  buildSelectedCommands,
  executeSelectedCommands,
  parseSelectionPlan,
  runSelected,
  validateSelectionPlan,
} from './ci-run-selected.mjs';

const unit = 'tests/unit/analytics-funnel-client.test.ts';
const fixture = 'scripts/ci-run-selected.test.mjs';
const sql = 'supabase/tests/analytics_funnel.test.sql';
const race = 'scripts/test-analytics-funnel-concurrency.mjs';
const upgrade = 'scripts/test-analytics-funnel-upgrade.mjs';
const browser = 'tests/e2e/analytics-funnel/analytics-funnel.spec.ts';
function plan(overrides = {}) {
  return {
    version: 2,
    mode: 'scoped',
    changedPaths: ['scripts/ci-run-selected.mjs'],
    provenance: { arbitraryEvidenceIsNotExecuted: true },
    selection: {
      unit: [],
      fixtures: [],
      sql: [],
      races: [],
      upgrades: [],
      typecheck: true,
      browser: { quality: [], 'analytics-funnel-browser': [] },
    },
    ...overrides,
  };
}
function selected(selection, overrides = {}) {
  const base = plan(overrides);
  return { ...base, selection: { ...base.selection, ...selection } };
}
function command(value, mode, options) {
  const commands = buildSelectedCommands(value, mode, options);
  assert.equal(commands.length, 1);
  return commands[0];
}
function temp() {
  const root = mkdtempSync(join(tmpdir(), 'ci-selected-test-'));
  return {
    root,
    dispose: () => rmSync(root, { recursive: true, force: true }),
    file(path, text = '') {
      mkdirSync(join(root, path, '..'), { recursive: true });
      writeFileSync(join(root, path), text);
    },
  };
}

test('import exports a pure builder with no static command runner or default suite', () => {
  const source = readFileSync(
    new URL('./ci-run-selected.mjs', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(source, /^import .*['"]node:child_process['"]/m);
  assert.doesNotMatch(source, /execSync|execFileSync|shell:\s*true|eval\(/);
  assert.equal(typeof buildSelectedCommands, 'function');
});
test('accepts exact v2 evidence without executing or reinterpreting metadata', () => {
  const value = plan();
  assert.equal(validateSelectionPlan(value), value);
  assert.deepEqual(parseSelectionPlan(JSON.stringify(value)), value);
});
for (const raw of [
  undefined,
  null,
  '',
  'null',
  '{',
  JSON.stringify({ version: 1 }),
  ' '.repeat(1024 * 1024 + 1),
])
  test(`missing/invalid plan fails closed (${String(raw).slice(0, 12)})`, () =>
    assert.throws(() => parseSelectionPlan(raw)));
for (const value of [
  plan({ mode: 'full' }),
  plan({ mode: 'selective' }),
  plan({ version: 1 }),
  plan({ changedPaths: null }),
  plan({ changedPaths: ['b', 'a'] }),
  plan({ changedPaths: ['a', 'a'] }),
  plan({ selection: {} }),
  plan({ selection: null }),
  selected({ typecheck: 'true' }),
  selected({ typecheck: undefined }),
  selected({ extra: [] }),
  selected({ browser: null }),
  selected({ browser: { unknown: [] } }),
])
  test(`invalid schema/evidence ${JSON.stringify(value).slice(0, 80)}`, () =>
    assert.throws(() => validateSelectionPlan(value)));
for (const path of [
  '/tmp/a',
  '../a',
  'a/../b',
  './a',
  '-flag',
  'C:/a',
  'a\\b',
  'a\0b',
  'a\nb',
  'a//b',
  'a/',
  '.',
])
  test(`unsafe changed path rejected ${JSON.stringify(path)}`, () =>
    assert.throws(() => validateSelectionPlan(plan({ changedPaths: [path] }))));
for (const mode of ['unit', 'fixtures', 'sql', 'races', 'upgrades', 'lint'])
  test(`explicit empty ${mode} selects nothing`, () =>
    assert.deepEqual(
      buildSelectedCommands(plan({ changedPaths: [] }), mode),
      [],
    ));
test('explicit empty browser job differs from missing job', () => {
  assert.deepEqual(
    buildSelectedCommands(plan(), 'browser', { browserJob: 'quality' }),
    [],
  );
  assert.throws(
    () =>
      buildSelectedCommands(plan(), 'browser', { browserJob: 'media-browser' }),
    /absent/,
  );
  assert.throws(() => buildSelectedCommands(plan(), 'browser'), /absent/);
});
for (const mode of [undefined, 'all', 'check:all', 'full', 'typecheck'])
  test(`unknown mode ${mode} cannot broaden tests`, () =>
    assert.throws(() => buildSelectedCommands(plan(), mode)));
test('non-browser mode rejects extra job argument', () =>
  assert.throws(() =>
    buildSelectedCommands(plan(), 'unit', { browserJob: 'quality' }),
  ));
for (const category of ['unit', 'fixtures', 'sql', 'races', 'upgrades']) {
  for (const value of [
    null,
    ['--help'],
    ['tests/unit'],
    ['scripts/test-analytics-funnel-concurrency.mjs;echo bad'],
    ['../tests/foo.test.ts'],
  ])
    test(`${category} rejects non-file/nonallowlisted target ${JSON.stringify(value)}`, () =>
      assert.throws(() =>
        validateSelectionPlan(selected({ [category]: value })),
      ));
}
test('a valid target category does not authorize another category', () => {
  for (const [category, path] of [
    ['unit', fixture],
    ['fixtures', unit],
    ['sql', race],
    ['races', upgrade],
    ['upgrades', race],
  ])
    assert.throws(() =>
      validateSelectionPlan(selected({ [category]: [path] })),
    );
});
test('unit command uses pinned local CLI and exact explicit selected files', () => {
  const built = command(selected({ unit: [unit] }), 'unit', {
    availableUnitFiles: [unit, 'tests/unit/old.test.ts'],
  });
  assert.equal(built.command, 'node');
  assert.deepEqual(built.files, [unit]);
  assert.deepEqual(built.args, [
    'node_modules/vitest/vitest.mjs',
    'run',
    '--passWithNoTests=false',
    '--allowOnly=false',
    unit,
  ]);
});
test('unit inventory is required and must contain selected targets', () => {
  assert.throws(
    () => buildSelectedCommands(selected({ unit: [unit] }), 'unit'),
    /inventory/,
  );
  assert.throws(
    () =>
      buildSelectedCommands(selected({ unit: [unit] }), 'unit', {
        availableUnitFiles: [],
      }),
    /absent/,
  );
});
test('Vitest substring collisions cannot expand selected file scope', () => {
  const collision = `${unit}x`;
  const nestedCollision = `${unit}.extra.test.ts`;
  const built = command(selected({ unit: [unit] }), 'unit', {
    availableUnitFiles: [
      unit,
      collision,
      nestedCollision,
      'tests/unit/old.test.ts',
    ],
  });
  assert.deepEqual(built.args, [
    'node_modules/vitest/vitest.mjs',
    'run',
    '--passWithNoTests=false',
    '--allowOnly=false',
    '--exclude',
    collision,
    '--exclude',
    nestedCollision,
    unit,
  ]);
});
test('case-insensitive Vitest filter collisions are excluded without excluding an explicitly selected sibling', () => {
  const upper = unit
    .toUpperCase()
    .replace('TESTS/UNIT/', 'tests/unit/')
    .replace('.TEST.TS', '.test.ts');
  const collision = `${unit}x`;
  const built = command(selected({ unit: [unit, collision] }), 'unit', {
    availableUnitFiles: [unit, upper, collision],
  });
  assert.ok(built.args.includes(upper));
  assert.equal(built.args.filter((arg) => arg === '--exclude').length, 1);
  assert.deepEqual(built.files, [unit, collision]);
});
test('fixture command names exact files and never node test discovery', () =>
  assert.deepEqual(
    command(selected({ fixtures: [fixture] }), 'fixtures').args,
    ['--test', fixture],
  ));
test('SQL command always includes local and exact paths, never linked or remote URL', () => {
  const built = command(selected({ sql: [sql] }), 'sql');
  assert.deepEqual(built.args, [
    'node_modules/supabase/dist/supabase.js',
    'test',
    'db',
    '--local',
    sql,
  ]);
  assert.doesNotMatch(built.args.join(' '), /--linked|--db-url/);
});
for (const [mode, path] of [
  ['races', race],
  ['upgrades', upgrade],
])
  test(`${mode} executes only named scripts individually`, () =>
    assert.deepEqual(command(selected({ [mode]: [path] }), mode).args, [path]));
for (const [job, [config, directory]] of Object.entries(BROWSER_CONFIGS))
  test(`browser ${job} uses exact config and exact file regex`, () => {
    const file = `tests/e2e/${directory ? `${directory}/` : ''}scoped.spec.ts`;
    const built = command(
      selected({ browser: { [job]: [{ file }] } }),
      'browser',
      { browserJob: job },
    );
    assert.deepEqual(built.files, [config, file]);
    assert.ok(built.args.includes(config));
    const filter = new RegExp(built.args.at(-1));
    assert.ok(filter.test(`/repo/${file}`));
    assert.ok(filter.test(file));
    assert.ok(!filter.test(`/repo/${file}x`));
    assert.ok(!filter.test(`/repo/other/scoped.spec.ts`));
    assert.ok(built.args.includes('--forbid-only'));
  });
for (const entry of [
  {},
  { file: browser, arbitrary: true },
  { file: '--help' },
  { file: 'tests/e2e/authenticated/auth.spec.ts' },
  { file: 'tests/e2e/analytics-funnel/fixtures.ts' },
  { file: browser, grep: '' },
  { file: browser, grep: ' ' },
  { file: browser, grep: '[' },
  { file: browser, grep: 'a\nb' },
  { file: browser, grep: null },
  { file: browser, grep: 'x'.repeat(4097) },
])
  test(`invalid browser/case entry ${JSON.stringify(entry).slice(0, 100)}`, () =>
    assert.throws(() =>
      validateSelectionPlan(
        selected({ browser: { 'analytics-funnel-browser': [entry] } }),
      ),
    ));
test('quality cannot invoke private feature suite through default config', () =>
  assert.throws(() =>
    validateSelectionPlan(
      selected({ browser: { quality: [{ file: browser }] } }),
    ),
  ));
test('safe same-file case expressions union in one invocation without changing matching cases', () => {
  const built = command(
    selected({
      browser: {
        'analytics-funnel-browser': [
          { file: browser, grep: '^first exact$' },
          { file: browser, grep: '^second exact$' },
          { file: browser, grep: '^first exact$' },
        ],
      },
    }),
    'browser',
    { browserJob: 'analytics-funnel-browser' },
  );
  const grep = built.args[built.args.indexOf('--grep') + 1];
  const expression = new RegExp(grep);
  assert.ok(expression.test('first exact'));
  assert.ok(expression.test('second exact'));
  assert.ok(!expression.test('unselected'));
  assert.ok(!expression.test('first exact suffix'));
});
test('grep is never combined across files and cannot become shell syntax', () => {
  const other = 'tests/e2e/analytics-funnel/other.spec.ts';
  const built = buildSelectedCommands(
    selected({
      browser: {
        'analytics-funnel-browser': [
          { file: browser, grep: 'exact;$(do-not-run)' },
          { file: other, grep: '^different$' },
        ],
      },
    }),
    'browser',
    { browserJob: 'analytics-funnel-browser' },
  );
  assert.equal(built.length, 2);
  assert.ok(built[0].args.includes('exact;$(do-not-run)'));
  assert.ok(!built[0].args.includes('^different$'));
});
test('backreference expressions remain separate to preserve numeric capture meaning', () => {
  const built = buildSelectedCommands(
    selected({
      browser: {
        'analytics-funnel-browser': [
          { file: browser, grep: '^(a)\\1$' },
          { file: browser, grep: '^(b)\\1$' },
        ],
      },
    }),
    'browser',
    { browserJob: 'analytics-funnel-browser' },
  );
  assert.equal(built.length, 2);
});
test('duplicate named captures never produce an invalid combined regex', () => {
  const built = buildSelectedCommands(
    selected({
      browser: {
        'analytics-funnel-browser': [
          { file: browser, grep: '(?<same>a)' },
          { file: browser, grep: '(?<same>b)' },
        ],
      },
    }),
    'browser',
    { browserJob: 'analytics-funnel-browser' },
  );
  for (const item of built)
    assert.doesNotThrow(
      () => new RegExp(item.args[item.args.indexOf('--grep') + 1]),
    );
});
test('explicit full-file selection subsumes same-file named cases only', () => {
  const built = command(
    selected({
      browser: {
        'analytics-funnel-browser': [
          { file: browser },
          { file: browser, grep: '^first$' },
        ],
      },
    }),
    'browser',
    { browserJob: 'analytics-funnel-browser' },
  );
  assert.ok(!built.args.includes('--grep'));
});
test('lint only names changed existing files and honors tool ignore configuration', () => {
  const changedPaths = [
    'README.md',
    'docs/removed.md',
    'public/image.png',
    'scripts/new.mjs',
    'src/app/[slug]/page.tsx',
    'src/messages/ko.json',
    'supabase/migrations/new.sql',
  ];
  const built = buildSelectedCommands(plan({ changedPaths }), 'lint', {
    existingChangedPaths: changedPaths.filter(
      (path) => path !== 'docs/removed.md',
    ),
  });
  assert.equal(built.length, 2);
  assert.deepEqual(built[0].files, [
    'scripts/new.mjs',
    'src/app/[slug]/page.tsx',
  ]);
  assert.ok(built[0].args.includes('--no-warn-ignored'));
  assert.ok(built[1].args.includes('--ignore-unknown'));
  assert.ok(!built[1].files.includes('public/image.png'));
  assert.ok(!built[1].files.includes('docs/removed.md'));
  assert.ok(built[1].files.includes('supabase/migrations/new.sql'));
});
test('lint refuses unselected existing file injection', () =>
  assert.throws(() =>
    buildSelectedCommands(plan(), 'lint', {
      existingChangedPaths: ['old.mjs'],
    }),
  ));
test('documentation-only stays dependency-free and cannot silently select tests or typecheck', () => {
  const docs = selected(
    { typecheck: false },
    { mode: 'docs-only', changedPaths: ['docs/ci.md'] },
  );
  for (const mode of ['lint', 'unit', 'fixtures', 'sql', 'races', 'upgrades'])
    assert.deepEqual(buildSelectedCommands(docs, mode), []);
  assert.throws(() =>
    validateSelectionPlan(
      selected(
        { fixtures: [fixture], typecheck: false },
        { mode: 'docs-only' },
      ),
    ),
  );
  assert.throws(() => validateSelectionPlan(plan({ mode: 'docs-only' })));
});
test('empty executor reports not selected without calling spawn', () => {
  const lines = [];
  assert.equal(
    executeSelectedCommands([], () => assert.fail('must not spawn'), {
      log: (value) => lines.push(value),
    }),
    0,
  );
  assert.deepEqual(lines, ['not selected']);
});
test('executor uses argument arrays without shell and stops at first selected failure', () => {
  const commands = [
    { command: 'node', args: [race], files: [race] },
    { command: 'node', args: [upgrade], files: [upgrade] },
  ];
  const calls = [];
  const result = executeSelectedCommands(
    commands,
    (...args) => {
      calls.push(args);
      return { status: 7 };
    },
    { cwd: '/repo', nodeExecutable: '/runtime/node' },
  );
  assert.equal(result, 7);
  assert.deepEqual(calls, [
    ['/runtime/node', [race], { cwd: '/repo', stdio: 'inherit', shell: false }],
  ]);
});
for (const result of [
  { status: null, signal: 'SIGTERM' },
  { status: null, error: new Error('missing') },
  { status: -1 },
  {},
])
  test(`uncertain/failed command returns nonzero ${JSON.stringify(result)}`, () =>
    assert.equal(
      executeSelectedCommands([{ args: [race] }], () => result),
      1,
    ));
test('successful commands run exactly once in selection order', () => {
  const commands = [race, upgrade].map((path) => ({ args: [path] }));
  const calls = [];
  assert.equal(
    executeSelectedCommands(commands, (_, args) => {
      calls.push(args);
      return { status: 0 };
    }),
    0,
  );
  assert.deepEqual(calls, [[race], [upgrade]]);
});
test('runtime rejects missing selected files before importing/executing command runner', async () => {
  const directory = temp();
  try {
    await assert.rejects(
      runSelected({
        rawPlan: JSON.stringify(selected({ fixtures: [fixture] })),
        args: ['fixtures'],
        cwd: directory.root,
      }),
      /missing/,
    );
  } finally {
    directory.dispose();
  }
});
test('runtime rejects directories and symlinks as selected executable files', async () => {
  const directory = temp();
  try {
    mkdirSync(join(directory.root, fixture), { recursive: true });
    await assert.rejects(
      runSelected({
        rawPlan: JSON.stringify(selected({ fixtures: [fixture] })),
        args: ['fixtures'],
        cwd: directory.root,
      }),
      /regular/,
    );
    rmSync(join(directory.root, fixture), { recursive: true });
    directory.file('outside.mjs');
    symlinkSync(
      join(directory.root, 'outside.mjs'),
      join(directory.root, fixture),
    );
    await assert.rejects(
      runSelected({
        rawPlan: JSON.stringify(selected({ fixtures: [fixture] })),
        args: ['fixtures'],
        cwd: directory.root,
      }),
      /regular/,
    );
  } finally {
    directory.dispose();
  }
});
test('runtime checks the complete plan before executing an otherwise valid requested mode', async () => {
  const directory = temp();
  try {
    directory.file(fixture);
    await assert.rejects(
      runSelected({
        rawPlan: JSON.stringify(selected({ fixtures: [fixture], sql: [sql] })),
        args: ['fixtures'],
        cwd: directory.root,
      }),
      /missing/,
    );
  } finally {
    directory.dispose();
  }
});
test('runtime checks browser config before any selected invocation', async () => {
  const directory = temp();
  try {
    directory.file(browser);
    await assert.rejects(
      runSelected({
        rawPlan: JSON.stringify(
          selected({
            browser: { 'analytics-funnel-browser': [{ file: browser }] },
          }),
        ),
        args: ['browser', 'analytics-funnel-browser'],
        cwd: directory.root,
      }),
      /playwright.analytics-funnel.config.ts/,
    );
  } finally {
    directory.dispose();
  }
});
test('runtime treats explicit no-op including deleted changed docs as success without node_modules', async () => {
  const directory = temp();
  const lines = [];
  try {
    const docs = selected(
      { typecheck: false },
      { mode: 'docs-only', changedPaths: ['docs/deleted.md'] },
    );
    assert.equal(
      await runSelected({
        rawPlan: JSON.stringify(docs),
        args: ['lint'],
        cwd: directory.root,
        log: (value) => lines.push(value),
      }),
      0,
    );
    assert.deepEqual(lines, ['not selected']);
  } finally {
    directory.dispose();
  }
});
for (const args of [
  [],
  ['unit', 'quality'],
  ['browser'],
  ['browser', 'quality', 'extra'],
])
  test(`runtime rejects ambiguous CLI arguments ${JSON.stringify(args)}`, async () =>
    assert.rejects(
      runSelected({ rawPlan: JSON.stringify(plan()), args }),
      /Usage/,
    ));

test('installed Vitest pure argument parser receives exact filters, not post-separator extras', async () => {
  const { parseCLI } = await import('vitest/node');
  const built = command(selected({ unit: [unit] }), 'unit', {
    availableUnitFiles: [unit, `${unit}x`],
  });
  const parsed = parseCLI(['vitest', ...built.args.slice(1)]);
  assert.deepEqual(parsed.filter, [unit]);
  assert.deepEqual(parsed.options.exclude, [`${unit}x`]);
  assert.equal(parsed.options.passWithNoTests, false);
  assert.equal(parsed.options.allowOnly, false);
});

test('slash-delimited Playwright grep expressions retain independent flags and semantics', () => {
  const built = buildSelectedCommands(
    selected({
      browser: {
        'analytics-funnel-browser': [
          { file: browser, grep: '/first/i' },
          { file: browser, grep: '/second/i' },
        ],
      },
    }),
    'browser',
    { browserJob: 'analytics-funnel-browser' },
  );
  assert.equal(built.length, 2);
  assert.ok(built[0].args.includes('/first/i'));
  assert.ok(built[1].args.includes('/second/i'));
});
test('runtime fails closed on unsupported unit inventory names rather than missing a filter collision', async () => {
  const directory = temp();
  try {
    directory.file(unit);
    directory.file(`${unit} unexpected.test.ts`);
    await assert.rejects(
      runSelected({
        rawPlan: JSON.stringify(selected({ unit: [unit] })),
        args: ['unit'],
        cwd: directory.root,
      }),
      /unsupported test path/,
    );
  } finally {
    directory.dispose();
  }
});
